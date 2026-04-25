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

function actionVal(actions: FbActionEntry[] | undefined, type: string): number {
  if (!actions) return 0;
  const e = actions.find((a) => a.action_type === type);
  if (!e) return 0;
  // When action_attribution_windows=["1d_click"] is requested, Meta returns
  // the breakdown in a separate "1d_click" field. Prefer that over "value"
  // which reflects the ad account's default attribution window.
  return Number(e["1d_click"] ?? e.value) || 0;
}

function purchaseCount(row: FbInsightRow): number {
  return (
    actionVal(row.actions, "purchase") ||
    actionVal(row.actions, "omni_purchase") ||
    actionVal(row.actions, "offsite_conversion.fb_pixel_purchase") ||
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
    // Hook rate proxy: video_play_actions / impressions (people who started watching)
    hookRate: m.impressions ? (m.video_plays / m.impressions) * 100 : 0,
  };
}

const ATTRIBUTION_WINDOW = '["1d_click"]';

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

  // 1) Fetch all campaigns metadata
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
      impressions: m.impressions,
      link_clicks: m.link_clicks,
      ctr: d.ctr,
    };
  });
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
        link_clicks: v.metrics.link_clicks,
        lpv: v.metrics.lpv,
        purchases: v.metrics.purchases,
        cpa: d.cpa,
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
      return {
        key: id,
        id,
        label: v.name,
        spend: v.metrics.spend,
        impressions: v.metrics.impressions,
        link_clicks: v.metrics.link_clicks,
        lpv: v.metrics.lpv,
        purchases: v.metrics.purchases,
        cpa: d.cpa,
        cpc: d.cpc,
        ctr: d.ctr,
        cr: d.crLpv,
        hookRate: d.hookRate,
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
  link_clicks: number;
  lpv: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cr: number;
}

export interface AccountOverview {
  account_id: string;
  period: { since: string; until: string; days: number };
  totals: DerivedMetrics;
  prev_totals: DerivedMetrics;
  daily: DailyPoint[];
  campaigns: CampaignSummaryFull[];
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
        link_clicks: acc.link_clicks,
        lpv: acc.lpv,
        purchases: acc.purchases,
        cpa: d.cpa,
      };
    });

  return {
    account_id: `act_${adAccount}`,
    period: { since: opts.since, until: opts.until, days },
    totals,
    prev_totals,
    daily,
    campaigns: campaignsFull.sort((a, b) => b.spend - a.spend),
    fetched_at: new Date().toISOString(),
  };
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
