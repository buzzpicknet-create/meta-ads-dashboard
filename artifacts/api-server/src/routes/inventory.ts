import { Router, type Request, type Response } from "express";
import { query } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { sendPushForEvent } from "../lib/push.js";

const router = Router();

// MULTI_STORE_INVENTORY_SOURCE_V2
const DEALME_ERP_BASE_URL = String(process.env.DEALME_ERP_BASE_URL || "").replace(/\/+$/, "");
const DEALME_INVENTORY_API_KEY = String(process.env.DEALME_INVENTORY_API_KEY || "");
const BUZZPICK_ERP_BASE_URL = String(process.env.BUZZPICK_ERP_BASE_URL || "").replace(/\/+$/, "");
const BUZZPICK_INVENTORY_API_KEY = String(process.env.BUZZPICK_INVENTORY_API_KEY || "");

const LOW_STOCK_THRESHOLD = 10;
const ALERT_DEDUP_HOURS = 24;
const NO_MOVEMENT_DAYS = 10;

type SourceStore = "dealme" | "buzzpick";

interface InventorySource {
  key: SourceStore;
  label: string;
  baseUrl: string;
  apiKey: string;
}

const INVENTORY_SOURCES: InventorySource[] = [
  {
    key: "dealme",
    label: "Dealme",
    baseUrl: DEALME_ERP_BASE_URL,
    apiKey: DEALME_INVENTORY_API_KEY,
  },
  {
    key: "buzzpick",
    label: "Buzzpick",
    baseUrl: BUZZPICK_ERP_BASE_URL,
    apiKey: BUZZPICK_INVENTORY_API_KEY,
  },
];

interface InventoryProduct {
  id: number;
  sourceProductId: string;
  sourceStore: SourceStore;
  storeName: string;
  name: string;
  sku: string;
  unit: string;
  currentStock: number;
  reservedQty: number;
  availableStock: number;
  minStock: number;
  sellingPrice: null;
  costPrice: null;
  warehouseLocation: string;
  isBundle: boolean;
  updatedAt: string;
}

interface ErpInventoryItem {
  productId: string;
  name: string;
  sku: string;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
  shortageQty: number;
  updatedAt: string | null;
}

interface ErpInventoryResponse {
  success: boolean;
  data: ErpInventoryItem[];
  pagination?: { total: number; page: number; limit: number; totalPages: number };
}

interface ErpSalesRateItem {
  productId: string;
  name: string;
  sku: string;
  sold7: number;
  sold14: number;
  sold30: number;
  dailyRate7: number;
  dailyRate14: number;
  dailyRate30: number;
  lastSaleAt: string | null;
}

interface ErpSalesRateResponse {
  success: boolean;
  data: ErpSalesRateItem[];
  windowDays: number;
  generatedAt: string;
}

interface SalesRateResult {
  source: InventorySource;
  payload: ErpSalesRateResponse;
}

// Dealme IDs must remain unchanged because tasks and stock-state records already
// reference them. Buzzpick uses the negative integer range, which guarantees that
// it can never collide with existing positive Dealme IDs.
function stableNumericProductId(sourceId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < sourceId.length; i++) {
    hash ^= sourceId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) & 0x7fffffff) || 1;
}

function sourceNumericProductId(source: SourceStore, sourceId: string): number {
  const positiveId = stableNumericProductId(sourceId);
  return source === "dealme" ? positiveId : -positiveId;
}

function enabledSources(): InventorySource[] {
  return INVENTORY_SOURCES.filter((source) => source.baseUrl && source.apiKey);
}

async function fetchInventorySource(source: InventorySource): Promise<InventoryProduct[]> {
  const url = new URL("/api/inventory/media-buying", source.baseUrl);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "500");

  const response = await fetch(url, {
    headers: { "X-Inventory-Api-Key": source.apiKey },
  });

  if (!response.ok) {
    throw new Error(`${source.label} inventory API failed: ${response.status}`);
  }

  const payload = (await response.json()) as ErpInventoryResponse;
  return (payload.data || []).map((item) => ({
    id: sourceNumericProductId(source.key, item.productId),
    sourceProductId: item.productId,
    sourceStore: source.key,
    storeName: source.label,
    name: item.name || "",
    sku: item.sku || "",
    unit: "قطعة",
    currentStock: Number(item.physicalQty || 0),
    reservedQty: Number(item.reservedQty || 0),
    availableStock: Number(item.availableQty || 0),
    minStock: LOW_STOCK_THRESHOLD,
    sellingPrice: null,
    costPrice: null,
    warehouseLocation: `مخزون ${source.label}`,
    isBundle: false,
    updatedAt: item.updatedAt || new Date().toISOString(),
  }));
}

async function fetchAllInventory(): Promise<{
  products: InventoryProduct[];
  availableSources: SourceStore[];
  failedSources: SourceStore[];
}> {
  const sources = enabledSources();
  if (!sources.length) {
    throw new Error("Inventory integration environment variables are missing");
  }

  const results = await Promise.allSettled(
    sources.map(async (source) => ({
      source,
      products: await fetchInventorySource(source),
    }))
  );

  const products: InventoryProduct[] = [];
  const availableSources: SourceStore[] = [];
  const failedSources: SourceStore[] = [];

  results.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "fulfilled") {
      products.push(...result.value.products);
      availableSources.push(source.key);
    } else {
      failedSources.push(source.key);
      logger.warn(
        { err: result.reason, source: source.key },
        "Inventory source failed; returning other available sources"
      );
    }
  });

  if (!availableSources.length) {
    throw new Error("All configured inventory sources failed");
  }

  return { products, availableSources, failedSources };
}

async function fetchSalesRateSource(source: InventorySource): Promise<SalesRateResult> {
  const url = new URL("/api/inventory/media-buying-sales-rate", source.baseUrl);
  const response = await fetch(url, {
    headers: { "X-Inventory-Api-Key": source.apiKey },
  });

  if (!response.ok) {
    throw new Error(`${source.label} sales-rate API failed: ${response.status}`);
  }

  return {
    source,
    payload: (await response.json()) as ErpSalesRateResponse,
  };
}

async function fetchAllSalesRates(): Promise<{
  results: SalesRateResult[];
  failedSources: SourceStore[];
}> {
  const sources = enabledSources();
  if (!sources.length) {
    throw new Error("Inventory integration environment variables are missing");
  }

  const settled = await Promise.allSettled(sources.map(fetchSalesRateSource));
  const results: SalesRateResult[] = [];
  const failedSources: SourceStore[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else {
      failedSources.push(sources[index].key);
      logger.warn(
        { err: result.reason, source: sources[index].key },
        "Sales-rate source failed; returning other available sources"
      );
    }
  });

  if (!results.length) {
    throw new Error("All configured sales-rate sources failed");
  }

  return { results, failedSources };
}

export async function checkInventoryAlerts(): Promise<void> {
  try {
    const { products } = await fetchAllInventory();

    const stateRows = await query<{
      product_id: number;
      last_stock: number;
      alert_sent_at: Date | null;
    }>(`SELECT product_id, last_stock, alert_sent_at FROM inventory_stock_state`);
    const stateMap = new Map(stateRows.map((row) => [row.product_id, row]));

    let lowCount = 0;
    let restockCount = 0;

    for (const product of products) {
      const previous = stateMap.get(product.id);
      const previousStock = previous?.last_stock ?? null;
      const alertSentAt = previous?.alert_sent_at ?? null;
      const isNowLow =
        product.availableStock > 0 &&
        product.availableStock <= LOW_STOCK_THRESHOLD;
      const wasLow =
        previousStock !== null &&
        previousStock > 0 &&
        previousStock <= LOW_STOCK_THRESHOLD;

      if (
        isNowLow &&
        (previousStock === null || previousStock > LOW_STOCK_THRESHOLD)
      ) {
        const dedupMs = ALERT_DEDUP_HOURS * 60 * 60 * 1000;
        const shouldSend =
          !alertSentAt ||
          Date.now() - new Date(alertSentAt).getTime() > dedupMs;

        if (shouldSend) {
          await sendPushForEvent("inventory_low_stock", {
            title: `⚠️ مخزون منخفض — ${product.storeName}`,
            body: `${product.name} — متبقي ${product.availableStock} قطعة فقط`,
            url: "/inventory",
          });
          lowCount++;
          await query(
            `INSERT INTO inventory_stock_state
               (product_id, product_name, last_stock, alert_sent_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (product_id) DO UPDATE SET
               product_name = $2,
               last_stock = $3,
               alert_sent_at = NOW(),
               updated_at = NOW()`,
            [
              product.id,
              `${product.storeName}: ${product.name}`,
              product.availableStock,
            ]
          );
          continue;
        }
      }

      if (wasLow && product.availableStock > LOW_STOCK_THRESHOLD) {
        await sendPushForEvent("inventory_restock", {
          title: `✅ تم إعادة تعبئة المخزون — ${product.storeName}`,
          body: `${product.name} — الكمية المتاحة: ${product.availableStock} قطعة`,
          url: "/inventory",
        });
        restockCount++;
        await query(
          `INSERT INTO inventory_stock_state
             (product_id, product_name, last_stock, alert_sent_at, updated_at)
           VALUES ($1, $2, $3, NULL, NOW())
           ON CONFLICT (product_id) DO UPDATE SET
             product_name = $2,
             last_stock = $3,
             alert_sent_at = NULL,
             updated_at = NOW()`,
          [
            product.id,
            `${product.storeName}: ${product.name}`,
            product.availableStock,
          ]
        );
        continue;
      }

      await query(
        `INSERT INTO inventory_stock_state
           (product_id, product_name, last_stock, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (product_id) DO UPDATE SET
           product_name = $2,
           last_stock = $3,
           updated_at = NOW()`,
        [
          product.id,
          `${product.storeName}: ${product.name}`,
          product.availableStock,
        ]
      );
    }

    if (lowCount > 0 || restockCount > 0) {
      logger.info({ lowCount, restockCount }, "Inventory alerts sent");
    } else {
      logger.info(
        { checked: products.length },
        "Inventory alert check complete — no alerts"
      );
    }
  } catch (err) {
    logger.warn({ err }, "checkInventoryAlerts failed");
  }
}

router.get("/inventory/products", async (_req: Request, res: Response) => {
  try {
    const result = await fetchAllInventory();
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result.products);
  } catch (err) {
    logger.error({ err }, "inventory/products failed");
    res.status(502).json({ error: "فشل جلب المخزون من مصادر ERP" });
  }
});

router.get("/inventory/products/stats", async (_req: Request, res: Response) => {
  try {
    const { products, availableSources, failedSources } = await fetchAllInventory();
    res.json({
      totalProducts: products.length,
      lowStockCount: products.filter(
        (product) =>
          product.availableStock > 0 &&
          product.availableStock <= LOW_STOCK_THRESHOLD
      ).length,
      totalMovementsToday: 0,
      totalSalesToday: 0,
      totalInToday: 0,
      totalPhysicalQty: products.reduce(
        (sum, product) => sum + product.currentStock,
        0
      ),
      totalReservedQty: products.reduce(
        (sum, product) => sum + product.reservedQty,
        0
      ),
      totalAvailableQty: products.reduce(
        (sum, product) => sum + product.availableStock,
        0
      ),
      source: "multi-erp-inventory",
      availableSources,
      failedSources,
    });
  } catch (err) {
    logger.error({ err }, "inventory/products/stats failed");
    res.status(502).json({ error: "فشل جلب إحصائيات المخزون" });
  }
});

router.get("/inventory/no-movement", async (_req: Request, res: Response) => {
  try {
    const { results, failedSources } = await fetchAllSalesRates();
    const activeProductIds = results.flatMap(({ source, payload }) =>
      (payload.data || [])
        .filter((item) => Number(item.sold30 || 0) > 0)
        .map((item) => sourceNumericProductId(source.key, item.productId))
    );

    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      sinceDate: new Date(Date.now() - NO_MOVEMENT_DAYS * 86400000).toISOString(),
      activeProductIds,
      available: true,
      source: "multi-erp-shipment-out-movements",
      availableSources: results.map((result) => result.source.key),
      failedSources,
    });
  } catch (err) {
    logger.error({ err }, "inventory/no-movement failed");
    res.status(502).json({ error: "فشل جلب بيانات حركة المبيعات" });
  }
});

router.get("/inventory/sales-rate", async (_req: Request, res: Response) => {
  try {
    const { results, failedSources } = await fetchAllSalesRates();
    const rates: Record<number, {
      sold7: number;
      sold14: number;
      sold30: number;
      dailyRate7: number;
      dailyRate14: number;
      dailyRate30: number;
      lastSaleAt: string | null;
    }> = {};

    for (const { source, payload } of results) {
      for (const item of payload.data || []) {
        rates[sourceNumericProductId(source.key, item.productId)] = {
          sold7: Number(item.sold7 || 0),
          sold14: Number(item.sold14 || 0),
          sold30: Number(item.sold30 || 0),
          dailyRate7: Number(item.dailyRate7 || 0),
          dailyRate14: Number(item.dailyRate14 || 0),
          dailyRate30: Number(item.dailyRate30 || 0),
          lastSaleAt: item.lastSaleAt || null,
        };
      }
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      generatedAt: new Date().toISOString(),
      rates,
      available: true,
      source: "multi-erp-shipment-out-movements",
      availableSources: results.map((result) => result.source.key),
      failedSources,
    });
  } catch (err) {
    logger.error({ err }, "inventory/sales-rate failed");
    res.status(502).json({ error: "فشل جلب معدلات المبيعات" });
  }
});

router.post("/inventory/check-alerts", async (_req: Request, res: Response) => {
  try {
    await checkInventoryAlerts();
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Manual inventory check failed");
    res.status(500).json({ error: "فشل الفحص" });
  }
});

export default router;
