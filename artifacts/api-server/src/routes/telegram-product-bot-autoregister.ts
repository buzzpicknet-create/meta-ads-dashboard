import { createHash } from "crypto";

function botToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function webhookSecret() {
  const token = botToken();
  if (!token) return "";
  return createHash("sha256").update(`${token}:${process.env.SESSION_SECRET || "dealme"}`).digest("hex");
}

async function registerTelegramProductBotWebhook() {
  const token = botToken();
  const baseUrl = String(process.env.TELEGRAM_WEBHOOK_BASE_URL || "").trim().replace(/\/$/, "");
  if (!token || !baseUrl) return;

  const url = `${baseUrl}/api/telegram-product-bot/webhook`;
  try {
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
      console.error("telegram product bot webhook registration failed", data);
      return;
    }
    console.log("telegram product bot webhook active", { url });
  } catch (error) {
    console.error("telegram product bot webhook registration error", error);
  }
}

setTimeout(() => {
  registerTelegramProductBotWebhook().catch(() => {});
}, 2500);
