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
  search_impression_share: number | null;
  search_lost_is_rank: number | null;
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

export interface GoogleAdsAdPerformance {
  ad_id: string;
  ad_group_id: string;
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  ctr: number;
  avg_cpc_micros: number;
  avg_cpm_micros: number;
  view_through_conversions: number;
  video_views: number;
  video_view_rate: number;
}

export interface GoogleAdsAssetPerformance {
  asset_id: string;
  asset_group_id?: string;
  campaign_id: string;
  asset_type: string;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  ctr: number;
  avg_cpc_micros: number;
  avg_cpm_micros: number;
  view_through_conversions: number;
}

export class GoogleAdsPerformanceExtractor {
  private customerId: string;

  constructor() {
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
      
      // Add modified since filter for incremental sync only when no specific dates provided
      if (modifiedSince && !startDate && !endDate) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      const gaql = `
        SELECT 
          campaign.id,
          ad_group.id,
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

      // Use GoogleAdsClient for proper token management
      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();
      const results = await adsClient.executeQuery(gaql);
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
        error: getErrorMessage(error),
        errorDetails: error && typeof error === 'object' ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : 'Not an object'
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
      
      if (modifiedSince && !startDate && !endDate) {
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

      // Use GoogleAdsClient for proper token management
      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();
      const results = await adsClient.executeQuery(gaql);
      const performanceData: GoogleAdsCampaignPerformance[] = [];

      for (const row of results) {
        const searchImpressionShare = row.metrics?.search_impression_share;
        const searchLostIsRank = row.metrics?.search_rank_lost_impression_share;

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
          avg_cpm_micros: parseInt(row.metrics?.average_cpm?.toString() || '0'),
          search_impression_share: searchImpressionShare != null ? parseFloat(searchImpressionShare.toString()) : null,
          search_lost_is_rank: searchLostIsRank != null ? parseFloat(searchLostIsRank.toString()) : null
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Google Ads campaign performance records`);
      return performanceData;

    } catch (error) {
      // Extract detailed Google Ads error information
      let detailedError = getErrorMessage(error);
      if (error && typeof error === 'object') {
        const errorObj = error as any;
        if (errorObj.errors && Array.isArray(errorObj.errors)) {
          detailedError = errorObj.errors.map((e: any) => 
            `${e.error_code ? Object.keys(e.error_code)[0] + ': ' : ''}${e.message}`
          ).join('; ');
        }
      }
      
      logger.error('Failed to extract Google Ads campaign performance', {
        error: detailedError,
        originalError: getErrorMessage(error),
        fullError: error
      });
      throw new Error(detailedError);
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
      
      if (modifiedSince && !startDate && !endDate) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      const gaql = `
        SELECT 
          campaign.id,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.view_through_conversions
        FROM campaign
        ${whereClause}
        ORDER BY segments.date DESC, campaign.id
      `;

      // Use GoogleAdsClient for proper token management
      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();
      const results = await adsClient.executeQuery(gaql);
      const performanceData: GoogleAdsPMaxPerformance[] = [];

      for (const row of results) {
        const data: GoogleAdsPMaxPerformance = {
          campaign_id: parseInt(row.campaign?.id?.toString() || '0'),
          asset_group_id: null, // Not available in this simplified query
          listing_group_id: null, // Not available in this simplified query
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
        error: getErrorMessage(error),
        errorDetails: error && typeof error === 'object' ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : 'Not an object'
      });
      throw error;
    }
  }


  async extractAdPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<GoogleAdsAdPerformance[]> {
    try {
      logger.info('Starting Google Ads ad performance extraction', {
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      // Use GoogleAdsClient for proper token management
      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();

      // Default to last 30 days if no dates specified
      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      let whereClause = `WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'`;
      
      // Only add modifiedSince filter if no explicit date range is provided
      if (modifiedSince && !startDate && !endDate) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      const gaql = `
        SELECT 
          ad_group_ad.ad.id,
          ad_group.id,
          campaign.id,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc,
          metrics.average_cpm,
          metrics.view_through_conversions,
          metrics.video_views,
          metrics.video_view_rate
        FROM ad_group_ad 
        ${whereClause}
        AND ad_group_ad.status != 'REMOVED'
        ORDER BY segments.date DESC
      `;

      logger.debug('Executing Google Ads ad performance query', {
        query: gaql.substring(0, 200) + '...',
        dateRange: `${formattedStartDate} to ${formattedEndDate}`
      });

      const rows = await adsClient.executeQuery(gaql);
      
      logger.debug(`Google Ads API returned ${rows.length} ad performance records`);

      const performanceData: GoogleAdsAdPerformance[] = [];
      const uniqueKeys = new Set<string>();

      for (const row of rows) {
        const adId = row.adGroupAd?.ad?.id?.toString() || '';
        const adGroupId = row.adGroup?.id?.toString() || '';
        const campaignId = row.campaign?.id?.toString() || '';
        const date = row.segments?.date || '';
        
        // Create unique key for deduplication
        const uniqueKey = `${adId}:${date}`;
        
        // Skip records with missing required fields
        if (!adId || !adGroupId || !campaignId || !date) {
          logger.warn('Skipping Google ad performance record with missing required fields', {
            ad_id: adId,
            ad_group_id: adGroupId,
            campaign_id: campaignId,
            date
          });
          continue;
        }
        
        // Skip duplicates
        if (uniqueKeys.has(uniqueKey)) {
          continue;
        }
        
        uniqueKeys.add(uniqueKey);

        const data: GoogleAdsAdPerformance = {
          ad_id: adId,
          ad_group_id: adGroupId,
          campaign_id: campaignId,
          date,
          impressions: parseInt(row.metrics?.impressions?.toString() || '0'),
          clicks: parseInt(row.metrics?.clicks?.toString() || '0'),
          cost_micros: parseInt(row.metrics?.cost_micros?.toString() || '0'),
          conversions: parseFloat(row.metrics?.conversions?.toString() || '0'),
          conversion_value_micros: parseInt(row.metrics?.conversions_value?.toString() || '0'),
          ctr: parseFloat(row.metrics?.ctr?.toString() || '0'),
          avg_cpc_micros: parseInt(row.metrics?.average_cpc?.toString() || '0'),
          avg_cpm_micros: parseInt(row.metrics?.average_cpm?.toString() || '0'),
          view_through_conversions: parseFloat(row.metrics?.view_through_conversions?.toString() || '0'),
          video_views: parseInt(row.metrics?.video_views?.toString() || '0'),
          video_view_rate: parseFloat(row.metrics?.video_view_rate?.toString() || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Google ad performance records`, {
        dateRange: `${formattedStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Google ad performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async extractAssetPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<GoogleAdsAssetPerformance[]> {
    try {
      logger.info('Starting Google Ads asset performance extraction', {
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      // Use GoogleAdsClient for proper token management
      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();

      // Default to last 30 days if no dates specified
      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      let whereClause = `WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'`;
      
      // Only add modifiedSince filter if no explicit date range is provided
      if (modifiedSince && !startDate && !endDate) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      // Query for Performance Max asset performance
      // Note: Some metrics like average_cpm are not compatible with ASSET_GROUP_ASSET resource
      const gaql = `
        SELECT 
          asset_group_asset.asset,
          asset_group.id,
          campaign.id,
          asset.type,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc,
          metrics.view_through_conversions
        FROM asset_group_asset 
        ${whereClause}
        AND asset_group_asset.status != 'REMOVED'
        AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        ORDER BY segments.date DESC
      `;

      logger.debug('Executing Google Ads asset performance query', {
        query: gaql.substring(0, 200) + '...',
        dateRange: `${formattedStartDate} to ${formattedEndDate}`
      });

      const rows = await adsClient.executeQuery(gaql);
      
      logger.debug(`Google Ads API returned ${rows.length} asset performance records`);

      const performanceData: GoogleAdsAssetPerformance[] = [];
      const uniqueKeys = new Set<string>();

      for (const row of rows) {
        const assetId = row.assetGroupAsset?.asset?.split('/').pop() || '';
        const assetGroupId = row.assetGroup?.id?.toString() || '';
        const campaignId = row.campaign?.id?.toString() || '';
        const assetType = row.asset?.type || '';
        const date = row.segments?.date || '';
        
        // Create unique key for deduplication
        const uniqueKey = `${assetId}:${date}`;
        
        // Skip records with missing required fields
        if (!assetId || !campaignId || !date) {
          logger.warn('Skipping Google asset performance record with missing required fields', {
            asset_id: assetId,
            asset_group_id: assetGroupId,
            campaign_id: campaignId,
            asset_type: assetType,
            date
          });
          continue;
        }
        
        // Skip duplicates
        if (uniqueKeys.has(uniqueKey)) {
          continue;
        }
        
        uniqueKeys.add(uniqueKey);

        const data: GoogleAdsAssetPerformance = {
          asset_id: assetId,
          asset_group_id: assetGroupId,
          campaign_id: campaignId,
          asset_type: assetType.toLowerCase(),
          date,
          impressions: parseInt(row.metrics?.impressions?.toString() || '0'),
          clicks: parseInt(row.metrics?.clicks?.toString() || '0'),
          cost_micros: parseInt(row.metrics?.cost_micros?.toString() || '0'),
          conversions: parseFloat(row.metrics?.conversions?.toString() || '0'),
          conversion_value_micros: parseInt(row.metrics?.conversions_value?.toString() || '0'),
          ctr: parseFloat(row.metrics?.ctr?.toString() || '0'),
          avg_cpc_micros: parseInt(row.metrics?.average_cpc?.toString() || '0'),
          avg_cpm_micros: 0, // Not available for ASSET_GROUP_ASSET resource
          view_through_conversions: parseFloat(row.metrics?.view_through_conversions?.toString() || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Google asset performance records`, {
        dateRange: `${formattedStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Google asset performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Use GoogleAdsClient for proper token management
      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();
      
      // Simple test query to verify connection
      const results = await adsClient.executeQuery(`
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