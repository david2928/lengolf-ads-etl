import express from 'express';
import TokenMonitor from '@/monitoring/token-monitor';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';

const router = express.Router();
const tokenMonitor = new TokenMonitor();

/**
 * GET /api/token-health
 * Returns comprehensive token health status
 */
router.get('/', async (req, res) => {
  try {
    logger.info('Token health check requested', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const report = await tokenMonitor.checkAllTokens();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: report
    });

  } catch (error) {
    logger.error('Token health check failed', { error: getErrorMessage(error) });
    
    res.status(500).json({
      success: false,
      error: 'Token health check failed',
      message: getErrorMessage(error)
    });
  }
});

/**
 * GET /api/token-health/summary
 * Returns simplified health status for monitoring
 */
router.get('/summary', async (req, res) => {
  try {
    const report = await tokenMonitor.checkAllTokens();
    
    const summary = {
      overall_status: report.overall_status,
      healthy: report.platforms.filter(p => p.status === 'healthy').length,
      warnings: report.platforms.filter(p => p.status === 'warning').length,
      critical: report.platforms.filter(p => p.status === 'critical' || p.status === 'expired').length,
      platforms: report.platforms.map(p => ({
        platform: p.platform,
        status: p.status,
        days_until_expiry: p.daysUntilExpiry
      })),
      needs_attention: report.critical_alerts
    };
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: summary
    });

  } catch (error) {
    logger.error('Token health summary failed', { error: getErrorMessage(error) });
    
    res.status(500).json({
      success: false,
      error: 'Token health summary failed',
      message: getErrorMessage(error)
    });
  }
});

/**
 * GET /api/token-health/report
 * Returns human-readable health report
 */
router.get('/report', async (req, res) => {
  try {
    const report = await tokenMonitor.checkAllTokens();
    const formattedReport = tokenMonitor.formatHealthReport(report);
    
    res.setHeader('Content-Type', 'text/plain');
    res.send(formattedReport);

  } catch (error) {
    logger.error('Token health report failed', { error: getErrorMessage(error) });
    
    res.status(500).json({
      success: false,
      error: 'Token health report failed',
      message: getErrorMessage(error)
    });
  }
});

/**
 * POST /api/token-health/refresh
 * Performs proactive token refresh for platforms that need it
 */
router.post('/refresh', async (req, res) => {
  try {
    logger.info('Proactive token refresh requested', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const result = await tokenMonitor.performProactiveRefresh();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        refreshed_platforms: result.refreshed,
        failed_platforms: result.failed,
        message: `${result.refreshed.length} platforms refreshed, ${result.failed.length} failed`
      }
    });

  } catch (error) {
    logger.error('Proactive token refresh failed', { error: getErrorMessage(error) });
    
    res.status(500).json({
      success: false,
      error: 'Proactive token refresh failed',
      message: getErrorMessage(error)
    });
  }
});

/**
 * GET /api/token-health/critical
 * Returns only critical issues that need immediate attention
 */
router.get('/critical', async (req, res) => {
  try {
    const criticalIssues = await tokenMonitor.getCriticalIssues();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        has_critical_issues: criticalIssues.length > 0,
        critical_count: criticalIssues.length,
        issues: criticalIssues
      }
    });

  } catch (error) {
    logger.error('Critical issues check failed', { error: getErrorMessage(error) });
    
    res.status(500).json({
      success: false,
      error: 'Critical issues check failed',
      message: getErrorMessage(error)
    });
  }
});

/**
 * GET /api/token-health/status
 * Simple boolean health check for uptime monitoring
 */
router.get('/status', async (req, res) => {
  try {
    const isHealthy = await tokenMonitor.isSystemHealthy();
    
    if (isHealthy) {
      res.json({
        success: true,
        status: 'healthy',
        message: 'All tokens are healthy'
      });
    } else {
      res.status(503).json({
        success: false,
        status: 'unhealthy',
        message: 'One or more tokens require attention'
      });
    }

  } catch (error) {
    logger.error('Token status check failed', { error: getErrorMessage(error) });
    
    res.status(500).json({
      success: false,
      status: 'error',
      message: getErrorMessage(error)
    });
  }
});

export default router;