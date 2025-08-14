# GitHub Actions Deployment Guide

This guide covers deploying the Lengolf Ads ETL service using GitHub Actions workflows for automated, serverless operation.

## 🎯 Overview

The GitHub Actions deployment runs the ETL service directly in GitHub's infrastructure:
- **Zero server costs** - No Cloud Run, EC2, or other hosting needed
- **Automated scheduling** - Runs every 2 hours with daily full syncs
- **Built-in monitoring** - GitHub's workflow logs and notifications
- **Scalable** - 2000 free minutes/month for private repos

## 🔧 Prerequisites

1. **GitHub Repository** with the ETL codebase
2. **Supabase Database** - Marketing schema configured
3. **Google Ads API Access** - OAuth credentials and developer token
4. **Meta Ads API Access** - App credentials and ad account access
5. **API Keys & Tokens** - All authentication credentials ready

## 📋 Setup Steps

### 1. Configure Repository Secrets

Navigate to your repository: `Settings > Secrets and variables > Actions`

Add the following secrets:

#### Required Secrets

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-key-here

# Google Ads Configuration  
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CUSTOMER_ID=your-google-customer-id
GOOGLE_DEVELOPER_TOKEN=your-google-developer-token

# Meta Ads Configuration
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret
META_AD_ACCOUNT_ID=your-meta-ad-account-id

# ETL Service Authentication
ETL_API_KEY=your-secure-etl-api-key-here
```

#### Security Best Practices

- ✅ Use GitHub Secrets (never commit credentials to code)
- ✅ Rotate API keys periodically
- ✅ Use least-privilege access for service accounts
- ✅ Monitor secret usage in workflow logs

### 2. Workflow Files Overview

The repository includes three main workflows:

#### `etl-incremental-sync.yml`
- **Schedule**: Every 2 hours
- **Purpose**: Regular incremental data updates
- **Entities**: All platforms (campaigns, ads, performance data)
- **Runtime**: ~5-10 minutes per execution

#### `etl-daily-full-sync.yml`  
- **Schedule**: Daily at 2 AM UTC (9 AM Thailand)
- **Purpose**: Complete data refresh and quality checks
- **Entities**: Full dimensional + performance sync
- **Runtime**: ~15-30 minutes per execution

#### `etl-emergency-sync.yml`
- **Schedule**: Manual trigger only
- **Purpose**: Emergency recovery and troubleshooting
- **Features**: Custom date ranges, platform-specific syncs
- **Runtime**: Variable (up to 45 minutes)

### 3. Enable Workflows

1. **Push workflow files** to your repository main branch
2. **Navigate to Actions tab** in GitHub
3. **Enable workflows** if prompted by GitHub
4. **Verify workflow files** appear in the Actions tab

### 4. Initial Setup Verification

#### Run First Sync Manually

1. Go to `Actions` tab
2. Select `ETL Emergency Sync & Recovery`
3. Click `Run workflow`
4. Choose `quick-sync` option
5. Click `Run workflow` button

#### Monitor Execution

```bash
# Watch for these success indicators:
✅ ETL service is ready!
✅ Meta campaigns synced successfully  
✅ Google campaigns synced successfully
✅ All ETL jobs completed successfully!
```

## 📊 Workflow Configuration

### Customizing Schedules

Edit the `cron` expressions in workflow files:

```yaml
# Current: Every 2 hours
- cron: '0 */2 * * *'

# Alternative schedules:
- cron: '0 */4 * * *'     # Every 4 hours
- cron: '0 9,13,17 * * *' # 3 times daily (9 AM, 1 PM, 5 PM UTC)
- cron: '0 */1 * * *'     # Every hour (higher resource usage)
```

### Environment Variables

The workflows automatically set these environment variables:

```yaml
env:
  PORT: 8080
  NODE_ENV: production
  LOG_LEVEL: info
  # All secrets are injected from GitHub repository secrets
```

### Timeout Configuration

Adjust timeout values based on your data volume:

```yaml
jobs:
  setup-etl-service:
    timeout-minutes: 30  # Default: 30 minutes
    
    # For larger datasets:
    timeout-minutes: 45  # Increase if needed
```

## 🔍 Monitoring & Debugging

### Workflow Status

GitHub provides comprehensive monitoring:

- **Workflow History**: All executions with status
- **Detailed Logs**: Step-by-step execution details
- **Error Messages**: API responses and error context
- **Resource Usage**: Runtime and compute consumption

### Accessing Logs

1. **Navigate to Actions tab**
2. **Click on workflow run**
3. **Expand specific job/step** to see logs
4. **Download logs** for offline analysis

### Common Success Patterns

```bash
# Healthy workflow execution:
🚀 Starting ETL service in background...
✅ ETL service is ready!
📱 Syncing Meta Ads data...
✅ Meta campaigns synced successfully
42 records processed
🔍 Syncing Google Ads data...  
✅ Google campaigns synced successfully
7 records processed
📊 ETL Incremental Sync Summary
🎯 Incremental sync completed!
```

### Error Patterns to Watch

```bash
# Service startup failures:
❌ ETL service failed to start

# Authentication issues:
❌ Meta campaigns sync failed with HTTP 401
❌ Google campaigns sync failed with HTTP 403

# API rate limiting:
❌ Meta insights sync failed with HTTP 429

# Database connectivity:
❌ Supabase connection failed
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Workflow Not Running
```bash
# Check these:
- Workflow files in .github/workflows/ directory
- Workflows enabled in Actions tab
- Cron schedule syntax is correct
- Repository has Actions enabled
```

#### 2. Authentication Failures
```bash
# Solutions:
- Verify all secrets are properly configured
- Check secret names match exactly
- Ensure API keys haven't expired
- Test credentials manually if needed
```

#### 3. Service Startup Failures
```bash
# Debug steps:
- Check Node.js build logs
- Verify package.json scripts
- Review environment variable setup
- Check for missing dependencies
```

#### 4. Sync Failures
```bash
# Recovery options:
- Use emergency sync workflow
- Check platform API status
- Verify token refresh is working
- Review rate limiting errors
```

### Emergency Recovery

If regular syncs are failing:

1. **Quick Recovery**:
   ```bash
   # Use emergency sync with "quick-sync"
   # Syncs last 6 hours of data
   ```

2. **Full Recovery**:
   ```bash
   # Use emergency sync with "full-historical"
   # Specify custom date range
   ```

3. **Platform-Specific**:
   ```bash
   # Use "meta-only" or "google-only" options
   # Isolate platform-specific issues
   ```

### Performance Optimization

#### Reducing Execution Time

```yaml
# Optimize workflow performance:
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'  # ✅ Enable dependency caching
```

#### Managing Resource Usage

```bash
# Current usage estimate:
- Incremental sync: ~8-12 minutes
- Daily full sync: ~15-25 minutes  
- Emergency sync: ~10-45 minutes

# Monthly total: ~400-600 minutes
# GitHub free tier: 2000 minutes/month
# Estimated cost: $0 (within free tier)
```

## 📈 Advanced Configuration

### Adding Slack Notifications

Add to any workflow for alerts:

```yaml
- name: Notify Slack on Failure
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: failure
    channel: '#alerts'
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
    message: 'ETL sync failed - check logs'
```

### Custom Sync Schedules

Create additional workflow files for specific needs:

```yaml
# .github/workflows/etl-weekend-sync.yml
name: Weekend Deep Sync
on:
  schedule:
    - cron: '0 6 * * 6,0'  # 6 AM on weekends
```

### Environment-Specific Workflows

```yaml
# Different schedules for different environments:
on:
  schedule:
    - cron: '0 */2 * * *'  # Production: Every 2 hours
    # - cron: '0 */4 * * *'  # Staging: Every 4 hours
```

## 🔒 Security Considerations

### Secret Management
- Rotate API keys quarterly
- Use dedicated service accounts
- Monitor secret access logs
- Never log sensitive information

### Workflow Security
- Pin action versions: `uses: actions/checkout@v4`
- Review third-party actions before use
- Use official GitHub actions when possible
- Monitor workflow modifications

### Network Security
- All API calls use HTTPS
- Database connections are encrypted
- No persistent storage of credentials
- Temporary runtime environment

## 📚 Next Steps

After successful GitHub Actions setup:

1. **Monitor for 24 hours** to ensure stable operation
2. **Review sync logs** for any warnings or errors  
3. **Verify data quality** in Supabase dashboard
4. **Set up alerting** for critical failures
5. **Document custom configurations** for team reference

---

*For advanced troubleshooting, see [Operations Guide](../operations/troubleshooting.md)*