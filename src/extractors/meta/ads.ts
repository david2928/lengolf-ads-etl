import MetaAdsClient from './client';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';
import { MetaAd, CreativeAsset, AdWithCreatives } from '@/utils/types';

export class MetaAdsExtractor {
  private client: MetaAdsClient;

  constructor() {
    this.client = new MetaAdsClient();
  }

  async extractAdsWithCreatives(adSetIds?: string[], modifiedSince?: Date): Promise<AdWithCreatives[]> {
    try {
      logger.info('Starting Meta ads extraction with creatives', {
        adSetCount: adSetIds?.length || 'all',
        modifiedSince: modifiedSince?.toISOString()
      });

      const adsData = await this.client.getAds(adSetIds, modifiedSince);
      logger.info(`Extracted ${adsData.length} ads from Meta API`);

      const adsWithCreatives: AdWithCreatives[] = [];

      for (const adData of adsData) {
        try {
          // Transform ad data
          const ad = this.transformAdData(adData);
          
          // Extract creative assets
          const creativeAssets = await this.extractCreativeAssets(adData);
          
          adsWithCreatives.push({
            ad,
            creativeAssets
          });

        } catch (error) {
          logger.error('Failed to process ad', {
            adId: adData.id,
            error: getErrorMessage(error)
          });
          // Continue with other ads
        }
      }

      logger.info(`Successfully processed ${adsWithCreatives.length} ads with creative assets`);
      return adsWithCreatives;

    } catch (error) {
      logger.error('Meta ads extraction failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private transformAdData(adData: any): MetaAd {
    const ad = adData;
    
    return {
      ad_id: ad.id,
      ad_set_id: ad.adset_id,
      campaign_id: ad.campaign_id,
      ad_name: ad.name,
      ad_status: this.normalizeStatus(ad.status),
      creative_id: ad.creative?.id || null,
      bid_amount: this.parseBidAmount(ad.bid_amount),
      source_ad_id: ad.source_ad_id || null,
      created_time: this.parseDateTime(ad.created_time),
      updated_time: this.parseDateTime(ad.updated_time),
      tracking_specs: this.parseTrackingSpecs(ad.tracking_specs),
      conversion_specs: this.parseConversionSpecs(ad.conversion_specs),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  private async extractCreativeAssets(adData: any): Promise<CreativeAsset[]> {
    const assets: CreativeAsset[] = [];
    
    try {
      // Get creative ID from ad data
      const creativeId = adData.creative?.id;
      
      if (!creativeId) {
        logger.debug('No creative ID found for ad', { adId: adData.id });
        return assets;
      }

      // Fetch creative details
      const creatives = await this.client.getAdCreatives([creativeId]);
      
      for (const creative of creatives) {
        const creativeAssets = this.extractAssetsFromCreative(creative, adData.id);
        assets.push(...creativeAssets);
      }

    } catch (error) {
      logger.error('Failed to extract creative assets', {
        adId: adData.id,
        error: getErrorMessage(error)
      });
    }

    return assets;
  }

  private extractAssetsFromCreative(creative: any, adId: string): CreativeAsset[] {
    const assets: CreativeAsset[] = [];

    try {
      // Extract image assets
      if (creative.image_hash || creative.image_url) {
        assets.push({
          platform: 'meta',
          platform_asset_id: creative.image_hash || creative.id,
          ad_id: adId,
          creative_id: creative.id,
          asset_type: 'image',
          asset_url: creative.image_url || this.constructImageUrl(creative.image_hash),
          thumbnail_url: creative.image_url || this.constructImageUrl(creative.image_hash),
          text_content: creative.title || creative.body,
          call_to_action_type: creative.call_to_action_type,
          approval_status: this.normalizeStatus(creative.status) || 'UNKNOWN'
        });
      }

      // Extract video assets
      if (creative.video_id) {
        assets.push({
          platform: 'meta',
          platform_asset_id: creative.video_id,
          ad_id: adId,
          creative_id: creative.id,
          asset_type: 'video',
          asset_url: `https://www.facebook.com/video.php?v=${creative.video_id}`,
          thumbnail_url: creative.thumbnail_url || null,
          text_content: creative.title || creative.body,
          call_to_action_type: creative.call_to_action_type,
          approval_status: this.normalizeStatus(creative.status) || 'UNKNOWN'
        });
      }

      // Extract carousel assets from object_story_spec
      if (creative.object_story_spec) {
        const carouselAssets = this.extractCarouselAssets(creative.object_story_spec, creative.id, adId);
        assets.push(...carouselAssets);
      }

      // Extract asset feed spec assets
      if (creative.asset_feed_spec) {
        const feedAssets = this.extractAssetFeedAssets(creative.asset_feed_spec, creative.id, adId);
        assets.push(...feedAssets);
      }

    } catch (error) {
      logger.error('Failed to extract assets from creative', {
        creativeId: creative.id,
        adId,
        error: getErrorMessage(error)
      });
    }

    return assets;
  }

  private extractCarouselAssets(objectStorySpec: any, creativeId: string, adId: string): CreativeAsset[] {
    const assets: CreativeAsset[] = [];

    try {
      if (objectStorySpec.link_data?.child_attachments) {
        objectStorySpec.link_data.child_attachments.forEach((attachment: any, index: number) => {
          if (attachment.image_hash || attachment.picture) {
            assets.push({
              platform: 'meta',
              platform_asset_id: `${creativeId}_carousel_${index}`,
              ad_id: adId,
              creative_id: creativeId,
              asset_type: 'image',
              asset_url: attachment.picture || this.constructImageUrl(attachment.image_hash),
              thumbnail_url: attachment.picture || this.constructImageUrl(attachment.image_hash),
              text_content: attachment.name || attachment.description,
              link_url: attachment.link,
              approval_status: 'APPROVED'
            });
          }
        });
      }

      // Handle video carousel items
      if (objectStorySpec.video_data) {
        assets.push({
          platform: 'meta',
          platform_asset_id: `${creativeId}_video`,
          ad_id: adId,
          creative_id: creativeId,
          asset_type: 'video',
          asset_url: objectStorySpec.video_data.video_id ? 
            `https://www.facebook.com/video.php?v=${objectStorySpec.video_data.video_id}` : null,
          thumbnail_url: objectStorySpec.video_data.image_url,
          text_content: objectStorySpec.video_data.title || objectStorySpec.video_data.message,
          call_to_action_type: objectStorySpec.video_data.call_to_action?.type,
          approval_status: 'APPROVED'
        });
      }

    } catch (error) {
      logger.debug('Failed to extract carousel assets', {
        creativeId,
        error: getErrorMessage(error)
      });
    }

    return assets;
  }

  private extractAssetFeedAssets(assetFeedSpec: any, creativeId: string, adId: string): CreativeAsset[] {
    const assets: CreativeAsset[] = [];

    try {
      // Extract images from asset feed
      if (assetFeedSpec.images) {
        assetFeedSpec.images.forEach((image: any, index: number) => {
          assets.push({
            platform: 'meta',
            platform_asset_id: `${creativeId}_feed_image_${index}`,
            ad_id: adId,
            creative_id: creativeId,
            asset_type: 'image',
            asset_url: image.url,
            thumbnail_url: image.url,
            approval_status: 'APPROVED'
          });
        });
      }

      // Extract videos from asset feed
      if (assetFeedSpec.videos) {
        assetFeedSpec.videos.forEach((video: any, index: number) => {
          assets.push({
            platform: 'meta',
            platform_asset_id: `${creativeId}_feed_video_${index}`,
            ad_id: adId,
            creative_id: creativeId,
            asset_type: 'video',
            asset_url: video.url,
            thumbnail_url: video.thumbnail_url,
            approval_status: 'APPROVED'
          });
        });
      }

    } catch (error) {
      logger.debug('Failed to extract asset feed assets', {
        creativeId,
        error: getErrorMessage(error)
      });
    }

    return assets;
  }

  private constructImageUrl(imageHash: string): string {
    if (!imageHash) return '';
    
    // Meta images can be accessed via Graph API
    return `https://graph.facebook.com/${imageHash}/picture`;
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

  private parseTrackingSpecs(trackingSpecs: any): any {
    if (!trackingSpecs || !Array.isArray(trackingSpecs)) {
      return null;
    }
    
    try {
      return trackingSpecs.map(spec => ({
        action_type: spec.action.type,
        fb_pixel: spec.fb_pixel,
        application: spec.application,
        page: spec.page
      }));
    } catch (error) {
      logger.debug('Failed to parse tracking specs', { error: getErrorMessage(error) });
      return null;
    }
  }

  private parseConversionSpecs(conversionSpecs: any): any {
    if (!conversionSpecs || !Array.isArray(conversionSpecs)) {
      return null;
    }
    
    try {
      return conversionSpecs.map(spec => ({
        action_type: spec.action.type,
        fb_pixel: spec.fb_pixel,
        application: spec.application,
        page: spec.page
      }));
    } catch (error) {
      logger.debug('Failed to parse conversion specs', { error: getErrorMessage(error) });
      return null;
    }
  }

  async extractAdInsights(
    adIds?: string[],
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    try {
      logger.info('Extracting Meta ad insights', {
        adCount: adIds?.length || 'all',
        startDate,
        endDate
      });

      const insights = await this.client.getInsights(
        'ad',
        adIds,
        startDate,
        endDate
      );

      const transformedInsights = insights.map(insight => {
        return this.transformInsightData(insight);
      });

      logger.info(`Successfully extracted ${transformedInsights.length} ad insights`);
      return transformedInsights;

    } catch (error) {
      logger.error('Meta ad insights extraction failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private transformInsightData(insightData: any): any {
    return {
      platform: 'meta',
      level: 'ad',
      entity_id: insightData.ad_id,
      ad_set_id: insightData.adset_id,
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

export default MetaAdsExtractor;