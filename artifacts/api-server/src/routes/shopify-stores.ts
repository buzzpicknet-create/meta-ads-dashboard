import { Router, type IRouter, type Request, type Response } from "express";
import { db, shopifyStores, shopifyConfig } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const SHOPIFY_API_VERSION = "2024-01";

// ─── GET /shopify/stores ──────────────────────────────────────────────────────
router.get("/shopify/stores", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select().from(shopifyStores).orderBy(shopifyStores.id);
    res.json({ stores: rows });
  } catch (err) {
    req.log.error({ err }, "shopify-stores list error");
    res.status(500).json({ error: "خطأ في جلب المتاجر" });
  }
});

// ─── POST /shopify/stores ─────────────────────────────────────────────────────
router.post("/shopify/stores", async (req: Request, res: Response): Promise<void> => {
  const { domain, accessToken, shopName, isDefault } = req.body as {
    domain?: string;
    accessToken?: string;
    shopName?: string;
    isDefault?: boolean;
  };

  if (!domain?.trim() || !accessToken?.trim()) {
    res.status(400).json({ error: "domain و accessToken مطلوبان" });
    return;
  }

  try {
    // Validate token against Shopify API
    const testRes = await fetch(
      `https://${domain.trim()}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
      {
        headers: { "X-Shopify-Access-Token": accessToken.trim() },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!testRes.ok) {
      res.status(400).json({ error: `فشل التحقق من Token (${testRes.status}) — تأكد من صحة الـ Domain والـ Token` });
      return;
    }
    const shopData = await testRes.json() as { shop?: { name?: string } };
    const resolvedShopName = shopName?.trim() || shopData.shop?.name || domain.trim();

    // If marking as default, clear existing defaults
    if (isDefault) {
      await db.update(shopifyStores).set({ isDefault: false });
    }

    const [inserted] = await db.insert(shopifyStores).values({
      domain: domain.trim(),
      accessToken: accessToken.trim(),
      shopName: resolvedShopName,
      isDefault: isDefault ?? false,
    }).returning();

    logger.info({ storeId: inserted.id, domain: inserted.domain }, "shopify_store_added");
    res.json({ success: true, store: inserted });
  } catch (err) {
    req.log.error({ err }, "shopify-stores add error");
    res.status(500).json({ error: "خطأ في إضافة المتجر" });
  }
});

// ─── PATCH /shopify/stores/:id/default ────────────────────────────────────────
router.patch("/shopify/stores/:id/default", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  try {
    await db.update(shopifyStores).set({ isDefault: false });
    await db.update(shopifyStores).set({ isDefault: true }).where(eq(shopifyStores.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "shopify-stores set-default error");
    res.status(500).json({ error: "خطأ في تعيين المتجر الافتراضي" });
  }
});

// ─── DELETE /shopify/stores/:id ───────────────────────────────────────────────
router.delete("/shopify/stores/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  try {
    await db.delete(shopifyStores).where(eq(shopifyStores.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "shopify-stores delete error");
    res.status(500).json({ error: "خطأ في حذف المتجر" });
  }
});

// ─── GET /shopify/token-status ────────────────────────────────────────────────
router.get("/shopify/token-status", async (req: Request, res: Response): Promise<void> => {
  try {
    const stores = await db.select().from(shopifyStores);
    if (stores.length === 0) {
      // Legacy: check shopify_config table
      const rows = await db.select().from(shopifyConfig);
      const kvs: Record<string, string> = {};
      for (const r of rows) kvs[r.key] = r.value;
      if (kvs.access_token) {
        res.json({ connected: true, legacy: true, domain: kvs.domain });
      } else {
        res.json({ connected: false });
      }
      return;
    }
    const def = stores.find(s => s.isDefault) ?? stores[0];
    res.json({ connected: true, storeCount: stores.length, defaultStore: { id: def.id, domain: def.domain, shopName: def.shopName } });
  } catch (err) {
    req.log.error({ err }, "shopify token-status error");
    res.status(500).json({ error: "خطأ في التحقق من الاتصال" });
  }
});

// ─── GET /shopify/products-simple ────────────────────────────────────────────
// Returns a lightweight product list (id, title, handle, image, price) for the LP generator dropdown.
router.get("/shopify/products-simple", async (req: Request, res: Response): Promise<void> => {
  const storeId = req.query.storeId ? parseInt(String(req.query.storeId), 10) : undefined;

  try {
    let domain: string | null = null;
    let token: string | null = null;

    if (storeId && Number.isFinite(storeId)) {
      const rows = await db.select().from(shopifyStores).where(eq(shopifyStores.id, storeId)).limit(1);
      if (rows[0]) { domain = rows[0].domain; token = rows[0].accessToken; }
    }

    if (!domain || !token) {
      const rows = await db.select().from(shopifyStores).limit(10);
      const def = rows.find(r => r.isDefault) ?? rows[0];
      if (def) { domain = def.domain; token = def.accessToken; }
    }

    if (!domain || !token) {
      res.status(401).json({ error: "لم يتم ربط Shopify بعد" });
      return;
    }

    const shopifyRes = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,handle,variants,images`,
      { headers: { "X-Shopify-Access-Token": token }, signal: AbortSignal.timeout(15000) }
    );

    if (!shopifyRes.ok) {
      res.status(shopifyRes.status).json({ error: `فشل جلب المنتجات (${shopifyRes.status})` });
      return;
    }

    type ShopifyProduct = {
      id: number;
      title: string;
      handle: string;
      variants?: Array<{ price?: string; compare_at_price?: string }>;
      images?: Array<{ src?: string }>;
    };
    const data = await shopifyRes.json() as { products?: ShopifyProduct[] };

    const products = (data.products ?? []).map(p => ({
      id: String(p.id),
      title: p.title,
      handle: p.handle,
      image: p.images?.[0]?.src ?? "",
      price: p.variants?.[0]?.price ?? "",
      comparePrice: p.variants?.[0]?.compare_at_price ?? "",
    }));

    res.json({ products });
  } catch (err) {
    req.log.error({ err }, "shopify products-simple error");
    res.status(500).json({ error: "خطأ في جلب المنتجات" });
  }
});

// ─── POST /shopify/products/scrape ───────────────────────────────────────────
// Scrapes product data from an AliExpress / external URL via cheerio.
router.post("/shopify/products/scrape", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url?: string };
  if (!url?.trim()) {
    res.status(400).json({ error: "url مطلوب" });
    return;
  }

  try {
    const fetchRes = await fetch(url.trim(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!fetchRes.ok) {
      res.status(400).json({ error: `فشل جلب الصفحة (${fetchRes.status})` });
      return;
    }

    const html = await fetchRes.text();
    const { load } = await import("cheerio");
    const $ = load(html);

    // Extract title
    const title =
      $('h1[class*="title"]').first().text().trim() ||
      $("h1").first().text().trim() ||
      $("title").text().replace(/\s*[|\-–]\s*AliExpress.*$/i, "").trim() ||
      "";

    // Extract price
    const priceText =
      $('[class*="price-current"]').first().text().trim() ||
      $('[class*="product-price"]').first().text().trim() ||
      $('[itemprop="price"]').attr("content") ||
      "";
    const priceMatch = priceText.match(/[\d.,]+/);
    const price = priceMatch ? priceMatch[0].replace(",", ".") : "";

    // Extract description
    const desc =
      $('[class*="description"]').first().text().trim().slice(0, 500) ||
      $('[id*="description"]').first().text().trim().slice(0, 500) ||
      "";

    // Extract images
    const images: string[] = [];
    $('img[src*="ae01"]').each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (src && src.startsWith("http") && !images.includes(src)) images.push(src);
    });
    $('img[src*="alicdn"]').each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src && src.startsWith("http") && !images.includes(src) && images.length < 8) images.push(src);
    });

    res.json({ success: true, product: { title, price, desc, images: images.slice(0, 8) } });
  } catch (err) {
    req.log.error({ err }, "shopify products-scrape error");
    res.status(500).json({ error: "خطأ في استخراج بيانات المنتج" });
  }
});

// ─── GET /shopify/products/import-data/:handle ───────────────────────────────
// Fetches full product data from Shopify by handle (for import into LP generator).
router.get("/shopify/products/import-data/:handle", async (req: Request, res: Response): Promise<void> => {
  const { handle } = req.params;
  const storeId = req.query.storeId ? parseInt(String(req.query.storeId), 10) : undefined;

  try {
    let domain: string | null = null;
    let token: string | null = null;

    if (storeId && Number.isFinite(storeId)) {
      const rows = await db.select().from(shopifyStores).where(eq(shopifyStores.id, storeId)).limit(1);
      if (rows[0]) { domain = rows[0].domain; token = rows[0].accessToken; }
    }

    if (!domain || !token) {
      const rows = await db.select().from(shopifyStores).limit(10);
      const def = rows.find(r => r.isDefault) ?? rows[0];
      if (def) { domain = def.domain; token = def.accessToken; }
    }

    if (!domain || !token) {
      res.status(401).json({ error: "لم يتم ربط Shopify بعد" });
      return;
    }

    const shopifyRes = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json?handle=${encodeURIComponent(handle)}&limit=1`,
      { headers: { "X-Shopify-Access-Token": token }, signal: AbortSignal.timeout(10000) }
    );

    if (!shopifyRes.ok) {
      res.status(shopifyRes.status).json({ error: `فشل جلب المنتج (${shopifyRes.status})` });
      return;
    }

    type ShopifyProductFull = {
      id: number;
      title: string;
      handle: string;
      body_html?: string;
      variants?: Array<{ price?: string; compare_at_price?: string }>;
      images?: Array<{ src?: string }>;
    };
    const data = await shopifyRes.json() as { products?: ShopifyProductFull[] };
    const product = data.products?.[0];

    if (!product) {
      res.status(404).json({ error: "المنتج غير موجود" });
      return;
    }

    // Strip HTML from body_html for clean description
    const desc = (product.body_html ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);

    res.json({
      success: true,
      product: {
        id: String(product.id),
        title: product.title,
        handle: product.handle,
        price: product.variants?.[0]?.price ?? "",
        comparePrice: product.variants?.[0]?.compare_at_price ?? "",
        desc,
        images: (product.images ?? []).map(i => i.src).filter(Boolean).slice(0, 8),
      }
    });
  } catch (err) {
    req.log.error({ err }, "shopify products-import-data error");
    res.status(500).json({ error: "خطأ في جلب بيانات المنتج" });
  }
});

// ─── POST /shopify/upload-custom-image ───────────────────────────────────────
// Accepts base64 image, saves to object storage, returns a stable URL.
router.post("/shopify/upload-custom-image", async (req: Request, res: Response): Promise<void> => {
  const { imageBase64, mimeType = "image/jpeg", filename } = req.body as {
    imageBase64?: string;
    mimeType?: string;
    filename?: string;
  };

  if (!imageBase64?.trim()) {
    res.status(400).json({ error: "imageBase64 مطلوب" });
    return;
  }

  try {
    const { getStorage } = await import("@replit/object-storage");
    const storage = getStorage();

    const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const key = `user-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const buf = Buffer.from(imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    await storage.uploadFromBytes(key, buf, { contentType: mimeType });

    const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
    const domain = domains.find(d => !d.includes(".worf.replit.dev")) ?? domains[0] ?? process.env.REPLIT_DEV_DOMAIN ?? "";
    const url = domain ? `https://${domain}/api/storage/${key}` : `/api/storage/${key}`;

    logger.info({ key, mimeType, filename }, "custom_image_uploaded");
    res.json({ success: true, url, key });
  } catch (err) {
    req.log.error({ err }, "shopify upload-custom-image error");
    res.status(500).json({ error: "خطأ في رفع الصورة" });
  }
});

export default router;
