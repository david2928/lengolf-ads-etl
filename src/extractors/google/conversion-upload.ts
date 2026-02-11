import logger from '@/utils/logger';
import { appConfig } from '@/utils/config';
import { getErrorMessage } from '@/utils/error-handler';

export interface OfflineConversion {
  gclid: string;
  conversion_action: string;
  conversion_date_time: string; // Format: yyyy-MM-dd HH:mm:ss+HH:mm
  conversion_value: number;
  currency_code: string;
  booking_id: string;
}

export interface ConversionUploadResult {
  total: number;
  uploaded: number;
  failed: number;
  errors: string[];
}

export class GoogleAdsConversionUploader {
  private customerId: string;

  constructor() {
    this.customerId = appConfig.googleCustomerId;
  }

  /**
   * Upload offline conversions to Google Ads.
   * Uses the Google Ads API OfflineUserDataJobService or ConversionUploadService.
   *
   * For now, this prepares the conversion data and uploads via the API.
   * The actual API call requires a conversion action resource name which
   * needs to be configured per account.
   */
  async uploadConversions(
    conversions: OfflineConversion[],
    conversionActionResourceName: string
  ): Promise<ConversionUploadResult> {
    const result: ConversionUploadResult = {
      total: conversions.length,
      uploaded: 0,
      failed: 0,
      errors: []
    };

    if (conversions.length === 0) {
      logger.info('No conversions to upload');
      return result;
    }

    try {
      logger.info('Starting offline conversion upload', {
        customerId: this.customerId,
        conversionCount: conversions.length,
        conversionAction: conversionActionResourceName
      });

      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();

      // Format conversions for the API
      const clickConversions = conversions.map(conv => ({
        gclid: conv.gclid,
        conversion_action: conversionActionResourceName,
        conversion_date_time: conv.conversion_date_time,
        conversion_value: conv.conversion_value,
        currency_code: conv.currency_code
      }));

      // Upload in batches of 2000 (API limit)
      const batchSize = 2000;
      for (let i = 0; i < clickConversions.length; i += batchSize) {
        const batch = clickConversions.slice(i, i + batchSize);

        try {
          // The actual upload uses the ConversionUploadService
          // This requires the google-ads-api library to support uploadClickConversions
          await adsClient.uploadClickConversions(this.customerId, batch);
          result.uploaded += batch.length;

          logger.info(`Uploaded batch of ${batch.length} conversions`, {
            batchStart: i,
            totalUploaded: result.uploaded
          });
        } catch (batchError) {
          result.failed += batch.length;
          const errorMsg = getErrorMessage(batchError);
          result.errors.push(`Batch ${i}-${i + batch.length}: ${errorMsg}`);

          logger.error('Failed to upload conversion batch', {
            batchStart: i,
            batchSize: batch.length,
            error: errorMsg
          });
        }
      }

      logger.info('Offline conversion upload completed', {
        total: result.total,
        uploaded: result.uploaded,
        failed: result.failed
      });

      return result;

    } catch (error) {
      logger.error('Failed to upload offline conversions', {
        error: getErrorMessage(error)
      });

      result.failed = conversions.length;
      result.errors.push(getErrorMessage(error));
      return result;
    }
  }
}

export default GoogleAdsConversionUploader;
