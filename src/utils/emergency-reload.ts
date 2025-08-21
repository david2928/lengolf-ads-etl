import GoogleAdsPerformanceExtractor from '@/extractors/google/performance';
import BatchProcessor from '@/loaders/batch-processor';
import SupabaseLoader from '@/loaders/supabase-client';
import logger from '@/utils/logger';

export class EmergencyReload {
  private googlePerformanceExtractor: GoogleAdsPerformanceExtractor;
  private batchProcessor: BatchProcessor;
  private supabase: SupabaseLoader;

  constructor() {
    this.googlePerformanceExtractor = new GoogleAdsPerformanceExtractor();
    this.batchProcessor = new BatchProcessor();
    this.supabase = new SupabaseLoader();
  }

  /**
   * Emergency reload function to force reload specific date range
   * Bypasses all sync logic and directly queries/inserts data
   */
  async reloadDateRange(
    startDate: string, // 'YYYY-MM-DD'
    endDate: string,   // 'YYYY-MM-DD'
    platform: 'google' | 'meta' = 'google'
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    logger.info('🚨 EMERGENCY RELOAD STARTED', {
      startDate,
      endDate,
      platform
    });

    try {
      // Create emergency batch
      const batchId = await this.supabase.createSyncBatch(
        platform,
        'emergency',
        ['performance']
      );

      if (platform === 'google') {
        // Force reload Google Ads data - NO modifiedSince filter
        const [campaignData, keywordData, pmaxData] = await Promise.all([
          this.googlePerformanceExtractor.extractCampaignPerformance(start, end, undefined),
          this.googlePerformanceExtractor.extractKeywordPerformance(start, end, undefined),
          this.googlePerformanceExtractor.extractPMaxPerformance(start, end, undefined)
        ]);

        logger.info('🔥 EMERGENCY DATA EXTRACTED', {
          campaignRecords: campaignData.length,
          keywordRecords: keywordData.length,
          pmaxRecords: pmaxData.length,
          dateRange: `${startDate} to ${endDate}`
        });

        // Process data in parallel
        const [campaignResult, keywordResult, pmaxResult] = await Promise.all([
          this.batchProcessor.processGoogleCampaignPerformance(campaignData, batchId),
          this.batchProcessor.processGoogleKeywordPerformance(keywordData, batchId),
          this.batchProcessor.processGooglePMaxPerformance(pmaxData, batchId)
        ]);

        const totalResult = {
          inserted: campaignResult.inserted + keywordResult.inserted + pmaxResult.inserted,
          updated: campaignResult.updated + keywordResult.updated + pmaxResult.updated,
          failed: campaignResult.failed + keywordResult.failed + pmaxResult.failed
        };

        logger.info('🎯 EMERGENCY RELOAD COMPLETED', {
          batchId,
          dateRange: `${startDate} to ${endDate}`,
          result: totalResult
        });

        return {
          success: true,
          batchId,
          dateRange: `${startDate} to ${endDate}`,
          ...totalResult
        };
      }

      throw new Error(`Platform ${platform} not implemented yet`);

    } catch (error) {
      logger.error('❌ EMERGENCY RELOAD FAILED', {
        error: error.message,
        startDate,
        endDate,
        platform
      });
      throw error;
    }
  }
}

export default EmergencyReload;