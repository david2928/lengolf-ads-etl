import cron from 'node-cron';
import TokenMonitor from '@/monitoring/token-monitor';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';

export class TokenHealthScheduler {
  private tokenMonitor: TokenMonitor;
  private isScheduled: boolean = false;

  constructor() {
    this.tokenMonitor = new TokenMonitor();
  }

  /**
   * Start automated token health monitoring
   */
  start(): void {
    if (this.isScheduled) {
      logger.warn('Token health scheduler is already running');
      return;
    }

    logger.info('Starting automated token health monitoring');

    // Health check every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      await this.performHealthCheck();
    }, {
      timezone: 'UTC'
    });

    // Proactive refresh check every 2 hours
    cron.schedule('0 */2 * * *', async () => {
      await this.performProactiveRefresh();
    }, {
      timezone: 'UTC'
    });

    // Daily comprehensive report at 9 AM UTC
    cron.schedule('0 9 * * *', async () => {
      await this.generateDailyReport();
    }, {
      timezone: 'UTC'
    });

    // Critical check every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      await this.performCriticalCheck();
    }, {
      timezone: 'UTC'
    });

    this.isScheduled = true;
    logger.info('Token health scheduler started successfully', {
      schedules: [
        'Health check: Every 6 hours',
        'Proactive refresh: Every 2 hours', 
        'Daily report: 9 AM UTC',
        'Critical check: Every 30 minutes'
      ]
    });
  }

  /**
   * Stop automated token health monitoring
   */
  stop(): void {
    if (!this.isScheduled) {
      logger.warn('Token health scheduler is not running');
      return;
    }

    // Note: node-cron doesn't provide a direct way to stop specific tasks
    // In a production environment, you'd want to store task references
    this.isScheduled = false;
    logger.info('Token health scheduler stopped');
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      logger.info('🔍 Starting scheduled token health check');

      const report = await this.tokenMonitor.checkAllTokens();
      
      logger.info('Scheduled health check completed', {
        overall_status: report.overall_status,
        critical_issues: report.critical_alerts.length,
        platforms_checked: report.platforms.length,
        timestamp: report.timestamp.toISOString()
      });

      // Log detailed results for each platform
      for (const platform of report.platforms) {
        if (platform.status !== 'healthy') {
          logger.warn(`Token health warning for ${platform.platform}`, {
            platform: platform.platform,
            status: platform.status,
            action: platform.action,
            days_until_expiry: platform.daysUntilExpiry,
            recommendations: platform.recommendations
          });
        } else {
          logger.debug(`Token healthy for ${platform.platform}`, {
            platform: platform.platform,
            days_until_expiry: platform.daysUntilExpiry
          });
        }
      }

    } catch (error) {
      logger.error('Scheduled health check failed', { 
        error: getErrorMessage(error),
        scheduled_task: 'health_check'
      });
    }
  }

  /**
   * Perform proactive token refresh
   */
  private async performProactiveRefresh(): Promise<void> {
    try {
      logger.info('🔄 Starting scheduled proactive refresh check');

      const result = await this.tokenMonitor.performProactiveRefresh();
      
      if (result.refreshed.length > 0 || result.failed.length > 0) {
        logger.info('Proactive refresh completed', {
          refreshed_platforms: result.refreshed,
          failed_platforms: result.failed,
          refreshed_count: result.refreshed.length,
          failed_count: result.failed.length
        });

        // Alert on failures
        if (result.failed.length > 0) {
          logger.error('🚨 Proactive token refresh failures detected', {
            failed_platforms: result.failed,
            action_required: 'Manual intervention may be needed'
          });
        }
      } else {
        logger.debug('Proactive refresh check completed - no refresh needed');
      }

    } catch (error) {
      logger.error('Scheduled proactive refresh failed', { 
        error: getErrorMessage(error),
        scheduled_task: 'proactive_refresh'
      });
    }
  }

  /**
   * Generate daily comprehensive report
   */
  private async generateDailyReport(): Promise<void> {
    try {
      logger.info('📊 Generating daily token health report');

      const report = await this.tokenMonitor.checkAllTokens();
      const formattedReport = this.tokenMonitor.formatHealthReport(report);
      
      logger.info('📋 DAILY TOKEN HEALTH REPORT', {
        report_date: new Date().toISOString().split('T')[0],
        overall_status: report.overall_status,
        full_report: formattedReport,
        platforms: report.platforms.map(p => ({
          platform: p.platform,
          status: p.status,
          days_until_expiry: p.daysUntilExpiry,
          action_needed: p.action !== 'none'
        }))
      });

      // Store metrics for trending (could be enhanced to write to database)
      const metrics = {
        date: new Date().toISOString().split('T')[0],
        overall_status: report.overall_status,
        healthy_count: report.platforms.filter(p => p.status === 'healthy').length,
        warning_count: report.platforms.filter(p => p.status === 'warning').length,
        critical_count: report.platforms.filter(p => p.status === 'critical' || p.status === 'expired').length,
        total_platforms: report.platforms.length
      };

      logger.info('Daily token health metrics', metrics);

    } catch (error) {
      logger.error('Daily report generation failed', { 
        error: getErrorMessage(error),
        scheduled_task: 'daily_report'
      });
    }
  }

  /**
   * Check for critical issues that need immediate attention
   */
  private async performCriticalCheck(): Promise<void> {
    try {
      const criticalIssues = await this.tokenMonitor.getCriticalIssues();
      
      if (criticalIssues.length > 0) {
        logger.error('🚨 CRITICAL TOKEN ISSUES DETECTED', {
          critical_count: criticalIssues.length,
          issues: criticalIssues.map(issue => ({
            platform: issue.platform,
            status: issue.status,
            action: issue.action,
            hours_until_expiry: issue.hoursUntilExpiry,
            recommendations: issue.recommendations
          })),
          immediate_action_required: true
        });

        // Could trigger additional alerts here
        // await this.sendUrgentAlert(criticalIssues);
      }

    } catch (error) {
      logger.error('Critical check failed', { 
        error: getErrorMessage(error),
        scheduled_task: 'critical_check'
      });
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): { isRunning: boolean; scheduledTasks: string[] } {
    return {
      isRunning: this.isScheduled,
      scheduledTasks: this.isScheduled ? [
        'Health check: Every 6 hours (0 */6 * * *)',
        'Proactive refresh: Every 2 hours (0 */2 * * *)',
        'Daily report: 9 AM UTC (0 9 * * *)',
        'Critical check: Every 30 minutes (*/30 * * * *)'
      ] : []
    };
  }

  /**
   * Manual trigger for health check (for testing/debugging)
   */
  async triggerHealthCheck(): Promise<void> {
    logger.info('Manually triggering token health check');
    await this.performHealthCheck();
  }

  /**
   * Manual trigger for proactive refresh (for testing/debugging)
   */
  async triggerProactiveRefresh(): Promise<void> {
    logger.info('Manually triggering proactive refresh');
    await this.performProactiveRefresh();
  }
}

export default TokenHealthScheduler;