# Lengolf Ads ETL Service

A serverless ETL service for extracting Google Ads and Meta Ads data via GitHub Actions, featuring Google Service Account authentication, automated token management, and comprehensive creative asset tracking.

## Background & Context

This ETL service was created to replace the embedded ads data extraction logic in the main [Lengolf Forms](https://github.com/lengolf/lengolf-forms) Next.js application. Lengolf Forms is a comprehensive golf booking and business management system for golf courses, featuring:

- **Booking Management**: Golf course reservations, tee time scheduling
- **Customer Management**: Customer profiles, package tracking, loyalty programs  
- **POS System**: Point-of-sale transactions, inventory management
- **Marketing Analytics**: Ad performance tracking, ROI analysis, competitor monitoring
- **Staff Operations**: Time tracking, scheduling, administrative tools

### Migration Goals

The original application had Google Ads and Meta Ads API calls embedded directly in the Next.js API routes (`/app/api/google-ads/` and `/app/api/meta-ads/`), which created several challenges:

**Problems with Embedded Approach:**
- 🔗 **Tight Coupling**: Ads logic mixed with main application code
- ⏱️ **Performance Impact**: Synchronous API calls blocking application response times
- 🔄 **Manual Token Management**: No automated OAuth token refresh
- 📊 **Limited Data Depth**: Missing ad-level creative assets and thumbnails
- 🚫 **No Scheduling**: Manual data refresh only, no automation
- 📈 **Scalability Issues**: Difficult to handle large data volumes

**Goals of This ETL Service:**
- ✅ **Decouple Data Extraction**: Move ads processing to dedicated Cloud Run service
- ✅ **Rich Creative Data**: Extract complete ad assets with thumbnails and preview URLs
- ✅ **Automated Scheduling**: Hourly incremental syncs via Supabase pgcron
- ✅ **Token Management**: Automated OAuth refresh for both Google and Meta
- ✅ **Performance**: Async, batch processing with configurable sizes
- ✅ **Monitoring**: Comprehensive metrics and health checks
- ✅ **Scalability**: Cloud Run auto-scaling based on load

### Integration with Main Application

The main Lengolf Forms application continues to serve golf course operations while this ETL service handles all marketing data extraction. The applications integrate through:

- **Shared Database**: Both use the same Supabase `marketing` schema
- **API Integration**: Main app can trigger syncs via REST API
- **Dashboard Data**: Marketing dashboards in main app use data populated by this service
- **Authentication**: Unified approach using the same Supabase authentication

This separation allows the main golf booking application to focus on core business operations while ensuring marketing teams have access to the most detailed and up-to-date advertising data available.

## Features

- 🚀 **Google Ads Integration**: Complete campaign, ad group, ad, and keyword extraction with creative assets
- 📱 **Meta Ads Integration**: Campaign, ad set, ad, and creative extraction with visual assets
- 🔄 **Incremental Loading**: State-based incremental syncs with configurable lookback
- 🎨 **Creative Assets**: Image/video extraction with thumbnails and preview URLs
- 🔐 **Service Account Auth**: Google Service Account authentication eliminates token expiration issues
- 🔄 **OAuth Fallback**: Automated OAuth token refresh for backward compatibility
- 📊 **Monitoring**: Prometheus metrics and comprehensive status tracking
- ⚡ **Performance**: Batch processing with configurable batch sizes
- 🏥 **Health Checks**: Kubernetes-ready health, liveness, and readiness probes

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Lengolf Forms (Next.js)                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │  Golf Bookings  │ │ Marketing Dash  │ │  Staff Admin    │   │
│  │   & Customer    │ │   (uses ETL     │ │   Operations    │   │
│  │   Management    │ │    data)        │ │                 │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP API calls
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Lengolf Ads ETL Service                      │
│                      (Cloud Run)                               │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │  API Layer      │ │   Extractors    │ │    Loaders      │   │
│  │  - /api/sync    │ │  - Google Ads   │ │  - Supabase     │   │
│  │  - /api/status  │ │  - Meta Ads     │ │  - Batch Proc   │   │
│  │  - /health      │ │  - Creative     │ │  - Incremental  │   │
│  │  - /metrics     │ │    Assets       │ │    Sync         │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ Database writes
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Supabase Database                          │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │ marketing.*     │ │    public.*     │ │     pos.*       │   │
│  │ - campaigns     │ │  - bookings     │ │ - transactions  │   │
│  │ - ads           │ │  - customers    │ │ - products      │   │
│  │ - creatives     │ │  - packages     │ │ - inventory     │   │
│  │ - assets        │ │                 │ │                 │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│                              │                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   pgcron                                │   │
│  │  - Hourly: trigger ETL incremental sync                │   │
│  │  - Daily: creative assets refresh                      │   │
│  │  - Weekly: full reconciliation                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ API calls
┌─────────────────────────────────────────────────────────────────┐
│                External Ad Platforms                           │
│  ┌─────────────────┐           ┌─────────────────┐             │
│  │   Google Ads    │           │    Meta Ads     │             │
│  │      API        │           │   Graph API     │             │
│  └─────────────────┘           └─────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### ETL Service Components

```
Cloud Run Service
├── API Layer (Express.js)
│   ├── /health - Health checks
│   ├── /api/sync - Trigger syncs
│   ├── /api/status - Sync status
│   └── /api/metrics - Prometheus metrics
├── Extractors
│   ├── Google Ads API integration
│   └── Meta Graph API integration
├── Loaders
│   ├── Supabase batch processing
│   └── Incremental sync management
└── Token Management
    ├── OAuth2 refresh flows
    └── Secure token storage
```

## Quick Start

### 🚀 GitHub Actions Setup (Recommended)

1. **Add Service Account Secret**:
   - Go to Repository Settings → Secrets → Actions
   - Add secret: `GOOGLE_SERVICE_ACCOUNT_KEY` with your service account JSON

2. **Push Changes**:
   ```bash
   git add .
   git commit -m "Setup service account authentication" 
   git push
   ```

3. **Monitor Workflows**:
   - Check the Actions tab for automatic deployments
   - Workflows run every 2 hours for incremental sync

📖 **Complete Setup Guide**: See [docs/setup/service-account-setup.md](./docs/setup/service-account-setup.md)

### 🛠️ Local Development

```bash
# Clone repository
git clone <repository-url>
cd lengolf-ads-etl

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Configure environment variables (see Configuration section)
nano .env.local

# Start development server
npm run dev
```

### Docker Development

```bash
# Build Docker image
npm run docker:build

# Run container
npm run docker:run
```

### GitHub Actions Deployment

Deployment is automated via GitHub Actions. Simply push to your repository:

```bash
git push origin main
```

Workflows will automatically:
- Build and deploy the service
- Run incremental syncs every 2 hours
- Refresh tokens every 30 minutes (if using OAuth2)

## Configuration

### Required Environment Variables

```bash
# Server
PORT=8080
NODE_ENV=production

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Google Ads (OAuth2 - for backward compatibility)
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_CUSTOMER_ID=123-456-7890
GOOGLE_DEVELOPER_TOKEN=your-google-ads-developer-token

# Google Service Account (Recommended - eliminates token expiration)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"...@....iam.gserviceaccount.com",...}

# Meta Ads
META_APP_ID=your-facebook-app-id
META_APP_SECRET=your-facebook-app-secret
META_AD_ACCOUNT_ID=act_1234567890

# Security
ETL_API_KEY=your-secure-api-key
```

### Database Schema

The service expects the following tables in the `marketing` schema:

- `google_ads_campaigns`
- `google_ads_ad_groups`
- `google_ads_ads`
- `google_ads_keywords`
- `meta_ads_campaigns`
- `meta_ads_ad_sets`
- `meta_ads_ads`
- `meta_ads_ad_creatives`
- `ad_creative_assets`
- `etl_sync_log`
- `platform_tokens`

See `docs/GOOGLE_META_ADS_ETL_MIGRATION.md` for complete schema.

## API Reference

### Authentication

All API endpoints (except `/health`) require Bearer token authentication:

```bash
curl -H "Authorization: Bearer your-etl-api-key" \
  https://your-service.run.app/api/sync
```

### Endpoints

#### Trigger Sync

```bash
POST /api/sync
Content-Type: application/json

{
  "platform": "google|meta|all",
  "mode": "incremental|full", 
  "entities": ["campaigns", "ads", "keywords"],
  "lookbackHours": 2
}
```

#### Get Sync Status

```bash
GET /api/status/{batchId}
```

#### Recent Sync History

```bash
GET /api/status/recent?platform=google&hours=24&limit=50
```

#### Test Connection

```bash
POST /api/test-connection
Content-Type: application/json

{
  "platform": "google"
}
```

#### Refresh Tokens

```bash
POST /api/auth/refresh
Content-Type: application/json

{
  "platform": "google"
}
```

#### Metrics

```bash
# Prometheus format
GET /api/metrics

# JSON format  
GET /api/metrics/json
```

## Data Extraction

### Google Ads

The service extracts the following data:

**Campaigns**: Basic campaign info, budgets, bidding strategies
**Ad Groups**: Targeting settings, bid amounts, optimization goals
**Ads**: Creative content including:
- Headlines and descriptions
- Images and videos with thumbnails
- Final URLs and display URLs
- Ad strength scores
**Keywords**: Match types, quality scores, bid amounts
**Performance**: Impressions, clicks, costs, conversions

### Meta Ads

**Campaigns**: Campaign objectives, start/end dates
**Ad Sets**: Targeting, budgets, optimization goals
**Ads**: Basic ad information
**Creatives**: Detailed creative content including:
- Image and video URLs with thumbnails
- Ad copy (title, body, CTA)
- Preview URLs for ad visualization
- Carousel data for multi-image ads

### Creative Assets

Both platforms store creative assets in the unified `ad_creative_assets` table:

- **Thumbnails**: Optimized preview images
- **Full-size assets**: Original images/videos
- **Metadata**: Dimensions, file sizes, approval status
- **Preview URLs**: Platform-specific ad preview links

## Scheduling

### PgCron Integration

The service is designed to be triggered by Supabase pgcron:

```sql
-- Hourly incremental sync
SELECT cron.schedule('google-ads-sync', '0 * * * *', 
  'SELECT net.http_post(''https://your-service.run.app/api/sync'', ...)'
);
```

### Recommended Schedule

- **Hourly**: Incremental performance data and new ads
- **Daily**: Creative assets and dimensional data refresh  
- **Weekly**: Full reconciliation sync

## Monitoring

### Health Checks

```bash
# Basic health
GET /health

# Detailed health with service checks
GET /health?detailed=true

# Kubernetes liveness probe
GET /health/live

# Kubernetes readiness probe
GET /health/ready
```

### Metrics

The service exposes Prometheus metrics at `/api/metrics`:

- `etl_syncs_total{platform, status}` - Total sync counts
- `etl_records_processed_total{platform}` - Records processed
- `etl_sync_duration_seconds{platform}` - Sync durations
- `etl_success_rate{platform}` - Success rates
- `etl_running_syncs{platform}` - Currently running syncs

### Logging

Structured JSON logging with Cloud Run integration:

```javascript
{
  "timestamp": "2024-01-15T10:30:00Z",
  "severity": "INFO", 
  "message": "Sync completed",
  "platform": "google",
  "recordsProcessed": 1500
}
```

## Development

### Project Structure

```
src/
├── api/           # Express routes and middleware
├── auth/          # Token management
├── extractors/    # Platform-specific data extraction
│   ├── google/    # Google Ads extractors
│   └── meta/      # Meta Ads extractors
├── loaders/       # Database loading and batch processing
├── utils/         # Configuration, logging, types
└── index.ts       # Application entry point
```

### Adding New Extractors

1. Create extractor class in `src/extractors/{platform}/`
2. Implement data transformation methods
3. Add to sync manager in `src/loaders/incremental-sync.ts`
4. Update API routes in `src/api/sync.ts`

### Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Lint code
npm run lint
```

## Deployment

### Cloud Build

The service includes Cloud Build configuration for automated deployment:

```yaml
# Triggered on git push to main branch
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/lengolf-ads-etl:$COMMIT_SHA', '.']
  - name: 'gcr.io/cloud-builders/docker' 
    args: ['push', 'gcr.io/$PROJECT_ID/lengolf-ads-etl:$COMMIT_SHA']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args: ['run', 'deploy', 'lengolf-ads-etl', ...]
```

### Environment Management

- **Development**: Local environment with `.env.local`
- **Staging**: Cloud Run with staging secrets
- **Production**: Cloud Run with production secrets

### Secret Management

Store sensitive configuration in Google Secret Manager:

```bash
# Store secrets
gcloud secrets create supabase-service-key --data-file=service-key.txt
gcloud secrets create google-client-secret --data-file=client-secret.txt

# Grant access to Cloud Run service account
gcloud secrets add-iam-policy-binding supabase-service-key \
  --member="serviceAccount:your-service-account@project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Troubleshooting

### Common Issues

**Token Refresh Failures**
- Check token storage in `platform_tokens` table
- Verify OAuth client credentials
- Check token expiry dates

**API Rate Limits**
- Monitor request rates in logs
- Adjust batch sizes if needed
- Implement exponential backoff

**Database Connection Issues**
- Verify Supabase credentials
- Check network connectivity
- Review RLS policies

**Memory Issues**
- Reduce batch sizes
- Monitor memory usage in metrics
- Increase Cloud Run memory allocation

### Debugging

Enable debug logging:

```bash
LOG_LEVEL=debug npm run dev
```

View Cloud Run logs:

```bash
gcloud run services logs read lengolf-ads-etl \
  --region asia-southeast1 \
  --limit 100
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-extractor`
3. Make changes and add tests
4. Commit with conventional commits: `feat: add meta creative extraction`
5. Push and create pull request

## License

MIT License - see LICENSE file for details.