import { getAccessToken, getAdAccountId, getAdAccountIds } from "./meta-token";
import { logger } from "./logger";

const API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

interface FbActionEntry {
  action_type: string;
  value: string;
  "1d_click"?: string;
}

interface FbInsightRow {
  date_start?: string;
  date_stop?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  impressions?: string;
  reach?: string;
  spend?: string;
  clicks?: string;
  inline_link_clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: FbActionEntry[];
  action_values?: FbActionEntry[];
  video_play_actions?: FbActionEntry[];
  video_p25_watched_actions?: FbActionEntry[];
  video_p50_watched_actions?: FbActionEntry[];
  video_p75_watched_actions?: FbActionEntry[];
  video_p95_watched_actions?: FbActionEntry[];
  video_p100_watched_actions?: FbActionEntry[];
}

interface FbApiError {
  message: string;
  type: string;
  code: number;
  fbtrace_id?: string;
}

interface FbApiResponse<T> {
  data?: T[];
  paging?: { next?: string };
  error?: FbApiError;
}

async function fbGet<T>(
  pathOrUrl: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(`${BASE_URL}${pathOrUrl}`);
  url.searchParams.set("access_token", getAccessToken());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const allRows: T[] = [];
  let nextUrl: string | undefined = url.toString();
  let pageCount = 0;

  while (nextUrl && pageCount < 50) {
    const res = await fetch(nextUrl);
    const json = (await res.json()) as FbApiResponse<T>;
    if (json.error) {
      throw new Error(
        `Meta API error (${json.error.code}): ${json.error.message}`,
      );
    }
    if (json.data) allRows.push(...json.data);
    nextUrl = json.paging?.next;
    pageCount++;
  }

  return allRows;
}

// Default: reads the "value" field (Meta's default attribution window for the account)
function actionVal(actions: FbActionEntry[] | undefined, type: string): number {
  if (!actions) return 0;
  const e = actions.find((a) => a.action_type === type);
  if (!e) return 0;
  return Number(e.value) || 0;
}

// 1d_click only: reads the "1d_click" field returned when ATTRIBUTION_WINDOW includes multiple windows.
// If the field is absent, Meta means 0 conversions for that window — do NOT fall back to "value".
function actionVal1dClick(actions: FbActionEntry[] | undefined, type: string): number {
  if (!actions) return 0;
  const e = actions.find((a) => a.action_type === type);
  if (!e) return 0;
  if (e["1d_click"] === undefined) return 0; // absent = 0 for 1d_click window
  return Number(e["1d_click"]) || 0;
}

function purchaseCount(row: FbInsightRow): number {
  // Use 1d_click attribution for all purchase-type conversions
  return (
    actionVal1dClick(row.actions, "purchase") ||
    actionVal1dClick(row.actions, "omni_purchase") ||
    actionVal1dClick(row.actions, "offsite_conversion.fb_pixel_purchase") ||
    0
  );
}

function lpvCount(row: FbInsightRow): number {
  return (
    actionVal(row.actions, "landing_page_view") ||
    actionVal(row.actions, "omni_landing_page_view") ||
    0
  );
}

function linkClickCount(row: FbInsightRow): number {
  const inline = Number(row.inline_link_clicks || 0);
  if (inline > 0) return inline;
  return actionVal(row.actions, "link_click");
}

interface AggregatedMetrics {
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
}

function emptyMetrics(): AggregatedMetrics {
  return {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    link_clicks: 0,
    lpv: 0,
    purchases: 0,
    v25: 0,
    v50: 0,
    v75: 0,
    v95: 0,
    v100: 0,
    video_plays: 0,
  };
}

function addRow(acc: AggregatedMetrics, row: FbInsightRow): void {
  acc.spend += Number(row.spend || 0);
  acc.impressions += Number(row.impressions || 0);
  acc.reach += Number(row.reach || 0);
  acc.clicks += Number(row.clicks || 0);
  acc.link_clicks += linkClickCount(row);
  acc.lpv += lpvCount(row);
  acc.purchases += purchaseCount(row);
  acc.v25 += actionVal(row.video_p25_watched_actions, "video_view");
  acc.v50 += actionVal(row.video_p50_watched_actions, "video_view");
  acc.v75 += actionVal(row.video_p75_watched_actions, "video_view");
  acc.v95 += actionVal(row.video_p95_watched_actions, "video_view");
  acc.v100 += actionVal(row.video_p100_watched_actions, "video_view");
  acc.video_plays += actionVal(row.video_play_actions, "video_view");
}

export interface DerivedMetrics extends AggregatedMetrics {
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  lpvRate: number;
  crLpv: number;
  crClick: number;
  hookRate: number;
  frequency: number;
}

export function derive(m: AggregatedMetrics): DerivedMetrics {
  return {
    ...m,
    ctr: m.impressions ? (m.link_clicks / m.impressions) * 100 : 0,
    cpc: m.link_clicks ? m.spend / m.link_clicks : 0,
    cpm: m.impressions ? (m.spend / m.impressions) * 1000 : 0,
    cpa: m.purchases ? m.spend / m.purchases : 0,
    lpvRate: m.link_clicks ? (m.lpv / m.link_clicks) * 100 : 0,
    crLpv: m.lpv ? (m.purchases / m.lpv) * 100 : 0,
    crClick: m.link_clicks ? (m.purchases / m.link_clicks) * 100 : 0,
    hookRate: m.impressions ? (m.video_plays / m.impressions) * 100 : 0,
    frequency: m.reach > 0 ? m.impressions / m.reach : 0,
  };
}

// Request all 3 windows so Meta returns per-window breakdown fields (1d_click, 7d_click, 1d_view).
// When a window's field is absent from the response, Meta means its value is 0.
const ATTRIBUTION_WINDOW = '["1d_click","7d_click","1d_view"]';

const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "impressions",
  "reach",
  "spend",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "actions",
  "action_values",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
].join(",");

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

export interface AdAccountSummary {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export async function listCampaigns(opts: {
  since: string;
  until: string;
  adAccountId?: string;
}): Promise<CampaignSummary[]> {
  const rawAccount = opts.adAccountId || getAdAccountId();
  const adAccount = rawAccount.startsWith("act_")
    ? rawAccount.slice(4)
    : rawAccount;

  // 1) Fetch all campaigns metadata (include archived/deleted for activity name-lookup)
  const campaigns = await fbGet<{
    id: string;
    name: string;
    status: string;
    effective_status: string;
    objective: string;
  }>(`/act_${adAccount}/campaigns`, {
    fields: "id,name,status,effective_status,objective",
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "CAMPAIGN_PAUSED"] }]),
    limit: "500",
  });

  // 2) Fetch insights at campaign level for the period
  const time_range = JSON.stringify({ since: opts.since, until: opts.until });
  const insights = await fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
    level: "campaign",
    time_range,
    fields: INSIGHT_FIELDS,
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "200",
  });

  const insightMap = new Map<string, AggregatedMetrics>();
  for (const row of insights) {
    if (!row.campaign_id) continue;
    const cur = insightMap.get(row.campaign_id) ?? emptyMetrics();
    addRow(cur, row);
    insightMap.set(row.campaign_id, cur);
  }

  return campaigns.map((c) => {
    const m = insightMap.get(c.id) ?? emptyMetrics();
    const d = derive(m);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      objective: c.objective,
      spend: m.spend,
      purchases: m.purchases,
      cpa: d.cpa,
      cpm: d.cpm,
      frequency: d.frequency,
      impressions: m.impressions,
      reach: m.reach,
      link_clicks: m.link_clicks,
      ctr: d.ctr,
    };
  });
}

export interface DailyPoint {
  day: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  link_clicks: number;
  lpv: number;
  purchases: number;
  cpa: number;
}

export interface AdIssue {
  error_code: number;
  error_message: string;
  level: "AD" | "ADSET" | "CAMPAIGN";
  summary: string;
  type?: string;
}

export interface SegmentEntry {
  key: string;
  id: string;
  label: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  link_clicks: number;
  lpv: number;
  purchases: number;
  cpa: number;
  cpm: number;
  cpc: number;
  ctr: number;
  cr: number;
  hookRate: number;
  effective_status?: string;
  issues?: AdIssue[];
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

function daysBetween(since: string, until: string): number {
  const a = new Date(since + "T00:00:00Z").getTime();
  const b = new Date(until + "T00:00:00Z").getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

export async function getCampaignInsights(opts: {
  campaign_id: string;
  since: string;
  until: string;
}): Promise<CampaignInsights> {
  const time_range = JSON.stringify({ since: opts.since, until: opts.until });

  // 1) Campaign metadata
  const meta = (await fbGet<{
    id: string;
    name: string;
    status: string;
    effective_status: string;
    objective: string;
  }>(`/${opts.campaign_id}`, {
    fields: "id,name,status,effective_status,objective",
  })) as unknown as {
    id: string;
    name: string;
    status: string;
    effective_status: string;
    objective: string;
  };

  // The /{id} endpoint doesn't paginate / wrap in data; refetch as single object
  const metaUrl = new URL(`${BASE_URL}/${opts.campaign_id}`);
  metaUrl.searchParams.set("access_token", getAccessToken());
  metaUrl.searchParams.set(
    "fields",
    "id,name,status,effective_status,objective",
  );
  const metaRes = await fetch(metaUrl.toString());
  const metaJson = (await metaRes.json()) as {
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    objective?: string;
    error?: FbApiError;
  };
  if (metaJson.error) {
    throw new Error(`Meta API error: ${metaJson.error.message}`);
  }
  const campaign = {
    id: metaJson.id || opts.campaign_id,
    name: metaJson.name || "(unknown)",
    status: metaJson.status || "UNKNOWN",
    effective_status: metaJson.effective_status || "UNKNOWN",
    objective: metaJson.objective || "UNKNOWN",
  };

  // 2) Daily campaign totals (time_increment=1)
  const dailyRows = await fbGet<FbInsightRow>(
    `/${opts.campaign_id}/insights`,
    {
      level: "campaign",
      time_range,
      time_increment: "1",
      fields: INSIGHT_FIELDS,
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "200",
    },
  );

  // 3) Ad-level rows (we'll roll these up to adset / ad)
  const adRows = await fbGet<FbInsightRow>(`/${opts.campaign_id}/insights`, {
    level: "ad",
    time_range,
    fields: INSIGHT_FIELDS,
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "500",
  });

  // 4) Ad delivery status & issues (effective_status, issues_info)
  const adDeliveryRaw = await fbGet<{
    id: string;
    effective_status?: string;
    issues_info?: AdIssue[];
  }>(`/${opts.campaign_id}/ads`, {
    fields: "id,effective_status,issues_info",
    limit: "500",
  });
  const adDeliveryMap = new Map<string, { effective_status?: string; issues?: AdIssue[] }>();
  for (const ad of adDeliveryRaw) {
    adDeliveryMap.set(ad.id, {
      effective_status: ad.effective_status,
      issues: ad.issues_info ?? [],
    });
  }

  // ---- Aggregate totals from daily rows (most reliable)
  const totalsAcc = emptyMetrics();
  for (const row of dailyRows) addRow(totalsAcc, row);
  const totals = derive(totalsAcc);

  // ---- Daily series
  const daily: DailyPoint[] = dailyRows
    .filter((r) => r.date_start)
    .sort((a, b) => (a.date_start! < b.date_start! ? -1 : 1))
    .map((r) => {
      const acc = emptyMetrics();
      addRow(acc, r);
      const d = derive(acc);
      return {
        day: r.date_start!,
        spend: acc.spend,
        impressions: acc.impressions,
        reach: acc.reach,
        frequency: d.frequency,
        link_clicks: acc.link_clicks,
        lpv: acc.lpv,
        purchases: acc.purchases,
        cpa: d.cpa,
      };
    });

  // ---- Roll up by adset
  const adsetMap = new Map<
    string,
    { name: string; metrics: AggregatedMetrics }
  >();
  for (const row of adRows) {
    if (!row.adset_id) continue;
    const cur = adsetMap.get(row.adset_id) ?? {
      name: row.adset_name || row.adset_id,
      metrics: emptyMetrics(),
    };
    addRow(cur.metrics, row);
    adsetMap.set(row.adset_id, cur);
  }
  const by_adset: SegmentEntry[] = [...adsetMap.entries()]
    .map(([id, v]) => {
      const d = derive(v.metrics);
      return {
        key: id,
        id,
        label: v.name,
        spend: v.metrics.spend,
        impressions: v.metrics.impressions,
        reach: v.metrics.reach,
        frequency: d.frequency,
        link_clicks: v.metrics.link_clicks,
        lpv: v.metrics.lpv,
        purchases: v.metrics.purchases,
        cpa: d.cpa,
        cpm: d.cpm,
        cpc: d.cpc,
        ctr: d.ctr,
        cr: d.crLpv,
        hookRate: d.hookRate,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // ---- By ad
  const adMap = new Map<string, { name: string; metrics: AggregatedMetrics }>();
  for (const row of adRows) {
    if (!row.ad_id) continue;
    const cur = adMap.get(row.ad_id) ?? {
      name: row.ad_name || row.ad_id,
      metrics: emptyMetrics(),
    };
    addRow(cur.metrics, row);
    adMap.set(row.ad_id, cur);
  }
  const by_ad: SegmentEntry[] = [...adMap.entries()]
    .map(([id, v]) => {
      const d = derive(v.metrics);
      const delivery = adDeliveryMap.get(id);
      return {
        key: id,
        id,
        label: v.name,
        spend: v.metrics.spend,
        impressions: v.metrics.impressions,
        reach: v.metrics.reach,
        frequency: d.frequency,
        link_clicks: v.metrics.link_clicks,
        lpv: v.metrics.lpv,
        purchases: v.metrics.purchases,
        cpa: d.cpa,
        cpm: d.cpm,
        cpc: d.cpc,
        ctr: d.ctr,
        cr: d.crLpv,
        hookRate: d.hookRate,
        effective_status: delivery?.effective_status,
        issues: delivery?.issues ?? [],
      };
    })
    .sort((a, b) => b.spend - a.spend);

  logger.info(
    {
      campaign_id: opts.campaign_id,
      days: daysBetween(opts.since, opts.until),
      daily_rows: dailyRows.length,
      ad_rows: adRows.length,
      total_spend: totalsAcc.spend,
    },
    "Fetched campaign insights",
  );

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      effective_status: campaign.effective_status,
      objective: campaign.objective,
    },
    period: {
      since: opts.since,
      until: opts.until,
      days: daysBetween(opts.since, opts.until),
    },
    totals,
    daily,
    by_adset,
    by_ad,
    fetched_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────
// Account Overview (for the multi-account overview page)
// ──────────────────────────────────────────────────────────────

export interface CampaignSummaryFull {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  spend: number;
  purchases: number;
  cpa: number;
  impressions: number;
  reach: number;
  frequency: number;
  link_clicks: number;
  lpv: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cr: number;
}

export interface AdWithIssues {
  id: string;
  name: string;
  campaign_id: string;
  campaign_name?: string;
  effective_status?: string;
  issues: AdIssue[];
}

export interface AccountOverview {
  account_id: string;
  period: { since: string; until: string; days: number };
  totals: DerivedMetrics;
  prev_totals: DerivedMetrics;
  daily: DailyPoint[];
  campaigns: CampaignSummaryFull[];
  ad_issues: AdWithIssues[];
  fetched_at: string;
}

export async function getAccountOverview(opts: {
  adAccountId: string;
  since: string;
  until: string;
}): Promise<AccountOverview> {
  const rawAccount = opts.adAccountId;
  const adAccount = rawAccount.startsWith("act_")
    ? rawAccount.slice(4)
    : rawAccount;

  const time_range = JSON.stringify({ since: opts.since, until: opts.until });
  const days = daysBetween(opts.since, opts.until);

  // Previous period (same length, right before since)
  const prevUntil = new Date(new Date(opts.since + "T00:00:00Z").getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const prevSince = new Date(new Date(opts.since + "T00:00:00Z").getTime() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  const prev_time_range = JSON.stringify({ since: prevSince, until: prevUntil });

  // Fetch campaigns metadata
  const campaigns = await fbGet<{
    id: string;
    name: string;
    status: string;
    effective_status: string;
    objective: string;
  }>(`/act_${adAccount}/campaigns`, {
    fields: "id,name,status,effective_status,objective",
    limit: "200",
  });

  // Fetch current period campaign-level insights
  const insightRows = await fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
    level: "campaign",
    time_range,
    fields: INSIGHT_FIELDS,
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "200",
  });

  // Fetch daily account-level insights (time_increment=1, level=account)
  const dailyRows = await fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
    level: "account",
    time_range,
    time_increment: "1",
    fields: [
      "impressions",
      "reach",
      "spend",
      "clicks",
      "inline_link_clicks",
      "actions",
      "video_play_actions",
    ].join(","),
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "200",
  });

  // Fetch previous period totals for comparison
  const prevRows = await fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
    level: "account",
    time_range: prev_time_range,
    fields: [
      "impressions",
      "reach",
      "spend",
      "clicks",
      "inline_link_clicks",
      "actions",
      "video_play_actions",
    ].join(","),
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "200",
  });

  // Aggregate current totals
  const totalsAcc = emptyMetrics();
  for (const row of insightRows) addRow(totalsAcc, row);
  const totals = derive(totalsAcc);

  // Aggregate prev totals
  const prevAcc = emptyMetrics();
  for (const row of prevRows) addRow(prevAcc, row);
  const prev_totals = derive(prevAcc);

  // Per-campaign metrics
  const insightMap = new Map<string, AggregatedMetrics>();
  for (const row of insightRows) {
    if (!row.campaign_id) continue;
    const cur = insightMap.get(row.campaign_id) ?? emptyMetrics();
    addRow(cur, row);
    insightMap.set(row.campaign_id, cur);
  }

  const campaignsFull: CampaignSummaryFull[] = campaigns.map((c) => {
    const m = insightMap.get(c.id) ?? emptyMetrics();
    const d = derive(m);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      objective: c.objective,
      spend: m.spend,
      purchases: m.purchases,
      cpa: d.cpa,
      impressions: m.impressions,
      reach: m.reach,
      frequency: d.frequency,
      link_clicks: m.link_clicks,
      lpv: m.lpv,
      ctr: d.ctr,
      cpm: d.cpm,
      cpc: d.cpc,
      cr: d.crLpv,
    };
  });

  // Daily trend
  const daily: DailyPoint[] = dailyRows
    .filter((r) => r.date_start)
    .sort((a, b) => (a.date_start! < b.date_start! ? -1 : 1))
    .map((r) => {
      const acc = emptyMetrics();
      addRow(acc, r);
      const d = derive(acc);
      return {
        day: r.date_start!,
        spend: acc.spend,
        impressions: acc.impressions,
        reach: acc.reach,
        frequency: d.frequency,
        link_clicks: acc.link_clicks,
        lpv: acc.lpv,
        purchases: acc.purchases,
        cpa: d.cpa,
      };
    });

  // Fetch all ads with problematic status or issues_info
  const allAds = await fbGet<{
    id: string;
    name: string;
    effective_status?: string;
    issues_info?: AdIssue[];
    campaign_id?: string;
  }>(`/act_${adAccount}/ads`, {
    fields: "id,name,effective_status,issues_info,campaign_id",
    limit: "500",
  });

  const campaignNameMap = new Map(campaigns.map((c) => [c.id, c.name]));
  // Only show issues for campaigns that are actively running
  const activeCampaignIds = new Set(
    campaigns.filter((c) => c.effective_status === "ACTIVE").map((c) => c.id)
  );
  const PROBLEMATIC = new Set(["WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW", "IN_PROCESS"]);

  const ad_issues: AdWithIssues[] = allAds
    .filter((ad) => {
      if (!ad.campaign_id || !activeCampaignIds.has(ad.campaign_id)) return false;
      return (
        (ad.issues_info && ad.issues_info.length > 0) ||
        (ad.effective_status && PROBLEMATIC.has(ad.effective_status))
      );
    })
    .map((ad) => ({
      id: ad.id,
      name: ad.name,
      campaign_id: ad.campaign_id ?? "",
      campaign_name: ad.campaign_id ? campaignNameMap.get(ad.campaign_id) : undefined,
      effective_status: ad.effective_status,
      issues: ad.issues_info ?? [],
    }));

  return {
    account_id: `act_${adAccount}`,
    period: { since: opts.since, until: opts.until, days },
    totals,
    prev_totals,
    daily,
    campaigns: campaignsFull.sort((a, b) => b.spend - a.spend),
    ad_issues,
    fetched_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────
// CPA Alerts — 72-hour scale / warning signals
// ──────────────────────────────────────────────────────────────

export interface CpaAlertUnit {
  id: string;
  name: string;
  cpa: number;
  spend: number;
  purchases: number;
  ctr: number;
  cpc: number;
  impressions: number;
  frequency: number;
}

export interface CpaWinner extends CpaAlertUnit {
  best_adset: { id: string; name: string; cpa: number; spend: number; purchases: number } | null;
  best_ad:    { id: string; name: string; cpa: number; spend: number; purchases: number } | null;
  reasons: string[];
}

export interface CpaWarning extends CpaAlertUnit {
  worst_adset: { id: string; name: string; cpa: number; spend: number; purchases: number } | null;
  worst_ad:    { id: string; name: string; cpa: number; spend: number; purchases: number } | null;
  causes: string[];
  solutions: string[];
}

export interface CpaAlertsResult {
  winners: CpaWinner[];
  warnings: CpaWarning[];
  period: { since: string; until: string; days: number };
  fetched_at: string;
}

const WINNER_CPA_THRESHOLD = 30;
const WARNING_CPA_THRESHOLD = 40;

function buildWinnerReasons(c: CpaAlertUnit): string[] {
  const reasons: string[] = [];
  const pctBelow = ((WINNER_CPA_THRESHOLD - c.cpa) / WINNER_CPA_THRESHOLD) * 100;
  reasons.push(`CPA ${c.cpa.toFixed(1)} EGP — أقل بـ ${pctBelow.toFixed(0)}% من الحد المستهدف (${WINNER_CPA_THRESHOLD} EGP)`);
  if (c.purchases >= 10) reasons.push(`حقق ${c.purchases} أوردر خلال 72 ساعة — كمية كافية للتوسع`);
  else if (c.purchases >= 5) reasons.push(`حقق ${c.purchases} أوردرات — بداية واعدة للتوسع`);
  if (c.ctr >= 3) reasons.push(`CTR مرتفع ${c.ctr.toFixed(2)}% — الإعلان يجذب النقرات بقوة`);
  else if (c.ctr >= 2) reasons.push(`CTR جيد ${c.ctr.toFixed(2)}% — الإعلان يعمل بكفاءة`);
  if (c.cpc > 0 && c.cpc < 5) reasons.push(`CPC منخفض ${c.cpc.toFixed(1)} EGP — تكلفة ترافيك ممتازة`);
  if (c.frequency > 0 && c.frequency < 1.5) reasons.push(`التكرار ${c.frequency.toFixed(1)}x — الجمهور لم يشبع بعد، مناسب للتوسع`);
  return reasons;
}

function buildWarningCauses(c: CpaAlertUnit): string[] {
  const causes: string[] = [];
  if (c.purchases === 0 && c.spend > 50) {
    causes.push(`إنفاق ${c.spend.toFixed(0)} EGP بدون أي أوردر — الحملة تستنزف الميزانية`);
  } else if (c.cpa > 0) {
    const pctAbove = ((c.cpa - WARNING_CPA_THRESHOLD) / WARNING_CPA_THRESHOLD) * 100;
    causes.push(`CPA ${c.cpa.toFixed(1)} EGP — أعلى بـ ${pctAbove.toFixed(0)}% من الحد المقبول (${WARNING_CPA_THRESHOLD} EGP)`);
  }
  if (c.ctr < 0.5) causes.push(`CTR منخفض جداً ${c.ctr.toFixed(2)}% — الجمهور لا ينقر على الإعلان (Ad Fatigue)`);
  else if (c.ctr < 1) causes.push(`CTR ضعيف ${c.ctr.toFixed(2)}% — الكريتف لا يجذب بما يكفي`);
  if (c.frequency > 3.5) causes.push(`تكرار مرتفع ${c.frequency.toFixed(1)}x — الجمهور مشبع ويتجاهل الإعلان`);
  else if (c.frequency > 2.5) causes.push(`تكرار متصاعد ${c.frequency.toFixed(1)}x — يؤدي لارتفاع CPA تدريجياً`);
  if (c.cpc > 15) causes.push(`CPC مرتفع ${c.cpc.toFixed(1)} EGP — المزاد تنافسي أو الاستهداف ضيق`);
  return causes;
}

function buildWarningSolutions(c: CpaAlertUnit): string[] {
  const solutions: string[] = [];
  if (c.purchases === 0) {
    solutions.push("تحقق من إعداد Meta Pixel وحدث Conversion Event");
    solutions.push("راجع صفحة الهبوط — قد يكون بها مشكلة في التحميل أو التصميم");
  }
  if (c.ctr < 1) solutions.push("غيّر الكريتف فوراً — اختبر Hook مختلف في أول 3 ثواني");
  if (c.frequency > 2.5) solutions.push("وسّع الأوديانس أو أنشئ Lookalike Audience جديد من قائمة عملائك");
  if (c.cpa > WARNING_CPA_THRESHOLD * 2) solutions.push("قلّل الميزانية اليومية 40-50% وراقب CPA لمدة 48 ساعة");
  solutions.push("جرّب استهداف Broad مع CBO بدلاً من Manual Adset Budget");
  if (solutions.length < 3) solutions.push("اختبر صور/فيديوهات مختلفة للإعلان مع نفس النص");
  return solutions;
}

export async function getCpaAlerts(opts: {
  adAccountId: string;
}): Promise<CpaAlertsResult> {
  const rawAccount = opts.adAccountId;
  const adAccount = rawAccount.startsWith("act_") ? rawAccount.slice(4) : rawAccount;

  // 72 hours = last 3 days (Cairo = UTC+2)
  const nowCairo = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const until = nowCairo.toISOString().slice(0, 10);
  const since = new Date(nowCairo.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const time_range = JSON.stringify({ since, until });
  const days = 3;

  // Fetch campaign-level insights for the 72h window
  const campaignRows = await fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
    level: "campaign",
    time_range,
    fields: INSIGHT_FIELDS,
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "200",
  });

  // Fetch ad-level insights (gives us adset_name, ad_name too)
  const adRows = await fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
    level: "ad",
    time_range,
    fields: [
      "campaign_id","campaign_name","adset_id","adset_name","ad_id","ad_name",
      "spend","impressions","reach","inline_link_clicks","ctr","frequency",
      "actions","action_values",
    ].join(","),
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "500",
  });

  // Aggregate campaign metrics
  const campMap = new Map<string, { metrics: AggregatedMetrics; name: string; freq: number; impressions: number; reach: number }>();
  for (const row of campaignRows) {
    if (!row.campaign_id) continue;
    const cur = campMap.get(row.campaign_id) ?? { metrics: emptyMetrics(), name: row.campaign_name ?? row.campaign_id, freq: 0, impressions: 0, reach: 0 };
    addRow(cur.metrics, row);
    cur.impressions += Number(row.impressions || 0);
    cur.reach += Number(row.reach || 0);
    if (!cur.name && row.campaign_name) cur.name = row.campaign_name;
    campMap.set(row.campaign_id, cur);
  }

  // Aggregate ad-level metrics grouped by campaign → adset / ad
  const adsetMap = new Map<string, { metrics: AggregatedMetrics; name: string; campaign_id: string }>();
  const adMap    = new Map<string, { metrics: AggregatedMetrics; name: string; campaign_id: string; adset_id: string }>();

  for (const row of adRows) {
    if (!row.campaign_id) continue;
    // adset
    if (row.adset_id) {
      const cur = adsetMap.get(row.adset_id) ?? { metrics: emptyMetrics(), name: row.adset_name ?? row.adset_id, campaign_id: row.campaign_id };
      addRow(cur.metrics, row);
      adsetMap.set(row.adset_id, cur);
    }
    // ad
    if (row.ad_id) {
      const cur = adMap.get(row.ad_id) ?? { metrics: emptyMetrics(), name: row.ad_name ?? row.ad_id, campaign_id: row.campaign_id, adset_id: row.adset_id ?? "" };
      addRow(cur.metrics, row);
      adMap.set(row.ad_id, cur);
    }
  }

  const winners: CpaWinner[] = [];
  const warnings: CpaWarning[] = [];

  for (const [campId, camp] of campMap.entries()) {
    if (camp.metrics.spend < 10) continue; // skip negligible spend
    const d = derive(camp.metrics);
    const freq = camp.reach > 0 ? camp.impressions / camp.reach : 0;

    const unit: CpaAlertUnit = {
      id: campId,
      name: camp.name,
      cpa: d.cpa,
      spend: d.spend,
      purchases: d.purchases,
      ctr: d.ctr,
      cpc: d.cpc,
      impressions: d.impressions,
      frequency: freq,
    };

    // Build best/worst adset for this campaign
    const campAdsets = [...adsetMap.entries()]
      .filter(([, a]) => a.campaign_id === campId)
      .map(([id, a]) => { const dm = derive(a.metrics); return { id, name: a.name, cpa: dm.cpa, spend: dm.spend, purchases: dm.purchases }; });

    const campAds = [...adMap.entries()]
      .filter(([, a]) => a.campaign_id === campId)
      .map(([id, a]) => { const dm = derive(a.metrics); return { id, name: a.name, cpa: dm.cpa, spend: dm.spend, purchases: dm.purchases }; });

    const bestAdset = campAdsets.filter(a => a.purchases > 0).sort((a, b) => a.cpa - b.cpa)[0] ?? null;
    const bestAd    = campAds.filter(a => a.purchases > 0).sort((a, b) => a.cpa - b.cpa)[0] ?? null;
    const worstAdset = campAdsets.filter(a => a.spend > 10).sort((a, b) => b.cpa - a.cpa)[0] ?? null;
    const worstAd    = campAds.filter(a => a.spend > 10).sort((a, b) => b.cpa - a.cpa)[0] ?? null;

    if (d.purchases > 0 && d.cpa < WINNER_CPA_THRESHOLD) {
      winners.push({ ...unit, best_adset: bestAdset, best_ad: bestAd, reasons: buildWinnerReasons(unit) });
    } else if (d.purchases === 0 || d.cpa > WARNING_CPA_THRESHOLD) {
      warnings.push({ ...unit, worst_adset: worstAdset, worst_ad: worstAd, causes: buildWarningCauses(unit), solutions: buildWarningSolutions(unit) });
    }
  }

  winners.sort((a, b) => a.cpa - b.cpa);
  warnings.sort((a, b) => b.cpa - a.cpa);

  return { winners, warnings, period: { since, until, days }, fetched_at: new Date().toISOString() };
}

export async function getAccountInfo() {
  const rawAccount = getAdAccountId();
  const adAccount = rawAccount.startsWith("act_")
    ? rawAccount.slice(4)
    : rawAccount;
  const url = new URL(`${BASE_URL}/act_${adAccount}`);
  url.searchParams.set("access_token", getAccessToken());
  url.searchParams.set("fields", "id,name,currency,timezone_name,account_status");
  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    id?: string;
    name?: string;
    currency?: string;
    timezone_name?: string;
    account_status?: number;
    error?: FbApiError;
  };
  if (data.error) {
    throw new Error(`Meta API error: ${data.error.message}`);
  }
  return data;
}

// ── Ad Sets (lightweight — id, name, parent campaign) ──────────
export interface AdSetRef {
  id: string;
  name: string;
  campaign_id: string;
  campaign_name?: string;
}

export async function listAdSetRefs(adAccountId: string): Promise<AdSetRef[]> {
  const rawAccount = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;
  const rows = await fbGet<{ id: string; name: string; campaign_id: string; campaign?: { id: string; name: string } }>(
    `/act_${rawAccount}/adsets`,
    {
      fields: "id,name,campaign_id,campaign{id,name}",
      limit: "500",
    },
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    campaign_id: r.campaign_id ?? r.campaign?.id ?? "",
    campaign_name: r.campaign?.name,
  }));
}

// ── Account Activities ─────────────────────────────────────────
// Meta's activity log — real actions made on campaigns/ad sets/ads
export interface MetaActivity {
  id?: string;
  actor_name?: string;
  actor_id?: string;
  object_name?: string;
  object_id?: string;
  event_type?: string;
  translated_event_type?: string;
  event_time?: number;
  extra_data?: string;
}

export async function getAccountActivities({
  adAccountId,
  since,
  until,
  limit = 100,
}: {
  adAccountId: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  limit?: number;
}): Promise<MetaActivity[]> {
  const cleanId = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;

  // Convert dates to Unix timestamps (Meta uses Unix for activities)
  const sinceTs = Math.floor(new Date(since).getTime() / 1000);
  const untilTs = Math.floor(new Date(until + "T23:59:59Z").getTime() / 1000);

  const rows = await fbGet<MetaActivity>(`/act_${cleanId}/activities`, {
    fields: "actor_name,actor_id,object_name,object_id,event_type,translated_event_type,event_time,extra_data",
    since: String(sinceTs),
    until: String(untilTs),
    limit: String(Math.min(limit, 200)),
  });

  return rows;
}

export async function listAdAccounts(): Promise<AdAccountSummary[]> {
  const ids = getAdAccountIds();
  const accounts = await Promise.all(
    ids.map(async (id) => {
      const cleanId = id.startsWith("act_") ? id.slice(4) : id;
      const url = new URL(`${BASE_URL}/act_${cleanId}`);
      url.searchParams.set("access_token", getAccessToken());
      url.searchParams.set("fields", "id,name,currency,timezone_name,account_status");
      const res = await fetch(url.toString());
      const data = (await res.json()) as AdAccountSummary & {
        error?: FbApiError;
      };
      if (data.error) throw new Error(`Meta API error: ${data.error.message}`);
      return data;
    }),
  );

  return [...accounts].filter(
    (a, i, arr) => Boolean(a.id) && arr.findIndex((x) => x.id === a.id) === i,
  );
}
