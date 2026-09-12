import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";

const router = Router();
const STATUSES = new Set(["new", "reviewing", "interested", "sample", "imported", "rejected"]);

type ProductMedia = {
  type: "image" | "video";
  url: string;
  thumbnail_url?: string | null;
};

type TelegramScrape = {
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  media?: ProductMedia[];
  channel_name?: string | null;
  target_price_egp?: number | null;
  scrape_source?: string;
  media_from_post_id?: string | null;
};

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS product_hunting_items (
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
    )
  `);
  await query(`ALTER TABLE product_hunting_items ADD COLUMN IF NOT EXISTS supplier_url TEXT`);
  await query(`ALTER TABLE product_hunting_items ADD COLUMN IF NOT EXISTS target_price_egp NUMERIC(12,2)`);
  await query(`ALTER TABLE product_hunting_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2)`);
  await query(`ALTER TABLE product_hunting_items ADD COLUMN IF NOT EXISTS cost_currency VARCHAR(10) DEFAULT 'CNY'`);
  await query(`ALTER TABLE product_hunting_items ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`CREATE INDEX IF NOT EXISTS idx_product_hunting_status ON product_hunting_items(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_product_hunting_created ON product_hunting_items(created_at DESC)`);
}

function normalizeUrl(raw: string) {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"]) {
      u.searchParams.delete(key);
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string) {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) return decodeHtml(m[1].trim());
  }
  return null;
}

function extractMessageText(html: string) {
  const m = html.match(/<div[^>]+class=["'][^"']*tgme_widget_message_text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  return m?.[1] ? stripHtml(m[1]) : null;
}

function extractEgpPrice(text?: string | null) {
  if (!text) return null;
  const patterns = [
    /(?:EGP|ج\.م|جنيه)\s*[:\-]?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i,
    /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:EGP|ج\.م|جنيه)/i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) {
      const value = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0 && value < 1000000) return value;
    }
  }
  return null;
}

function cleanMediaUrl(raw: string | undefined | null) {
  if (!raw) return null;
  let value = decodeHtml(raw).replace(/\\\//g, "/").trim();
  value = value.replace(/^['"]|['"]$/g, "");
  try { value = decodeURIComponent(value); } catch { /* keep original */ }
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

function pushMedia(target: ProductMedia[], seen: Set<string>, item: ProductMedia) {
  const url = cleanMediaUrl(item.url);
  if (!url || seen.has(url)) return;
  seen.add(url);
  target.push({ type: item.type, url, thumbnail_url: cleanMediaUrl(item.thumbnail_url) });
}

function extractTelegramMedia(html: string, fallbackImage?: string | null): ProductMedia[] {
  const media: ProductMedia[] = [];
  const seen = new Set<string>();
  if (fallbackImage) pushMedia(media, seen, { type: "image", url: fallbackImage });

  for (const match of html.matchAll(/background-image\s*:\s*url\(([^)]+)\)/gi)) {
    const raw = match[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().replace(/^['"]|['"]$/g, "");
    if (/cdn\d*\.telegram-cdn|cdn\d*\.telesco|telegram/i.test(raw) || /^https?:\/\//i.test(raw)) {
      pushMedia(media, seen, { type: "image", url: raw });
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = match[1];
    if (/telegram|cdn|telesco/i.test(src)) pushMedia(media, seen, { type: "image", url: src });
  }

  for (const match of html.matchAll(/<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    pushMedia(media, seen, { type: "video", url: match[1], thumbnail_url: fallbackImage });
  }

  for (const match of html.matchAll(/(?:src|data-video|data-src)[\\"'=:\s]+(https?:\\?\/\\?\/[^\s"'<>]+?\.(?:mp4|webm)(?:\?[^\s"'<>]*)?)/gi)) {
    pushMedia(media, seen, { type: "video", url: match[1], thumbnail_url: fallbackImage });
  }

  return media.slice(0, 30);
}

function hasMessageMediaMarkup(html: string) {
  return /tgme_widget_message_(?:photo|video)|<video\b|<source\b|background-image\s*:\s*url\(/i.test(html);
}

async function fetchTelegramHtml(url: URL) {
  const response = await fetch(url.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "ar,en-US;q=0.9,en;q=0.8",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  return response.ok ? await response.text() : "";
}

function targetMessageSnippet(html: string, channel: string, postId: string) {
  if (!html) return "";
  const needles = [
    `data-post=\"${channel}/${postId}\"`,
    `data-post='${channel}/${postId}'`,
    `data-post=\"${channel.toLowerCase()}/${postId}\"`,
  ];
  let at = -1;
  for (const needle of needles) {
    at = html.toLowerCase().indexOf(needle.toLowerCase());
    if (at >= 0) break;
  }
  if (at < 0) return "";

  const wrapperToken = "tgme_widget_message_wrap";
  let start = html.lastIndexOf(wrapperToken, at);
  if (start < 0) start = Math.max(0, at - 8000);
  else start = Math.max(0, html.lastIndexOf("<", start));
  let end = html.indexOf(wrapperToken, at + 1);
  if (end < 0) end = Math.min(html.length, at + 50000);
  else end = Math.max(at + 1, html.lastIndexOf("<", end));
  return html.slice(start, end);
}

async function scrapePostMediaOnly(channel: string, postId: string): Promise<ProductMedia[]> {
  const embed = new URL(`https://t.me/${channel}/${postId}`);
  embed.searchParams.set("embed", "1");
  embed.searchParams.set("mode", "tme");
  const publicPreview = new URL(`https://t.me/s/${channel}/${postId}`);

  const results = await Promise.allSettled([
    fetchTelegramHtml(embed),
    fetchTelegramHtml(publicPreview),
  ]);
  const embedHtml = results[0].status === "fulfilled" ? results[0].value : "";
  const previewHtml = results[1].status === "fulfilled" ? results[1].value : "";
  const previewTarget = targetMessageSnippet(previewHtml, channel, postId);
  const usefulHtml = [embedHtml, previewTarget].filter(Boolean).join("\n");
  if (!usefulHtml || !hasMessageMediaMarkup(usefulHtml)) return [];

  const ogImage = meta(embedHtml, "og:image");
  return extractTelegramMedia(usefulHtml, ogImage);
}

async function findPreviousTelegramMedia(channel: string, currentPostId: string) {
  const current = Number(currentPostId);
  if (!Number.isFinite(current) || current <= 1) return { media: [] as ProductMedia[], postId: null as string | null };

  // Telegram message IDs can have gaps, so search backwards rather than assuming n-1 exists.
  for (let offset = 1; offset <= 12; offset += 1) {
    const candidate = String(current - offset);
    if (Number(candidate) <= 0) break;
    try {
      const media = await scrapePostMediaOnly(channel, candidate);
      if (media.length > 0) return { media, postId: candidate };
    } catch { /* continue looking backwards */ }
  }
  return { media: [] as ProductMedia[], postId: null as string | null };
}

async function scrapePublicTelegram(rawUrl: string): Promise<TelegramScrape> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return {}; }
  const host = parsed.hostname.toLowerCase();
  if (!["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(host)) return {};

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] === "s") parts.shift();
  const channel = parts[0] ?? "";
  const postId = parts[1] ?? "";
  if (!channel || !/^\d+$/.test(postId)) return { channel_name: channel || null };

  try {
    const direct = new URL(`https://t.me/${channel}/${postId}`);
    const embed = new URL(`https://t.me/${channel}/${postId}`);
    embed.searchParams.set("embed", "1");
    embed.searchParams.set("mode", "tme");
    const publicPreview = new URL(`https://t.me/s/${channel}/${postId}`);

    const results = await Promise.allSettled([
      fetchTelegramHtml(direct),
      fetchTelegramHtml(embed),
      fetchTelegramHtml(publicPreview),
    ]);
    const directHtml = results[0].status === "fulfilled" ? results[0].value : "";
    const embedHtml = results[1].status === "fulfilled" ? results[1].value : "";
    const previewHtml = results[2].status === "fulfilled" ? results[2].value : "";
    const previewTarget = targetMessageSnippet(previewHtml, channel, postId);

    const usefulHtml = [embedHtml, previewTarget, directHtml].filter(Boolean).join("\n");
    if (!usefulHtml) return { channel_name: channel };

    const title = meta(directHtml, "og:title") ?? meta(embedHtml, "og:title") ?? `Telegram • @${channel}`;
    const description =
      meta(directHtml, "og:description") ??
      meta(embedHtml, "og:description") ??
      extractMessageText(previewTarget) ??
      extractMessageText(embedHtml);
    const ogImage = meta(directHtml, "og:image") ?? meta(embedHtml, "og:image");

    // Do not treat a generic OG/channel image as product media for a text-only post.
    let media = hasMessageMediaMarkup([embedHtml, previewTarget].filter(Boolean).join("\n"))
      ? extractTelegramMedia([embedHtml, previewTarget].filter(Boolean).join("\n"), ogImage)
      : [];
    let mediaFromPostId: string | null = null;

    // Product hunters often post the text immediately after the media post.
    // Preserve THIS post's text/details, but borrow media from the nearest prior post with media.
    if (media.length === 0) {
      const previous = await findPreviousTelegramMedia(channel, postId);
      media = previous.media;
      mediaFromPostId = previous.postId;
    }

    const cover = media.find((m) => m.type === "image")?.url ?? media.find((m) => m.thumbnail_url)?.thumbnail_url ?? null;

    return {
      title,
      description,
      image_url: cover,
      media,
      channel_name: channel,
      target_price_egp: extractEgpPrice(description),
      scrape_source: mediaFromPostId ? `previous-post:${mediaFromPostId}` : previewTarget ? "public-preview" : embedHtml ? "embed" : "direct",
      media_from_post_id: mediaFromPostId,
    };
  } catch (error) {
    console.error("telegram scrape failed", { rawUrl, error });
    return { channel_name: channel };
  }
}

async function refreshExistingTelegram(id: number, sourceUrl: string) {
  const scraped = await scrapePublicTelegram(sourceUrl);
  const media = Array.isArray(scraped.media) ? scraped.media : [];
  const rows = await query(
    `UPDATE product_hunting_items SET
       title = COALESCE(NULLIF(title, ''), $1),
       description = COALESCE(NULLIF(description, ''), $2),
       image_url = COALESCE($3, image_url),
       media = CASE WHEN jsonb_array_length($4::jsonb) > 0 THEN $4::jsonb ELSE media END,
       channel_name = COALESCE($5, channel_name),
       target_price_egp = COALESCE(target_price_egp, $6),
       updated_at = NOW()
     WHERE id = $7 RETURNING *`,
    [
      scraped.title ?? null,
      scraped.description ?? null,
      scraped.image_url ?? null,
      JSON.stringify(media),
      scraped.channel_name ?? null,
      scraped.target_price_egp ?? null,
      id,
    ],
  );
  return { item: rows[0], media_count: media.length, scraped };
}

router.get("/product-hunting", async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const favorite = req.query.favorite === "true";
    const params: unknown[] = [];
    const where: string[] = [];

    if (status && STATUSES.has(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(COALESCE(title,'') ILIKE $${params.length} OR COALESCE(description,'') ILIKE $${params.length} OR source_url ILIKE $${params.length} OR COALESCE(channel_name,'') ILIKE $${params.length} OR COALESCE(category,'') ILIKE $${params.length} OR COALESCE(notes,'') ILIKE $${params.length})`);
    }
    if (favorite) where.push("is_favorite = TRUE");

    const rows = await query(
      `SELECT * FROM product_hunting_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY is_favorite DESC, created_at DESC LIMIT 500`,
      params,
    );
    const statsRows = await query<{ status: string; count: string }>(`SELECT status, COUNT(*)::text AS count FROM product_hunting_items GROUP BY status`);
    const favorites = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM product_hunting_items WHERE is_favorite = TRUE`);
    const total = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM product_hunting_items`);
    const stats: Record<string, number> = { total: Number(total[0]?.count ?? 0), favorites: Number(favorites[0]?.count ?? 0) };
    for (const row of statsRows) stats[row.status] = Number(row.count);
    res.json({ items: rows, stats });
  } catch (error) {
    console.error("product-hunting list error", error);
    res.status(500).json({ error: "تعذر تحميل المنتجات" });
  }
});

router.post("/product-hunting", async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const sourceUrl = String(req.body?.source_url ?? "").trim();
    if (!sourceUrl) return res.status(400).json({ error: "رابط المنتج مطلوب" });
    try { new URL(sourceUrl); } catch { return res.status(400).json({ error: "الرابط غير صالح" }); }

    const normalized = normalizeUrl(sourceUrl);
    const existing = await query<{ id: number; source_type: string; source_url: string }>(
      `SELECT id, source_type, source_url FROM product_hunting_items WHERE normalized_url = $1 LIMIT 1`,
      [normalized],
    );

    if (existing[0]) {
      if (existing[0].source_type === "telegram") {
        const refreshed = await refreshExistingTelegram(existing[0].id, existing[0].source_url);
        return res.status(200).json({
          item: refreshed.item,
          duplicate: true,
          refreshed: true,
          scraped: refreshed.media_count > 0 || Boolean(refreshed.scraped.description || refreshed.scraped.image_url),
          media_count: refreshed.media_count,
          media_from_post_id: refreshed.scraped.media_from_post_id ?? null,
        });
      }
      return res.status(409).json({ error: "المنتج مضاف بالفعل" });
    }

    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase();
    const sourceType = host.includes("t.me") || host.includes("telegram.me") ? "telegram" : host.includes("tiktok") ? "tiktok" : host.includes("aliexpress") ? "aliexpress" : "other";
    const scraped = sourceType === "telegram" ? await scrapePublicTelegram(sourceUrl) : {};
    const scrapedMedia = Array.isArray((scraped as TelegramScrape).media) ? (scraped as TelegramScrape).media! : [];

    const userId = req.session?.userId ?? null;
    let addedByName: string | null = null;
    if (userId) {
      const users = await query<{ username: string }>(`SELECT username FROM users WHERE id = $1 LIMIT 1`, [userId]);
      addedByName = users[0]?.username ?? null;
    }

    const rows = await query(
      `INSERT INTO product_hunting_items
       (source_url, normalized_url, source_type, title, description, image_url, media, channel_name, category, notes, supplier_url, target_price_egp, cost_price, cost_currency, added_by_user_id, added_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        sourceUrl,
        normalized,
        sourceType,
        (scraped as TelegramScrape).title ?? req.body?.title ?? null,
        (scraped as TelegramScrape).description ?? req.body?.description ?? null,
        (scraped as TelegramScrape).image_url ?? req.body?.image_url ?? null,
        JSON.stringify(scrapedMedia),
        (scraped as TelegramScrape).channel_name ?? null,
        req.body?.category ?? null,
        req.body?.notes ?? null,
        req.body?.supplier_url ?? null,
        (scraped as TelegramScrape).target_price_egp ?? req.body?.target_price_egp ?? null,
        req.body?.cost_price ?? null,
        req.body?.cost_currency ?? "CNY",
        userId,
        addedByName,
      ],
    );
    res.status(201).json({
      item: rows[0],
      scraped: Boolean((scraped as TelegramScrape).title || (scraped as TelegramScrape).image_url || (scraped as TelegramScrape).description || scrapedMedia.length),
      media_count: scrapedMedia.length,
      media_from_post_id: (scraped as TelegramScrape).media_from_post_id ?? null,
    });
  } catch (error) {
    console.error("product-hunting create error", error);
    res.status(500).json({ error: "تعذر إضافة المنتج" });
  }
});

router.post("/product-hunting/:id/refresh", async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "رقم المنتج غير صالح" });
    const current = await query<{ source_url: string; source_type: string }>(
      `SELECT source_url, source_type FROM product_hunting_items WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!current[0]) return res.status(404).json({ error: "المنتج غير موجود" });
    if (current[0].source_type !== "telegram") return res.status(400).json({ error: "تحديث الوسائط التلقائي متاح حاليًا لروابط Telegram" });

    const refreshed = await refreshExistingTelegram(id, current[0].source_url);
    res.json({ item: refreshed.item, media_count: refreshed.media_count, media_from_post_id: refreshed.scraped.media_from_post_id ?? null });
  } catch (error) {
    console.error("product-hunting refresh error", error);
    res.status(500).json({ error: "تعذر تحديث وسائط Telegram" });
  }
});

router.patch("/product-hunting/:id", async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "رقم المنتج غير صالح" });

    const updates: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown, cast = "") => {
      params.push(value);
      updates.push(`${column} = $${params.length}${cast}`);
    };

    if (typeof req.body?.status === "string") {
      if (!STATUSES.has(req.body.status)) return res.status(400).json({ error: "الحالة غير صالحة" });
      add("status", req.body.status);
    }
    if (typeof req.body?.is_favorite === "boolean") add("is_favorite", req.body.is_favorite);
    if (typeof req.body?.title === "string") add("title", req.body.title.trim() || null);
    if (typeof req.body?.description === "string") add("description", req.body.description.trim() || null);
    if (typeof req.body?.image_url === "string") add("image_url", req.body.image_url.trim() || null);
    if (Array.isArray(req.body?.media)) add("media", JSON.stringify(req.body.media), "::jsonb");
    if (typeof req.body?.category === "string") add("category", req.body.category.trim() || null);
    if (typeof req.body?.notes === "string") add("notes", req.body.notes.trim() || null);
    if (typeof req.body?.supplier_url === "string") add("supplier_url", req.body.supplier_url.trim() || null);
    if (req.body?.target_price_egp === null || typeof req.body?.target_price_egp === "number") add("target_price_egp", req.body.target_price_egp);
    if (req.body?.cost_price === null || typeof req.body?.cost_price === "number") add("cost_price", req.body.cost_price);
    if (typeof req.body?.cost_currency === "string") add("cost_currency", req.body.cost_currency.trim().toUpperCase().slice(0, 10) || "CNY");
    if (!updates.length) return res.status(400).json({ error: "لا توجد تعديلات" });

    params.push(id);
    const rows = await query(`UPDATE product_hunting_items SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ error: "المنتج غير موجود" });
    res.json({ item: rows[0] });
  } catch (error) {
    console.error("product-hunting update error", error);
    res.status(500).json({ error: "تعذر تحديث المنتج" });
  }
});

router.delete("/product-hunting/:id", async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "رقم المنتج غير صالح" });
    await query(`DELETE FROM product_hunting_items WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error("product-hunting delete error", error);
    res.status(500).json({ error: "تعذر حذف المنتج" });
  }
});

export default router;
