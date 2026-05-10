import nodemailer from "nodemailer";
import { logger } from "./logger";

function createTransport() {
  const host = process.env["SMTP_HOST"];
  const port = Number(process.env["SMTP_PORT"] ?? "587");
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export function isEmailConfigured(): boolean {
  return !!(
    process.env["SMTP_HOST"] &&
    process.env["SMTP_USER"] &&
    process.env["SMTP_PASS"]
  );
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}): Promise<{ ok: boolean; error?: string }> {
  const transport = createTransport();
  if (!transport) {
    logger.warn("SMTP not configured — cannot send email");
    return { ok: false, error: "SMTP غير مضبوط على السيرفر" };
  }

  const from = process.env["SMTP_FROM"] ?? process.env["SMTP_USER"] ?? "noreply@example.com";

  try {
    await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "utf-8"),
        contentType: a.contentType,
      })),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: opts.to }, "Failed to send email");
    return { ok: false, error: msg };
  }
}

export function buildRedundantActionsCsv(
  actions: Array<{
    tool_name: string;
    campaign_name: string | null;
    adset_name: string | null;
    executed_by: string;
    executed_at: string;
    result_message: string | null;
  }>
): string {
  const TOOL_LABELS: Record<string, string> = {
    pause_campaign: "إيقاف حملة",
    enable_campaign: "تفعيل حملة",
    update_campaign_budget: "تعديل ميزانية حملة",
    pause_adset: "إيقاف مجموعة",
    enable_adset: "تفعيل مجموعة",
    update_adset_budget: "تعديل ميزانية مجموعة",
    duplicate_adset: "نسخ مجموعة",
  };

  const escapeCell = (val: string | null | undefined): string => {
    const s = val ?? "";
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const header = ["نوع الإجراء", "اسم الحملة", "اسم المجموعة", "منفّذ بواسطة", "وقت التنفيذ", "رسالة النتيجة"];
  const rows = actions.map((a) =>
    [
      TOOL_LABELS[a.tool_name] ?? a.tool_name,
      a.campaign_name ?? "",
      a.adset_name ?? "",
      a.executed_by,
      a.executed_at,
      a.result_message ?? "",
    ]
      .map(escapeCell)
      .join(",")
  );

  return "\uFEFF" + [header.join(","), ...rows].join("\r\n");
}
