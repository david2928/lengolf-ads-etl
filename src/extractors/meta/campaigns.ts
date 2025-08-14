import MetaAdsClient from './client';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';
import { MetaCampaign } from '@/utils/types';

export class MetaCampaignsExtractor {
  private client: MetaAdsClient;

  constructor() {
    this.client = new MetaAdsClient();
  }

  async extractCampaigns(modifiedSince?: Date): Promise<MetaCampaign[]> {
    try {
      logger.info('Starting Meta campaigns extraction', {
        modifiedSince: modifiedSince?.toISOString()
      });

      const campaignsData = await this.client.getCampaigns(modifiedSince);
      logger.info(`Extracted ${campaignsData.length} campaigns from Meta API`);

      const campaigns: MetaCampaign[] = campaignsData.map(campaignData => {
        return this.transformCampaignData(campaignData);
      });

      logger.info(`Successfully transformed ${campaigns.length} Meta campaigns`);
      return campaigns;

    } catch (error) {
      logger.error('Meta campaigns extraction failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private transformCampaignData(campaignData: any): MetaCampaign {
    const campaign = campaignData;
    
    return {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      campaign_status: this.normalizeStatus(campaign.status),
      objective: campaign.objective || null,
      buying_type: campaign.buying_type || null,
      bid_strategy: campaign.bid_strategy || null,
      daily_budget: this.parseBudgetAmount(campaign.daily_budget),
      lifetime_budget: this.parseBudgetAmount(campaign.lifetime_budget),
      budget_remaining: this.parseBudgetAmount(campaign.budget_remaining),
      spend_cap: this.parseBudgetAmount(campaign.spend_cap),
      start_time: this.parseDateTime(campaign.start_time),
      stop_time: this.parseDateTime(campaign.stop_time),
      created_time: this.parseDateTime(campaign.created_time),
      updated_time: this.parseDateTime(campaign.updated_time),
      can_use_spend_cap: campaign.can_use_spend_cap || false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  private normalizeStatus(status: string): string {
    // Normalize Meta status to common format
    switch (status?.toUpperCase()) {
      case 'ACTIVE':
        return 'ENABLED';
      case 'PAUSED':
        return 'PAUSED';
      case 'DELETED':
      case 'ARCHIVED':
        return 'REMOVED';
      case 'PENDING_REVIEW':
        return 'PENDING';
      case 'DISAPPROVED':
        return 'DISAPPROVED';
      case 'PREAPPROVED':
        return 'APPROVED';
      default:
        return status || 'UNKNOWN';
    }
  }

  private parseBudgetAmount(budgetValue: any): number | null {
    if (!budgetValue) return null;
    
    // Meta API returns budget amounts as strings in cents
    const numericValue = parseInt(budgetValue, 10);
    return isNaN(numericValue) ? null : numericValue;
  }

  private parseDateTime(dateTimeStr: string | null): string | null {
    if (!dateTimeStr) return null;
    
    try {
      // Meta API returns ISO 8601 format dates
      const date = new Date(dateTimeStr);
      return isNaN(date.getTime()) ? null : date.toISOString();
    } catch (error) {
      logger.debug('Failed to parse datetime', { 
        dateTimeStr, 
        error: getErrorMessage(error) 
      });
      return null;
    }
  }

  async extractCampaignInsights(
    campaignIds?: string[],
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    try {
      logger.info('Extracting Meta campaign insights', {
        campaignCount: campaignIds?.length || 'all',
        startDate,
        endDate
      });

      const insights = await this.client.getInsights(
        'campaign',
        campaignIds,
        startDate,
        endDate
      );

      const transformedInsights = insights.map(insight => {
        return this.transformInsightData(insight, 'campaign');
      });

      logger.info(`Successfully extracted ${transformedInsights.length} campaign insights`);
      return transformedInsights;

    } catch (error) {
      logger.error('Meta campaign insights extraction failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private transformInsightData(insightData: any, level: string): any {
    return {
      platform: 'meta',
      level,
      entity_id: insightData.campaign_id || insightData.adset_id || insightData.ad_id,
      date_start: insightData.date_start,
      date_stop: insightData.date_stop,
      impressions: parseInt(insightData.impressions) || 0,
      clicks: parseInt(insightData.clicks) || 0,
      spend: parseFloat(insightData.spend) || 0,
      conversions: parseFloat(insightData.conversions) || 0,
      conversion_values: parseFloat(insightData.conversion_values) || 0,
      ctr: parseFloat(insightData.ctr) || 0,
      cpc: parseFloat(insightData.cpc) || 0,
      cpm: parseFloat(insightData.cpm) || 0,
      cpp: parseFloat(insightData.cpp) || 0,
      reach: parseInt(insightData.reach) || 0,
      frequency: parseFloat(insightData.frequency) || 0,
      video_views: parseInt(insightData.video_views) || 0,
      video_view_time: parseInt(insightData.video_view_time) || 0,
      cost_per_conversion: parseFloat(insightData.cost_per_conversion) || 0,
      conversion_rate: parseFloat(insightData.conversion_rate) || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }
}

export default MetaCampaignsExtractor;