# GitHub Actions ETL Workflows

This directory contains GitHub Actions workflows for automating the Lengolf Ads ETL data synchronization process **directly in GitHub's infrastructure** - no external servers required!

## 🔄 Workflows Overview

### 1. `etl-incremental-sync.yml` - Main Incremental Sync
**Schedule**: Every 2 hours  
**Purpose**: Regular incremental data updates for both Meta and Google Ads
**Runtime**: GitHub Actions runner with ETL service started in-process

**Features**:
- Builds and starts ETL service in GitHub Actions
- Syncs dimensional data (campaigns, ad sets, ads, keywords)
- Syncs performance data (insights, metrics)
- Sequential execution with rate limiting
- Manual trigger with platform selection
- Force full sync option
- Comprehensive error handling and cleanup

### 2. `etl-daily-full-sync.yml` - Daily Full Refresh
**Schedule**: Daily at 2 AM UTC (9 AM Thailand time)  
**Purpose**: Complete data refresh and quality verification
**Runtime**: Extended GitHub Actions job with full data processing

**Features**:
- Health checks before sync operations
- Full dimensional data sync with batching
- Performance data sync with historical option
- Data quality verification steps
- Service monitoring and metrics
- Daily summary report generation

### 3. `etl-emergency-sync.yml` - Emergency Recovery
**Schedule**: Manual trigger only  
**Purpose**: Emergency data recovery and troubleshooting
**Runtime**: Up to 45 minutes for large historical syncs

**Features**:
- Quick sync (last 6 hours)
- Full historical sync with custom date ranges
- Platform-specific recovery (Meta-only, Google-only)
- Performance-only sync
- Token refresh functionality
- Flexible recovery options

## 🔧 Setup Instructions

### 1. Repository Secrets Configuration

Add these secrets to your GitHub repository (`Settings > Secrets and variables > Actions`):

```bash
# Supabase Database
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-key

# Google Ads API
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CUSTOMER_ID=your-google-customer-id
GOOGLE_DEVELOPER_TOKEN=your-google-developer-token

# Meta Ads API
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret
META_AD_ACCOUNT_ID=your-meta-ad-account-id

# ETL Authentication
ETL_API_KEY=your-secure-etl-api-key
```

### 2. Enable Workflows

1. Push these workflow files to your repository
2. Go to `Actions` tab in GitHub
3. Enable workflows if prompted
4. Workflows will start running automatically according to their schedules

### 3. Manual Triggering

All workflows support manual triggering:
1. Go to `Actions` tab
2. Select the workflow you want to run
3. Click `Run workflow`
4. Fill in any required parameters
5. Click `Run workflow` button

## 📊 Monitoring & Notifications

### Workflow Status
- **Success**: All steps completed without errors
- **Failure**: One or more steps failed (will be highlighted in red)
- **Cancelled**: Workflow was manually cancelled

### Logs and Debugging
- Click on any workflow run to see detailed logs
- Each step shows execution details and API responses
- Failed steps will show error messages and HTTP response codes

### Notifications
GitHub will automatically notify you of workflow failures via:
- Email notifications (if enabled in your GitHub settings)
- GitHub web interface notifications
- Mobile app notifications (if GitHub mobile app is installed)

## ⚙️ Workflow Configuration

### Customizing Schedules

Edit the `cron` expressions in the workflow files:

```yaml
schedule:
  # Every 2 hours
  - cron: '0 */2 * * *'
  
  # Daily at 2 AM UTC
  - cron: '0 2 * * *'
  
  # Every 4 hours during business hours (9 AM - 5 PM UTC)
  - cron: '0 9,13,17 * * *'
```

### Adding Slack Notifications

To add Slack notifications, add this step to any workflow:

```yaml
- name: Notify Slack
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: failure
    channel: '#alerts'
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### Adjusting Timeout Values

Modify timeout values based on your data volume:

```yaml
jobs:
  sync-job:
    timeout-minutes: 30  # Increase for larger datasets
```

## 🚨 Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Check ETL_API_KEY secret is correct
   - Verify ETL service is running

2. **Timeout Errors**
   - Increase timeout values in workflow
   - Check if ETL service needs more resources

3. **Rate Limiting**
   - Add delays between API calls
   - Reduce concurrent requests

4. **Token Expiration**
   - Use emergency sync with "token-refresh" option
   - Check platform token status in ETL service

### Emergency Recovery

If regular syncs are failing:

1. **Quick Recovery**: Use emergency sync with "quick-sync" option
2. **Full Recovery**: Use emergency sync with "full-historical" option
3. **Platform Issues**: Use platform-specific recovery options
4. **Token Issues**: Use "token-refresh" option

### Getting Help

- Check workflow logs for detailed error messages
- Monitor ETL service health endpoint
- Review ETL service logs for additional context
- Use emergency sync workflows for immediate recovery

## 📈 Performance Optimization

### Reducing Execution Time
- Use incremental syncs for regular updates
- Limit date ranges for historical syncs
- Run platform syncs in parallel
- Add appropriate delays to avoid rate limiting

### Cost Optimization
- GitHub Actions provides 2000 free minutes/month for private repos
- Current workflows use ~10-15 minutes per run
- Estimated cost: Free for most usage patterns

### Data Freshness vs Resource Usage
- **Every 2 hours**: Good balance of freshness and resource usage
- **Every hour**: More real-time data, higher resource usage
- **Every 4 hours**: Lower resource usage, less frequent updates

Choose the schedule that best fits your business requirements and budget constraints.