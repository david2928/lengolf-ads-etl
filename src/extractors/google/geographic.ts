import logger from '@/utils/logger';
import { appConfig } from '@/utils/config';
import { getErrorMessage } from '@/utils/error-handler';

export interface GoogleAdsGeographicPerformance {
  campaign_id: number;
  geo_target_constant: string;
  location_name: string;
  location_type: string;
  country_code: string;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  ctr: number;
  avg_cpc_micros: number;
}

export class GoogleAdsGeographicExtractor {
  private customerId: string;

  constructor() {
    this.customerId = appConfig.googleCustomerId;
  }

  async extractGeographicPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<GoogleAdsGeographicPerformance[]> {
    try {
      logger.info('Starting Google Ads geographic performance extraction', {
        customerId: this.customerId,
        startDate: startDate?.toISOString().split('T')[0],
        endDate: endDate?.toISOString().split('T')[0]
      });

      const defaultEndDate = endDate || new Date();
      const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const formattedStartDate = defaultStartDate.toISOString().split('T')[0];
      const formattedEndDate = defaultEndDate.toISOString().split('T')[0];

      let whereClause = `WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'`;

      if (modifiedSince && !startDate && !endDate) {
        const modifiedSinceFormatted = modifiedSince.toISOString().split('T')[0];
        whereClause += ` AND segments.date >= '${modifiedSinceFormatted}'`;
      }

      const gaql = `
        SELECT
          geographic_view.country_criterion_id,
          geographic_view.location_type,
          geographic_view.resource_name,
          campaign.id,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc
        FROM geographic_view
        ${whereClause}
        ORDER BY segments.date DESC, metrics.impressions DESC
      `;

      logger.debug('Executing GAQL query for geographic data', { gaql: gaql.trim() });

      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();
      const results = await adsClient.executeQuery(gaql);
      const performanceData: GoogleAdsGeographicPerformance[] = [];
      const uniqueKeys = new Set<string>();

      if (results.length > 0) {
        logger.debug('Sample geographic row structure', {
          sampleKeys: Object.keys(results[0]),
          sampleRow: JSON.stringify(results[0]).substring(0, 500)
        });
      }

      for (const row of results) {
        const campaignId = parseInt(row.campaign?.id?.toString() || '0');
        const date = row.segments?.date || '';

        // Extract location info from resource_name
        // Format: customers/{customer_id}/geographicViews/{country_criterion_id}~{location_type}
        const resourceName = row.geographic_view?.resource_name || row.geographicView?.resourceName || '';
        const resourceParts = resourceName.toString().split('/');
        const geoViewPart = resourceParts[resourceParts.length - 1] || '';
        const geoParts = geoViewPart.split('~');

        const countryCriterionId = row.geographic_view?.country_criterion_id || row.geographicView?.countryCriterionId || '';
        const locationType = (row.geographic_view?.location_type || row.geographicView?.locationType || '').toString().toLowerCase();

        // Use the first part of the resource as the geo target constant (criterion ID)
        const geoTargetConstant = geoParts[0] || countryCriterionId.toString() || '';

        if (!date || !geoTargetConstant) {
          continue;
        }

        // Deduplicate
        const uniqueKey = `${campaignId}:${geoTargetConstant}:${date}`;
        if (uniqueKeys.has(uniqueKey)) {
          continue;
        }
        uniqueKeys.add(uniqueKey);

        const data: GoogleAdsGeographicPerformance = {
          campaign_id: campaignId,
          geo_target_constant: geoTargetConstant,
          location_name: geoTargetConstant, // Will be enriched later with geo target constant API
          location_type: locationType,
          country_code: countryCriterionId.toString(),
          date,
          impressions: parseInt(row.metrics?.impressions?.toString() || '0'),
          clicks: parseInt(row.metrics?.clicks?.toString() || '0'),
          cost_micros: parseInt(row.metrics?.cost_micros?.toString() || '0'),
          conversions: parseFloat(row.metrics?.conversions?.toString() || '0'),
          conversion_value_micros: parseInt(row.metrics?.conversions_value?.toString() || '0'),
          ctr: parseFloat(row.metrics?.ctr?.toString() || '0'),
          avg_cpc_micros: parseInt(row.metrics?.average_cpc?.toString() || '0')
        };

        performanceData.push(data);
      }

      logger.info(`Extracted ${performanceData.length} Google Ads geographic performance records`, {
        dateRange: `${formattedStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Google Ads geographic performance', {
        customerId: this.customerId,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }
}

export default GoogleAdsGeographicExtractor;
