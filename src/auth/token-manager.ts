import { createClient } from '@supabase/supabase-js';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';
import { TokenData } from '@/utils/types';
import { getErrorMessage } from '@/utils/error-handler';

export class TokenManager {
  private supabase = createClient(appConfig.supabaseUrl, appConfig.supabaseServiceKey);

  async getValidGoogleToken(): Promise<string> {
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
    try {
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
        logger.error('Google token refresh failed', { 
          error: tokenResponse?.error_description || 'Unknown error',
          status: response.status 
        });
        throw new Error(`Google token refresh failed: ${tokenResponse?.error_description || 'Unknown error'}`);
      }

      // Update token in database
      const expiresAt = new Date(Date.now() + ((tokenResponse?.expires_in || 3600) * 1000));
      
      const { error: updateError } = await this.supabase
        .schema('marketing')
        .from('platform_tokens')
        .update({
          access_token: tokenResponse?.access_token,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('platform', 'google');

      if (updateError) {
        logger.error('Failed to update Google token in database', { error: updateError.message });
        throw new Error('Failed to update token in database');
      }

      logger.info('Google token refreshed successfully', {
        expiresAt: expiresAt.toISOString()
      });

      return tokenResponse?.access_token || '';

    } catch (error) {
      logger.error('Google token refresh error', { error: getErrorMessage(error) });
      throw error;
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
}

export default TokenManager;