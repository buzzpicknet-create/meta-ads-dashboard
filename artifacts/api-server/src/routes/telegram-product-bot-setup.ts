import { createHash } from "crypto";
import { Router, type Request, type Response } from "express";

const router = Router();

function botToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function webhookSecret() {
  const token = botToken();
  if (!token) return "";
  return createHash("sha256").update(`${token}:${process.env.SESSION_SECRET || "dealme"}`).digest("hex");
}

router.post("/telegram-product-bot/setup", async (req: Request, res: Response) => {
  const setupKey = String(process.env.TELEGRAM_BOT_SETUP_KEY || "").trim();
  const provided = String(req.headers["x-telegram-setup-key"] || "").trim();
  if (!setupKey || provided !== setupKey) {
    return res.status(403).json({ error: "invalid setup key" });
  }

  const token = botToken();
  if (!token) return res.status(503).json({ error: "Telegram bot token is not configured" });

  try {
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    if (!host) return res.status(400).json({ error: "missing host" });

    const url = `${proto}://${host}/api/telegram-product-bot/webhook`;
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: webhookSecret(),
        allowed_updates: ["message", "edited_message"],
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as any;
    if (!response.ok || !data?.ok) {
      return res.status(502).json({ error: data?.description || `Telegram API ${response.status}` });
    }

    return res.json({ ok: true, webhook_url: url });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || "Failed to register Telegram webhook" });
  }
});

export default router;
