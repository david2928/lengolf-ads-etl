# API Endpoints Reference

The Lengolf Ads ETL Service provides a comprehensive REST API for managing data synchronization, monitoring system health, and accessing operational metrics.

## 🔐 Authentication

All API endpoints (except `/health`) require Bearer token authentication:

```bash
Authorization: Bearer YOUR_ETL_API_KEY
```

## 📋 Base URL

When running locally: `http://localhost:8080`
In GitHub Actions: `http://localhost:8080` (internal)

## 🛠️ Core Endpoints

### Health Check

#### `GET /health`

**Purpose**: Service health verification (no authentication required)

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-08-13T16:25:30.123Z",
  "version": "1.0.0",
  "environment": "production",
  "services": {
    "database": "up",
    "memory": {
      "used": 85,
      "total": 512,
      "percentage": 17
    },
    "uptime": 1423
  }
}
```

**Status Codes**:
- `200`: Service is healthy
- `503`: Service is degraded or unhealthy

---

### Data Synchronization

#### `POST /api/sync`

**Purpose**: Trigger data synchronization for specified platforms and entities

**Headers**:
```bash
Authorization: Bearer YOUR_ETL_API_KEY
Content-Type: application/json
```

**Request Body**:
```json
{
  "platform": "meta",
  "mode": "incremental",
  "entities": ["campaigns", "insights"],
  "lookbackHours": 6,
  "lookbackDays": 0,
  "startDate": "2025-01-01",
  "endDate": "2025-08-13"
}
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `platform` | string | Yes | `"google"`, `"meta"`, or `"all"` |
| `mode` | string | Yes | `"incremental"` or `"full"` |
| `entities` | array | Yes | List of entity types to sync |
| `lookbackHours` | number | No | Hours to look back for incremental sync |
| `lookbackDays` | number | No | Days to look back for incremental sync |
| `startDate` | string | No | Start date for full sync (YYYY-MM-DD) |
| `endDate` | string | No | End date for full sync (YYYY-MM-DD) |

**Entity Types**:

**Google Ads**:
- `campaigns`
- `ad_groups`
- `ads`
- `keywords`
- `performance`

**Meta Ads**:
- `campaigns`
- `adsets`
- `ads`
- `insights`

**Response (Success)**:
```json
{
  "success": true,
  "status": "completed",
  "message": "Sync completed for meta - insights",
  "summary": {
    "totalBatches": 1,
    "successfulBatches": 1,
    "failedBatches": 0,
    "partialBatches": 0,
    "totalRecordsProcessed": 434,
    "totalRecordsInserted": 434,
    "totalRecordsUpdated": 0,
    "totalRecordsFailed": 0,
    "totalDuration": 7105
  },
  "results": [
    {
      "batchId": "uuid-here",
      "platform": "meta",
      "entityType": "insights",
      "recordsProcessed": 434,
      "recordsInserted": 434,
      "recordsUpdated": 0,
      "recordsFailed": 0,
      "duration": 7105,
      "status": "completed"
    }
  ]
}
```

**Response (Error)**:
```json
{
  "success": false,
  "status": "failed",
  "message": "Sync failed for meta - insights",
  "summary": {
    "totalBatches": 1,
    "successfulBatches": 0,
    "failedBatches": 1,
    "totalRecordsProcessed": 0,
    "totalDuration": 30436
  },
  "results": [
    {
      "batchId": "",
      "platform": "meta",
      "entityType": "insights",
      "status": "failed",
      "errorMessage": "timeout of 30000ms exceeded"
    }
  ]
}
```

**Status Codes**:
- `200`: Sync completed successfully
- `400`: Invalid request parameters
- `401`: Unauthorized (invalid API key)
- `500`: Internal server error

---

### System Status

#### `GET /api/status`

**Purpose**: Get detailed system status and recent sync history

**Headers**:
```bash
Authorization: Bearer YOUR_ETL_API_KEY
```

**Response**:
```json
{
  "system": {
    "status": "healthy",
    "version": "1.0.0",
    "environment": "production",
    "uptime": 3600
  },
  "database": {
    "status": "connected",
    "connectionPool": {
      "active": 2,
      "idle": 8,
      "total": 10
    }
  },
  "platforms": {
    "google": {
      "status": "active",
      "lastSync": "2025-08-13T16:00:00Z",
      "tokenStatus": "valid"
    },
    "meta": {
      "status": "active", 
      "lastSync": "2025-08-13T16:00:00Z",
      "tokenStatus": "valid"
    }
  },
  "recentSyncs": [
    {
      "platform": "meta",
      "entityType": "insights",
      "status": "completed",
      "recordsProcessed": 434,
      "duration": 7105,
      "timestamp": "2025-08-13T16:00:00Z"
    }
  ]
}
```

**Status Codes**:
- `200`: Status retrieved successfully
- `401`: Unauthorized
- `503`: System unhealthy

---

### Metrics & Monitoring

#### `GET /api/metrics`

**Purpose**: Prometheus-compatible metrics for monitoring

**Headers**:
```bash
Authorization: Bearer YOUR_ETL_API_KEY
```

**Response**:
```text
# HELP lengolf_etl_sync_total Total number of sync operations
# TYPE lengolf_etl_sync_total counter
lengolf_etl_sync_total{platform="meta",entity="campaigns",status="success"} 42
lengolf_etl_sync_total{platform="google",entity="campaigns",status="success"} 38

# HELP lengolf_etl_records_processed_total Total number of records processed
# TYPE lengolf_etl_records_processed_total counter
lengolf_etl_records_processed_total{platform="meta",entity="insights"} 15420
lengolf_etl_records_processed_total{platform="google",entity="performance"} 8934

# HELP lengolf_etl_sync_duration_seconds Duration of sync operations
# TYPE lengolf_etl_sync_duration_seconds histogram
lengolf_etl_sync_duration_seconds_bucket{platform="meta",entity="insights",le="10"} 5
lengolf_etl_sync_duration_seconds_bucket{platform="meta",entity="insights",le="30"} 12
```

**Status Codes**:
- `200`: Metrics retrieved successfully
- `401`: Unauthorized

---

## 🔍 Sync Examples

### Common Use Cases

#### 1. Regular Incremental Sync
```bash
curl -X POST http://localhost:8080/api/sync \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "all",
    "mode": "incremental",
    "entities": ["campaigns", "insights", "performance"]
  }'
```

#### 2. Historical Data Backfill
```bash
curl -X POST http://localhost:8080/api/sync \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "meta",
    "mode": "full",
    "entities": ["insights"],
    "startDate": "2025-01-01",
    "endDate": "2025-01-31"
  }'
```

#### 3. Emergency Recent Data Recovery
```bash
curl -X POST http://localhost:8080/api/sync \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "google",
    "mode": "incremental",
    "entities": ["performance"],
    "lookbackHours": 24
  }'
```

#### 4. Platform-Specific Full Refresh
```bash
curl -X POST http://localhost:8080/api/sync \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "meta",
    "mode": "full",
    "entities": ["campaigns", "adsets", "ads", "insights"]
  }'
```

## ⚠️ Error Handling

### Common Error Responses

#### Authentication Error (401)
```json
{
  "error": "Unauthorized",
  "message": "Invalid API key"
}
```

#### Validation Error (400)
```json
{
  "error": "Bad Request",
  "message": "Invalid platform specified",
  "details": {
    "field": "platform",
    "value": "invalid",
    "allowed": ["google", "meta", "all"]
  }
}
```

#### Rate Limit Error (429)
```json
{
  "error": "Too Many Requests",
  "message": "API rate limit exceeded",
  "retryAfter": 60
}
```

#### Internal Server Error (500)
```json
{
  "error": "Internal Server Error",
  "message": "Database connection failed",
  "requestId": "req-uuid-here"
}
```

## 📊 Response Time Guidelines

| Endpoint | Expected Response Time |
|----------|----------------------|
| `GET /health` | < 100ms |
| `GET /api/status` | < 500ms |
| `GET /api/metrics` | < 200ms |
| `POST /api/sync` (incremental) | 30s - 5 minutes |
| `POST /api/sync` (full) | 2 - 30 minutes |

## 🔧 Rate Limiting

The API implements rate limiting to protect against abuse:

- **Health endpoint**: No rate limiting
- **Sync endpoints**: 1 request per minute per IP
- **Status/Metrics**: 10 requests per minute per IP

Rate limit headers are included in responses:
```bash
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1692803400
```

## 🧪 Testing the API

### Health Check Test
```bash
curl -f http://localhost:8080/health
# Expected: HTTP 200 with JSON response
```

### Authentication Test
```bash
curl -H "Authorization: Bearer invalid-key" \
  http://localhost:8080/api/status
# Expected: HTTP 401 Unauthorized
```

### Valid Sync Test
```bash
curl -X POST http://localhost:8080/api/sync \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"platform": "meta", "mode": "incremental", "entities": ["campaigns"], "lookbackHours": 1}'
# Expected: HTTP 200 with sync results
```

---

*For more examples and advanced usage, see the [GitHub Actions workflows](../setup/github-actions.md) that demonstrate real-world API usage patterns.*