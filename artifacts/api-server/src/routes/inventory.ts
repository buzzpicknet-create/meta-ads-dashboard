import { Router, type Request, type Response } from "express";
import { query } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { sendPushForEvent } from "../lib/push.js";

const router = Router();

const INVENTORY_BASE = "https://inventory-flow-seomasr.replit.app";
const LOW_STOCK_THRESHOLD = 10;
const ALERT_DEDUP_HOURS = 24;
const NO_MOVEMENT_DAYS = 10;
const ALERT_WAREHOUSE = "مخزن السوق"; // alerts only apply to this warehouse

interface InventoryProduct {
  id: number;
  name: string;
  sku: string;
  currentStock: number;
  warehouseLocation: string;
}

interface InventoryMovement {
  id: number;
  productId: number;
  type: "in" | "out";
  date: string; // YYYY-MM-DD
}

export async function checkInventoryAlerts(): Promise<void> {
  try {
    const res = await fetch(`${INVENTORY_BASE}/api/products`);
    if (!res.ok) {
      logger.warn({ status: res.status }, "Inventory alert check: API failed");
      return;
    }
    const allProducts: InventoryProduct[] = await res.json();
    // Only monitor the target warehouse
    const products = allProducts.filter(p => p.warehouseLocation === ALERT_WAREHOUSE);

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

// GET /api/inventory/no-movement — product IDs with no OUT movement in last N days
router.get("/inventory/no-movement", async (_req: Request, res: Response) => {
  try {
    const sinceDate = new Date(
      Date.now() - NO_MOVEMENT_DAYS * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD

    // Fetch a large batch of recent movements from the external API
    const movRes = await fetch(
      `${INVENTORY_BASE}/api/movements?limit=5000`
    );
    if (!movRes.ok) {
      return res.status(502).json({ error: "Inventory movements API failed" });
    }
    const movements: InventoryMovement[] = await movRes.json();

    // Collect product IDs that had ANY movement (in or out) in the last 10 days
    const activeIds = new Set<number>();
    for (const m of movements) {
      if (m.date >= sinceDate) {
        activeIds.add(m.productId);
      }
    }

    res.json({ sinceDate, activeProductIds: Array.from(activeIds) });
  } catch (err) {
    logger.error({ err }, "inventory/no-movement failed");
    res.status(500).json({ error: "فشل جلب حركات المخزون" });
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
