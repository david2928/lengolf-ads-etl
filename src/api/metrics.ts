import { Router, Request, Response } from 'express';
import { asyncHandler } from '@/api/middleware/error-handler';
import SupabaseLoader from '@/loaders/supabase-client';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';

const router = Router();
const supabase = new SupabaseLoader();

// Prometheus-style metrics endpoint
router.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
  try {
    const metrics = await generatePrometheusMetrics();
    
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);

  } catch (error) {
    logger.error('Failed to generate metrics', { error: getErrorMessage(error) });
    res.status(500).json({
      success: false,
      error: 'Failed to generate metrics'
    });
  }
}));

// JSON metrics endpoint
router.get('/metrics/json', asyncHandler(async (req: Request, res: Response) => {
  try {
    const metrics = await generateJsonMetrics();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics
    });

  } catch (error) {
    logger.error('Failed to generate JSON metrics', { error: getErrorMessage(error) });
    res.status(500).json({
      success: false,
      error: 'Failed to generate metrics'
    });
  }
}));

async function generatePrometheusMetrics(): Promise<string> {
  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  // Get sync data
  const { data: syncData, error: syncError } = await supabase.getClient()
    .from('marketing.etl_sync_log')
    .select('platform, status, records_processed, records_inserted, records_failed, start_time, end_time')
    .gte('start_time', oneDayAgo);

  if (syncError) {
    throw new Error(`Failed to get sync data: ${syncError.message}`);
  }

  // Get recent data for rates
  const { data: recentData, error: recentError } = await supabase.getClient()
    .from('marketing.etl_sync_log')
    .select('platform, records_processed, records_inserted')
    .gte('start_time', oneHourAgo)
    .eq('status', 'completed');

  if (recentError) {
    throw new Error(`Failed to get recent data: ${recentError.message}`);
  }

  let metrics = '';

  // ETL sync metrics
  metrics += '# HELP etl_syncs_total Total number of ETL syncs\n';
  metrics += '# TYPE etl_syncs_total counter\n';
  
  const syncsByPlatformStatus: Record<string, number> = {};
  syncData.forEach((sync: any) => {
    const key = `${sync.platform}_${sync.status}`;
    syncsByPlatformStatus[key] = (syncsByPlatformStatus[key] || 0) + 1;
  });

  Object.entries(syncsByPlatformStatus).forEach(([key, count]) => {
    const [platform, status] = key.split('_');
    metrics += `etl_syncs_total{platform="${platform}",status="${status}"} ${count}\n`;
  });

  // Records processed
  metrics += '\n# HELP etl_records_processed_total Total number of records processed\n';
  metrics += '# TYPE etl_records_processed_total counter\n';
  
  const recordsByPlatform: Record<string, number> = {};
  syncData.forEach((sync: any) => {
    recordsByPlatform[sync.platform] = (recordsByPlatform[sync.platform] || 0) + (sync.records_processed || 0);
  });

  Object.entries(recordsByPlatform).forEach(([platform, count]) => {
    metrics += `etl_records_processed_total{platform="${platform}"} ${count}\n`;
  });

  // Records inserted
  metrics += '\n# HELP etl_records_inserted_total Total number of records inserted\n';
  metrics += '# TYPE etl_records_inserted_total counter\n';
  
  const insertedByPlatform = {};
  syncData.forEach(sync => {
    insertedByPlatform[sync.platform] = (insertedByPlatform[sync.platform] || 0) + (sync.records_inserted || 0);
  });

  Object.entries(insertedByPlatform).forEach(([platform, count]) => {
    metrics += `etl_records_inserted_total{platform="${platform}"} ${count}\n`;
  });

  // Failed records
  metrics += '\n# HELP etl_records_failed_total Total number of failed records\n';
  metrics += '# TYPE etl_records_failed_total counter\n';
  
  const failedByPlatform = {};
  syncData.forEach(sync => {
    failedByPlatform[sync.platform] = (failedByPlatform[sync.platform] || 0) + (sync.records_failed || 0);
  });

  Object.entries(failedByPlatform).forEach(([platform, count]) => {
    metrics += `etl_records_failed_total{platform="${platform}"} ${count}\n`;
  });

  // Sync duration
  metrics += '\n# HELP etl_sync_duration_seconds Sync duration in seconds\n';
  metrics += '# TYPE etl_sync_duration_seconds histogram\n';
  
  const completedSyncs = syncData.filter(s => s.status === 'completed' && s.end_time);
  completedSyncs.forEach(sync => {
    const duration = (new Date(sync.end_time).getTime() - new Date(sync.start_time).getTime()) / 1000;
    metrics += `etl_sync_duration_seconds{platform="${sync.platform}"} ${duration}\n`;
  });

  // Processing rate (records per hour)
  metrics += '\n# HELP etl_processing_rate_per_hour Records processed per hour\n';
  metrics += '# TYPE etl_processing_rate_per_hour gauge\n';
  
  const rateByPlatform = {};
  recentData.forEach(sync => {
    rateByPlatform[sync.platform] = (rateByPlatform[sync.platform] || 0) + (sync.records_processed || 0);
  });

  Object.entries(rateByPlatform).forEach(([platform, count]) => {
    metrics += `etl_processing_rate_per_hour{platform="${platform}"} ${count}\n`;
  });

  // Success rate
  metrics += '\n# HELP etl_success_rate Success rate of syncs (0-1)\n';
  metrics += '# TYPE etl_success_rate gauge\n';
  
  const successRateByPlatform = {};
  ['google', 'meta'].forEach(platform => {
    const platformSyncs = syncData.filter(s => s.platform === platform);
    const completedSyncs = platformSyncs.filter(s => s.status === 'completed');
    const rate = platformSyncs.length > 0 ? completedSyncs.length / platformSyncs.length : 0;
    successRateByPlatform[platform] = rate;
  });

  Object.entries(successRateByPlatform).forEach(([platform, rate]) => {
    metrics += `etl_success_rate{platform="${platform}"} ${rate}\n`;
  });

  // Currently running syncs
  metrics += '\n# HELP etl_running_syncs Currently running syncs\n';
  metrics += '# TYPE etl_running_syncs gauge\n';
  
  const runningSyncs = syncData.filter(s => s.status === 'running');
  const runningByPlatform = {};
  runningSyncs.forEach(sync => {
    runningByPlatform[sync.platform] = (runningByPlatform[sync.platform] || 0) + 1;
  });

  Object.entries(runningByPlatform).forEach(([platform, count]) => {
    metrics += `etl_running_syncs{platform="${platform}"} ${count}\n`;
  });

  // Application metrics
  const memUsage = process.memoryUsage();
  metrics += '\n# HELP nodejs_memory_usage_bytes Node.js memory usage\n';
  metrics += '# TYPE nodejs_memory_usage_bytes gauge\n';
  metrics += `nodejs_memory_usage_bytes{type="rss"} ${memUsage.rss}\n`;
  metrics += `nodejs_memory_usage_bytes{type="heapTotal"} ${memUsage.heapTotal}\n`;
  metrics += `nodejs_memory_usage_bytes{type="heapUsed"} ${memUsage.heapUsed}\n`;
  metrics += `nodejs_memory_usage_bytes{type="external"} ${memUsage.external}\n`;

  metrics += '\n# HELP nodejs_uptime_seconds Node.js uptime in seconds\n';
  metrics += '# TYPE nodejs_uptime_seconds gauge\n';
  metrics += `nodejs_uptime_seconds ${process.uptime()}\n`;

  return metrics;
}

async function generateJsonMetrics(): Promise<any> {
  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  // Get sync data
  const { data: syncData, error: syncError } = await supabase.getClient()
    .from('marketing.etl_sync_log')
    .select('*')
    .gte('start_time', oneDayAgo);

  if (syncError) {
    throw new Error(`Failed to get sync data: ${syncError.message}`);
  }

  // Calculate metrics by platform
  const platformMetrics = {};
  ['google', 'meta'].forEach(platform => {
    const platformSyncs = syncData.filter(s => s.platform === platform);
    const completed = platformSyncs.filter(s => s.status === 'completed');
    const failed = platformSyncs.filter(s => s.status === 'failed');
    const running = platformSyncs.filter(s => s.status === 'running');

    const totalRecords = platformSyncs.reduce((sum, s) => sum + (s.records_processed || 0), 0);
    const totalInserted = platformSyncs.reduce((sum, s) => sum + (s.records_inserted || 0), 0);
    const totalFailed = platformSyncs.reduce((sum, s) => sum + (s.records_failed || 0), 0);

    const avgDuration = completed.length > 0
      ? completed.reduce((sum, s) => {
          const duration = new Date(s.end_time).getTime() - new Date(s.start_time).getTime();
          return sum + duration;
        }, 0) / completed.length / 1000
      : 0;

    platformMetrics[platform] = {
      syncs: {
        total: platformSyncs.length,
        completed: completed.length,
        failed: failed.length,
        running: running.length,
        successRate: platformSyncs.length > 0 ? completed.length / platformSyncs.length : 0
      },
      records: {
        processed: totalRecords,
        inserted: totalInserted,
        failed: totalFailed,
        successRate: totalRecords > 0 ? totalInserted / totalRecords : 0
      },
      performance: {
        avgDurationSeconds: Math.round(avgDuration),
        recordsPerHour: calculateHourlyRate(platformSyncs, oneHourAgo)
      }
    };
  });

  // Overall metrics
  const totalSyncs = syncData.length;
  const completedSyncs = syncData.filter(s => s.status === 'completed').length;
  const failedSyncs = syncData.filter(s => s.status === 'failed').length;
  const runningSyncs = syncData.filter(s => s.status === 'running').length;

  const overall = {
    syncs: {
      total: totalSyncs,
      completed: completedSyncs,
      failed: failedSyncs,
      running: runningSyncs,
      successRate: totalSyncs > 0 ? completedSyncs / totalSyncs : 0
    },
    records: {
      processed: syncData.reduce((sum, s) => sum + (s.records_processed || 0), 0),
      inserted: syncData.reduce((sum, s) => sum + (s.records_inserted || 0), 0),
      failed: syncData.reduce((sum, s) => sum + (s.records_failed || 0), 0)
    },
    application: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      nodeVersion: process.version
    }
  };

  return {
    overall,
    byPlatform: platformMetrics,
    period: {
      last24Hours: oneDayAgo,
      lastHour: oneHourAgo
    }
  };
}

function calculateHourlyRate(syncs: any[], since: string): number {
  const recentSyncs = syncs.filter(s => 
    s.start_time >= since && s.status === 'completed'
  );
  
  return recentSyncs.reduce((sum, s) => sum + (s.records_processed || 0), 0);
}

export default router;