import logger from '@/utils/logger';
import { appConfig } from '@/utils/config';
import { getErrorMessage } from '@/utils/error-handler';

export interface GoogleAdsSearchTermPerformance {
  search_term: string;
  campaign_id: number;
  ad_group_id: number;
  keyword_id: number;
  match_type: string;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  ctr: number;
  avg_cpc_micros: number;
}

export class GoogleAdsSearchTermsExtractor {
  private customerId: string;

  constructor() {
    this.customerId = appConfig.googleCustomerId;
  }

  async extractSearchTermPerformance(
    startDate?: Date,
    endDate?: Date,
    modifiedSince?: Date
  ): Promise<GoogleAdsSearchTermPerformance[]> {
    try {
      logger.info('Starting Google Ads search term performance extraction', {
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
          search_term_view.search_term,
          search_term_view.resource_name,
          search_term_view.status,
          campaign.id,
          ad_group.id,
          segments.date,
          segments.search_term_match_type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc
        FROM search_term_view
        ${whereClause}
        ORDER BY segments.date DESC, metrics.impressions DESC
      `;

      logger.debug('Executing GAQL query for search terms', { gaql: gaql.trim() });

      const GoogleAdsClient = (await import('./client')).default;
      const adsClient = new GoogleAdsClient();
      const results = await adsClient.executeQuery(gaql);
      const performanceData: GoogleAdsSearchTermPerformance[] = [];
      const uniqueKeys = new Set<string>();

      if (results.length > 0) {
        logger.debug('Sample search term row structure', {
          sampleKeys: Object.keys(results[0]),
          sampleRow: JSON.stringify(results[0]).substring(0, 500)
        });
      }

      for (const row of results) {
        const searchTerm = row.search_term_view?.search_term || row.searchTermView?.searchTerm || '';
        const campaignId = parseInt(row.campaign?.id?.toString() || '0');
        const adGroupId = parseInt(row.ad_group?.id?.toString() || row.adGroup?.id?.toString() || '0');
        const date = row.segments?.date || '';

        // Skip records with missing required fields
        if (!searchTerm || !date) {
          continue;
        }

        // Deduplicate
        const uniqueKey = `${searchTerm}:${campaignId}:${adGroupId}:${date}`;
        if (uniqueKeys.has(uniqueKey)) {
          continue;
        }
        uniqueKeys.add(uniqueKey);

        // Extract keyword criterion ID from resource name
        // Format: customers/{customer_id}/searchTermViews/{campaign_id}~{ad_group_id}~{query_hash}
        const resourceName = row.search_term_view?.resource_name || row.searchTermView?.resourceName || '';
        const resourceParts = resourceName.toString().split('~');
        const keywordId = resourceParts.length > 1 ? parseInt(resourceParts[1]) || 0 : 0;

        const rawMatchType = row.segments?.search_term_match_type || row.segments?.searchTermMatchType || '';
        const matchType = String(rawMatchType).toLowerCase();

        const data: GoogleAdsSearchTermPerformance = {
          search_term: searchTerm,
          campaign_id: campaignId,
          ad_group_id: adGroupId,
          keyword_id: keywordId,
          match_type: matchType,
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

      logger.info(`Extracted ${performanceData.length} Google Ads search term records`, {
        dateRange: `${formattedStartDate} to ${formattedEndDate}`,
        recordCount: performanceData.length
      });

      return performanceData;

    } catch (error) {
      logger.error('Failed to extract Google Ads search term performance', {
        customerId: this.customerId,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }
}

export default GoogleAdsSearchTermsExtractor;
