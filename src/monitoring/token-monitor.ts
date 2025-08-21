import TokenManager from '@/auth/token-manager';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';

export interface TokenHealth {
  platform: string;
  status: 'healthy' | 'warning' | 'critical' | 'expired' | 'missing';
  action: 'none' | 'refresh_soon' | 'immediate_reauth' | 'setup_required';
  expiresAt?: Date;
  hoursUntilExpiry?: number;
  daysUntilExpiry?: number;
  lastRefreshAttempt?: Date;
  refreshError?: string;
  recommendations?: string[];
}

export interface TokenMonitorReport {
  timestamp: Date;
  overall_status: 'healthy' | 'warning' | 'critical';
  platforms: TokenHealth[];
  critical_alerts: string[];
  recommendations: string[];
}

export class TokenMonitor {
  private tokenManager: TokenManager;

  constructor() {
    this.tokenManager = new TokenManager();
  }

  /**
   * Check health of all platform tokens
   */
  async checkAllTokens(): Promise<TokenMonitorReport> {
    try {
      logger.info('Starting comprehensive token health check');

      const platforms = ['google', 'meta'] as const;
      const tokenHealthResults: TokenHealth[] = [];
      const criticalAlerts: string[] = [];
      const recommendations: string[] = [];

      for (const platform of platforms) {
        try {
          const health = await this.checkTokenHealth(platform);
          tokenHealthResults.push(health);

          // Collect critical alerts
          if (health.status === 'critical' || health.status === 'expired') {
            criticalAlerts.push(`${platform.toUpperCase()}: ${health.action.replace('_', ' ')}`);
          }

          // Add platform-specific recommendations
          if (health.recommendations) {
            recommendations.push(...health.recommendations.map(rec => `${platform.toUpperCase()}: ${rec}`));
          }

        } catch (error) {
          logger.error(`Failed to check token health for ${platform}`, { 
            platform, 
            error: getErrorMessage(error) 
          });
          
          tokenHealthResults.push({
            platform,
            status: 'critical',
            action: 'setup_required',
            recommendations: [`Error checking token: ${getErrorMessage(error)}`]
          });
          
          criticalAlerts.push(`${platform.toUpperCase()}: Failed to check token health`);
        }
      }

      // Determine overall status
      const hasExpired = tokenHealthResults.some(t => t.status === 'expired');
      const hasCritical = tokenHealthResults.some(t => t.status === 'critical');
      const hasWarning = tokenHealthResults.some(t => t.status === 'warning');

      let overallStatus: 'healthy' | 'warning' | 'critical';
      if (hasExpired || hasCritical) {
        overallStatus = 'critical';
      } else if (hasWarning) {
        overallStatus = 'warning';
      } else {
        overallStatus = 'healthy';
      }

      const report: TokenMonitorReport = {
        timestamp: new Date(),
        overall_status: overallStatus,
        platforms: tokenHealthResults,
        critical_alerts: criticalAlerts,
        recommendations
      };

      // Log summary
      logger.info('Token health check completed', {
        overall_status: overallStatus,
        platforms_checked: platforms.length,
        critical_issues: criticalAlerts.length,
        warnings: tokenHealthResults.filter(t => t.status === 'warning').length
      });

      // Send alerts if needed
      if (overallStatus === 'critical') {
        await this.sendCriticalHealthAlert(report);
      }

      return report;

    } catch (error) {
      logger.error('Token health check failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Check health of a specific platform token
   */
  async checkTokenHealth(platform: string): Promise<TokenHealth> {
    try {
      const tokenInfo = await this.tokenManager.getTokenInfo(platform as 'google' | 'meta');

      if (!tokenInfo) {
        return {
          platform,
          status: 'missing',
          action: 'setup_required',
          recommendations: [`No ${platform} token found in database. OAuth setup required.`]
        };
      }

      const now = new Date();
      const expiresAt = new Date(tokenInfo.expires_at);
      const millisecondsUntilExpiry = expiresAt.getTime() - now.getTime();
      const hoursUntilExpiry = millisecondsUntilExpiry / (1000 * 60 * 60);
      const daysUntilExpiry = hoursUntilExpiry / 24;

      // Check if expired
      if (hoursUntilExpiry <= 0) {
        return {
          platform,
          status: 'expired',
          action: 'immediate_reauth',
          expiresAt,
          hoursUntilExpiry,
          daysUntilExpiry,
          recommendations: [
            `Token expired ${Math.abs(Math.floor(hoursUntilExpiry))} hours ago`,
            'Manual re-authentication required immediately',
            'All sync operations will fail until resolved'
          ]
        };
      }

      // Platform-specific thresholds
      const recommendations: string[] = [];
      let status: TokenHealth['status'];
      let action: TokenHealth['action'];

      if (platform === 'google') {
        // Google tokens expire every hour - warn when < 2 hours
        if (hoursUntilExpiry < 2) {
          status = 'critical';
          action = 'immediate_reauth';
          recommendations.push('Google token expires in less than 2 hours');
          recommendations.push('Consider implementing service account authentication');
        } else if (hoursUntilExpiry < 6) {
          status = 'warning';
          action = 'refresh_soon';
          recommendations.push('Google token will expire soon - refresh scheduled');
        } else {
          status = 'healthy';
          action = 'none';
        }
      } else if (platform === 'meta') {
        // Meta tokens expire every 60 days - warn when < 7 days
        if (daysUntilExpiry < 1) {
          status = 'critical';
          action = 'immediate_reauth';
          recommendations.push('Meta token expires in less than 24 hours');
        } else if (daysUntilExpiry < 7) {
          status = 'warning';
          action = 'refresh_soon';
          recommendations.push('Meta token will expire within 7 days - refresh soon');
        } else if (daysUntilExpiry < 14) {
          status = 'warning';
          action = 'refresh_soon';
          recommendations.push('Meta token expires in less than 2 weeks');
        } else {
          status = 'healthy';
          action = 'none';
        }
      } else {
        status = 'healthy';
        action = 'none';
      }

      // Add general recommendations
      if (status === 'healthy') {
        recommendations.push(`Token healthy - expires in ${Math.floor(daysUntilExpiry)} days`);
      }

      return {
        platform,
        status,
        action,
        expiresAt,
        hoursUntilExpiry: Math.floor(hoursUntilExpiry * 10) / 10, // Round to 1 decimal
        daysUntilExpiry: Math.floor(daysUntilExpiry * 10) / 10,
        recommendations
      };

    } catch (error) {
      logger.error('Failed to check token health', { platform, error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Perform proactive token refresh based on health status
   */
  async performProactiveRefresh(): Promise<{ refreshed: string[], failed: string[] }> {
    const refreshed: string[] = [];
    const failed: string[] = [];

    try {
      logger.info('Starting proactive token refresh check');

      const report = await this.checkAllTokens();

      for (const tokenHealth of report.platforms) {
        if (tokenHealth.action === 'refresh_soon') {
          try {
            logger.info(`Proactively refreshing ${tokenHealth.platform} token`);

            if (tokenHealth.platform === 'google') {
              const tokenInfo = await this.tokenManager.getTokenInfo('google');
              if (tokenInfo?.refresh_token) {
                await this.tokenManager.refreshGoogleToken(tokenInfo.refresh_token);
                refreshed.push(tokenHealth.platform);
                logger.info(`Successfully refreshed ${tokenHealth.platform} token`);
              }
            } else if (tokenHealth.platform === 'meta') {
              const tokenInfo = await this.tokenManager.getTokenInfo('meta');
              if (tokenInfo?.access_token) {
                await this.tokenManager.refreshMetaToken(tokenInfo.access_token);
                refreshed.push(tokenHealth.platform);
                logger.info(`Successfully refreshed ${tokenHealth.platform} token`);
              }
            }

          } catch (error) {
            logger.error(`Failed to refresh ${tokenHealth.platform} token`, {
              platform: tokenHealth.platform,
              error: getErrorMessage(error)
            });
            failed.push(tokenHealth.platform);
          }
        }
      }

      logger.info('Proactive token refresh completed', {
        refreshed_count: refreshed.length,
        failed_count: failed.length,
        refreshed_platforms: refreshed,
        failed_platforms: failed
      });

      return { refreshed, failed };

    } catch (error) {
      logger.error('Proactive token refresh failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Generate a human-readable health report
   */
  formatHealthReport(report: TokenMonitorReport): string {
    const lines: string[] = [];
    lines.push('🔐 TOKEN HEALTH REPORT');
    lines.push('='.repeat(50));
    lines.push(`📅 Generated: ${report.timestamp.toISOString()}`);
    lines.push(`🚦 Overall Status: ${report.overall_status.toUpperCase()}`);
    lines.push('');

    // Platform details
    for (const platform of report.platforms) {
      const statusIcon = this.getStatusIcon(platform.status);
      lines.push(`${statusIcon} ${platform.platform.toUpperCase()}`);
      lines.push(`   Status: ${platform.status}`);
      lines.push(`   Action: ${platform.action.replace('_', ' ')}`);
      
      if (platform.expiresAt) {
        lines.push(`   Expires: ${platform.expiresAt.toISOString()}`);
        if (platform.daysUntilExpiry !== undefined) {
          lines.push(`   Time left: ${platform.daysUntilExpiry} days (${platform.hoursUntilExpiry} hours)`);
        }
      }
      
      if (platform.recommendations && platform.recommendations.length > 0) {
        lines.push(`   Recommendations:`);
        for (const rec of platform.recommendations) {
          lines.push(`   • ${rec}`);
        }
      }
      lines.push('');
    }

    // Critical alerts
    if (report.critical_alerts.length > 0) {
      lines.push('🚨 CRITICAL ALERTS');
      lines.push('-'.repeat(30));
      for (const alert of report.critical_alerts) {
        lines.push(`❌ ${alert}`);
      }
      lines.push('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('💡 RECOMMENDATIONS');
      lines.push('-'.repeat(30));
      for (const rec of report.recommendations) {
        lines.push(`• ${rec}`);
      }
    }

    return lines.join('\n');
  }

  private getStatusIcon(status: TokenHealth['status']): string {
    switch (status) {
      case 'healthy': return '✅';
      case 'warning': return '⚠️';
      case 'critical': return '🔴';
      case 'expired': return '💀';
      case 'missing': return '❓';
      default: return '🔹';
    }
  }

  private async sendCriticalHealthAlert(report: TokenMonitorReport): Promise<void> {
    try {
      const alertMessage = this.formatHealthReport(report);
      
      logger.error('🚨 CRITICAL TOKEN HEALTH ALERT 🚨', {
        overall_status: report.overall_status,
        critical_alerts: report.critical_alerts,
        platforms_affected: report.platforms.filter(p => p.status === 'critical' || p.status === 'expired').length,
        full_report: alertMessage
      });

      // TODO: Implement actual alert mechanisms
      // await this.sendSlackAlert(alertMessage);
      // await this.sendEmailAlert(alertMessage);
      
    } catch (error) {
      logger.error('Failed to send critical health alert', { error: getErrorMessage(error) });
    }
  }

  /**
   * Quick health status check - returns boolean for automation
   */
  async isSystemHealthy(): Promise<boolean> {
    try {
      const report = await this.checkAllTokens();
      return report.overall_status === 'healthy';
    } catch (error) {
      logger.error('Failed to check system health', { error: getErrorMessage(error) });
      return false;
    }
  }

  /**
   * Get critical issues that need immediate attention
   */
  async getCriticalIssues(): Promise<TokenHealth[]> {
    try {
      const report = await this.checkAllTokens();
      return report.platforms.filter(p => p.status === 'critical' || p.status === 'expired');
    } catch (error) {
      logger.error('Failed to get critical issues', { error: getErrorMessage(error) });
      return [];
    }
  }
}

export default TokenMonitor;