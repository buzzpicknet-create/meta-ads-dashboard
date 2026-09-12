import { Router, type Request, type Response } from "express";
import { db, shopifyStores } from "@workspace/db";

const router = Router();

type SourceStore = "dealme" | "buzzpick";

type ShopifyProduct = {
  id: number;
  title?: string;
  handle?: string;
  variants?: Array<{ price?: string; compare_at_price?: string }>;
  images?: Array<{ src?: string }>;
};

function publicStore(store: SourceStore) {
  return store === "dealme" ? "https://www.dealme-eg.com" : "https://buzzpick.net";
}

function detectSourceStore(domain: string): SourceStore | null {
  const value = domain.toLowerCase();
  if (value.includes("dealme")) return "dealme";
  if (value.includes("buzzpick")) return "buzzpick";
  return null;
}

async function loadPublicProducts(sourceStore: SourceStore): Promise<ShopifyProduct[]> {
  const base = publicStore(sourceStore);
  const products: ShopifyProduct[] = [];

  // Current catalog sizes are below 250, but keep page fallback for future growth.
  for (let page = 1; page <= 10; page += 1) {
    const url = `${base}/products.json?limit=250&page=${page}`;
    const upstream = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      if (page === 1) throw new Error(`storefront_${upstream.status}`);
      break;
    }

    const payload = await upstream.json() as { products?: ShopifyProduct[] };
    const batch = payload.products ?? [];
    products.push(...batch);
    if (batch.length < 250) break;
  }

  return products;
}

router.get("/shopify/products-simple", async (req: Request, res: Response): Promise<void> => {
  const storeId = req.query.storeId ? Number(req.query.storeId) : NaN;
  if (!Number.isFinite(storeId)) {
    res.status(400).json({ error: "storeId غير صحيح", products: [] });
    return;
  }

  try {
    const stores = await db.select().from(shopifyStores);
    const connectedStore = stores.find((row) => Number(row.id) === storeId);
    if (!connectedStore?.domain) {
      res.status(404).json({ error: "المتجر غير مربوط", products: [] });
      return;
    }

    const sourceStore = detectSourceStore(connectedStore.domain);
    if (!sourceStore) {
      res.status(404).json({ error: "تعذر تحديد المتجر", products: [] });
      return;
    }

    const products = await loadPublicProducts(sourceStore);
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
    console.error("creative routine Shopify storefront list failed", error);
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
    const wanted = new Set(ids);
    const products = await loadPublicProducts(store);
    const result = products
      .filter((product) => wanted.has(String(product.id)) && product.handle)
      .map((product) => ({
        id: String(product.id),
        handle: String(product.handle),
        url: `${publicStore(store)}/products/${encodeURIComponent(String(product.handle))}`,
      }));

    res.json({ products: result });
  } catch (error) {
    console.error("creative routine Shopify storefront lookup failed", error);
    res.status(500).json({ error: "تعذر جلب روابط منتجات Shopify", products: [] });
  }
});

export default router;
