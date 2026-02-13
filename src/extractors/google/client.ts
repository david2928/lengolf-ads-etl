import { GoogleAdsApi, Customer } from 'google-ads-api';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';
import TokenManager from '@/auth/token-manager';
import { getErrorMessage, getErrorDetails } from '@/utils/error-handler';

export class GoogleAdsClient {
  private client!: GoogleAdsApi;
  private customer!: Customer;
  private tokenManager: TokenManager;
  private initialized: boolean = false;

  constructor() {
    this.tokenManager = new TokenManager();
    // Don't initialize immediately - wait until first use
  }

  private async initializeClient(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Get refresh token for Google Ads API (it handles token refresh internally)
      const tokenInfo = await this.tokenManager.getTokenInfo('google');
      
      if (!tokenInfo || !tokenInfo.refresh_token) {
        throw new Error('Google refresh token not found. Please set up OAuth tokens.');
      }

      logger.info('Token info retrieved for Google Ads', {
        hasRefreshToken: !!tokenInfo.refresh_token,
        tokenType: tokenInfo.token_type,
        scope: tokenInfo.scope,
        expiresAt: tokenInfo.expires_at,
        refreshTokenPrefix: tokenInfo.refresh_token?.substring(0, 6) + '***'
      });

      // Initialize Google Ads API client
      logger.info('Initializing Google Ads API client', {
        clientId: appConfig.googleClientId?.substring(0, 20) + '...',
        hasClientSecret: !!appConfig.googleClientSecret,
        hasDeveloperToken: !!appConfig.googleDeveloperToken,
        customerId: appConfig.googleCustomerId
      });

      this.client = new GoogleAdsApi({
        client_id: appConfig.googleClientId,
        client_secret: appConfig.googleClientSecret,
        developer_token: appConfig.googleDeveloperToken
      });

      // Set up customer with refresh token (Google Ads API manages access token internally)
      this.customer = this.client.Customer({
        customer_id: appConfig.googleCustomerId,
        refresh_token: tokenInfo.refresh_token
      });

      logger.info('Google Ads client initialized successfully', {
        customerId: appConfig.googleCustomerId
      });
      
      this.initialized = true;

    } catch (error) {
      logger.error('Failed to initialize Google Ads client', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async executeQuery(query: string, options?: any): Promise<any[]> {
    try {
      // Ensure client is initialized
      if (!this.customer) {
        await this.initializeClient();
      }

      logger.debug('Executing Google Ads query', { 
        query: query.substring(0, 100) + '...',
        options 
      });

      const results = await this.customer.query(query, options);
      
      logger.info('Google Ads query executed successfully', {
        resultCount: results.length,
        query: query.substring(0, 50) + '...'
      });

      return results;

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      
      // Extract more detailed Google Ads error information
      let detailedError = errorMessage;
      if (error && typeof error === 'object') {
        const errorObj = error as any;
        if (errorObj.errors && Array.isArray(errorObj.errors)) {
          // Google Ads API error format
          detailedError = errorObj.errors.map((e: any) => 
            `${e.error_code ? Object.keys(e.error_code)[0] + ': ' : ''}${e.message}`
          ).join('; ');
        } else if (errorObj.details) {
          detailedError = errorObj.details;
        }
      }
      
      logger.error('Google Ads query failed', { 
        error: detailedError,
        originalError: errorMessage,
        fullError: error,
        query: query.substring(0, 100) + '...'
      });

      // If authentication error, try to refresh token and retry once
      if (errorMessage.includes('AUTHENTICATION_ERROR') || 
          errorMessage.includes('UNAUTHENTICATED') ||
          errorMessage.includes('invalid_grant') ||
          errorMessage.includes('unauthorized_client')) {
        logger.info('Authentication error detected, attempting to reinitialize client...', { 
          errorType: errorMessage.substring(0, 100) 
        });
        try {
          // Force reinitialization
          this.initialized = false;
          await this.initializeClient();
          const results = await this.customer.query(query, options);
          logger.info('Query succeeded after client reinitialization');
          return results;
        } catch (retryError) {
          logger.error('Query failed even after client reinitialization', { 
            error: getErrorMessage(retryError),
            originalError: errorMessage 
          });
          throw retryError;
        }
      }

      throw error;
    }
  }

  async getCampaigns(modifiedSince?: Date): Promise<any[]> {
    // For campaign metadata, we don't need segments.date - just filter by campaign status
    // The modifiedSince parameter is handled differently in v21+ API
    const whereClause = `WHERE campaign.status != 'REMOVED'`;

    const query = `
      SELECT 
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date,
        campaign.campaign_budget,
        campaign.bidding_strategy_type,
        campaign.target_cpa.target_cpa_micros,
        campaign.target_roas.target_roas,
        campaign.maximize_conversions.target_cpa_micros
      FROM campaign 
      ${whereClause}
      ORDER BY campaign.name
    `;

    return this.executeQuery(query);
  }

  async getAdGroups(campaignIds?: string[], modifiedSince?: Date): Promise<any[]> {
    let whereClause = `WHERE ad_group.status != 'REMOVED'`;
    
    if (campaignIds && campaignIds.length > 0) {
      const campaignFilter = campaignIds.map(id => `'customers/${appConfig.googleCustomerId}/campaigns/${id}'`).join(',');
      whereClause += ` AND campaign.resource_name IN (${campaignFilter})`;
    }
    
    // Remove segments.date filter for v21 API
    const query = `
      SELECT 
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group.cpm_bid_micros,
        ad_group.cpc_bid_micros,
        ad_group.percent_cpc_bid_micros,
        campaign.id
      FROM ad_group 
      ${whereClause}
      ORDER BY campaign.id, ad_group.name
    `;

    return this.executeQuery(query);
  }

  async getAds(adGroupIds?: string[], modifiedSince?: Date): Promise<any[]> {
    let whereClause = `WHERE ad_group_ad.status != 'REMOVED'`;
    
    if (adGroupIds && adGroupIds.length > 0) {
      const adGroupFilter = adGroupIds.map(id => `'customers/${appConfig.googleCustomerId}/adGroups/${id}'`).join(',');
      whereClause += ` AND ad_group.resource_name IN (${adGroupFilter})`;
    }
    
    const query = `
      SELECT 
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.status,
        ad_group_ad.ad.type,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.final_mobile_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group.id,
        campaign.id
      FROM ad_group_ad 
      ${whereClause}
      ORDER BY campaign.id, ad_group.id, ad_group_ad.ad.name
    `;

    return this.executeQuery(query);
  }

  async getKeywords(adGroupIds?: string[], modifiedSince?: Date): Promise<any[]> {
    let whereClause = `WHERE ad_group_criterion.status IN ('ENABLED', 'PAUSED') AND ad_group_criterion.type = 'KEYWORD'`;
    
    if (adGroupIds && adGroupIds.length > 0) {
      const adGroupFilter = adGroupIds.map(id => `'customers/${appConfig.googleCustomerId}/adGroups/${id}'`).join(',');
      whereClause += ` AND ad_group.resource_name IN (${adGroupFilter})`;
    }
    
    // Note: Keywords are entity metadata, not time-series data, so no date filter needed

    const query = `
      SELECT 
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group_criterion.position_estimates.first_page_cpc_micros,
        ad_group_criterion.position_estimates.top_of_page_cpc_micros,
        ad_group_criterion.bid_modifier,
        ad_group_criterion.cpc_bid_micros,
        ad_group.id,
        campaign.id
      FROM keyword_view 
      ${whereClause}
      ORDER BY campaign.id, ad_group.id, ad_group_criterion.keyword.text
    `;

    return this.executeQuery(query);
  }

  async getAssets(assetIds: string[]): Promise<any[]> {
    if (!assetIds.length) return [];

    const assetFilter = assetIds.map(id => `'customers/${appConfig.googleCustomerId}/assets/${id}'`).join(',');
    
    const query = `
      SELECT 
        asset.id,
        asset.name,
        asset.type,
        asset.image_asset.full_size_image_url,
        asset.image_asset.thumbnail_image_url,
        asset.image_asset.full_size_image.width,
        asset.image_asset.full_size_image.height,
        asset.image_asset.full_size_image.size_bytes,
        asset.image_asset.mime_type,
        asset.video_asset.youtube_video_id,
        asset.video_asset.youtube_video_title,
        asset.text_asset.text,
        asset.policy_validation_parameter.policy_topic_entries,
        asset.policy_validation_parameter.policy_validation_parameter_ignorability_type
      FROM asset 
      WHERE asset.resource_name IN (${assetFilter})
    `;

    return this.executeQuery(query);
  }

  async getPerformanceData(
    level: 'campaign' | 'ad_group' | 'ad' | 'keyword',
    startDate: string,
    endDate: string,
    entityIds?: string[]
  ): Promise<any[]> {
    const segments = 'segments.date';
    let fromClause = '';
    let selectClause = '';
    let whereClause = `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    switch (level) {
      case 'campaign':
        fromClause = 'campaign';
        selectClause = 'campaign.id';
        if (entityIds?.length) {
          const filter = entityIds.map(id => `'customers/${appConfig.googleCustomerId}/campaigns/${id}'`).join(',');
          whereClause += ` AND campaign.resource_name IN (${filter})`;
        }
        break;
      
      case 'ad_group':
        fromClause = 'ad_group';
        selectClause = 'ad_group.id, campaign.id';
        if (entityIds?.length) {
          const filter = entityIds.map(id => `'customers/${appConfig.googleCustomerId}/adGroups/${id}'`).join(',');
          whereClause += ` AND ad_group.resource_name IN (${filter})`;
        }
        break;
      
      case 'ad':
        fromClause = 'ad';
        selectClause = 'ad.id, ad_group.id, campaign.id';
        if (entityIds?.length) {
          const filter = entityIds.map(id => `'customers/${appConfig.googleCustomerId}/ads/${id}'`).join(',');
          whereClause += ` AND ad.resource_name IN (${filter})`;
        }
        break;
      
      case 'keyword':
        fromClause = 'keyword_view';
        selectClause = 'ad_group_criterion.criterion_id, ad_group.id, campaign.id';
        whereClause += ` AND ad_group_criterion.type = 'KEYWORD'`;
        if (entityIds?.length) {
          const filter = entityIds.map(id => `'customers/${appConfig.googleCustomerId}/adGroupCriteria/${id}'`).join(',');
          whereClause += ` AND ad_group_criterion.resource_name IN (${filter})`;
        }
        break;
    }

    const query = `
      SELECT 
        ${segments},
        ${selectClause},
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.view_through_conversions,
        metrics.ctr,
        metrics.average_cpc,
        metrics.average_cpm,
        metrics.search_impression_share,
        metrics.search_rank_lost_impression_share,
        metrics.quality_score
      FROM ${fromClause} 
      ${whereClause}
      ORDER BY segments.date DESC
    `;

    return this.executeQuery(query);
  }

  /**
   * Upload Enhanced Conversions for Leads to Google Ads via the library's
   * native gRPC-based ConversionUploadService.
   *
   * Uses hashed user identifiers (email/phone) instead of GCLID.
   * Docs: https://developers.google.com/google-ads/api/docs/conversions/upload-clicks
   */
  async uploadEnhancedConversions(
    customerId: string,
    conversions: any[]
  ): Promise<{
    results: Array<{ success: boolean; error?: string }>;
    successCount: number;
    failureCount: number;
  }> {
    if (!this.customer) {
      await this.initializeClient();
    }

    try {
      logger.info('Uploading enhanced conversions via gRPC', {
        conversionCount: conversions.length,
        customerId
      });

      // Convert from our camelCase format to the library's snake_case format
      const grpcConversions = conversions.map(conv => ({
        conversion_action: conv.conversionAction,
        conversion_date_time: conv.conversionDateTime,
        conversion_value: conv.conversionValue,
        currency_code: conv.currencyCode,
        consent: {
          ad_user_data: 2,  // GRANTED
          ad_personalization: 2  // GRANTED
        },
        user_identifiers: conv.userIdentifiers.map((id: any) => {
          if (id.hashedEmail) return { hashed_email: id.hashedEmail };
          if (id.hashedPhoneNumber) return { hashed_phone_number: id.hashedPhoneNumber };
          return id;
        })
      }));

      const response = await this.customer.conversionUploads.uploadClickConversions({
        customer_id: customerId,
        conversions: grpcConversions,
        partial_failure: true
      } as any) as any;

      // Parse results
      const results: Array<{ success: boolean; error?: string }> = [];
      let successCount = 0;
      let failureCount = 0;

      if (response.partial_failure_error) {
        // Some conversions failed
        logger.warn('Partial failure in conversion upload', {
          partialFailureError: response.partial_failure_error
        });

        const failedIndices = new Set<number>();
        const details = response.partial_failure_error?.details || [];
        details.forEach((detail: any) => {
          const errors = detail?.errors || [];
          errors.forEach((err: any) => {
            const fieldPath = err?.location?.field_path_elements || [];
            const convIdx = fieldPath.find((fp: any) => fp.field_name === 'conversions');
            if (convIdx?.index !== undefined) {
              failedIndices.add(convIdx.index);
            }
          });
        });

        for (let i = 0; i < conversions.length; i++) {
          if (failedIndices.has(i)) {
            results.push({ success: false, error: 'Partial failure' });
            failureCount++;
          } else {
            results.push({ success: true });
            successCount++;
          }
        }
      } else {
        // All succeeded
        successCount = conversions.length;
        for (let i = 0; i < conversions.length; i++) {
          results.push({ success: true });
        }
      }

      logger.info('Enhanced conversion upload results', {
        successCount,
        failureCount,
        jobId: response.job_id,
        totalResults: results.length
      });

      return { results, successCount, failureCount };

    } catch (error) {
      logger.error('Failed to upload enhanced conversions', {
        error: getErrorMessage(error),
        conversionCount: conversions.length
      });
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const testQuery = `
        SELECT customer.id 
        FROM customer 
        LIMIT 1
      `;
      
      await this.executeQuery(testQuery);
      logger.info('Google Ads connection test successful');
      return true;

    } catch (error) {
      logger.error('Google Ads connection test failed', { error: getErrorMessage(error) });
      return false;
    }
  }
}

export default GoogleAdsClient;