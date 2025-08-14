# Google Ads Integration Guide

This guide covers the complete setup and configuration for Google Ads API integration, including OAuth setup, API configuration, and data extraction capabilities.

## 🎯 Overview

The Google Ads integration extracts comprehensive advertising data including:
- **Campaigns**: Settings, budgets, targeting
- **Ad Groups**: Bidding strategies, targeting refinements  
- **Ads**: Creative content, headlines, descriptions
- **Keywords**: Search terms, match types, bids
- **Performance**: Impressions, clicks, conversions, costs

## 🔑 Google Ads API Setup

### Prerequisites

1. **Google Cloud Project** with Google Ads API enabled
2. **Google Ads Manager Account** (MCC) or individual account access
3. **OAuth 2.0 Credentials** configured for your application
4. **Developer Token** approved by Google

### Step 1: Google Cloud Console Setup

1. **Create or Select Project**:
   ```bash
   # Navigate to Google Cloud Console
   https://console.cloud.google.com/
   
   # Create new project or select existing
   Project Name: "Lengolf Ads ETL"
   ```

2. **Enable Google Ads API**:
   ```bash
   # Go to APIs & Services > Library
   # Search for "Google Ads API"
   # Click "Enable"
   ```

3. **Configure OAuth Consent Screen**:
   ```bash
   # Go to APIs & Services > OAuth consent screen
   User Type: External (for production)
   App Name: "Lengolf Ads ETL"
   User Support Email: your-email@example.com
   Scopes: Add https://www.googleapis.com/auth/adwords
   ```

### Step 2: OAuth 2.0 Credentials

1. **Create Credentials**:
   ```bash
   # Go to APIs & Services > Credentials
   # Click "Create Credentials" > "OAuth 2.0 Client ID"
   Application Type: Web application
   Name: "Lengolf ETL Client"
   Authorized Redirect URIs: http://localhost:8080/auth/google/callback
   ```

2. **Download Credentials**:
   ```json
   {
     "client_id": "your-client-id.apps.googleusercontent.com",
     "client_secret": "your-client-secret",
     "redirect_uri": "http://localhost:8080/auth/google/callback"
   }
   ```

### Step 3: Google Ads Account Setup

1. **Get Developer Token**:
   ```bash
   # Log into Google Ads account
   # Go to Tools & Settings > Setup > API Center
   # Apply for developer token
   # Note: May require approval process
   ```

2. **Find Customer ID**:
   ```bash
   # In Google Ads account, look for Customer ID
   # Format: XXX-XXX-XXXX (use without dashes: XXXXXXXXXX)
   # This identifies which ads account to access
   ```

## 🔧 Configuration

### Environment Variables

Add these to your GitHub repository secrets:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_CUSTOMER_ID=your-customer-id-without-dashes
GOOGLE_DEVELOPER_TOKEN=your-developer-token-here
```

### OAuth Token Generation

The ETL service includes automated OAuth token management, but initial setup requires manual token generation:

```typescript
// Initial token generation (one-time setup)
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}&` +
  `redirect_uri=${REDIRECT_URI}&` +
  `scope=https://www.googleapis.com/auth/adwords&` +
  `response_type=code&` +
  `access_type=offline&` +
  `prompt=consent`;

// Visit this URL, authorize, and capture the authorization code
// Exchange code for tokens using OAuth flow
```

## 📊 Data Extraction Capabilities

### 1. Campaign Data

**Extracted Fields**:
```typescript
interface GoogleAdsCampaign {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  campaign_type: string;
  advertising_channel_type: string;
  advertising_channel_sub_type?: string;
  target_cpa_micros?: number;
  target_roas?: number;
  maximize_conversions?: boolean;
  start_date?: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
}
```

**GAQL Query Example**:
```sql
SELECT 
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.start_date,
  campaign.end_date
FROM campaign 
WHERE campaign.status IN ('ENABLED', 'PAUSED')
```

### 2. Ad Group Data

**Extracted Fields**:
```typescript
interface GoogleAdsAdGroup {
  ad_group_id: string;
  campaign_id: string;
  ad_group_name: string;
  ad_group_status: string;
  ad_group_type: string;
  cpc_bid_micros?: number;
  cpm_bid_micros?: number;
  target_cpa_micros?: number;
  created_at: string;
  updated_at: string;
}
```

### 3. Ads Data

**Extracted Fields**:
```typescript
interface GoogleAd {
  ad_id: string;
  ad_group_id: string;
  campaign_id: string;
  ad_name?: string;
  ad_status: string;
  ad_type: string;
  headlines?: string[];
  descriptions?: string[];
  final_url?: string;
  display_url?: string;
  created_at: string;
  updated_at: string;
}
```

### 4. Keywords Data

**Extracted Fields**:
```typescript
interface GoogleAdsKeyword {
  keyword_id: string;
  ad_group_id: string;
  campaign_id: string;
  keyword_text: string;
  match_type: string;
  keyword_status: string;
  cpc_bid_micros?: number;
  first_page_cpc_micros?: number;
  quality_score?: number;
  created_at: string;
  updated_at: string;
}
```

### 5. Performance Data

**Campaign Performance**:
```typescript
interface GoogleAdsCampaignPerformance {
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  ctr: number;
  avg_cpc_micros: number;
  avg_cpm_micros: number;
}
```

**Keyword Performance**:
```typescript
interface GoogleAdsKeywordPerformance {
  keyword_id: string;
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  quality_score?: number;
  first_page_cpc_micros?: number;
  top_of_page_cpc_micros?: number;
}
```

## 🔄 Sync Strategies

### Incremental Sync

**Strategy**: Modified-since timestamps
```typescript
// Query campaigns modified in last 2 hours
const modifiedSince = new Date(Date.now() - 2 * 60 * 60 * 1000);
const query = `
  SELECT campaign.id, campaign.name, campaign.status
  FROM campaign 
  WHERE segments.date DURING LAST_7_DAYS
  AND campaign.status IN ('ENABLED', 'PAUSED')
`;
```

**Benefits**:
- Fast execution (typically < 30 seconds)
- Minimal API quota usage
- Captures recent changes efficiently

### Full Sync

**Strategy**: Complete data refresh
```typescript
// Query all active campaigns
const query = `
  SELECT campaign.id, campaign.name, campaign.status
  FROM campaign 
  WHERE campaign.status IN ('ENABLED', 'PAUSED')
`;
```

**Benefits**:
- Ensures data completeness
- Captures historical changes
- Resolves any sync gaps

### Performance Sync

**Strategy**: Date-range based extraction
```typescript
// Query performance for specific date range
const query = `
  SELECT 
    campaign.id,
    segments.date,
    metrics.impressions,
    metrics.clicks,
    metrics.cost_micros
  FROM campaign 
  WHERE segments.date BETWEEN '2025-01-01' AND '2025-01-31'
`;
```

## 🚨 Common Issues & Solutions

### 1. Authentication Errors

**Error**: "OAuth2 credentials are not valid"
```bash
# Solution:
1. Verify CLIENT_ID and CLIENT_SECRET are correct
2. Check redirect URI matches OAuth configuration
3. Ensure scope includes https://www.googleapis.com/auth/adwords
4. Regenerate refresh token if expired
```

**Error**: "Developer token not approved"
```bash
# Solution:
1. Apply for developer token approval in Google Ads
2. Wait for approval (can take several days)
3. Use test account in development mode if needed
```

### 2. API Quota Issues

**Error**: "Quota exceeded"
```bash
# Solution:
1. Implement exponential backoff retry logic
2. Reduce query frequency
3. Use date ranges to limit data volume
4. Monitor quota usage in Google Cloud Console
```

### 3. Customer ID Issues

**Error**: "Customer not found"
```bash
# Solution:
1. Verify customer ID format (no dashes)
2. Ensure account has proper permissions
3. Check if using Manager Account (MCC) vs individual account
4. Verify login-customer-id header if needed
```

## 📈 Performance Optimization

### Query Optimization

```sql
-- Efficient: Specific field selection
SELECT campaign.id, campaign.name, campaign.status
FROM campaign 
WHERE campaign.status = 'ENABLED'

-- Inefficient: Select all fields
SELECT *
FROM campaign
```

### Batch Processing

```typescript
// Process campaigns in batches
const batchSize = 100;
for (let i = 0; i < campaigns.length; i += batchSize) {
  const batch = campaigns.slice(i, i + batchSize);
  await processCampaignBatch(batch);
}
```

### Rate Limiting

```typescript
// Respect API rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function makeAPICall() {
  try {
    return await googleAdsClient.search(query);
  } catch (error) {
    if (error.code === 'RATE_LIMIT_EXCEEDED') {
      await delay(60000); // Wait 1 minute
      return makeAPICall(); // Retry
    }
    throw error;
  }
}
```

## 🔍 Monitoring & Debugging

### Enable Debug Logging

```typescript
// In development
process.env.LOG_LEVEL = 'debug';

// Logs will include:
// - API request/response details
// - Token refresh operations  
// - Query execution times
// - Error stack traces
```

### API Quota Monitoring

```bash
# Check quota usage in Google Cloud Console
# Navigate to: APIs & Services > Quotas
# Monitor: Google Ads API quota usage
# Set up alerts for quota thresholds
```

### Performance Metrics

```typescript
// Track key metrics
interface GoogleAdsMetrics {
  queriesPerSecond: number;
  avgResponseTime: number;
  quotaUsage: number;
  errorRate: number;
  tokenRefreshRate: number;
}
```

## 🔒 Security Best Practices

### Token Security

```bash
# Do:
✅ Store tokens in secure environment variables
✅ Use refresh tokens for long-term access
✅ Implement token rotation
✅ Monitor token usage

# Don't:
❌ Store tokens in code or configuration files
❌ Log tokens in application logs
❌ Share tokens between applications
❌ Use tokens without proper rotation
```

### API Security

```bash
# Do:
✅ Use HTTPS for all API communications
✅ Validate all API responses
✅ Implement request signing if available
✅ Monitor for suspicious API usage

# Don't:
❌ Expose developer tokens
❌ Make API calls from client-side code
❌ Skip error handling for API calls
❌ Ignore rate limiting
```

---

*For troubleshooting specific Google Ads API issues, consult the [official Google Ads API documentation](https://developers.google.com/google-ads/api/docs) and [error codes reference](https://developers.google.com/google-ads/api/docs/troubleshooting).*