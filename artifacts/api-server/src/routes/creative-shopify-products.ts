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

type ErpInventoryItem = {
  productId?: string;
  externalProductId?: string | null;
  name?: string;
  sku?: string;
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

function normalizeName(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

async function loadPublicProducts(sourceStore: SourceStore): Promise<ShopifyProduct[]> {
  const base = publicStore(sourceStore);
  const products: ShopifyProduct[] = [];

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

function erpConfig(sourceStore: SourceStore) {
  if (sourceStore === "dealme") {
    return {
      baseUrl: String(process.env.DEALME_ERP_BASE_URL || "").replace(/\/+$/, ""),
      apiKey: String(process.env.DEALME_INVENTORY_API_KEY || ""),
    };
  }
  return {
    baseUrl: String(process.env.BUZZPICK_ERP_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: String(process.env.BUZZPICK_INVENTORY_API_KEY || ""),
  };
}

async function loadErpInventory(sourceStore: SourceStore): Promise<ErpInventoryItem[]> {
  const { baseUrl, apiKey } = erpConfig(sourceStore);
  if (!baseUrl || !apiKey) return [];

  const items: ErpInventoryItem[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL("/api/inventory/media-buying", baseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "500");

    const upstream = await fetch(url, {
      headers: { "X-Inventory-Api-Key": apiKey },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!upstream.ok) throw new Error(`erp_inventory_${sourceStore}_${upstream.status}`);

    const payload = await upstream.json() as {
      data?: ErpInventoryItem[];
      pagination?: { totalPages?: number; total?: number; limit?: number };
    };
    const batch = Array.isArray(payload.data) ? payload.data : [];
    items.push(...batch);

    const reportedPages = Number(payload.pagination?.totalPages || 0);
    const reportedTotal = Number(payload.pagination?.total || 0);
    const reportedLimit = Number(payload.pagination?.limit || 500);
    if (reportedPages > 0) totalPages = reportedPages;
    else if (reportedTotal > 0 && reportedLimit > 0) totalPages = Math.max(1, Math.ceil(reportedTotal / reportedLimit));
    else totalPages = batch.length >= 500 ? page + 1 : page;

    page += 1;
  } while (page <= totalPages && page <= 100);

  return items;
}

function mapCreativeProducts(erpItems: ErpInventoryItem[], shopifyProducts: ShopifyProduct[]) {
  const shopifyById = new Map<string, ShopifyProduct>();
  const shopifyByName = new Map<string, ShopifyProduct[]>();

  for (const product of shopifyProducts) {
    shopifyById.set(String(product.id), product);
    const name = normalizeName(product.title);
    if (!name) continue;
    const rows = shopifyByName.get(name) || [];
    rows.push(product);
    shopifyByName.set(name, rows);
  }

  const mapped = [] as Array<{
    id: string;
    title: string;
    handle: string;
    image: string;
    price: string;
    comparePrice: string;
  }>;

  for (const item of erpItems) {
    const internalId = String(item.productId || "").trim();
    if (!internalId) continue;

    let shopifyProduct: ShopifyProduct | undefined;
    const externalId = String(item.externalProductId || "").trim();
    if (externalId) shopifyProduct = shopifyById.get(externalId);

    if (!shopifyProduct) {
      const nameMatches = shopifyByName.get(normalizeName(item.name)) || [];
      if (nameMatches.length === 1) shopifyProduct = nameMatches[0];
    }

    if (!shopifyProduct?.handle) continue;
    mapped.push({
      id: internalId,
      title: item.name || shopifyProduct.title || "",
      handle: String(shopifyProduct.handle),
      image: shopifyProduct.images?.[0]?.src ?? "",
      price: shopifyProduct.variants?.[0]?.price ?? "",
      comparePrice: shopifyProduct.variants?.[0]?.compare_at_price ?? "",
    });
  }

  return mapped;
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
    const referer = String(req.headers.referer || "");
    const isCreativeRoutine = referer.includes("/creative-routine-preview");

    if (isCreativeRoutine) {
      const erpItems = await loadErpInventory(sourceStore);
      res.json({ products: mapCreativeProducts(erpItems, products) });
      return;
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
    console.error("creative routine Shopify storefront list failed", error);
    res.status(500).json({ error: "تعذر جلب منتجات Shopify", products: [] });
  }
});

router.get("/creative-routine/shopify-product-pages", async (req: Request, res: Response): Promise<void> => {
  const store = String(req.query.store || "") as SourceStore;
  const ids = String(req.query.ids || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!(["dealme", "buzzpick"] as string[]).includes(store) || ids.length === 0) {
    res.status(400).json({ error: "store و ids مطلوبان", products: [] });
    return;
  }

  try {
    const wanted = new Set(ids);
    const [shopifyProducts, erpItems] = await Promise.all([
      loadPublicProducts(store),
      loadErpInventory(store),
    ]);
    const mapped = mapCreativeProducts(erpItems, shopifyProducts);
    const result = mapped
      .filter((product) => wanted.has(product.id))
      .map((product) => ({
        id: product.id,
        handle: product.handle,
        url: `${publicStore(store)}/products/${encodeURIComponent(product.handle)}`,
      }));

    res.json({ products: result });
  } catch (error) {
    console.error("creative routine Shopify storefront lookup failed", error);
    res.status(500).json({ error: "تعذر جلب روابط منتجات Shopify", products: [] });
  }
});

export default router;
