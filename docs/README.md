# Lengolf Ads ETL Documentation

Welcome to the comprehensive documentation for the Lengolf Ads ETL Service - a dedicated data extraction, transformation, and loading system for Google Ads and Meta Ads platforms.

## 📚 Documentation Index

### Quick Start
- [Installation & Setup](./setup/installation.md) - Get started with local development
- [GitHub Actions Deployment](./setup/github-actions.md) - Production deployment guide
- [Configuration](./setup/configuration.md) - Environment variables and settings

### Architecture & Design
- [System Architecture](./architecture/overview.md) - High-level system design
- [Database Schema](./architecture/database-schema.md) - Supabase table structures
- [API Reference](./api/endpoints.md) - REST API documentation
- [Data Flow](./architecture/data-flow.md) - ETL process explanation

### Platform Integration
- [Google Ads Integration](./integrations/google-ads.md) - OAuth setup and API usage
- [Meta Ads Integration](./integrations/meta-ads.md) - Facebook/Instagram ads integration
- [Supabase Integration](./integrations/supabase.md) - Database configuration

### Development
- [Local Development](./development/local-setup.md) - Development environment setup
- [Testing](./development/testing.md) - Unit and integration tests
- [Code Structure](./development/code-structure.md) - Project organization
- [Contributing](./development/contributing.md) - Development guidelines

### Operations
- [Monitoring](./operations/monitoring.md) - Health checks and metrics
- [Troubleshooting](./operations/troubleshooting.md) - Common issues and solutions
- [Performance Tuning](./operations/performance.md) - Optimization strategies
- [Security](./operations/security.md) - Security best practices

### Data Management
- [Data Models](./data/models.md) - Entity relationships and structures
- [Sync Strategies](./data/sync-strategies.md) - Incremental vs full sync
- [Data Quality](./data/quality.md) - Validation and integrity checks
- [Backup & Recovery](./data/backup-recovery.md) - Data protection strategies

## 🚀 Quick Overview

The Lengolf Ads ETL Service is a Node.js/TypeScript application that:

- **Extracts** advertising data from Google Ads and Meta Ads APIs
- **Transforms** raw API responses into structured, consistent formats
- **Loads** processed data into Supabase PostgreSQL database
- **Synchronizes** data automatically via GitHub Actions workflows
- **Provides** REST API endpoints for manual operations and monitoring

### Key Features

✅ **Automated OAuth Token Management** - Self-refreshing authentication  
✅ **Incremental Data Sync** - Efficient updates with change detection  
✅ **Comprehensive Performance Tracking** - Campaign, ad set, and keyword metrics  
✅ **Creative Asset Management** - Image, video, and text content extraction  
✅ **GitHub Actions Integration** - Zero-infrastructure automated scheduling  
✅ **Real-time Monitoring** - Health checks, metrics, and status reporting  
✅ **Multi-platform Support** - Google Ads and Meta Ads unified interface  

### System Requirements

- **Node.js**: 20.x or higher
- **Database**: Supabase PostgreSQL
- **Runtime**: GitHub Actions (Ubuntu latest)
- **APIs**: Google Ads API v21, Meta Marketing API v22.0

### Data Coverage

**Google Ads**:
- Campaigns, Ad Groups, Ads, Keywords
- Campaign & Keyword Performance Metrics
- Creative Assets and Extensions

**Meta Ads**:
- Campaigns, Ad Sets, Ads, Creatives
- Campaign & Ad Set Performance Insights
- Image, Video, and Text Creative Assets

### Architecture Highlights

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  GitHub Actions │────│  ETL Service     │────│  Supabase DB    │
│  - Scheduling   │    │  - Extract       │    │  - Marketing    │
│  - Workflows    │    │  - Transform     │    │    Schema       │
│  - Monitoring   │    │  - Load          │    │  - Performance  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              │
                    ┌─────────┴─────────┐
                    │                   │
            ┌───────▼────────┐  ┌──────▼─────────┐
            │  Google Ads    │  │  Meta Ads      │
            │  API v21       │  │  API v22.0     │
            └────────────────┘  └────────────────┘
```

## 🎯 Getting Started

1. **Choose Your Path**:
   - [Local Development](./development/local-setup.md) - For development and testing
   - [GitHub Actions](./setup/github-actions.md) - For production deployment

2. **Setup Authentication**:
   - [Google Ads OAuth](./integrations/google-ads.md#oauth-setup)
   - [Meta Ads OAuth](./integrations/meta-ads.md#oauth-setup)

3. **Configure Database**:
   - [Supabase Setup](./integrations/supabase.md#initial-setup)
   - [Schema Migration](./integrations/supabase.md#schema-setup)

4. **Deploy & Monitor**:
   - [GitHub Actions Workflows](./setup/github-actions.md#workflow-configuration)
   - [Monitoring Setup](./operations/monitoring.md#health-checks)

## 🔗 Quick Links

- **GitHub Repository**: [david2928/lengolf-ads-etl](https://github.com/david2928/lengolf-ads-etl)
- **Live Dashboard**: Supabase Marketing Schema
- **API Endpoints**: See [API Reference](./api/endpoints.md)
- **Support**: See [Troubleshooting Guide](./operations/troubleshooting.md)

## 📞 Support

For issues, questions, or contributions:

1. Check the [Troubleshooting Guide](./operations/troubleshooting.md)
2. Review [GitHub Issues](https://github.com/david2928/lengolf-ads-etl/issues)
3. Consult the [API Documentation](./api/endpoints.md)
4. Follow the [Contributing Guidelines](./development/contributing.md)

---

*This documentation is maintained alongside the codebase. Last updated: August 2025*