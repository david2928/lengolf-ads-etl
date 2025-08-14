import { Router, Request, Response } from 'express';
import { asyncHandler } from '@/api/middleware/error-handler';
import SupabaseLoader from '@/loaders/supabase-client';
import logger from '@/utils/logger';

const router = Router();
const supabase = new SupabaseLoader();

// Get sync status by batch ID
router.get('/status/:batchId', asyncHandler(async (req: Request, res: Response) => {
  const { batchId } = req.params;

  if (!batchId) {
    return res.status(400).json({
      success: false,
      error: 'Batch ID is required'
    });
  }

  try {
    const { data, error } = await supabase.getClient()
      .from('marketing.etl_sync_log')
      .select('*')
      .eq('id', batchId)
      .single();

    if (error) {
      logger.error('Failed to get sync status', { batchId, error: error.message });
      return res.status(404).json({
        success: false,
        error: 'Batch not found'
      });
    }

    // Calculate progress percentage
    const progress = data.records_processed > 0 
      ? Math.round(((data.records_inserted + data.records_updated) / data.records_processed) * 100)
      : 0;

    // Calculate duration
    const duration = data.end_time 
      ? new Date(data.end_time).getTime() - new Date(data.start_time).getTime()
      : Date.now() - new Date(data.start_time).getTime();

    res.json({
      success: true,
      batchId: data.id,
      platform: data.platform,
      entityType: data.entity_type,
      syncType: data.sync_type,
      status: data.status,
      progress,
      details: {
        startTime: data.start_time,
        endTime: data.end_time,
        duration: Math.round(duration / 1000), // seconds
        recordsProcessed: data.records_processed,
        recordsInserted: data.records_inserted,
        recordsUpdated: data.records_updated,
        recordsFailed: data.records_failed,
        errorMessage: data.error_message,
        lastModifiedTime: data.last_modified_time,
        nextPageToken: data.next_page_token
      }
    });

  } catch (error) {
    logger.error('Get sync status error', { batchId, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status'
    });
  }
}));

// Get recent sync history
router.get('/recent', asyncHandler(async (req: Request, res: Response) => {
  const { 
    platform, 
    entity_type, 
    status, 
    limit = 50,
    hours = 24 
  } = req.query;

  try {
    let query = supabase.getClient()
      .from('marketing.etl_sync_log')
      .select('*')
      .gte('start_time', new Date(Date.now() - Number(hours) * 60 * 60 * 1000).toISOString())
      .order('start_time', { ascending: false })
      .limit(Number(limit));

    // Apply filters
    if (platform) {
      query = query.eq('platform', platform);
    }
    
    if (entity_type) {
      query = query.eq('entity_type', entity_type);
    }
    
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to get recent sync history', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get sync history'
      });
    }

    // Calculate summary statistics
    const summary = {
      totalSyncs: data.length,
      completedSyncs: data.filter(s => s.status === 'completed').length,
      failedSyncs: data.filter(s => s.status === 'failed').length,
      runningSyncs: data.filter(s => s.status === 'running').length,
      totalRecordsProcessed: data.reduce((sum, s) => sum + (s.records_processed || 0), 0),
      avgDuration: data.length > 0 
        ? Math.round(data
            .filter(s => s.end_time)
            .map(s => new Date(s.end_time).getTime() - new Date(s.start_time).getTime())
            .reduce((sum, d) => sum + d, 0) / data.filter(s => s.end_time).length / 1000)
        : 0
    };

    res.json({
      success: true,
      summary,
      syncs: data.map(sync => ({
        batchId: sync.id,
        platform: sync.platform,
        entityType: sync.entity_type,
        syncType: sync.sync_type,
        status: sync.status,
        startTime: sync.start_time,
        endTime: sync.end_time,
        duration: sync.end_time 
          ? Math.round((new Date(sync.end_time).getTime() - new Date(sync.start_time).getTime()) / 1000)
          : null,
        recordsProcessed: sync.records_processed,
        recordsInserted: sync.records_inserted,
        recordsUpdated: sync.records_updated,
        recordsFailed: sync.records_failed,
        errorMessage: sync.error_message
      }))
    });

  } catch (error) {
    logger.error('Get recent sync history error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get sync history'
    });
  }
}));

// Get sync statistics
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const { days = 7 } = req.query;

  try {
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();

    // Get sync statistics
    const { data: syncStats, error: syncError } = await supabase.getClient()
      .from('marketing.etl_sync_log')
      .select('platform, status, records_processed, records_inserted, records_updated, records_failed, start_time, end_time')
      .gte('start_time', since);

    if (syncError) {
      logger.error('Failed to get sync statistics', { error: syncError.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get sync statistics'
      });
    }

    // Calculate platform-specific stats
    const platformStats = {};
    const statusStats = {
      completed: 0,
      failed: 0,
      running: 0,
      partial: 0
    };

    let totalRecords = 0;
    let totalDuration = 0;
    let completedSyncs = 0;

    syncStats.forEach(sync => {
      // Platform stats
      if (!platformStats[sync.platform]) {
        platformStats[sync.platform] = {
          totalSyncs: 0,
          recordsProcessed: 0,
          recordsInserted: 0,
          recordsUpdated: 0,
          recordsFailed: 0,
          avgDuration: 0
        };
      }

      const platform = platformStats[sync.platform];
      platform.totalSyncs++;
      platform.recordsProcessed += sync.records_processed || 0;
      platform.recordsInserted += sync.records_inserted || 0;
      platform.recordsUpdated += sync.records_updated || 0;
      platform.recordsFailed += sync.records_failed || 0;

      // Status stats
      if (statusStats[sync.status] !== undefined) {
        statusStats[sync.status]++;
      }

      // Overall stats
      totalRecords += sync.records_processed || 0;
      
      if (sync.end_time) {
        const duration = new Date(sync.end_time).getTime() - new Date(sync.start_time).getTime();
        totalDuration += duration;
        completedSyncs++;
      }
    });

    // Calculate average durations for platforms
    Object.keys(platformStats).forEach(platform => {
      const platformSyncs = syncStats.filter(s => s.platform === platform && s.end_time);
      if (platformSyncs.length > 0) {
        const totalPlatformDuration = platformSyncs.reduce((sum, s) => 
          sum + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()), 0
        );
        platformStats[platform].avgDuration = Math.round(totalPlatformDuration / platformSyncs.length / 1000);
      }
    });

    res.json({
      success: true,
      period: {
        days: Number(days),
        since,
        until: new Date().toISOString()
      },
      overall: {
        totalSyncs: syncStats.length,
        totalRecordsProcessed: totalRecords,
        avgDuration: completedSyncs > 0 ? Math.round(totalDuration / completedSyncs / 1000) : 0,
        successRate: syncStats.length > 0 
          ? Math.round((statusStats.completed / syncStats.length) * 100) 
          : 0
      },
      byPlatform: platformStats,
      byStatus: statusStats
    });

  } catch (error) {
    logger.error('Get sync statistics error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get sync statistics'
    });
  }
}));

// Get running syncs
router.get('/running', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.getClient()
      .from('marketing.etl_sync_log')
      .select('*')
      .eq('status', 'running')
      .order('start_time', { ascending: false });

    if (error) {
      logger.error('Failed to get running syncs', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get running syncs'
      });
    }

    const runningSyncs = data.map(sync => {
      const runningTime = Date.now() - new Date(sync.start_time).getTime();
      const isStuck = runningTime > 2 * 60 * 60 * 1000; // 2 hours

      return {
        batchId: sync.id,
        platform: sync.platform,
        entityType: sync.entity_type,
        syncType: sync.sync_type,
        startTime: sync.start_time,
        runningTime: Math.round(runningTime / 1000), // seconds
        recordsProcessed: sync.records_processed,
        isStuck,
        progress: sync.records_processed > 0 
          ? Math.round(((sync.records_inserted + sync.records_updated) / sync.records_processed) * 100)
          : 0
      };
    });

    res.json({
      success: true,
      count: runningSyncs.length,
      stuckCount: runningSyncs.filter(s => s.isStuck).length,
      syncs: runningSyncs
    });

  } catch (error) {
    logger.error('Get running syncs error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get running syncs'
    });
  }
}));

export default router;