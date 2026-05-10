import { Router, type Request, type Response } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { query } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

// ── POST /api/pipeboard/action ─────────────────────────────────
router.post("/pipeboard/action", async (req: Request, res: Response) => {
  if (req.session?.role !== "admin") {
    res.status(403).json({ error: "غير مصرح — هذه الميزة للأدمن فقط" });
    return;
  }

  const { tool, args } = req.body as { tool: string; args: Record<string, unknown> };

  const ALLOWED_TOOLS = new Set([
    "pause_campaign",
    "enable_campaign",
    "update_campaign_budget",
    "pause_adset",
    "enable_adset",
    "update_adset_budget",
    "duplicate_adset",
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

  const client = new Client({ name: "meta-ads-dashboard", version: "1.0.0" });
  const url = new URL("https://mcp.pipeboard.co/meta-ads-mcp");
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  let success = false;
  let resultMessage = "";

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: tool, arguments: args ?? {} });

    const textContent = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    success = true;
    resultMessage = textContent || "تم التنفيذ بنجاح";

    res.json({ success: true, message: resultMessage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    resultMessage = msg;
    res.status(500).json({ error: msg });
  } finally {
    await client.close().catch(() => null);

    // Extract human-readable names from args for audit log
    const campaignName =
      typeof args?.campaign_name === "string" ? args.campaign_name :
      typeof args?.name === "string" ? args.name : null;
    const adsetName =
      typeof args?.adset_name === "string" ? args.adset_name : null;

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        success,
        resultMessage,
        campaignName,
        adsetName,
      ]
    ).catch((err: unknown) => {
      logger.warn({ err, tool, executedBy }, "Failed to insert pipeboard audit row");
    });
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
    }>(
      `SELECT id, executed_at, executed_by, tool_name, args, success, result_message,
              campaign_name, adset_name
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
