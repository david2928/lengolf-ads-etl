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

### Running locally
```bash
# .env must have SUPABASE_*, GOOGLE_*, META_*, ETL_API_KEY populated
npm start                                                # node dist/index.js (requires prior `npm run build`)
curl -fs http://localhost:8080/health                    # smoke test
curl -X POST -H "Authorization: Bearer ${ETL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"platform":"meta","mode":"incremental","entities":["insights"]}' \
  http://localhost:8080/api/sync                         # one-shot sync against prod Supabase
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

## Deployment — GitHub Actions (no long-running server)

The service does **not** run as a hosted daemon. Each sync is a fresh, ephemeral run inside a GitHub Actions `ubuntu-latest` job: the workflow checks out the repo, `npm ci && npm run build`, starts the Express service in the background on `localhost:8080`, curls `/api/sync` for each entity in sequence, then tears the service down.

Workflows in `.github/workflows/`:
- `etl-incremental-sync-v2.yml` — every 4h cron + manual dispatch; the main sync path. Also exercises the lazy OAuth refresh on each run.
- `etl-daily-full-sync-v2.yml` — daily full sync.
- `etl-emergency-sync-v2.yml` — manual-only emergency sync.
- `etl-offline-conversions.yml` — Google Ads offline conversion upload.

Secrets (`SUPABASE_*`, `GOOGLE_*`, `META_*`, `ETL_API_KEY`) live in GH Actions repository secrets and are exported into `$GITHUB_ENV` by the workflow's setup step. The Dockerfile is retained for local container runs but is not deployed to any hosted runtime — Cloud Run was abandoned.

Tokens auto-refresh inside `TokenManager` (Google with a 5-min expiry buffer, Meta proactively when <14 days remain on the 60-day long-lived token), so no separate refresh cron is needed.

## API Authentication

All `/api/*` endpoints require Bearer token:
```bash
curl -H "Authorization: Bearer ${ETL_API_KEY}" http://localhost:8080/api/sync
```

The service only listens on the localhost of whatever runner spawned it — there is no public URL.

## Integration Points

- GH Actions cron (`etl-incremental-sync-v2.yml`, every 4h) is the only thing that triggers regular syncs. There is no `pg_cron` job calling out.
- Main Lengolf Forms app queries the populated `marketing.*` tables directly from Supabase.
- Both services share the same Supabase database; this ETL writes only to the `marketing` schema.