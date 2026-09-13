import { Router } from "express";
import { query } from "../lib/db";

const router = Router();
const VALID_STATUS = new Set(["queued", "in_progress", "review", "done"]);

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS creative_routine_items (
      inventory_product_id INTEGER PRIMARY KEY,
      landing_url TEXT,
      material_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      output_drive_url TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'queued',
      started_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      updated_by_user_id INTEGER REFERENCES users(id),
      updated_by_name VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE creative_routine_items ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`);
  await query(`ALTER TABLE creative_routine_items ADD COLUMN IF NOT EXISTS hidden_by_user_id INTEGER REFERENCES users(id)`);
  await query(`ALTER TABLE creative_routine_items ADD COLUMN IF NOT EXISTS hidden_by_name VARCHAR(100)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_creative_routine_status ON creative_routine_items(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_creative_routine_hidden ON creative_routine_items(hidden_at)`);

  await query(`
    CREATE TABLE IF NOT EXISTS creative_routine_history (
      id BIGSERIAL PRIMARY KEY,
      inventory_product_id INTEGER NOT NULL,
      product_name TEXT,
      source_store VARCHAR(30),
      landing_url TEXT,
      material_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      output_drive_url TEXT,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_by_user_id INTEGER REFERENCES users(id),
      completed_by_name VARCHAR(100)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_creative_routine_history_product ON creative_routine_history(inventory_product_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_creative_routine_history_completed ON creative_routine_history(completed_at DESC)`);

  await query(`
    INSERT INTO creative_routine_history (
      inventory_product_id, landing_url, material_links, output_drive_url,
      completed_at, completed_by_user_id, completed_by_name
    )
    SELECT
      i.inventory_product_id, i.landing_url, i.material_links, i.output_drive_url,
      i.approved_at, i.updated_by_user_id, i.updated_by_name
    FROM creative_routine_items i
    WHERE i.status = 'done'
      AND i.approved_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM creative_routine_history h
        WHERE h.inventory_product_id = i.inventory_product_id
          AND h.completed_at = i.approved_at
      )
  `);
}

router.get("/creative-routine/items", async (_req, res) => {
  try {
    await ensureTable();
    const rows = await query(`SELECT * FROM creative_routine_items ORDER BY updated_at DESC`);
    res.json({ items: rows });
  } catch (error) {
    console.error("creative-routine list failed", error);
    res.status(500).json({ error: "تعذر تحميل بيانات روتين الكريتف" });
  }
});

router.get("/creative-routine/history", async (_req, res) => {
  try {
    await ensureTable();
    const rows = await query(`
      SELECT *
      FROM creative_routine_history
      ORDER BY completed_at DESC
      LIMIT 1000
    `);
    res.json({ items: rows });
  } catch (error) {
    console.error("creative-routine history failed", error);
    res.status(500).json({ error: "تعذر تحميل سجل الميديا" });
  }
});

router.delete("/creative-routine/items/:productId", async (req, res) => {
  try {
    await ensureTable();
    if (req.session?.role !== "admin") {
      return res.status(403).json({ error: "الحذف متاح للأدمن فقط" });
    }

    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId === 0 || productId < -2147483647 || productId > 2147483647) {
      return res.status(400).json({ error: "productId غير صحيح" });
    }

    const rows = await query(`
      INSERT INTO creative_routine_items (
        inventory_product_id, status, hidden_at, hidden_by_user_id, hidden_by_name,
        updated_by_user_id, updated_by_name
      ) VALUES ($1, 'queued', NOW(), $2, $3, $2, $3)
      ON CONFLICT (inventory_product_id) DO UPDATE SET
        hidden_at = NOW(),
        hidden_by_user_id = $2,
        hidden_by_name = $3,
        updated_by_user_id = $2,
        updated_by_name = $3,
        updated_at = NOW()
      RETURNING *
    `, [productId, req.session!.userId, req.session!.username]);

    res.json({ item: rows[0], hidden: true });
  } catch (error) {
    console.error("creative-routine admin hide failed", error);
    res.status(500).json({ error: "تعذر حذف الكارت من الطابور" });
  }
});

router.patch("/creative-routine/items/:productId", async (req, res) => {
  try {
    await ensureTable();
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId === 0 || productId < -2147483647 || productId > 2147483647) {
      return res.status(400).json({ error: "productId غير صحيح" });
    }

    const body = req.body as {
      landing_url?: string | null;
      material_links?: string[] | null;
      output_drive_url?: string | null;
      status?: string;
      product_name?: string | null;
      source_store?: string | null;
    };

    if (body.status !== undefined && !VALID_STATUS.has(body.status)) {
      return res.status(400).json({ error: "status غير صحيح" });
    }

    const currentRows = await query<any>(
      `SELECT * FROM creative_routine_items WHERE inventory_product_id = $1`,
      [productId]
    );
    const current = currentRows[0] ?? null;
    const nextStatus = body.status ?? current?.status ?? "queued";
    const landingUrl = body.landing_url !== undefined ? body.landing_url : current?.landing_url ?? null;
    const materialLinks = body.material_links !== undefined
      ? (Array.isArray(body.material_links) ? body.material_links.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 50) : [])
      : (current?.material_links ?? []);
    const outputDriveUrl = body.output_drive_url !== undefined ? body.output_drive_url : current?.output_drive_url ?? null;

    const startedAt = nextStatus === "in_progress" && current?.status !== "in_progress"
      ? new Date().toISOString()
      : current?.started_at ?? null;
    const submittedAt = nextStatus === "review" && current?.status !== "review"
      ? new Date().toISOString()
      : current?.submitted_at ?? null;
    const approvedAt = nextStatus === "done" && current?.status !== "done"
      ? new Date().toISOString()
      : current?.approved_at ?? null;

    const rows = await query(`
      INSERT INTO creative_routine_items (
        inventory_product_id, landing_url, material_links, output_drive_url, status,
        started_at, submitted_at, approved_at, updated_by_user_id, updated_by_name
      ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (inventory_product_id) DO UPDATE SET
        landing_url = EXCLUDED.landing_url,
        material_links = EXCLUDED.material_links,
        output_drive_url = EXCLUDED.output_drive_url,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        submitted_at = EXCLUDED.submitted_at,
        approved_at = EXCLUDED.approved_at,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_by_name = EXCLUDED.updated_by_name,
        updated_at = NOW()
      RETURNING *
    `, [
      productId,
      landingUrl || null,
      JSON.stringify(materialLinks),
      outputDriveUrl || null,
      nextStatus,
      startedAt,
      submittedAt,
      approvedAt,
      req.session!.userId,
      req.session!.username,
    ]);

    if (nextStatus === "done" && current?.status !== "done") {
      await query(`
        INSERT INTO creative_routine_history (
          inventory_product_id, product_name, source_store, landing_url,
          material_links, output_drive_url, completed_at,
          completed_by_user_id, completed_by_name
        ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
      `, [
        productId,
        body.product_name?.trim() || null,
        body.source_store?.trim() || null,
        landingUrl || null,
        JSON.stringify(materialLinks),
        outputDriveUrl || null,
        approvedAt,
        req.session!.userId,
        req.session!.username,
      ]);
    }

    res.json({ item: rows[0] });
  } catch (error) {
    console.error("creative-routine patch failed", error);
    res.status(500).json({ error: "تعذر حفظ بيانات المهمة" });
  }
});

export default router;
