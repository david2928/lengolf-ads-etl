import SupabaseLoader from './supabase-client';
import BatchProcessor from './batch-processor';
import GoogleAdsExtractor from '@/extractors/google/ads';
import GoogleAdsPerformanceExtractor from '@/extractors/google/performance';
import GoogleAdsSearchTermsExtractor from '@/extractors/google/search-terms';
import GoogleAdsGeographicExtractor from '@/extractors/google/geographic';
import MetaCampaignsExtractor from '@/extractors/meta/campaigns';
import MetaAdSetsExtractor from '@/extractors/meta/ad-sets';
import MetaAdsExtractor from '@/extractors/meta/ads';
import MetaAdsInsightsExtractor from '@/extractors/meta/insights';
import logger from '@/utils/logger';
import { SyncResult, SyncState, SyncParams } from '@/utils/types';

export class IncrementalSyncManager {
  private supabase: SupabaseLoader;
  private batchProcessor: BatchProcessor;
  private googleExtractor: GoogleAdsExtractor;
  private googlePerformanceExtractor: GoogleAdsPerformanceExtractor;
  private googleSearchTermsExtractor: GoogleAdsSearchTermsExtractor;
  private googleGeographicExtractor: GoogleAdsGeographicExtractor;
  private metaCampaignsExtractor: MetaCampaignsExtractor;
  private metaAdSetsExtractor: MetaAdSetsExtractor;
  private metaAdsExtractor: MetaAdsExtractor;
  private metaInsightsExtractor: MetaAdsInsightsExtractor;

  constructor() {
    this.supabase = new SupabaseLoader();
    this.batchProcessor = new BatchProcessor();
    this.googleExtractor = new GoogleAdsExtractor();
    this.googlePerformanceExtractor = new GoogleAdsPerformanceExtractor();
    this.googleSearchTermsExtractor = new GoogleAdsSearchTermsExtractor();
    this.googleGeographicExtractor = new GoogleAdsGeographicExtractor();
    this.metaCampaignsExtractor = new MetaCampaignsExtractor();
    this.metaAdSetsExtractor = new MetaAdSetsExtractor();
    this.metaAdsExtractor = new MetaAdsExtractor();
    this.metaInsightsExtractor = new MetaAdsInsightsExtractor();
  }

  async performIncrementalSync(
    platform: 'google' | 'meta',
    entityType: string,
    options: {
      lookbackHours?: number;
      lookbackDays?: number;
      forceFullSync?: boolean;
      historicalCreativeBackfill?: boolean;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<SyncResult> {
    const startTime = Date.now();
    let batchId = '';
    
    try {
      logger.info('Starting incremental sync', {
        platform,
        entityType,
        options
      });

      // Create sync batch record
      batchId = await this.supabase.createSyncBatch(
        platform,
        options.forceFullSync ? 'full' : 'incremental',
        [entityType]
      );

      // Get last sync state
      const lastSync = await this.getLastSyncState(platform, entityType);
      
      // Calculate sync parameters
      const syncParams = this.calculateSyncParams(lastSync, options);
      
      // Extract data based on platform and entity type
      let extractedData;
      let result: any;

      if (platform === 'google') {
        result = await this.syncGoogleEntity(entityType, syncParams, batchId, options);
      } else {
        result = await this.syncMetaEntity(entityType, syncParams, batchId, options);
      }

      // Update sync batch to completed
      await this.supabase.updateSyncBatch(batchId, {
        status: 'completed',
        records_processed: result.inserted + result.updated,
        records_inserted: result.inserted,
        records_updated: result.updated,
        records_failed: result.failed
      });

      const duration = Date.now() - startTime;
      
      const syncResult: SyncResult = {
        batchId,
        platform,
        entityType,
        recordsProcessed: result.inserted + result.updated + result.failed,
        recordsInserted: result.inserted,
        recordsUpdated: result.updated,
        recordsFailed: result.failed,
        duration,
        status: result.failed === 0 ? 'completed' : 'partial'
      };

      logger.info('Incremental sync completed', syncResult);
      return syncResult;

    } catch (error) {
      logger.error('Incremental sync failed', {
        platform,
        entityType,
        error: error.message
      });

      // Try to update the batch status to failed if batchId exists
      if (batchId) {
        try {
          await this.supabase.updateSyncBatch(batchId, {
            status: 'failed',
            records_processed: 0,
            records_inserted: 0,
            records_updated: 0,
            records_failed: 0,
            error_message: error.message
          });
        } catch (updateError) {
          logger.error('Failed to update batch status to failed', { updateError: updateError.message });
        }
      }

      return {
        batchId,
        platform,
        entityType,
        recordsProcessed: 0,
        recordsInserted: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        duration: Date.now() - startTime,
        status: 'failed',
        errorMessage: error.message
      };
    }
  }

  private async getLastSyncState(platform: string, entityType: string): Promise<SyncState> {
    const lastSync = await this.supabase.getLastSyncState(platform, entityType);
    
    return {
      platform,
      entity_type: entityType,
      last_sync_time: new Date(lastSync.last_sync_time || Date.now() - 7 * 24 * 60 * 60 * 1000),
      last_modified_time: lastSync.last_modified_time ? new Date(lastSync.last_modified_time) : undefined,
      next_page_token: lastSync.next_page_token,
      sync_status: lastSync.sync_status || 'completed',
      error_message: lastSync.error_message
    };
  }

  private calculateSyncParams(
    lastSync: SyncState,
    options: {
      lookbackHours?: number;
      lookbackDays?: number;
      forceFullSync?: boolean;
      historicalCreativeBackfill?: boolean;
    }
  ): SyncParams {
    // For historical creative backfill, remove date filters entirely
    if (options.historicalCreativeBackfill) {
      return {
        modifiedSince: undefined, // No date filtering for historical creative sync
        pageToken: lastSync.next_page_token
      };
    }

    if (options.forceFullSync) {
      return {
        modifiedSince: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
      };
    }

    const lookbackHours = options.lookbackHours || 2;
    const lookbackDays = options.lookbackDays || 0;
    
    let modifiedSince = lastSync.last_modified_time || lastSync.last_sync_time;
    
    // Apply lookback buffer to catch late-arriving data
    if (lookbackHours > 0) {
      modifiedSince = new Date(modifiedSince.getTime() - (lookbackHours * 60 * 60 * 1000));
    }
    
    if (lookbackDays > 0) {
      modifiedSince = new Date(modifiedSince.getTime() - (lookbackDays * 24 * 60 * 60 * 1000));
    }

    return {
      modifiedSince,
      pageToken: lastSync.next_page_token
    };
  }

  private async syncGoogleEntity(
    entityType: string,
    syncParams: SyncParams,
    batchId: string,
    options: any = {}
  ): Promise<any> {
    logger.info('DEBUG: syncGoogleEntity called', { entityType, batchId });
    switch (entityType) {
      case 'campaigns':
        logger.info('DEBUG: Routing to syncGoogleCampaigns');
        return this.syncGoogleCampaigns(syncParams, batchId);
      
      case 'ad_groups':
        logger.info('DEBUG: Routing to syncGoogleAdGroups');
        return this.syncGoogleAdGroups(syncParams, batchId);
      
      case 'ads':
        logger.info('DEBUG: Routing to syncGoogleAds');
        return this.syncGoogleAds(syncParams, batchId);
      
      case 'keywords':
        logger.info('DEBUG: Routing to syncGoogleKeywords');
        return this.syncGoogleKeywords(syncParams, batchId);
      
      case 'performance':
        return this.syncGooglePerformance(syncParams, batchId, options);
      
      case 'ad_performance':
        return this.syncGoogleAdPerformance(syncParams, batchId, options);
      
      case 'asset_performance':
        return this.syncGoogleAssetPerformance(syncParams, batchId, options);

      case 'search_terms':
        return this.syncGoogleSearchTerms(syncParams, batchId, options);

      case 'geographic':
        return this.syncGoogleGeographic(syncParams, batchId, options);

      default:
        throw new Error(`Unknown Google entity type: ${entityType}`);
    }
  }

  private async syncMetaEntity(
    entityType: string,
    syncParams: SyncParams,
    batchId: string,
    options: any = {}
  ): Promise<any> {
    switch (entityType) {
      case 'campaigns':
        return this.syncMetaCampaigns(syncParams, batchId);
      
      case 'adsets':
        return this.syncMetaAdSets(syncParams, batchId);
      
      case 'ads':
        return this.syncMetaAds(syncParams, batchId);
      
      case 'creatives':
        return this.syncMetaCreatives(syncParams, batchId);
      
      case 'insights':
        return this.syncMetaInsights(syncParams, batchId, options);
      
      case 'ad_performance':
        return this.syncMetaAdPerformance(syncParams, batchId, options);
      
      case 'creative_performance':
        return this.syncMetaCreativePerformance(syncParams, batchId, options);
      
      default:
        throw new Error(`Unknown Meta entity type: ${entityType}`);
    }
  }

  private async syncGoogleCampaigns(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      logger.info('Syncing Google Ads campaigns', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        batchId 
      });

      const campaigns = await this.googleExtractor.extractCampaigns(syncParams.modifiedSince);
      const result = await this.batchProcessor.processGoogleCampaigns(campaigns, batchId);

      logger.info('Google campaigns sync completed', {
        campaignCount: campaigns.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Google campaigns sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncGoogleAdGroups(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      logger.info('Syncing Google Ads ad groups', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        batchId 
      });

      const adGroups = await this.googleExtractor.extractAdGroups(undefined, syncParams.modifiedSince);
      const result = await this.batchProcessor.processGoogleAdGroups(adGroups, batchId);

      logger.info('Google ad groups sync completed', {
        adGroupCount: adGroups.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Google ad groups sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncGoogleAds(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      logger.info('Syncing Google Ads with creatives', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        batchId 
      });

      const adsWithCreatives = await this.googleExtractor.extractAdsWithCreatives(
        syncParams.modifiedSince
      );
      
      const result = await this.batchProcessor.processGoogleAdsWithCreatives(
        adsWithCreatives,
        batchId
      );

      logger.info('Google ads sync completed', {
        adCount: adsWithCreatives.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Google ads sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncGoogleKeywords(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      logger.info('🔑 KEYWORD SYNC START', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        batchId,
        extractorType: this.googleExtractor.constructor.name
      });

      // Test if googleExtractor method exists and is callable
      if (!this.googleExtractor.extractKeywords) {
        logger.error('❌ extractKeywords method does not exist on googleExtractor');
        return { inserted: 0, updated: 0, failed: 0 };
      }

      logger.info('🚀 Calling extractKeywords directly...');
      
      try {
        const keywords = await this.googleExtractor.extractKeywords(undefined, syncParams.modifiedSince);
        logger.info('DEBUG: extractKeywords returned', { keywordCount: keywords.length });
        
        const result = await this.batchProcessor.processGoogleKeywords(keywords, batchId);
        logger.info('DEBUG: processGoogleKeywords returned', { result });

        logger.info('Google keywords sync completed', {
          keywordCount: keywords.length,
          result
        });

        return result;
      } catch (innerError) {
        logger.error('DEBUG: Error during keyword extraction/processing', { 
          error: innerError.message, 
          stack: innerError.stack 
        });
        throw innerError;
      }

    } catch (error) {
      logger.error('Google keywords sync failed', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  private async syncGooglePerformance(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;
      
      logger.info('Syncing Google Ads performance data', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        options,
        batchId 
      });

      // Extract all performance data types in parallel
      const [keywordPerformance, campaignPerformance, pmaxPerformance] = await Promise.all([
        this.googlePerformanceExtractor.extractKeywordPerformance(
          startDate,
          endDate,
          // For specific date ranges, don't use modifiedSince filter  
          startDate && endDate ? undefined : syncParams.modifiedSince
        ),
        this.googlePerformanceExtractor.extractCampaignPerformance(
          startDate,
          endDate,
          startDate && endDate ? undefined : syncParams.modifiedSince
        ),
        this.googlePerformanceExtractor.extractPMaxPerformance(
          startDate,
          endDate,
          startDate && endDate ? undefined : syncParams.modifiedSince
        )
      ]);

      // Process all performance data in parallel
      const [keywordResult, campaignResult, pmaxResult] = await Promise.all([
        this.batchProcessor.processGoogleKeywordPerformance(keywordPerformance, batchId),
        this.batchProcessor.processGoogleCampaignPerformance(campaignPerformance, batchId),
        this.batchProcessor.processGooglePMaxPerformance(pmaxPerformance, batchId)
      ]);

      const totalResult = {
        inserted: keywordResult.inserted + campaignResult.inserted + pmaxResult.inserted,
        updated: keywordResult.updated + campaignResult.updated + pmaxResult.updated,
        failed: keywordResult.failed + campaignResult.failed + pmaxResult.failed
      };

      logger.info('Google performance sync completed', {
        keywordRecords: keywordPerformance.length,
        campaignRecords: campaignPerformance.length,
        pmaxRecords: pmaxPerformance.length,
        result: totalResult
      });

      return totalResult;

    } catch (error) {
      logger.error('Google performance sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncMetaCampaigns(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      logger.info('Syncing Meta campaigns', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        batchId 
      });

      const campaigns = await this.metaCampaignsExtractor.extractCampaigns(syncParams.modifiedSince);
      const result = await this.batchProcessor.processMetaCampaigns(campaigns, batchId);

      logger.info('Meta campaigns sync completed', {
        campaignCount: campaigns.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Meta campaigns sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncMetaAdSets(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      logger.info('Syncing Meta ad sets', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        batchId 
      });

      const adSets = await this.metaAdSetsExtractor.extractAdSets(undefined, syncParams.modifiedSince);
      const result = await this.batchProcessor.processMetaAdSets(adSets, batchId);

      logger.info('Meta ad sets sync completed', {
        adSetCount: adSets.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Meta ad sets sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncMetaAds(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      const isHistoricalBackfill = !syncParams.modifiedSince;
      logger.info('Syncing Meta ads with creatives', { 
        modifiedSince: syncParams.modifiedSince?.toISOString() || 'No date filter (historical backfill)',
        historicalBackfill: isHistoricalBackfill,
        batchId 
      });

      const adsWithCreatives = await this.metaAdsExtractor.extractAdsWithCreatives(
        undefined,
        syncParams.modifiedSince
      );
      
      const result = await this.batchProcessor.processMetaAdsWithCreatives(
        adsWithCreatives,
        batchId
      );

      logger.info('Meta ads sync completed', {
        adCount: adsWithCreatives.length,
        historicalBackfill: isHistoricalBackfill,
        result
      });

      return result;

    } catch (error) {
      logger.error('Meta ads sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncMetaCreatives(syncParams: SyncParams, batchId: string): Promise<any> {
    try {
      const isHistoricalBackfill = !syncParams.modifiedSince;
      logger.info('Syncing Meta creatives', { 
        modifiedSince: syncParams.modifiedSince?.toISOString() || 'No date filter (historical backfill)',
        historicalBackfill: isHistoricalBackfill,
        batchId 
      });

      // Meta creatives are extracted as part of ads extraction
      // This method is kept for consistency but delegates to ads sync
      return this.syncMetaAds(syncParams, batchId);

    } catch (error) {
      logger.error('Meta creatives sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncGoogleAdPerformance(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;
      
      logger.info('Syncing Google Ads ad performance data', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        batchId 
      });

      const adPerformance = await this.googlePerformanceExtractor.extractAdPerformance(
        startDate,
        endDate,
        startDate && endDate ? undefined : syncParams.modifiedSince
      );

      const result = await this.batchProcessor.processGoogleAdPerformance(adPerformance, batchId);

      logger.info('Google ad performance sync completed', {
        adPerformanceRecords: adPerformance.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Google ad performance sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncGoogleAssetPerformance(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;
      
      logger.info('Syncing Google Ads asset performance data', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        batchId 
      });

      const assetPerformance = await this.googlePerformanceExtractor.extractAssetPerformance(
        startDate,
        endDate,
        startDate && endDate ? undefined : syncParams.modifiedSince
      );

      const result = await this.batchProcessor.processGoogleAssetPerformance(assetPerformance, batchId);

      logger.info('Google asset performance sync completed', {
        assetPerformanceRecords: assetPerformance.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Google asset performance sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncGoogleSearchTerms(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;

      logger.info('Syncing Google Ads search term data', {
        modifiedSince: syncParams.modifiedSince?.toISOString(),
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        batchId
      });

      const searchTermData = await this.googleSearchTermsExtractor.extractSearchTermPerformance(
        startDate,
        endDate,
        startDate && endDate ? undefined : syncParams.modifiedSince
      );

      const result = await this.batchProcessor.processGoogleSearchTermPerformance(searchTermData, batchId);

      logger.info('Google search terms sync completed', {
        searchTermRecords: searchTermData.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Google search terms sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncGoogleGeographic(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;

      logger.info('Syncing Google Ads geographic data', {
        modifiedSince: syncParams.modifiedSince?.toISOString(),
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        batchId
      });

      const geoData = await this.googleGeographicExtractor.extractGeographicPerformance(
        startDate,
        endDate,
        startDate && endDate ? undefined : syncParams.modifiedSince
      );

      const result = await this.batchProcessor.processGoogleGeographicPerformance(geoData, batchId);

      logger.info('Google geographic sync completed', {
        geographicRecords: geoData.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Google geographic sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncMetaAdPerformance(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;
      
      logger.info('Syncing Meta ad performance data', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        batchId 
      });

      const adPerformance = await this.metaInsightsExtractor.extractAdPerformance(
        startDate,
        endDate,
        startDate ? undefined : syncParams.modifiedSince
      );

      const result = await this.batchProcessor.processMetaAdPerformance(adPerformance, batchId);

      logger.info('Meta ad performance sync completed', {
        adPerformanceRecords: adPerformance.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Meta ad performance sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncMetaCreativePerformance(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;
      
      logger.info('Syncing Meta creative performance data', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        batchId 
      });

      const creativePerformance = await this.metaInsightsExtractor.extractCreativePerformance(
        startDate,
        endDate,
        startDate ? undefined : syncParams.modifiedSince
      );

      const result = await this.batchProcessor.processMetaCreativePerformance(creativePerformance, batchId);

      logger.info('Meta creative performance sync completed', {
        creativePerformanceRecords: creativePerformance.length,
        result
      });

      return result;

    } catch (error) {
      logger.error('Meta creative performance sync failed', { error: error.message });
      throw error;
    }
  }

  private async syncMetaInsights(syncParams: SyncParams, batchId: string, options: any = {}): Promise<any> {
    try {
      logger.info('Syncing Meta insights data', { 
        modifiedSince: syncParams.modifiedSince.toISOString(),
        batchId 
      });

      // Extract all performance data types in parallel
      // Use explicit date range from options if provided, otherwise use modifiedSince for incremental
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      const endDate = options.endDate ? new Date(options.endDate) : undefined;
      
      const performanceData = await this.metaInsightsExtractor.extractAllPerformanceData(
        startDate,
        endDate, 
        startDate ? undefined : syncParams.modifiedSince  // Only use modifiedSince if no explicit startDate
      );

      // Process all performance data types in parallel
      const [campaignResult, adsetResult, adResult, creativeResult] = await Promise.all([
        this.batchProcessor.processMetaCampaignPerformance(performanceData.campaigns, batchId),
        this.batchProcessor.processMetaAdsetPerformance(performanceData.adsets, batchId),
        this.batchProcessor.processMetaAdPerformance(performanceData.ads, batchId),
        this.batchProcessor.processMetaCreativePerformance(performanceData.creatives, batchId)
      ]);

      const totalResult = {
        inserted: campaignResult.inserted + adsetResult.inserted + adResult.inserted + creativeResult.inserted,
        updated: campaignResult.updated + adsetResult.updated + adResult.updated + creativeResult.updated,
        failed: campaignResult.failed + adsetResult.failed + adResult.failed + creativeResult.failed
      };

      logger.info('Meta insights sync completed', {
        campaignRecords: performanceData.campaigns.length,
        adsetRecords: performanceData.adsets.length,
        adRecords: performanceData.ads.length,
        creativeRecords: performanceData.creatives.length,
        result: totalResult
      });

      return totalResult;

    } catch (error) {
      logger.error('Meta insights sync failed', { error: error.message });
      throw error;
    }
  }


  async syncCampaigns(
    platform: 'google' | 'meta',
    mode: 'incremental' | 'full' | 'historical-backfill',
    options: any
  ): Promise<SyncResult> {
    return this.performIncrementalSync(platform, 'campaigns', {
      ...options,
      forceFullSync: mode === 'full',
      historicalCreativeBackfill: mode === 'historical-backfill'
    });
  }

  async syncAdGroups(
    platform: 'google' | 'meta',
    mode: 'incremental' | 'full' | 'historical-backfill',
    options: any
  ): Promise<SyncResult> {
    const entityType = platform === 'google' ? 'ad_groups' : 'adsets';
    return this.performIncrementalSync(platform, entityType, {
      ...options,
      forceFullSync: mode === 'full',
      historicalCreativeBackfill: mode === 'historical-backfill'
    });
  }

  async syncAds(
    platform: 'google' | 'meta',
    mode: 'incremental' | 'full' | 'historical-backfill',
    options: any
  ): Promise<SyncResult> {
    return this.performIncrementalSync(platform, 'ads', {
      ...options,
      forceFullSync: mode === 'full',
      historicalCreativeBackfill: mode === 'historical-backfill'
    });
  }

  async syncCreatives(
    platform: 'google' | 'meta',
    mode: 'incremental' | 'full' | 'historical-backfill',
    options: any
  ): Promise<SyncResult> {
    return this.performIncrementalSync(platform, 'creatives', {
      ...options,
      forceFullSync: mode === 'full',
      historicalCreativeBackfill: mode === 'historical-backfill'
    });
  }

  async syncKeywords(
    platform: 'google' | 'meta',
    mode: 'incremental' | 'full' | 'historical-backfill',
    options: any
  ): Promise<SyncResult> {
    if (platform !== 'google') {
      throw new Error('Keywords are only available for Google Ads');
    }
    
    return this.performIncrementalSync(platform, 'keywords', {
      ...options,
      forceFullSync: mode === 'full',
      historicalCreativeBackfill: mode === 'historical-backfill'
    });
  }

  async syncPerformance(
    platform: 'google' | 'meta',
    mode: 'incremental' | 'full' | 'historical-backfill',
    options: any
  ): Promise<SyncResult> {
    const entityType = platform === 'google' ? 'performance' : 'insights';
    return this.performIncrementalSync(platform, entityType, {
      ...options,
      forceFullSync: mode === 'full',
      historicalCreativeBackfill: mode === 'historical-backfill'
    });
  }
}

export default IncrementalSyncManager;