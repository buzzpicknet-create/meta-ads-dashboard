import { Router, type IRouter } from "express";
import {
  listCampaigns,
  getCampaignInsights,
  getAccountInfo,
} from "../lib/meta-api";
import { getTokenInfo, refreshLongLivedToken } from "../lib/meta-token";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

router.get("/meta/campaigns", async (req, res) => {
  try {
    const { since, until } = parseRange(req.query as Record<string, string>);
    const campaigns = await listCampaigns({ since, until });
    res.json({
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

router.get("/meta/insights", async (req, res) => {
  try {
    const campaign_id = String(req.query["campaign_id"] || "");
    if (!campaign_id) {
      res.status(400).json({ error: "campaign_id is required" });
      return;
    }
    const { since, until } = parseRange(req.query as Record<string, string>);
    const data = await getCampaignInsights({ campaign_id, since, until });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Insights fetch failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/meta/today", (_req, res) => {
  res.json({ today_cairo: todayInCairo() });
});

export default router;
