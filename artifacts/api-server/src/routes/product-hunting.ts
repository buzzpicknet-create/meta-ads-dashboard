import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";

const router = Router();

const STATUSES = new Set(["new", "reviewing", "interested", "sample", "imported", "rejected"]);

type ProductMedia = {
  type: "image" | "video";
  url: string;
  thumbnail_url?: string | null;
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
  const value = decodeHtml(raw).replace(/\\\//g, "/").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

function pushMedia(target: ProductMedia[], seen: Set<string>, media: ProductMedia) {
  const url = cleanMediaUrl(media.url);
  if (!url || seen.has(url)) return;
  seen.add(url);
  target.push({ ...media, url, thumbnail_url: cleanMediaUrl(media.thumbnail_url) });
}

function extractTelegramMedia(html: string, fallbackImage?: string | null): ProductMedia[] {
  const media: ProductMedia[] = [];
  const seen = new Set<string>();

  if (fallbackImage) pushMedia(media, seen, { type: "image", url: fallbackImage });

  // Telegram public/embed photo blocks use background-image:url(...).
  const photoBlocks = html.matchAll(/class=["'][^"']*tgme_widget_message_photo_wrap[^"']*["'][^>]*style=["'][^"']*background-image\s*:\s*url\((?:'|&quot;|\")?([^)'";&]+)(?:'|&quot;|\")?\)/gi);
  for (const match of photoBlocks) pushMedia(media, seen, { type: "image", url: match[1] });

  // Some Telegram markup puts the style before class.
  const reversePhotoBlocks = html.matchAll(/style=["'][^"']*background-image\s*:\s*url\((?:'|&quot;|\")?([^)'";&]+)(?:'|&quot;|\")?\)[^"']*["'][^>]*class=["'][^"']*tgme_widget_message_photo_wrap[^"']*["']/gi);
  for (const match of reversePhotoBlocks) pushMedia(media, seen, { type: "image", url: match[1] });

  // Direct video/source tags in Telegram's public message widget.
  const videoTags = html.matchAll(/<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi);
  for (const match of videoTags) pushMedia(media, seen, { type: "video", url: match[1], thumbnail_url: fallbackImage });

  // Telegram sometimes exposes the MP4 as a data attribute.
  const dataVideos = html.matchAll(/\bdata-(?:video|src)=["'](https?:\/\/[^"']+\.(?:mp4|webm)(?:\?[^"']*)?)["']/gi);
  for (const match of dataVideos) pushMedia(media, seen, { type: "video", url: match[1], thumbnail_url: fallbackImage });

  return media.slice(0, 20);
}

async function fetchTelegramHtml(url: URL) {
  const response = await fetch(url.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(9000),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; ProductHuntingDashboard/1.0)",
      "accept-language": "ar,en;q=0.8",
    },
  });
  return response.ok ? await response.text() : "";
}

async function scrapePublicTelegram(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return {}; }
  const host = parsed.hostname.toLowerCase();
  if (!["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(host)) return {};

  try {
    const html = await fetchTelegramHtml(parsed);
    if (!html) return {};

    const embed = new URL(parsed.toString());
    embed.searchParams.set("embed", "1");
    embed.searchParams.set("mode", "tme");
    let embedHtml = "";
    try { embedHtml = await fetchTelegramHtml(embed); } catch { /* main page still useful */ }

    const combinedHtml = `${html}\n${embedHtml}`;
    const title = meta(html, "og:title") ?? meta(html, "twitter:title");
    const description = meta(html, "og:description") ?? meta(html, "twitter:description");
    const image = meta(html, "og:image") ?? meta(html, "twitter:image");
    const media = extractTelegramMedia(combinedHtml, image);
    const cover = media.find((m) => m.type === "image")?.url ?? media.find((m) => m.thumbnail_url)?.thumbnail_url ?? image ?? null;
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const channel = pathParts[0] && !pathParts[0].startsWith("+") ? pathParts[0] : null;

    return {
      title,
      description,
      image_url: cover,
      media,
      channel_name: channel,
      target_price_egp: extractEgpPrice(description),
    };
  } catch {
    return {};
  }
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
    const statsRows = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM product_hunting_items GROUP BY status`,
    );
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
    const existing = await query(`SELECT * FROM product_hunting_items WHERE normalized_url = $1 LIMIT 1`, [normalized]);
    if (existing[0]) return res.status(409).json({ error: "المنتج مضاف بالفعل", duplicate: existing[0] });

    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase();
    const sourceType = host.includes("t.me") || host.includes("telegram.me") ? "telegram" : host.includes("tiktok") ? "tiktok" : host.includes("aliexpress") ? "aliexpress" : "other";
    const scraped = sourceType === "telegram" ? await scrapePublicTelegram(sourceUrl) : {};
    const scrapedMedia = Array.isArray((scraped as any).media) ? (scraped as any).media : [];

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
        (scraped as any).title ?? req.body?.title ?? null,
        (scraped as any).description ?? req.body?.description ?? null,
        (scraped as any).image_url ?? req.body?.image_url ?? null,
        JSON.stringify(scrapedMedia),
        (scraped as any).channel_name ?? null,
        req.body?.category ?? null,
        req.body?.notes ?? null,
        req.body?.supplier_url ?? null,
        (scraped as any).target_price_egp ?? req.body?.target_price_egp ?? null,
        req.body?.cost_price ?? null,
        req.body?.cost_currency ?? "CNY",
        userId,
        addedByName,
      ],
    );
    res.status(201).json({
      item: rows[0],
      scraped: Boolean((scraped as any).title || (scraped as any).image_url || (scraped as any).description || scrapedMedia.length),
      media_count: scrapedMedia.length,
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
    const current = await query<{ source_url: string; source_type: string; title: string | null; description: string | null; target_price_egp: number | null }>(
      `SELECT source_url, source_type, title, description, target_price_egp FROM product_hunting_items WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!current[0]) return res.status(404).json({ error: "المنتج غير موجود" });
    if (current[0].source_type !== "telegram") return res.status(400).json({ error: "تحديث الوسائط التلقائي متاح حاليًا لروابط Telegram" });

    const scraped = await scrapePublicTelegram(current[0].source_url);
    const media = Array.isArray((scraped as any).media) ? (scraped as any).media : [];
    const rows = await query(
      `UPDATE product_hunting_items SET
         title = COALESCE(NULLIF(title, ''), $1),
         description = COALESCE(NULLIF(description, ''), $2),
         image_url = COALESCE($3, image_url),
         media = $4::jsonb,
         channel_name = COALESCE($5, channel_name),
         target_price_egp = COALESCE(target_price_egp, $6),
         updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [
        (scraped as any).title ?? null,
        (scraped as any).description ?? null,
        (scraped as any).image_url ?? null,
        JSON.stringify(media),
        (scraped as any).channel_name ?? null,
        (scraped as any).target_price_egp ?? null,
        id,
      ],
    );
    res.json({ item: rows[0], media_count: media.length });
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
    const rows = await query(
      `UPDATE product_hunting_items SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params,
    );
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
