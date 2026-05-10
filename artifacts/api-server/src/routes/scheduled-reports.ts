import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";
import { requireAdmin } from "../lib/auth-middleware";
import { sendEmail, buildRedundantActionsCsv, isEmailConfigured } from "../lib/email";
import { logger } from "../lib/logger";

const router = Router();

interface ScheduledReport {
  id: number;
  email: string;
  frequency: "daily" | "weekly";
  created_by: string;
  created_at: string;
  last_sent_at: string | null;
  next_send_at: string;
  is_active: boolean;
}

// ── GET /api/reports/schedules ─────────────────────────────────
router.get("/reports/schedules", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await query<ScheduledReport>(
      `SELECT id, email, frequency, created_by, created_at, last_sent_at, next_send_at, is_active
       FROM scheduled_reports
       WHERE is_active = TRUE
       ORDER BY created_at DESC`
    );
    res.json({ schedules: rows, smtp_configured: isEmailConfigured() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/reports/schedules ────────────────────────────────
router.post("/reports/schedules", requireAdmin, async (req: Request, res: Response) => {
  const { email, frequency } = req.body as { email?: string; frequency?: string };

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "البريد الإلكتروني غير صحيح" });
  }
  if (!frequency || !["daily", "weekly"].includes(frequency)) {
    return res.status(400).json({ error: "التكرار يجب أن يكون daily أو weekly" });
  }

  const createdBy = req.session?.username ?? "admin";
  const nextSendAt = computeNextSendAt(frequency as "daily" | "weekly");

  try {
    const rows = await query<{ id: number }>(
      `INSERT INTO scheduled_reports (email, frequency, created_by, next_send_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [email.trim().toLowerCase(), frequency, createdBy, nextSendAt]
    );
    res.status(201).json({ id: rows[0]!.id, next_send_at: nextSendAt });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/reports/schedules/:id ─────────────────────────
router.delete("/reports/schedules/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return res.status(400).json({ error: "معرّف غير صحيح" });

  try {
    const rows = await query<{ id: number }>(
      `UPDATE scheduled_reports SET is_active = FALSE WHERE id = $1 AND is_active = TRUE RETURNING id`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "الجدول غير موجود" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/reports/send-now ─────────────────────────────────
// Immediately sends a redundant actions CSV to a given email (test / manual send)
router.post("/reports/send-now", requireAdmin, async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "البريد الإلكتروني غير صحيح" });
  }

  if (!isEmailConfigured()) {
    return res.status(503).json({ error: "SMTP غير مضبوط على السيرفر — أضف SMTP_HOST, SMTP_USER, SMTP_PASS" });
  }

  try {
    const csv = await fetchRedundantCsv(14);
    const result = await sendEmail({
      to: email,
      subject: `تقرير الإجراءات المكررة — ${new Date().toLocaleDateString("ar-EG")}`,
      html: buildEmailHtml(csv.count, 14),
      attachments: [
        {
          filename: `redundant-actions-${new Date().toISOString().slice(0, 10)}.csv`,
          content: csv.content,
          contentType: "text/csv;charset=utf-8",
        },
      ],
    });
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Helpers ────────────────────────────────────────────────────

function computeNextSendAt(frequency: "daily" | "weekly"): Date {
  const now = new Date();
  const next = new Date(now);
  if (frequency === "daily") {
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
  } else {
    // Next Monday at 08:00
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    next.setDate(next.getDate() + daysUntilMonday);
    next.setHours(8, 0, 0, 0);
  }
  return next;
}

async function fetchRedundantCsv(days: number): Promise<{ content: string; count: number }> {
  const rows = await query<{
    tool_name: string;
    campaign_name: string | null;
    adset_name: string | null;
    executed_by: string;
    executed_at: string;
    result_message: string | null;
  }>(
    `SELECT tool_name, campaign_name, adset_name, executed_by, executed_at, result_message
     FROM pipeboard_actions
     WHERE is_no_op = TRUE
       AND executed_at > NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY executed_at DESC`,
    [days]
  );
  return { content: buildRedundantActionsCsv(rows), count: rows.length };
}

function buildEmailHtml(count: number, days: number): string {
  const dateStr = new Date().toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8" /></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <h1 style="font-size: 20px; color: #111; margin: 0 0 8px;">تقرير الإجراءات المكررة</h1>
    <p style="color: #6b7280; margin: 0 0 24px; font-size: 14px;">${dateStr}</p>
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 14px; color: #374151;">
        إجمالي الإجراءات المكررة في آخر <strong>${days} يوم</strong>:
        <strong style="font-size: 24px; color: ${count > 0 ? "#ef4444" : "#10b981"}; display: block; margin-top: 4px;">${count}</strong>
      </p>
    </div>
    ${count > 0
      ? `<p style="font-size: 14px; color: #374151;">مرفق ملف CSV يحتوي على تفاصيل كل الإجراءات المكررة.</p>`
      : `<p style="font-size: 14px; color: #10b981;">✓ لا توجد إجراءات مكررة في هذه الفترة — كل شيء تمام.</p>`
    }
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    <p style="font-size: 12px; color: #9ca3af;">هذا التقرير يُرسَل تلقائياً من لوحة تحكم Meta Ads.</p>
  </div>
</body>
</html>`;
}

// ── Cron function (called from index.ts) ──────────────────────

export async function runScheduledReportsCron(): Promise<void> {
  const due = await query<ScheduledReport>(
    `SELECT id, email, frequency, created_by, created_at, last_sent_at, next_send_at, is_active
     FROM scheduled_reports
     WHERE is_active = TRUE
       AND next_send_at <= NOW()`
  );

  if (due.length === 0) return;

  logger.info({ count: due.length }, "Scheduled reports cron: processing due reports");

  for (const schedule of due) {
    try {
      const days = schedule.frequency === "daily" ? 1 : 7;
      const csv = await fetchRedundantCsv(days);

      const result = await sendEmail({
        to: schedule.email,
        subject: `تقرير الإجراءات المكررة — ${new Date().toLocaleDateString("ar-EG")} (${schedule.frequency === "daily" ? "يومي" : "أسبوعي"})`,
        html: buildEmailHtml(csv.count, days),
        attachments: [
          {
            filename: `redundant-actions-${new Date().toISOString().slice(0, 10)}.csv`,
            content: csv.content,
            contentType: "text/csv;charset=utf-8",
          },
        ],
      });

      const nextSendAt = computeNextSendAt(schedule.frequency);

      if (result.ok) {
        await query(
          `UPDATE scheduled_reports SET last_sent_at = NOW(), next_send_at = $1 WHERE id = $2`,
          [nextSendAt, schedule.id]
        );
        logger.info({ id: schedule.id, email: schedule.email, frequency: schedule.frequency }, "Scheduled report sent");
      } else {
        // Still update next_send_at to avoid retry storm
        await query(
          `UPDATE scheduled_reports SET next_send_at = $1 WHERE id = $2`,
          [nextSendAt, schedule.id]
        );
        logger.error({ id: schedule.id, email: schedule.email, error: result.error }, "Scheduled report email failed");
      }
    } catch (err) {
      logger.error({ err, id: schedule.id }, "Scheduled report cron failed for entry");
    }
  }
}

export default router;
