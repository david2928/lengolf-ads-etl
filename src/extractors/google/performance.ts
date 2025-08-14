import { GoogleAdsApi } from 'google-ads-api';
import logger from '@/utils/logger';
import { appConfig } from '@/utils/config';
import { getErrorMessage } from '@/utils/error-handler';

export interface GoogleAdsKeywordPerformance {
  keyword_id: number;
  campaign_id: number;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  ctr: number;
  avg_cpc_micros: number;
  quality_score: number;
}

export interface GoogleAdsCampaignPerformance {
  campaign_id: number;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  ctr: number;
  avg_cpc_micros: number;
  avg_cpm_micros: number;
}

export interface GoogleAdsPMaxPerformance {
  campaign_id: number;
  asset_group_id: number | null;
  listing_group_id: number | null;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  view_through_conversions: number;
}

export class GoogleAdsPerformanceExtractor {
  private client: GoogleAdsApi;
  private customerId: string;

  constructor() {
    this.client = new GoogleAdsApi({
      client_id: appConfig.googleClientId,
      client_secret: appConfig.googleClientSecret,
      developer_token: appConfig.googleDeveloperToken
    });
    this.customerId = appConfig.googleCustomerId;
  }

  async extractKeywordPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<GoogleAdsKeywordPerformance[]> {
    try {
      logger.info('Starting Google Ads keyword performance extraction', {
        customerId: this.customerId,
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      // Default to last 30 days if no dates specified
      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      let whereClause = `WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'`;
      
      // Add modified since filter for incremental sync
      if (modifiedSince) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      const gaql = `
        SELECT 
          campaign.id,
          ad_group_criterion.criterion_id,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc,
          ad_group_criterion.quality_info.quality_score
        FROM keyword_view
        ${whereClause}
        ORDER BY segments.date DESC, campaign.id, ad_group.id, ad_group_criterion.criterion_id
      `;

      logger.debug('Executing GAQL query', { gaql: gaql.trim() });

      const customer = this.client.Customer({
        customer_id: this.customerId,
        refresh_token: await this.getRefreshToken()
      });

      const results = await customer.query(gaql);
      const performanceData: GoogleAdsKeywordPerformance[] = [];

      for (const row of results) {
        const data: GoogleAdsKeywordPerformance = {
          keyword_id: parseInt(row.ad_group_criterion?.criterion_id?.toString() || '0'),
          campaign_id: parseInt(row.campaign?.id?.toString() || '0'),
          date: row.segments?.date || '',
          impressions: parseInt(row.metrics?.impressions?.toString() || '0'),
          clicks: parseInt(row.metrics?.clicks?.toString() || '0'),
          cost_micros: parseInt(row.metrics?.cost_micros?.toString() || '0'),
          conversions: parseFloat(row.metrics?.conversions?.toString() || '0'),
          conversion_value_micros: parseInt(row.metrics?.conversions_value?.toString() || '0'),
          ctr: parseFloat(row.metrics?.ctr?.toString() || '0'),
          avg_cpc_micros: parseInt(row.metrics?.average_cpc?.toString() || '0'),
          quality_score: parseFloat(row.ad_group_criterion?.quality_info?.quality_score?.toString() || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Google Ads keyword performance records`, {
        dateRange: `${formattedStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Google Ads keyword performance', {
        customerId: this.customerId,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async extractCampaignPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<GoogleAdsCampaignPerformance[]> {
    try {
      logger.info('Starting Google Ads campaign performance extraction');

      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      let whereClause = `WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'`;
      
      if (modifiedSince) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      const gaql = `
        SELECT 
          campaign.id,
          campaign.name,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc,
          metrics.average_cpm,
          metrics.search_impression_share,
          metrics.search_rank_lost_impression_share
        FROM campaign
        ${whereClause}
        ORDER BY segments.date DESC, campaign.id
      `;

      const customer = this.client.Customer({
        customer_id: this.customerId,
        refresh_token: await this.getRefreshToken()
      });

      const results = await customer.query(gaql);
      const performanceData: GoogleAdsCampaignPerformance[] = [];

      for (const row of results) {
        const data: GoogleAdsCampaignPerformance = {
          campaign_id: parseInt(row.campaign?.id?.toString() || '0'),
          date: row.segments?.date || '',
          impressions: parseInt(row.metrics?.impressions?.toString() || '0'),
          clicks: parseInt(row.metrics?.clicks?.toString() || '0'),
          cost_micros: parseInt(row.metrics?.cost_micros?.toString() || '0'),
          conversions: parseFloat(row.metrics?.conversions?.toString() || '0'),
          conversion_value_micros: parseInt(row.metrics?.conversions_value?.toString() || '0'),
          ctr: parseFloat(row.metrics?.ctr?.toString() || '0'),
          avg_cpc_micros: parseInt(row.metrics?.average_cpc?.toString() || '0'),
          avg_cpm_micros: parseInt(row.metrics?.average_cpm?.toString() || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Google Ads campaign performance records`);
      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Google Ads campaign performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async extractPMaxPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<GoogleAdsPMaxPerformance[]> {
    try {
      logger.info('Starting Google Ads Performance Max performance extraction');

      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      let whereClause = `WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}' AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'`;
      
      if (modifiedSince) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      const gaql = `
        SELECT 
          campaign.id,
          asset_group.id,
          shopping_performance_view.listing_group_id,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.view_through_conversions
        FROM shopping_performance_view
        ${whereClause}
        ORDER BY segments.date DESC, campaign.id
      `;

      const customer = this.client.Customer({
        customer_id: this.customerId,
        refresh_token: await this.getRefreshToken()
      });

      const results = await customer.query(gaql);
      const performanceData: GoogleAdsPMaxPerformance[] = [];

      for (const row of results) {
        const data: GoogleAdsPMaxPerformance = {
          campaign_id: parseInt(row.campaign?.id?.toString() || '0'),
          asset_group_id: row.asset_group?.id ? parseInt(row.asset_group.id.toString()) : null,
          listing_group_id: row.shopping_performance_view?.listing_group_id ? parseInt(row.shopping_performance_view.listing_group_id.toString()) : null,
          date: row.segments?.date || '',
          impressions: parseInt(row.metrics?.impressions?.toString() || '0'),
          clicks: parseInt(row.metrics?.clicks?.toString() || '0'),
          cost_micros: parseInt(row.metrics?.cost_micros?.toString() || '0'),
          conversions: parseFloat(row.metrics?.conversions?.toString() || '0'),
          conversion_value_micros: parseInt(row.metrics?.conversions_value?.toString() || '0'),
          view_through_conversions: parseFloat(row.metrics?.view_through_conversions?.toString() || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Google Ads Performance Max performance records`);
      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Google Ads Performance Max performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  private async getRefreshToken(): Promise<string> {
    // This should integrate with TokenManager to get current refresh token
    const TokenManager = (await import('@/auth/token-manager')).default;
    const tokenManager = new TokenManager();
    const tokenInfo = await tokenManager.getTokenInfo('google');
    
    if (!tokenInfo?.refresh_token) {
      throw new Error('Google refresh token not found');
    }
    
    return tokenInfo.refresh_token;
  }

  async testConnection(): Promise<boolean> {
    try {
      const customer = this.client.Customer({
        customer_id: this.customerId,
        refresh_token: await this.getRefreshToken()
      });

      // Simple test query to verify connection
      const results = await customer.query(`
        SELECT customer.id, customer.descriptive_name 
        FROM customer 
        LIMIT 1
      `);

      logger.info('Google Ads performance connection test successful', {
        customerId: this.customerId,
        customerName: results[0]?.customer?.descriptive_name
      });

      return true;
    } catch (error) {
      logger.error('Google Ads performance connection test failed', {
        error: getErrorMessage(error)
      });
      return false;
    }
  }
}

export default GoogleAdsPerformanceExtractor;