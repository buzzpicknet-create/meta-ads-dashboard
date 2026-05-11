import { Router, type Request, type Response } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { query } from "../lib/db";
import { logger } from "../lib/logger";
import { sendPushForEvent } from "../lib/push";

const router = Router();

// ── Singleton Pipeboard client for Meta Ads write actions ─────────────────────
let _pbWriteClient: Client | null = null;
let _pbWriteConnecting: Promise<Client> | null = null;

async function getPipeboardWriteClient(): Promise<Client> {
  if (_pbWriteClient) return _pbWriteClient;
  if (_pbWriteConnecting) return _pbWriteConnecting;

  _pbWriteConnecting = (async () => {
    const token = process.env.PIPEBOARD_API_TOKEN;
    if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");
    const c = new Client({ name: "meta-ads-dashboard", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.pipeboard.co/meta-ads-mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await c.connect(transport);
    _pbWriteClient = c;
    _pbWriteConnecting = null;
    logger.info("Pipeboard write singleton connected");
    return c;
  })();

  try {
    return await _pbWriteConnecting;
  } catch (err) {
    _pbWriteConnecting = null;
    throw err;
  }
}

// ── Singleton Pipeboard client for Google Ads write actions ───────────────────
let _gaWriteClient: Client | null = null;
let _gaWriteConnecting: Promise<Client> | null = null;

async function getGoogleAdsWriteClient(): Promise<Client> {
  if (_gaWriteClient) return _gaWriteClient;
  if (_gaWriteConnecting) return _gaWriteConnecting;

  _gaWriteConnecting = (async () => {
    const token = process.env.PIPEBOARD_API_TOKEN;
    if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");
    const c = new Client({ name: "google-ads-dashboard", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.pipeboard.co/google-ads-mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await c.connect(transport);
    _gaWriteClient = c;
    _gaWriteConnecting = null;
    logger.info("Google Ads write singleton connected");
    return c;
  })();

  try {
    return await _gaWriteConnecting;
  } catch (err) {
    _gaWriteConnecting = null;
    throw err;
  }
}

const GA_WRITE_TOOLS = new Set([
  "ga_pause_campaign", "ga_enable_campaign", "ga_update_campaign_budget",
  "ga_update_keyword_bid", "ga_pause_keyword", "ga_enable_keyword",
]);

const NO_OP_DAILY_THRESHOLD = 3;
const NO_OP_SPIKE_EVENT = "no_op_spike";
const NO_OP_SPIKE_URL = "/activity?noOp=1";

async function checkAndNotifyNoOpSpike(): Promise<void> {
  try {
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pipeboard_actions
       WHERE is_no_op = TRUE
         AND executed_at >= CURRENT_DATE`,
      []
    );
    const todayCount = parseInt(countRows[0]?.count ?? "0", 10);

    if (todayCount < NO_OP_DAILY_THRESHOLD) return;

    // Dedup: only send one notification per day for this event.
    // Match on the event URL rather than title text so it's resilient to
    // copy/localization changes.
    const already = await query<{ id: number }>(
      `SELECT id FROM notification_log
       WHERE url = $1
         AND sent_at >= CURRENT_DATE
       LIMIT 1`,
      [NO_OP_SPIKE_URL]
    );
    if (already.length > 0) return;

    // Route through sendPushForEvent so notification_settings controls
    // whether this fires and which roles receive it.
    await sendPushForEvent(NO_OP_SPIKE_EVENT, {
      title: "⚠️ تكرار إجراءات الذكاء الاصطناعي",
      body: `تم تسجيل ${todayCount} إجراء مكرر (No-Op) اليوم — راجع سجل النشاط`,
      url: NO_OP_SPIKE_URL,
    });

    logger.info({ todayCount }, "No-op spike push notification sent to admins");
  } catch (err) {
    logger.warn({ err }, "checkAndNotifyNoOpSpike failed");
  }
}

// ── POST /api/pipeboard/action ─────────────────────────────────
router.post("/pipeboard/action", async (req: Request, res: Response) => {
  if (req.session?.role !== "admin") {
    res.status(403).json({ error: "غير مصرح — هذه الميزة للأدمن فقط" });
    return;
  }

  const { tool, args, isNoOp: isNoOpRaw } = req.body as { tool: string; args: Record<string, unknown>; isNoOp?: unknown };
  const isNoOp = isNoOpRaw === true;

  const ALLOWED_TOOLS = new Set([
    "pause_campaign",
    "enable_campaign",
    "update_campaign_budget",
    "pause_adset",
    "enable_adset",
    "update_adset_budget",
    "duplicate_adset",
    "create_campaign",
    "create_adset",
    "duplicate_campaign",
    // Google Ads
    "ga_pause_campaign",
    "ga_enable_campaign",
    "ga_update_campaign_budget",
    "ga_update_keyword_bid",
    "ga_pause_keyword",
    "ga_enable_keyword",
  ]);

  if (!tool || !ALLOWED_TOOLS.has(tool)) {
    res.status(400).json({ error: `أداة غير مسموح بها: ${tool ?? "(فارغ)"}` });
    return;
  }

  const token = process.env.PIPEBOARD_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: "PIPEBOARD_API_TOKEN غير مضبوط على السيرفر" });
    return;
  }

  const executedBy = req.session?.username ?? "admin";

  // ── Translate our internal tool names → actual Pipeboard MCP tool names ──
  // Our AI uses friendly names; Pipeboard uses update_campaign / update_adset.
  // Budgets from the AI are in EGP (already divided by 100 by getCampaignDetails).
  // Pipeboard / Meta API expects cents → multiply by 100.
  function translateToMcp(t: string, a: Record<string, unknown>): { mcpTool: string; mcpArgs: Record<string, unknown> } {
    const egpToCents = (v: unknown) => Math.round(Number(v) * 100);
    switch (t) {
      case "pause_campaign":
        return { mcpTool: "update_campaign", mcpArgs: { campaign_id: a.campaign_id, status: "PAUSED" } };
      case "enable_campaign":
        return { mcpTool: "update_campaign", mcpArgs: { campaign_id: a.campaign_id, status: "ACTIVE" } };
      case "update_campaign_budget": {
        const field = a.budget_type === "lifetime" ? "lifetime_budget" : "daily_budget";
        return { mcpTool: "update_campaign", mcpArgs: { campaign_id: a.campaign_id, [field]: egpToCents(a.budget_amount) } };
      }
      case "pause_adset":
        return { mcpTool: "update_adset", mcpArgs: { adset_id: a.adset_id, status: "PAUSED" } };
      case "enable_adset":
        return { mcpTool: "update_adset", mcpArgs: { adset_id: a.adset_id, status: "ACTIVE" } };
      case "update_adset_budget":
        return { mcpTool: "update_adset", mcpArgs: { adset_id: a.adset_id, daily_budget: egpToCents(a.budget_amount) } };
      case "create_campaign":
        return {
          mcpTool: "create_campaign",
          mcpArgs: {
            account_id: a.account_id, name: a.name, objective: a.objective,
            status: a.status ?? "PAUSED",
            ...(a.daily_budget != null ? { daily_budget: egpToCents(a.daily_budget) } : {}),
          },
        };
      case "create_adset":
        return {
          mcpTool: "create_adset",
          mcpArgs: {
            ...a,
            ...(a.daily_budget != null ? { daily_budget: egpToCents(a.daily_budget) } : {}),
          },
        };
      // duplicate_adset, duplicate_campaign — same name, no budget conversion needed
      default:
        return { mcpTool: t, mcpArgs: a };
    }
  }

  // ── Google Ads translation ────────────────────────────────────────────────
  // Budgets from AI are in EGP; Google Ads API expects micros (×1,000,000).
  function translateToGoogleAdsMcp(t: string, a: Record<string, unknown>): { mcpTool: string; mcpArgs: Record<string, unknown> } {
    const egpToMicros = (v: unknown) => Math.round(Number(v) * 1_000_000);
    switch (t) {
      case "ga_pause_campaign":
        return { mcpTool: "pause_google_ads_campaign", mcpArgs: { customer_id: a.customer_id, campaign_id: a.campaign_id } };
      case "ga_enable_campaign":
        return { mcpTool: "enable_google_ads_campaign", mcpArgs: { customer_id: a.customer_id, campaign_id: a.campaign_id } };
      case "ga_update_campaign_budget":
        // Correct param is budget_amount_micros (not daily_budget_micros)
        return { mcpTool: "update_google_ads_campaign", mcpArgs: { customer_id: a.customer_id, campaign_id: a.campaign_id, budget_amount_micros: egpToMicros(a.budget_amount) } };
      case "ga_update_keyword_bid": {
        // API accepts either criterion_id (singular) + cpc_bid_micros for one keyword,
        // or keyword_bids array for batch. AI sends criterion_ids (array) + cpc_bid_egp.
        const bidMicros = egpToMicros(a.cpc_bid_egp);
        const ids = Array.isArray(a.criterion_ids) ? (a.criterion_ids as string[]) : [String(a.criterion_ids ?? "")];
        if (ids.length === 1) {
          return { mcpTool: "update_google_ads_keyword_bid", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, criterion_id: ids[0], cpc_bid_micros: bidMicros } };
        }
        return { mcpTool: "update_google_ads_keyword_bid", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, keyword_bids: ids.map(id => ({ criterion_id: id, cpc_bid_micros: bidMicros })) } };
      }
      case "ga_pause_keyword":
        return { mcpTool: "pause_google_ads_keyword", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, criterion_ids: a.criterion_ids } };
      case "ga_enable_keyword":
        return { mcpTool: "enable_google_ads_keyword", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, criterion_ids: a.criterion_ids } };
      default:
        return { mcpTool: t, mcpArgs: a };
    }
  }

  const isGaTool = GA_WRITE_TOOLS.has(tool);
  const { mcpTool, mcpArgs } = isGaTool
    ? translateToGoogleAdsMcp(tool, args ?? {})
    : translateToMcp(tool, args ?? {});

  let success = false;
  let resultMessage = "";

  try {
    const client = isGaTool ? await getGoogleAdsWriteClient() : await getPipeboardWriteClient();
    const result = await client.callTool({ name: mcpTool, arguments: mcpArgs });

    const textContent = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    success = true;
    // Pipeboard sometimes returns raw JSON (e.g. {"success":true}) — detect and discard it
    // so the frontend falls back to the human-readable pendingAction.summary.
    const looksLikeJson = textContent.trimStart().startsWith("{") || textContent.trimStart().startsWith("[");
    resultMessage = textContent && !looksLikeJson ? textContent : "";

    // Invalidate the details cache for the affected entity so the next
    // read-tool call returns the updated status/budget without waiting
    // for the 5-minute TTL to expire.
    const CAMPAIGN_WRITE_TOOLS = new Set([
      "pause_campaign",
      "enable_campaign",
      "update_campaign_budget",
    ]);
    const ADSET_WRITE_TOOLS = new Set([
      "pause_adset",
      "enable_adset",
      "update_adset_budget",
    ]);

    if (CAMPAIGN_WRITE_TOOLS.has(tool) && typeof args?.campaign_id === "string" && args.campaign_id) {
      await query(
        `DELETE FROM meta_campaign_details_cache WHERE campaign_id = $1`,
        [args.campaign_id]
      ).catch(() => null);
    } else if (ADSET_WRITE_TOOLS.has(tool) && typeof args?.adset_id === "string" && args.adset_id) {
      await query(
        `DELETE FROM meta_adset_details_cache WHERE adset_id = $1`,
        [args.adset_id]
      ).catch(() => null);
    }

    res.json({ success: true, message: resultMessage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    resultMessage = msg;
    // Reset the correct singleton on error so next action reconnects fresh
    if (isGaTool) {
      _gaWriteClient = null;
      _gaWriteConnecting = null;
    } else {
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }
    res.status(500).json({ error: msg });
  } finally {
    // Extract human-readable names from args for audit log
    const campaignName =
      typeof args?.campaign_name === "string" ? args.campaign_name :
      typeof args?.name === "string" ? args.name : null;
    const adsetName =
      typeof args?.adset_name === "string" ? args.adset_name : null;

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        success,
        resultMessage,
        campaignName,
        adsetName,
        isNoOp === true,
      ]
    ).catch((err: unknown) => {
      logger.warn({ err, tool, executedBy }, "Failed to insert pipeboard audit row");
    });

    // After every no-op action, check whether the daily threshold has been
    // crossed and send a push notification to admins if so (once per day).
    if (isNoOp) {
      void checkAndNotifyNoOpSpike();
    }
  }
});

// ── GET /api/pipeboard/no-op-count ─────────────────────────────
router.get("/pipeboard/no-op-count", async (req: Request, res: Response) => {
  const rawDays = parseInt(String(req.query.days ?? "14"), 10);
  const days = isNaN(rawDays) || rawDays < 1 ? 14 : Math.min(rawDays, 60);

  try {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pipeboard_actions
       WHERE is_no_op = TRUE
         AND executed_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')`,
      [days - 1]
    );
    res.json({ count: parseInt(rows[0]?.count ?? "0", 10), days });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/pipeboard/no-op-trend ─────────────────────────────
router.get("/pipeboard/no-op-trend", async (req: Request, res: Response) => {
  const rawDays = parseInt(String(req.query.days ?? "14"), 10);
  const days = isNaN(rawDays) || rawDays < 1 ? 14 : Math.min(rawDays, 60);
  const lookback = days - 1; // e.g. days=14 → go back 13 days from today

  try {
    // Use calendar-day boundaries so SQL rows and the zero-fill loop
    // cover the exact same N days (today-lookback through today, UTC).
    const rows = await query<{ day: string; count: string }>(
      `SELECT
         TO_CHAR(DATE_TRUNC('day', executed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
         COUNT(*)::text AS count
       FROM pipeboard_actions
       WHERE is_no_op = TRUE
         AND executed_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')
         AND executed_at <  DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'
       GROUP BY DATE_TRUNC('day', executed_at AT TIME ZONE 'UTC')
       ORDER BY DATE_TRUNC('day', executed_at AT TIME ZONE 'UTC') ASC`,
      [lookback]
    );

    // Zero-fill: emit exactly `days` UTC calendar days (today-lookback .. today)
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const trend: { day: string; count: number }[] = [];
    for (let i = lookback; i >= 0; i--) {
      const d = new Date(todayUTC);
      d.setUTCDate(d.getUTCDate() - i);
      const dayStr = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
      const found = rows.find((r) => r.day === dayStr);
      trend.push({ day: dayStr, count: found ? parseInt(found.count, 10) : 0 });
    }

    res.json({ trend, days });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/pipeboard/history ─────────────────────────────────
router.get("/pipeboard/history", async (req: Request, res: Response) => {
  const rawDays = parseInt(String(req.query.days ?? "14"), 10);
  const days = isNaN(rawDays) || rawDays < 1 ? 14 : Math.min(rawDays, 90);

  try {
    const rows = await query<{
      id: number;
      executed_at: string;
      executed_by: string;
      tool_name: string;
      args: Record<string, unknown>;
      success: boolean;
      result_message: string | null;
      campaign_name: string | null;
      adset_name: string | null;
      is_no_op: boolean;
    }>(
      `SELECT id, executed_at, executed_by, tool_name, args, success, result_message,
              campaign_name, adset_name, is_no_op
       FROM pipeboard_actions
       WHERE executed_at > NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY executed_at DESC
       LIMIT 200`,
      [days]
    );
    res.json({ actions: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
