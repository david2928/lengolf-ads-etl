# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lengolf Ads ETL Service - A dedicated Google Cloud Run service for extracting Google Ads and Meta Ads data with automated token refresh, incremental loading, and comprehensive creative asset tracking. Part of the Lengolf golf course management system.

## Key Commands

### Development
```bash
npm run dev           # Start development server with hot reload (uses tsx watch)
npm run build        # Build TypeScript to dist/
npm run lint         # Run ESLint on src/**/*.ts
npm test             # Run Jest tests (no tests currently implemented)
```

### Docker
```bash
npm run docker:build # Build Docker image locally
npm run docker:run   # Run Docker container on port 8080
```

### Google Cloud Deployment
```bash
# Deploy to Cloud Run (Asia Southeast 1)
gcloud run deploy lengolf-ads-etl \
  --source . \
  --region asia-southeast1 \
  --platform managed \
  --memory 2Gi \
  --cpu 2 \
  --timeout 900 \
  --max-instances 10 \
  --min-instances 1
```

## Architecture

### Core Components

1. **API Layer** (`src/api/`) - Express.js REST API
   - `/health` - Health checks (no auth required)
   - `/api/sync` - Trigger data syncs (requires Bearer token)
   - `/api/status` - Check sync status
   - `/api/metrics` - Prometheus metrics

2. **Extractors** (`src/extractors/`) - Platform-specific data extraction
   - `google/` - Google Ads API integration
   - `meta/` - Meta Graph API integration

3. **Loaders** (`src/loaders/`) - Database operations
   - `batch-processor.ts` - Batch processing logic
   - `incremental-sync.ts` - State-based incremental sync management
   - `supabase-client.ts` - Supabase database client

4. **Auth** (`src/auth/`) - OAuth token management
   - `token-manager.ts` - Automated token refresh for Google & Meta

5. **Utils** (`src/utils/`) - Shared utilities
   - `config.ts` - Configuration management
   - `logger.ts` - Winston logging
   - `types.ts` - TypeScript type definitions

### Data Flow

1. API endpoint receives sync request → 
2. Extractor fetches data from ad platform →
3. Transformer processes raw data →
4. Loader writes to Supabase in batches →
5. Status and metrics updated

### Database Schema

Uses Supabase `marketing` schema with tables:
- `google_ads_campaigns`, `google_ads_ad_groups`, `google_ads_ads`, `google_ads_keywords`
- `meta_ads_campaigns`, `meta_ads_ad_sets`, `meta_ads_ads`, `meta_ads_ad_creatives`
- `ad_creative_assets` - Unified creative asset storage
- `etl_sync_log` - Sync history and state tracking
- `platform_tokens` - OAuth token storage

## TypeScript Configuration

- Target: ES2022, Module: CommonJS
- Strict mode enabled with all strict checks
- Path aliases configured: `@/` maps to `src/`
- Source maps and declarations generated

## Environment Variables

Required variables (see `.env.example`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Database connection
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CUSTOMER_ID`, `GOOGLE_DEVELOPER_TOKEN` - Google Ads
- `META_APP_ID`, `META_APP_SECRET`, `META_AD_ACCOUNT_ID` - Meta Ads
- `ETL_API_KEY` - API authentication

## Cloud Build & Deployment

- Automated deployment via `cloudbuild.yaml`
- Deploys to Cloud Run in asia-southeast1
- Uses Google Secret Manager for sensitive config
- Container built with Node 20 Alpine base image

## API Authentication

All `/api/*` endpoints require Bearer token:
```bash
curl -H "Authorization: Bearer ${ETL_API_KEY}" \
  https://your-service.run.app/api/sync
```

## Integration Points

- Supabase pgcron triggers hourly incremental syncs
- Main Lengolf Forms app queries synced data from marketing schema
- Both services share same Supabase database but different schemas