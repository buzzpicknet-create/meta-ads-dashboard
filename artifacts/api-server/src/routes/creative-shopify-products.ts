import { Router, type Request, type Response } from "express";
import { db, shopifyStores } from "@workspace/db";

const router = Router();
const SHOPIFY_API_VERSION = "2024-01";

type SourceStore = "dealme" | "buzzpick";

type ShopifyProduct = {
  id: number;
  title?: string;
  handle?: string;
};

function publicBase(store: SourceStore) {
  return store === "dealme"
    ? "https://www.dealme-eg.com/products/"
    : "https://buzzpick.net/products/";
}

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
