import { Router, Request, Response } from 'express';
import { asyncHandler } from '@/api/middleware/error-handler';
import IncrementalSyncManager from '@/loaders/incremental-sync';
import GoogleAdsClient from '@/extractors/google/client';
import logger from '@/utils/logger';
import { SyncRequest } from '@/utils/types';

const router = Router();
const syncManager = new IncrementalSyncManager();

// Main sync endpoint
router.post('/sync', asyncHandler(async (req: Request, res: Response) => {
  const { 
    platform = 'all', 
    mode = 'incremental',
    entities = [],
    lookbackHours = 2,
    lookbackDays = 0,
    startDate,
    endDate
  }: SyncRequest = req.body;

  // Validate request
  if (!entities.length) {
    return res.status(400).json({
      success: false,
      error: 'At least one entity type must be specified'
    });
  }

  const validEntityTypes = [
    'campaigns', 'ad_groups', 'adsets', 'ads', 'creatives', 'keywords',
    'performance', 'insights', 'ad_performance', 'creative_performance', 'asset_performance',
    'search_terms', 'geographic'
  ];
  
  const invalidEntities = entities.filter(entity => !validEntityTypes.includes(entity));
  if (invalidEntities.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Invalid entity types: ${invalidEntities.join(', ')}. Valid types: ${validEntityTypes.join(', ')}`
    });
  }

  const validPlatforms = ['google', 'meta', 'all'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({
      success: false,
      error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`
    });
  }

  const validModes = ['incremental', 'full', 'historical-backfill'];
  if (!validModes.includes(mode)) {
    return res.status(400).json({
      success: false,
      error: `Invalid mode. Must be one of: ${validModes.join(', ')}`
    });
  }

  try {
    logger.info('Sync request received', {
      platform,
      mode,
      entities,
      lookbackHours,
      lookbackDays,
      requestId: req.headers['x-request-id']
    });

    // Determine platforms to process
    const platforms = platform === 'all' ? ['google', 'meta'] : [platform];
    const results = [];

    for (const plt of platforms) {
      for (const entity of entities) {
        try {
          logger.info(`Starting sync for ${plt}.${entity}`, { platform: plt, entity });

          let syncResult;
          const options = { 
            lookbackHours, 
            lookbackDays,
            startDate,
            endDate
          };

          // Route to appropriate sync method
          switch (entity) {
            case 'campaigns':
              syncResult = await syncManager.syncCampaigns(plt as 'google' | 'meta', mode, options);
              break;
            
            case 'ad_groups':
            case 'adsets':
              syncResult = await syncManager.syncAdGroups(plt as 'google' | 'meta', mode, options);
              break;
            
            case 'ads':
              syncResult = await syncManager.syncAds(plt as 'google' | 'meta', mode, options);
              break;
            
            case 'creatives':
              syncResult = await syncManager.syncCreatives(plt as 'google' | 'meta', mode, options);
              break;
            
            case 'keywords':
              if (plt === 'google') {
                syncResult = await syncManager.syncKeywords(plt, mode, options);
              } else {
                logger.warn(`Keywords not supported for platform: ${plt}`);
                continue;
              }
              break;
            
            case 'performance':
            case 'insights':
              syncResult = await syncManager.syncPerformance(plt as 'google' | 'meta', mode, options);
              break;
            
            case 'ad_performance':
              syncResult = await syncManager.performIncrementalSync(plt as 'google' | 'meta', 'ad_performance', {
                ...options,
                forceFullSync: mode === 'full'
              });
              break;
            
            case 'creative_performance':
              if (plt === 'meta') {
                syncResult = await syncManager.performIncrementalSync(plt, 'creative_performance', {
                  ...options,
                  forceFullSync: mode === 'full'
                });
              } else {
                logger.warn(`Creative performance not supported for platform: ${plt}`);
                continue;
              }
              break;
            
            case 'asset_performance':
              if (plt === 'google') {
                syncResult = await syncManager.performIncrementalSync(plt, 'asset_performance', {
                  ...options,
                  forceFullSync: mode === 'full'
                });
              } else {
                logger.warn(`Asset performance not supported for platform: ${plt}`);
                continue;
              }
              break;

            case 'search_terms':
              if (plt === 'google') {
                syncResult = await syncManager.performIncrementalSync(plt, 'search_terms', {
                  ...options,
                  forceFullSync: mode === 'full'
                });
              } else {
                logger.warn(`Search terms not supported for platform: ${plt}`);
                continue;
              }
              break;

            case 'geographic':
              if (plt === 'google') {
                syncResult = await syncManager.performIncrementalSync(plt, 'geographic', {
                  ...options,
                  forceFullSync: mode === 'full'
                });
              } else {
                logger.warn(`Geographic performance not supported for platform: ${plt}`);
                continue;
              }
              break;

            default:
              logger.error(`Unknown entity type: ${entity}`, { platform: plt, entity });
              continue;
          }

          results.push(syncResult);
          
          logger.info(`Sync completed for ${plt}.${entity}`, {
            platform: plt,
            entity,
            result: syncResult
          });

        } catch (error) {
          logger.error(`Sync failed for ${plt}.${entity}`, {
            platform: plt,
            entity,
            error: error.message
          });

          results.push({
            batchId: '',
            platform: plt,
            entityType: entity,
            recordsProcessed: 0,
            recordsInserted: 0,
            recordsUpdated: 0,
            recordsFailed: 0,
            duration: 0,
            status: 'failed',
            errorMessage: error.message
          });
        }
      }
    }

    // Calculate summary
    const summary = {
      totalBatches: results.length,
      successfulBatches: results.filter(r => r.status === 'completed').length,
      failedBatches: results.filter(r => r.status === 'failed').length,
      partialBatches: results.filter(r => r.status === 'partial').length,
      totalRecordsProcessed: results.reduce((sum, r) => sum + r.recordsProcessed, 0),
      totalRecordsInserted: results.reduce((sum, r) => sum + r.recordsInserted, 0),
      totalRecordsUpdated: results.reduce((sum, r) => sum + r.recordsUpdated, 0),
      totalRecordsFailed: results.reduce((sum, r) => sum + r.recordsFailed, 0),
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0)
    };

    const overallStatus = summary.failedBatches === 0 
      ? 'completed'
      : summary.successfulBatches === 0 
        ? 'failed'
        : 'partial';

    res.json({
      success: overallStatus !== 'failed',
      status: overallStatus,
      message: `Sync ${overallStatus} for ${platforms.join(', ')} - ${entities.join(', ')}`,
      summary,
      results
    });

  } catch (error) {
    logger.error('Sync request failed', {
      error: error.message,
      platform,
      mode,
      entities
    });

    res.status(500).json({
      success: false,
      error: 'Sync request failed',
      message: error.message
    });
  }
}));

// Test connection endpoint
router.post('/test-connection', asyncHandler(async (req: Request, res: Response) => {
  const { platform } = req.body;

  if (!platform || !['google', 'meta'].includes(platform)) {
    return res.status(400).json({
      success: false,
      error: 'Platform must be either "google" or "meta"'
    });
  }

  try {
    let connectionTest = false;

    if (platform === 'google') {
      const GoogleAdsClient = (await import('@/extractors/google/client')).default;
      const client = new GoogleAdsClient();
      connectionTest = await client.testConnection();
    } else {
      // TODO: Implement Meta connection test
      connectionTest = false;
    }

    res.json({
      success: connectionTest,
      platform,
      status: connectionTest ? 'connected' : 'failed',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(`Connection test failed for ${platform}`, { error: error.message });
    
    res.status(500).json({
      success: false,
      platform,
      status: 'failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}));

// Refresh tokens endpoint
router.post('/auth/refresh', asyncHandler(async (req: Request, res: Response) => {
  const { platform } = req.body;

  if (!platform || !['google', 'meta'].includes(platform)) {
    return res.status(400).json({
      success: false,
      error: 'Platform must be either "google" or "meta"'
    });
  }

  try {
    const TokenManager = (await import('@/auth/token-manager')).default;
    const tokenManager = new TokenManager();

    let newToken: string;

    if (platform === 'google') {
      newToken = await tokenManager.getValidGoogleToken();
    } else {
      newToken = await tokenManager.getValidMetaToken();
    }

    logger.info(`Token refreshed successfully for ${platform}`);

    res.json({
      success: true,
      platform,
      message: `${platform} token refreshed successfully`,
      tokenLength: newToken.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(`Token refresh failed for ${platform}`, { error: error.message });
    
    res.status(500).json({
      success: false,
      platform,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}));

// Debug GAQL query endpoint
router.post('/debug/gaql', asyncHandler(async (req: Request, res: Response) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'GAQL query is required'
    });
  }

  try {
    const client = new GoogleAdsClient();
    const startTime = Date.now();
    const results = await client.executeQuery(query);
    const duration = Date.now() - startTime;

    res.json({
      success: true,
      query: query.substring(0, 200) + '...',
      resultCount: results.length,
      duration,
      sampleResult: results.length > 0 ? results[0] : null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Debug GAQL query failed', { 
      query: query.substring(0, 200),
      error: error.message,
      fullError: error 
    });
    
    res.status(500).json({
      success: false,
      query: query.substring(0, 200) + '...',
      error: error.message,
      errorType: error.constructor?.name,
      timestamp: new Date().toISOString()
    });
  }
}));

// Status endpoint for monitoring
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Get recent sync batch information
    const recentBatches = await (async () => {
      try {
        const SupabaseLoader = (await import('@/loaders/supabase-client')).default;
        const supabase = new SupabaseLoader();
        
        // Query recent sync batches from the last 24 hours
        const { data } = await supabase.getClient()
          .schema('marketing')
          .from('etl_sync_log')
          .select('*')
          .gte('started_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('started_at', { ascending: false })
          .limit(10);
        
        return data || [];
      } catch (error) {
        logger.warn('Could not fetch recent sync batches', { error: error.message });
        return [];
      }
    })();

    // Get data freshness information
    const dataFreshness = await (async () => {
      try {
        const SupabaseLoader = (await import('@/loaders/supabase-client')).default;
        const supabase = new SupabaseLoader();
        
        const tables = [
          'google_ads_campaigns',
          'google_ads_keywords', 
          'google_ads_keyword_performance',
          'meta_ads_campaigns',
          'meta_ads_ads'
        ];
        
        const freshness = {};
        for (const table of tables) {
          try {
            const { data } = await supabase.getClient()
              .schema('marketing')
              .from(table)
              .select('updated_at')
              .order('updated_at', { ascending: false })
              .limit(1);
            
            freshness[table] = data?.[0]?.updated_at || null;
          } catch (error) {
            freshness[table] = null;
          }
        }
        
        return freshness;
      } catch (error) {
        logger.warn('Could not fetch data freshness', { error: error.message });
        return {};
      }
    })();

    const status = {
      service: 'lengolf-ads-etl',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      recentSyncs: recentBatches.length,
      lastSyncTime: recentBatches[0]?.started_at || null,
      dataFreshness
    };

    res.json(status);

  } catch (error) {
    logger.error('Status endpoint failed', { error: error.message });
    
    res.status(500).json({
      service: 'lengolf-ads-etl',
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
}));

// Emergency reload endpoint for specific date ranges
router.post('/emergency-reload', asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate, platform = 'google' } = req.body;

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: 'startDate and endDate are required (YYYY-MM-DD format)'
    });
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return res.status(400).json({
      success: false,
      error: 'Dates must be in YYYY-MM-DD format'
    });
  }

  try {
    logger.info('Emergency reload requested', {
      startDate,
      endDate,
      platform,
      requestId: req.headers['x-request-id']
    });

    const EmergencyReload = (await import('@/utils/emergency-reload')).default;
    const reloader = new EmergencyReload();
    
    const result = await reloader.reloadDateRange(startDate, endDate, platform);

    res.json({
      success: true,
      message: `Emergency reload completed for ${platform}`,
      ...result
    });

  } catch (error) {
    logger.error('Emergency reload failed', {
      error: error.message,
      startDate,
      endDate,
      platform
    });

    res.status(500).json({
      success: false,
      error: 'Emergency reload failed',
      message: error.message
    });
  }
}));

export default router;