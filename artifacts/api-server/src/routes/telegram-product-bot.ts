import { createHash } from "crypto";
import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";

const publicRouter = Router();
const router = Router();

type BotMedia = { type: "image" | "video"; url: string; thumbnail_url?: string | null };
type TgUser = { id?: number; first_name?: string; last_name?: string; username?: string };
type TgChat = { id?: number; title?: string; username?: string; type?: string };
type TgMessage = {
  message_id?: number;
  media_group_id?: string;
  text?: string;
  caption?: string;
  chat?: TgChat;
  from?: TgUser;
  photo?: Array<{ file_id?: string; width?: number; height?: number; file_size?: number }>;
  video?: { file_id?: string; thumbnail?: { file_id?: string } };
  forward_origin?: any;
  forward_from_chat?: TgChat;
};

function botToken() { return String(process.env.TELEGRAM_BOT_TOKEN || "").trim(); }
function webhookSecret() {
  const token = botToken();
  if (!token) return "";
  return createHash("sha256").update(`${token}:${process.env.SESSION_SECRET || "dealme"}`).digest("hex");
}
function telegramApi(method: string) {
  const token = botToken();
  return token ? `https://api.telegram.org/bot${token}/${method}` : "";
}
async function callTelegram<T = any>(method: string, body?: Record<string, unknown>): Promise<T> {
  const url = telegramApi(method);
  if (!url) throw new Error("TELEGRAM_BOT_TOKEN_NOT_CONFIGURED");
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json() as any;
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API ${response.status}`);
  return data.result as T;
}

async function ensureProductTable() {
  await query(`CREATE TABLE IF NOT EXISTS product_hunting_items (
    id SERIAL PRIMARY KEY,
    source_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL UNIQUE,
    source_type VARCHAR(30) NOT NULL DEFAULT 'telegram',
    title TEXT,
    description TEXT,
    image_url TEXT,
    media JSONB NOT NULL DEFAULT '[]'::jsonb,
    channel_name TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'new',
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    category VARCHAR(100),
    notes TEXT,
    supplier_url TEXT,
    target_price_egp NUMERIC(12,2),
    cost_price NUMERIC(12,2),
    cost_currency VARCHAR(10) DEFAULT 'CNY',
    added_by_user_id INT REFERENCES users(id),
    added_by_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function senderName(message: TgMessage) {
  const u = message.from;
  if (!u) return "Telegram";
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : `Telegram ${u.id || ""}`);
}
function sourceName(message: TgMessage) {
  const origin = message.forward_origin;
  if (origin?.type === "channel") return origin.chat?.title || origin.chat?.username || "Telegram Channel";
  if (origin?.type === "chat") return origin.sender_chat?.title || origin.sender_chat?.username || "Telegram Chat";
  if (origin?.type === "user") {
    const u = origin.sender_user;
    return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "Telegram";
  }
  if (origin?.type === "hidden_user") return origin.sender_user_name || "Telegram";
  return message.forward_from_chat?.title || message.forward_from_chat?.username || "Telegram";
}
function mediaFor(message: TgMessage): BotMedia[] {
  if (message.photo?.length) {
    const best = [...message.photo].sort((a, b) => ((b.file_size || 0) - (a.file_size || 0)) || ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)))[0];
    if (best?.file_id) return [{ type: "image", url: `/api/telegram-product-bot/media/${encodeURIComponent(best.file_id)}` }];
  }
  if (message.video?.file_id) {
    const thumb = message.video.thumbnail?.file_id ? `/api/telegram-product-bot/media/${encodeURIComponent(message.video.thumbnail.file_id)}` : null;
    return [{ type: "video", url: `/api/telegram-product-bot/media/${encodeURIComponent(message.video.file_id)}`, thumbnail_url: thumb }];
  }
  return [];
}
function titleFrom(text: string | null, channel: string) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean) return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
  return `منتج من ${channel}`;
}
function extractEgpPrice(text: string | null) {
  if (!text) return null;
  const patterns = [/(?:EGP|ج\.م|جنيه)\s*[:\-]?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i, /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:EGP|ج\.م|جنيه)/i];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0 && n < 1000000) return n;
    }
  }
  return null;
}
async function sendAck(chatId: number, text: string) {
  try { await callTelegram("sendMessage", { chat_id: chatId, text }); } catch { /* acknowledgement is non-fatal */ }
}

async function ingestMessage(message: TgMessage) {
  await ensureProductTable();
  const chatId = Number(message.chat?.id);
  const messageId = Number(message.message_id);
  if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) return;
  const text = String(message.caption || message.text || "").trim() || null;
  if (text?.startsWith("/start")) {
    await sendAck(chatId, "ابعت أو اعمل Forward لبوست المنتج هنا، وأنا هضيفه تلقائياً في Product Hunting بالصور والفيديو والنص.");
    return;
  }

  const sender = senderName(message);
  const channel = sourceName(message);
  let media = mediaFor(message);
  let mediaFromPrevious = false;
  const group = message.media_group_id ? String(message.media_group_id) : null;
  const sourceUrl = group
    ? `telegram-bot://chat/${chatId}/album/${group}`
    : `telegram-bot://chat/${chatId}/message/${messageId}`;
  const normalized = sourceUrl;

  if (group) {
    const existing = await query<any>(`SELECT * FROM product_hunting_items WHERE normalized_url = $1 LIMIT 1`, [normalized]);
    if (existing[0]) {
      const current: BotMedia[] = Array.isArray(existing[0].media) ? existing[0].media : [];
      const seen = new Set(current.map(x => x.url));
      const merged = [...current, ...media.filter(x => !seen.has(x.url))];
      await query(`UPDATE product_hunting_items SET
        media = $1::jsonb,
        image_url = COALESCE(image_url, $2),
        description = COALESCE(NULLIF(description,''), $3),
        title = CASE WHEN title IS NULL OR title = '' OR title LIKE 'منتج من %' THEN COALESCE($4, title) ELSE title END,
        channel_name = COALESCE(NULLIF(channel_name,''), $5),
        updated_at = NOW()
        WHERE id = $6`, [JSON.stringify(merged), media.find(x => x.type === "image")?.url || null, text, text ? titleFrom(text, channel) : null, channel, existing[0].id]);
      return;
    }
  }

  // If a forwarded Telegram post is text-only, borrow media from the nearest item
  // this same team member sent to the bot within the previous five minutes.
  if (!media.length && text) {
    const previous = await query<any>(`SELECT media, image_url FROM product_hunting_items
      WHERE source_type = 'telegram_bot'
        AND source_url LIKE $1
        AND jsonb_array_length(COALESCE(media, '[]'::jsonb)) > 0
        AND created_at >= NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC LIMIT 1`, [`telegram-bot://chat/${chatId}/%`]);
    if (previous[0]) {
      media = Array.isArray(previous[0].media) ? previous[0].media : [];
      mediaFromPrevious = media.length > 0;
    }
  }

  const cover = media.find(x => x.type === "image")?.url || media.find(x => x.thumbnail_url)?.thumbnail_url || null;
  await query(`INSERT INTO product_hunting_items
    (source_url, normalized_url, source_type, title, description, image_url, media, channel_name, target_price_egp, notes, added_by_name)
    VALUES ($1,$2,'telegram_bot',$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
    ON CONFLICT (normalized_url) DO NOTHING`, [
      sourceUrl,
      normalized,
      titleFrom(text, channel),
      text,
      cover,
      JSON.stringify(media),
      channel,
      extractEgpPrice(text),
      mediaFromPrevious ? "تم أخذ الميديا تلقائياً من أقرب رسالة سابقة أرسلها نفس العضو للبوت." : null,
      sender,
    ]);

  if (!group) {
    await sendAck(chatId, mediaFromPrevious ? "✅ تم إضافة المنتج، واستخدمت ميديا الرسالة السابقة تلقائياً." : "✅ تم إضافة المنتج إلى Product Hunting.");
  }
}

publicRouter.post("/telegram-product-bot/webhook", async (req: Request, res: Response) => {
  const token = botToken();
  if (!token) return res.status(503).json({ error: "Telegram bot غير مفعّل" });
  const received = String(req.headers["x-telegram-bot-api-secret-token"] || "");
  if (!received || received !== webhookSecret()) return res.status(403).json({ error: "invalid webhook secret" });
  res.json({ ok: true });
  const update = req.body || {};
  const message = update.message || update.edited_message;
  if (message) ingestMessage(message).catch(err => console.error("telegram product bot ingest error", err));
});

router.get("/telegram-product-bot/status", async (req: Request, res: Response) => {
  if (!botToken()) return res.json({ configured: false, active: false });
  try {
    const [me, webhook] = await Promise.all([callTelegram<any>("getMe"), callTelegram<any>("getWebhookInfo")]);
    res.json({
      configured: true,
      active: Boolean(webhook?.url),
      bot: { id: me?.id, username: me?.username, first_name: me?.first_name },
      webhook: { url: webhook?.url || "", pending_update_count: webhook?.pending_update_count || 0, last_error_message: webhook?.last_error_message || null },
    });
  } catch (error: any) {
    res.status(502).json({ configured: true, active: false, error: error?.message || "تعذر الاتصال بـ Telegram" });
  }
});

router.post("/telegram-product-bot/register", async (req: Request, res: Response) => {
  if (!botToken()) return res.status(400).json({ error: "أضف TELEGRAM_BOT_TOKEN في Environment على Render أولاً" });
  try {
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    if (!host) return res.status(400).json({ error: "تعذر تحديد رابط الداشبورد" });
    const url = `${proto}://${host}/api/telegram-product-bot/webhook`;
    await callTelegram("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "edited_message"], drop_pending_updates: false });
    const me = await callTelegram<any>("getMe");
    res.json({ ok: true, url, bot: { username: me?.username, first_name: me?.first_name } });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || "تعذر تفعيل Telegram webhook" });
  }
});

router.delete("/telegram-product-bot/webhook", async (_req: Request, res: Response) => {
  if (!botToken()) return res.status(400).json({ error: "Telegram bot غير مفعّل" });
  try {
    await callTelegram("deleteWebhook", { drop_pending_updates: false });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || "تعذر إيقاف webhook" });
  }
});

router.get("/telegram-product-bot/media/:fileId", async (req: Request, res: Response) => {
  if (!botToken()) return res.status(503).end();
  try {
    const fileId = String(req.params.fileId || "");
    const file = await callTelegram<any>("getFile", { file_id: fileId });
    if (!file?.file_path) return res.status(404).end();
    const upstream = await fetch(`https://api.telegram.org/file/bot${botToken()}/${file.file_path}`, { signal: AbortSignal.timeout(30000) });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).end();
    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");
    if (contentType) res.setHeader("content-type", contentType);
    if (contentLength) res.setHeader("content-length", contentLength);
    res.setHeader("cache-control", "private, max-age=3600");
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.send(bytes);
  } catch (error) {
    console.error("telegram media proxy error", error);
    res.status(502).end();
  }
});

export { publicRouter as telegramProductBotPublicRouter };
export default router;
