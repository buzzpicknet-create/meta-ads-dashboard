// Frontend API client for Meta Ads insights.
// All endpoints are served by @workspace/api-server under /api/meta/*

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  spend: number;
  purchases: number;
  cpa: number;
  impressions: number;
  link_clicks: number;
  ctr: number;
}

export interface CampaignsResponse {
  account_id?: string;
  period: { since: string; until: string };
  fetched_at: string;
  campaigns: CampaignSummary[];
}

export interface AccountCampaignsResponse {
  account_id?: string;
  period: { since: string; until: string };
  fetched_at: string;
  campaigns: CampaignSummary[];
}

export interface DerivedMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  lpv: number;
  purchases: number;
  v25: number;
  v50: number;
  v75: number;
  v95: number;
  v100: number;
  video_plays: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  lpvRate: number;
  crLpv: number;
  crClick: number;
  hookRate: number;
}

export interface DailyPoint {
  day: string;
  spend: number;
  impressions: number;
  link_clicks: number;
  lpv: number;
  purchases: number;
  cpa: number;
}

export interface SegmentEntry {
  key: string;
  id: string;
  label: string;
  spend: number;
  impressions: number;
  link_clicks: number;
  lpv: number;
  purchases: number;
  cpa: number;
  cpc: number;
  ctr: number;
  cr: number;
  hookRate: number;
}

export interface CampaignInsights {
  campaign: {
    id: string;
    name: string;
    status: string;
    effective_status: string;
    objective: string;
  };
  period: { since: string; until: string; days: number };
  totals: DerivedMetrics;
  daily: DailyPoint[];
  by_adset: SegmentEntry[];
  by_ad: SegmentEntry[];
  fetched_at: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export interface AdAccountSummary {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export interface AccountsResponse {
  accounts: AdAccountSummary[];
}

export interface TokenHealth {
  ok: boolean;
  token: {
    issued_at: string;
    expires_at: string;
    days_left: number;
    app_id: string;
    ad_account_id: string;
    needs_refresh: boolean;
  };
}

const API_BASE = "/api";

async function jsonFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const errMsg =
      (data as { error?: string })?.error ||
      `HTTP ${res.status}: ${text.slice(0, 200)}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export function fetchAccount(): Promise<AccountInfo> {
  return jsonFetch<AccountInfo>(`${API_BASE}/meta/account`);
}

export function fetchAccounts(): Promise<AccountsResponse> {
  return jsonFetch<AccountsResponse>(`${API_BASE}/meta/accounts`);
}

export function fetchTokenHealth(): Promise<TokenHealth> {
  return jsonFetch<TokenHealth>(`${API_BASE}/meta/health`);
}

export function fetchCampaigns(opts: {
  ad_account_id?: string;
  since: string;
  until: string;
}): Promise<CampaignsResponse> {
  const params = new URLSearchParams(opts);
  return jsonFetch<CampaignsResponse>(`${API_BASE}/meta/campaigns?${params}`);
}

export function fetchInsights(opts: {
  campaign_id: string;
  ad_account_id?: string;
  since: string;
  until: string;
}): Promise<CampaignInsights> {
  const params = new URLSearchParams(opts);
  return jsonFetch<CampaignInsights>(`${API_BASE}/meta/insights?${params}`);
}

export function fetchCampaignsForAccount(opts: {
  ad_account_id: string;
  since: string;
  until: string;
}): Promise<CampaignsResponse> {
  return fetchCampaigns(opts);
}

// ---- Date range helpers ----
export function todayCairoIso(): string {
  // Cairo = UTC+2 (no DST). Get current Cairo date.
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export function nDaysAgoIso(n: number): string {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export type DatePreset = "7d" | "14d" | "30d" | "yesterday";

export function rangeFromPreset(preset: DatePreset): {
  since: string;
  until: string;
} {
  const until = nDaysAgoIso(1); // yesterday (full-day data)
  let days = 7;
  if (preset === "14d") days = 14;
  else if (preset === "30d") days = 30;
  else if (preset === "yesterday") days = 1;
  const since = nDaysAgoIso(days);
  return { since, until };
}

export function formatRange(since: string, until: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(d)}/${Number(m)}`;
  };
  return `${fmt(since)} → ${fmt(until)}`;
}
