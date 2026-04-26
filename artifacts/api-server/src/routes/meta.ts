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
} from "../lib/meta-api";
import { getTokenInfo, refreshLongLivedToken } from "../lib/meta-token";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── In-memory cache for slow creative-intelligence endpoint ──────────────────
const CREATIVE_CACHE = new Map<string, { data: unknown; ts: number }>();
const CREATIVE_TTL_MS = 8 * 60 * 1000; // 8 minutes

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

router.get("/meta/campaigns", async (req, res) => {
  try {
    const accountId = String(req.query["ad_account_id"] || "").trim();
    const { since, until } = parseRange(req.query as Record<string, string>);
    const campaigns = await listCampaigns({ since, until, adAccountId: accountId || undefined });
    res.json({
      account_id: accountId || undefined,
      period: { since, until },
      fetched_at: new Date().toISOString(),
      campaigns,
    });
  } catch (err) {
    logger.error({ err }, "Campaigns fetch failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
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
  try {
    const campaign_id = String(req.query["campaign_id"] || "");
    const accountId = String(req.query["ad_account_id"] || "").trim();
    if (!campaign_id) {
      res.status(400).json({ error: "campaign_id is required" });
      return;
    }
    const { since, until } = parseRange(req.query as Record<string, string>);
    const data = await getCampaignInsights({ campaign_id, since, until });
    res.json({ ...data, account_id: accountId || undefined });
  } catch (err) {
    logger.error({ err }, "Insights fetch failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/account-overview", async (req, res) => {
  try {
    const accountId = String(req.query["ad_account_id"] || "").trim();
    if (!accountId) {
      res.status(400).json({ error: "ad_account_id is required" });
      return;
    }
    const { since, until } = parseRange(req.query as Record<string, string>);
    const data = await getAccountOverview({ adAccountId: accountId, since, until });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Account overview fetch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/cpa-alerts", async (req, res) => {
  try {
    const accountId = String(req.query["ad_account_id"] || "").trim();
    if (!accountId) {
      res.status(400).json({ error: "ad_account_id is required" });
      return;
    }
    const data = await getCpaAlerts({ adAccountId: accountId });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "CPA alerts fetch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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

export default router;
