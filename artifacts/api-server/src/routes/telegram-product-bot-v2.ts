import { createHash } from "crypto";
import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";

const router = Router();
type Media = { type: "image" | "video"; url: string; thumbnail_url?: string | null };

function token() { return String(process.env.TELEGRAM_BOT_TOKEN || "").trim(); }
function secret() { return token() ? createHash("sha256").update(`${token()}:${process.env.SESSION_SECRET || "dealme"}`).digest("hex") : ""; }
function api(method: string) { return `https://api.telegram.org/bot${token()}/${method}`; }

async function telegram(method: string, body: Record<string, unknown>) {
  if (!token()) return null;
  const r = await fetch(api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await r.json() as any;
  if (!r.ok || !data?.ok) throw new Error(data?.description || `Telegram API ${r.status}`);
  return data.result;
}

async function ack(chatId: number, text: string) {
  try { await telegram("sendMessage", { chat_id: chatId, text }); } catch { /* non-fatal */ }
}

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

function privateChannelPart(chatId: unknown) {
  const n = Number(chatId);
  if (!Number.isFinite(n)) return null;
  const raw = String(Math.trunc(Math.abs(n)));
  return raw.startsWith("100") ? raw.slice(3) : raw;
}

function sourcePostLink(m: any): string | null {
  const o = m?.forward_origin;
  if (o?.type === "channel") {
    const postId = Number(o.message_id);
    const chat = o.chat || {};
    if (!Number.isFinite(postId)) return null;
    if (chat.username) return `https://t.me/${chat.username}/${postId}`;
    const internal = privateChannelPart(chat.id);
    return internal ? `https://t.me/c/${internal}/${postId}` : null;
  }
  const legacyChat = m?.forward_from_chat;
  const legacyPost = Number(m?.forward_from_message_id);
  if (legacyChat && Number.isFinite(legacyPost)) {
    if (legacyChat.username) return `https://t.me/${legacyChat.username}/${legacyPost}`;
    const internal = privateChannelPart(legacyChat.id);
    return internal ? `https://t.me/c/${internal}/${legacyPost}` : null;
  }
  return null;
}

function proxy(fileId: string) {
  return `/api/telegram-product-bot/media/${encodeURIComponent(fileId)}`;
}
function mediaFor(m: any): Media[] {
  if (Array.isArray(m?.photo) && m.photo.length) {
    const best = [...m.photo].sort((a, b) => ((b.file_size || 0) - (a.file_size || 0)) || ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)))[0];
    return best?.file_id ? [{ type: "image", url: proxy(best.file_id) }] : [];
  }
  if (m?.video?.file_id) {
    return [{ type: "video", url: proxy(m.video.file_id), thumbnail_url: m.video.thumbnail?.file_id ? proxy(m.video.thumbnail.file_id) : null }];
  }
  if (m?.animation?.file_id) {
    return [{ type: "video", url: proxy(m.animation.file_id), thumbnail_url: m.animation.thumbnail?.file_id ? proxy(m.animation.thumbnail.file_id) : null }];
  }
  if (m?.video_note?.file_id) {
    return [{ type: "video", url: proxy(m.video_note.file_id), thumbnail_url: m.video_note.thumbnail?.file_id ? proxy(m.video_note.thumbnail.file_id) : null }];
  }
  if (m?.document?.file_id) {
    const mime = String(m.document.mime_type || "").toLowerCase();
    const name = String(m.document.file_name || "").toLowerCase();
    if (mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/i.test(name)) return [{ type: "image", url: proxy(m.document.file_id) }];
    if (mime.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(name)) return [{ type: "video", url: proxy(m.document.file_id), thumbnail_url: m.document.thumbnail?.file_id ? proxy(m.document.thumbnail.file_id) : null }];
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

function pickDescription(oldText: string, incomingText: string | null) {
  const incoming = String(incomingText || "").trim();
  if (!oldText) return incoming || null;
  if (!incoming) return oldText;
  if (incoming === oldText) return oldText;
  return incoming.length > oldText.length ? incoming : oldText;
}

async function ingest(m: any) {
  await ensureTable();
  const chatId = Number(m?.chat?.id);
  const messageId = Number(m?.message_id);
  if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) return;
  const text = String(m?.caption || m?.text || "").trim() || null;
  if (text?.startsWith("/start")) {
    await ack(chatId, "ابعت أو اعمل Forward لبوست المنتج هنا، وأنا هجمع النص والصور والفيديوهات في منتج واحد داخل Product Hunting.");
    return;
  }

  const sender = senderName(m);
  const channel = sourceName(m);
  const media = mediaFor(m);
  const originalLink = sourcePostLink(m);
  const group = m?.media_group_id ? String(m.media_group_id) : null;
  const normalized = group ? `telegram-bot://chat/${chatId}/album/${group}` : `telegram-bot://chat/${chatId}/message/${messageId}`;

  // Exact Telegram album: all members always belong to one product.
  if (group) {
    const rows = await query<any>(`SELECT * FROM product_hunting_items WHERE normalized_url=$1 LIMIT 1`, [normalized]);
    if (rows[0]) {
      const current: Media[] = Array.isArray(rows[0].media) ? rows[0].media : [];
      const seen = new Set(current.map(x => x.url));
      const merged = [...current, ...media.filter(x => !seen.has(x.url))];
      const oldText = String(rows[0].description || "").trim();
      const desc = pickDescription(oldText, text);
      const cover = rows[0].image_url || merged.find(x => x.type === "image")?.url || merged.find(x => x.thumbnail_url)?.thumbnail_url || null;
      const chosenLink = (text && originalLink) || rows[0].source_url || originalLink || normalized;
      await query(`UPDATE product_hunting_items SET media=$1::jsonb, image_url=$2, description=$3,
        title=$4, target_price_egp=COALESCE(target_price_egp,$5), source_url=$6,
        channel_name=CASE WHEN channel_name IS NULL OR channel_name='' OR channel_name='Telegram' THEN $7 ELSE channel_name END,
        notes='تم تجميع Album/Forward تلقائياً في منتج واحد.', updated_at=NOW() WHERE id=$8`,
        [JSON.stringify(merged), cover, desc, titleFrom(desc || null, channel), egp(desc || null), chosenLink, channel, rows[0].id]);
      if (text) await ack(chatId, `✅ تم تجميع المنتج: ${merged.length} صورة/فيديو.`);
      return;
    }
  }

  // Telegram can split a multi-select forward into several independent messages/media groups.
  // Treat updates arriving from the same employee within a very short burst as ONE product,
  // even when more than one forwarded message carries a caption.
  const recent = await query<any>(`SELECT * FROM product_hunting_items
    WHERE source_type='telegram_bot' AND normalized_url LIKE $1 AND added_by_name=$2
      AND updated_at >= NOW() - INTERVAL '6 seconds'
    ORDER BY updated_at DESC LIMIT 1`, [`telegram-bot://chat/${chatId}/%`, sender]);

  if (recent[0]) {
    const oldText = String(recent[0].description || "").trim();
    const current: Media[] = Array.isArray(recent[0].media) ? recent[0].media : [];
    const seen = new Set(current.map(x => x.url));
    const merged = [...current, ...media.filter(x => !seen.has(x.url))];
    const desc = pickDescription(oldText, text);
    const cover = recent[0].image_url || merged.find(x => x.type === "image")?.url || merged.find(x => x.thumbnail_url)?.thumbnail_url || null;
    const chosenLink = (text && originalLink) || recent[0].source_url || originalLink || normalized;
    await query(`UPDATE product_hunting_items SET media=$1::jsonb, image_url=$2, description=$3, title=$4,
      target_price_egp=COALESCE(target_price_egp,$5), source_url=$6,
      channel_name=CASE WHEN channel_name IS NULL OR channel_name='' OR channel_name='Telegram' THEN $7 ELSE channel_name END,
      notes='تم تجميع دفعة Forward متعددة الرسائل تلقائياً في منتج واحد.', updated_at=NOW() WHERE id=$8`,
      [JSON.stringify(merged), cover, desc, titleFrom(desc || null, channel), egp(desc || null), chosenLink, channel, recent[0].id]);
    if (text) await ack(chatId, `✅ تم تجميع المنتج في كارت واحد ومعاه ${merged.length} صورة/فيديو.`);
    return;
  }

  const cover = media.find(x => x.type === "image")?.url || media.find(x => x.thumbnail_url)?.thumbnail_url || null;
  await query(`INSERT INTO product_hunting_items
    (source_url,normalized_url,source_type,title,description,image_url,media,channel_name,target_price_egp,added_by_name)
    VALUES ($1,$2,'telegram_bot',$3,$4,$5,$6::jsonb,$7,$8,$9) ON CONFLICT (normalized_url) DO NOTHING`,
    [originalLink || normalized, normalized, titleFrom(text, channel), text, cover, JSON.stringify(media), channel, egp(text), sender]);

  if (text) {
    await ack(chatId, media.length
      ? `✅ تم إضافة المنتج إلى Product Hunting ومعاه ${media.length} صورة/فيديو.`
      : "✅ تم استلام النص. أي ميديا من نفس دفعة الـForward هتتجمع معاه تلقائياً.");
  }
}

router.post("/telegram-product-bot/webhook", async (req: Request, res: Response) => {
  if (!token()) return res.status(503).json({ error: "Telegram bot غير مفعّل" });
  if (String(req.headers["x-telegram-bot-api-secret-token"] || "") !== secret()) return res.status(403).json({ error: "invalid webhook secret" });
  res.json({ ok: true });
  const m = req.body?.message || req.body?.edited_message;
  if (m) ingest(m).catch(err => console.error("telegram burst ingest error", err));
});

export default router;
