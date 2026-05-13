import MetaAdsClient from './client';
import SupabaseLoader from '@/loaders/supabase-client';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/error-handler';
import { MetaAdCreative } from '@/utils/types';

interface CreativeOwner {
  adId: string;
  campaignId: string | null;
  adsetId: string | null;
}

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

  async extractAllCreatives(): Promise<MetaAdCreative[]> {
    logger.info('Starting Meta creatives extraction');

    const ownerMap = await this.buildCreativeOwnerMap();
    const creativeIds = Array.from(ownerMap.keys());

    logger.info('Loaded creative ownership map from meta_ads_ads', {
      distinctCreativeIds: creativeIds.length
    });

    if (!creativeIds.length) {
      return [];
    }

    const rawCreatives = await this.client.getAdCreatives(creativeIds);
    logger.info(`Graph API returned ${rawCreatives.length} of ${creativeIds.length} requested creatives`);

    const transformed: MetaAdCreative[] = [];
    for (const raw of rawCreatives) {
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
    return transformed;
  }

  /**
   * Read every (ad_id, creative_id, ad_set_id, campaign_id) tuple from
   * marketing.meta_ads_ads where creative_id IS NOT NULL, and reduce to a
   * map keyed by creative_id. When multiple ads share a creative, prefer the
   * one with the most recent updated_time (falling back to created_time)
   * so the denormalized ad_id/adset_id/campaign_id columns reflect the
   * most current owner.
   */
  private async buildCreativeOwnerMap(): Promise<Map<string, CreativeOwner>> {
    const supabaseClient = this.supabase.getClient();

    // Paginate through marketing.meta_ads_ads to handle accounts larger than
    // Supabase's default 1000-row limit. Today we have ~443 ads — well under
    // one page — but this keeps the extractor robust as the account grows.
    const pageSize = 1000;
    let offset = 0;
    const rows: Array<{
      ad_id: string;
      creative_id: string | null;
      ad_set_id: string | null;
      campaign_id: string | null;
      updated_time: string | null;
      created_time: string | null;
    }> = [];

    while (true) {
      const { data, error } = await supabaseClient
        .schema('marketing')
        .from('meta_ads_ads')
        .select('ad_id, creative_id, ad_set_id, campaign_id, updated_time, created_time')
        .not('creative_id', 'is', null)
        .order('updated_time', { ascending: false, nullsFirst: false })
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
        // Rows are pre-sorted by updated_time DESC, so the first one wins.
        map.set(row.creative_id, {
          adId: row.ad_id,
          campaignId: row.campaign_id,
          adsetId: row.ad_set_id
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
