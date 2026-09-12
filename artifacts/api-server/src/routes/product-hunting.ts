import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";

const router = Router();

const STATUSES = new Set(["new", "reviewing", "interested", "sample", "imported", "rejected"]);

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
      channel_name TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'new',
      is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      category VARCHAR(100),
      notes TEXT,
      added_by_user_id INT REFERENCES users(id),
      added_by_name VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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

async function scrapePublicTelegram(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return {}; }
  const host = parsed.hostname.toLowerCase();
  if (!["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(host)) return {};

  try {
    const response = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ProductHuntingDashboard/1.0)",
        "accept-language": "ar,en;q=0.8",
      },
    });
    if (!response.ok) return {};
    const html = await response.text();
    const title = meta(html, "og:title") ?? meta(html, "twitter:title");
    const description = meta(html, "og:description") ?? meta(html, "twitter:description");
    const image = meta(html, "og:image") ?? meta(html, "twitter:image");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const channel = pathParts[0] && !pathParts[0].startsWith("+") ? pathParts[0] : null;
    return { title, description, image_url: image, channel_name: channel };
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
      where.push(`(COALESCE(title,'') ILIKE $${params.length} OR COALESCE(description,'') ILIKE $${params.length} OR source_url ILIKE $${params.length} OR COALESCE(channel_name,'') ILIKE $${params.length})`);
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
    const stats: Record<string, number> = { total: rows.length, favorites: Number(favorites[0]?.count ?? 0) };
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

    const userId = req.session?.userId ?? null;
    let addedByName: string | null = null;
    if (userId) {
      const users = await query<{ username: string }>(`SELECT username FROM users WHERE id = $1 LIMIT 1`, [userId]);
      addedByName = users[0]?.username ?? null;
    }

    const rows = await query(
      `INSERT INTO product_hunting_items
       (source_url, normalized_url, source_type, title, description, image_url, channel_name, category, notes, added_by_user_id, added_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        sourceUrl,
        normalized,
        sourceType,
        (scraped as any).title ?? req.body?.title ?? null,
        (scraped as any).description ?? null,
        (scraped as any).image_url ?? null,
        (scraped as any).channel_name ?? null,
        req.body?.category ?? null,
        req.body?.notes ?? null,
        userId,
        addedByName,
      ],
    );
    res.status(201).json({ item: rows[0], scraped: Boolean((scraped as any).title || (scraped as any).image_url) });
  } catch (error) {
    console.error("product-hunting create error", error);
    res.status(500).json({ error: "تعذر إضافة المنتج" });
  }
});

router.patch("/product-hunting/:id", async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "رقم المنتج غير صالح" });

    const updates: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    };

    if (typeof req.body?.status === "string") {
      if (!STATUSES.has(req.body.status)) return res.status(400).json({ error: "الحالة غير صالحة" });
      add("status", req.body.status);
    }
    if (typeof req.body?.is_favorite === "boolean") add("is_favorite", req.body.is_favorite);
    if (typeof req.body?.title === "string") add("title", req.body.title.trim() || null);
    if (typeof req.body?.category === "string") add("category", req.body.category.trim() || null);
    if (typeof req.body?.notes === "string") add("notes", req.body.notes.trim() || null);
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
