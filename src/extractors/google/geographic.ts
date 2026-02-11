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
          campaign.id,
          segments.date,
          segments.geo_target_city,
          segments.geo_target_region,
          segments.geo_target_country,
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

      for (const row of results) {
        const campaignId = parseInt(row.campaign?.id?.toString() || '0');
        const date = row.segments?.date || '';

        // Extract geo target constant - use city, region, or country
        const geoTargetCity = row.segments?.geoTargetCity || row.segments?.geo_target_city || '';
        const geoTargetRegion = row.segments?.geoTargetRegion || row.segments?.geo_target_region || '';
        const geoTargetCountry = row.segments?.geoTargetCountry || row.segments?.geo_target_country || '';

        // Use most specific available geo target
        const geoTargetConstant = geoTargetCity || geoTargetRegion || geoTargetCountry || '';

        // Extract location name from resource name (format: geoTargetConstants/XXXXX)
        const locationName = geoTargetConstant.split('/').pop() || geoTargetConstant;

        const locationType = (row.geographicView?.locationType || row.geographic_view?.location_type || '').toString().toLowerCase();
        const countryCriterionId = row.geographicView?.countryCriterionId || row.geographic_view?.country_criterion_id || '';

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
          geo_target_constant: locationName,
          location_name: locationName,
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
