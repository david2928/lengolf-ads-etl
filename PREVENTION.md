# ETL Service Prevention & Monitoring Guide

## 🚨 What Went Wrong (January 2026 Incident)

### Timeline of Events:
1. **December 2025**: Repository had no commits for 60 days
2. **January 4, 2026**: GitHub auto-disabled all scheduled workflows due to inactivity
3. **January 4, 2026 13:44 UTC**: Last successful token refresh before disable
4. **January 4, 2026 13:41 UTC**: Meta access token expired
5. **January 5-7, 2026**: All Meta syncs failed with "Meta refresh token not found"
6. **January 7, 2026**: Issue discovered and resolved

### Root Causes:
- ❌ GitHub's 60-day inactivity auto-disable feature triggered
- ❌ No keep-alive mechanism to maintain workflow activity
- ❌ No monitoring to detect disabled workflows
- ❌ Meta token refresh threshold too close to expiration (7 days)
- ❌ No alerts when token refresh stopped running

---

## ✅ Prevention Mechanisms Implemented

### 1. **Workflow Keep-Alive** (`.github/workflows/keep-alive.yml`)
**Purpose**: Prevent GitHub from auto-disabling workflows

**How it works**:
- Runs every Monday at 00:00 UTC
- Executes simple health check commands
- GitHub considers this as "repository activity"
- Prevents 60-day inactivity timeout

**Manual trigger**:
```bash
gh workflow run keep-alive.yml
```

---

### 2. **Workflow Health Monitor** (`.github/workflows/workflow-health-check.yml`)
**Purpose**: Detect and alert when critical workflows are disabled

**How it works**:
- Runs daily at 08:00 UTC
- Checks status of all critical workflows:
  - Token Health & Refresh
  - ETL Incremental Data Sync
  - ETL Daily Full Sync
- Verifies recent token refresh activity
- Fails if any workflow is disabled or not running

**What it checks**:
- ✅ Workflow state (active vs. disabled)
- ✅ Recent execution (within 24 hours for token refresh)
- ✅ Last run timestamps

**Manual check**:
```bash
# Check all workflows
gh workflow list --all

# Check recent runs
gh run list --workflow="token-refresh.yml" --limit 5
```

---

### 3. **Enhanced Meta Token Refresh Logic**

**Changes made to `src/auth/token-manager.ts`**:

#### A. **Earlier Refresh Threshold**
```typescript
// OLD: Refresh if < 7 days until expiry
if (daysUntilExpiry < 7) { ... }

// NEW: Refresh if < 14 days until expiry (2x safety margin)
if (daysUntilExpiry < 14) { ... }
```

**Why**: Provides more time to detect and fix refresh failures before token expires

#### B. **Expired Token Detection**
```typescript
// Check if token is already expired
if (daysUntilExpiry < 0) {
  logger.error('🚨 CRITICAL: Meta token has EXPIRED');
  throw new Error('Manual re-authentication required');
}
```

**Why**: Immediately fails with clear error message instead of attempting impossible refresh

#### C. **Graceful Degradation**
```typescript
try {
  return await this.refreshMetaToken(tokenData.access_token);
} catch (error) {
  // If refresh fails but token still valid, use existing token
  if (daysUntilExpiry > 0) {
    logger.warn('Meta token refresh failed, but token still valid');
    return tokenData.access_token;
  }
  throw error;
}
```

**Why**: Continues working with valid token even if refresh fails

#### D. **Enhanced Error Logging**
```typescript
logger.error('🚨 CRITICAL: Meta token is invalid or expired', {
  error: errorMsg,
  errorCode,
  status: response.status,
  hint: 'Token may be expired or invalid',
  action_required: 'Manual re-authentication needed immediately'
});
```

**Why**: Provides actionable error messages for debugging

---

## 📋 Monitoring Checklist

### Daily Checks (Automated)
- [x] Workflow Health Monitor runs at 08:00 UTC
- [x] Token refresh runs every 30 minutes
- [x] Incremental sync runs every 2 hours
- [x] Daily full sync runs at 02:00 UTC

### Weekly Checks (Automated)
- [x] Keep-alive workflow runs every Monday
- [x] All workflows remain active

### Monthly Manual Checks
- [ ] Review token expiration dates
  ```bash
  # Check via Supabase
  SELECT platform, expires_at,
         EXTRACT(DAY FROM (expires_at - NOW())) as days_until_expiry
  FROM marketing.platform_tokens;
  ```
- [ ] Review workflow run history
  ```bash
  gh run list --limit 20
  ```
- [ ] Check for failed runs
  ```bash
  gh run list --status failure --limit 10
  ```

---

## 🚨 Alert Thresholds

### Critical (Immediate Action Required)
- ❌ Any workflow disabled
- ❌ Token expired (< 0 days)
- ❌ Token refresh hasn't run in 2+ hours
- ❌ Sync failures for 6+ hours

### Warning (Action Needed Soon)
- ⚠️ Token expires in < 14 days
- ⚠️ Token refresh failures (but token still valid)
- ⚠️ Sync delays > 4 hours

### Info (Monitoring)
- ℹ️ Token refreshed successfully
- ℹ️ Sync completed
- ℹ️ Workflow health check passed

---

## 🛠️ Recovery Procedures

### If Workflows Get Disabled Again

1. **Re-enable all workflows**:
   ```bash
   gh workflow enable token-refresh.yml
   gh workflow enable etl-incremental-sync-v2.yml
   gh workflow enable etl-daily-full-sync-v2.yml
   gh workflow enable keep-alive.yml
   gh workflow enable workflow-health-check.yml
   ```

2. **Verify they're enabled**:
   ```bash
   gh workflow list --all
   ```

3. **Trigger immediate run**:
   ```bash
   gh workflow run token-refresh.yml
   gh workflow run etl-incremental-sync-v2.yml
   ```

### If Meta Token Expires

1. **Get new token from Meta Graph API Explorer**:
   - Go to https://developers.facebook.com/tools/explorer
   - Select your app
   - Generate access token with required permissions
   - Exchange for long-lived token:
     ```bash
     curl -G "https://graph.facebook.com/oauth/access_token" \
       -d "grant_type=fb_exchange_token" \
       -d "client_id=${META_APP_ID}" \
       -d "client_secret=${META_APP_SECRET}" \
       -d "fb_exchange_token=SHORT_TOKEN"
     ```

2. **Update database**:
   ```sql
   UPDATE marketing.platform_tokens
   SET
     access_token = 'NEW_TOKEN',
     expires_at = NOW() + INTERVAL '60 days',
     updated_at = NOW()
   WHERE platform = 'meta';
   ```

3. **Verify and test**:
   ```bash
   gh workflow run etl-incremental-sync-v2.yml --field platform=meta
   ```

---

## 📊 Dashboard Queries

### Check Current Token Status
```sql
SELECT
  platform,
  CASE
    WHEN expires_at < NOW() THEN 'EXPIRED'
    WHEN expires_at < NOW() + INTERVAL '7 days' THEN 'EXPIRING_SOON'
    WHEN expires_at < NOW() + INTERVAL '14 days' THEN 'WARNING'
    ELSE 'HEALTHY'
  END as status,
  expires_at,
  EXTRACT(DAY FROM (expires_at - NOW())) as days_until_expiry,
  updated_at
FROM marketing.platform_tokens
ORDER BY expires_at;
```

### Check Recent Sync Activity
```sql
SELECT
  platform,
  entity_type,
  sync_type,
  status,
  start_time,
  records_processed,
  error_message
FROM marketing.etl_sync_log
WHERE start_time >= NOW() - INTERVAL '24 hours'
ORDER BY start_time DESC
LIMIT 20;
```

### Check Sync Failures
```sql
SELECT
  platform,
  entity_type,
  COUNT(*) as failure_count,
  MAX(start_time) as last_failure,
  MAX(error_message) as latest_error
FROM marketing.etl_sync_log
WHERE status = 'failed'
AND start_time >= NOW() - INTERVAL '7 days'
GROUP BY platform, entity_type
ORDER BY last_failure DESC;
```

---

## 🔮 Future Improvements

### Potential Enhancements:
1. **Slack/Email Alerts**: Add webhook notifications for critical issues
2. **Meta System User Tokens**: Migrate to never-expiring system user tokens
3. **Automated Token Rotation**: Script to auto-refresh Meta tokens via OAuth
4. **Health Dashboard**: Web UI for real-time monitoring
5. **Retry Logic**: Exponential backoff for failed syncs
6. **Cost Anomaly Detection**: Alert on unusual spend patterns

---

## 📞 Support

### If You See This Error:
```
Meta token expired. Manual re-authentication required.
```

**Action**: Follow "If Meta Token Expires" recovery procedure above

### If Workflows Stop Running:
**Action**: Check if workflows are disabled and follow "If Workflows Get Disabled" procedure

### For Other Issues:
- Check workflow run logs: `gh run view [run-id] --log`
- Review database sync logs (queries above)
- Check GitHub Actions tab in repository

---

**Last Updated**: January 7, 2026
**Next Review Due**: February 7, 2026 (monthly review)
**Meta Token Expires**: March 8, 2026 (refresh by March 1)
