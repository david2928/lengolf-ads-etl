import SupabaseLoader from './supabase-client';
import logger from '@/utils/logger';
import { BatchResult, AdWithCreatives, CreativeAsset, MetaCampaign, MetaAdSet, MetaAd } from '@/utils/types';
import { GoogleAdsKeywordPerformance, GoogleAdsCampaignPerformance, GoogleAdsPMaxPerformance } from '@/extractors/google/performance';
import { MetaCampaignPerformance, MetaAdsetPerformance, MetaAdPerformance, MetaCreativePerformance } from '@/extractors/meta/insights';

export class BatchProcessor {
  private supabase: SupabaseLoader;
  private batchSize: number;

  constructor(batchSize: number = 1000) {
    this.supabase = new SupabaseLoader();
    this.batchSize = batchSize;
  }

  async processGoogleAdsWithCreatives(
    adsData: AdWithCreatives[],
    batchId?: string
  ): Promise<BatchResult> {
    try {
      logger.info('Starting Google Ads batch processing', {
        totalRecords: adsData.length,
        batchSize: this.batchSize,
        batchId
      });

      let totalInserted = 0;
      let totalUpdated = 0;
      let totalFailed = 0;

      // Process in batches
      for (let i = 0; i < adsData.length; i += this.batchSize) {
        const batch = adsData.slice(i, i + this.batchSize);
        
        try {
          const batchResult = await this.processSingleGoogleAdsBatch(batch);
          totalInserted += batchResult.inserted;
          totalUpdated += batchResult.updated;
          
          logger.info(`Processed batch ${Math.floor(i / this.batchSize) + 1}`, {
            batchStart: i,
            batchEnd: Math.min(i + this.batchSize, adsData.length),
            inserted: batchResult.inserted,
            updated: batchResult.updated
          });

        } catch (error) {
          logger.error(`Batch processing failed for batch starting at ${i}`, {
            error: error.message,
            batchSize: batch.length
          });
          totalFailed += batch.length;
        }
      }

      // Update sync batch if provided
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: adsData.length,
          records_inserted: totalInserted,
          records_updated: totalUpdated,
          records_failed: totalFailed,
          status: totalFailed === 0 ? 'completed' : 'partial'
        });
      }

      const result = {
        inserted: totalInserted,
        updated: totalUpdated,
        failed: totalFailed
      };

      logger.info('Google Ads batch processing completed', result);
      return result;

    } catch (error) {
      logger.error('Google Ads batch processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  private async processSingleGoogleAdsBatch(batch: AdWithCreatives[]): Promise<BatchResult> {
    // Separate ads and creative assets
    const ads = batch.map(item => item.ad);
    const allCreativeAssets = batch.flatMap(item => item.creativeAssets || []);

    let totalInserted = 0;
    let totalUpdated = 0;

    // Process ads first
    if (ads.length > 0) {
      const adsResult = await this.supabase.bulkUpsert(
        'google_ads_ads',
        ads,
        'ad_id'
      );
      totalInserted += adsResult.inserted;
      totalUpdated += adsResult.updated;
    }

    // Process creative assets
    if (allCreativeAssets.length > 0) {
      const assetsResult = await this.supabase.bulkUpsert(
        'ad_creative_assets',
        allCreativeAssets,
        ['platform', 'platform_asset_id']
      );
      totalInserted += assetsResult.inserted;
      totalUpdated += assetsResult.updated;
    }

    return {
      inserted: totalInserted,
      updated: totalUpdated,
      failed: 0
    };
  }

  async processGoogleCampaigns(campaigns: any[], batchId?: string): Promise<BatchResult> {
    try {
      logger.info('Processing Google Ads campaigns', {
        campaignCount: campaigns.length,
        batchId
      });

      if (campaigns.length === 0) {
        return { inserted: 0, updated: 0, failed: 0 };
      }

      const result = await this.supabase.bulkUpsert(
        'google_ads_campaigns',
        campaigns,
        'campaign_id'
      );

      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: campaigns.length,
          records_inserted: result.inserted,
          records_updated: result.updated,
          status: 'completed'
        });
      }

      logger.info('Google campaigns processed successfully', result);
      return {
        inserted: result.inserted,
        updated: result.updated,
        failed: 0
      };

    } catch (error) {
      logger.error('Google campaigns processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  async processGoogleAdGroups(adGroups: any[], batchId?: string): Promise<BatchResult> {
    try {
      logger.info('Processing Google Ads ad groups', {
        adGroupCount: adGroups.length,
        batchId
      });

      if (adGroups.length === 0) {
        return { inserted: 0, updated: 0, failed: 0 };
      }

      const result = await this.supabase.bulkUpsert(
        'google_ads_ad_groups',
        adGroups,
        'ad_group_id'
      );

      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: adGroups.length,
          records_inserted: result.inserted,
          records_updated: result.updated,
          status: 'completed'
        });
      }

      logger.info('Google ad groups processed successfully', result);
      return {
        inserted: result.inserted,
        updated: result.updated,
        failed: 0
      };

    } catch (error) {
      logger.error('Google ad groups processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  async processGoogleKeywords(keywords: any[], batchId?: string): Promise<BatchResult> {
    try {
      logger.info('Processing Google Ads keywords', {
        keywordCount: keywords.length,
        batchId
      });

      if (keywords.length === 0) {
        return { inserted: 0, updated: 0, failed: 0 };
      }

      // Remove duplicates by keyword_id to prevent conflict errors
      const uniqueKeywords = keywords.filter((keyword, index, self) => 
        index === self.findIndex(k => k.keyword_id === keyword.keyword_id)
      );

      if (uniqueKeywords.length !== keywords.length) {
        logger.warn('Removed duplicate keywords', {
          original: keywords.length,
          unique: uniqueKeywords.length,
          duplicates: keywords.length - uniqueKeywords.length
        });
      }

      const result = await this.supabase.bulkUpsert(
        'google_ads_keywords',
        uniqueKeywords,
        'keyword_id'
      );

      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: uniqueKeywords.length,
          records_inserted: result.inserted,
          records_updated: result.updated,
          status: 'completed'
        });
      }

      logger.info('Google keywords processed successfully', result);
      return {
        inserted: result.inserted,
        updated: result.updated,
        failed: 0
      };

    } catch (error) {
      logger.error('Google keywords processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  async processCreativeAssets(assets: CreativeAsset[], batchId?: string): Promise<BatchResult> {
    try {
      logger.info('Processing creative assets', {
        assetCount: assets.length,
        batchId
      });

      if (assets.length === 0) {
        return { inserted: 0, updated: 0, failed: 0 };
      }

      let totalInserted = 0;
      let totalUpdated = 0;
      let totalFailed = 0;

      // Process in smaller batches to avoid payload size limits
      const assetBatchSize = 500;
      for (let i = 0; i < assets.length; i += assetBatchSize) {
        const assetBatch = assets.slice(i, i + assetBatchSize);
        
        try {
          const result = await this.supabase.bulkUpsert(
            'ad_creative_assets',
            assetBatch,
            ['platform', 'platform_asset_id']
          );
          
          totalInserted += result.inserted;
          totalUpdated += result.updated;

        } catch (error) {
          logger.error(`Asset batch processing failed for batch starting at ${i}`, {
            error: error.message,
            batchSize: assetBatch.length
          });
          totalFailed += assetBatch.length;
        }
      }

      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: assets.length,
          records_inserted: totalInserted,
          records_updated: totalUpdated,
          records_failed: totalFailed,
          status: totalFailed === 0 ? 'completed' : 'partial'
        });
      }

      const result = {
        inserted: totalInserted,
        updated: totalUpdated,
        failed: totalFailed
      };

      logger.info('Creative assets processed successfully', result);
      return result;

    } catch (error) {
      logger.error('Creative assets processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  async processPerformanceData(
    tableName: string,
    performanceData: any[],
    conflictColumns: string | string[],
    batchId?: string
  ): Promise<BatchResult> {
    try {
      logger.info(`Processing performance data for ${tableName}`, {
        recordCount: performanceData.length,
        batchId
      });

      if (performanceData.length === 0) {
        return { inserted: 0, updated: 0, failed: 0 };
      }

      let totalInserted = 0;
      let totalUpdated = 0;
      let totalFailed = 0;

      // Process in batches
      for (let i = 0; i < performanceData.length; i += this.batchSize) {
        const batch = performanceData.slice(i, i + this.batchSize);
        
        try {
          const result = await this.supabase.bulkUpsert(
            tableName,
            batch,
            conflictColumns
          );
          
          totalInserted += result.inserted;
          totalUpdated += result.updated;

        } catch (error) {
          logger.error(`Performance data batch failed for ${tableName}`, {
            error: error.message,
            batchStart: i,
            batchSize: batch.length
          });
          totalFailed += batch.length;
        }
      }

      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: performanceData.length,
          records_inserted: totalInserted,
          records_updated: totalUpdated,
          records_failed: totalFailed,
          status: totalFailed === 0 ? 'completed' : 'partial'
        });
      }

      const result = {
        inserted: totalInserted,
        updated: totalUpdated,
        failed: totalFailed
      };

      logger.info(`Performance data processing completed for ${tableName}`, result);
      return result;

    } catch (error) {
      logger.error(`Performance data processing failed for ${tableName}`, { 
        error: error.message 
      });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  async processMetaCampaigns(campaigns: MetaCampaign[], batchId?: string): Promise<BatchResult> {
    try {
      logger.info('Processing Meta campaigns', {
        campaignCount: campaigns.length,
        batchId
      });

      if (campaigns.length === 0) {
        return { inserted: 0, updated: 0, failed: 0 };
      }

      const result = await this.supabase.bulkUpsert(
        'meta_ads_campaigns',
        campaigns,
        'campaign_id'
      );

      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: campaigns.length,
          records_inserted: result.inserted,
          records_updated: result.updated,
          status: 'completed'
        });
      }

      logger.info('Meta campaigns processed successfully', result);
      return {
        inserted: result.inserted,
        updated: result.updated,
        failed: 0
      };

    } catch (error) {
      logger.error('Meta campaigns processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  async processMetaAdSets(adSets: MetaAdSet[], batchId?: string): Promise<BatchResult> {
    try {
      logger.info('Processing Meta ad sets', {
        adSetCount: adSets.length,
        batchId
      });

      if (adSets.length === 0) {
        return { inserted: 0, updated: 0, failed: 0 };
      }

      const result = await this.supabase.bulkUpsert(
        'meta_ads_ad_sets',
        adSets,
        'ad_set_id'
      );

      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: adSets.length,
          records_inserted: result.inserted,
          records_updated: result.updated,
          status: 'completed'
        });
      }

      logger.info('Meta ad sets processed successfully', result);
      return {
        inserted: result.inserted,
        updated: result.updated,
        failed: 0
      };

    } catch (error) {
      logger.error('Meta ad sets processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  async processMetaAdsWithCreatives(
    adsData: AdWithCreatives[],
    batchId?: string
  ): Promise<BatchResult> {
    try {
      logger.info('Starting Meta Ads batch processing', {
        totalRecords: adsData.length,
        batchSize: this.batchSize,
        batchId
      });

      let totalInserted = 0;
      let totalUpdated = 0;
      let totalFailed = 0;

      // Process in batches
      for (let i = 0; i < adsData.length; i += this.batchSize) {
        const batch = adsData.slice(i, i + this.batchSize);
        
        try {
          const batchResult = await this.processSingleMetaAdsBatch(batch);
          totalInserted += batchResult.inserted;
          totalUpdated += batchResult.updated;
          
          logger.info(`Processed Meta ads batch ${Math.floor(i / this.batchSize) + 1}`, {
            batchStart: i,
            batchEnd: Math.min(i + this.batchSize, adsData.length),
            inserted: batchResult.inserted,
            updated: batchResult.updated
          });

        } catch (error) {
          logger.error(`Meta ads batch processing failed for batch starting at ${i}`, {
            error: error.message,
            batchSize: batch.length
          });
          totalFailed += batch.length;
        }
      }

      // Update sync batch if provided
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          records_processed: adsData.length,
          records_inserted: totalInserted,
          records_updated: totalUpdated,
          records_failed: totalFailed,
          status: totalFailed === 0 ? 'completed' : 'partial'
        });
      }

      const result = {
        inserted: totalInserted,
        updated: totalUpdated,
        failed: totalFailed
      };

      logger.info('Meta Ads batch processing completed', result);
      return result;

    } catch (error) {
      logger.error('Meta Ads batch processing failed', { error: error.message });
      
      if (batchId) {
        await this.supabase.updateSyncBatch(batchId, {
          status: 'failed',
          error_message: error.message
        });
      }
      
      throw error;
    }
  }

  private async processSingleMetaAdsBatch(batch: AdWithCreatives[]): Promise<BatchResult> {
    // Separate ads and creative assets
    const ads = batch.map(item => item.ad as MetaAd);
    const allCreativeAssets = batch.flatMap(item => item.creativeAssets || []);

    let totalInserted = 0;
    let totalUpdated = 0;

    // Process ads first
    if (ads.length > 0) {
      const adsResult = await this.supabase.bulkUpsert(
        'meta_ads_ads',
        ads,
        'ad_id'
      );
      totalInserted += adsResult.inserted;
      totalUpdated += adsResult.updated;
    }

    // Process creative assets
    if (allCreativeAssets.length > 0) {
      const assetsResult = await this.supabase.bulkUpsert(
        'ad_creative_assets',
        allCreativeAssets,
        ['platform', 'platform_asset_id']
      );
      totalInserted += assetsResult.inserted;
      totalUpdated += assetsResult.updated;
    }

    return {
      inserted: totalInserted,
      updated: totalUpdated,
      failed: 0
    };
  }

  async validateDataIntegrity(tableName: string, sampleSize: number = 100): Promise<boolean> {
    try {
      // Get a sample of records to validate
      const { data, error } = await this.supabase.getClient()
        .schema('marketing')
        .from(tableName)
        .select('*')
        .limit(sampleSize);

      if (error) {
        logger.error(`Data validation failed for ${tableName}`, { error: error.message });
        return false;
      }

      // Basic validation checks
      const hasData = data && data.length > 0;
      const hasRequiredFields = data?.every(record => 
        record.created_at && record.updated_at
      );

      const isValid = hasData && hasRequiredFields;
      
      logger.info(`Data validation completed for ${tableName}`, {
        isValid,
        sampleSize: data?.length || 0,
        hasData,
        hasRequiredFields
      });

      return isValid;

    } catch (error) {
      logger.error(`Data validation error for ${tableName}`, { error: error.message });
      return false;
    }
  }

  // Google Ads Performance Processing Methods
  async processGoogleKeywordPerformance(
    performanceData: GoogleAdsKeywordPerformance[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'google_ads_keyword_performance',
      performanceData,
      ['keyword_id', 'date'],
      batchId
    );
  }

  async processGoogleCampaignPerformance(
    performanceData: GoogleAdsCampaignPerformance[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'google_ads_campaign_performance',
      performanceData,
      ['campaign_id', 'date'],
      batchId
    );
  }

  async processGooglePMaxPerformance(
    performanceData: GoogleAdsPMaxPerformance[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'google_ads_pmax_performance',
      performanceData,
      ['campaign_id', 'asset_group_id', 'listing_group_id', 'date'],
      batchId
    );
  }

  // New Google Ads Performance Processing Methods
  async processGoogleAdPerformance(
    performanceData: any[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'google_ads_ad_performance',
      performanceData,
      ['ad_id', 'date'],
      batchId
    );
  }

  async processGoogleAssetPerformance(
    performanceData: any[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'google_ads_asset_performance',
      performanceData,
      ['asset_id', 'date'],
      batchId
    );
  }

  // Meta Ads Performance Processing Methods
  async processMetaCampaignPerformance(
    performanceData: MetaCampaignPerformance[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'meta_ads_campaign_performance',
      performanceData,
      ['campaign_id', 'date'],
      batchId
    );
  }

  async processMetaAdsetPerformance(
    performanceData: MetaAdsetPerformance[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'meta_ads_adset_performance',
      performanceData,
      ['adset_id', 'date'],
      batchId
    );
  }

  async processMetaAdPerformance(
    performanceData: MetaAdPerformance[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'meta_ads_ad_performance',
      performanceData,
      ['ad_id', 'date'],
      batchId
    );
  }

  async processMetaCreativePerformance(
    performanceData: MetaCreativePerformance[],
    batchId?: string
  ): Promise<BatchResult> {
    return this.processPerformanceData(
      'meta_ads_creative_performance',
      performanceData,
      ['creative_id', 'date'],
      batchId
    );
  }
}

export default BatchProcessor;