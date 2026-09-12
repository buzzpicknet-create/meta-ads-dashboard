import { createHash } from "crypto";
import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";

const router = Router();
type Media = { type: "image" | "video"; url: string; thumbnail_url?: string | null };

function token() { return String(process.env.TELEGRAM_BOT_TOKEN || "").trim(); }
function secret() { return token() ? createHash("sha256").update(`${token()}:${process.env.SESSION_SECRET || "dealme"}`).digest("hex") : ""; }

function senderName(m: any) {
  const u = m?.from || {};
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : `Telegram ${u.id || ""}`);
}
function sourceName(m: any) {
  const o = m?.forward_origin;
  if (o?.type === "channel") return o.chat?.title || o.chat?.username || "Telegram Channel";
  if (o?.type === "chat") return o.sender_chat?.title || o.sender_chat?.username || "Telegram Chat";
  if (o?.type === "user") return [o.sender_user?.first_name, o.sender_user?.last_name].filter(Boolean).join(" ") || o.sender_user?.username || "Telegram";
  if (o?.type === "hidden_user") return o.sender_user_name || "Telegram";
  return m?.forward_from_chat?.title || m?.forward_from_chat?.username || "Telegram";
}
function mediaFor(m: any): Media[] {
  if (Array.isArray(m?.photo) && m.photo.length) {
    const best = [...m.photo].sort((a, b) => ((b.file_size || 0) - (a.file_size || 0)) || ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)))[0];
    return best?.file_id ? [{ type: "image", url: `/api/telegram-product-bot/media/${encodeURIComponent(best.file_id)}` }] : [];
  }
  if (m?.video?.file_id) {
    return [{ type: "video", url: `/api/telegram-product-bot/media/${encodeURIComponent(m.video.file_id)}`, thumbnail_url: m.video.thumbnail?.file_id ? `/api/telegram-product-bot/media/${encodeURIComponent(m.video.thumbnail.file_id)}` : null }];
  }
  return [];
}
function titleFrom(text: string | null, channel: string) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean ? (clean.length > 90 ? `${clean.slice(0, 87)}...` : clean) : `منتج من ${channel}`;
}
function egp(text: string | null) {
  if (!text) return null;
  const m = text.match(/(?:EGP|ج\.م|جنيه)\s*[:\-]?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i) || text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:EGP|ج\.م|جنيه)/i);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1000000 ? n : null;
}

async function ensureTable() {
  await query(`CREATE TABLE IF NOT EXISTS product_hunting_items (
    id SERIAL PRIMARY KEY, source_url TEXT NOT NULL, normalized_url TEXT NOT NULL UNIQUE,
    source_type VARCHAR(30) NOT NULL DEFAULT 'telegram', title TEXT, description TEXT,
    image_url TEXT, media JSONB NOT NULL DEFAULT '[]'::jsonb, channel_name TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'new', is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    category VARCHAR(100), notes TEXT, supplier_url TEXT, target_price_egp NUMERIC(12,2),
    cost_price NUMERIC(12,2), cost_currency VARCHAR(10) DEFAULT 'CNY',
    added_by_user_id INT REFERENCES users(id), added_by_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

function chooseChannel(current: string | null | undefined, incoming: string) {
  const cur = String(current || "").trim();
  if (!cur || cur === "Telegram" || cur === "Telegram Channel" || cur === "Telegram Chat") return incoming;
  return cur;
}

async function mergeInto(row: any, media: Media[], text: string | null, channel: string) {
  const current: Media[] = Array.isArray(row.media) ? row.media : [];
  const seen = new Set(current.map(x => x.url));
  const merged = [...current, ...media.filter(x => !seen.has(x.url))];
  const oldText = String(row.description || "").trim();
  const desc = oldText || text;
  const cover = row.image_url || merged.find(x => x.type === "image")?.url || merged.find(x => x.thumbnail_url)?.thumbnail_url || null;
  const channelName = chooseChannel(row.channel_name, channel);
  await query(`UPDATE product_hunting_items SET
    media=$1::jsonb,
    image_url=$2,
    description=$3,
    title=$4,
    channel_name=$5,
    target_price_egp=COALESCE(target_price_egp,$6),
    notes='تم تجميع Forward متعدد الرسائل تلقائياً في منتج واحد.',
    updated_at=NOW()
    WHERE id=$7`,
    [JSON.stringify(merged), cover, desc, titleFrom(desc || null, channelName), channelName, egp(desc || null), row.id]);
}

async function ingest(m: any) {
  await ensureTable();
  const chatId = Number(m?.chat?.id);
  const messageId = Number(m?.message_id);
  if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) return;
  const text = String(m?.caption || m?.text || "").trim() || null;
  if (text?.startsWith("/start")) return;

  const sender = senderName(m);
  const channel = sourceName(m);
  const media = mediaFor(m);
  const group = m?.media_group_id ? String(m.media_group_id) : null;

  // First try to attach every selected/forwarded message to the latest burst from the same user/chat.
  // Telegram can report different forward source metadata for text vs media, so source label is deliberately ignored here.
  const recent = await query<any>(`SELECT * FROM product_hunting_items
    WHERE source_type='telegram_bot'
      AND source_url LIKE $1
      AND added_by_name=$2
      AND updated_at >= NOW() - INTERVAL '25 seconds'
    ORDER BY updated_at DESC LIMIT 1`, [`telegram-bot://chat/${chatId}/%`, sender]);

  if (recent[0]) {
    const oldText = String(recent[0].description || "").trim();
    const hasOldMedia = Array.isArray(recent[0].media) && recent[0].media.length > 0;
    const isComplementary = (!oldText && !!text) || (!hasOldMedia && media.length > 0) || (!!oldText && !text && media.length > 0) || (!oldText && !text && media.length > 0);
    if (isComplementary) {
      await mergeInto(recent[0], media, text, channel);
      return;
    }
  }

  // Albums still use Telegram's media_group_id so all album parts collapse to one card.
  if (group) {
    const norm = `telegram-bot://chat/${chatId}/album/${group}`;
    const rows = await query<any>(`SELECT * FROM product_hunting_items WHERE normalized_url=$1 LIMIT 1`, [norm]);
    if (rows[0]) {
      await mergeInto(rows[0], media, text, channel);
      return;
    }
  }

  const norm = group ? `telegram-bot://chat/${chatId}/album/${group}` : `telegram-bot://chat/${chatId}/message/${messageId}`;
  const cover = media.find(x => x.type === "image")?.url || media.find(x => x.thumbnail_url)?.thumbnail_url || null;
  await query(`INSERT INTO product_hunting_items
    (source_url,normalized_url,source_type,title,description,image_url,media,channel_name,target_price_egp,added_by_name)
    VALUES ($1,$1,'telegram_bot',$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT (normalized_url) DO NOTHING`,
    [norm, titleFrom(text, channel), text, cover, JSON.stringify(media), channel, egp(text), sender]);
}

router.post("/telegram-product-bot/webhook", async (req: Request, res: Response) => {
  if (!token()) return res.status(503).json({ error: "Telegram bot غير مفعّل" });
  if (String(req.headers["x-telegram-bot-api-secret-token"] || "") !== secret()) return res.status(403).json({ error: "invalid webhook secret" });
  res.json({ ok: true });
  const m = req.body?.message || req.body?.edited_message;
  if (m) ingest(m).catch(err => console.error("telegram burst ingest error", err));
});

export default router;
