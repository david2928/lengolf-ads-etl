# Meta Ads Integration Guide

This guide covers the complete setup and configuration for Meta Marketing API integration, including OAuth setup, API configuration, and data extraction capabilities for Facebook and Instagram advertising platforms.

## 🎯 Overview

The Meta Ads integration extracts comprehensive advertising data including:
- **Campaigns**: Objectives, budgets, targeting, optimization goals
- **Ad Sets**: Audience targeting, placements, bidding strategies
- **Ads**: Creative content, call-to-actions, tracking
- **Creatives**: Images, videos, text content, carousel data
- **Performance Insights**: Impressions, clicks, conversions, spend

## 🔑 Meta Marketing API Setup

### Prerequisites

1. **Meta Developer Account** with app creation permissions
2. **Facebook/Instagram Business Account** with advertising access
3. **Ad Account Access** with appropriate permissions
4. **App Review** (for production access to insights data)

### Step 1: Meta Developer App Setup

1. **Create Developer App**:
   ```bash
   # Navigate to Meta for Developers
   https://developers.facebook.com/
   
   # Create App > Business > Continue
   App Name: "Lengolf Ads ETL"
   Contact Email: your-email@example.com
   ```

2. **Add Marketing API Product**:
   ```bash
   # In App Dashboard
   # Add Product > Marketing API > Set Up
   # This enables advertising data access
   ```

3. **Configure Basic Settings**:
   ```bash
   # Go to Settings > Basic
   App Domains: your-domain.com
   Privacy Policy URL: https://your-domain.com/privacy
   Terms of Service URL: https://your-domain.com/terms
   ```

### Step 2: Authentication Setup

1. **Get App Credentials**:
   ```json
   {
     "app_id": "your-meta-app-id",
     "app_secret": "your-meta-app-secret",
     "redirect_uri": "http://localhost:8080/auth/meta/callback"
   }
   ```

2. **Generate Access Token**:
   ```bash
   # Use Graph API Explorer or manual OAuth flow
   # Required permissions:
   - ads_read
   - ads_management
   - business_management
   ```

3. **Find Ad Account ID**:
   ```bash
   # In Meta Ads Manager
   # Account Overview > Account ID
   # Format: act_XXXXXXXXX (use numbers only: XXXXXXXXX)
   ```

### Step 3: OAuth Flow Implementation

**Authorization URL**:
```typescript
const authUrl = `https://www.facebook.com/v22.0/dialog/oauth?` +
  `client_id=${APP_ID}&` +
  `redirect_uri=${REDIRECT_URI}&` +
  `scope=ads_read,ads_management,business_management&` +
  `response_type=code&` +
  `state=${generateState()}`;
```

**Token Exchange**:
```typescript
// Exchange authorization code for access token
const tokenResponse = await axios.post('https://graph.facebook.com/v22.0/oauth/access_token', {
  client_id: APP_ID,
  client_secret: APP_SECRET,
  redirect_uri: REDIRECT_URI,
  code: authorizationCode
});
```

## 🔧 Configuration

### Environment Variables

Add these to your GitHub repository secrets:

```bash
META_APP_ID=your-meta-app-id-here
META_APP_SECRET=your-meta-app-secret-here
META_AD_ACCOUNT_ID=your-ad-account-id-numbers-only
```

### API Version

The integration uses **Meta Marketing API v22.0**:
- Stable release with comprehensive features
- Supported until mid-2026
- Regular updates for new advertising features

## 📊 Data Extraction Capabilities

### 1. Campaign Data

**Extracted Fields**:
```typescript
interface MetaCampaign {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  objective?: string;
  buying_type?: string;
  bid_strategy?: string;
  daily_budget?: number;
  lifetime_budget?: number;
  budget_remaining?: number;
  spend_cap?: number;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
  can_use_spend_cap: boolean;
  created_at: string;
  updated_at: string;
}
```

**API Endpoint**: `/act_{ad_account_id}/campaigns`

**Example API Call**:
```bash
GET https://graph.facebook.com/v22.0/act_123456789/campaigns
?fields=id,name,status,objective,buying_type,daily_budget,lifetime_budget
&access_token=YOUR_ACCESS_TOKEN
```

### 2. Ad Set Data

**Extracted Fields**:
```typescript
interface MetaAdSet {
  ad_set_id: string;
  campaign_id: string;
  ad_set_name: string;
  ad_set_status: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  bid_amount?: number;
  daily_budget?: number;
  lifetime_budget?: number;
  budget_remaining?: number;
  start_time?: string;
  end_time?: string;
  targeting?: any;
  promoted_object?: any;
  attribution_spec?: any;
  created_at: string;
  updated_at: string;
}
```

**API Endpoint**: `/act_{ad_account_id}/adsets`

### 3. Ads Data

**Extracted Fields**:
```typescript
interface MetaAd {
  ad_id: string;
  ad_set_id: string;
  campaign_id: string;
  ad_name: string;
  ad_status: string;
  creative_id?: string;
  bid_amount?: number;
  source_ad_id?: string;
  created_time?: string;
  updated_time?: string;
  tracking_specs?: any;
  conversion_specs?: any;
  created_at: string;
  updated_at: string;
}
```

**API Endpoint**: `/act_{ad_account_id}/ads`

### 4. Performance Insights

**Campaign Performance**:
```typescript
interface MetaCampaignPerformance {
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number; // In THB satang
  conversions: number;
  conversion_value_cents: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  reach: number;
  frequency: number;
  unique_clicks: number;
  cost_per_unique_click_cents: number;
}
```

**Ad Set Performance**:
```typescript
interface MetaAdsetPerformance {
  adset_id: string;
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  conversion_value_cents: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  reach: number;
  frequency: number;
}
```

**Insights API Endpoint**: `/act_{ad_account_id}/insights`

**Critical Insights Configuration**:
```javascript
const insightsParams = {
  fields: [
    'campaign_id',    // REQUIRED: Entity linking
    'adset_id',       // REQUIRED: Entity linking  
    'ad_id',          // REQUIRED: Entity linking
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
  ].join(','),
  level: 'campaign', // or 'adset', 'ad'
  time_range: JSON.stringify({
    since: '2025-01-01',
    until: '2025-01-31'
  }),
  time_increment: 1, // CRITICAL: Daily breakdown data
  limit: 100
};
```

## 🔄 Sync Strategies

### Incremental Sync

**Strategy**: Time-based filtering with lookback
```typescript
// Get data modified in last 2 hours
const modifiedSince = new Date(Date.now() - 2 * 60 * 60 * 1000);
const params = {
  fields: 'id,name,status,updated_time',
  filtering: [
    {
      field: 'updated_time',
      operator: 'GREATER_THAN',
      value: modifiedSince.toISOString()
    }
  ]
};
```

**Benefits**:
- Fast execution (< 2 minutes typically)
- Minimal API calls
- Real-time change detection

### Full Sync

**Strategy**: Complete data refresh
```typescript
// Get all active entities
const params = {
  fields: 'id,name,status,created_time,updated_time',
  filtering: [
    {
      field: 'effective_status',
      operator: 'IN',
      value: ['ACTIVE', 'PAUSED']
    }
  ]
};
```

### Performance Insights Sync

**Key Requirements**:
```typescript
// CRITICAL: Must include entity IDs for proper linking
const insightsFields = [
  'campaign_id',    // Links to campaigns table
  'adset_id',       // Links to ad sets table
  'ad_id',          // Links to ads table
  // ... performance metrics
];

// CRITICAL: Use time_increment for daily breakdown
const timeParams = {
  time_increment: 1, // Daily data points
  time_range: JSON.stringify({
    since: startDate,
    until: endDate
  })
};
```

## 🚨 Common Issues & Solutions

### 1. Missing Entity IDs in Insights

**Problem**: Performance data lacks campaign_id/adset_id
```json
{
  "impressions": "1000",
  "clicks": "50",
  "spend": "100.00",
  // Missing: campaign_id, adset_id
}
```

**Solution**: Explicitly request entity ID fields
```javascript
const fields = [
  'campaign_id',  // Always include
  'adset_id',     // Always include
  'ad_id',        // Always include
  'impressions',
  'clicks',
  'spend'
].join(',');
```

### 2. Rate Limiting

**Error**: "Application request limit reached"
```json
{
  "error": {
    "code": 80004,
    "message": "Application request limit reached"
  }
}
```

**Solution**: Implement exponential backoff
```typescript
async function makeAPICall(url: string, params: any, retries = 3): Promise<any> {
  try {
    return await axios.get(url, { params });
  } catch (error) {
    if (error.response?.status === 429 && retries > 0) {
      const delay = Math.pow(2, 4 - retries) * 1000; // 2, 4, 8 seconds
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeAPICall(url, params, retries - 1);
    }
    throw error;
  }
}
```

### 3. Token Expiration

**Error**: "Error validating access token"
```json
{
  "error": {
    "code": 190,
    "message": "Error validating access token"
  }
}
```

**Solution**: Automatic token refresh
```typescript
// Check token validity before API calls
async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await axios.get('https://graph.facebook.com/me', {
      params: { access_token: token }
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
```

### 4. Currency Handling

**Issue**: Meta API returns spend in account currency (THB for your account)
```typescript
// Correct: Treat as THB satang (100 satang = 1 THB)
const spendTHB = responseData.spend; // Already in THB
const spendSatang = Math.round(parseFloat(responseData.spend) * 100);

// Store in database as satang for consistency
await db.insert('meta_ads_campaign_performance', {
  spend_cents: spendSatang  // Actually THB satang
});
```

## 📈 Performance Optimization

### Batch API Calls

```typescript
// Use Facebook's batch API for multiple requests
const batch = [
  {
    method: 'GET',
    relative_url: 'act_123456789/campaigns?fields=id,name,status'
  },
  {
    method: 'GET', 
    relative_url: 'act_123456789/adsets?fields=id,name,status'
  }
];

const batchResponse = await axios.post('https://graph.facebook.com/v22.0/', {
  batch: JSON.stringify(batch),
  access_token: accessToken
});
```

### Pagination Optimization

```typescript
// Efficiently handle large datasets
async function getAllCampaigns(): Promise<Campaign[]> {
  const campaigns: Campaign[] = [];
  let nextUrl: string | undefined = '/act_123456789/campaigns';
  
  while (nextUrl) {
    const response = await metaApi.get(nextUrl, {
      params: { fields: 'id,name,status', limit: 100 }
    });
    
    campaigns.push(...response.data.data);
    nextUrl = response.data.paging?.next;
    
    // Rate limiting pause
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return campaigns;
}
```

### Field Selection

```typescript
// Efficient: Request only needed fields
const fields = 'id,name,status,daily_budget,lifetime_budget';

// Inefficient: Default returns all fields (slower)
// const fields = undefined; // Don't do this
```

## 🔍 Debugging & Monitoring

### Enable Debug Mode

```typescript
// Add debug logging for API calls
const axiosInstance = axios.create({
  baseURL: 'https://graph.facebook.com/v22.0'
});

axiosInstance.interceptors.request.use(request => {
  console.log('Meta API Request:', {
    url: request.url,
    params: request.params,
    timestamp: new Date().toISOString()
  });
  return request;
});

axiosInstance.interceptors.response.use(
  response => {
    console.log('Meta API Response:', {
      status: response.status,
      dataLength: response.data?.data?.length || 0,
      hasMorePages: !!response.data?.paging?.next
    });
    return response;
  },
  error => {
    console.error('Meta API Error:', {
      status: error.response?.status,
      code: error.response?.data?.error?.code,
      message: error.response?.data?.error?.message
    });
    return Promise.reject(error);
  }
);
```

### API Usage Monitoring

```typescript
// Track API usage patterns
interface MetaAPIMetrics {
  requestsPerHour: number;
  rateLimitHits: number;
  avgResponseTime: number;
  errorRate: number;
  dataFreshness: string;
}

// Monitor in application
const metrics = {
  totalRequests: 0,
  rateLimitErrors: 0,
  responseTimes: [],
  lastSyncTime: new Date()
};
```

## 🔒 Security Best Practices

### Token Security

```bash
# Do:
✅ Use long-lived access tokens (60 days)
✅ Store tokens securely in environment variables
✅ Implement automatic token refresh
✅ Monitor token expiration dates

# Don't:
❌ Store tokens in code or logs
❌ Share tokens between applications
❌ Use short-lived tokens for automation
❌ Ignore token validation errors
```

### Data Privacy

```bash
# Do:
✅ Request minimum required permissions
✅ Comply with Meta's data usage policies
✅ Implement data retention policies
✅ Audit data access regularly

# Don't:
❌ Store unnecessary personal data
❌ Share data with unauthorized parties
❌ Ignore privacy policy requirements
❌ Cache sensitive user information
```

---

*For advanced Meta Marketing API features and troubleshooting, consult the [official Meta Marketing API documentation](https://developers.facebook.com/docs/marketing-api) and [error codes reference](https://developers.facebook.com/docs/marketing-api/error-reference).*