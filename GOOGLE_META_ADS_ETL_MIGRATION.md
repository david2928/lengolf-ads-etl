# Google & Meta Ads ETL Migration to Cloud Run

## Executive Summary

This document outlines the migration strategy for moving Google Ads and Meta Ads data extraction from the Next.js application to a dedicated Google Cloud Run service with comprehensive transactional data extraction, automated token refresh, incremental loading, and pgcron scheduling.

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Database Schema Design](#database-schema-design)
3. [API Source to Table Mapping](#api-source-to-table-mapping)
4. [Cloud Run Architecture](#cloud-run-architecture)
5. [Data Extraction Strategy](#data-extraction-strategy)
6. [Incremental Loading](#incremental-loading)
7. [PgCron Scheduling](#pgcron-scheduling)
8. [Migration Timeline](#migration-timeline)
9. [Implementation Examples](#implementation-examples)

## Current State Analysis

### Existing Implementation Issues
1. **Tight Coupling**: Ads API logic embedded in Next.js application
2. **Token Management**: Manual token refresh, stored in environment variables
3. **Limited Creative Data**: Missing ad-level creative assets and previews
4. **Performance**: Synchronous API calls blocking application performance
5. **Scalability**: Limited ability to handle large data volumes
6. **No Scheduling**: Manual data refresh only

### Current Marketing Schema Tables
```
✅ Existing Tables:
├── Google Ads
│   ├── google_ads_campaigns (11 columns)
│   ├── google_ads_keywords (keyword data)
│   ├── google_ads_keyword_performance (daily metrics)
│   ├── google_ads_campaign_performance (daily metrics)
│   ├── google_ads_pmax_performance (Performance Max metrics)
│   └── google_ads_sync_log (basic sync tracking)
├── Meta Ads  
│   ├── meta_ads_campaigns (campaign data)
│   ├── meta_ads_ad_sets (ad set data with targeting_json)
│   ├── meta_ads_ads (basic ad data with creative_json)
│   ├── meta_ads_campaign_performance (daily metrics)
│   ├── meta_ads_adset_performance (ad set metrics)
│   └── meta_ads_sync_log (basic sync tracking)

❌ Missing Tables:
├── Google Ads
│   ├── google_ads_ad_groups (ad group hierarchy)
│   ├── google_ads_ads (ad creative data)
│   └── Creative assets with thumbnails/previews
```

## Database Schema Design

### ✅ New Tables Created

#### Google Ads Enhancement
```sql
-- Ad Groups (missing hierarchy level)
marketing.google_ads_ad_groups
├── ad_group_id (BIGINT PRIMARY KEY)
├── campaign_id (BIGINT)
├── ad_group_name (TEXT)
├── ad_group_status (TEXT)
├── target_cpa_micros (BIGINT)
├── targeting_setting (JSONB)
└── sync timestamps

-- Ads with Creative Data
marketing.google_ads_ads  
├── ad_id (BIGINT PRIMARY KEY)
├── ad_group_id (BIGINT)
├── campaign_id (BIGINT)
├── ad_name, ad_status, ad_type
├── headline1, headline2, headline3 (TEXT)
├── description1, description2 (TEXT)
├── final_url, display_url (TEXT)
├── headlines (JSONB) -- Array of headlines with pins
├── descriptions (JSONB) -- Array of descriptions
├── image_assets (JSONB) -- URLs, dimensions
├── video_assets (JSONB)
├── ad_strength (TEXT)
├── creative_json (JSONB) -- Full creative data
└── sync timestamps
```

#### Meta Ads Enhancement
```sql
-- Detailed Creative Tracking
marketing.meta_ads_ad_creatives
├── creative_id (TEXT PRIMARY KEY)
├── ad_id (TEXT)
├── campaign_id, adset_id (TEXT)
├── creative_name, creative_status, creative_type
├── image_url, thumbnail_url, preview_url (TEXT) -- KEY URLS!
├── video_url (TEXT)
├── title, body, call_to_action_type (TEXT)
├── link_url, display_link (TEXT)
├── carousel_data (JSONB)
├── image_hash, video_id (TEXT)
├── creative_json (JSONB) -- Full creative data
└── sync timestamps
```

#### Unified Creative Assets
```sql
-- Cross-Platform Asset Storage
marketing.ad_creative_assets
├── asset_id (UUID PRIMARY KEY)
├── platform (TEXT) -- 'google' or 'meta'
├── platform_asset_id (TEXT)
├── ad_id (TEXT) -- BIGINT for Google, TEXT for Meta
├── asset_type (TEXT) -- 'image', 'video', 'text', 'logo'
├── asset_url (TEXT)
├── thumbnail_url (TEXT) -- KEY FOR PREVIEWS!
├── preview_url (TEXT) -- Ad preview URL
├── width, height (INTEGER)
├── file_size_bytes (BIGINT)
├── duration_seconds (INTEGER) -- For videos
├── mime_type (TEXT)
├── approval_status, policy_review_status (TEXT)
├── text_content (TEXT) -- For text assets
└── sync timestamps

UNIQUE(platform, platform_asset_id)
```

#### ETL Control
```sql
-- Enhanced Sync Tracking
marketing.etl_sync_log
├── id (UUID PRIMARY KEY)
├── platform (TEXT) -- 'google' or 'meta'
├── entity_type (TEXT) -- 'campaigns', 'ads', 'keywords', etc
├── sync_type (TEXT) -- 'full', 'incremental'
├── start_time, end_time (TIMESTAMPTZ)
├── status (TEXT) -- 'running', 'completed', 'failed'
├── records_processed, records_inserted (INTEGER)
├── records_updated, records_failed (INTEGER)
├── last_modified_time (TIMESTAMPTZ) -- For incremental tracking
├── next_page_token (TEXT) -- For pagination
├── error_message, error_details (TEXT/JSONB)
└── created_at (TIMESTAMPTZ)
```

## API Source to Table Mapping

### Google Ads API → Database Tables

#### Campaign Level
```typescript
// Google Ads API: SearchGoogleAdsRequest
GAQL: "SELECT campaign.id, campaign.name, campaign.status, campaign.start_date, campaign.end_date, campaign.campaign_budget.amount_micros FROM campaign"

// Populates: marketing.google_ads_campaigns
{
  campaign_id: campaign.id,
  campaign_name: campaign.name,
  campaign_status: campaign.status,
  campaign_type: campaign.advertisingChannelType,
  start_date: campaign.startDate,
  end_date: campaign.endDate,
  budget_amount_micros: campaign.campaignBudget.amountMicros,
  bidding_strategy_type: campaign.biddingStrategyType
}
```

#### Ad Group Level
```typescript
// Google Ads API: SearchGoogleAdsRequest
GAQL: "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.target_cpa_micros, ad_group.target_cpm_micros, campaign.id FROM ad_group"

// Populates: marketing.google_ads_ad_groups
{
  ad_group_id: adGroup.id,
  campaign_id: adGroup.campaign.split('/')[3],
  ad_group_name: adGroup.name,
  ad_group_status: adGroup.status,
  ad_group_type: adGroup.type,
  target_cpa_micros: adGroup.targetCpaMicros,
  target_cpm_micros: adGroup.targetCpmMicros,
  targeting_setting: adGroup.targetingSetting
}
```

#### Ad Level (Key Creative Data)
```typescript
// Google Ads API: SearchGoogleAdsRequest
GAQL: `
  SELECT 
    ad.id, ad.name, ad.status, ad.type,
    ad.responsive_search_ad.headlines,
    ad.responsive_search_ad.descriptions,
    ad.responsive_search_ad.path1,
    ad.responsive_search_ad.path2,
    ad.final_urls,
    ad.final_mobile_urls,
    ad.image_ad.image_asset,
    ad.video_ad.video_asset,
    ad_group.id,
    campaign.id
  FROM ad
`

// Populates: marketing.google_ads_ads
{
  ad_id: ad.id,
  ad_group_id: adGroup.id,
  campaign_id: campaign.id,
  ad_name: ad.name,
  ad_status: ad.status,
  ad_type: ad.type,
  headline1: ad.responsiveSearchAd?.headlines?.[0]?.text,
  headline2: ad.responsiveSearchAd?.headlines?.[1]?.text,
  headline3: ad.responsiveSearchAd?.headlines?.[2]?.text,
  description1: ad.responsiveSearchAd?.descriptions?.[0]?.text,
  description2: ad.responsiveSearchAd?.descriptions?.[1]?.text,
  final_url: ad.finalUrls?.[0],
  final_mobile_url: ad.finalMobileUrls?.[0],
  headlines: ad.responsiveSearchAd?.headlines, // Full array with pins
  descriptions: ad.responsiveSearchAd?.descriptions, // Full array
  image_assets: [], // Extracted separately
  video_assets: [], // Extracted separately
  ad_strength: ad.adStrength,
  creative_json: ad // Full ad object
}
```

#### Creative Assets
```typescript
// Google Ads API: Asset Resource
GAQL: "SELECT asset.id, asset.name, asset.type, asset.image_asset.full_size_image_url, asset.image_asset.thumbnail_image_url FROM asset WHERE asset.id IN (ad_asset_ids)"

// Populates: marketing.ad_creative_assets
{
  platform: 'google',
  platform_asset_id: asset.id,
  ad_id: adId,
  asset_type: asset.type, // 'IMAGE', 'VIDEO', 'TEXT'
  asset_url: asset.imageAsset?.fullSizeImageUrl,
  thumbnail_url: asset.imageAsset?.thumbnailImageUrl, // KEY!
  preview_url: null, // Google doesn't provide direct preview URLs
  width: asset.imageAsset?.fullSizeImage?.width,
  height: asset.imageAsset?.fullSizeImage?.height,
  file_size_bytes: asset.imageAsset?.fullSizeImage?.sizeBytes,
  mime_type: asset.imageAsset?.mimeType,
  approval_status: asset.policyValidationParameter?.ignorabilityType
}
```

#### Performance Data
```typescript
// Google Ads API: SearchGoogleAdsRequest with Metrics
GAQL: `
  SELECT 
    campaign.id, ad_group.id, ad.id, keyword.info.text,
    segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc, metrics.average_cpm
  FROM keyword_view
  WHERE segments.date BETWEEN '2024-01-01' AND '2024-01-31'
`

// Populates: marketing.google_ads_keyword_performance
{
  keyword_id: keyword.id,
  campaign_id: campaign.id,
  ad_group_id: adGroup.id,
  date: segments.date,
  impressions: metrics.impressions,
  clicks: metrics.clicks,
  cost_micros: metrics.costMicros,
  conversions: metrics.conversions,
  conversion_value_micros: metrics.conversionsValue,
  ctr: metrics.ctr,
  average_cpc_micros: metrics.averageCpc,
  average_cpm_micros: metrics.averageCpm
}
```

### Meta Ads API → Database Tables

#### Campaign Level
```typescript
// Meta Graph API: GET /act_{ad_account_id}/campaigns
// Fields: id,name,status,objective,created_time,updated_time,start_time,stop_time,budget_rebalance_flag

// Populates: marketing.meta_ads_campaigns
{
  campaign_id: campaign.id,
  campaign_name: campaign.name,
  campaign_status: campaign.status, // ACTIVE, PAUSED, DELETED
  objective: campaign.objective, // CONVERSIONS, TRAFFIC, etc
  created_time: campaign.created_time,
  updated_time: campaign.updated_time,
  start_time: campaign.start_time,
  stop_time: campaign.stop_time
}
```

#### Ad Set Level
```typescript
// Meta Graph API: GET /act_{ad_account_id}/adsets
// Fields: id,name,status,campaign_id,optimization_goal,billing_event,bid_amount,daily_budget,lifetime_budget,targeting

// Populates: marketing.meta_ads_ad_sets
{
  adset_id: adset.id,
  adset_name: adset.name,
  adset_status: adset.status,
  campaign_id: adset.campaign_id,
  optimization_goal: adset.optimization_goal, // IMPRESSIONS, CLICKS, CONVERSIONS
  daily_budget_cents: adset.daily_budget,
  lifetime_budget_cents: adset.lifetime_budget,
  bid_amount_cents: adset.bid_amount,
  targeting_json: adset.targeting // Full targeting object
}
```

#### Ad Level
```typescript
// Meta Graph API: GET /act_{ad_account_id}/ads
// Fields: id,name,status,campaign_id,adset_id,creative,configured_status,effective_status

// Populates: marketing.meta_ads_ads
{
  ad_id: ad.id,
  ad_name: ad.name,
  ad_status: ad.status,
  campaign_id: ad.campaign_id,
  adset_id: ad.adset_id,
  creative_json: ad.creative // Basic creative reference
}
```

#### Creative Detailed Data (Key Enhancement)
```typescript
// Meta Graph API: GET /{creative_id}
// Fields: id,name,status,title,body,image_url,thumbnail_url,video_id,call_to_action_type,object_story_spec

// Populates: marketing.meta_ads_ad_creatives
{
  creative_id: creative.id,
  ad_id: adId, // From ad.creative.id relationship
  campaign_id: campaignId,
  adset_id: adsetId,
  creative_name: creative.name,
  creative_status: creative.status,
  creative_type: creative.object_story_spec?.link_data ? 'SINGLE_LINK' : 'IMAGE',
  title: creative.title || creative.object_story_spec?.link_data?.message,
  body: creative.body || creative.object_story_spec?.link_data?.description,
  image_url: creative.image_url || creative.object_story_spec?.link_data?.picture,
  thumbnail_url: creative.thumbnail_url, // KEY!
  preview_url: `https://www.facebook.com/ads/creative/preview/${creative.id}`, // Constructed
  video_url: creative.video_id ? `https://video.xx.fbcdn.net/${creative.video_id}` : null,
  call_to_action_type: creative.call_to_action_type,
  link_url: creative.object_story_spec?.link_data?.link,
  display_link: creative.object_story_spec?.link_data?.caption,
  carousel_data: creative.object_story_spec?.link_data?.child_attachments, // For carousel ads
  creative_json: creative // Full creative object
}
```

#### Creative Assets
```typescript
// Meta Graph API: GET /{image_hash} or GET /{video_id}
// For images: Fields: id,hash,url,width,height
// For videos: Fields: id,title,description,picture,source

// Populates: marketing.ad_creative_assets
{
  platform: 'meta',
  platform_asset_id: image.hash || video.id,
  ad_id: adId,
  asset_type: video.id ? 'video' : 'image',
  asset_url: image.url || video.source,
  thumbnail_url: image.url || video.picture, // KEY!
  preview_url: null, // Handled at creative level for Meta
  width: image.width || video.width,
  height: image.height || video.height,
  duration_seconds: video.length,
  mime_type: 'image/jpeg' || 'video/mp4',
  approval_status: 'APPROVED' // Meta doesn't provide detailed approval status
}
```

#### Performance Data (Insights)
```typescript
// Meta Graph API: GET /{ad_id}/insights
// Fields: impressions,clicks,spend,conversions,conversion_values,ctr,cpc,cpm
// Breakdowns: date

// Populates: marketing.meta_ads_adset_performance
{
  adset_id: insight.adset_id,
  campaign_id: insight.campaign_id,
  date: insight.date_start, // Daily breakdown
  impressions: insight.impressions,
  clicks: insight.clicks,
  spend_cents: Math.round(insight.spend * 100), // Convert to cents
  reach: insight.reach,
  frequency: insight.frequency,
  unique_clicks: insight.unique_clicks,
  conversions: insight.conversions?.[0]?.value || 0,
  conversion_value_cents: Math.round((insight.conversions?.[0]?.conversion_value || 0) * 100),
  ctr: insight.ctr,
  cpc_cents: Math.round((insight.cpc || 0) * 100),
  cpm_cents: Math.round((insight.cpm || 0) * 100)
}
```

## Cloud Run Architecture

### Repository Structure
```
lengolf-ads-etl/
├── src/
│   ├── extractors/
│   │   ├── google/
│   │   │   ├── client.ts              // Google Ads client setup
│   │   │   ├── campaigns.ts           // Campaign extraction
│   │   │   ├── ad-groups.ts           // Ad group extraction
│   │   │   ├── ads.ts                 // Ad creative extraction
│   │   │   ├── keywords.ts            // Keyword extraction
│   │   │   ├── assets.ts              // Creative asset extraction
│   │   │   └── performance.ts         // Performance metrics
│   │   └── meta/
│   │       ├── client.ts              // Meta Graph API client
│   │       ├── campaigns.ts           // Campaign extraction
│   │       ├── adsets.ts              // Ad set extraction
│   │       ├── ads.ts                 // Ad extraction
│   │       ├── creatives.ts           // Creative detail extraction
│   │       ├── assets.ts              // Asset extraction
│   │       └── insights.ts            // Performance insights
│   ├── transformers/
│   │   ├── google-transformer.ts      // Google data normalization
│   │   ├── meta-transformer.ts        // Meta data normalization
│   │   └── unified-transformer.ts     // Cross-platform normalization
│   ├── loaders/
│   │   ├── supabase-client.ts         // Supabase connection
│   │   ├── batch-upsert.ts            // Efficient bulk operations
│   │   ├── incremental-sync.ts        // State-based incremental loading
│   │   └── error-handler.ts           // Error recovery & retry
│   ├── auth/
│   │   ├── google-oauth.ts            // Google OAuth2 refresh
│   │   ├── meta-oauth.ts              // Meta long-lived token refresh
│   │   └── token-manager.ts           // Unified token management
│   ├── scheduler/
│   │   ├── job-manager.ts             // Job scheduling logic
│   │   └── sync-orchestrator.ts       // Multi-platform orchestration
│   ├── api/
│   │   ├── health.ts                  // Health check endpoint
│   │   ├── sync.ts                    // Main sync trigger endpoint
│   │   ├── status.ts                  // Sync status endpoint
│   │   └── metrics.ts                 // Prometheus metrics
│   └── utils/
│       ├── logger.ts                  // Structured logging
│       ├── config.ts                  // Environment configuration
│       └── helpers.ts                 // Common utilities
├── Dockerfile
├── cloudbuild.yaml
├── package.json
└── terraform/
    └── infrastructure.tf              // GCP resource definitions
```

## Data Extraction Strategy

### Google Ads Creative Extraction Flow

```typescript
// src/extractors/google/ads.ts
class GoogleAdsExtractor {
  async extractAdsWithCreatives(customerId: string, modifiedSince?: Date): Promise<AdWithCreatives[]> {
    const query = `
      SELECT 
        ad.id,
        ad.name,
        ad.status,
        ad.type,
        ad.final_urls,
        ad.responsive_search_ad.headlines,
        ad.responsive_search_ad.descriptions,
        ad.responsive_search_ad.path1,
        ad.responsive_search_ad.path2,
        ad.image_ad.image_asset,
        ad.video_ad.video_asset,
        ad_group.id,
        campaign.id
      FROM ad 
      WHERE ad.status != 'REMOVED'
      ${modifiedSince ? `AND ad.modified_time >= '${modifiedSince.toISOString()}'` : ''}
    `;

    const ads = await this.client.search(query);
    
    // Extract creative assets for each ad
    for (const ad of ads) {
      // Get image assets
      if (ad.responsiveSearchAd?.headlines) {
        ad.creativeAssets = await this.extractCreativeAssets(ad.id);
      }
      
      // Get video assets
      if (ad.videoAd?.videoAsset) {
        ad.videoAssets = await this.extractVideoAssets(ad.videoAd.videoAsset);
      }
    }
    
    return ads;
  }

  async extractCreativeAssets(adId: string): Promise<CreativeAsset[]> {
    // Get assets associated with the ad
    const assetQuery = `
      SELECT 
        asset.id,
        asset.name,
        asset.type,
        asset.image_asset.full_size_image_url,
        asset.image_asset.thumbnail_image_url,
        asset.image_asset.full_size_image.width,
        asset.image_asset.full_size_image.height,
        asset.image_asset.full_size_image.size_bytes,
        asset.image_asset.mime_type
      FROM asset 
      WHERE asset.id IN (
        SELECT ad_asset.asset FROM ad_asset WHERE ad_asset.ad = 'customers/${customerId}/ads/${adId}'
      )
    `;

    const assets = await this.client.search(assetQuery);
    
    return assets.map(asset => ({
      platform: 'google',
      platform_asset_id: asset.id,
      ad_id: adId,
      asset_type: asset.type.toLowerCase(),
      asset_url: asset.imageAsset?.fullSizeImageUrl,
      thumbnail_url: asset.imageAsset?.thumbnailImageUrl, // KEY!
      width: asset.imageAsset?.fullSizeImage?.width,
      height: asset.imageAsset?.fullSizeImage?.height,
      file_size_bytes: asset.imageAsset?.fullSizeImage?.sizeBytes,
      mime_type: asset.imageAsset?.mimeType,
      approval_status: asset.policyValidationParameter?.ignorabilityType
    }));
  }
}
```

### Meta Ads Creative Extraction Flow

```typescript
// src/extractors/meta/creatives.ts
class MetaCreativesExtractor {
  async extractCreativesWithAssets(adAccountId: string, modifiedSince?: Date): Promise<CreativeWithAssets[]> {
    // First get all ads
    const adsResponse = await this.client.get(`/act_${adAccountId}/ads`, {
      fields: 'id,name,status,campaign_id,adset_id,creative{id}',
      ...(modifiedSince && { 
        filtering: JSON.stringify([{
          field: 'updated_time',
          operator: 'GREATER_THAN',
          value: Math.floor(modifiedSince.getTime() / 1000)
        }])
      })
    });

    const creatives = [];
    
    for (const ad of adsResponse.data) {
      if (ad.creative?.id) {
        const creative = await this.extractCreativeDetails(ad.creative.id, ad);
        creatives.push(creative);
      }
    }
    
    return creatives;
  }

  async extractCreativeDetails(creativeId: string, ad: any): Promise<CreativeWithAssets> {
    // Get detailed creative information
    const creative = await this.client.get(`/${creativeId}`, {
      fields: [
        'id', 'name', 'status', 'title', 'body',
        'image_url', 'thumbnail_url', 'video_id',
        'call_to_action_type', 'object_story_spec',
        'image_hash', 'asset_feed_spec'
      ].join(',')
    });

    // Extract asset details
    const assets = [];
    
    // Handle image assets
    if (creative.image_hash) {
      const imageAsset = await this.extractImageAsset(creative.image_hash, creativeId);
      assets.push(imageAsset);
    }
    
    // Handle video assets
    if (creative.video_id) {
      const videoAsset = await this.extractVideoAsset(creative.video_id, creativeId);
      assets.push(videoAsset);
    }
    
    // Handle carousel assets
    if (creative.object_story_spec?.link_data?.child_attachments) {
      for (const attachment of creative.object_story_spec.link_data.child_attachments) {
        if (attachment.image_hash) {
          const carouselAsset = await this.extractImageAsset(attachment.image_hash, creativeId);
          assets.push(carouselAsset);
        }
      }
    }

    return {
      creative: {
        creative_id: creative.id,
        ad_id: ad.id,
        campaign_id: ad.campaign_id,
        adset_id: ad.adset_id,
        creative_name: creative.name,
        creative_status: creative.status,
        creative_type: this.determineCreativeType(creative),
        title: creative.title || creative.object_story_spec?.link_data?.message,
        body: creative.body || creative.object_story_spec?.link_data?.description,
        image_url: creative.image_url || creative.object_story_spec?.link_data?.picture,
        thumbnail_url: creative.thumbnail_url, // KEY!
        preview_url: `https://www.facebook.com/ads/creative/preview/${creative.id}`,
        video_url: creative.video_id ? await this.getVideoUrl(creative.video_id) : null,
        call_to_action_type: creative.call_to_action_type,
        link_url: creative.object_story_spec?.link_data?.link,
        display_link: creative.object_story_spec?.link_data?.caption,
        carousel_data: creative.object_story_spec?.link_data?.child_attachments,
        creative_json: creative
      },
      assets
    };
  }

  async extractImageAsset(imageHash: string, creativeId: string): Promise<CreativeAsset> {
    const image = await this.client.get(`/${imageHash}`, {
      fields: 'id,hash,url,width,height'
    });

    return {
      platform: 'meta',
      platform_asset_id: image.hash,
      ad_id: creativeId,
      asset_type: 'image',
      asset_url: image.url,
      thumbnail_url: image.url, // Meta uses same URL, they auto-resize
      width: image.width,
      height: image.height,
      mime_type: 'image/jpeg' // Meta default
    };
  }
}
```

## Incremental Loading

### State-Based Incremental Sync
```typescript
// src/loaders/incremental-sync.ts
class IncrementalSyncManager {
  async performIncrementalSync(platform: 'google' | 'meta', entityType: string): Promise<SyncResult> {
    // 1. Get last successful sync state
    const lastSync = await this.getLastSyncState(platform, entityType);
    
    // 2. Calculate sync parameters
    const syncParams = this.calculateSyncParams(lastSync);
    
    // 3. Extract data based on modification time
    let extractedData;
    if (platform === 'google') {
      extractedData = await this.extractGoogleData(entityType, syncParams);
    } else {
      extractedData = await this.extractMetaData(entityType, syncParams);
    }
    
    // 4. Transform and load data
    const result = await this.loadData(platform, entityType, extractedData);
    
    // 5. Update sync state
    await this.updateSyncState(platform, entityType, {
      last_sync_time: new Date(),
      records_processed: result.recordsProcessed,
      status: 'completed'
    });
    
    return result;
  }

  private async getLastSyncState(platform: string, entityType: string): Promise<SyncState> {
    const { data } = await this.supabase
      .from('etl_sync_log')
      .select('*')
      .eq('platform', platform)
      .eq('entity_type', entityType)
      .eq('status', 'completed')
      .order('end_time', { ascending: false })
      .limit(1)
      .single();

    return data || {
      platform,
      entity_type: entityType,
      last_sync_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      last_modified_time: null
    };
  }

  private calculateSyncParams(lastSync: SyncState): SyncParams {
    const lookbackHours = 2; // Buffer for late-arriving data
    const modifiedSince = new Date(
      (lastSync.last_modified_time || lastSync.last_sync_time).getTime() - 
      (lookbackHours * 60 * 60 * 1000)
    );

    return {
      modifiedSince,
      pageToken: lastSync.next_page_token
    };
  }
}
```

### Batch Processing Strategy
```typescript
// src/loaders/batch-upsert.ts
class BatchUpsertManager {
  async upsertAdsWithCreatives(platform: string, adsData: AdWithCreatives[]): Promise<UpsertResult> {
    const batchSize = 1000;
    let totalProcessed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;

    for (let i = 0; i < adsData.length; i += batchSize) {
      const batch = adsData.slice(i, i + batchSize);
      
      // Separate ads and creative assets
      const ads = batch.map(item => item.ad);
      const creativeAssets = batch.flatMap(item => item.creativeAssets || []);
      
      // Upsert ads first
      const adsResult = await this.upsertBatch(
        platform === 'google' ? 'google_ads_ads' : 'meta_ads_ad_creatives',
        ads
      );
      
      // Then upsert creative assets
      if (creativeAssets.length > 0) {
        await this.upsertBatch('ad_creative_assets', creativeAssets);
      }
      
      totalProcessed += batch.length;
      totalInserted += adsResult.inserted;
      totalUpdated += adsResult.updated;
      
      // Log progress
      console.log(`Processed ${totalProcessed}/${adsData.length} ads`);
    }

    return {
      recordsProcessed: totalProcessed,
      recordsInserted: totalInserted,
      recordsUpdated: totalUpdated
    };
  }

  private async upsertBatch(tableName: string, data: any[]): Promise<BatchResult> {
    const { data: result, error } = await this.supabase
      .from(tableName)
      .upsert(data, { 
        onConflict: this.getConflictColumns(tableName),
        ignoreDuplicates: false 
      })
      .select('*');

    if (error) {
      throw new Error(`Batch upsert failed for ${tableName}: ${error.message}`);
    }

    return {
      inserted: result?.length || 0,
      updated: 0 // Supabase doesn't distinguish, but we could track this
    };
  }

  private getConflictColumns(tableName: string): string {
    const conflictMap = {
      'google_ads_campaigns': 'campaign_id',
      'google_ads_ad_groups': 'ad_group_id', 
      'google_ads_ads': 'ad_id',
      'meta_ads_campaigns': 'campaign_id',
      'meta_ads_ad_sets': 'adset_id',
      'meta_ads_ads': 'ad_id',
      'meta_ads_ad_creatives': 'creative_id',
      'ad_creative_assets': 'platform,platform_asset_id'
    };
    
    return conflictMap[tableName] || 'id';
  }
}
```

## PgCron Scheduling

### Scheduled Jobs Setup
```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Set API key for authentication
ALTER DATABASE postgres SET app.etl_api_key = 'your-secure-api-key';

-- Hourly incremental sync for Google Ads performance and new ads
SELECT cron.schedule(
    'google-ads-incremental-sync',
    '0 * * * *', -- Every hour
    $$
    SELECT net.http_post(
        url := 'https://ads-etl-service.run.app/api/sync',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.etl_api_key'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'platform', 'google',
            'mode', 'incremental',
            'entities', ARRAY['campaigns', 'ad_groups', 'ads', 'keywords', 'performance'],
            'lookbackHours', 2
        )
    );
    $$
);

-- Hourly incremental sync for Meta Ads (offset by 30 minutes)
SELECT cron.schedule(
    'meta-ads-incremental-sync',
    '30 * * * *', -- Every hour at 30 minutes
    $$
    SELECT net.http_post(
        url := 'https://ads-etl-service.run.app/api/sync',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.etl_api_key'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'platform', 'meta',
            'mode', 'incremental', 
            'entities', ARRAY['campaigns', 'adsets', 'ads', 'creatives', 'insights'],
            'lookbackHours', 2
        )
    );
    $$
);

-- Daily creative asset sync (images, videos, thumbnails)
SELECT cron.schedule(
    'daily-creative-assets-sync',
    '0 3 * * *', -- 3 AM daily
    $$
    SELECT net.http_post(
        url := 'https://ads-etl-service.run.app/api/sync',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.etl_api_key'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'syncType', 'creative-assets',
            'mode', 'full',
            'platforms', ARRAY['google', 'meta']
        )
    );
    $$
);

-- Weekly full reconciliation
SELECT cron.schedule(
    'weekly-full-reconciliation',
    '0 4 * * 0', -- Sunday 4 AM
    $$
    SELECT net.http_post(
        url := 'https://ads-etl-service.run.app/api/sync',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.etl_api_key'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'mode', 'full',
            'platforms', ARRAY['google', 'meta'],
            'entities', ARRAY['campaigns', 'ad_groups', 'ads', 'keywords', 'creatives', 'performance'],
            'lookbackDays', 7
        )
    );
    $$
);

-- Monitor job status
SELECT 
    jobname,
    schedule,
    active,
    last_run,
    next_run
FROM cron.job 
WHERE jobname LIKE '%ads%'
ORDER BY next_run;
```

### Job Monitoring & Alerting
```sql
-- Create monitoring view
CREATE OR REPLACE VIEW marketing.etl_sync_monitoring AS
WITH recent_syncs AS (
    SELECT 
        platform,
        entity_type,
        status,
        start_time,
        end_time,
        records_processed,
        error_message,
        ROW_NUMBER() OVER (PARTITION BY platform, entity_type ORDER BY start_time DESC) as rn
    FROM marketing.etl_sync_log
    WHERE start_time >= NOW() - INTERVAL '24 hours'
)
SELECT 
    platform,
    entity_type,
    status,
    start_time,
    end_time,
    EXTRACT(EPOCH FROM (end_time - start_time))/60 as duration_minutes,
    records_processed,
    CASE 
        WHEN status = 'failed' THEN error_message
        WHEN status = 'running' AND start_time < NOW() - INTERVAL '2 hours' THEN 'Long running job'
        WHEN status = 'completed' AND records_processed = 0 THEN 'No data processed'
        ELSE 'OK'
    END as alert_status
FROM recent_syncs
WHERE rn = 1
ORDER BY platform, entity_type;

-- Alert for failed or stuck jobs
SELECT cron.schedule(
    'etl-monitoring-alerts',
    '*/15 * * * *', -- Every 15 minutes
    $$
    DO $alert$
    DECLARE
        alert_count INTEGER;
        alert_message TEXT;
    BEGIN
        SELECT COUNT(*), STRING_AGG(platform || '.' || entity_type || ': ' || alert_status, '\n')
        INTO alert_count, alert_message
        FROM marketing.etl_sync_monitoring
        WHERE alert_status != 'OK';
        
        IF alert_count > 0 THEN
            -- Send alert (implement your preferred alerting method)
            PERFORM net.http_post(
                url := 'YOUR_WEBHOOK_URL',
                body := jsonb_build_object(
                    'text', 'ETL Alert: ' || alert_count || ' issues detected:\n' || alert_message
                )
            );
        END IF;
    END;
    $alert$;
    $$
);
```

## Migration Timeline

### Phase 1: Infrastructure Setup (Week 1)
- [x] **Database Schema**: Enhanced marketing schema tables created
- [ ] **Cloud Run Setup**: Create repository and basic service structure  
- [ ] **Secret Management**: Configure Google Secret Manager for API keys
- [ ] **CI/CD Pipeline**: Set up Cloud Build triggers
- [ ] **Token Storage**: Implement secure token storage in Supabase

### Phase 2: Google Ads ETL Development (Week 2-3)
- [ ] **Google Ads Client**: OAuth2 setup and API client initialization
- [ ] **Campaign/AdGroup Extraction**: Basic hierarchy extraction
- [ ] **Ad Creative Extraction**: Implement creative data extraction with assets
- [ ] **Asset Management**: Image/video asset extraction with thumbnails
- [ ] **Performance Data**: Extend existing performance extraction
- [ ] **Incremental Loading**: State-based incremental sync implementation

### Phase 3: Meta Ads Enhancement (Week 4)
- [ ] **Meta Client Enhancement**: Improve existing Meta API integration
- [ ] **Creative Detail Extraction**: Implement detailed creative extraction
- [ ] **Asset Processing**: Creative asset extraction with previews
- [ ] **Performance Optimization**: Batch processing and error handling
- [ ] **Cross-Platform Assets**: Unified asset storage implementation

### Phase 4: Production Deployment (Week 5)
- [ ] **Cloud Run Deployment**: Deploy service to GCP
- [ ] **PgCron Configuration**: Set up automated scheduling
- [ ] **Monitoring Setup**: Implement logging and alerting
- [ ] **Performance Testing**: Load testing with production data volumes
- [ ] **Parallel Running**: Run alongside existing system for validation

### Phase 5: Migration & Optimization (Week 6)
- [ ] **Dashboard Updates**: Update existing dashboards to use new data
- [ ] **API Deprecation**: Deprecate old API endpoints in main app
- [ ] **Performance Monitoring**: Monitor and optimize ETL performance
- [ ] **Documentation**: Complete operational documentation
- [ ] **Team Training**: Train team on new system operation

## Implementation Examples

### Main Sync Endpoint
```typescript
// src/api/sync.ts
import express from 'express';
import { GoogleAdsExtractor } from '../extractors/google/ads';
import { MetaCreativesExtractor } from '../extractors/meta/creatives';
import { IncrementalSyncManager } from '../loaders/incremental-sync';

const router = express.Router();

interface SyncRequest {
  platform?: 'google' | 'meta' | 'all';
  mode: 'incremental' | 'full';
  entities: string[];
  lookbackHours?: number;
  lookbackDays?: number;
}

router.post('/sync', async (req: Request, res: Response) => {
  const { 
    platform = 'all', 
    mode, 
    entities, 
    lookbackHours = 2,
    lookbackDays = 7 
  }: SyncRequest = req.body;

  try {
    // Create sync batch record
    const batchId = await createSyncBatch(platform, mode, entities);
    
    // Process platforms
    const platforms = platform === 'all' ? ['google', 'meta'] : [platform];
    
    for (const plt of platforms) {
      for (const entity of entities) {
        await processPlatformEntity(plt, entity, mode, { lookbackHours, lookbackDays }, batchId);
      }
    }

    // Update batch status
    await updateSyncBatch(batchId, 'completed');

    res.json({
      success: true,
      batchId,
      message: `Sync completed for ${platforms.join(', ')} - ${entities.join(', ')}`
    });

  } catch (error) {
    console.error('Sync failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

async function processPlatformEntity(
  platform: string, 
  entity: string, 
  mode: string, 
  options: any,
  batchId: string
) {
  const syncManager = new IncrementalSyncManager();
  
  switch (entity) {
    case 'campaigns':
      return syncManager.syncCampaigns(platform, mode, options);
    
    case 'ad_groups':
    case 'adsets':
      return syncManager.syncAdGroups(platform, mode, options);
    
    case 'ads':
      return syncManager.syncAds(platform, mode, options);
    
    case 'creatives':
      return syncManager.syncCreatives(platform, mode, options);
    
    case 'keywords':
      if (platform === 'google') {
        return syncManager.syncKeywords(platform, mode, options);
      }
      break;
    
    case 'performance':
    case 'insights':
      return syncManager.syncPerformance(platform, mode, options);
    
    default:
      throw new Error(`Unknown entity type: ${entity}`);
  }
}

export default router;
```

### Token Management
```typescript
// src/auth/token-manager.ts
import { createClient } from '@supabase/supabase-js';

class TokenManager {
  private supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  async getValidGoogleToken(): Promise<string> {
    // Get current token from database
    const { data: tokenData } = await this.supabase
      .from('platform_tokens')
      .select('*')
      .eq('platform', 'google')
      .single();

    if (!tokenData) {
      throw new Error('Google token not found');
    }

    // Check if token is expired
    if (new Date(tokenData.expires_at) <= new Date()) {
      console.log('Google token expired, refreshing...');
      return await this.refreshGoogleToken(tokenData.refresh_token);
    }

    return tokenData.access_token;
  }

  async refreshGoogleToken(refreshToken: string): Promise<string> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const tokenResponse = await response.json();

    if (!response.ok) {
      throw new Error(`Google token refresh failed: ${tokenResponse.error_description}`);
    }

    // Update token in database
    await this.supabase
      .from('platform_tokens')
      .update({
        access_token: tokenResponse.access_token,
        expires_at: new Date(Date.now() + (tokenResponse.expires_in * 1000)),
        updated_at: new Date()
      })
      .eq('platform', 'google');

    return tokenResponse.access_token;
  }

  async getValidMetaToken(): Promise<string> {
    const { data: tokenData } = await this.supabase
      .from('platform_tokens') 
      .select('*')
      .eq('platform', 'meta')
      .single();

    if (!tokenData) {
      throw new Error('Meta token not found');
    }

    // Meta long-lived tokens are valid for 60 days
    const daysUntilExpiry = Math.floor(
      (new Date(tokenData.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );

    // Refresh if token expires in less than 7 days
    if (daysUntilExpiry < 7) {
      console.log(`Meta token expires in ${daysUntilExpiry} days, refreshing...`);
      return await this.refreshMetaToken(tokenData.access_token);
    }

    return tokenData.access_token;
  }

  async refreshMetaToken(currentToken: string): Promise<string> {
    const response = await fetch(
      `https://graph.facebook.com/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${process.env.META_APP_ID}&` +
      `client_secret=${process.env.META_APP_SECRET}&` +
      `fb_exchange_token=${currentToken}`
    );

    const tokenResponse = await response.json();

    if (!response.ok) {
      throw new Error(`Meta token refresh failed: ${tokenResponse.error?.message}`);
    }

    // Update token in database
    await this.supabase
      .from('platform_tokens')
      .update({
        access_token: tokenResponse.access_token,
        expires_at: new Date(Date.now() + (tokenResponse.expires_in * 1000)),
        updated_at: new Date()
      })
      .eq('platform', 'meta');

    return tokenResponse.access_token;
  }
}

export default TokenManager;
```

### Data Quality Checks
```typescript
// src/utils/data-quality.ts
class DataQualityChecker {
  async runQualityChecks(batchId: string, platform: string, entityType: string): Promise<QualityReport> {
    const checks = [];

    // Check for duplicate records
    checks.push(await this.checkDuplicates(platform, entityType));
    
    // Check for missing required fields
    checks.push(await this.checkRequiredFields(platform, entityType));
    
    // Check for data freshness
    checks.push(await this.checkDataFreshness(platform, entityType));
    
    // Check for anomalous values
    checks.push(await this.checkAnomalousValues(platform, entityType));

    // Log results
    await this.logQualityChecks(batchId, checks);

    return {
      batchId,
      totalChecks: checks.length,
      passedChecks: checks.filter(c => c.passed).length,
      failedChecks: checks.filter(c => !c.passed),
      overallStatus: checks.every(c => c.passed) ? 'PASSED' : 'FAILED'
    };
  }

  private async checkDuplicates(platform: string, entityType: string): Promise<QualityCheck> {
    const tableName = `${platform}_ads_${entityType}`;
    const primaryKey = this.getPrimaryKey(tableName);
    
    const { data } = await this.supabase
      .rpc('check_duplicates', { 
        table_name: tableName, 
        key_column: primaryKey 
      });

    return {
      checkType: 'duplicates',
      tableName,
      passed: data?.[0]?.duplicate_count === 0,
      result: data?.[0]?.duplicate_count || 0,
      message: `Found ${data?.[0]?.duplicate_count || 0} duplicate records`
    };
  }

  private async checkRequiredFields(platform: string, entityType: string): Promise<QualityCheck> {
    const tableName = `${platform}_ads_${entityType}`;
    const requiredFields = this.getRequiredFields(tableName);
    
    let nullCounts = 0;
    for (const field of requiredFields) {
      const { count } = await this.supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .is(field, null);
      
      nullCounts += count || 0;
    }

    return {
      checkType: 'required_fields',
      tableName,
      passed: nullCounts === 0,
      result: nullCounts,
      message: `Found ${nullCounts} null values in required fields`
    };
  }

  private async checkDataFreshness(platform: string, entityType: string): Promise<QualityCheck> {
    const { data } = await this.supabase
      .from('etl_sync_log')
      .select('end_time')
      .eq('platform', platform)
      .eq('entity_type', entityType)
      .eq('status', 'completed')
      .order('end_time', { ascending: false })
      .limit(1)
      .single();

    const hoursSinceLastSync = data?.end_time ? 
      (Date.now() - new Date(data.end_time).getTime()) / (1000 * 60 * 60) : 
      Infinity;

    return {
      checkType: 'data_freshness',
      tableName: `${platform}_ads_${entityType}`,
      passed: hoursSinceLastSync < 25, // Allow 1 hour buffer for daily syncs
      result: hoursSinceLastSync,
      message: `Data is ${hoursSinceLastSync.toFixed(1)} hours old`
    };
  }
}
```

## Benefits & Success Metrics

### Technical Benefits
1. **Decoupling**: Ads ETL separated from main application
2. **Scalability**: Cloud Run auto-scales based on load
3. **Reliability**: Automatic retries, error handling, state management
4. **Performance**: Async processing, batch operations, incremental loading
5. **Maintainability**: Centralized ETL logic, easier updates and debugging

### Business Benefits
1. **Complete Creative Data**: Ad-level creative assets with thumbnails/previews
2. **Real-time Insights**: Hourly data updates vs manual refresh
3. **Cost Optimization**: Detailed cost tracking and attribution analysis
4. **Creative Performance**: Visual creative performance tracking
5. **Cross-Platform Analysis**: Unified view of Google and Meta performance

### Success Metrics
- **Data Freshness**: < 2 hours lag for all entities
- **Processing Time**: < 15 minutes per incremental sync
- **Error Rate**: < 1% failed API calls
- **Data Accuracy**: 99.9% match with source platforms
- **System Uptime**: 99.5% ETL service availability
- **Cost Efficiency**: < $200/month for complete ETL operations

## Next Steps

1. **Repository Creation**: Set up `lengolf-ads-etl` repository
2. **Google Ads Implementation**: Start with ad creative extraction
3. **Meta Ads Enhancement**: Implement creative detail extraction
4. **Cloud Run Deployment**: Deploy and configure production environment
5. **Dashboard Integration**: Update existing dashboards to use new data
6. **Monitoring Setup**: Implement comprehensive monitoring and alerting

This comprehensive plan provides a complete roadmap for migrating the ads data extraction to a robust, scalable Cloud Run service while maintaining the existing marketing schema and enhancing creative data extraction capabilities.