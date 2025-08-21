# 🔧 Google Service Account Migration Guide

## Overview

This guide explains how to migrate from OAuth2 user authentication to Google Service Account authentication, which eliminates the token refresh issues permanently.

## 🚨 Why Service Account is Better

| OAuth2 (Current) | Service Account (Recommended) |
|-------------------|-------------------------------|
| ❌ Tokens expire every hour | ✅ Tokens auto-refresh seamlessly |
| ❌ Requires user consent | ✅ No user interaction needed |
| ❌ Refresh tokens can expire | ✅ Never expires (as long as key is valid) |
| ❌ Manual intervention needed | ✅ Fully automated |
| ❌ Complex error handling | ✅ Simple and reliable |

## 📋 Prerequisites

- Google Cloud Console access
- Google Ads account with API access
- Admin access to link service account

## 🔧 Step 1: Create Service Account

### 1.1 In Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **IAM & Admin > Service Accounts**
3. Click **"Create Service Account"**
4. Fill in details:
   - **Name**: `lengolf-ads-etl`
   - **Description**: `Service account for Lengolf Ads ETL automation`
5. Click **"Create and Continue"**
6. Skip roles for now, click **"Done"**

### 1.2 Generate Service Account Key

1. Click on your new service account
2. Go to **Keys** tab
3. Click **"Add Key" > "Create new key"**
4. Choose **JSON** format
5. Download the key file (keep it secure!)

## 🔗 Step 2: Link Service Account to Google Ads

### 2.1 Get Service Account Email

From the downloaded JSON file, find the `client_email` field:
```json
{
  "client_email": "lengolf-ads-etl@your-project.iam.gserviceaccount.com"
}
```

### 2.2 Add to Google Ads Account

1. Log in to [Google Ads](https://ads.google.com/)
2. Go to **Tools & Settings > Setup > Account Access**
3. Click **"+"** to add new user
4. Enter the service account email
5. Set access level to **"Admin"** (or appropriate level)
6. Send invitation

## 💻 Step 3: Update Code Implementation

### 3.1 Install Required Packages

```bash
npm install google-auth-library googleapis
```

### 3.2 Create Service Account Auth Handler

Create `src/auth/google-service-account.ts`:

```typescript
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
    
    this.jwtClient = new JWT({
      email: serviceAccountKey.client_email,
      key: serviceAccountKey.private_key,
      scopes: ['https://www.googleapis.com/auth/adwords'],
      subject: undefined // Can be used for domain-wide delegation if needed
    });

    this.googleAdsClient = new GoogleAdsApi({
      client_id: serviceAccountKey.client_id,
      client_secret: serviceAccountKey.client_secret,
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
}

export default GoogleServiceAccountAuth;
```

### 3.3 Update Environment Variables

Add to your `.env` file:

```bash
# Google Service Account (replace OAuth2 eventually)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-project"...}
# OR store as file path
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/path/to/service-account-key.json
```

### 3.4 Update Google Ads Client

Modify `src/extractors/google/client.ts` to support both methods:

```typescript
// Add this method to GoogleAdsClient class
async initializeWithServiceAccount(): Promise<void> {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    logger.info('Using Google Service Account authentication');
    this.serviceAccount = new GoogleServiceAccountAuth();
    
    // Test connection
    const isConnected = await this.serviceAccount.testConnection();
    if (!isConnected) {
      throw new Error('Service account authentication failed');
    }
  } else {
    logger.info('Using OAuth2 authentication (fallback)');
    // Keep existing OAuth2 logic
  }
}
```

## 🔄 Step 4: Gradual Migration Strategy

### Phase 1: Parallel Implementation
- Keep OAuth2 as fallback
- Add service account as primary method
- Test both in parallel

### Phase 2: Switch Primary Method
```typescript
// In TokenManager, add service account priority:
async getValidGoogleToken(): Promise<string> {
  // Try service account first
  if (this.hasServiceAccount()) {
    return await this.getServiceAccountToken();
  }
  
  // Fallback to OAuth2
  return await this.getOAuth2Token();
}
```

### Phase 3: Remove OAuth2
- After confirming service account works
- Remove OAuth2 code and database tokens
- Simplify authentication logic

## 🧪 Step 5: Testing

### 5.1 Test Service Account Locally

```bash
# Set environment variable
export GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'

# Test connection
npm run test-service-account

# Test sync
curl -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"platform": "google", "mode": "incremental", "entities": ["performance"]}' \
  http://localhost:8080/api/sync
```

### 5.2 Test in GitHub Actions

Add service account key to GitHub Secrets:
- **Secret name**: `GOOGLE_SERVICE_ACCOUNT_KEY`  
- **Value**: The entire JSON content from downloaded key file

## 🔒 Security Best Practices

### 1. Key Storage
- ✅ Store in GitHub Secrets (encrypted)
- ✅ Use environment variables in production
- ❌ Never commit keys to version control
- ❌ Never log key contents

### 2. Key Rotation
- Set up calendar reminder to rotate keys annually
- Test new keys before removing old ones
- Update all environments simultaneously

### 3. Permissions
- Use minimum required permissions in Google Ads
- Regular audit of service account access
- Monitor service account usage logs

## 📊 Expected Benefits

After migration:

### Reliability
- ✅ **99.9% uptime** (no more token expiration issues)
- ✅ **Zero manual intervention** required
- ✅ **Consistent performance** across all sync runs

### Operational
- ✅ **Simplified monitoring** (no token health checks needed)
- ✅ **Reduced maintenance** overhead
- ✅ **Better error handling** (fewer edge cases)

### Cost Efficiency  
- ✅ **No failed syncs** due to token issues
- ✅ **Reduced GitHub Actions** usage (no token refresh workflows)
- ✅ **Lower operational overhead**

## 🚀 Migration Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| **Week 1** | Setup | Create service account, test locally |
| **Week 2** | Integration | Implement parallel authentication |
| **Week 3** | Testing | Full testing in staging/production |
| **Week 4** | Cutover | Switch to service account primary |

## 📞 Support & Troubleshooting

### Common Issues

1. **"Service account not found"**
   - Check JSON key format
   - Verify service account exists in Google Cloud Console

2. **"Insufficient permissions"**
   - Ensure service account is added to Google Ads account
   - Check permission levels (Admin recommended)

3. **"Invalid scope"**
   - Verify scopes in JWT client: `['https://www.googleapis.com/auth/adwords']`

### Verification Commands

```bash
# Test service account auth
node -e "
const { GoogleServiceAccountAuth } = require('./dist/auth/google-service-account');
const auth = new GoogleServiceAccountAuth();
auth.testConnection().then(result => console.log('Connection:', result));
"

# Check token expiration (service accounts auto-refresh)
curl -H "Authorization: Bearer API_KEY" \
  http://localhost:8080/api/token-health/report
```

This migration will permanently solve the Google token refresh issues and provide a more reliable, automated solution.