import axios, { AxiosInstance } from 'axios';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';
import TokenManager from '@/auth/token-manager';
import { getErrorMessage } from '@/utils/error-handler';

export interface MetaApiResponse<T = any> {
  data: T[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
    next?: string;
    previous?: string;
  };
}

export class MetaAdsClient {
  private httpClient: AxiosInstance;
  private tokenManager: TokenManager;
  private baseUrl = 'https://graph.facebook.com/v22.0';
  private accessToken: string | null = null;

  constructor() {
    this.tokenManager = new TokenManager();
    
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Lengolf-Ads-ETL/1.0.0'
      }
    });

    // Add request interceptor to ensure access token
    this.httpClient.interceptors.request.use(async (config) => {
      if (!this.accessToken) {
        await this.initializeToken();
      }
      config.params = {
        ...config.params,
        access_token: this.accessToken
      };
      return config;
    });

    // Add response interceptor for error handling and token refresh
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && !error.config._retry) {
          logger.info('Meta API authentication error, attempting token refresh...');
          error.config._retry = true;
          
          try {
            await this.refreshToken();
            error.config.params.access_token = this.accessToken;
            return this.httpClient.request(error.config);
          } catch (refreshError) {
            logger.error('Token refresh failed', { error: getErrorMessage(refreshError) });
            throw error;
          }
        }
        
        // Handle rate limiting
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'] || 60;
          logger.warn(`Meta API rate limited, waiting ${retryAfter} seconds...`);
          await this.delay(retryAfter * 1000);
          return this.httpClient.request(error.config);
        }
        
        throw error;
      }
    );
  }

  private async initializeToken(): Promise<void> {
    try {
      logger.info('Initializing Meta Ads API token');
      
      const tokenInfo = await this.tokenManager.getTokenInfo('meta');
      
      if (!tokenInfo || !tokenInfo.access_token) {
        throw new Error('Meta access token not found. Please set up OAuth tokens.');
      }

      // Check if token needs refresh
      const now = new Date();
      const expiresAt = tokenInfo.expires_at ? new Date(tokenInfo.expires_at) : null;
      
      if (expiresAt && now >= expiresAt) {
        logger.info('Meta token expired, refreshing...');
        await this.refreshToken();
      } else {
        this.accessToken = tokenInfo.access_token;
        logger.info('Meta token initialized successfully', {
          expiresAt: expiresAt?.toISOString(),
          tokenPrefix: this.accessToken.substring(0, 20) + '...'
        });
      }
      
    } catch (error) {
      logger.error('Failed to initialize Meta token', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private async refreshToken(): Promise<void> {
    try {
      const tokenInfo = await this.tokenManager.getTokenInfo('meta');
      
      if (!tokenInfo?.refresh_token) {
        throw new Error('Meta refresh token not found');
      }

      // Use the refresh token to get a new access token
      const response = await axios.post(`${this.baseUrl}/oauth/access_token`, {
        grant_type: 'refresh_token',
        client_id: appConfig.metaAppId,
        client_secret: appConfig.metaAppSecret,
        refresh_token: tokenInfo.refresh_token
      });

      const { access_token, expires_in } = response.data;
      
      if (!access_token) {
        throw new Error('No access token received from Meta refresh');
      }

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + (expires_in * 1000));

      // Update token in database
      await this.tokenManager.storeToken({
        platform: 'meta',
        access_token,
        refresh_token: tokenInfo.refresh_token,
        expires_at: expiresAt,
        token_type: 'Bearer',
        scope: tokenInfo.scope
      });

      this.accessToken = access_token;
      
      logger.info('Meta token refreshed successfully', {
        expiresAt: expiresAt.toISOString()
      });
      
    } catch (error) {
      logger.error('Failed to refresh Meta token', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async makeRequest<T = any>(
    endpoint: string,
    params: Record<string, any> = {},
    method: 'GET' | 'POST' = 'GET'
  ): Promise<MetaApiResponse<T>> {
    try {
      logger.debug('Making Meta API request', { endpoint, method, params });
      
      const response = method === 'GET' 
        ? await this.httpClient.get(endpoint, { params })
        : await this.httpClient.post(endpoint, params);

      logger.debug('Meta API request successful', {
        endpoint,
        dataCount: Array.isArray(response.data.data) ? response.data.data.length : 1
      });

      return response.data;
      
    } catch (error) {
      logger.error('Meta API request failed', {
        endpoint,
        error: getErrorMessage(error),
        response: error.response?.data
      });
      throw error;
    }
  }

  async getAccountInfo(): Promise<any> {
    try {
      logger.info('Fetching Meta ad account information');
      const response = await this.httpClient.get(
        `/act_${appConfig.metaAdAccountId}`,
        {
          params: {
            fields: 'account_id,name,currency,timezone_name,account_status'
          }
        }
      );
      
      logger.info('Meta account info fetched', {
        accountId: response.data.account_id,
        currency: response.data.currency,
        timezone: response.data.timezone_name,
        status: response.data.account_status
      });
      
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch Meta account info', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async getCampaigns(modifiedSince?: Date): Promise<any[]> {
    const fields = [
      'id',
      'name', 
      'status',
      'objective',
      'created_time',
      'updated_time',
      'start_time',
      'stop_time',
      'daily_budget',
      'lifetime_budget',
      'budget_remaining',
      'bid_strategy',
      'buying_type',
      'can_use_spend_cap',
      'spend_cap'
    ].join(',');

    let params: Record<string, any> = {
      fields,
      limit: 100
    };

    // Add time-based filtering if specified
    if (modifiedSince) {
      params.filtering = JSON.stringify([
        {
          field: 'updated_time',
          operator: 'GREATER_THAN',
          value: Math.floor(modifiedSince.getTime() / 1000)
        }
      ]);
    }

    const campaigns: any[] = [];
    let nextUrl: string | undefined;

    do {
      const response = await this.makeRequest<any>(
        `/${appConfig.metaAdAccountId}/campaigns`,
        params
      );

      campaigns.push(...response.data);
      nextUrl = response.paging?.next;
      
      if (nextUrl) {
        // Extract params from next URL
        const url = new URL(nextUrl);
        params = Object.fromEntries(url.searchParams);
      }

    } while (nextUrl);

    logger.info(`Fetched ${campaigns.length} Meta campaigns`);
    return campaigns;
  }

  async getAdSets(campaignIds?: string[], modifiedSince?: Date): Promise<any[]> {
    const fields = [
      'id',
      'name',
      'status',
      'campaign_id',
      'created_time',
      'updated_time',
      'start_time',
      'end_time',
      'daily_budget',
      'lifetime_budget',
      'budget_remaining',
      'bid_amount',
      'bid_strategy',
      'billing_event',
      'optimization_goal',
      'targeting',
      'promoted_object',
      'attribution_spec'
    ].join(',');

    let endpoint: string;
    let params: Record<string, any> = {
      fields,
      limit: 100
    };

    // Add time-based filtering if specified
    if (modifiedSince) {
      params.filtering = JSON.stringify([
        {
          field: 'updated_time',
          operator: 'GREATER_THAN',
          value: Math.floor(modifiedSince.getTime() / 1000)
        }
      ]);
    }

    if (campaignIds && campaignIds.length > 0) {
      // If specific campaigns are requested, fetch ad sets for each campaign
      const allAdSets: any[] = [];
      
      for (const campaignId of campaignIds) {
        endpoint = `/${campaignId}/adsets`;
        
        let nextUrl: string | undefined;
        do {
          const response = await this.makeRequest<any>(endpoint, params);
          allAdSets.push(...response.data);
          nextUrl = response.paging?.next;
          
          if (nextUrl) {
            const url = new URL(nextUrl);
            params = Object.fromEntries(url.searchParams);
          }
        } while (nextUrl);
      }
      
      logger.info(`Fetched ${allAdSets.length} Meta ad sets for ${campaignIds.length} campaigns`);
      return allAdSets;
    } else {
      // Fetch all ad sets from the account
      endpoint = `/${appConfig.metaAdAccountId}/adsets`;
      const adSets: any[] = [];
      let nextUrl: string | undefined;

      do {
        const response = await this.makeRequest<any>(endpoint, params);
        adSets.push(...response.data);
        nextUrl = response.paging?.next;
        
        if (nextUrl) {
          const url = new URL(nextUrl);
          params = Object.fromEntries(url.searchParams);
        }
      } while (nextUrl);

      logger.info(`Fetched ${adSets.length} Meta ad sets`);
      return adSets;
    }
  }

  async getAds(adSetIds?: string[], modifiedSince?: Date): Promise<any[]> {
    const fields = [
      'id',
      'name',
      'status',
      'adset_id',
      'campaign_id',
      'created_time',
      'updated_time',
      'creative',
      'bid_amount',
      'source_ad_id',
      'tracking_specs',
      'conversion_specs'
    ].join(',');

    let endpoint: string;
    let params: Record<string, any> = {
      fields,
      limit: 100
    };

    // Add time-based filtering if specified
    if (modifiedSince) {
      params.filtering = JSON.stringify([
        {
          field: 'updated_time',
          operator: 'GREATER_THAN',
          value: Math.floor(modifiedSince.getTime() / 1000)
        }
      ]);
    }

    if (adSetIds && adSetIds.length > 0) {
      // If specific ad sets are requested, fetch ads for each ad set
      const allAds: any[] = [];
      
      for (const adSetId of adSetIds) {
        endpoint = `/${adSetId}/ads`;
        
        let nextUrl: string | undefined;
        do {
          const response = await this.makeRequest<any>(endpoint, params);
          allAds.push(...response.data);
          nextUrl = response.paging?.next;
          
          if (nextUrl) {
            const url = new URL(nextUrl);
            params = Object.fromEntries(url.searchParams);
          }
        } while (nextUrl);
      }
      
      logger.info(`Fetched ${allAds.length} Meta ads for ${adSetIds.length} ad sets`);
      return allAds;
    } else {
      // Fetch all ads from the account
      endpoint = `/${appConfig.metaAdAccountId}/ads`;
      const ads: any[] = [];
      let nextUrl: string | undefined;

      do {
        const response = await this.makeRequest<any>(endpoint, params);
        ads.push(...response.data);
        nextUrl = response.paging?.next;
        
        if (nextUrl) {
          const url = new URL(nextUrl);
          params = Object.fromEntries(url.searchParams);
        }
      } while (nextUrl);

      logger.info(`Fetched ${ads.length} Meta ads`);
      return ads;
    }
  }

  async getAdCreatives(creativeIds: string[]): Promise<any[]> {
    if (!creativeIds.length) return [];

    const fields = [
      'id',
      'name',
      'status',
      'title',
      'body',
      'call_to_action_type',
      'image_hash',
      'image_url',
      'video_id',
      'thumbnail_url',
      'object_story_spec',
      'template_url',
      'url_tags',
      'link_url',
      'link_destination_display_url',
      'asset_feed_spec'
    ].join(',');

    const creatives: any[] = [];
    
    // Batch requests for creative details - Meta API allows up to 50 IDs per request
    const batchSize = 50;
    for (let i = 0; i < creativeIds.length; i += batchSize) {
      const batch = creativeIds.slice(i, i + batchSize);
      
      try {
        const params = {
          fields,
          ids: batch.join(',')
        };
        
        const response = await this.makeRequest<any>('/', params);
        
        // Response format for batch requests is different - it's an object with IDs as keys
        if (response && typeof response === 'object') {
          for (const [id, creative] of Object.entries(response)) {
            if (creative && typeof creative === 'object') {
              creatives.push(creative);
            }
          }
        }
        
      } catch (error) {
        logger.error('Failed to fetch creative batch', {
          batchIds: batch,
          error: getErrorMessage(error)
        });
        // Continue with other batches
      }
    }

    logger.info(`Fetched ${creatives.length} Meta ad creatives`);
    return creatives;
  }

  async getInsights(
    level: 'account' | 'campaign' | 'adset' | 'ad',
    entityIds?: string[],
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    // CRITICAL: Include entity IDs in fields to get them back in response
    const fields = [
      'campaign_id',    // Always include campaign_id
      'adset_id',       // Always include adset_id (will be null for campaign-level data)
      'ad_id',          // Always include ad_id (will be null for campaign/adset-level data)
      'impressions',
      'clicks',
      'spend',
      'conversions',
      'conversion_values',
      'ctr',
      'cpc',
      'cpm',
      'reach',
      'frequency',
      'unique_clicks',
      'cost_per_unique_click'
    ].join(',');

    let params: Record<string, any> = {
      fields,
      level,
      time_range: JSON.stringify({
        since: startDate || '2024-01-01',
        until: endDate || new Date().toISOString().split('T')[0]
      }),
      time_increment: 1, // CRITICAL: Request daily breakdown data
      limit: 100
    };

    const insights: any[] = [];

    if (entityIds && entityIds.length > 0) {
      // Fetch insights for specific entities
      for (const entityId of entityIds) {
        let endpoint: string;
        
        switch (level) {
          case 'campaign':
            endpoint = `/${entityId}/insights`;
            break;
          case 'adset':
            endpoint = `/${entityId}/insights`;
            break;
          case 'ad':
            endpoint = `/${entityId}/insights`;
            break;
          default:
            endpoint = `/${appConfig.metaAdAccountId}/insights`;
        }

        try {
          let nextUrl: string | undefined;
          do {
            const response = await this.makeRequest<any>(endpoint, params);
            insights.push(...response.data);
            nextUrl = response.paging?.next;
            
            if (nextUrl) {
              const url = new URL(nextUrl);
              params = Object.fromEntries(url.searchParams);
            }
          } while (nextUrl);
          
        } catch (error) {
          logger.error(`Failed to fetch insights for ${level} ${entityId}`, {
            error: getErrorMessage(error)
          });
          // Continue with other entities
        }
      }
    } else {
      // Fetch insights for the entire account
      const endpoint = `/${appConfig.metaAdAccountId}/insights`;
      
      let nextUrl: string | undefined;
      do {
        const response = await this.makeRequest<any>(endpoint, params);
        insights.push(...response.data);
        nextUrl = response.paging?.next;
        
        if (nextUrl) {
          const url = new URL(nextUrl);
          params = Object.fromEntries(url.searchParams);
        }
      } while (nextUrl);
    }

    logger.info(`Fetched ${insights.length} Meta insights for ${level} level`, {
      level,
      entityCount: entityIds?.length || 'all',
      dateRange: `${params.time_range}`,
      timeIncrement: params.time_increment,
      totalRecords: insights.length
    });
    return insights;
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection by fetching account info
      const response = await this.makeRequest(`/${appConfig.metaAdAccountId}`, {
        fields: 'id,name,account_status,currency'
      });
      
      if (response.data) {
        const accountData = Array.isArray(response.data) ? response.data[0] : response.data;
        logger.info('Meta Ads connection test successful', {
          accountId: accountData.id,
          accountName: accountData.name,
          status: accountData.account_status
        });
        return true;
      }
      
      return false;
      
    } catch (error) {
      logger.error('Meta Ads connection test failed', { error: getErrorMessage(error) });
      return false;
    }
  }
}

export default MetaAdsClient;