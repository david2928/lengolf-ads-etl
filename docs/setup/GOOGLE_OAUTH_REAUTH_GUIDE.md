# 🔐 Google Ads OAuth Re-authentication Guide

## Overview

This guide provides step-by-step instructions for manually re-authenticating the Google Ads API when the refresh token has expired. This is required when you see `invalid_grant` errors in the ETL system.

## 🚨 When You Need This Guide

- Google Ads sync jobs are failing with `invalid_grant` errors
- Token health monitoring shows Google token status as "expired"
- GitHub Actions workflows are failing for Google Ads syncs
- It's been more than 7 days since the last successful Google token refresh

## 📋 Prerequisites

- Access to the Google account that manages the Google Ads account
- Admin access to the Supabase database
- The ETL service environment variables (CLIENT_ID, CLIENT_SECRET)

## 🔧 Step 1: Generate OAuth Authorization URL

### Current Configuration
Based on your environment settings:
- **Client ID**: `YOUR-CLIENT-ID.apps.googleusercontent.com`
- **Redirect URI**: `http://localhost:8080/oauth/google/callback`
- **Scope**: `https://www.googleapis.com/auth/adwords`

### Authorization URL
Copy and paste this URL into your browser:

```
https://accounts.google.com/oauth2/v2/auth?client_id=YOUR-CLIENT-ID.apps.googleusercontent.com&response_type=code&scope=https://www.googleapis.com/auth/adwords&redirect_uri=http://localhost:8080/oauth/google/callback&access_type=offline&approval_prompt=force
```

## 🌐 Step 2: Complete Browser Authorization

1. **Open the authorization URL** in your web browser
2. **Sign in** with the Google account that has access to your Google Ads account
3. **Review permissions** - You'll see a screen asking to grant access to Google Ads
4. **Click "Allow"** or "Grant Access"
5. **Copy the authorization code** from the callback URL

### What to Look For
After clicking "Allow", you'll be redirected to a URL that looks like:
```
http://localhost:8080/oauth/google/callback?code=4/0AeanS0...very_long_code...&scope=https://www.googleapis.com/auth/adwords
```

**Copy the entire code** between `code=` and `&scope` (or end of URL if no scope parameter).

## 🔄 Step 3: Exchange Authorization Code for Tokens

### Option A: Using the Automated Script

1. **Run the token exchange script**:
   ```bash
   node manual-google-reauth.js YOUR_AUTHORIZATION_CODE_HERE
   ```

2. **The script will output**:
   - ✅ Success message
   - 📋 Token details (access token, refresh token, expiration)
   - 📝 SQL command to update the database

### Option B: Manual cURL Command

If you prefer manual control, use this cURL command:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR-CLIENT-ID.apps.googleusercontent.com" \
  -d "client_secret=YOUR-CLIENT-SECRET" \
  -d "code=YOUR_AUTHORIZATION_CODE_HERE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:8080/oauth/google/callback"
```

## 💾 Step 4: Update Database with New Tokens

### SQL Command Template
Run this SQL command in your Supabase SQL Editor (replace the token values):

```sql
UPDATE marketing.platform_tokens SET
  access_token = 'ya29.a0AeDClZ...NEW_ACCESS_TOKEN_HERE',
  refresh_token = '1//0...NEW_REFRESH_TOKEN_HERE',
  expires_at = '2025-08-21T10:30:00.000Z',  -- Current time + 1 hour
  updated_at = NOW(),
  token_status = 'valid',
  refresh_error = NULL,
  last_refresh_attempt = NOW()
WHERE platform = 'google';
```

### Verify Database Update
Check that the update was successful:

```sql
SELECT platform, 
       expires_at, 
       updated_at, 
       token_status,
       refresh_error
FROM marketing.platform_tokens 
WHERE platform = 'google';
```

## ✅ Step 5: Verify Token is Working

### Test the Token Health API
```bash
curl -H "Authorization: Bearer 4801d13665fef62d2094f2d80f9940d1a5dd528377b4da439afbcb9d572fbbe7" \
  http://localhost:8080/api/token-health/summary
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "overall_status": "healthy",
    "platforms": [
      {
        "platform": "google",
        "status": "healthy",
        "days_until_expiry": 0.04
      }
    ]
  }
}
```

### Test Google Ads Sync
```bash
curl -H "Authorization: Bearer 4801d13665fef62d2094f2d80f9940d1a5dd528377b4da439afbcb9d572fbbe7" \
  -H "Content-Type: application/json" \
  -d '{"platform": "google", "mode": "incremental", "entities": ["performance"]}' \
  http://localhost:8080/api/sync
```

**Expected Response:**
```json
{
  "success": true,
  "status": "completed",
  "message": "Sync completed for google - performance",
  "summary": {
    "totalRecordsProcessed": 123,
    "totalRecordsInserted": 50,
    "totalRecordsUpdated": 73
  }
}
```

## 🔧 Troubleshooting

### Common Issues

#### 1. "invalid_client" Error
- **Cause**: Wrong CLIENT_ID or CLIENT_SECRET
- **Solution**: Verify the credentials in your `.env` file match Google Cloud Console

#### 2. "redirect_uri_mismatch" Error
- **Cause**: The redirect URI doesn't match what's configured in Google Cloud Console
- **Solution**: Update Google Cloud Console OAuth settings or use the exact URI: `http://localhost:8080/oauth/google/callback`

#### 3. "access_denied" Error
- **Cause**: User declined permissions or doesn't have access to Google Ads account
- **Solution**: Ensure you're using the correct Google account with Google Ads access

#### 4. Authorization Code Already Used
- **Cause**: Trying to use the same authorization code twice
- **Solution**: Generate a new authorization code by repeating Step 1-2

### Verification Commands

#### Check Current Token Status
```bash
# Quick health check
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:8080/api/token-health/status

# Detailed report
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:8080/api/token-health/report
```

#### Check Database Token Info
```sql
SELECT platform, 
       expires_at,
       EXTRACT(EPOCH FROM (expires_at - NOW()))/3600 as hours_until_expiry,
       token_status,
       refresh_error,
       last_refresh_attempt
FROM marketing.platform_tokens 
WHERE platform = 'google';
```

## 🔄 Future Automation

### Service Account Migration (Recommended)
For permanent automation without manual intervention:

1. **Create a Google Service Account** in Google Cloud Console
2. **Generate service account key** (JSON file)
3. **Update the codebase** to use service account authentication instead of OAuth
4. **Benefits**: No token expiration issues, no manual intervention required

### Enhanced Monitoring
The new token monitoring system will:
- ✅ Detect token expiration 2 hours before it happens
- ✅ Automatically refresh tokens when possible
- ✅ Send critical alerts when manual intervention is needed
- ✅ Provide detailed health reports and recommendations

## 📞 Support

If you encounter issues:

1. **Check the application logs** for detailed error messages
2. **Verify token health** using `/api/token-health/report`
3. **Check database** to ensure tokens were updated correctly
4. **Test with simple API calls** before running full syncs

## 🔒 Security Notes

- **Never commit** access tokens or refresh tokens to version control
- **Rotate tokens regularly** or migrate to service account authentication
- **Monitor token health** using the automated monitoring system
- **Use environment variables** for all sensitive configuration

## 📝 Quick Reference

### Key URLs
- **Authorization**: `https://accounts.google.com/oauth2/v2/auth?client_id=...`
- **Token Exchange**: `https://oauth2.googleapis.com/token`
- **Health Check**: `http://localhost:8080/api/token-health/summary`

### Key Files
- **Environment Config**: `.env`
- **Token Exchange Script**: `manual-google-reauth.js`
- **Database Table**: `marketing.platform_tokens`

### Key Commands
```bash
# Generate tokens
node manual-google-reauth.js YOUR_AUTH_CODE

# Check health
curl -H "Authorization: Bearer API_KEY" http://localhost:8080/api/token-health/summary

# Test sync
curl -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" \
  -d '{"platform": "google", "mode": "incremental", "entities": ["performance"]}' \
  http://localhost:8080/api/sync
```