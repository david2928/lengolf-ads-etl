import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';

/**
 * A record from the public.google_ads_offline_conversions view
 * joined with upload tracking status.
 */
export interface OfflineConversionRecord {
  booking_id: string;
  email: string | null;
  phone_number: string | null;
  conversion_time: string;  // timestamptz from view
  conversion_value: number;
  currency_code: string;
  customer_name: string | null;
  status: string;           // booking status
}

/**
 * A single conversion formatted for the Google Ads API upload.
 */
export interface EnhancedConversion {
  conversionAction: string;
  conversionDateTime: string;
  conversionValue: number;
  currencyCode: string;
  consent: {
    adUserData: string;
    adPersonalization: string;
  };
  userIdentifiers: Array<{
    hashedEmail?: string;
    hashedPhoneNumber?: string;
  }>;
}

export interface ConversionUploadResult {
  total: number;
  uploaded: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Uploads offline conversions to Google Ads using Enhanced Conversions for Leads.
 *
 * Data flow:
 *   public.google_ads_offline_conversions (VIEW on bookings)
 *     LEFT JOIN marketing.google_ads_conversion_uploads (tracking)
 *       → filter unuploaded → hash PII → gRPC API upload → update tracking
 */
export class GoogleAdsConversionUploader {
  private customerId: string;
  private supabase = createClient(appConfig.supabaseUrl, appConfig.supabaseServiceKey);

  constructor() {
    // Strip hyphens from customer ID (Google Ads expects digits only)
    this.customerId = appConfig.googleCustomerId.replace(/-/g, '');
  }

  /**
   * Main entry point: fetch unuploaded conversions, upload them, record results.
   */
  async uploadPendingConversions(): Promise<ConversionUploadResult> {
    const result: ConversionUploadResult = {
      total: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    try {
      // 1. Get the conversion action resource name
      const conversionActionResourceName = this.getConversionActionResourceName();
      if (!conversionActionResourceName) {
        throw new Error(
          'GOOGLE_CONVERSION_ACTION_ID not configured. ' +
          'Query conversion actions via /api/debug/gaql and set the env var.'
        );
      }

      // 2. Fetch unuploaded conversion records
      const records = await this.fetchUnuploadedConversions();
      result.total = records.length;

      if (records.length === 0) {
        logger.info('No pending conversions to upload');
        return result;
      }

      logger.info('Fetched unuploaded conversions', {
        count: records.length,
        conversionAction: conversionActionResourceName
      });

      // 3. Stage all records as 'pending' in tracking table
      await this.stageRecords(records);

      // 4. Build API payloads with hashed PII
      const conversions: Array<{ bookingId: string; payload: EnhancedConversion }> = [];
      const skippedIds: string[] = [];

      for (const record of records) {
        const userIdentifiers = this.buildUserIdentifiers(record.email, record.phone_number);
        if (userIdentifiers.length === 0) {
          result.skipped++;
          skippedIds.push(record.booking_id);
          continue;
        }

        conversions.push({
          bookingId: record.booking_id,
          payload: {
            conversionAction: conversionActionResourceName,
            conversionDateTime: this.formatConversionDateTime(record.conversion_time),
            conversionValue: record.conversion_value,
            currencyCode: record.currency_code,
            // Consent: GRANTED per Lengolf's PDPA-compliant booking terms
            // (customers consent to data use for ads optimization at booking time)
            consent: {
              adUserData: 'GRANTED',
              adPersonalization: 'GRANTED'
            },
            userIdentifiers
          }
        });
      }

      // Batch-mark skipped records as failed
      if (skippedIds.length > 0) {
        await this.batchUpdateTrackingStatus(skippedIds, 'failed', 'No valid email or phone');
      }

      if (conversions.length === 0) {
        logger.info('No conversions with valid identifiers to upload');
        return result;
      }

      // 5. Upload in batches of 2000 (API limit)
      // Create client once outside the loop
      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();

      const batchSize = 2000;
      for (let i = 0; i < conversions.length; i += batchSize) {
        const batch = conversions.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(conversions.length / batchSize);

        logger.info(`Uploading batch ${batchNum}/${totalBatches}`, {
          batchSize: batch.length,
          startIndex: i
        });

        try {
          const uploadResponse = await adsClient.uploadEnhancedConversions(
            this.customerId,
            batch.map(c => c.payload)
          );

          // Process per-conversion results (batched DB updates)
          await this.processUploadResults(batch, uploadResponse);

          const batchUploaded = uploadResponse.successCount || batch.length;
          const batchFailed = uploadResponse.failureCount || 0;
          result.uploaded += batchUploaded;
          result.failed += batchFailed;

          logger.info(`Batch ${batchNum} completed`, {
            uploaded: batchUploaded,
            failed: batchFailed
          });

        } catch (batchError) {
          const errorMsg = getErrorMessage(batchError);
          result.failed += batch.length;
          result.errors.push(`Batch ${batchNum}: ${errorMsg}`);

          // Batch-mark all records in this batch as failed
          await this.batchUpdateTrackingStatus(
            batch.map(c => c.bookingId),
            'failed',
            errorMsg
          );

          logger.error(`Batch ${batchNum} failed`, {
            error: errorMsg,
            batchSize: batch.length
          });
        }
      }

      logger.info('Offline conversion upload completed', {
        total: result.total,
        uploaded: result.uploaded,
        failed: result.failed,
        skipped: result.skipped
      });

      return result;

    } catch (error) {
      logger.error('Failed to upload offline conversions', {
        error: getErrorMessage(error)
      });
      result.errors.push(getErrorMessage(error));
      return result;
    }
  }

  /**
   * Get the conversion action resource name from config.
   */
  private getConversionActionResourceName(): string | null {
    const actionId = appConfig.googleConversionActionId;
    if (!actionId) return null;
    // If user provided the full resource name, use it as-is
    if (actionId.startsWith('customers/')) return actionId;
    // Otherwise, build resource name from ID
    return `customers/${this.customerId}/conversionActions/${actionId}`;
  }

  /**
   * Fetch conversions from the view that haven't been uploaded yet.
   * Queries the view and tracking table separately, filters in code.
   */
  private async fetchUnuploadedConversions(): Promise<OfflineConversionRecord[]> {
    // Get all conversions from view
    const { data: allConversions, error: viewError } = await this.supabase
      .from('google_ads_offline_conversions')
      .select('booking_id, email, phone_number, conversion_time, conversion_value, currency_code, customer_name, status')
      .order('conversion_time', { ascending: true });

    if (viewError) {
      throw new Error(`Failed to fetch conversions: ${viewError.message}`);
    }

    // Get all tracked booking IDs from the upload tracking table
    const { data: tracked, error: trackingError } = await this.supabase
      .schema('marketing')
      .from('google_ads_conversion_uploads')
      .select('booking_id, status, retry_count');

    if (trackingError) {
      logger.warn('Failed to query tracking table, uploading all', { error: trackingError.message });
      return (allConversions || []) as OfflineConversionRecord[];
    }

    // Build lookup of tracked booking IDs
    const trackedMap = new Map<string, { status: string; retry_count: number }>();
    (tracked || []).forEach((u: any) => {
      trackedMap.set(u.booking_id, { status: u.status, retry_count: u.retry_count });
    });

    // Filter: include if not tracked, or if failed with retries remaining
    return ((allConversions || []) as OfflineConversionRecord[]).filter(conv => {
      const entry = trackedMap.get(conv.booking_id);
      if (!entry) return true;
      if (entry.status === 'failed' && entry.retry_count < 3) return true;
      return false;
    });
  }

  /**
   * Insert pending records into the tracking table (upsert to handle retries).
   * Throws on failure to prevent uploading untracked conversions.
   */
  private async stageRecords(records: OfflineConversionRecord[]): Promise<void> {
    const rows = records.map(r => ({
      booking_id: r.booking_id,
      conversion_time: r.conversion_time,
      conversion_value: r.conversion_value,
      status: 'pending',
      error_message: null  // Clear previous error on retry; retry_count intentionally omitted to preserve it
    }));

    // Upsert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await this.supabase
        .schema('marketing')
        .from('google_ads_conversion_uploads')
        .upsert(batch, {
          onConflict: 'booking_id',
          ignoreDuplicates: false
        });

      if (error) {
        // Abort: uploading without tracking creates untracked duplicates
        throw new Error(`Failed to stage tracking records (batch ${i}): ${error.message}`);
      }
    }
  }

  /**
   * Process the API response and update tracking table using batched DB updates.
   */
  private async processUploadResults(
    batch: Array<{ bookingId: string; payload: EnhancedConversion }>,
    response: { results: Array<{ success: boolean; error?: string }>; successCount: number; failureCount: number }
  ): Promise<void> {
    const successIds: string[] = [];
    const failedIds: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const convResult = response.results?.[i];
      // Default to failure when result is missing (safety-first)
      if (convResult?.success === true) {
        successIds.push(batch[i].bookingId);
      } else {
        failedIds.push(batch[i].bookingId);
      }
    }

    // Batch update successes
    if (successIds.length > 0) {
      await this.batchUpdateTrackingStatus(successIds, 'uploaded', null);
    }

    // Batch update failures (with atomic retry_count increment)
    if (failedIds.length > 0) {
      await this.batchUpdateTrackingStatus(failedIds, 'failed', 'Partial failure');
    }
  }

  /**
   * Batch update tracking records by status.
   * Uses atomic retry_count increment for failures to avoid race conditions.
   */
  private async batchUpdateTrackingStatus(
    bookingIds: string[],
    status: 'uploaded' | 'failed',
    errorMessage: string | null
  ): Promise<void> {
    if (bookingIds.length === 0) return;

    if (status === 'uploaded') {
      // Batch update all successful records
      const { error } = await this.supabase
        .schema('marketing')
        .from('google_ads_conversion_uploads')
        .update({
          status: 'uploaded',
          uploaded_at: new Date().toISOString(),
          error_message: null
        })
        .in('booking_id', bookingIds);

      if (error) {
        logger.warn('Failed to batch update successful tracking records', {
          count: bookingIds.length,
          error: error.message
        });
      }
    } else {
      // For failures, use RPC to atomically increment retry_count
      // This avoids the read-then-write race condition
      const { error } = await this.supabase.rpc('increment_conversion_retry', {
        p_booking_ids: bookingIds,
        p_error_message: errorMessage || 'Unknown error'
      });

      if (error) {
        // Fallback: update without atomic increment if RPC doesn't exist.
        // Set retry_count to 3 (max) to prevent infinite retry loops.
        logger.warn('RPC increment_conversion_retry failed, using fallback', { error: error.message });
        const { error: fallbackError } = await this.supabase
          .schema('marketing')
          .from('google_ads_conversion_uploads')
          .update({
            status: 'failed',
            error_message: errorMessage,
            retry_count: 3
          })
          .in('booking_id', bookingIds);

        if (fallbackError) {
          logger.warn('Failed to batch update failed tracking records', {
            count: bookingIds.length,
            error: fallbackError.message
          });
        }
      }
    }
  }

  /**
   * Build hashed user identifiers for Enhanced Conversions for Leads.
   * Email: lowercase, trimmed, SHA-256 hashed
   * Phone: E.164 format, SHA-256 hashed
   */
  private buildUserIdentifiers(
    email: string | null,
    phone: string | null
  ): Array<{ hashedEmail?: string; hashedPhoneNumber?: string }> {
    const identifiers: Array<{ hashedEmail?: string; hashedPhoneNumber?: string }> = [];

    if (email) {
      const normalized = email.toLowerCase().trim();
      const hashed = createHash('sha256').update(normalized).digest('hex');
      identifiers.push({ hashedEmail: hashed });
    }

    if (phone) {
      const normalized = this.normalizePhoneToE164(phone);
      if (normalized) {
        const hashed = createHash('sha256').update(normalized).digest('hex');
        identifiers.push({ hashedPhoneNumber: hashed });
      }
    }

    return identifiers;
  }

  /**
   * Normalize phone number to E.164 format for Thailand.
   * Handles: +66xxx, 66xxx, 0xxx (Thai local) formats.
   */
  private normalizePhoneToE164(phone: string): string | null {
    // Strip whitespace, dashes, dots, parentheses
    let cleaned = phone.replace(/[\s\-\.\(\)]/g, '');

    // Already in E.164 with +
    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    // Thai local format: 0xx → +66xx
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return '+66' + cleaned.substring(1);
    }

    // Country code without +: 66xxx → +66xxx
    if (cleaned.startsWith('66') && cleaned.length === 11) {
      return '+' + cleaned;
    }

    // Ambiguous format - log and skip to avoid misattribution
    logger.debug('Could not normalize phone to E.164, skipping', { phone, cleaned });
    return null;
  }

  /**
   * Format conversion datetime for Google Ads API.
   * Expected: "yyyy-MM-dd HH:mm:ss+HH:mm" in Bangkok timezone.
   *
   * The view already outputs Bangkok local time (via AT TIME ZONE 'Asia/Bangkok'),
   * so we just need to reformat the string and append +07:00.
   */
  private formatConversionDateTime(conversionTime: string): string {
    // The input is already Bangkok local time from the view, e.g. "2025-11-16T08:13:46.763044"
    // Just parse the date/time parts and append the Bangkok offset
    const match = conversionTime.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (!match) {
      // Cannot safely parse - would produce wrong timezone offset
      logger.warn('Could not parse conversion_time', { conversionTime });
      throw new Error(`Unparseable conversion_time: ${conversionTime}`);
    }

    const [, year, month, day, hours, minutes, seconds] = match;
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+07:00`;
  }
}

export default GoogleAdsConversionUploader;
