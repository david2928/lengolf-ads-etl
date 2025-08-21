import { createClient } from '@supabase/supabase-js';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';
import { TokenData } from '@/utils/types';
import { getErrorMessage } from '@/utils/error-handler';
import GoogleServiceAccountAuth from './google-service-account';

export class TokenManager {
  private supabase = createClient(appConfig.supabaseUrl, appConfig.supabaseServiceKey);
  private serviceAccountAuth?: GoogleServiceAccountAuth;

  constructor() {
    // Initialize service account if configured
    try {
      this.serviceAccountAuth = new GoogleServiceAccountAuth();
      if (!this.serviceAccountAuth.isConfigured()) {
        this.serviceAccountAuth = undefined;
      }
    } catch {
      this.serviceAccountAuth = undefined;
    }
  }

  async getValidGoogleToken(): Promise<string> {
    // Try service account first if configured
    if (this.serviceAccountAuth) {
      try {
        logger.info('Using Google Service Account authentication');
        return await this.serviceAccountAuth.getAccessToken();
      } catch (error) {
        logger.error('Service account authentication failed, falling back to OAuth2', { 
          error: getErrorMessage(error) 
        });
      }
    }

    // Fallback to OAuth2
    logger.info('Using OAuth2 authentication');
    try {
      // Get current token from database
      const { data: tokenData, error } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .select('*')
        .eq('platform', 'google')
        .single();

      if (error || !tokenData) {
        logger.error('Google token not found in database. Please set up OAuth tokens.', { error: error?.message });
        throw new Error('Google token not found in database. Please set up OAuth tokens.');
      }

      // Check if token is expired (with 5-minute buffer)
      const expiryTime = new Date(tokenData.expires_at);
      const bufferTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

      if (expiryTime <= bufferTime) {
        logger.info('Google token expired or expiring soon, refreshing...');
        return await this.refreshGoogleToken(tokenData.refresh_token);
      }

      logger.debug('Using existing Google token');
      return tokenData.access_token;

    } catch (error) {
      logger.error('Failed to get Google token', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async refreshGoogleToken(refreshToken: string): Promise<string> {
    const MAX_RETRY_ATTEMPTS = 3;
    
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        logger.info(`Attempting Google token refresh (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
        
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: appConfig.googleClientId,
            client_secret: appConfig.googleClientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
          })
        });

        const tokenResponse = await response.json() as any;

        if (!response.ok) {
          if (tokenResponse?.error === 'invalid_grant') {
            // Critical: Refresh token expired - no retry needed
            logger.error('Google refresh token expired - manual re-authentication required', {
              error: tokenResponse.error_description,
              status: response.status
            });
            await this.handleInvalidGrant('google');
            throw new Error('REFRESH_TOKEN_EXPIRED: Manual re-authentication required');
          }
          
          if (attempt === MAX_RETRY_ATTEMPTS) {
            logger.error('Google token refresh failed after all attempts', { 
              error: tokenResponse?.error_description || 'Unknown error',
              status: response.status,
              attempts: MAX_RETRY_ATTEMPTS
            });
            throw new Error(`Google token refresh failed: ${tokenResponse?.error_description || 'Unknown error'}`);
          }
          
          // Temporary error - wait and retry
          const waitTime = 2000 * attempt;
          logger.warn(`Google token refresh failed (attempt ${attempt}), retrying in ${waitTime}ms`, {
            error: tokenResponse?.error,
            status: response.status
          });
          await this.delay(waitTime);
          continue;
        }

        // Success - update database and return
        logger.info(`Google token refresh successful (attempt ${attempt})`);
        return await this.updateGoogleTokenInDatabase(tokenResponse);
        
      } catch (error) {
        if (error.message?.includes('REFRESH_TOKEN_EXPIRED')) {
          // Don't retry for expired refresh tokens
          throw error;
        }
        
        if (attempt === MAX_RETRY_ATTEMPTS) {
          logger.error('Google token refresh error after all attempts', { 
            error: getErrorMessage(error),
            attempts: MAX_RETRY_ATTEMPTS
          });
          throw error;
        }
        
        // Network or other temporary error - retry
        const waitTime = 2000 * attempt;
        logger.warn(`Network error during token refresh (attempt ${attempt}), retrying in ${waitTime}ms`, {
          error: getErrorMessage(error)
        });
        await this.delay(waitTime);
      }
    }
    
    throw new Error('Google token refresh failed after all attempts');
  }

  private async updateGoogleTokenInDatabase(tokenResponse: any): Promise<string> {
    try {
      const expiresAt = new Date(Date.now() + ((tokenResponse?.expires_in || 3600) * 1000));
      
      const { error: updateError } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .update({
          access_token: tokenResponse?.access_token,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
          last_refresh_attempt: new Date().toISOString(),
          refresh_error: null // Clear any previous errors
        })
        .eq('platform', 'google');

      if (updateError) {
        logger.error('Failed to update Google token in database', { error: updateError.message });
        throw new Error('Failed to update token in database');
      }

      logger.info('Google token refreshed and stored successfully', {
        expiresAt: expiresAt.toISOString(),
        expiresInMinutes: Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60))
      });

      return tokenResponse?.access_token || '';
    } catch (error) {
      logger.error('Failed to update Google token in database', { error: getErrorMessage(error) });
      throw new Error('Failed to store refreshed token in database');
    }
  }

  private async handleInvalidGrant(platform: string): Promise<void> {
    try {
      logger.error(`🚨 CRITICAL: ${platform} refresh token expired`, {
        platform,
        action: 'marking_token_invalid',
        requires_manual_intervention: true
      });

      // Mark token as invalid in database
      await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .update({
          refresh_error: 'invalid_grant - refresh token expired',
          last_refresh_attempt: new Date().toISOString(),
          token_status: 'invalid'
        })
        .eq('platform', platform);

      // Create alert for manual intervention
      await this.createCriticalTokenAlert(platform);
      
    } catch (error) {
      logger.error('Failed to handle invalid grant error', {
        platform,
        error: getErrorMessage(error)
      });
    }
  }

  private async createCriticalTokenAlert(platform: string): Promise<void> {
    try {
      // For now, log the critical alert - in production this could send to Slack/email
      logger.error('🚨 CRITICAL TOKEN ALERT 🚨', {
        platform,
        message: `${platform.toUpperCase()} refresh token has expired`,
        action_required: 'Manual re-authentication needed immediately',
        impact: 'All sync operations will fail until resolved',
        timestamp: new Date().toISOString()
      });

      // TODO: Add Slack/email notification here
      // await this.sendSlackAlert(platform);
      
    } catch (error) {
      logger.error('Failed to create critical token alert', {
        platform,
        error: getErrorMessage(error)
      });
    }
  }

  async getValidMetaToken(): Promise<string> {
    try {
      const { data: tokenData, error } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .select('*')
        .eq('platform', 'meta')
        .single();

      if (error || !tokenData) {
        throw new Error('Meta token not found in database');
      }

      // Meta long-lived tokens are valid for 60 days
      const expiryTime = new Date(tokenData.expires_at);
      const daysUntilExpiry = Math.floor(
        (expiryTime.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );

      // Refresh if token expires in less than 7 days
      if (daysUntilExpiry < 7) {
        logger.info(`Meta token expires in ${daysUntilExpiry} days, refreshing...`);
        return await this.refreshMetaToken(tokenData.access_token);
      }

      logger.debug('Using existing Meta token', { daysUntilExpiry });
      return tokenData.access_token;

    } catch (error) {
      logger.error('Failed to get Meta token', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async refreshMetaToken(currentToken: string): Promise<string> {
    try {
      const url = new URL('https://graph.facebook.com/oauth/access_token');
      url.searchParams.set('grant_type', 'fb_exchange_token');
      url.searchParams.set('client_id', appConfig.metaAppId);
      url.searchParams.set('client_secret', appConfig.metaAppSecret);
      url.searchParams.set('fb_exchange_token', currentToken);

      const response = await fetch(url.toString());
      const tokenResponse = await response.json() as any;

      if (!response.ok) {
        logger.error('Meta token refresh failed', {
          error: tokenResponse?.error?.message || 'Unknown error',
          status: response.status
        });
        throw new Error(`Meta token refresh failed: ${tokenResponse?.error?.message || 'Unknown error'}`);
      }

      // Update token in database
      const expiresAt = new Date(Date.now() + ((tokenResponse?.expires_in || 5184000) * 1000)); // 60 days default
      
      const { error: updateError } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .update({
          access_token: tokenResponse?.access_token,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('platform', 'meta');

      if (updateError) {
        logger.error('Failed to update Meta token in database', { error: updateError.message });
        throw new Error('Failed to update token in database');
      }

      logger.info('Meta token refreshed successfully', {
        expiresAt: expiresAt.toISOString()
      });

      return tokenResponse?.access_token || '';

    } catch (error) {
      logger.error('Meta token refresh error', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async storeToken(tokenData: TokenData): Promise<void> {
    try {
      const { error } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .upsert({
          platform: tokenData.platform,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: tokenData.expires_at.toISOString(),
          token_type: tokenData.token_type || 'Bearer',
          scope: tokenData.scope,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'platform'
        });

      if (error) {
        logger.error('Failed to store token', { 
          platform: tokenData.platform,
          error: error.message 
        });
        throw new Error(`Failed to store ${tokenData.platform} token`);
      }

      logger.info('Token stored successfully', { 
        platform: tokenData.platform,
        expiresAt: tokenData.expires_at.toISOString()
      });

    } catch (error) {
      logger.error('Token storage error', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async getTokenInfo(platform: 'google' | 'meta'): Promise<TokenData | null> {
    try {
      const { data, error } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .select('*')
        .eq('platform', platform)
        .single();

      if (error) {
        logger.warn(`No token found for platform: ${platform}`, { error: error.message });
        return null;
      }

      return {
        platform: data.platform,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: new Date(data.expires_at),
        token_type: data.token_type,
        scope: data.scope
      };

    } catch (error) {
      logger.error('Failed to get token info', { platform, error: getErrorMessage(error) });
      return null;
    }
  }

  async deleteToken(platform: 'google' | 'meta'): Promise<void> {
    try {
      const { error } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .delete()
        .eq('platform', platform);

      if (error) {
        logger.error('Failed to delete token', { platform, error: error.message });
        throw new Error(`Failed to delete ${platform} token`);
      }

      logger.info('Token deleted successfully', { platform });

    } catch (error) {
      logger.error('Token deletion error', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testServiceAccountConnection(): Promise<boolean> {
    if (!this.serviceAccountAuth) {
      logger.warn('Service account not configured');
      return false;
    }

    try {
      const result = await this.serviceAccountAuth.testConnection();
      logger.info('Service account connection test result', { success: result });
      return result;
    } catch (error) {
      logger.error('Service account connection test failed', { error: getErrorMessage(error) });
      return false;
    }
  }

  hasServiceAccount(): boolean {
    return !!this.serviceAccountAuth;
  }
}

export default TokenManager;