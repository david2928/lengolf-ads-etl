import MetaAdsClient from './client';
import SupabaseLoader from '@/loaders/supabase-client';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';
import { MetaAdCreative } from '@/utils/types';

interface CreativeOwner {
  adId: string;
  campaignId: string | null;
  adsetId: string | null;
  updatedTime: string | null; // for recency tiebreak when multiple ads share a creative
}

export interface ExtractCreativesResult {
  creatives: MetaAdCreative[];
  requestedCreativeIds: number;
  receivedRawCreatives: number;
  // Number of creative_ids we asked Graph for but didn't get back — flows
  // into etl_sync_log.records_failed so a partial Graph response surfaces
  // as a "partial" sync status rather than a silent gap.
  missingFromGraph: number;
}

// Below this fraction of (received / requested) we treat the run as
// degraded enough to log a hard warning; the count still flows into
// records_failed regardless.
const PARTIAL_RESPONSE_WARN_RATIO = 0.9;

/**
 * Extractor for marketing.meta_ads_ad_creatives.
 *
 * The Meta ads sync runs immediately before the creatives sync in every GH
 * Actions workflow, so marketing.meta_ads_ads is the authoritative list of
 * (ad → creative_id) mappings for the current account at extraction time.
 *
 * Coverage strategy: sweep ALL distinct creative_ids from meta_ads_ads on
 * every run, regardless of mode. The universe is small (~411 distinct
 * creatives across 443 ads as of 2026-05-13), batch size is 50, so a full
 * sweep is ~9 round-trips — date filtering is not worth the complexity and
 * has historically caused gaps (see CREATIVE_SYNC_ANALYSIS.md).
 */
export class MetaCreativesExtractor {
  private client: MetaAdsClient;
  private supabase: SupabaseLoader;

  constructor(supabase: SupabaseLoader) {
    this.client = new MetaAdsClient();
    this.supabase = supabase;
  }

  async extractAllCreatives(): Promise<ExtractCreativesResult> {
    logger.info('Starting Meta creatives extraction');

    const ownerMap = await this.buildCreativeOwnerMap();
    const creativeIds = Array.from(ownerMap.keys());

    logger.info('Loaded creative ownership map from meta_ads_ads', {
      distinctCreativeIds: creativeIds.length
    });

    if (!creativeIds.length) {
      return {
        creatives: [],
        requestedCreativeIds: 0,
        receivedRawCreatives: 0,
        missingFromGraph: 0
      };
    }

    const rawCreatives = await this.client.getAdCreatives(creativeIds);
    const missing = creativeIds.length - rawCreatives.length;
    const ratio = rawCreatives.length / creativeIds.length;

    logger.info(`Graph API returned ${rawCreatives.length} of ${creativeIds.length} requested creatives`);

    if (missing > 0) {
      // getAdCreatives() swallows per-batch failures and continues; this is
      // how we surface them. Anything below the warn ratio gets a hard log
      // so it shows up in the daily report.
      const level = ratio < PARTIAL_RESPONSE_WARN_RATIO ? 'warn' : 'info';
      const msg = `Meta Graph returned a partial creative set — ${missing} of ${creativeIds.length} missing`;
      if (level === 'warn') {
        logger.warn(msg, { missing, requested: creativeIds.length, ratio });
      } else {
        logger.info(msg, { missing, requested: creativeIds.length, ratio });
      }
    }

    const transformed: MetaAdCreative[] = [];
    for (const raw of rawCreatives) {
      // Guard: Graph occasionally returns malformed stubs (e.g. when a
      // creative was hard-deleted between the meta_ads_ads sync and now).
      // `creative_id` is NOT NULL in the target table so writing undefined
      // would fail the entire upsert batch.
      if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
        logger.warn('Skipping malformed creative response from Graph', { raw });
        continue;
      }

      try {
        const owner = ownerMap.get(raw.id);
        if (!owner) {
          // Should not happen — Graph returned an ID we didn't request.
          logger.warn('Skipping creative with no owner in meta_ads_ads', { creativeId: raw.id });
          continue;
        }
        transformed.push(this.transformCreative(raw, owner));
      } catch (error) {
        logger.error('Failed to transform creative', {
          creativeId: raw?.id,
          error: getErrorMessage(error)
        });
      }
    }

    logger.info(`Transformed ${transformed.length} Meta creatives ready for upsert`);

    return {
      creatives: transformed,
      requestedCreativeIds: creativeIds.length,
      receivedRawCreatives: rawCreatives.length,
      missingFromGraph: missing
    };
  }

  /**
   * Read every (ad_id, creative_id, ad_set_id, campaign_id, updated_time)
   * tuple from marketing.meta_ads_ads where creative_id IS NOT NULL, and
   * reduce to a map keyed by creative_id. When multiple ads share a
   * creative, prefer the one with the most recent updated_time so the
   * denormalized ad_id/adset_id/campaign_id columns reflect the most
   * current owner.
   *
   * Pagination orders by `ad_id ASC` (a stable, immutable PK) rather than
   * updated_time so concurrent writes to meta_ads_ads can't shift rows
   * across page boundaries during the sweep. The recency tiebreak happens
   * in JS after all pages are collected.
   */
  private async buildCreativeOwnerMap(): Promise<Map<string, CreativeOwner>> {
    const supabaseClient = this.supabase.getClient();

    const pageSize = 1000;
    let offset = 0;
    const rows: Array<{
      ad_id: string;
      creative_id: string | null;
      ad_set_id: string | null;
      campaign_id: string | null;
      updated_time: string | null;
    }> = [];

    while (true) {
      const { data, error } = await supabaseClient
        .schema('marketing')
        .from('meta_ads_ads')
        .select('ad_id, creative_id, ad_set_id, campaign_id, updated_time')
        .not('creative_id', 'is', null)
        // Stable pagination key — ad_id is the PK and never changes.
        .order('ad_id', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Failed to read meta_ads_ads for creative ownership: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      rows.push(...data);

      if (data.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    const map = new Map<string, CreativeOwner>();
    for (const row of rows) {
      if (!row.creative_id) continue;

      const existing = map.get(row.creative_id);
      if (!existing) {
        map.set(row.creative_id, {
          adId: row.ad_id,
          campaignId: row.campaign_id,
          adsetId: row.ad_set_id,
          updatedTime: row.updated_time
        });
        continue;
      }

      // Recency tiebreak: keep whichever ad's updated_time is newer.
      // Null updated_time is treated as oldest so it loses to any
      // non-null candidate.
      const existingT = existing.updatedTime ?? '';
      const candidateT = row.updated_time ?? '';
      if (candidateT > existingT) {
        map.set(row.creative_id, {
          adId: row.ad_id,
          campaignId: row.campaign_id,
          adsetId: row.ad_set_id,
          updatedTime: row.updated_time
        });
      }
    }

    return map;
  }

  private transformCreative(creative: any, owner: CreativeOwner): MetaAdCreative {
    const now = new Date().toISOString();
    const objectType: string | null = creative.object_type ?? null;
    const videoId: string | null = creative.video_id ?? null;

    return {
      creative_id: creative.id,
      ad_id: owner.adId,
      campaign_id: owner.campaignId,
      adset_id: owner.adsetId,
      creative_name: creative.name ?? null,
      creative_status: creative.status ?? null,
      creative_type: objectType,
      image_url: creative.image_url ?? null,
      thumbnail_url: creative.thumbnail_url ?? null,
      preview_url: creative.template_url ?? null,
      video_url: videoId ? `https://www.facebook.com/video.php?v=${videoId}` : null,
      title: creative.title ?? null,
      body: creative.body ?? null,
      call_to_action_type: creative.call_to_action_type ?? null,
      link_url: this.resolveLinkUrl(creative),
      display_link: creative.link_destination_display_url ?? null,
      carousel_data: this.buildCarouselData(creative.asset_feed_spec),
      image_hash: creative.image_hash ?? null,
      video_id: videoId,
      creative_json: creative,
      created_at: now,
      updated_at: now,
      last_synced_at: now
    };
  }

  /**
   * Prefer the website_url of the first link in asset_feed_spec.link_urls,
   * fall back to the top-level link_url field, then template_url. Engagement
   * ads (page-post promotions) have no link and will yield null — that's
   * expected and the table allows it.
   */
  private resolveLinkUrl(creative: any): string | null {
    const feedLink = creative?.asset_feed_spec?.link_urls?.[0]?.website_url;
    if (typeof feedLink === 'string' && feedLink.length > 0) {
      return feedLink;
    }
    if (typeof creative?.link_url === 'string' && creative.link_url.length > 0) {
      return creative.link_url;
    }
    if (typeof creative?.template_url === 'string' && creative.template_url.length > 0) {
      return creative.template_url;
    }
    return null;
  }

  /**
   * Pack multi-asset spec (bodies, titles, link_urls) into the carousel_data
   * jsonb column when the creative has more than one of any of them. Single-
   * asset creatives return null so the column stays cheap to filter on.
   */
  private buildCarouselData(assetFeedSpec: any): any | null {
    if (!assetFeedSpec || typeof assetFeedSpec !== 'object') {
      return null;
    }

    const bodies = Array.isArray(assetFeedSpec.bodies) ? assetFeedSpec.bodies : [];
    const titles = Array.isArray(assetFeedSpec.titles) ? assetFeedSpec.titles : [];
    const linkUrls = Array.isArray(assetFeedSpec.link_urls) ? assetFeedSpec.link_urls : [];

    const isMultiAsset = bodies.length > 1 || titles.length > 1 || linkUrls.length > 1;
    if (!isMultiAsset) {
      return null;
    }

    return {
      bodies,
      titles,
      link_urls: linkUrls
    };
  }
}

export default MetaCreativesExtractor;
