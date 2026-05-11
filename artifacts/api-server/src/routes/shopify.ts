import { Router } from "express";
import { query } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /api/shopify/config ───────────────────────────────────────────────────
router.get("/shopify/config", async (req, res) => {
  try {
    const rows = await query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key IN ('shopify_shop_domain', 'shopify_shop_name', 'shopify_connected') LIMIT 10`
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    return res.json({
      connected: map["shopify_connected"] === "true",
      shop_domain: map["shopify_shop_domain"] ?? null,
      shop_name: map["shopify_shop_name"] ?? null,
    });
  } catch {
    return res.json({ connected: false });
  }
});

// ── POST /api/shopify/config ──────────────────────────────────────────────────
router.post("/shopify/config", async (req, res) => {
  const { shop_domain, access_token } = req.body as {
    shop_domain?: string;
    access_token?: string;
  };

  if (!shop_domain?.trim() || !access_token?.trim()) {
    return res.status(400).json({ error: "shop_domain و access_token مطلوبان" });
  }

  // Test connection first
  try {
    const testRes = await fetch(
      `https://${shop_domain}/admin/api/2024-01/shop.json`,
      { headers: { "X-Shopify-Access-Token": access_token } }
    );

    if (!testRes.ok) {
      return res.status(400).json({ error: "فشل الاتصال بـ Shopify — تحقق من البيانات" });
    }

    const shopData = await testRes.json() as { shop?: { name?: string } };
    const shopName = shopData.shop?.name ?? shop_domain;

    // Store in app_settings
    await query(
      `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`
    );

    const pairs = [
      ["shopify_shop_domain", shop_domain],
      ["shopify_shop_name", shopName],
      ["shopify_access_token", access_token],
      ["shopify_connected", "true"],
    ];

    for (const [k, v] of pairs) {
      await query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [k, v]
      );
    }

    return res.json({ ok: true, shop_name: shopName });
  } catch (err) {
    logger.error({ err }, "Shopify config save error");
    return res.status(500).json({ error: "فشل حفظ الإعدادات" });
  }
});

// ── GET /api/shopify/products ─────────────────────────────────────────────────
router.get("/shopify/products", async (_req, res) => {
  try {
    const rows = await query<{ value: string }>(
      `SELECT value FROM app_settings WHERE key IN ('shopify_shop_domain','shopify_access_token') ORDER BY key`
    );

    if (rows.length < 2) {
      return res.status(400).json({ error: "Shopify غير مرتبط" });
    }

    const settingsMap: Record<string, string> = {};
    const allRows = await query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key IN ('shopify_shop_domain','shopify_access_token')`
    );
    for (const r of allRows) settingsMap[r.key] = r.value;

    const domain = settingsMap["shopify_shop_domain"];
    const token = settingsMap["shopify_access_token"];

    const pRes = await fetch(
      `https://${domain}/admin/api/2024-01/products.json?limit=50&fields=id,title,vendor,product_type,status,variants,image`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    if (!pRes.ok) {
      return res.status(502).json({ error: "فشل جلب المنتجات من Shopify" });
    }

    const data = await pRes.json() as {
      products: {
        id: number;
        title: string;
        vendor: string;
        product_type: string;
        status: string;
        variants: { inventory_quantity: number }[];
        image?: { src: string };
      }[];
    };

    const products = (data.products ?? []).map((p) => ({
      id: String(p.id),
      title: p.title,
      vendor: p.vendor,
      product_type: p.product_type,
      status: p.status,
      variants_count: p.variants?.length ?? 0,
      inventory_quantity: (p.variants ?? []).reduce(
        (s: number, v) => s + (v.inventory_quantity ?? 0),
        0
      ),
      image_url: p.image?.src ?? null,
    }));

    return res.json({ products });
  } catch (err) {
    logger.error({ err }, "Shopify products error");
    return res.status(500).json({ error: "خطأ في جلب المنتجات" });
  }
});

// ── GET /api/shopify/stats ────────────────────────────────────────────────────
router.get("/shopify/stats", async (_req, res) => {
  try {
    const allRows = await query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key IN ('shopify_shop_domain','shopify_access_token')`
    );
    const settingsMap: Record<string, string> = {};
    for (const r of allRows) settingsMap[r.key] = r.value;

    const domain = settingsMap["shopify_shop_domain"];
    const token = settingsMap["shopify_access_token"];

    if (!domain || !token) {
      return res.status(400).json({ error: "Shopify غير مرتبط" });
    }

    // Fetch recent orders
    const oRes = await fetch(
      `https://${domain}/admin/api/2024-01/orders.json?status=any&limit=250&fields=id,total_price,line_items`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    if (!oRes.ok) {
      return res.status(502).json({ error: "فشل جلب الطلبات من Shopify" });
    }

    const oData = await oRes.json() as {
      orders: {
        id: number;
        total_price: string;
        line_items: { title: string; quantity: number; price: string }[];
      }[];
    };

    const orders = oData.orders ?? [];
    const total_orders = orders.length;
    const total_revenue = orders.reduce(
      (s, o) => s + parseFloat(o.total_price ?? "0"),
      0
    );
    const average_order_value =
      total_orders > 0 ? total_revenue / total_orders : 0;

    // Top products
    const productMap: Record<string, { quantity: number; revenue: number }> = {};
    for (const o of orders) {
      for (const item of o.line_items ?? []) {
        if (!productMap[item.title]) productMap[item.title] = { quantity: 0, revenue: 0 };
        productMap[item.title].quantity += item.quantity ?? 0;
        productMap[item.title].revenue +=
          (item.quantity ?? 0) * parseFloat(item.price ?? "0");
      }
    }

    const top_products = Object.entries(productMap)
      .map(([title, d]) => ({ title, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return res.json({ total_orders, total_revenue, average_order_value, top_products });
  } catch (err) {
    logger.error({ err }, "Shopify stats error");
    return res.status(500).json({ error: "خطأ في حساب الإحصائيات" });
  }
});

export default router;
