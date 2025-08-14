import GoogleAdsClient from './client';
import logger from '@/utils/logger';
import { GoogleAd, CreativeAsset, AdWithCreatives } from '@/utils/types';
import { getErrorMessage } from '@/utils/error-handler';

export class GoogleAdsExtractor {
  private client: GoogleAdsClient;

  constructor() {
    this.client = new GoogleAdsClient();
  }

  async extractAdsWithCreatives(modifiedSince?: Date, adGroupIds?: string[]): Promise<AdWithCreatives[]> {
    try {
      logger.info('Starting Google Ads extraction with creatives', {
        modifiedSince: modifiedSince?.toISOString(),
        adGroupCount: adGroupIds?.length || 'all'
      });

      // Get ads data
      const adsData = await this.client.getAds(adGroupIds, modifiedSince);
      logger.info(`Extracted ${adsData.length} ads from Google Ads API`);
      
      // Debug log structure of first result if available
      if (adsData.length > 0) {
        logger.debug('Sample ad data structure:', {
          keys: Object.keys(adsData[0]),
          hasAdGroupAd: !!adsData[0].ad_group_ad,
          hasAdGroup: !!adsData[0].ad_group,
          hasCampaign: !!adsData[0].campaign,
          firstAdSample: JSON.stringify(adsData[0], null, 2).substring(0, 300) + '...'
        });
      }

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
            adId: adData.ad_group_ad?.ad?.id || 'unknown',
            adDataKeys: Object.keys(adData),
            error: getErrorMessage(error)
          });
          // Continue with other ads
        }
      }

      logger.info(`Successfully processed ${adsWithCreatives.length} ads with creative assets`);
      return adsWithCreatives;

    } catch (error) {
      logger.error('Google Ads extraction failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private transformAdData(adData: any): GoogleAd {
    // Debug log to understand actual structure
    logger.debug('Raw adData structure:', { 
      keys: Object.keys(adData),
      hasAdGroupAd: !!adData.ad_group_ad,
      hasAdGroup: !!adData.ad_group,
      hasCampaign: !!adData.campaign,
      adGroupAdKeys: adData.ad_group_ad ? Object.keys(adData.ad_group_ad) : [],
      adExists: !!(adData.ad_group_ad?.ad)
    });
    
    const adGroupAd = adData.ad_group_ad;
    const adGroup = adData.ad_group;
    const campaign = adData.campaign;
    
    if (!adGroupAd) {
      logger.error('ad_group_ad is missing from response', { 
        availableKeys: Object.keys(adData),
        adData: JSON.stringify(adData, null, 2).substring(0, 500) + '...'
      });
      throw new Error('ad_group_ad is missing from Google Ads API response');
    }
    
    const ad = adGroupAd.ad;
    if (!ad) {
      logger.error('ad is missing from ad_group_ad', { 
        adGroupAdKeys: Object.keys(adGroupAd),
        adGroupAd: JSON.stringify(adGroupAd, null, 2).substring(0, 500) + '...'
      });
      throw new Error('ad is missing from ad_group_ad in Google Ads API response');
    }
    
    if (!adGroup) {
      logger.error('ad_group is missing from response', {
        availableKeys: Object.keys(adData)
      });
      throw new Error('ad_group is missing from Google Ads API response');
    }
    
    if (!campaign) {
      logger.error('campaign is missing from response', {
        availableKeys: Object.keys(adData)
      });
      throw new Error('campaign is missing from Google Ads API response');
    }

    // Handle different ad types
    let headlines: any[] = [];
    let descriptions: any[] = [];
    let headline1 = '';
    let headline2 = '';
    let headline3 = '';
    let description1 = '';
    let description2 = '';

    if (ad.responsive_search_ad) {
      headlines = ad.responsive_search_ad.headlines || [];
      descriptions = ad.responsive_search_ad.descriptions || [];
      headline1 = headlines[0]?.text || '';
      headline2 = headlines[1]?.text || '';
      headline3 = headlines[2]?.text || '';
      description1 = descriptions[0]?.text || '';
      description2 = descriptions[1]?.text || '';
    } else if (ad.expanded_text_ad) {
      headline1 = ad.expanded_text_ad.headline_part1 || '';
      headline2 = ad.expanded_text_ad.headline_part2 || '';
      headline3 = ad.expanded_text_ad.headline_part3 || '';
      description1 = ad.expanded_text_ad.description || '';
      description2 = ad.expanded_text_ad.description2 || '';
    }

    const transformedAd: GoogleAd = {
      ad_id: ad.id?.toString() || '',
      ad_group_id: adGroup.id?.toString() || '',
      campaign_id: campaign.id?.toString() || '',
      ad_name: ad.name || '',
      ad_status: adGroupAd.status || 'UNKNOWN',
      ad_type: ad.type || 'UNKNOWN',
      headline1,
      headline2,
      headline3,
      description1,
      description2,
      final_url: ad.final_urls?.[0] || '',
      final_mobile_url: ad.final_mobile_urls?.[0] || '',
      display_url: ad.expanded_text_ad?.display_url || this.constructDisplayUrl(ad.final_urls?.[0]),
      headlines: headlines.length > 0 ? headlines : undefined,
      descriptions: descriptions.length > 0 ? descriptions : undefined,
      image_assets: [], // Will be populated by extractCreativeAssets
      video_assets: [], // Will be populated by extractCreativeAssets
      ad_strength: adGroupAd.ad_strength || 'UNKNOWN',
      creative_json: ad
    };
    
    logger.debug('Successfully transformed ad data', {
      adId: transformedAd.ad_id,
      adGroupId: transformedAd.ad_group_id,
      campaignId: transformedAd.campaign_id,
      adType: transformedAd.ad_type
    });
    
    return transformedAd;
  }

  private async extractCreativeAssets(adData: any): Promise<CreativeAsset[]> {
    const assets: CreativeAsset[] = [];
    const ad = adData.ad_group_ad?.ad;
    
    if (!ad) {
      logger.warn('Ad data missing for creative asset extraction', { 
        hasAdGroupAd: !!adData.ad_group_ad,
        adGroupAdKeys: adData.ad_group_ad ? Object.keys(adData.ad_group_ad) : [],
        availableKeys: Object.keys(adData)
      });
      return assets;
    }
    
    if (!ad.id) {
      logger.warn('Ad ID missing for creative asset extraction', {
        adKeys: Object.keys(ad)
      });
      return assets;
    }
    
    const adId = ad.id.toString();

    try {
      // Collect asset IDs from different ad types
      const assetIds: string[] = [];

      // Responsive Search Ad assets
      if (ad.responsive_search_ad?.headlines) {
        for (const headline of ad.responsive_search_ad.headlines) {
          if (headline.asset) {
            assetIds.push(this.extractAssetId(headline.asset));
          }
        }
      }

      if (ad.responsive_search_ad?.descriptions) {
        for (const description of ad.responsive_search_ad.descriptions) {
          if (description.asset) {
            assetIds.push(this.extractAssetId(description.asset));
          }
        }
      }

      // Image Ad assets
      if (ad.image_ad?.image_asset) {
        assetIds.push(this.extractAssetId(ad.image_ad.image_asset));
      }

      // Video Ad assets
      if (ad.video_ad?.video_asset) {
        assetIds.push(this.extractAssetId(ad.video_ad.video_asset));
      }

      // Get asset details if we have any asset IDs
      if (assetIds.length > 0) {
        const uniqueAssetIds = [...new Set(assetIds)];
        const assetDetails = await this.client.getAssets(uniqueAssetIds);

        for (const assetDetail of assetDetails) {
          const asset = this.transformAssetData(assetDetail, adId);
          if (asset) {
            assets.push(asset);
          }
        }
      }

    } catch (error) {
      logger.error('Failed to extract creative assets', {
        adId,
        error: error.message
      });
    }

    return assets;
  }

  private transformAssetData(assetData: any, adId: string): CreativeAsset | null {
    const asset = assetData.asset;
    
    if (!asset) return null;

    const baseAsset: CreativeAsset = {
      platform: 'google',
      platform_asset_id: asset.id.toString(),
      ad_id: adId,
      asset_type: asset.type.toLowerCase()
    };

    // Handle different asset types
    switch (asset.type) {
      case 'IMAGE':
        if (asset.image_asset) {
          return {
            ...baseAsset,
            asset_url: asset.image_asset.full_size_image_url,
            thumbnail_url: asset.image_asset.thumbnail_image_url,
            width: asset.image_asset.full_size_image?.width,
            height: asset.image_asset.full_size_image?.height,
            file_size_bytes: asset.image_asset.full_size_image?.size_bytes,
            mime_type: asset.image_asset.mime_type,
            approval_status: this.getApprovalStatus(asset.policy_validation_parameter)
          };
        }
        break;

      case 'VIDEO':
        if (asset.video_asset) {
          return {
            ...baseAsset,
            asset_url: `https://www.youtube.com/watch?v=${asset.video_asset.youtube_video_id}`,
            thumbnail_url: `https://img.youtube.com/vi/${asset.video_asset.youtube_video_id}/maxresdefault.jpg`,
            text_content: asset.video_asset.youtube_video_title,
            approval_status: this.getApprovalStatus(asset.policy_validation_parameter)
          };
        }
        break;

      case 'TEXT':
        if (asset.text_asset) {
          return {
            ...baseAsset,
            text_content: asset.text_asset.text,
            approval_status: this.getApprovalStatus(asset.policy_validation_parameter)
          };
        }
        break;

      default:
        logger.debug('Unknown asset type', { 
          assetType: asset.type,
          assetId: asset.id 
        });
        return null;
    }

    return null;
  }

  private extractAssetId(assetResourceName: string): string {
    // Extract asset ID from resource name like "customers/123/assets/456"
    const parts = assetResourceName.split('/');
    return parts[parts.length - 1];
  }

  private getApprovalStatus(policyValidation: any): string {
    if (!policyValidation) return 'UNKNOWN';
    
    if (policyValidation.policy_validation_parameter_ignorability_type) {
      return policyValidation.policy_validation_parameter_ignorability_type;
    }

    if (policyValidation.policy_topic_entries?.length > 0) {
      return 'POLICY_REVIEW_REQUIRED';
    }

    return 'APPROVED';
  }

  private constructDisplayUrl(finalUrl?: string): string {
    if (!finalUrl) return '';
    
    try {
      const url = new URL(finalUrl);
      return url.hostname;
    } catch {
      return finalUrl.substring(0, 50);
    }
  }

  async extractCampaigns(modifiedSince?: Date): Promise<any[]> {
    try {
      logger.info('Extracting Google Ads campaigns', {
        modifiedSince: modifiedSince?.toISOString()
      });

      const campaigns = await this.client.getCampaigns(modifiedSince);
      
      return campaigns.map(campaignData => {
        const campaign = campaignData.campaign;
        
        return {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          campaign_status: campaign.status,
          campaign_type: campaign.advertising_channel_type,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
          budget_amount_micros: campaign.campaign_budget ? 
            this.extractBudgetAmount(campaign.campaign_budget) : null,
          budget_type: campaign.campaign_budget ?
            this.extractBudgetType(campaign.campaign_budget) : null,
          bidding_strategy_type: campaign.bidding_strategy_type,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });

    } catch (error) {
      logger.error('Failed to extract Google Ads campaigns', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async extractAdGroups(campaignIds?: string[], modifiedSince?: Date): Promise<any[]> {
    try {
      logger.info('Extracting Google Ads ad groups', {
        campaignCount: campaignIds?.length || 'all',
        modifiedSince: modifiedSince?.toISOString()
      });

      const adGroups = await this.client.getAdGroups(campaignIds, modifiedSince);
      
      return adGroups.map(adGroupData => {
        const adGroup = adGroupData.ad_group;
        const campaign = adGroupData.campaign;
        
        return {
          ad_group_id: adGroup.id,
          campaign_id: campaign.id,
          ad_group_name: adGroup.name,
          ad_group_status: adGroup.status,
          ad_group_type: adGroup.type,
          target_cpa_micros: adGroup.target_cpa_micros || null,
          target_cpm_micros: adGroup.cpm_bid_micros || null,
          target_cpc_micros: adGroup.cpc_bid_micros || null,
          percent_cpc_bid_micros: adGroup.percent_cpc_bid_micros || null,
          targeting_setting: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });

    } catch (error) {
      logger.error('Failed to extract Google Ads ad groups', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private extractBudgetAmount(budgetResourceName: string): number | null {
    // This would require an additional API call to get budget details
    // For now, return null and implement budget extraction separately if needed
    return null;
  }

  private extractBudgetType(budgetResourceName: string): string | null {
    // This would require an additional API call to get budget details
    // For now, return null and implement budget extraction separately if needed
    return null;
  }
}

export default GoogleAdsExtractor;