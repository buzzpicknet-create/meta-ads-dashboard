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
  await query(`CREATE INDEX IF NOT EXISTS idx_creative_routine_status ON creative_routine_items(status)`);
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

    res.json({ item: rows[0] });
  } catch (error) {
    console.error("creative-routine patch failed", error);
    res.status(500).json({ error: "تعذر حفظ بيانات المهمة" });
  }
});

export default router;
