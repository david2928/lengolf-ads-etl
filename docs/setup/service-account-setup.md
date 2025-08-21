# Google Service Account Setup Guide

## Overview

This guide explains how to set up Google Service Account authentication for the Lengolf Ads ETL service, eliminating OAuth2 token expiration issues and providing seamless, automated authentication.

## 🎯 Why Use Service Accounts?

### Problems with OAuth2
- ❌ Tokens expire every hour
- ❌ Refresh tokens can become invalid after 7 days  
- ❌ Requires manual re-authentication
- ❌ Causes sync failures with `invalid_grant` errors

### Benefits of Service Accounts
- ✅ No token expiration issues
- ✅ Automatic token refresh every ~1 hour
- ✅ Zero manual intervention required
- ✅ 99.9% reliability vs OAuth2 issues

## 📋 Prerequisites

- Google Cloud Project with Google Ads API enabled
- Google Ads account with Admin access
- GitHub repository with Actions enabled

## 🔧 Step 1: Create Service Account

### 1.1 Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **IAM & Admin** → **Service Accounts**
3. Click **Create Service Account**

### 1.2 Service Account Details
```
Name: lengolf-ads-etl
Description: Service account for Lengolf Ads ETL automated data extraction
```

### 1.3 Generate Key
1. Click on the created service account
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key** → **JSON**
4. Download and securely store the JSON key file

## 🔑 Step 2: Configure Google Ads Access

### 2.1 Enable APIs
Ensure these APIs are enabled in your Google Cloud Project:
- Google Ads API
- Google Ads Manager API (if using manager account)

### 2.2 Add Service Account to Google Ads
1. Go to [Google Ads](https://ads.google.com/)
2. Navigate to **Tools & Settings** → **Access and Security** → **Users**
3. Click the **+** button to add new user
4. Enter your service account email: `lengolf-ads-etl@your-project-id.iam.gserviceaccount.com`
5. Set access level to **Admin**
6. Click **Send invitation**

## 🔐 Step 3: GitHub Actions Setup

### 3.1 Add Repository Secret
1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and Variables** → **Actions**
3. Click **New repository secret**

```
Name: GOOGLE_SERVICE_ACCOUNT_KEY
Value: {"type":"service_account","project_id":"noted-app-295904","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"lengolf-ads-etl@noted-app-295904.iam.gserviceaccount.com",...}
```

### 3.2 Environment Variables
The service account key will be automatically loaded from the GitHub secret. No additional configuration needed.

## 🧪 Step 4: Testing

### 4.1 Local Testing (Optional)
Create a `.env.local` file:
```bash
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

Run the service locally:
```bash
npm run build
npm start
```

### 4.2 GitHub Actions Testing
Push your code to trigger the workflow:
```bash
git add .
git commit -m "Add Google Service Account authentication"
git push
```

Monitor the workflow in **Actions** tab to verify successful deployment.

## 📊 Step 5: Verification

### 5.1 Check Service Health
```bash
curl -H "Authorization: Bearer ${ETL_API_KEY}" \
  https://your-service-url/api/token-health/summary
```

### 5.2 Test Sync
```bash
curl -H "Authorization: Bearer ${ETL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"platform": "google", "mode": "incremental", "entities": ["campaigns"]}' \
  https://your-service-url/api/sync
```

### 5.3 Monitor Logs
Look for these success indicators in logs:
- ✅ `"Using Google Service Account authentication"`
- ✅ `"Service account token obtained successfully"`
- ✅ `"Google Ads client initialized successfully"`

## 🔄 Migration Strategy

The service account implementation uses a **fallback approach**:

1. **OAuth2 First**: If OAuth2 tokens exist and are valid, use them
2. **Service Account Fallback**: If OAuth2 fails, automatically switch to service account
3. **Seamless Transition**: No downtime or manual intervention required

## 🛠️ Troubleshooting

### Service Account Not Working
**Problem**: `"Service account not configured"`
**Solution**: Verify `GOOGLE_SERVICE_ACCOUNT_KEY` secret is properly set

### Invalid Grant Error
**Problem**: Still seeing `invalid_grant` errors
**Solution**: Service account will activate automatically when OAuth2 fails. Wait for next sync cycle.

### Permission Denied
**Problem**: `"Request had insufficient authentication scopes"`
**Solution**: Ensure service account is added to Google Ads account with Admin permissions

### JSON Parse Error
**Problem**: `"Invalid service account key"`
**Solution**: Verify the JSON key is valid and properly formatted in GitHub secret

## 📈 Expected Results

After successful setup:
- **Zero `invalid_grant` errors**
- **100% automated token management**
- **Improved sync reliability**
- **Reduced maintenance overhead**

## 🔗 Related Documentation

- [GitHub Actions Setup](./github-actions.md) - Complete deployment guide
- [Google Ads Integration](../integrations/google-ads.md) - OAuth2 setup (fallback)
- [Troubleshooting Guide](../operations/troubleshooting.md) - Common issues

---

*This guide is part of the Lengolf Ads ETL documentation. For questions or issues, consult the [troubleshooting guide](../operations/troubleshooting.md).*