// Common types for the ETL service

export interface SyncRequest {
  platform?: 'google' | 'meta' | 'all';
  mode: 'incremental' | 'full';
  entities: string[];
  lookbackHours?: number;
  lookbackDays?: number;
  startDate?: string;
  endDate?: string;
}

export interface SyncResult {
  batchId: string;
  platform: string;
  entityType: string;
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsFailed: number;
  duration: number;
  status: 'completed' | 'failed' | 'partial';
  errorMessage?: string;
}

export interface SyncState {
  platform: string;
  entity_type: string;
  last_sync_time: Date;
  last_modified_time?: Date;
  next_page_token?: string;
  sync_status: string;
  error_message?: string;
}

export interface BatchResult {
  inserted: number;
  updated: number;
  failed: number;
}

export interface CreativeAsset {
  platform: 'google' | 'meta';
  platform_asset_id: string;
  ad_id: string;
  creative_id?: string;
  asset_type: string;
  asset_url?: string;
  thumbnail_url?: string;
  preview_url?: string;
  width?: number;
  height?: number;
  file_size_bytes?: number;
  duration_seconds?: number;
  mime_type?: string;
  approval_status?: string;
  policy_review_status?: string;
  text_content?: string;
  call_to_action_type?: string;
  link_url?: string;
}

export interface AdWithCreatives {
  ad: GoogleAd | MetaAd;
  creativeAssets?: CreativeAsset[];
}

export interface GoogleAd {
  ad_id: string;
  ad_group_id: string;
  campaign_id: string;
  ad_name?: string;
  ad_status: string;
  ad_type: string;
  headline1?: string;
  headline2?: string;
  headline3?: string;
  description1?: string;
  description2?: string;
  final_url?: string;
  final_mobile_url?: string;
  display_url?: string;
  headlines?: any[];
  descriptions?: any[];
  image_assets?: any[];
  video_assets?: any[];
  ad_strength?: string;
  creative_json?: any;
}

export interface MetaAd {
  ad_id: string;
  ad_set_id: string;
  campaign_id: string;
  ad_name: string;
  ad_status: string;
  creative_id?: string;
  bid_amount?: number;
  source_ad_id?: string;
  created_time?: string;
  updated_time?: string;
  tracking_specs?: any;
  conversion_specs?: any;
  created_at: string;
  updated_at: string;
}

export interface MetaCampaign {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  objective?: string;
  buying_type?: string;
  bid_strategy?: string;
  daily_budget?: number;
  lifetime_budget?: number;
  budget_remaining?: number;
  spend_cap?: number;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
  can_use_spend_cap: boolean;
  created_at: string;
  updated_at: string;
}

export interface MetaAdSet {
  ad_set_id: string;
  campaign_id: string;
  ad_set_name: string;
  ad_set_status: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  bid_amount?: number;
  daily_budget?: number;
  lifetime_budget?: number;
  budget_remaining?: number;
  start_time?: string;
  end_time?: string;
  created_time?: string;
  updated_time?: string;
  targeting?: any;
  promoted_object?: any;
  attribution_spec?: any;
  created_at: string;
  updated_at: string;
}

export interface MetaCreative {
  creative_id: string;
  ad_id: string;
  campaign_id?: string;
  adset_id?: string;
  creative_name?: string;
  creative_status?: string;
  creative_type?: string;
  title?: string;
  body?: string;
  image_url?: string;
  thumbnail_url?: string;
  preview_url?: string;
  video_url?: string;
  call_to_action_type?: string;
  link_url?: string;
  display_link?: string;
  carousel_data?: any;
  image_hash?: string;
  video_id?: string;
  creative_json?: any;
}

export interface CreativeWithAssets {
  creative: MetaCreative;
  assets: CreativeAsset[];
}

export interface QualityCheck {
  checkType: string;
  tableName: string;
  passed: boolean;
  result: any;
  message: string;
}

export interface QualityReport {
  batchId: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: QualityCheck[];
  overallStatus: 'PASSED' | 'FAILED';
}

export interface TokenData {
  platform: string;
  access_token: string;
  refresh_token?: string;
  expires_at: Date;
  token_type?: string;
  scope?: string;
}

export interface SyncParams {
  modifiedSince: Date;
  pageToken?: string;
}