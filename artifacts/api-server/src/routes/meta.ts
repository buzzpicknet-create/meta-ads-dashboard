import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth-middleware";
import {
  listCampaigns,
  listAdSetRefs,
  getCampaignInsights,
  getAccountInfo,
  listAdAccounts,
  getAccountOverview,
  getCpaAlerts,
  getAccountActivities,
  getAdsWithCreatives,
  getAdBreakdowns,
  isRateLimitActive,
  getCampaignDetails,
  getAdsetDetails,
} from "../lib/meta-api";
import { getTokenInfo, refreshLongLivedToken, validateTokenWithMeta, updateAccessToken } from "../lib/meta-token";
import { logger } from "../lib/logger";
import { query } from "../lib/db";
import { upsertCampaignNameCache } from "../lib/campaign-name-cache";
import {
  pbListCampaigns,
  pbGetAccountOverview,
  pbGetCampaignInsights,
} from "../lib/pipeboard-meta";

const router: IRouter = Router();

// ── In-memory cache for slow creative-intelligence endpoint ──────────────────
const CREATIVE_CACHE = new Map<string, { data: unknown; ts: number }>();
const CREATIVE_TTL_MS = 60 * 60 * 1000; // 60 minutes

// ── In-memory cache for breakdown data ───────────────────────────────────────
const BREAKDOWN_CACHE = new Map<string, { data: unknown; ts: number }>();
const BREAKDOWN_TTL_MS = 60 * 60 * 1000; // 60 minutes

// ── In-memory cache for activities ───────────────────────────────────────────
const ACTIVITIES_CACHE = new Map<string, { data: unknown; ts: number }>();
const ACTIVITIES_TTL_MS = 60 * 60 * 1000; // 60 minutes

// ── In-memory cache for adsets ────────────────────────────────────────────────
const ADSETS_CACHE = new Map<string, { data: unknown; ts: number }>();
const ADSETS_TTL_MS = 60 * 60 * 1000; // 60 minutes (adsets rarely change)

// ── Cache warm-up status ──────────────────────────────────────────────────────
export interface CacheWarmupStats {
  insights: number;
  campaigns: number;
  overview: number;
  campaign_details: number;
  adset_details: number;
  skipped: number;
  ran_at: string;
  duration_ms: number;
}

const WARMUP_HISTORY_MAX = 10;
const warmupHistory: CacheWarmupStats[] = [];
let warmupInProgress = false;

export function getLastWarmupStats() {
  return {
    stats: warmupHistory.length > 0 ? warmupHistory[warmupHistory.length - 1] : null,
    history: warmupHistory.slice(),
    inProgress: warmupInProgress,
  };
}

export function setLastWarmupStats(stats: Omit<CacheWarmupStats, "ran_at" | "duration_ms"> & { ran_at: string; duration_ms: number }) {
  warmupHistory.push(stats);
  if (warmupHistory.length > WARMUP_HISTORY_MAX) {
    warmupHistory.splice(0, warmupHistory.length - WARMUP_HISTORY_MAX);
  }
  warmupInProgress = false;
  query(
    `INSERT INTO cache_warmup_log (ran_at, duration_ms, insights, campaigns, overview, campaign_details, adset_details, skipped)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [stats.ran_at, stats.duration_ms, stats.insights, stats.campaigns, stats.overview, stats.campaign_details, stats.adset_details, stats.skipped]
  ).then(() =>
    query(
      `DELETE FROM cache_warmup_log WHERE id NOT IN (
         SELECT id FROM cache_warmup_log ORDER BY ran_at DESC LIMIT 200
       )`
    )
  ).catch((err) => logger.warn({ err }, "Failed to persist warmup stats to DB"));
}

export function setWarmupInProgress(v: boolean) {
  warmupInProgress = v;
}

export async function rehydrateWarmupHistory() {
  try {
    const rows = await query<{
      ran_at: string;
      duration_ms: number;
      insights: number;
      campaigns: number;
      overview: number;
      campaign_details: number;
      adset_details: number;
      skipped: number;
    }>(
      `SELECT ran_at, duration_ms, insights, campaigns, overview, campaign_details, adset_details, skipped
       FROM cache_warmup_log
       ORDER BY ran_at DESC
       LIMIT ${WARMUP_HISTORY_MAX}`
    );
    if (rows.length === 0) return;
    const loaded: CacheWarmupStats[] = rows.reverse().map((r) => ({
      ran_at: r.ran_at,
      duration_ms: Number(r.duration_ms),
      insights: Number(r.insights),
      campaigns: Number(r.campaigns),
      overview: Number(r.overview),
      campaign_details: Number(r.campaign_details),
      adset_details: Number(r.adset_details),
      skipped: Number(r.skipped),
    }));
    warmupHistory.push(...loaded);
    logger.info({ count: loaded.length }, "Warm-up history rehydrated from DB");
  } catch (err) {
    logger.warn({ err }, "Failed to rehydrate warm-up history from DB");
  }
}

// ── Campaigns cache — fallback when Meta rate-limits this ad account ──────────
const CAMPAIGNS_CACHE = new Map<string, { data: unknown; ts: number }>();
const CAMPAIGNS_TTL_MS = 60 * 60 * 1000; // 60 minutes

// ── In-flight deduplication: collapse concurrent identical Meta requests ──────
// Key = "campaign_id::since::until" → Promise of the result
// This prevents N concurrent requests for the same data from all hitting Meta.
const INSIGHTS_IN_FLIGHT = new Map<string, Promise<unknown>>();

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("80004") ||
    msg.includes("(17)") ||
    msg.toLowerCase().includes("too many calls") ||
    msg.toLowerCase().includes("user request limit") ||
    msg.toLowerCase().includes("rate limit")
  );
}

// ── DB helpers for insights cache ─────────────────────────────────────────────
const INSIGHTS_FRESH_MS  = 60 * 60 * 1000; // 60 min fresh window
const OVERVIEW_FRESH_MS  = 60 * 60 * 1000;
const CPA_FRESH_MS       = 15 * 60 * 1000;

async function dbGetInsightsCache(campaignId: string, since: string, until: string) {
  const rows = await query<{ data: unknown; fetched_at: string }>(
    `SELECT data, fetched_at FROM meta_insights_cache
     WHERE campaign_id=$1 AND period_since=$2 AND period_until=$3`,
    [campaignId, since, until]
  );
  return rows[0] ?? null;
}
async function dbSetInsightsCache(campaignId: string, since: string, until: string, data: unknown) {
  await query(
    `INSERT INTO meta_insights_cache (campaign_id, period_since, period_until, data, fetched_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (campaign_id, period_since, period_until)
     DO UPDATE SET data=$4, fetched_at=NOW()`,
    [campaignId, since, until, JSON.stringify(data)]
  );
}

async function dbGetOverviewCache(accountId: string, since: string, until: string) {
  const rows = await query<{ data: unknown; fetched_at: string }>(
    `SELECT data, fetched_at FROM meta_overview_cache
     WHERE account_id=$1 AND period_since=$2 AND period_until=$3`,
    [accountId, since, until]
  );
  return rows[0] ?? null;
}
async function dbSetOverviewCache(accountId: string, since: string, until: string, data: unknown) {
  await query(
    `INSERT INTO meta_overview_cache (account_id, period_since, period_until, data, fetched_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (account_id, period_since, period_until)
     DO UPDATE SET data=$4, fetched_at=NOW()`,
    [accountId, since, until, JSON.stringify(data)]
  );
}

async function dbGetCpaAlertsCache(accountId: string) {
  const rows = await query<{ data: unknown; fetched_at: string }>(
    `SELECT data, fetched_at FROM meta_cpa_alerts_cache WHERE account_id=$1`,
    [accountId]
  );
  return rows[0] ?? null;
}
async function dbSetCpaAlertsCache(accountId: string, data: unknown) {
  await query(
    `INSERT INTO meta_cpa_alerts_cache (account_id, data, fetched_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (account_id) DO UPDATE SET data=$2, fetched_at=NOW()`,
    [accountId, JSON.stringify(data)]
  );
}

export async function warmCreativeCache(accountId: string, since: string, until: string): Promise<void> {
  const cacheKey = `${accountId}::${since}::${until}`;
  const hit = CREATIVE_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < CREATIVE_TTL_MS) return; // already warm
  try {
    const ads = await getAdsWithCreatives({ adAccountId: accountId, since, until });
    const payload = { account_id: accountId, period: { since, until }, fetched_at: new Date().toISOString(), ads };
    CREATIVE_CACHE.set(cacheKey, { data: payload, ts: Date.now() });
    logger.info({ account_id: accountId, count: ads.length, since, until }, "Creative cache warmed");
  } catch (err) {
    logger.warn({ err, account_id: accountId }, "Creative cache warm failed — will retry on first user request");
  }
}

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

function todayInCairo(): string {
  // Egypt is GMT+2 with no DST currently (since 2023). Use server "now" + 2h.
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function nDaysAgo(n: number): string {
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() - n);
  return now.toISOString().slice(0, 10);
}

function parseRange(q: {
  since?: string;
  until?: string;
  days?: string;
}): { since: string; until: string } {
  if (q.since && q.until) {
    if (!DATE_RX.test(q.since) || !DATE_RX.test(q.until)) {
      throw new Error("Invalid date format. Expected YYYY-MM-DD");
    }
    return { since: q.since, until: q.until };
  }
  const days = q.days ? Math.max(1, Math.min(365, Number(q.days))) : 7;
  // until = yesterday (full-day data), since = until - (days - 1)
  const until = nDaysAgo(1);
  const since = nDaysAgo(days);
  return { since, until };
}

router.get("/meta/health", async (_req, res) => {
  try {
    const info = getTokenInfo();
    const validation = await validateTokenWithMeta();
    res.json({
      ok: validation.valid,
      token: {
        ...info,
        fb_valid: validation.valid,
        fb_error: validation.error,
        fb_user_id: validation.user_id,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/meta/refresh-token", requireAdmin, async (_req, res) => {
  try {
    const t = await refreshLongLivedToken();
    res.json({
      ok: true,
      expires_at: t.expires_at,
      issued_at: t.issued_at,
    });
  } catch (err) {
    logger.error({ err }, "Token refresh failed");
    res
      .status(500)
      .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /meta/token — admin only: save a new access token (e.g. after manual Facebook refresh)
router.post("/meta/token", requireAdmin, async (req, res) => {
  try {
    const { access_token, app_id } = req.body as {
      access_token?: string;
      app_id?: string;
    };
    if (!access_token?.trim()) {
      res.status(400).json({ ok: false, error: "access_token مطلوب" });
      return;
    }
    const t = await updateAccessToken(access_token.trim(), app_id?.trim());
    res.json({
      ok: true,
      expires_at: t.expires_at,
      issued_at: t.issued_at,
      app_id: t.app_id,
    });
  } catch (err) {
    logger.error({ err }, "Token update failed");
    res
      .status(500)
      .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/account", async (_req, res) => {
  try {
    const data = await getAccountInfo();
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Account fetch failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/accounts", async (_req, res) => {
  try {
    const accounts = await listAdAccounts();
    res.json({ accounts });
  } catch (err) {
    logger.error({ err }, "Accounts fetch failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── DB helpers for persistent campaigns cache ─────────────────────────────────
const CAMPAIGNS_FRESH_MS = 60 * 60 * 1000; // serve DB cache without hitting Meta if < 60 min old

async function dbGetCampaignsCache(accountId: string, since: string, until: string) {
  const rows = await query<{ campaigns: unknown; fetched_at: string }>(
    `SELECT campaigns, fetched_at FROM meta_campaigns_cache
     WHERE account_id=$1 AND period_since=$2 AND period_until=$3`,
    [accountId, since, until]
  );
  return rows[0] ?? null;
}

async function dbSetCampaignsCache(accountId: string, since: string, until: string, campaigns: unknown) {
  await query(
    `INSERT INTO meta_campaigns_cache (account_id, period_since, period_until, campaigns, fetched_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (account_id, period_since, period_until)
     DO UPDATE SET campaigns=$4, fetched_at=NOW()`,
    [accountId, since, until, JSON.stringify(campaigns)]
  );
  // Write-through: keep campaign_name_cache up to date whenever we receive fresh campaign data
  const arr = Array.isArray(campaigns) ? campaigns : [];
  const entries = (arr as { id?: string; name?: string }[])
    .filter((c) => c.id && c.name)
    .map((c) => ({ id: c.id!, name: c.name! }));
  upsertCampaignNameCache(entries).catch(() => null);
}

router.get("/meta/campaigns", async (req, res) => {
  const rawAccountId = String(req.query["ad_account_id"] || "").trim();
  // normalise: strip act_ prefix for cache key consistency
  const accountId = rawAccountId.startsWith("act_") ? rawAccountId.slice(4) : rawAccountId;

  let since: string, until: string;
  try {
    ({ since, until } = parseRange(req.query as Record<string, string>));
  } catch (parseErr) {
    return res.status(400).json({ error: String(parseErr) });
  }

  // ① Check DB cache — if fresh enough, serve immediately (no Meta call)
  const cached = await dbGetCampaignsCache(accountId, since, until).catch(() => null);
  const cacheAge = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;

  if (cached && cacheAge < CAMPAIGNS_FRESH_MS) {
    logger.info({ accountId, age_s: Math.round(cacheAge / 1000) }, "Campaigns served from DB cache (fresh)");
    return res.json({
      account_id: rawAccountId || undefined,
      period: { since, until },
      fetched_at: cached.fetched_at,
      campaigns: cached.campaigns,
      from_cache: true,
    });
  }

  // ② Try Pipeboard first (no expired-token risk)
  try {
    const campaigns = await pbListCampaigns(accountId, since, until);
    if (campaigns.length > 0) {
      if (accountId) await dbSetCampaignsCache(accountId, since, until, campaigns).catch(() => null);
      CAMPAIGNS_CACHE.set(`${accountId}::${since}::${until}`, { data: campaigns, ts: Date.now() });
      logger.info({ accountId, count: campaigns.length }, "Campaigns served from Pipeboard");
      return res.json({
        account_id: rawAccountId || undefined,
        period: { since, until },
        fetched_at: new Date().toISOString(),
        campaigns,
        source: "pipeboard",
      });
    }
    logger.info({ accountId }, "Pipeboard returned 0 campaigns — falling back to native Meta");
  } catch (pbErr) {
    logger.warn({ err: pbErr, accountId }, "Pipeboard campaigns failed — falling back to native Meta");
  }

  // ③ Fall back to native Meta API
  try {
    const campaigns = await listCampaigns({ since, until, adAccountId: rawAccountId || undefined });
    if (accountId) await dbSetCampaignsCache(accountId, since, until, campaigns).catch(() => null);
    CAMPAIGNS_CACHE.set(`${accountId}::${since}::${until}`, { data: campaigns, ts: Date.now() });
    return res.json({
      account_id: rawAccountId || undefined,
      period: { since, until },
      fetched_at: new Date().toISOString(),
      campaigns,
    });
  } catch (err) {
    if (isRateLimitError(err)) {
      // ④ Rate limited — serve DB cache regardless of age
      if (cached) {
        logger.warn({ accountId, age_s: Math.round(cacheAge / 1000) }, "Meta rate-limited — serving stale DB cache");
        return res.json({
          account_id: rawAccountId || undefined,
          period: { since, until },
          fetched_at: cached.fetched_at,
          campaigns: cached.campaigns,
          from_cache: true,
          rate_limited: true,
        });
      }
      const mem = CAMPAIGNS_CACHE.get(`${accountId}::${since}::${until}`);
      if (mem) {
        logger.warn({ accountId }, "Meta rate-limited — serving in-memory cache");
        return res.json({
          account_id: rawAccountId || undefined,
          period: { since, until },
          fetched_at: new Date(mem.ts).toISOString(),
          campaigns: mem.data,
          from_cache: true,
          rate_limited: true,
        });
      }
      logger.warn({ err, accountId }, "Meta rate-limited — no cache available at all");
      return res.status(429).json({
        error: "الحساب وصل للحد المسموح به مؤقتاً من Meta — لا توجد بيانات محفوظة بعد. انتظري دقيقتين ثم أعيدي تحديث الصفحة.",
        rate_limited: true,
      });
    }
    // Serve stale cache if both Pipeboard and Meta failed
    if (cached) {
      logger.warn({ err, accountId, age_s: Math.round(cacheAge / 1000) }, "Both Pipeboard and Meta failed — serving stale DB cache");
      return res.json({
        account_id: rawAccountId || undefined,
        period: { since, until },
        fetched_at: cached.fetched_at,
        campaigns: cached.campaigns,
        from_cache: true,
      });
    }
    logger.error({ err }, "Campaigns fetch failed — no fallback available");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/adsets", async (req, res) => {
  try {
    const accountId = String(req.query["ad_account_id"] || "").trim();
    if (!accountId) return res.status(400).json({ error: "ad_account_id required" });

    const hit = ADSETS_CACHE.get(accountId);
    if (hit && Date.now() - hit.ts < ADSETS_TTL_MS) {
      logger.info({ accountId, cached: true }, "Adsets served from cache");
      return res.json(hit.data);
    }

    const adsets = await listAdSetRefs(accountId);
    const payload = { ad_account_id: accountId, fetched_at: new Date().toISOString(), adsets };
    ADSETS_CACHE.set(accountId, { data: payload, ts: Date.now() });
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "Adsets fetch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/insights", async (req, res) => {
  const campaign_id = String(req.query["campaign_id"] || "");
  const accountId   = String(req.query["ad_account_id"] || "").trim();
  if (!campaign_id) {
    res.status(400).json({ error: "campaign_id is required" });
    return;
  }
  let since: string, until: string;
  try { ({ since, until } = parseRange(req.query as Record<string, string>)); }
  catch (e) { return res.status(400).json({ error: String(e) }); }

  // ① Check DB cache — also validate it has the new daily_by_adset/daily_by_ad fields
  const cached = await dbGetInsightsCache(campaign_id, since, until).catch(() => null);
  const cachedData = cached?.data as Record<string, unknown> | undefined;
  const cacheHasNewFields = Array.isArray(cachedData?.daily_by_adset);
  const cacheAge = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (cached && cacheAge < INSIGHTS_FRESH_MS && cacheHasNewFields) {
    logger.info({ campaign_id, age_s: Math.round(cacheAge / 1000) }, "Insights served from DB cache (fresh)");
    return res.json({ ...(cached.data as object), account_id: accountId || undefined, from_cache: true });
  }

  const inflight_key = `${campaign_id}::${since}::${until}`;

  // ② Try Pipeboard first
  try {
    const data = await pbGetCampaignInsights(campaign_id, since, until);
    // Only trust Pipeboard result if it has real data (spend > 0 or adsets returned)
    const hasData = data.totals.spend > 0 || data.by_adset.length > 0;
    if (hasData) {
      await dbSetInsightsCache(campaign_id, since, until, data).catch(() => null);
      if (data.campaign.name && data.campaign.name !== campaign_id) {
        upsertCampaignNameCache([{ id: campaign_id, name: data.campaign.name }]).catch(() => null);
      }
      logger.info({ campaign_id }, "Insights served from Pipeboard");
      return res.json({ ...data, account_id: accountId || undefined, source: "pipeboard" });
    }
    logger.info({ campaign_id }, "Pipeboard insights empty — falling back to native Meta");
  } catch (pbErr) {
    logger.warn({ err: pbErr, campaign_id }, "Pipeboard insights failed — falling back to native Meta");
  }

  // ③ Fetch from native Meta — deduplicate concurrent identical requests
  try {
    let fetchPromise = INSIGHTS_IN_FLIGHT.get(inflight_key) as Promise<Awaited<ReturnType<typeof getCampaignInsights>>> | undefined;
    if (!fetchPromise) {
      fetchPromise = getCampaignInsights({ campaign_id, since, until });
      INSIGHTS_IN_FLIGHT.set(inflight_key, fetchPromise);
      fetchPromise.finally(() => INSIGHTS_IN_FLIGHT.delete(inflight_key)).catch(() => {});
    } else {
      logger.info({ campaign_id }, "Insights request deduplicated (in-flight)");
    }
    const data = await fetchPromise;
    await dbSetInsightsCache(campaign_id, since, until, data).catch(() => null);
    if (data.campaign.name) {
      upsertCampaignNameCache([{ id: campaign_id, name: data.campaign.name }]).catch(() => null);
    }
    return res.json({ ...data, account_id: accountId || undefined });
  } catch (err) {
    INSIGHTS_IN_FLIGHT.delete(inflight_key);
    if (isRateLimitError(err)) {
      if (cached) {
        logger.warn({ campaign_id, age_s: Math.round(cacheAge / 1000) }, "Meta rate-limited — serving stale insights cache");
        return res.json({ ...(cached.data as object), account_id: accountId || undefined, from_cache: true, rate_limited: true });
      }
      const retryMsg = err instanceof Error ? err.message : "";
      const retryMatch = retryMsg.match(/retry in (\d+)s/);
      const retry_in_s = retryMatch ? parseInt(retryMatch[1], 10) : 90;
      logger.warn({ campaign_id, retry_in_s }, "Meta rate-limited — no insights cache available");
      return res.status(429).json({
        error: "الحملة مش متاحة دلوقتي — Meta وصلت للحد المسموح مؤقتاً.",
        rate_limited: true,
        retry_in_s,
      });
    }
    logger.error({ err }, "Insights fetch failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/account-overview", async (req, res) => {
  const accountId = String(req.query["ad_account_id"] || "").trim();
  if (!accountId) {
    res.status(400).json({ error: "ad_account_id is required" });
    return;
  }
  let since: string, until: string;
  try { ({ since, until } = parseRange(req.query as Record<string, string>)); }
  catch (e) { return res.status(400).json({ error: String(e) }); }

  // ① Check DB cache
  const cached = await dbGetOverviewCache(accountId, since, until).catch(() => null);
  const cacheAge = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (cached && cacheAge < OVERVIEW_FRESH_MS) {
    logger.info({ accountId, age_s: Math.round(cacheAge / 1000) }, "Overview served from DB cache (fresh)");
    return res.json({ ...(cached.data as object), from_cache: true });
  }

  // ② Try Pipeboard first
  try {
    const data = await pbGetAccountOverview(accountId, since, until);
    const hasData = data.totals.spend > 0 || data.campaigns.length > 0;
    if (hasData) {
      await dbSetOverviewCache(accountId, since, until, data).catch(() => null);
      logger.info({ accountId, campaigns: data.campaigns.length }, "Overview served from Pipeboard");
      return res.json({ ...data, source: "pipeboard" });
    }
    logger.info({ accountId }, "Pipeboard overview empty — falling back to native Meta");
  } catch (pbErr) {
    logger.warn({ err: pbErr, accountId }, "Pipeboard overview failed — falling back to native Meta");
  }

  // ③ Fetch from native Meta
  try {
    const data = await getAccountOverview({ adAccountId: accountId, since, until });
    await dbSetOverviewCache(accountId, since, until, data).catch(() => null);
    return res.json(data);
  } catch (err) {
    if (isRateLimitError(err)) {
      if (cached) {
        logger.warn({ accountId, age_s: Math.round(cacheAge / 1000) }, "Meta rate-limited — serving stale overview cache");
        return res.json({ ...(cached.data as object), from_cache: true, rate_limited: true });
      }
      logger.warn({ accountId }, "Meta rate-limited — no overview cache available");
      return res.status(429).json({
        error: "نظرة عامة مش متاحة دلوقتي — Meta وصلت للحد المسموح مؤقتاً. البيانات هتظهر تاني خلال دقيقتين.",
        rate_limited: true,
      });
    }
    // Serve stale cache if both failed
    if (cached) {
      logger.warn({ err, accountId, age_s: Math.round(cacheAge / 1000) }, "Both Pipeboard and Meta failed — serving stale overview cache");
      return res.json({ ...(cached.data as object), from_cache: true });
    }
    logger.error({ err }, "Account overview fetch failed — no fallback available");
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/cpa-alerts", async (req, res) => {
  const accountId = String(req.query["ad_account_id"] || "").trim();
  if (!accountId) {
    res.status(400).json({ error: "ad_account_id is required" });
    return;
  }

  // ① Check DB cache
  const cached = await dbGetCpaAlertsCache(accountId).catch(() => null);
  const cacheAge = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (cached && cacheAge < CPA_FRESH_MS) {
    logger.info({ accountId, age_s: Math.round(cacheAge / 1000) }, "CPA alerts served from DB cache (fresh)");
    return res.json({ ...(cached.data as object), from_cache: true });
  }

  // ② Fetch from Meta
  try {
    const data = await getCpaAlerts({ adAccountId: accountId });
    await dbSetCpaAlertsCache(accountId, data).catch(() => null);
    return res.json(data);
  } catch (err) {
    if (isRateLimitError(err)) {
      if (cached) {
        logger.warn({ accountId, age_s: Math.round(cacheAge / 1000) }, "Meta rate-limited — serving stale CPA alerts cache");
        return res.json({ ...(cached.data as object), from_cache: true, rate_limited: true });
      }
      logger.warn({ accountId }, "Meta rate-limited — no CPA alerts cache available");
      return res.status(429).json({
        error: "تنبيهات CPA مش متاحة دلوقتي — Meta وصلت للحد المسموح مؤقتاً.",
        rate_limited: true,
      });
    }
    logger.error({ err }, "CPA alerts fetch failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/today", (_req, res) => {
  res.json({ today_cairo: todayInCairo() });
});

// ── GET /api/meta/activities ─────────────────────────────────
// Real Media Buyer activity log from Meta — what actually happened on campaigns
router.get("/meta/activities", async (req, res) => {
  try {
    const accountId = String(req.query["ad_account_id"] || "").trim();
    if (!accountId) {
      res.status(400).json({ error: "ad_account_id is required" });
      return;
    }
    const { since, until } = parseRange({
      since: req.query["since"] as string | undefined,
      until: req.query["until"] as string | undefined,
      days: (req.query["days"] as string | undefined) ?? "14",
    });

    const cacheKey = `${accountId}::${since}::${until}`;
    const hit = ACTIVITIES_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.ts < ACTIVITIES_TTL_MS) {
      logger.info({ accountId, cached: true, since, until }, "Activities served from cache");
      return res.json(hit.data);
    }

    const activities = await getAccountActivities({ adAccountId: accountId, since, until });
    const payload = {
      account_id: accountId,
      period: { since, until },
      fetched_at: new Date().toISOString(),
      activities,
    };
    ACTIVITIES_CACHE.set(cacheKey, { data: payload, ts: Date.now() });
    logger.info({ account_id: accountId, count: activities.length, since, until }, "Fetched account activities");
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "Activities fetch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/meta/creative-intelligence ──────────────────────────────────────
router.get("/meta/creative-intelligence", async (req, res) => {
  try {
    const rawAccountId = String(req.query["ad_account_id"] || "").trim();
    if (!rawAccountId) return res.status(400).json({ error: "ad_account_id is required" });
    // Normalize: strip act_ prefix so cache keys match regardless of how client sends it
    const accountId = rawAccountId.startsWith("act_") ? rawAccountId.slice(4) : rawAccountId;
    const { since, until } = parseRange(req.query as Record<string, string>);
    const cacheKey = `${accountId}::${since}::${until}`;

    // Serve from cache if fresh
    const hit = CREATIVE_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.ts < CREATIVE_TTL_MS) {
      logger.info({ account_id: accountId, cached: true, since, until }, "Creative intelligence served from cache");
      return res.json(hit.data);
    }

    const ads = await getAdsWithCreatives({ adAccountId: accountId, since, until });
    logger.info({ account_id: accountId, count: ads.length, since, until }, "Fetched creative intelligence");
    const payload = { account_id: accountId, period: { since, until }, fetched_at: new Date().toISOString(), ads };
    CREATIVE_CACHE.set(cacheKey, { data: payload, ts: Date.now() });
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "Creative intelligence fetch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/meta/breakdowns ──────────────────────────────────────────────────
// Ad-level breakdown by age/gender and placement for a campaign
router.get("/meta/breakdowns", async (req, res) => {
  try {
    const campaignId = String(req.query["campaign_id"] || "").trim();
    if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
    const { since, until } = parseRange(req.query as Record<string, string>);
    const cacheKey = `${campaignId}::${since}::${until}`;

    const hit = BREAKDOWN_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.ts < BREAKDOWN_TTL_MS) {
      logger.info({ campaignId, cached: true }, "Breakdown served from cache");
      return res.json(hit.data);
    }

    const data = await getAdBreakdowns({ campaignId, since, until });
    BREAKDOWN_CACHE.set(cacheKey, { data, ts: Date.now() });
    logger.info({ campaignId, since, until }, "Fetched ad breakdowns");
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Breakdowns fetch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Proactive Cache Refresh ───────────────────────────────────────────────────
// Called by a 30-min background cron in index.ts.
// Refreshes any DB cache entries that are >20 min old so user requests almost
// always hit the DB instead of calling Meta directly.

const PROACTIVE_REFRESH_DELAY_MS = 2_500; // 2.5 s gap between Meta calls (reduced from 1.5s to ease rate limits)

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// GET /api/meta/cache-warmup-status — return last proactive-refresh run stats (admin only)
router.get("/meta/cache-warmup-status", requireAdmin, async (_req, res) => {
  const { stats, history, inProgress } = getLastWarmupStats();
  if (history.length > 0) {
    return res.json({ stats, history, inProgress });
  }
  // In-memory ring buffer is empty (e.g. after a server restart) — fall back to DB
  try {
    const rows = await query<{
      ran_at: string;
      duration_ms: number;
      insights: number;
      campaigns: number;
      overview: number;
      campaign_details: number;
      adset_details: number;
      skipped: number;
    }>(
      `SELECT ran_at, duration_ms, insights, campaigns, overview, campaign_details, adset_details, skipped
       FROM cache_warmup_log
       ORDER BY ran_at DESC
       LIMIT ${WARMUP_HISTORY_MAX}`
    );
    const dbHistory: CacheWarmupStats[] = rows.reverse().map((r) => ({
      ran_at: r.ran_at,
      duration_ms: Number(r.duration_ms),
      insights: Number(r.insights),
      campaigns: Number(r.campaigns),
      overview: Number(r.overview),
      campaign_details: Number(r.campaign_details),
      adset_details: Number(r.adset_details),
      skipped: Number(r.skipped),
    }));
    const dbStats = dbHistory.length > 0 ? dbHistory[dbHistory.length - 1] : null;
    return res.json({ stats: dbStats, history: dbHistory, inProgress });
  } catch (err) {
    logger.warn({ err }, "Failed to read warmup stats from DB");
    return res.json({ stats: null, history: [], inProgress });
  }
});

// GET /api/meta/cache-warmup-history — return last 20 warm-up runs (admin only)
router.get("/meta/cache-warmup-history", requireAdmin, async (_req, res) => {
  try {
    const rows = await query<{
      id: number;
      ran_at: string;
      duration_ms: number;
      insights: number;
      campaigns: number;
      overview: number;
      campaign_details: number;
      adset_details: number;
      skipped: number;
    }>(
      `SELECT id, ran_at, duration_ms, insights, campaigns, overview, campaign_details, adset_details, skipped
       FROM cache_warmup_log
       ORDER BY ran_at DESC
       LIMIT 20`
    );
    return res.json({
      history: rows.map((r) => ({
        id: r.id,
        ran_at: r.ran_at,
        duration_ms: Number(r.duration_ms),
        insights: Number(r.insights),
        campaigns: Number(r.campaigns),
        overview: Number(r.overview),
        campaign_details: Number(r.campaign_details),
        adset_details: Number(r.adset_details),
        skipped: Number(r.skipped),
      })),
    });
  } catch (err) {
    logger.warn({ err }, "Failed to read warmup history from DB");
    return res.json({ history: [] });
  }
});

// POST /api/meta/cache-warmup-trigger — run a proactive refresh immediately (admin only)
router.post("/meta/cache-warmup-trigger", requireAdmin, async (_req, res) => {
  const { inProgress } = getLastWarmupStats();
  if (inProgress) {
    return res.status(409).json({ error: "تشغيل التحديث جارٍ بالفعل" });
  }
  setWarmupInProgress(true);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  proactiveInsightsRefresh()
    .then((s) => {
      setLastWarmupStats({ ...s, ran_at: startedAt, duration_ms: Date.now() - t0 });
      logger.info(s, "On-demand cache warm-up complete");
    })
    .catch((err) => {
      setWarmupInProgress(false);
      logger.warn({ err }, "On-demand cache warm-up failed");
    });
  return res.json({ started: true });
});

export async function proactiveInsightsRefresh(): Promise<{
  insights: number;
  campaigns: number;
  overview: number;
  campaign_details: number;
  adset_details: number;
  skipped: number;
}> {
  const stats = { insights: 0, campaigns: 0, overview: 0, campaign_details: 0, adset_details: 0, skipped: 0 };

  // ── 1) Stale insights rows ──────────────────────────────────────────────────
  const staleInsights = await query<{
    campaign_id: string;
    period_since: string;
    period_until: string;
  }>(
    `SELECT campaign_id, period_since, period_until
     FROM meta_insights_cache
     WHERE fetched_at < NOW() - INTERVAL '90 minutes'
     ORDER BY fetched_at DESC
     LIMIT 5`,
    []
  ).catch(() => [] as { campaign_id: string; period_since: string; period_until: string }[]);

  for (const row of staleInsights) {
    if (isRateLimitActive()) { stats.skipped++; continue; }
    try {
      const data = await getCampaignInsights({
        campaign_id: row.campaign_id,
        since: row.period_since,
        until: row.period_until,
      });
      await dbSetInsightsCache(row.campaign_id, row.period_since, row.period_until, data).catch(() => null);
      stats.insights++;
    } catch {
      stats.skipped++;
    }
    await sleep(PROACTIVE_REFRESH_DELAY_MS);
  }

  // ── 2) Stale campaigns rows ─────────────────────────────────────────────────
  const staleCampaigns = await query<{
    account_id: string;
    period_since: string;
    period_until: string;
  }>(
    `SELECT account_id, period_since, period_until
     FROM meta_campaigns_cache
     WHERE fetched_at < NOW() - INTERVAL '90 minutes'
     LIMIT 3`,
    []
  ).catch(() => [] as { account_id: string; period_since: string; period_until: string }[]);

  for (const row of staleCampaigns) {
    if (isRateLimitActive()) { stats.skipped++; continue; }
    try {
      const campaigns = await listCampaigns({
        since: row.period_since,
        until: row.period_until,
        adAccountId: row.account_id,
      });
      await dbSetCampaignsCache(row.account_id, row.period_since, row.period_until, campaigns).catch(() => null);
      stats.campaigns++;
    } catch {
      stats.skipped++;
    }
    await sleep(PROACTIVE_REFRESH_DELAY_MS);
  }

  // ── 3) Stale overview rows ──────────────────────────────────────────────────
  const staleOverview = await query<{
    account_id: string;
    period_since: string;
    period_until: string;
  }>(
    `SELECT account_id, period_since, period_until
     FROM meta_overview_cache
     WHERE fetched_at < NOW() - INTERVAL '90 minutes'
     LIMIT 3`,
    []
  ).catch(() => [] as { account_id: string; period_since: string; period_until: string }[]);

  for (const row of staleOverview) {
    if (isRateLimitActive()) { stats.skipped++; continue; }
    try {
      const data = await getAccountOverview({
        adAccountId: row.account_id,
        since: row.period_since,
        until: row.period_until,
      });
      await dbSetOverviewCache(row.account_id, row.period_since, row.period_until, data).catch(() => null);
      stats.overview++;
    } catch {
      stats.skipped++;
    }
    await sleep(PROACTIVE_REFRESH_DELAY_MS);
  }

  // ── 4) Missing/stale campaign details rows ─────────────────────────────────
  // Find campaign_ids in meta_insights_cache that are absent or stale in
  // meta_campaign_details_cache.
  const staleCampaignDetails = await query<{ campaign_id: string }>(
    `SELECT DISTINCT ON (ic.campaign_id) ic.campaign_id
     FROM meta_insights_cache ic
     LEFT JOIN meta_campaign_details_cache cdc ON cdc.campaign_id = ic.campaign_id
     WHERE cdc.campaign_id IS NULL
        OR cdc.fetched_at < NOW() - INTERVAL '90 minutes'
     ORDER BY ic.campaign_id, ic.fetched_at DESC
     LIMIT 5`,
    []
  ).catch(() => [] as { campaign_id: string }[]);

  for (const row of staleCampaignDetails) {
    if (isRateLimitActive()) { stats.skipped++; continue; }
    try {
      const data = await getCampaignDetails(row.campaign_id);
      await query(
        `INSERT INTO meta_campaign_details_cache (campaign_id, data, fetched_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (campaign_id) DO UPDATE SET data=$2, fetched_at=NOW()`,
        [row.campaign_id, JSON.stringify(data)]
      ).catch(() => null);
      stats.campaign_details++;
    } catch {
      stats.skipped++;
    }
    await sleep(PROACTIVE_REFRESH_DELAY_MS);
  }

  // ── 5) Missing/stale adset details rows ────────────────────────────────────
  // Extract adset IDs from the by_adset array in cached insights, then warm
  // any that are absent or stale in meta_adset_details_cache.
  const staleAdsetDetails = await query<{ adset_id: string }>(
    `SELECT DISTINCT ON (elem->>'id') elem->>'id' AS adset_id
     FROM meta_insights_cache ic,
          jsonb_array_elements(ic.data->'by_adset') AS elem
     LEFT JOIN meta_adset_details_cache adc ON adc.adset_id = elem->>'id'
     WHERE (elem->>'id') IS NOT NULL
       AND (adc.adset_id IS NULL
            OR adc.fetched_at < NOW() - INTERVAL '90 minutes')
     ORDER BY elem->>'id', ic.fetched_at DESC
     LIMIT 8`,
    []
  ).catch(() => [] as { adset_id: string }[]);

  for (const row of staleAdsetDetails) {
    if (isRateLimitActive()) { stats.skipped++; continue; }
    try {
      const data = await getAdsetDetails(row.adset_id);
      await query(
        `INSERT INTO meta_adset_details_cache (adset_id, data, fetched_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (adset_id) DO UPDATE SET data=$2, fetched_at=NOW()`,
        [row.adset_id, JSON.stringify(data)]
      ).catch(() => null);
      stats.adset_details++;
    } catch {
      stats.skipped++;
    }
    await sleep(PROACTIVE_REFRESH_DELAY_MS);
  }

  return stats;
}

export default router;
