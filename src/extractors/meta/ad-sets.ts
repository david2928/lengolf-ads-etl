import MetaAdsClient from './client';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';
import { MetaAdSet } from '@/utils/types';

export class MetaAdSetsExtractor {
  private client: MetaAdsClient;

  constructor() {
    this.client = new MetaAdsClient();
  }

  async extractAdSets(campaignIds?: string[], modifiedSince?: Date): Promise<MetaAdSet[]> {
    try {
      logger.info('Starting Meta ad sets extraction', {
        campaignCount: campaignIds?.length || 'all',
        modifiedSince: modifiedSince?.toISOString()
      });

      const adSetsData = await this.client.getAdSets(campaignIds, modifiedSince);
      logger.info(`Extracted ${adSetsData.length} ad sets from Meta API`);

      const adSets: MetaAdSet[] = adSetsData.map(adSetData => {
        return this.transformAdSetData(adSetData);
      });

      logger.info(`Successfully transformed ${adSets.length} Meta ad sets`);
      return adSets;

    } catch (error) {
      logger.error('Meta ad sets extraction failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private transformAdSetData(adSetData: any): MetaAdSet {
    const adSet = adSetData;
    
    return {
      ad_set_id: adSet.id,
      campaign_id: adSet.campaign_id,
      ad_set_name: adSet.name,
      ad_set_status: this.normalizeStatus(adSet.status),
      optimization_goal: adSet.optimization_goal || null,
      billing_event: adSet.billing_event || null,
      bid_strategy: adSet.bid_strategy || null,
      bid_amount: this.parseBidAmount(adSet.bid_amount),
      daily_budget: this.parseBudgetAmount(adSet.daily_budget),
      lifetime_budget: this.parseBudgetAmount(adSet.lifetime_budget),
      budget_remaining: this.parseBudgetAmount(adSet.budget_remaining),
      start_time: this.parseDateTime(adSet.start_time),
      end_time: this.parseDateTime(adSet.end_time),
      created_time: this.parseDateTime(adSet.created_time),
      updated_time: this.parseDateTime(adSet.updated_time),
      targeting: this.parseTargeting(adSet.targeting),
      promoted_object: this.parsePromotedObject(adSet.promoted_object),
      attribution_spec: this.parseAttributionSpec(adSet.attribution_spec),
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

  private parseBidAmount(bidAmount: any): number | null {
    if (!bidAmount) return null;
    
    // Meta API returns bid amounts as strings in cents
    const numericValue = parseInt(bidAmount, 10);
    return isNaN(numericValue) ? null : numericValue;
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

  private parseTargeting(targeting: any): any {
    if (!targeting || typeof targeting !== 'object') {
      return null;
    }
    
    try {
      // Return targeting as JSON object, sanitizing sensitive data
      const sanitizedTargeting = {
        ...targeting
      };
      
      // Remove any potentially sensitive custom audience data
      if (sanitizedTargeting.custom_audiences) {
        sanitizedTargeting.custom_audiences = sanitizedTargeting.custom_audiences.map((audience: any) => ({
          id: audience.id,
          name: audience.name
        }));
      }
      
      return sanitizedTargeting;
    } catch (error) {
      logger.debug('Failed to parse targeting', { error: getErrorMessage(error) });
      return null;
    }
  }

  private parsePromotedObject(promotedObject: any): any {
    if (!promotedObject || typeof promotedObject !== 'object') {
      return null;
    }
    
    try {
      return {
        page_id: promotedObject.page_id,
        instagram_actor_id: promotedObject.instagram_actor_id,
        object_store_url: promotedObject.object_store_url,
        offer_id: promotedObject.offer_id,
        product_catalog_id: promotedObject.product_catalog_id,
        product_set_id: promotedObject.product_set_id,
        application_id: promotedObject.application_id,
        event_id: promotedObject.event_id,
        custom_event_type: promotedObject.custom_event_type,
        pixel_id: promotedObject.pixel_id,
        pixel_rule: promotedObject.pixel_rule
      };
    } catch (error) {
      logger.debug('Failed to parse promoted object', { error: getErrorMessage(error) });
      return null;
    }
  }

  private parseAttributionSpec(attributionSpec: any): any {
    if (!attributionSpec || !Array.isArray(attributionSpec)) {
      return null;
    }
    
    try {
      return attributionSpec.map(spec => ({
        event_type: spec.event_type,
        window_days: spec.window_days
      }));
    } catch (error) {
      logger.debug('Failed to parse attribution spec', { error: getErrorMessage(error) });
      return null;
    }
  }

  async extractAdSetInsights(
    adSetIds?: string[],
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    try {
      logger.info('Extracting Meta ad set insights', {
        adSetCount: adSetIds?.length || 'all',
        startDate,
        endDate
      });

      const insights = await this.client.getInsights(
        'adset',
        adSetIds,
        startDate,
        endDate
      );

      const transformedInsights = insights.map(insight => {
        return this.transformInsightData(insight);
      });

      logger.info(`Successfully extracted ${transformedInsights.length} ad set insights`);
      return transformedInsights;

    } catch (error) {
      logger.error('Meta ad set insights extraction failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private transformInsightData(insightData: any): any {
    return {
      platform: 'meta',
      level: 'adset',
      entity_id: insightData.adset_id,
      campaign_id: insightData.campaign_id,
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

export default MetaAdSetsExtractor;