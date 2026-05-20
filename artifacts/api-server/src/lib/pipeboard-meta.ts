/**
 * Pipeboard-backed implementations of the three key dashboard data functions:
 *   pbListCampaigns      → replaces listCampaigns (meta-api.ts)
 *   pbGetAccountOverview → replaces getAccountOverview (meta-api.ts)
 *   pbGetCampaignInsights → replaces getCampaignInsights (meta-api.ts)
 *
 * Uses the same return types so the route handlers in meta.ts need no changes.
 * Pipeboard response shape: { results: [{ status: "success", insights: [...rows] }] }
 */
import { callPipeboardTool } from "./pipeboard-client";
import { derive } from "./meta-api";
import type {
  CampaignSummary,
  AccountOverview,
  CampaignInsights,
  DerivedMetrics,
  CampaignSummaryFull,
  DailyPoint,
  SegmentEntry,
  DailySegmentPoint,
} from "./meta-api";

// ── Internal types ────────────────────────────────────────────────────────────
interface PbAction { action_type: string; value: string | number; }
interface PbRow {
  campaign_id?: string; campaign_name?: string;
  adset_id?: string;   adset_name?: string;
  ad_id?: string;      ad_name?: string;
  date_start?: string; date_stop?: string;
  impressions?: number | string;
  spend?: number | string;
  reach?: number | string;
  frequency?: number | string;
  ctr?: number | string;
  cpm?: number | string;
  clicks?: number | string;
  actions?: PbAction[];
  cost_per_action_type?: PbAction[];
  [key: string]: unknown;
}

// ── Fields to request from Pipeboard ─────────────────────────────────────────
const PB_FIELDS = [
  "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
  "impressions", "spend", "reach", "frequency", "ctr", "cpm", "clicks",
  "actions", "cost_per_action_type", "video_play_actions",
];

// Purchase action types — SAME event, use avFirst (never sum)
const PURCHASE_TYPES = [
  "web_in_store_purchase", "offsite_conversion.fb_pixel_purchase",
  "purchase", "omni_purchase", "onsite_web_purchase",
  "onsite_web_app_purchase", "web_app_in_store_purchase",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the flat array of insight rows from a raw Pipeboard response string. */
function parseRows(raw: string): PbRow[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const p = parsed as Record<string, unknown>;
    // Primary shape: { results: [{ status: "success", insights: [...] }] }
    if (Array.isArray(p["results"])) {
      return (p["results"] as Array<Record<string, unknown>>)
        .filter(r => r["status"] === "success" && Array.isArray(r["insights"]))
        .flatMap(r => r["insights"] as PbRow[]);
    }
    // Fallbacks
    if (Array.isArray(p["data"])) return p["data"] as PbRow[];
    if (Array.isArray(parsed)) return parsed as PbRow[];
    return [];
  } catch { return []; }
}

/** Get a numeric action value by type from an actions array. */
function av(actions: PbAction[] | undefined, type: string): number {
  if (!Array.isArray(actions)) return 0;
  const e = actions.find(a => a.action_type === type);
  return Number(e?.value) || 0;
}

/** First non-zero purchase value (all types represent the SAME event — never sum). */
function avPurchase(arr: PbAction[] | undefined): number {
  for (const t of PURCHASE_TYPES) { const v = av(arr, t); if (v > 0) return v; }
  return 0;
}

/** Days in range (inclusive). */
function daysBetween(since: string, until: string): number {
  const a = new Date(since + "T00:00:00Z").getTime();
  const b = new Date(until + "T00:00:00Z").getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Map one Pipeboard row to a DerivedMetrics object.
 * Uses the same field derivation logic as meta-api.ts's derive().
 */
function rowToMetrics(row: PbRow): DerivedMetrics {
  const impressions = Number(row.impressions || 0);
  const spend       = Number(row.spend       || 0);
  const reach       = Number(row.reach       || 0);
  // Pipeboard pre-computes CTR as a percentage (e.g. 3.32 = 3.32%)
  const ctr         = Number(row.ctr         || 0);
  const cpmRow      = Number(row.cpm         || 0);
  const clicks      = Number(row.clicks      || 0);

  // Link clicks: prefer link_click action, fallback to CTR-derived estimate
  const linkClicksFromActions = av(row.actions, "link_click");
  const link_clicks = linkClicksFromActions > 0
    ? linkClicksFromActions
    : (ctr > 0 && impressions > 0 ? Math.round((ctr / 100) * impressions) : 0);

  const lpv          = av(row.actions, "landing_page_view");
  const purchases    = avPurchase(row.actions);
  // CPA: prefer Meta pre-computed, fall back to spend/purchases
  const cpaFromMeta  = avPurchase(row.cost_per_action_type);
  const cpa          = cpaFromMeta > 0 ? cpaFromMeta : (purchases ? spend / purchases : 0);

  const videoPlayActions = Array.isArray(row.video_play_actions) ? row.video_play_actions as Array<{action_type:string;value:string}> : [];
  const video_plays  = videoPlayActions.length > 0 ? Number(videoPlayActions.find((a) => a.action_type === "video_view")?.value ?? 0) : av(row.actions, "video_view");
  const frequency    = reach > 0 ? impressions / reach : Number(row.frequency || 0);
  const cpm          = impressions ? (spend / impressions) * 1000 : cpmRow;
  const cpc          = link_clicks ? spend / link_clicks : 0;
  const lpvRate      = link_clicks ? (lpv / link_clicks) * 100 : 0;
  const crLpv        = lpv ? (purchases / lpv) * 100 : 0;
  const crClick      = link_clicks ? (purchases / link_clicks) * 100 : 0;
  const hookRate     = impressions > 0 ? (video_plays / impressions) * 100 : 0;

  return {
    spend, impressions, reach, clicks, link_clicks, lpv, purchases,
    v3: 0, v25: 0, v50: 0, v75: 0, v95: 0, v100: 0, video_plays,
    ctr, cpc, cpm, cpa, lpvRate, crLpv, crClick, hookRate,
    holdRate: 0, // thruplay not available from Pipeboard
    frequency,
  };
}

/** Aggregate an array of Pipeboard rows into a single DerivedMetrics (totals). */
function aggregateRows(rows: PbRow[]): DerivedMetrics {
  let spend = 0, impressions = 0, reach = 0, clicks = 0,
    link_clicks = 0, lpv = 0, purchases = 0, video_plays = 0;
  for (const row of rows) {
    const m = rowToMetrics(row);
    spend       += m.spend;
    impressions += m.impressions;
    reach       += m.reach;
    clicks      += m.clicks;
    link_clicks += m.link_clicks;
    lpv         += m.lpv;
    purchases   += m.purchases;
    video_plays += m.video_plays;
  }
  // Re-derive so ratio metrics are computed from aggregated counts (not averaged)
  return derive({
    spend, impressions, reach, clicks, link_clicks, lpv, purchases, video_plays,
    v3: 0, v25: 0, v50: 0, v75: 0, v95: 0, v100: 0,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List campaigns for an ad account using Pipeboard.
 * Returns CampaignSummary[] — same shape as listCampaigns() in meta-api.ts.
 *
 * NOTE: Pipeboard insights don't include effective_status, so we default to
 * "ACTIVE" for all campaigns (only campaigns with spend in the period are returned).
 */
export async function pbListCampaigns(
  accountId: string,
  since: string,
  until: string
): Promise<CampaignSummary[]> {
  const objectId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const raw = await callPipeboardTool("get_insights", {
    object_id: objectId,
    level: "campaign",
    time_range: { since, until },
    fields: PB_FIELDS,
  });
  const rows = parseRows(raw);
  return rows
    .filter(r => r.campaign_id)
    .map(row => {
      const m = rowToMetrics(row);
      return {
        id:               String(row.campaign_id || ""),
        name:             String(row.campaign_name || ""),
        status:           "ACTIVE",
        effective_status: "ACTIVE",
        objective:        "",
        spend:            m.spend,
        purchases:        m.purchases,
        cpa:              m.cpa,
        impressions:      m.impressions,
        link_clicks:      m.link_clicks,
        ctr:              m.ctr,
        hookRate:         m.hookRate,
        holdRate:         0,
        updated_time:     undefined,
      } satisfies CampaignSummary;
    });
}

/**
 * Account-level overview using Pipeboard.
 * Returns AccountOverview — same shape as getAccountOverview() in meta-api.ts.
 *
 * Limitations vs native Meta:
 *  - effective_status defaults to "ACTIVE" (Pipeboard insights don't include it)
 *  - holdRate = 0 (thruplay not available)
 *  - ad_issues = [] (Pipeboard has no ad-level issues endpoint)
 *  - daily trend uses time_increment=1 if Pipeboard supports it; empty array otherwise
 */
export async function pbGetAccountOverview(
  accountId: string,
  since: string,
  until: string
): Promise<AccountOverview> {
  const objectId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const days = daysBetween(since, until);

  // Previous period (same length, right before `since`)
  const prevUntil = new Date(new Date(since + "T00:00:00Z").getTime() - 86_400_000)
    .toISOString().slice(0, 10);
  const prevSince = new Date(new Date(since + "T00:00:00Z").getTime() - days * 86_400_000)
    .toISOString().slice(0, 10);

  // Fire all Pipeboard calls concurrently
  const [campaignRaw, dailyRaw, prevRaw] = await Promise.all([
    // 1) Current period — campaign-level (to get per-campaign breakdown)
    callPipeboardTool("get_insights", {
      object_id: objectId,
      level: "campaign",
      time_range: { since, until },
      fields: PB_FIELDS,
    }),
    // 2) Current period — daily breakdown (time_increment=1)
    // Pipeboard may or may not support time_increment; degrade gracefully if not.
    callPipeboardTool("get_insights", {
      object_id: objectId,
      level: "account",
      time_range: { since, until },
      time_increment: 1,
      fields: ["impressions", "spend", "reach", "actions", "cost_per_action_type"],
    }).catch(() => ""),
    // 3) Previous period — account-level totals
    callPipeboardTool("get_insights", {
      object_id: objectId,
      level: "account",
      time_range: { since: prevSince, until: prevUntil },
      fields: ["impressions", "spend", "reach", "actions", "cost_per_action_type"],
    }).catch(() => ""),
  ]);

  const campaignRows = parseRows(campaignRaw);
  const dailyRows    = parseRows(dailyRaw);
  const prevRows     = parseRows(prevRaw);

  // ── Totals (aggregated from all campaign rows) ────────────────────────────
  const totals     = aggregateRows(campaignRows);
  const prev_totals = aggregateRows(prevRows);

  // ── Per-campaign summary ──────────────────────────────────────────────────
  const campaigns: CampaignSummaryFull[] = campaignRows
    .filter(r => r.campaign_id)
    .map(row => {
      const m = rowToMetrics(row);
      return {
        id:               String(row.campaign_id || ""),
        name:             String(row.campaign_name || ""),
        status:           "ACTIVE",
        effective_status: "ACTIVE",
        objective:        "",
        spend:            m.spend,
        purchases:        m.purchases,
        cpa:              m.cpa,
        impressions:      m.impressions,
        reach:            m.reach,
        frequency:        m.frequency,
        link_clicks:      m.link_clicks,
        lpv:              m.lpv,
        ctr:              m.ctr,
        cpm:              m.cpm,
        cpc:              m.cpc,
        cr:               m.crLpv,
        hookRate:         m.hookRate,
        video_plays:      m.video_plays,
        v95:              0,
      } satisfies CampaignSummaryFull;
    })
    .sort((a, b) => b.spend - a.spend);

  // ── Daily trend ───────────────────────────────────────────────────────────
  // Only populated if Pipeboard returned rows with date_start (time_increment supported)
  const daily: DailyPoint[] = dailyRows
    .filter(r => r.date_start)
    .sort((a, b) => (a.date_start! < b.date_start! ? -1 : 1))
    .map(row => {
      const m = rowToMetrics(row);
      return {
        day:         row.date_start!,
        spend:       m.spend,
        impressions: m.impressions,
        reach:       m.reach,
        frequency:   m.frequency,
        link_clicks: m.link_clicks,
        lpv:         m.lpv,
        purchases:   m.purchases,
        cpa:         m.cpa,
      } satisfies DailyPoint;
    });

  return {
    account_id: accountId,
    period:     { since, until, days },
    totals,
    prev_totals,
    daily,
    campaigns,
    ad_issues:  [], // not available via Pipeboard
    fetched_at: new Date().toISOString(),
  } satisfies AccountOverview;
}

/**
 * Full campaign insights using Pipeboard.
 * Returns CampaignInsights — same shape as getCampaignInsights() in meta-api.ts.
 *
 * Limitations vs native Meta:
 *  - holdRate = 0 (thruplay not returned by Pipeboard)
 *  - daily_by_adset / daily_by_ad = [] (time_increment at adset/ad level not attempted)
 *  - campaign.status = "UNKNOWN" (insights don't return status)
 */
export async function pbGetCampaignInsights(
  campaign_id: string,
  since: string,
  until: string
): Promise<CampaignInsights> {
  const [adsetRaw, adRaw] = await Promise.all([
    // Adset-level breakdown for this campaign
    callPipeboardTool("get_insights", {
      object_id: campaign_id,
      level: "adset",
      time_range: { since, until },
      fields: PB_FIELDS,
    }),
    // Ad-level breakdown for this campaign
    callPipeboardTool("get_insights", {
      object_id: campaign_id,
      level: "ad",
      time_range: { since, until },
      fields: PB_FIELDS,
    }).catch(() => ""),
  ]);

  const adsetRows = parseRows(adsetRaw);
  const adRows    = parseRows(adRaw);

  // Campaign name from first row that has it
  const anyRow     = adsetRows[0] ?? adRows[0];
  const campaignName = String(anyRow?.campaign_name || campaign_id);

  // ── Totals (aggregate all adset rows) ────────────────────────────────────
  const totals = aggregateRows(adsetRows);

  // ── Daily trend — if Pipeboard returned date_start on campaign-level we use it
  // (currently we skip a 3rd call here for simplicity; daily = [])
  const daily: DailyPoint[] = [];

  // ── By adset ─────────────────────────────────────────────────────────────
  const adsetMap = new Map<string, { name: string; m: DerivedMetrics }>();
  for (const row of adsetRows) {
    if (!row.adset_id) continue;
    const existing = adsetMap.get(row.adset_id);
    if (existing) {
      // Merge (in case of multiple date rows for same adset)
      const merged = aggregateRows([
        { ...row, spend: existing.m.spend, impressions: existing.m.impressions } as PbRow,
        row,
      ]);
      adsetMap.set(row.adset_id, { name: existing.name, m: merged });
    } else {
      adsetMap.set(row.adset_id, {
        name: String(row.adset_name || row.adset_id),
        m:    rowToMetrics(row),
      });
    }
  }
  const by_adset: SegmentEntry[] = [...adsetMap.entries()]
    .map(([id, { name, m }]) => ({
      key: id, id, label: name,
      spend: m.spend, impressions: m.impressions, reach: m.reach,
      frequency: m.frequency, link_clicks: m.link_clicks, lpv: m.lpv,
      purchases: m.purchases, cpa: m.cpa, cpm: m.cpm, cpc: m.cpc,
      ctr: m.ctr, cr: m.crLpv, hookRate: m.hookRate, holdRate: 0, lpvRate: m.lpvRate,
    } satisfies SegmentEntry))
    .sort((a, b) => b.spend - a.spend);

  // ── By ad ─────────────────────────────────────────────────────────────────
  const adMap = new Map<string, { name: string; adset_id: string; m: DerivedMetrics }>();
  for (const row of adRows) {
    if (!row.ad_id) continue;
    const existing = adMap.get(row.ad_id);
    if (existing) {
      const merged = aggregateRows([row, row]);
      adMap.set(row.ad_id, { name: existing.name, adset_id: existing.adset_id, m: merged });
    } else {
      adMap.set(row.ad_id, {
        name:     String(row.ad_name || row.ad_id),
        adset_id: String(row.adset_id || ""),
        m:        rowToMetrics(row),
      });
    }
  }
  const by_ad: SegmentEntry[] = [...adMap.entries()]
    .map(([id, { name, adset_id, m }]) => ({
      key: id, id, label: name,
      spend: m.spend, impressions: m.impressions, reach: m.reach,
      frequency: m.frequency, link_clicks: m.link_clicks, lpv: m.lpv,
      purchases: m.purchases, cpa: m.cpa, cpm: m.cpm, cpc: m.cpc,
      ctr: m.ctr, cr: m.crLpv, hookRate: m.hookRate, holdRate: 0, lpvRate: m.lpvRate,
      adset_id,
    } satisfies SegmentEntry))
    .sort((a, b) => b.spend - a.spend);

  const days = daysBetween(since, until);
  return {
    campaign: {
      id:               campaign_id,
      name:             campaignName,
      status:           "UNKNOWN",
      effective_status: "ACTIVE",
      objective:        "UNKNOWN",
    },
    period:         { since, until, days },
    totals,
    daily,
    by_adset,
    by_ad,
    daily_by_adset: [] as DailySegmentPoint[],
    daily_by_ad:    [] as DailySegmentPoint[],
    fetched_at:     new Date().toISOString(),
  } satisfies CampaignInsights;
}
