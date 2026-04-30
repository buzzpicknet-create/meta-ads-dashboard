import { Router, type IRouter } from "express";
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
} from "../lib/meta-api";
import { getTokenInfo, refreshLongLivedToken } from "../lib/meta-token";
import { logger } from "../lib/logger";
import { query } from "../lib/db";

const router: IRouter = Router();

// ── In-memory cache for slow creative-intelligence endpoint ──────────────────
const CREATIVE_CACHE = new Map<string, { data: unknown; ts: number }>();
const CREATIVE_TTL_MS = 8 * 60 * 1000; // 8 minutes

// ── In-memory cache for breakdown data ───────────────────────────────────────
const BREAKDOWN_CACHE = new Map<string, { data: unknown; ts: number }>();
const BREAKDOWN_TTL_MS = 8 * 60 * 1000; // 8 minutes

// ── Campaigns cache — fallback when Meta rate-limits this ad account ──────────
const CAMPAIGNS_CACHE = new Map<string, { data: unknown; ts: number }>();
const CAMPAIGNS_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
const INSIGHTS_FRESH_MS  = 30 * 60 * 1000; // 30 min fresh window
const OVERVIEW_FRESH_MS  = 30 * 60 * 1000;
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

router.get("/meta/health", (_req, res) => {
  try {
    const info = getTokenInfo();
    res.json({ ok: true, token: info });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/meta/refresh-token", async (_req, res) => {
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
const CAMPAIGNS_FRESH_MS = 30 * 60 * 1000; // serve DB cache without hitting Meta if < 30 min old

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

  // ② Call Meta API to get fresh data
  try {
    const campaigns = await listCampaigns({ since, until, adAccountId: rawAccountId || undefined });
    // Persist to DB immediately
    if (accountId) await dbSetCampaignsCache(accountId, since, until, campaigns).catch(() => null);
    // Also update in-memory cache
    CAMPAIGNS_CACHE.set(`${accountId}::${since}::${until}`, { data: campaigns, ts: Date.now() });
    return res.json({
      account_id: rawAccountId || undefined,
      period: { since, until },
      fetched_at: new Date().toISOString(),
      campaigns,
    });
  } catch (err) {
    if (isRateLimitError(err)) {
      // ③ Rate limited — serve DB cache regardless of age (permanent fallback)
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
      // Also try in-memory as last resort
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
    logger.error({ err }, "Campaigns fetch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/adsets", async (req, res) => {
  try {
    const accountId = String(req.query["ad_account_id"] || "").trim();
    if (!accountId) return res.status(400).json({ error: "ad_account_id required" });
    const adsets = await listAdSetRefs(accountId);
    res.json({ ad_account_id: accountId, fetched_at: new Date().toISOString(), adsets });
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

  // ② Fetch from Meta — deduplicate concurrent identical requests
  const inflight_key = `${campaign_id}::${since}::${until}`;
  try {
    let fetchPromise = INSIGHTS_IN_FLIGHT.get(inflight_key) as Promise<ReturnType<typeof getCampaignInsights>> | undefined;
    if (!fetchPromise) {
      fetchPromise = getCampaignInsights({ campaign_id, since, until });
      INSIGHTS_IN_FLIGHT.set(inflight_key, fetchPromise);
      // Suppress unhandled-rejection on cleanup chain; real rejection is caught by `await fetchPromise`
      fetchPromise.finally(() => INSIGHTS_IN_FLIGHT.delete(inflight_key)).catch(() => {});
    } else {
      logger.info({ campaign_id }, "Insights request deduplicated (in-flight)");
    }
    const data = await fetchPromise;
    await dbSetInsightsCache(campaign_id, since, until, data).catch(() => null);
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

  // ② Fetch from Meta
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
    logger.error({ err }, "Account overview fetch failed");
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

    const activities = await getAccountActivities({ adAccountId: accountId, since, until });

    logger.info({ account_id: accountId, count: activities.length, since, until }, "Fetched account activities");

    res.json({
      account_id: accountId,
      period: { since, until },
      fetched_at: new Date().toISOString(),
      activities,
    });
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

const PROACTIVE_REFRESH_DELAY_MS = 1_500; // 1.5 s gap between Meta calls

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function proactiveInsightsRefresh(): Promise<{
  insights: number;
  campaigns: number;
  overview: number;
  skipped: number;
}> {
  const stats = { insights: 0, campaigns: 0, overview: 0, skipped: 0 };

  // ── 1) Stale insights rows ──────────────────────────────────────────────────
  const staleInsights = await query<{
    campaign_id: string;
    period_since: string;
    period_until: string;
  }>(
    `SELECT campaign_id, period_since, period_until
     FROM meta_insights_cache
     WHERE fetched_at < NOW() - INTERVAL '20 minutes'
     ORDER BY fetched_at ASC
     LIMIT 40`,
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
     WHERE fetched_at < NOW() - INTERVAL '20 minutes'
     LIMIT 10`,
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
     WHERE fetched_at < NOW() - INTERVAL '20 minutes'
     LIMIT 10`,
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

  return stats;
}

export default router;
