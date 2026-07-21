import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { listAdAccounts, listCampaigns } from "../lib/meta-api.js";
import { getAdAccountIds, getAccessToken } from "../lib/meta-token.js";
import { query } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { scopeAiNotificationSql, type UserRole } from "../lib/notification-rules.js";

const router = Router();

const MINI_MODEL = "gpt-5-nano";
const WATCHDOG_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours

const WATCHDOG_SYSTEM_PROMPT = `You are an Autonomous Media Buyer Watchdog. Review this real-time campaign data.
Look ONLY for critical anomalies (all monetary values are in EGP):

BLEEDING: A campaign that has spent > 200 EGP today with 0 purchases.
VIRAL: A campaign with CPA < 25 EGP and > 10 purchases today (scaling opportunity).

If everything is normal, output ONLY this exact JSON: { "status": "normal" }

If you find a critical anomaly (pick the MOST critical one), output ONLY this JSON — no markdown, no explanation, no code blocks:
{ "status": "alert", "severity": "high", "campaign_id": "CAMPAIGN_ID", "campaign_name": "CAMPAIGN_NAME", "message": "وصف واضح بالعربية لسبب التنبيه وما المشكلة", "recommended_action": { "type": "pause", "campaign_id": "CAMPAIGN_ID" } }

IMPORTANT: Output ONLY valid raw JSON. No markdown. No \`\`\`json. No explanation outside the JSON.`;

export async function runWatchdogScan(): Promise<void> {
  const accountIds = getAdAccountIds();
  if (accountIds.length === 0) {
    logger.info("Watchdog: no ad accounts configured, skipping");
    return;
  }

  const nowCairo = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const today = nowCairo.toISOString().slice(0, 10);

  const allAccounts = await listAdAccounts();
  const summaryLines: string[] = [`Campaign Performance — ${today}:`];

  for (const acc of allAccounts) {
    try {
      const campaigns = await listCampaigns({ adAccountId: acc.id, since: today, until: today });
      const active = campaigns.filter(
        (c) => c.effective_status === "ACTIVE" && c.spend > 0
      );
      if (active.length === 0) continue;

      summaryLines.push(`\nAccount: ${acc.id}`);
      for (const c of active) {
        summaryLines.push(
          `- "${c.name}" (id: ${c.id}) | Spend: ${c.spend.toFixed(0)} EGP | Purchases: ${c.purchases} | CPA: ${c.cpa > 0 ? c.cpa.toFixed(0) + " EGP" : "N/A"}`
        );
      }
    } catch (err) {
      logger.warn({ err, account: acc.id }, "Watchdog: failed to fetch campaigns for account");
    }
  }

  if (summaryLines.length <= 1) {
    logger.info("Watchdog: no active campaigns with spend today — skipping LLM call");
    return;
  }

  const dataText = summaryLines.join("\n");
  logger.info({ lines: summaryLines.length - 1 }, "Watchdog: sending campaign data to LLM");

  const completion = await openai.chat.completions.create({
    model: MINI_MODEL,
    messages: [
      { role: "system", content: WATCHDOG_SYSTEM_PROMPT },
      { role: "user", content: dataText },
    ],
    max_completion_tokens: 400,
  });

  const raw = (completion.choices[0]?.message?.content ?? "").trim();
  logger.info({ raw }, "Watchdog: LLM response received");

  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    logger.warn({ raw }, "Watchdog: could not parse LLM response as JSON — skipping");
    return;
  }

  if (parsed.status !== "alert") {
    logger.info("Watchdog: scan complete — status normal");
    return;
  }

  const campaignId = String(parsed.campaign_id ?? "");
  const campaignName = String(parsed.campaign_name ?? "");
  const severity = String(parsed.severity ?? "high");
  const message = String(parsed.message ?? "");
  const recommendedAction = parsed.recommended_action ?? null;

  if (!message) {
    logger.warn("Watchdog: alert parsed but has no message — skipping");
    return;
  }

  // Dedup: skip if we already saved an alert for this campaign in the last 12 hours
  const existing = await query<{ id: number }>(
    `SELECT id FROM ai_notifications
     WHERE campaign_id = $1 AND created_at > NOW() - INTERVAL '12 hours'`,
    [campaignId || null]
  );
  if (existing.length > 0) {
    logger.info({ campaign_id: campaignId }, "Watchdog: duplicate alert within 12h — skipping");
    return;
  }

  await query(
    `INSERT INTO ai_notifications
       (campaign_id, campaign_name, severity, message, recommended_action, recipient_role)
     VALUES ($1, $2, $3, $4, $5, 'admin')`,
    [campaignId || null, campaignName || null, severity, message, JSON.stringify(recommendedAction)]
  );

  logger.info({ campaign_id: campaignId, campaign_name: campaignName, message }, "Watchdog: alert saved");
}

// ── GET /api/ai/notifications ─────────────────────────────────────────────────
router.get("/ai/notifications", async (req, res) => {
  const userId = req.session!.userId;
  const role = req.session!.role as UserRole;
  const scopeSql = scopeAiNotificationSql(role);
  try {
    const rows = await query<{
      id: number;
      campaign_id: string | null;
      campaign_name: string | null;
      severity: string;
      message: string;
      recommended_action: unknown;
      is_read: boolean;
      is_executed: boolean;
      created_at: string;
    }>(
      `SELECT id, campaign_id, campaign_name, severity, message,
              recommended_action, is_read, is_executed, created_at
       FROM ai_notifications
       WHERE is_executed = FALSE
         AND ${scopeSql}
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId, role]
    );
    const countRows = await query<{ unread_count: string }>(
      `SELECT COUNT(*) AS unread_count
       FROM ai_notifications
       WHERE is_executed = FALSE
         AND is_read = FALSE
         AND ${scopeSql}`,
      [userId, role]
    );
    res.json({ notifications: rows, unread_count: Number(countRows[0]?.unread_count ?? 0) });
  } catch (err) {
    logger.error({ err }, "Failed to fetch AI notifications");
    res.status(500).json({ error: "فشل جلب الإشعارات" });
  }
});

// ── POST /api/ai/notifications/:id/read ──────────────────────────────────────
router.post("/ai/notifications/:id/read", async (req, res) => {
  const id = Number(req.params["id"]);
  const userId = req.session!.userId;
  const role = req.session!.role as UserRole;
  const scopeSql = scopeAiNotificationSql(role);
  try {
    await query(
      `UPDATE ai_notifications SET is_read = TRUE WHERE id = $3 AND ${scopeSql}`,
      [userId, role, id]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to mark notification as read");
    res.status(500).json({ error: "فشل تحديث الإشعار" });
  }
});

router.post("/ai/notifications/read-all", async (req, res) => {
  const userId = req.session!.userId;
  const role = req.session!.role as UserRole;
  const scopeSql = scopeAiNotificationSql(role);
  try {
    await query(
      `UPDATE ai_notifications SET is_read = TRUE
       WHERE is_executed = FALSE
         AND is_read = FALSE
         AND ${scopeSql}`,
      [userId, role]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to mark all AI notifications as read");
    res.status(500).json({ error: "فشل تحديث الإشعارات" });
  }
});

// ── POST /api/ai/notifications/:id/execute ───────────────────────────────────
router.post("/ai/notifications/:id/execute", async (req, res) => {
  const id = Number(req.params["id"]);
  const userId = req.session!.userId;
  const role = req.session!.role as UserRole;
  const scopeSql = scopeAiNotificationSql(role);
  try {
    const rows = await query<{
      recommended_action: unknown;
      campaign_id: string | null;
      campaign_name: string | null;
    }>(
      `SELECT recommended_action, campaign_id, campaign_name
       FROM ai_notifications
       WHERE id = $3 AND ${scopeSql}`,
      [userId, role, id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "الإشعار غير موجود" });
      return;
    }

    const notif = rows[0]!;
    const action = notif.recommended_action as { type: string; campaign_id?: string } | null;

    if (!action?.type) {
      res.status(400).json({ error: "لا يوجد إجراء موصى به لهذا التنبيه" });
      return;
    }

    if (action.type !== "pause" && action.type !== "enable") {
      res.status(400).json({ error: `نوع الإجراء "${action.type}" غير مدعوم` });
      return;
    }

    const token = getAccessToken();
    const campId = (action.campaign_id || notif.campaign_id) ?? "";
    const newStatus = action.type === "pause" ? "PAUSED" : "ACTIVE";

    const apiRes = await fetch(`https://graph.facebook.com/v21.0/${campId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, access_token: token }),
    });
    const apiJson = (await apiRes.json()) as { success?: boolean; error?: { message: string } };
    if (apiJson.error) throw new Error(apiJson.error.message);

    const resultMsg =
      action.type === "pause"
        ? `تم إيقاف الحملة "${notif.campaign_name ?? campId}" بنجاح`
        : `تم تفعيل الحملة "${notif.campaign_name ?? campId}" بنجاح`;

    const executedBy = req.session?.username ?? String(req.session?.userId ?? "watchdog-ui");
    await query(
      `UPDATE ai_notifications
       SET is_executed = TRUE, executed_at = NOW(), executed_by = $1, is_read = TRUE
       WHERE id = $2`,
      [executedBy, id]
    );

    res.json({ ok: true, message: resultMsg });
  } catch (err) {
    logger.error({ err }, "Failed to execute notification action");
    res.status(500).json({
      error: `فشل تنفيذ الإجراء: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// ── POST /api/ai/notifications/:id/dismiss ───────────────────────────────────
router.post("/ai/notifications/:id/dismiss", async (req, res) => {
  const id = Number(req.params["id"]);
  const userId = req.session!.userId;
  const role = req.session!.role as UserRole;
  const scopeSql = scopeAiNotificationSql(role);
  try {
    await query(
      `UPDATE ai_notifications
       SET is_executed = TRUE, is_read = TRUE, executed_by = 'dismissed'
       WHERE id = $3 AND ${scopeSql}`,
      [userId, role, id]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to dismiss notification");
    res.status(500).json({ error: "فشل تجاهل الإشعار" });
  }
});

// ── Cron launcher ─────────────────────────────────────────────────────────────
export function startWatchdogCron(): void {
  // First run: 15 minutes after startup (let other crons settle first)
  setTimeout(() => {
    runWatchdogScan().catch((err) => logger.error({ err }, "Watchdog initial scan failed"));
    setInterval(() => {
      runWatchdogScan().catch((err) => logger.error({ err }, "Watchdog scheduled scan failed"));
    }, WATCHDOG_INTERVAL_MS);
  }, 15 * 60 * 1000);
  logger.info({ interval_hours: 3 }, "Watchdog cron scheduled");
}

export default router;
