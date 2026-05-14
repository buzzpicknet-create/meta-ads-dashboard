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

// ── Global rate-limit state ────────────────────────────────────────────────
// Tracks when we last hit a rate limit so subsequent callers can back off.
let _rateLimitBackoffUntil = 0; // epoch ms — Meta API paused until this time

/** Returns true if we are currently in a Meta rate-limit backoff window. */
export function isRateLimitActive(): boolean {
  return _rateLimitBackoffUntil > Date.now();
}
const RATE_LIMIT_BACKOFF_MS = 90_000; // 90 seconds global backoff after retries exhausted
const RATE_LIMIT_CODES = new Set([80004, 17, 32]);
// Exponential backoff delays before setting the global window (5s, 10s)
const RATE_LIMIT_RETRY_DELAYS_MS = [5_000, 10_000];

function isRateLimitCode(code: number): boolean {
  return RATE_LIMIT_CODES.has(code);
}

/**
 * Returns true for Meta errors that mean "this object has no insights edge"
 * (e.g. deleted campaign, draft with no spend, archived entity).
 * These should be handled gracefully — return [] instead of throwing.
 */
function isInsightsUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // (#100) Tried accessing nonexisting field (insights)
  return msg.includes("nonexisting field") || msg.includes("(#100)");
}

/**
 * Re-throws rate-limit errors (so callers can fall back to cache).
 * Swallows "no insights" errors by returning an empty array.
 */
function insightsFallback(err: unknown): FbInsightRow[] {
  if (isRateLimitCode(
    // extract code from "Meta rate limit active, retry in Xs (17)" or "Meta API error (17): ..."
    Number((err instanceof Error ? err.message : "").match(/\((\d+)\)/)?.[1] ?? "0")
  ) || (err instanceof Error && err.message.includes("rate limit"))) {
    throw err; // propagate so fetchInsightsCached can serve stale cache
  }
  if (isInsightsUnavailableError(err)) {
    return []; // campaign has no insights edge — treat as zero data
  }
  throw err; // unexpected error — let it propagate
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Per-request timeout for Meta API calls — prevents hanging connections.
const META_FETCH_TIMEOUT_MS = 60_000;

/** Fetch a single Meta Graph API object (no pagination). Retries on rate-limit before backoff. */
async function fbGetSingle<T>(path: string, params: Record<string, string> = {}, _retryCount = 0): Promise<T> {
  const now = Date.now();
  if (_rateLimitBackoffUntil > now) {
    const remaining_s = Math.ceil((_rateLimitBackoffUntil - now) / 1000);
    logger.warn({ remaining_s }, "Meta rate-limit active — rejecting single fetch immediately");
    throw new Error(`Meta rate limit active, retry in ${remaining_s}s (17)`);
  }
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("access_token", getAccessToken());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS) });
  const json = (await res.json()) as T & { error?: FbApiError };
  if (json.error) {
    const code = (json.error as FbApiError).code;
    if (isRateLimitCode(code)) {
      if (_retryCount < RATE_LIMIT_RETRY_DELAYS_MS.length) {
        const delay = RATE_LIMIT_RETRY_DELAYS_MS[_retryCount];
        logger.warn({ code, retryCount: _retryCount, delay_ms: delay }, "Meta rate-limit — retrying single fetch with backoff");
        await sleep(delay);
        return fbGetSingle<T>(path, params, _retryCount + 1);
      }
      _rateLimitBackoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      logger.warn({ code, backoff_s: RATE_LIMIT_BACKOFF_MS / 1000 }, "Meta rate-limit exhausted retries — global backoff set");
    }
    throw new Error(`Meta API error (${code}): ${(json.error as FbApiError).message}`);
  }
  return json;
}

// ── Meta Batch API ─────────────────────────────────────────────────────────
// Sends up to 50 GET operations in a single POST to Meta's batch endpoint.
// Each operation: { relative_url: string }. Handles rate-limit + retry.
interface BatchOp {
  method: "GET";
  relative_url: string; // e.g. "/{id}?fields=id,name" — no leading slash needed
}

interface BatchResponseItem {
  code: number;
  headers: Array<{ name: string; value: string }>;
  body: string;
}

async function fbBatch<T extends unknown[]>(
  ops: { [K in keyof T]: BatchOp },
  _retryCount = 0,
): Promise<{ [K in keyof T]: T[K] }> {
  const now = Date.now();
  if (_rateLimitBackoffUntil > now) {
    const remaining_s = Math.ceil((_rateLimitBackoffUntil - now) / 1000);
    throw new Error(`Meta rate limit active, retry in ${remaining_s}s (17)`);
  }

  const body = new URLSearchParams({
    access_token: getAccessToken(),
    batch: JSON.stringify(ops),
    include_headers: "false",
  });

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    if (_retryCount < 2) {
      const delay = Math.pow(2, _retryCount + 1) * 1000;
      logger.warn({ retryCount: _retryCount, delay, err: String(fetchErr) }, "Meta batch network error — retrying");
      await sleep(delay);
      return fbBatch(ops, _retryCount + 1);
    }
    throw fetchErr;
  }

  const items = (await res.json()) as BatchResponseItem[];

  // Check for top-level rate-limit on the batch endpoint itself
  if (!Array.isArray(items)) {
    const err = (items as { error?: FbApiError }).error;
    if (err && isRateLimitCode(err.code)) {
      if (_retryCount < RATE_LIMIT_RETRY_DELAYS_MS.length) {
        const delay = RATE_LIMIT_RETRY_DELAYS_MS[_retryCount];
        logger.warn({ code: err.code, retryCount: _retryCount, delay_ms: delay }, "Meta batch rate-limit — retrying");
        await sleep(delay);
        return fbBatch(ops, _retryCount + 1);
      }
      _rateLimitBackoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
    throw new Error(`Meta batch error: ${err?.message ?? "unexpected response"}`);
  }

  return items.map((item) => {
    const parsed = JSON.parse(item.body) as { error?: FbApiError };
    if (parsed.error) {
      if (isRateLimitCode(parsed.error.code)) {
        _rateLimitBackoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
        logger.warn({ code: parsed.error.code }, "Meta batch item rate-limit — global backoff set");
      }
      throw new Error(`Meta batch item error (${parsed.error.code}): ${parsed.error.message}`);
    }
    return parsed;
  }) as { [K in keyof T]: T[K] };
}

async function fbGet<T>(
  pathOrUrl: string,
  params: Record<string, string> = {},
  _retryCount = 0,
): Promise<T[]> {
  // Honor any active backoff — throw immediately so callers can serve from cache
  // instead of blocking the HTTP connection for up to 90 seconds.
  const now = Date.now();
  if (_rateLimitBackoffUntil > now) {
    const remaining_s = Math.ceil((_rateLimitBackoffUntil - now) / 1000);
    logger.warn({ remaining_s }, "Meta rate-limit active — rejecting request immediately (serve from cache)");
    throw new Error(`Meta rate limit active, retry in ${remaining_s}s (17)`);
  }

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
    let res: Response;
    try {
      res = await fetch(nextUrl, { signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS) });
    } catch (fetchErr) {
      // Network / timeout error — exponential backoff up to 2 retries (2s, 4s)
      if (_retryCount < 2) {
        const backoffMs = Math.pow(2, _retryCount + 1) * 1000;
        logger.warn({ retryCount: _retryCount, backoffMs, err: String(fetchErr) }, "Meta API network error — retrying");
        await sleep(backoffMs);
        return fbGet<T>(pathOrUrl, params, _retryCount + 1);
      }
      throw fetchErr;
    }
    const json = (await res.json()) as FbApiResponse<T>;
    if (json.error) {
      if (isRateLimitCode(json.error.code)) {
        if (_retryCount < RATE_LIMIT_RETRY_DELAYS_MS.length) {
          const delay = RATE_LIMIT_RETRY_DELAYS_MS[_retryCount];
          logger.warn(
            { code: json.error.code, retryCount: _retryCount, delay_ms: delay },
            "Meta rate-limit — retrying fbGet with backoff"
          );
          await sleep(delay);
          return fbGet<T>(pathOrUrl, params, _retryCount + 1);
        }
        // Retries exhausted — record global backoff so all concurrent callers back off
        _rateLimitBackoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
        logger.warn(
          { code: json.error.code, backoff_s: RATE_LIMIT_BACKOFF_MS / 1000 },
          "Meta rate-limit exhausted retries — global backoff set"
        );
      }
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
  holdRate: number;
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
    holdRate: m.video_plays > 0 ? (m.v100 / m.video_plays) * 100 : 0,
    frequency: m.reach > 0 ? m.impressions / m.reach : 0,
  };
}

// Request all 3 windows so Meta returns per-window breakdown fields (1d_click, 7d_click, 1d_view).
// When a window's field is absent from the response, Meta means its value is 0.
const ATTRIBUTION_WINDOW = '["1d_click","7d_click","1d_view"]';

// Full insight fields — used for getCampaignInsights (DiagnosisModal, ad-level detail).
// Includes all funnel video checkpoints so we can compute Hold Rate (v100/video_plays).
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
  "actions",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
].join(",");

// Lean fields for campaign-list calls — includes video_play_actions for hookRate.
const LEAN_CAMPAIGN_FIELDS = [
  "campaign_id",
  "impressions",
  "spend",
  "inline_link_clicks",
  "actions",
  "video_play_actions",
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
  hookRate: number;
  holdRate: number;
  updated_time?: string;
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
  /** When true: only fetch ACTIVE/CAMPAIGN_PAUSED campaigns and use lean insight fields.
   *  Reduces API payload by ~70% — use for AI tool calls. Default: false (full data for dashboard). */
  activeOnly?: boolean;
}): Promise<CampaignSummary[]> {
  const rawAccount = opts.adAccountId || getAdAccountId();
  const adAccount = rawAccount.startsWith("act_")
    ? rawAccount.slice(4)
    : rawAccount;

  // 1) Fetch campaigns metadata
  // activeOnly: fetch ACTIVE + PAUSED (incl. CAMPAIGN_PAUSED) — skip ARCHIVED/DELETED for AI tool calls
  const statusFilter = opts.activeOnly
    ? ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED"]
    : ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "CAMPAIGN_PAUSED"];
  const campaigns = await fbGet<{
    id: string;
    name: string;
    status: string;
    effective_status: string;
    objective: string;
    updated_time?: string;
  }>(`/act_${adAccount}/campaigns`, {
    fields: "id,name,status,effective_status,objective,updated_time",
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: statusFilter }]),
    limit: "500",
  });

  // 2) Fetch insights at campaign level for the period
  // activeOnly: use lean fields (no video, no reach) — sufficient for spend/purchases/CTR summary
  const time_range = JSON.stringify({ since: opts.since, until: opts.until });
  const insights = await fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
    level: "campaign",
    time_range,
    fields: opts.activeOnly ? LEAN_CAMPAIGN_FIELDS : INSIGHT_FIELDS,
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
      hookRate: d.hookRate,
      holdRate: d.holdRate,
      updated_time: c.updated_time,
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
  holdRate: number;
  lpvRate: number;
  effective_status?: string;
  issues?: AdIssue[];
  adset_id?: string;
}

export interface DailySegmentPoint {
  id: string;
  label: string;
  day: string;
  spend: number;
  impressions: number;
  link_clicks: number;
  lpv: number;
  purchases: number;
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
  daily_by_adset: DailySegmentPoint[];
  daily_by_ad: DailySegmentPoint[];
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

  // Fire all 4 Meta API calls concurrently — reduces wall-clock time by ~3×
  // vs sequential execution and halves the number of rate-limit windows consumed.
  // Insights calls use insightsFallback() so that (#100) "nonexisting field (insights)"
  // errors (deleted/draft campaigns) degrade gracefully to empty arrays instead of
  // crashing the whole Promise.all and blocking the AI from any data.
  const [metaJson, dailyRows, adRows, adDeliveryRaw] = await Promise.all([
    // 1) Campaign metadata — single object, no pagination
    fbGetSingle<{
      id?: string;
      name?: string;
      status?: string;
      effective_status?: string;
      objective?: string;
    }>(`/${opts.campaign_id}`, { fields: "id,name,status,effective_status,objective" }),

    // 2) Daily campaign totals (time_increment=1)
    fbGet<FbInsightRow>(`/${opts.campaign_id}/insights`, {
      level: "campaign",
      time_range,
      time_increment: "1",
      fields: INSIGHT_FIELDS,
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "200",
    }).catch(insightsFallback),

    // 3) Ad-level rows with daily breakdown
    fbGet<FbInsightRow>(`/${opts.campaign_id}/insights`, {
      level: "ad",
      time_range,
      time_increment: "1",
      fields: INSIGHT_FIELDS,
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "1000",
    }).catch(insightsFallback),

    // 4) Ad delivery status & issues — graceful fallback (campaign may have no ads)
    fbGet<{ id: string; effective_status?: string; issues_info?: AdIssue[] }>(
      `/${opts.campaign_id}/ads`,
      { fields: "id,effective_status,issues_info", limit: "500" },
    ).catch(() => [] as { id: string; effective_status?: string; issues_info?: AdIssue[] }[]),
  ]);

  const campaign = {
    id: metaJson.id || opts.campaign_id,
    name: metaJson.name || "(unknown)",
    status: metaJson.status || "UNKNOWN",
    effective_status: metaJson.effective_status || "UNKNOWN",
    objective: metaJson.objective || "UNKNOWN",
  };
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
        holdRate: d.holdRate,
        lpvRate: d.lpvRate,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // ---- By ad
  const adMap = new Map<string, { name: string; metrics: AggregatedMetrics; adset_id: string }>();
  for (const row of adRows) {
    if (!row.ad_id) continue;
    const cur = adMap.get(row.ad_id) ?? {
      name: row.ad_name || row.ad_id,
      metrics: emptyMetrics(),
      adset_id: row.adset_id ?? "",
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
        holdRate: d.holdRate,
        lpvRate: d.lpvRate,
        effective_status: delivery?.effective_status,
        issues: delivery?.issues ?? [],
        adset_id: v.adset_id,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // ---- Daily breakdown by adset (group by adset_id + day)
  const adsetDayMap = new Map<string, { name: string; day: string; m: AggregatedMetrics }>();
  for (const row of adRows) {
    if (!row.adset_id || !row.date_start) continue;
    const k = `${row.adset_id}|${row.date_start}`;
    const cur = adsetDayMap.get(k) ?? { name: row.adset_name || row.adset_id, day: row.date_start, m: emptyMetrics() };
    addRow(cur.m, row);
    adsetDayMap.set(k, cur);
  }
  const daily_by_adset: DailySegmentPoint[] = [...adsetDayMap.entries()].map(([k, v]) => ({
    id: k.split("|")[0],
    label: v.name,
    day: v.day,
    spend: v.m.spend,
    impressions: v.m.impressions,
    link_clicks: v.m.link_clicks,
    lpv: v.m.lpv,
    purchases: v.m.purchases,
  }));

  // ---- Daily breakdown by ad (group by ad_id + day)
  const adDayMap = new Map<string, { name: string; day: string; m: AggregatedMetrics }>();
  for (const row of adRows) {
    if (!row.ad_id || !row.date_start) continue;
    const k = `${row.ad_id}|${row.date_start}`;
    const cur = adDayMap.get(k) ?? { name: row.ad_name || row.ad_id, day: row.date_start, m: emptyMetrics() };
    addRow(cur.m, row);
    adDayMap.set(k, cur);
  }
  const daily_by_ad: DailySegmentPoint[] = [...adDayMap.entries()].map(([k, v]) => ({
    id: k.split("|")[0],
    label: v.name,
    day: v.day,
    spend: v.m.spend,
    impressions: v.m.impressions,
    link_clicks: v.m.link_clicks,
    lpv: v.m.lpv,
    purchases: v.m.purchases,
  }));

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
    daily_by_adset,
    daily_by_ad,
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
  hookRate: number;
  video_plays: number;
  v95: number;
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

  const DAILY_ACCOUNT_FIELDS = [
    "impressions",
    "reach",
    "spend",
    "clicks",
    "inline_link_clicks",
    "actions",
    "video_play_actions",
  ].join(",");

  // Fire all 5 Meta API calls concurrently — cuts wall-clock time from ~15s to ~4s
  const [campaigns, insightRows, dailyRows, prevRows, allAds] = await Promise.all([
    // 1) Campaign metadata
    fbGet<{ id: string; name: string; status: string; effective_status: string; objective: string }>(
      `/act_${adAccount}/campaigns`,
      { fields: "id,name,status,effective_status,objective", limit: "200" },
    ),

    // 2) Current period campaign-level insights
    fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
      level: "campaign",
      time_range,
      fields: INSIGHT_FIELDS,
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "200",
    }),

    // 3) Daily account-level insights (time_increment=1)
    fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
      level: "account",
      time_range,
      time_increment: "1",
      fields: DAILY_ACCOUNT_FIELDS,
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "200",
    }),

    // 4) Previous period totals for comparison
    fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
      level: "account",
      time_range: prev_time_range,
      fields: DAILY_ACCOUNT_FIELDS,
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "200",
    }),

    // 5) All ads with potential issues
    fbGet<{ id: string; name: string; effective_status?: string; issues_info?: AdIssue[]; campaign_id?: string }>(
      `/act_${adAccount}/ads`,
      { fields: "id,name,effective_status,issues_info,campaign_id", limit: "500" },
    ),
  ]);

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
      hookRate: d.hookRate,
      video_plays: m.video_plays,
      v95: m.v95,
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

  // Fire both insight calls concurrently
  const [campaignRows, adRows] = await Promise.all([
    // Campaign-level insights for the 72h window
    fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
      level: "campaign",
      time_range,
      fields: INSIGHT_FIELDS,
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "200",
    }),

    // Ad-level insights (gives us adset_name, ad_name too)
    fbGet<FbInsightRow>(`/act_${adAccount}/insights`, {
      level: "ad",
      time_range,
      fields: [
        "campaign_id","campaign_name","adset_id","adset_name","ad_id","ad_name",
        "spend","impressions","reach","inline_link_clicks","ctr","frequency",
        "actions","action_values",
      ].join(","),
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "500",
    }),
  ]);

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

// In-memory cache so rate-limit spikes don't blank out the accounts dropdown
let _accountsCache: AdAccountSummary[] | null = null;

export async function listAdAccounts(): Promise<AdAccountSummary[]> {
  const ids = getAdAccountIds();

  try {
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

    const result = [...accounts].filter(
      (a, i, arr) => Boolean(a.id) && arr.findIndex((x) => x.id === a.id) === i,
    );

    // Persist successful result so we can fall back on rate-limit
    _accountsCache = result;
    return result;
  } catch (err) {
    // Rate-limit or transient error — return last known good data if available
    if (_accountsCache && _accountsCache.length > 0) {
      return _accountsCache;
    }
    // No cache yet — build minimal stubs from env-configured IDs
    return ids.map((id) => {
      const cleanId = id.startsWith("act_") ? id.slice(4) : id;
      return {
        id: `act_${cleanId}`,
        name: `حساب ${cleanId}`,
        currency: "EGP",
        timezone_name: "Africa/Cairo",
        account_status: 1,
      } as AdAccountSummary;
    });
  }
}

// ── Creative Intelligence ─────────────────────────────────────────────────────
export interface AdCreativeRow {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  status: string;
  effective_status: string;
  // Meta creative fields
  primary_text: string | null;   // ad.creative.body
  headline: string | null;       // ad.creative.title
  media_type: "video" | "image" | "unknown";
  media_id: string | null;       // video_id or image_hash
  // Derived performance
  spend: number;
  purchases: number;
  cpa: number;
  ctr: number;
  cr: number;
  cpc: number;
  impressions: number;
  link_clicks: number;
}

export async function getAdsWithCreatives(opts: {
  adAccountId: string;
  since: string;
  until: string;
}): Promise<AdCreativeRow[]> {
  const rawAccount = opts.adAccountId.startsWith("act_")
    ? opts.adAccountId.slice(4)
    : opts.adAccountId;

  // 1) Fetch all ads with creative fields — use small page size to avoid Meta data-size errors
  const ads = await fbGet<{
    id: string;
    name: string;
    status: string;
    effective_status: string;
    campaign_id: string;
    campaign_name: string;
    adset_id: string;
    adset_name: string;
    creative?: {
      body?: string;
      title?: string;
      video_id?: string;
      image_hash?: string;
    };
  }>(`/act_${rawAccount}/ads`, {
    fields: "id,name,status,effective_status,campaign_id,campaign_name,adset_id,adset_name,creative{body,title,video_id,image_hash}",
    limit: "100",
  });

  // 2) Fetch ad-level insights for the date range — smaller pages too
  const time_range = JSON.stringify({ since: opts.since, until: opts.until });
  const insightRows = await fbGet<FbInsightRow>(`/act_${rawAccount}/insights`, {
    level: "ad",
    time_range,
    fields: [
      "ad_id", "ad_name", "campaign_id", "campaign_name", "adset_id", "adset_name",
      "spend", "impressions", "inline_link_clicks", "ctr", "cpc",
      "actions", "action_values",
    ].join(","),
    action_attribution_windows: ATTRIBUTION_WINDOW,
    limit: "200",
  });

  // Build insight map by ad_id + name map (insights reliably return campaign_name / adset_name)
  const insightMap = new Map<string, AggregatedMetrics>();
  const nameMap    = new Map<string, { campaign_name: string; adset_name: string }>();
  // Campaign-level name dictionary — collects the best name seen for each campaign_id
  const campaignNameDict = new Map<string, string>();
  const adsetNameDict    = new Map<string, string>();

  for (const row of insightRows) {
    if (!row.ad_id) continue;
    const cur = insightMap.get(row.ad_id) ?? emptyMetrics();
    addRow(cur, row);
    insightMap.set(row.ad_id, cur);
    if (!nameMap.has(row.ad_id)) {
      nameMap.set(row.ad_id, {
        campaign_name: row.campaign_name ?? "",
        adset_name:    row.adset_name    ?? "",
      });
    }
    // Populate campaign/adset-level dictionaries from insights (most reliable source)
    if (row.campaign_id && row.campaign_name) campaignNameDict.set(row.campaign_id, row.campaign_name);
    if (row.adset_id    && row.adset_name)    adsetNameDict.set(row.adset_id, row.adset_name);
  }

  // Also collect from the ads list (secondary source) to cover campaigns with no insights in range
  for (const ad of ads) {
    if (ad.campaign_id && ad.campaign_name && !campaignNameDict.has(ad.campaign_id)) {
      campaignNameDict.set(ad.campaign_id, ad.campaign_name);
    }
    if (ad.adset_id && ad.adset_name && !adsetNameDict.has(ad.adset_id)) {
      adsetNameDict.set(ad.adset_id, ad.adset_name);
    }
  }

  // 3) Merge ads + insights
  return ads.map((ad) => {
    const m = insightMap.get(ad.id) ?? emptyMetrics();
    const d = derive(m);
    const c = ad.creative ?? {};
    const mediaType: "video" | "image" | "unknown" =
      c.video_id ? "video" : c.image_hash ? "image" : "unknown";
    const names = nameMap.get(ad.id);

    return {
      ad_id: ad.id,
      ad_name: ad.name,
      campaign_id: ad.campaign_id,
      // Use campaign-level dict first (aggregated from all sources), then per-ad fallbacks
      campaign_name: campaignNameDict.get(ad.campaign_id) || names?.campaign_name || ad.campaign_name || ad.campaign_id,
      adset_id: ad.adset_id,
      adset_name: adsetNameDict.get(ad.adset_id) || names?.adset_name || ad.adset_name || ad.adset_id,
      status: ad.status,
      effective_status: ad.effective_status,
      primary_text: c.body ?? null,
      headline: c.title ?? null,
      media_type: mediaType,
      media_id: c.video_id ?? c.image_hash ?? null,
      spend: m.spend,
      purchases: m.purchases,
      cpa: d.cpa,
      ctr: d.ctr,
      cr: d.crClick,
      cpc: d.cpc,
      impressions: m.impressions,
      link_clicks: m.link_clicks,
    };
  });
}

// ── Ad-level breakdown by age/gender + placement ──────────────────────────────

interface FbBreakdownRow extends FbInsightRow {
  age?: string;
  gender?: string;
  publisher_platform?: string;
  platform_position?: string;
}

export interface BreakdownSegment {
  label: string;
  spend: number;
  impressions: number;
  link_clicks: number;
  purchases: number;
  cpa: number;
  ctr: number;
}

export interface CampaignBreakdowns {
  campaign_id: string;
  period: { since: string; until: string };
  fetched_at: string;
  by_age: BreakdownSegment[];
  by_gender: BreakdownSegment[];
  by_placement: BreakdownSegment[];
}

const BREAK_FIELDS = [
  "spend",
  "impressions",
  "reach",
  "inline_link_clicks",
  "actions",
].join(",");

function toSegments(map: Map<string, AggregatedMetrics>): BreakdownSegment[] {
  return Array.from(map.entries())
    .map(([label, m]) => {
      const d = derive(m);
      return {
        label,
        spend: m.spend,
        impressions: m.impressions,
        link_clicks: m.link_clicks,
        purchases: m.purchases,
        cpa: d.cpa,
        ctr: d.ctr,
      };
    })
    .filter((s) => s.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

export async function getAdBreakdowns(opts: {
  campaignId: string;
  since: string;
  until: string;
}): Promise<CampaignBreakdowns> {
  const time_range = JSON.stringify({ since: opts.since, until: opts.until });

  const [ageGenderRows, placementRows] = await Promise.all([
    fbGet<FbBreakdownRow>(`/${opts.campaignId}/insights`, {
      level: "ad",
      time_range,
      fields: BREAK_FIELDS,
      breakdowns: "age,gender",
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "500",
    }),
    fbGet<FbBreakdownRow>(`/${opts.campaignId}/insights`, {
      level: "ad",
      time_range,
      fields: BREAK_FIELDS,
      breakdowns: "publisher_platform,platform_position",
      action_attribution_windows: ATTRIBUTION_WINDOW,
      limit: "500",
    }),
  ]);

  const ageMap = new Map<string, AggregatedMetrics>();
  const genderMap = new Map<string, AggregatedMetrics>();
  for (const row of ageGenderRows) {
    const ageKey = row.age || "unknown";
    const cur1 = ageMap.get(ageKey) ?? emptyMetrics();
    addRow(cur1, row);
    ageMap.set(ageKey, cur1);

    const genderKey = row.gender || "unknown";
    const cur2 = genderMap.get(genderKey) ?? emptyMetrics();
    addRow(cur2, row);
    genderMap.set(genderKey, cur2);
  }

  const placementMap = new Map<string, AggregatedMetrics>();
  for (const row of placementRows) {
    const key = `${row.publisher_platform || "?"} / ${row.platform_position || "?"}`;
    const cur = placementMap.get(key) ?? emptyMetrics();
    addRow(cur, row);
    placementMap.set(key, cur);
  }

  return {
    campaign_id: opts.campaignId,
    period: { since: opts.since, until: opts.until },
    fetched_at: new Date().toISOString(),
    by_age: toSegments(ageMap),
    by_gender: toSegments(genderMap),
    by_placement: toSegments(placementMap),
  };
}

// ── Campaign / Adset live details (status + budget) ───────────────────────────

export interface CampaignDetails {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: number;
  lifetime_budget?: number;
  updated_time?: string;
}

export async function getCampaignDetails(campaign_id: string): Promise<CampaignDetails> {
  const json = await fbGetSingle<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    updated_time?: string;
  }>(`/${campaign_id}`, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,updated_time" });
  return {
    id: json.id ?? campaign_id,
    name: json.name ?? "",
    status: json.status ?? "UNKNOWN",
    effective_status: json.effective_status ?? "UNKNOWN",
    daily_budget: json.daily_budget ? Number(json.daily_budget) / 100 : undefined,
    lifetime_budget: json.lifetime_budget ? Number(json.lifetime_budget) / 100 : undefined,
    updated_time: json.updated_time,
  };
}

export interface AdsetDetails {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: number;
  lifetime_budget?: number;
  updated_time?: string;
}

export async function getAdsetDetails(adset_id: string): Promise<AdsetDetails> {
  const json = await fbGetSingle<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    updated_time?: string;
  }>(`/${adset_id}`, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,updated_time" });
  return {
    id: json.id ?? adset_id,
    name: json.name ?? "",
    status: json.status ?? "UNKNOWN",
    effective_status: json.effective_status ?? "UNKNOWN",
    daily_budget: json.daily_budget ? Number(json.daily_budget) / 100 : undefined,
    lifetime_budget: json.lifetime_budget ? Number(json.lifetime_budget) / 100 : undefined,
    updated_time: json.updated_time,
  };
}

export interface AdDetails {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  updated_time?: string;
}

export async function getAdDetails(ad_id: string): Promise<AdDetails> {
  const json = await fbGetSingle<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    updated_time?: string;
  }>(`/${ad_id}`, { fields: "id,name,status,effective_status,updated_time" });
  return {
    id: json.id ?? ad_id,
    name: json.name ?? "",
    status: json.status ?? "UNKNOWN",
    effective_status: json.effective_status ?? "UNKNOWN",
    updated_time: json.updated_time,
  };
}

// ── Ad Creative Info (Post ID) ────────────────────────────────────────────────
export interface AdCreativeInfo {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  campaign_id: string;
  creative_id: string;
  /** "{page_id}_{post_id}" — the Facebook post backing this ad */
  object_story_id: string;
  /** Same format — reflects the currently active post (may differ from object_story_id after edits) */
  effective_object_story_id: string;
}

export async function getAdCreativeInfo(ad_id: string): Promise<AdCreativeInfo> {
  const json = await fbGetSingle<{
    id?: string;
    name?: string;
    adset_id?: string;
    campaign_id?: string;
    creative?: {
      id?: string;
      object_story_id?: string;
      effective_object_story_id?: string;
    };
  }>(`/${ad_id}`, {
    fields: "id,name,adset_id,campaign_id,creative{id,object_story_id,effective_object_story_id}",
  });
  return {
    ad_id:                    json.id ?? ad_id,
    ad_name:                  json.name ?? "",
    adset_id:                 json.adset_id ?? "",
    campaign_id:              json.campaign_id ?? "",
    creative_id:              json.creative?.id ?? "",
    object_story_id:          json.creative?.object_story_id ?? "",
    effective_object_story_id: json.creative?.effective_object_story_id ?? "",
  };
}

export interface AdCreativeContent {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  campaign_id: string;
  creative_id: string;
  primary_text: string;
  headline: string;
  video_id: string;
  image_hash: string;
  link_url: string;
  call_to_action: string;
  object_story_id: string;
  effective_object_story_id: string;
  page_id: string;
  instagram_actor_id: string;
  media_type: "video" | "image" | "post" | "unknown";
}

export async function getAdCreativeContent(ad_id: string): Promise<AdCreativeContent> {
  const json = await fbGetSingle<{
    id?: string;
    name?: string;
    adset_id?: string;
    campaign_id?: string;
    creative?: {
      id?: string;
      body?: string;
      title?: string;
      video_id?: string;
      image_hash?: string;
      link_url?: string;
      call_to_action?: { type?: string; value?: { link?: string } };
      object_story_id?: string;
      effective_object_story_id?: string;
      instagram_actor_id?: string;
    };
  }>(`/${ad_id}`, {
    fields: "id,name,adset_id,campaign_id,creative{id,body,title,video_id,image_hash,link_url,call_to_action,object_story_id,effective_object_story_id,instagram_actor_id}",
  });

  const c = json.creative ?? {};
  const storyId = c.effective_object_story_id ?? c.object_story_id ?? "";
  const pageId = storyId ? storyId.split("_")[0] : "";

  let mediaType: AdCreativeContent["media_type"] = "unknown";
  if (c.video_id) mediaType = "video";
  else if (c.image_hash) mediaType = "image";
  else if (storyId) mediaType = "post";

  return {
    ad_id:                    json.id ?? ad_id,
    ad_name:                  json.name ?? "",
    adset_id:                 json.adset_id ?? "",
    campaign_id:              json.campaign_id ?? "",
    creative_id:              c.id ?? "",
    primary_text:             c.body ?? "",
    headline:                 c.title ?? "",
    video_id:                 c.video_id ?? "",
    image_hash:               c.image_hash ?? "",
    link_url:                 c.link_url ?? c.call_to_action?.value?.link ?? "",
    call_to_action:           c.call_to_action?.type ?? "",
    object_story_id:          c.object_story_id ?? "",
    effective_object_story_id: c.effective_object_story_id ?? "",
    page_id:                  pageId,
    instagram_actor_id:       c.instagram_actor_id ?? "",
    media_type:               mediaType,
  };
}

// ── Search campaigns by name (no Insights — shows 0-spend campaigns) ─────────
export interface CampaignSearchResult {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  created_time: string;
  updated_time: string;
}

export async function searchCampaignsByName(
  adAccountId: string,
  query: string,
): Promise<CampaignSearchResult[]> {
  const cleanId = adAccountId.replace(/^act_/, "");
  const rows = await fbGet<CampaignSearchResult>(
    `/act_${cleanId}/campaigns`,
    { fields: "id,name,status,effective_status,created_time,updated_time", limit: "200" },
  );
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => r.name?.toLowerCase().includes(q));
}

// ── Search adsets by campaign (no Insights — shows 0-spend adsets) ───────────
export interface AdsetSearchResult {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  created_time: string;
  updated_time: string;
}

export async function searchAdsetsByCampaign(
  campaignId: string,
  query: string,
): Promise<AdsetSearchResult[]> {
  const rows = await fbGet<AdsetSearchResult>(
    `/${campaignId}/adsets`,
    { fields: "id,name,status,effective_status,daily_budget,created_time,updated_time", limit: "200" },
  );
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => r.name?.toLowerCase().includes(q));
}

// ── Search ads by adset (no Insights — shows 0-spend ads) ────────────────────
export interface AdSearchResult {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  created_time: string;
  updated_time: string;
}

export async function searchAdsByAdset(
  adsetId: string,
  query: string,
): Promise<AdSearchResult[]> {
  const rows = await fbGet<AdSearchResult>(
    `/${adsetId}/ads`,
    { fields: "id,name,status,effective_status,created_time,updated_time", limit: "200" },
  );
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => r.name?.toLowerCase().includes(q));
}

// ── Account Metadata (pixels + pages) ────────────────────────────────────────
export interface AccountMetadata {
  pixels: { id: string; name: string }[];
  pages: { id: string; name: string }[];
}

export async function fetchAccountMetadata(adAccountId: string): Promise<AccountMetadata> {
  const cleanId = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;
  const token = getAccessToken();

  const [pixelRes, pageRes, personalPageRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/act_${cleanId}/adspixels?fields=id,name&limit=10&access_token=${token}`)
      .then(r => r.json() as Promise<{ data?: { id: string; name: string }[]; error?: { message: string } }>),
    fetch(`${BASE_URL}/act_${cleanId}/promote_pages?fields=id,name&limit=10&access_token=${token}`)
      .then(r => r.json() as Promise<{ data?: { id: string; name: string }[]; error?: { message: string } }>),
    // Fallback: fetch pages the token owner admins personally (Personal Admin access)
    fetch(`${BASE_URL}/me/accounts?fields=id,name&limit=25&access_token=${token}`)
      .then(r => r.json() as Promise<{ data?: { id: string; name: string }[]; error?: { message: string } }>),
  ]);

  const pixels = pixelRes.status === "fulfilled" && Array.isArray(pixelRes.value.data)
    ? pixelRes.value.data : [];

  // Prefer promote_pages (Business Manager linked); fall back to /me/accounts (Personal Admin pages)
  let pages: { id: string; name: string }[] = [];
  if (pageRes.status === "fulfilled" && Array.isArray(pageRes.value.data) && pageRes.value.data.length > 0) {
    pages = pageRes.value.data;
  } else if (personalPageRes.status === "fulfilled" && Array.isArray(personalPageRes.value.data) && personalPageRes.value.data.length > 0) {
    pages = personalPageRes.value.data;
  }

  return { pixels, pages };
}
