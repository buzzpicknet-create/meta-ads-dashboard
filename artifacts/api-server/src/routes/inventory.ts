import { Router, type Request, type Response } from "express";
import { query } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { sendPushForEvent } from "../lib/push.js";

const router = Router();

// DEALME_INVENTORY_SOURCE_V1B
const DEALME_ERP_BASE_URL = String(process.env.DEALME_ERP_BASE_URL || "").replace(/\/+$/, "");
const DEALME_INVENTORY_API_KEY = String(process.env.DEALME_INVENTORY_API_KEY || "");
const LOW_STOCK_THRESHOLD = 10;
const ALERT_DEDUP_HOURS = 24;
const NO_MOVEMENT_DAYS = 10;
const ALERT_WAREHOUSE = "مخزن السوق"; // alerts only apply to this warehouse

interface InventoryProduct {
  id: number;
  sourceProductId: string;
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

interface DealmeInventoryItem {
  productId: string;
  name: string;
  sku: string;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
  shortageQty: number;
  updatedAt: string | null;
}

interface DealmeInventoryResponse {
  success: boolean;
  data: DealmeInventoryItem[];
  pagination?: { total: number; page: number; limit: number; totalPages: number };
}

interface DealmeSalesRateItem {
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

interface DealmeSalesRateResponse {
  success: boolean;
  data: DealmeSalesRateItem[];
  windowDays: number;
  generatedAt: string;
}

function stableNumericProductId(sourceId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < sourceId.length; i++) {
    hash ^= sourceId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

// DEALME_SALES_RATE_SOURCE_V1
async function fetchDealmeSalesRates(): Promise<DealmeSalesRateResponse> {
  if (!DEALME_ERP_BASE_URL || !DEALME_INVENTORY_API_KEY) {
    throw new Error("Dealme inventory integration environment variables are missing");
  }

  const url = new URL("/api/inventory/media-buying-sales-rate", DEALME_ERP_BASE_URL);
  const response = await fetch(url, {
    headers: { "X-Inventory-Api-Key": DEALME_INVENTORY_API_KEY },
  });

  if (!response.ok) {
    throw new Error("Dealme sales-rate API failed: " + response.status);
  }

  return (await response.json()) as DealmeSalesRateResponse;
}

async function fetchDealmeInventory(): Promise<InventoryProduct[]> {
  if (!DEALME_ERP_BASE_URL || !DEALME_INVENTORY_API_KEY) {
    throw new Error("Dealme inventory integration environment variables are missing");
  }

  const url = new URL("/api/inventory/media-buying", DEALME_ERP_BASE_URL);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "500");

  const response = await fetch(url, {
    headers: { "X-Inventory-Api-Key": DEALME_INVENTORY_API_KEY },
  });
  if (!response.ok) {
    throw new Error("Dealme inventory API failed: " + response.status);
  }

  const payload = (await response.json()) as DealmeInventoryResponse;
  return (payload.data || []).map((item) => ({
    id: stableNumericProductId(item.productId),
    sourceProductId: item.productId,
    name: item.name || "",
    sku: item.sku || "",
    unit: "قطعة",
    currentStock: Number(item.physicalQty || 0),
    reservedQty: Number(item.reservedQty || 0),
    availableStock: Number(item.availableQty || 0),
    minStock: LOW_STOCK_THRESHOLD,
    sellingPrice: null,
    costPrice: null,
    warehouseLocation: "مخزون Dealme",
    isBundle: false,
    updatedAt: item.updatedAt || new Date().toISOString(),
  }));
}

export async function checkInventoryAlerts(): Promise<void> {
  try {
    const products = await fetchDealmeInventory();

    const stateRows = await query<{
      product_id: number;
      last_stock: number;
      alert_sent_at: Date | null;
    }>(`SELECT product_id, last_stock, alert_sent_at FROM inventory_stock_state`);
    const stateMap = new Map(stateRows.map((r) => [r.product_id, r]));

    let lowCount = 0;
    let restockCount = 0;

    for (const p of products) {
      const prev = stateMap.get(p.id);
      const prevStock = prev?.last_stock ?? null;
      const alertSentAt = prev?.alert_sent_at ?? null;

      const isNowLow = p.currentStock > 0 && p.currentStock <= LOW_STOCK_THRESHOLD;
      const wasLow =
        prevStock !== null && prevStock > 0 && prevStock <= LOW_STOCK_THRESHOLD;

      // Low stock transition: was OK (or first time) → now low
      if (isNowLow && (prevStock === null || prevStock > LOW_STOCK_THRESHOLD)) {
        const dedupMs = ALERT_DEDUP_HOURS * 60 * 60 * 1000;
        const shouldSend =
          !alertSentAt ||
          Date.now() - new Date(alertSentAt).getTime() > dedupMs;

        if (shouldSend) {
          await sendPushForEvent("inventory_low_stock", {
            title: "⚠️ مخزون منخفض",
            body: `${p.name} — متبقي ${p.currentStock} قطعة فقط`,
            url: "/inventory",
          });
          lowCount++;
          await query(
            `INSERT INTO inventory_stock_state (product_id, product_name, last_stock, alert_sent_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (product_id) DO UPDATE SET
               product_name = $2, last_stock = $3,
               alert_sent_at = NOW(), updated_at = NOW()`,
            [p.id, p.name, p.currentStock]
          );
          continue;
        }
      }

      // Restock transition: was low → now above threshold
      if (wasLow && p.currentStock > LOW_STOCK_THRESHOLD) {
        await sendPushForEvent("inventory_restock", {
          title: "✅ تم إعادة تعبئة المخزون",
          body: `${p.name} — الكمية الحالية: ${p.currentStock} قطعة`,
          url: "/inventory",
        });
        restockCount++;
        await query(
          `INSERT INTO inventory_stock_state (product_id, product_name, last_stock, alert_sent_at, updated_at)
           VALUES ($1, $2, $3, NULL, NOW())
           ON CONFLICT (product_id) DO UPDATE SET
             product_name = $2, last_stock = $3,
             alert_sent_at = NULL, updated_at = NOW()`,
          [p.id, p.name, p.currentStock]
        );
        continue;
      }

      // Update stock level (no alert)
      await query(
        `INSERT INTO inventory_stock_state (product_id, product_name, last_stock, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (product_id) DO UPDATE SET
           product_name = $2, last_stock = $3, updated_at = NOW()`,
        [p.id, p.name, p.currentStock]
      );
    }

    if (lowCount > 0 || restockCount > 0) {
      logger.info({ lowCount, restockCount }, "Inventory alerts sent");
    } else {
      logger.info({ checked: products.length }, "Inventory alert check complete — no alerts");
    }
  } catch (err) {
    logger.warn({ err }, "checkInventoryAlerts failed");
  }
}

// GET /api/inventory/products — Dealme ERP stock feed
router.get("/inventory/products", async (_req: Request, res: Response) => {
  try {
    const products = await fetchDealmeInventory();
    res.setHeader("Cache-Control", "private, no-store");
    res.json(products);
  } catch (err) {
    logger.error({ err }, "inventory/products failed");
    res.status(502).json({ error: "فشل جلب مخزون Dealme" });
  }
});

// GET /api/inventory/products/stats — Dealme stock KPIs
router.get("/inventory/products/stats", async (_req: Request, res: Response) => {
  try {
    const products = await fetchDealmeInventory();
    res.json({
      totalProducts: products.length,
      lowStockCount: products.filter((p) => p.availableStock > 0 && p.availableStock <= LOW_STOCK_THRESHOLD).length,
      totalMovementsToday: 0,
      totalSalesToday: 0,
      totalInToday: 0,
      totalPhysicalQty: products.reduce((sum, p) => sum + p.currentStock, 0),
      totalReservedQty: products.reduce((sum, p) => sum + p.reservedQty, 0),
      totalAvailableQty: products.reduce((sum, p) => sum + p.availableStock, 0),
      source: "dealme-erp-inventory",
    });
  } catch (err) {
    logger.error({ err }, "inventory/products/stats failed");
    res.status(502).json({ error: "فشل جلب إحصائيات مخزون Dealme" });
  }
});

// DEALME_SALES_RATE_SOURCE_V1
// Uses Dealme SHIPMENT_OUT movements and maps ERP UUIDs to the same stable
// numeric IDs used by the inventory page.
router.get("/inventory/no-movement", async (_req: Request, res: Response) => {
  try {
    const payload = await fetchDealmeSalesRates();
    const activeProductIds = (payload.data || [])
      .filter((item) => Number(item.sold30 || 0) > 0)
      .map((item) => stableNumericProductId(item.productId));

    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      sinceDate: new Date(Date.now() - 30 * 86400000).toISOString(),
      activeProductIds,
      available: true,
      source: "dealme-erp-shipment-out-movements",
    });
  } catch (err) {
    logger.error({ err }, "inventory/no-movement failed");
    res.status(502).json({ error: "فشل جلب بيانات حركة مبيعات Dealme" });
  }
});

router.get("/inventory/sales-rate", async (_req: Request, res: Response) => {
  try {
    const payload = await fetchDealmeSalesRates();
    const rates: Record<number, {
      sold7: number;
      sold14: number;
      sold30: number;
      dailyRate7: number;
      dailyRate14: number;
      dailyRate30: number;
      lastSaleAt: string | null;
    }> = {};

    for (const item of payload.data || []) {
      rates[stableNumericProductId(item.productId)] = {
        sold7: Number(item.sold7 || 0),
        sold14: Number(item.sold14 || 0),
        sold30: Number(item.sold30 || 0),
        dailyRate7: Number(item.dailyRate7 || 0),
        dailyRate14: Number(item.dailyRate14 || 0),
        dailyRate30: Number(item.dailyRate30 || 0),
        lastSaleAt: item.lastSaleAt || null,
      };
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      generatedAt: payload.generatedAt || new Date().toISOString(),
      rates,
      available: true,
      source: "dealme-erp-shipment-out-movements",
    });
  } catch (err) {
    logger.error({ err }, "inventory/sales-rate failed");
    res.status(502).json({ error: "فشل جلب معدل مبيعات Dealme" });
  }
});

// POST /api/inventory/check-alerts — manual trigger
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
