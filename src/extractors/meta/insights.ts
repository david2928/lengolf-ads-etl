import MetaAdsClient from './client';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';

export interface MetaCampaignPerformance {
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  conversion_value_cents: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  reach: number;
  frequency: number;
  unique_clicks: number;
  cost_per_unique_click_cents: number;
}

export interface MetaAdsetPerformance {
  adset_id: string;
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  conversion_value_cents: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  reach: number;
  frequency: number;
}

export interface MetaAdPerformance {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  conversion_value_cents: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  reach: number;
  frequency: number;
  unique_clicks: number;
  cost_per_unique_click_cents: number;
  video_views: number;
  video_view_rate: number;
}

export interface MetaCreativePerformance {
  creative_id: string;
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  conversion_value_cents: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  reach: number;
  frequency: number;
  unique_clicks: number;
  cost_per_unique_click_cents: number;
}

export class MetaAdsInsightsExtractor {
  private client: MetaAdsClient;

  constructor() {
    this.client = new MetaAdsClient();
  }

  async extractCampaignPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<MetaCampaignPerformance[]> {
    try {
      logger.info('Starting Meta Ads campaign performance extraction', {
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      // Default to last 30 days if no dates specified
      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      // Use modifiedSince only if no explicit startDate provided (true incremental sync)
      const actualStartDate = !startDate && modifiedSince 
        ? modifiedSince.toISOString().split('T')[0]
        : formattedStartDate;

      const insights = await this.client.getInsights(
        'campaign',
        undefined, // Get all campaigns - Meta API will automatically include all campaigns
        actualStartDate,
        formattedEndDate
      );
      
      logger.debug(`Meta API returned ${insights.length} campaign insight records`, {
        sampleRecord: insights[0] ? {
          campaign_id: insights[0].campaign_id,
          date_start: insights[0].date_start,
          date_stop: insights[0].date_stop,
          spend: insights[0].spend
        } : 'No records'
      });

      const performanceData: MetaCampaignPerformance[] = [];
      const uniqueKeys = new Set<string>();

      for (const insight of insights) {
        const campaignId = insight.campaign_id || '';
        const date = insight.date_start || '';
        
        // Create unique key for deduplication
        const uniqueKey = `${campaignId}:${date}`;
        
        // Skip records with missing required fields
        if (!campaignId || !date) {
          logger.warn('Skipping Meta campaign performance record with missing required fields', {
            campaign_id: campaignId,
            date,
            hasValidCampaignId: !!campaignId,
            hasValidDate: !!date
          });
          continue;
        }
        
        // Skip duplicates
        if (uniqueKeys.has(uniqueKey)) {
          logger.warn('Skipping duplicate Meta campaign performance record', {
            campaign_id: campaignId,
            date,
            uniqueKey
          });
          continue;
        }
        
        uniqueKeys.add(uniqueKey);

        const data: MetaCampaignPerformance = {
          campaign_id: campaignId,
          date,
          impressions: parseInt(insight.impressions || '0'),
          clicks: parseInt(insight.clicks || '0'),
          spend_cents: Math.round((parseFloat(insight.spend || '0')) * 100),
          conversions: parseFloat(insight.conversions || '0'),
          conversion_value_cents: Math.round((parseFloat(insight.conversion_values || '0')) * 100),
          ctr: parseFloat(insight.ctr || '0'),
          cpc_cents: Math.round((parseFloat(insight.cpc || '0')) * 100),
          cpm_cents: Math.round((parseFloat(insight.cpm || '0')) * 100),
          reach: parseInt(insight.reach || '0'),
          frequency: parseFloat(insight.frequency || '0'),
          unique_clicks: parseInt(insight.unique_clicks || '0'),
          cost_per_unique_click_cents: Math.round((parseFloat(insight.cost_per_unique_click || '0')) * 100)
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Meta campaign performance records`, {
        dateRange: `${actualStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length,
        rawInsightsCount: insights.length,
        deduplicatedCount: performanceData.length,
        duplicatesSkipped: insights.length - performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Meta campaign performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async extractAdsetPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<MetaAdsetPerformance[]> {
    try {
      logger.info('Starting Meta Ads adset performance extraction', {
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      const actualStartDate = !startDate && modifiedSince 
        ? modifiedSince.toISOString().split('T')[0]
        : formattedStartDate;

      const insights = await this.client.getInsights(
        'adset',
        undefined, // Get all adsets - Meta API will automatically include all adsets
        actualStartDate,
        formattedEndDate
      );
      
      logger.debug(`Meta API returned ${insights.length} adset insight records`, {
        sampleRecord: insights[0] ? {
          adset_id: insights[0].adset_id,
          campaign_id: insights[0].campaign_id,
          date_start: insights[0].date_start,
          date_stop: insights[0].date_stop,
          spend: insights[0].spend
        } : 'No records'
      });

      const performanceData: MetaAdsetPerformance[] = [];
      const uniqueKeys = new Set<string>();

      for (const insight of insights) {
        const adsetId = insight.adset_id || '';
        const campaignId = insight.campaign_id || '';
        const date = insight.date_start || '';
        
        // Create unique key for deduplication
        const uniqueKey = `${adsetId}:${date}`;
        
        // Skip records with missing required fields
        if (!adsetId || !date) {
          logger.warn('Skipping Meta adset performance record with missing required fields', {
            adset_id: adsetId,
            campaign_id: campaignId,
            date,
            hasValidAdsetId: !!adsetId,
            hasValidDate: !!date
          });
          continue;
        }
        
        // Skip duplicates
        if (uniqueKeys.has(uniqueKey)) {
          logger.warn('Skipping duplicate Meta adset performance record', {
            adset_id: adsetId,
            campaign_id: campaignId,
            date,
            uniqueKey
          });
          continue;
        }
        
        uniqueKeys.add(uniqueKey);

        const data: MetaAdsetPerformance = {
          adset_id: adsetId,
          campaign_id: campaignId,
          date,
          impressions: parseInt(insight.impressions || '0'),
          clicks: parseInt(insight.clicks || '0'),
          spend_cents: Math.round((parseFloat(insight.spend || '0')) * 100),
          conversions: parseFloat(insight.conversions || '0'),
          conversion_value_cents: Math.round((parseFloat(insight.conversion_values || '0')) * 100),
          ctr: parseFloat(insight.ctr || '0'),
          cpc_cents: Math.round((parseFloat(insight.cpc || '0')) * 100),
          cpm_cents: Math.round((parseFloat(insight.cpm || '0')) * 100),
          reach: parseInt(insight.reach || '0'),
          frequency: parseFloat(insight.frequency || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Meta adset performance records`, {
        dateRange: `${actualStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length,
        rawInsightsCount: insights.length,
        deduplicatedCount: performanceData.length,
        duplicatesSkipped: insights.length - performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Meta adset performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async extractAdPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<MetaAdPerformance[]> {
    try {
      logger.info('Starting Meta Ads ad performance extraction', {
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      const actualStartDate = !startDate && modifiedSince 
        ? modifiedSince.toISOString().split('T')[0]
        : formattedStartDate;

      const insights = await this.client.getInsights(
        'ad',
        undefined, // Get all ads - Meta API will automatically include all ads
        actualStartDate,
        formattedEndDate
      );
      
      logger.debug(`Meta API returned ${insights.length} ad insight records`, {
        sampleRecord: insights[0] ? {
          ad_id: insights[0].ad_id,
          adset_id: insights[0].adset_id,
          campaign_id: insights[0].campaign_id,
          date_start: insights[0].date_start,
          date_stop: insights[0].date_stop,
          spend: insights[0].spend
        } : 'No records'
      });

      const performanceData: MetaAdPerformance[] = [];
      const uniqueKeys = new Set<string>();

      for (const insight of insights) {
        const adId = insight.ad_id || '';
        const adsetId = insight.adset_id || '';
        const campaignId = insight.campaign_id || '';
        const date = insight.date_start || '';
        
        // Create unique key for deduplication
        const uniqueKey = `${adId}:${date}`;
        
        // Skip records with missing required fields
        if (!adId || !date) {
          logger.warn('Skipping Meta ad performance record with missing required fields', {
            ad_id: adId,
            adset_id: adsetId,
            campaign_id: campaignId,
            date,
            hasValidAdId: !!adId,
            hasValidDate: !!date
          });
          continue;
        }
        
        // Skip duplicates
        if (uniqueKeys.has(uniqueKey)) {
          logger.warn('Skipping duplicate Meta ad performance record', {
            ad_id: adId,
            adset_id: adsetId,
            campaign_id: campaignId,
            date,
            uniqueKey
          });
          continue;
        }
        
        uniqueKeys.add(uniqueKey);

        const data: MetaAdPerformance = {
          ad_id: adId,
          adset_id: adsetId,
          campaign_id: campaignId,
          date,
          impressions: parseInt(insight.impressions || '0'),
          clicks: parseInt(insight.clicks || '0'),
          spend_cents: Math.round((parseFloat(insight.spend || '0')) * 100),
          conversions: parseFloat(insight.conversions || '0'),
          conversion_value_cents: Math.round((parseFloat(insight.conversion_values || '0')) * 100),
          ctr: parseFloat(insight.ctr || '0'),
          cpc_cents: Math.round((parseFloat(insight.cpc || '0')) * 100),
          cpm_cents: Math.round((parseFloat(insight.cpm || '0')) * 100),
          reach: parseInt(insight.reach || '0'),
          frequency: parseFloat(insight.frequency || '0'),
          unique_clicks: parseInt(insight.unique_clicks || '0'),
          cost_per_unique_click_cents: Math.round((parseFloat(insight.cost_per_unique_click || '0')) * 100),
          video_views: parseInt(insight.video_views || '0'),
          video_view_rate: parseFloat(insight.video_view_rate || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Meta ad performance records`, {
        dateRange: `${actualStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length,
        rawInsightsCount: insights.length,
        deduplicatedCount: performanceData.length,
        duplicatesSkipped: insights.length - performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Meta ad performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async extractCreativePerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<MetaCreativePerformance[]> {
    try {
      logger.info('Starting Meta Ads creative performance extraction', {
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      const actualStartDate = !startDate && modifiedSince 
        ? modifiedSince.toISOString().split('T')[0]
        : formattedStartDate;

      // Get insights at ad level to get creative-level performance
      // Note: For now we're using ad-level insights as a proxy for creative performance
      // In a full implementation, you'd need to map ads to their creatives first
      const insights = await this.client.getInsights(
        'ad',
        undefined, // Get all ads
        actualStartDate,
        formattedEndDate
      );
      
      logger.debug(`Meta API returned ${insights.length} creative insight records`, {
        sampleRecord: insights[0] ? {
          ad_id: insights[0].ad_id,
          adset_id: insights[0].adset_id,
          campaign_id: insights[0].campaign_id,
          date_start: insights[0].date_start,
          date_stop: insights[0].date_stop,
          spend: insights[0].spend
        } : 'No records'
      });

      const performanceData: MetaCreativePerformance[] = [];
      const uniqueKeys = new Set<string>();

      for (const insight of insights) {
        const adId = insight.ad_id || '';
        const adsetId = insight.adset_id || '';
        const campaignId = insight.campaign_id || '';
        const date = insight.date_start || '';
        
        // For now, we'll use ad_id as creative_id since we need ad-creative mapping
        // In a full implementation, you'd query the ad to get its creative_id first
        const creativeId = adId; // This would be enhanced with proper creative mapping
        
        // Create unique key for deduplication
        const uniqueKey = `${creativeId}:${date}`;
        
        // Skip records with missing required fields
        if (!creativeId || !date) {
          logger.warn('Skipping Meta creative performance record with missing required fields', {
            creative_id: creativeId,
            ad_id: adId,
            adset_id: adsetId,
            campaign_id: campaignId,
            date,
            hasValidCreativeId: !!creativeId,
            hasValidDate: !!date
          });
          continue;
        }
        
        // Skip duplicates
        if (uniqueKeys.has(uniqueKey)) {
          logger.warn('Skipping duplicate Meta creative performance record', {
            creative_id: creativeId,
            ad_id: adId,
            adset_id: adsetId,
            campaign_id: campaignId,
            date,
            uniqueKey
          });
          continue;
        }
        
        uniqueKeys.add(uniqueKey);

        const data: MetaCreativePerformance = {
          creative_id: creativeId,
          ad_id: adId,
          adset_id: adsetId,
          campaign_id: campaignId,
          date,
          impressions: parseInt(insight.impressions || '0'),
          clicks: parseInt(insight.clicks || '0'),
          spend_cents: Math.round((parseFloat(insight.spend || '0')) * 100),
          conversions: parseFloat(insight.conversions || '0'),
          conversion_value_cents: Math.round((parseFloat(insight.conversion_values || '0')) * 100),
          ctr: parseFloat(insight.ctr || '0'),
          cpc_cents: Math.round((parseFloat(insight.cpc || '0')) * 100),
          cpm_cents: Math.round((parseFloat(insight.cpm || '0')) * 100),
          reach: parseInt(insight.reach || '0'),
          frequency: parseFloat(insight.frequency || '0'),
          unique_clicks: parseInt(insight.unique_clicks || '0'),
          cost_per_unique_click_cents: Math.round((parseFloat(insight.cost_per_unique_click || '0')) * 100)
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Meta creative performance records`, {
        dateRange: `${actualStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length,
        rawInsightsCount: insights.length,
        deduplicatedCount: performanceData.length,
        duplicatesSkipped: insights.length - performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Meta creative performance', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async extractAllPerformanceData(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<{
    campaigns: MetaCampaignPerformance[];
    adsets: MetaAdsetPerformance[];
    ads: MetaAdPerformance[];
    creatives: MetaCreativePerformance[];
  }> {
    try {
      logger.info('Starting comprehensive Meta Ads performance extraction');

      const [campaigns, adsets, ads, creatives] = await Promise.all([
        this.extractCampaignPerformance(startDate, endDate, modifiedSince),
        this.extractAdsetPerformance(startDate, endDate, modifiedSince),
        this.extractAdPerformance(startDate, endDate, modifiedSince),
        this.extractCreativePerformance(startDate, endDate, modifiedSince)
      ]);

      logger.info('Completed comprehensive Meta Ads performance extraction', {
        campaignRecords: campaigns.length,
        adsetRecords: adsets.length,
        adRecords: ads.length,
        creativeRecords: creatives.length,
        totalRecords: campaigns.length + adsets.length + ads.length + creatives.length
      });

      return { campaigns, adsets, ads, creatives };

    } catch (error) {
      logger.error('Failed to extract comprehensive Meta performance data', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection with a simple insights query for today
      const today = new Date().toISOString().split('T')[0];
      const insights = await this.client.getInsights('account', undefined, today, today);
      
      logger.info('Meta Ads insights connection test successful', {
        recordsReturned: insights.length
      });

      return true;
    } catch (error) {
      logger.error('Meta Ads insights connection test failed', {
        error: getErrorMessage(error)
      });
      return false;
    }
  }
}

export default MetaAdsInsightsExtractor;