import { JWT } from 'google-auth-library';
import { GoogleAdsApi } from 'google-ads-api';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';

export class GoogleServiceAccountAuth {
  private jwtClient: JWT;
  private googleAdsClient: GoogleAdsApi;

  constructor() {
    // Parse service account key from environment variable
    const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
    
    if (!serviceAccountKey.client_email || !serviceAccountKey.private_key) {
      throw new Error('Invalid service account key: missing client_email or private_key');
    }

    this.jwtClient = new JWT({
      email: serviceAccountKey.client_email,
      key: serviceAccountKey.private_key,
      scopes: ['https://www.googleapis.com/auth/adwords'],
      subject: undefined // Can be used for domain-wide delegation if needed
    });

    this.googleAdsClient = new GoogleAdsApi({
      client_id: serviceAccountKey.client_id,
      client_secret: serviceAccountKey.client_secret || appConfig.googleClientSecret,
      developer_token: appConfig.googleDeveloperToken,
    });
  }

  async getAccessToken(): Promise<string> {
    try {
      const tokens = await this.jwtClient.authorize();
      
      if (!tokens.access_token) {
        throw new Error('Failed to obtain access token from service account');
      }

      logger.debug('Service account token obtained successfully', {
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'unknown'
      });

      return tokens.access_token;
    } catch (error) {
      logger.error('Service account authentication failed', { error: error.message });
      throw error;
    }
  }

  async getGoogleAdsClient() {
    const accessToken = await this.getAccessToken();
    
    return this.googleAdsClient.Customer({
      customer_id: appConfig.googleCustomerId,
      refresh_token: accessToken, // Service account uses access token as refresh token
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const customer = await this.getGoogleAdsClient();
      // Test with a simple query
      const campaigns = await customer.query('SELECT campaign.id, campaign.name FROM campaign LIMIT 1');
      
      logger.info('Service account connection test successful', {
        campaigns_found: campaigns.length
      });
      
      return true;
    } catch (error) {
      logger.error('Service account connection test failed', { error: error.message });
      return false;
    }
  }

  isConfigured(): boolean {
    try {
      const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
      return !!(serviceAccountKey.client_email && serviceAccountKey.private_key);
    } catch {
      return false;
    }
  }
}

export default GoogleServiceAccountAuth;