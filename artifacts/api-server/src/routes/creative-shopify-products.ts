import { Router, type Request, type Response } from "express";
import { db, shopifyStores } from "@workspace/db";

const router = Router();
const SHOPIFY_API_VERSION = "2024-01";

type SourceStore = "dealme" | "buzzpick";

type ShopifyProduct = {
  id: number;
  title?: string;
  handle?: string;
  variants?: Array<{ price?: string; compare_at_price?: string }>;
  images?: Array<{ src?: string }>;
};

function publicBase(store: SourceStore) {
  return store === "dealme"
    ? "https://www.dealme-eg.com/products/"
    : "https://buzzpick.net/products/";
}

function nextLink(linkHeader: string | null) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    if (!part.includes('rel="next"')) continue;
    const match = part.match(/<([^>]+)>/);
    if (match?.[1]) return match[1];
  }
  return null;
}

router.get("/shopify/products-simple", async (req: Request, res: Response): Promise<void> => {
  const storeId = req.query.storeId ? Number(req.query.storeId) : NaN;
  if (!Number.isFinite(storeId)) {
    res.status(400).json({ error: "storeId غير صحيح", products: [] });
    return;
  }

  try {
    const stores = await db.select().from(shopifyStores);
    const store = stores.find((row) => Number(row.id) === storeId);
    if (!store?.domain || !store?.accessToken) {
      res.status(404).json({ error: "المتجر غير مربوط", products: [] });
      return;
    }

    const products: ShopifyProduct[] = [];
    let url: string | null = `https://${store.domain}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,handle,variants,images`;
    let pages = 0;

    while (url && pages < 20) {
      const upstream = await fetch(url, {
        headers: { "X-Shopify-Access-Token": store.accessToken },
        signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `فشل جلب المنتجات (${upstream.status})`, products: [] });
        return;
      }
      const payload = await upstream.json() as { products?: ShopifyProduct[] };
      products.push(...(payload.products ?? []));
      url = nextLink(upstream.headers.get("link"));
      pages += 1;
    }

    res.json({
      products: products.map((p) => ({
        id: String(p.id),
        title: p.title ?? "",
        handle: p.handle ?? "",
        image: p.images?.[0]?.src ?? "",
        price: p.variants?.[0]?.price ?? "",
        comparePrice: p.variants?.[0]?.compare_at_price ?? "",
      })),
    });
  } catch (error) {
    console.error("creative routine paginated Shopify product list failed", error);
    res.status(500).json({ error: "تعذر جلب منتجات Shopify", products: [] });
  }
});

router.get("/creative-routine/shopify-product-pages", async (req: Request, res: Response): Promise<void> => {
  const store = String(req.query.store || "") as SourceStore;
  const ids = String(req.query.ids || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .slice(0, 100);

  if (!(["dealme", "buzzpick"] as string[]).includes(store) || ids.length === 0) {
    res.status(400).json({ error: "store و ids مطلوبان", products: [] });
    return;
  }

  try {
    const stores = await db.select().from(shopifyStores);
    if (!stores.length) {
      res.json({ products: [] });
      return;
    }

    const wanted = new Set(ids);
    const found = new Map<string, { id: string; handle: string; url: string }>();

    for (const connectedStore of stores) {
      if (!connectedStore.domain || !connectedStore.accessToken || found.size === wanted.size) continue;

      const missing = ids.filter((id) => !found.has(id));
      if (!missing.length) break;

      const url = new URL(`https://${connectedStore.domain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
      url.searchParams.set("ids", missing.join(","));
      url.searchParams.set("limit", String(Math.min(100, missing.length)));
      url.searchParams.set("fields", "id,title,handle");

      const upstream = await fetch(url, {
        headers: { "X-Shopify-Access-Token": connectedStore.accessToken },
        signal: AbortSignal.timeout(12000),
      });

      if (!upstream.ok) continue;

      const payload = await upstream.json() as { products?: ShopifyProduct[] };
      for (const product of payload.products ?? []) {
        const id = String(product.id || "");
        const handle = String(product.handle || "").trim();
        if (!wanted.has(id) || !handle || found.has(id)) continue;
        found.set(id, {
          id,
          handle,
          url: `${publicBase(store)}${encodeURIComponent(handle)}`,
        });
      }
    }

    res.json({ products: Array.from(found.values()) });
  } catch (error) {
    console.error("creative routine Shopify product lookup failed", error);
    res.status(500).json({ error: "تعذر جلب روابط منتجات Shopify", products: [] });
  }
});

export default router;
