import { Router } from "express";
import { query } from "../lib/db";

const router = Router();

interface MediaRequest {
  id: number;
  campaign_id: string | null;
  campaign_name: string;
  landing_url: string | null;
  status: string;
  priority: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/media-requests
router.get("/media-requests", async (_req, res) => {
  try {
    const rows = await query<MediaRequest>(
      `SELECT * FROM media_requests ORDER BY
        CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        created_at DESC`
    );
    res.json({ requests: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch media requests" });
  }
});

// POST /api/media-requests
router.post("/media-requests", async (req, res) => {
  const { campaign_id, campaign_name, landing_url, priority, notes } = req.body as {
    campaign_id?: string;
    campaign_name: string;
    landing_url?: string;
    priority?: string;
    notes?: string;
  };

  if (!campaign_name) {
    return res.status(400).json({ error: "campaign_name is required" });
  }

  try {
    const rows = await query<MediaRequest>(
      `INSERT INTO media_requests (campaign_id, campaign_name, landing_url, priority, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [campaign_id ?? null, campaign_name, landing_url ?? null, priority ?? "normal", notes ?? null]
    );
    res.status(201).json({ request: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to create media request" });
  }
});

// PATCH /api/media-requests/:id
router.patch("/media-requests/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  const { status, priority, landing_url, notes, campaign_name } = req.body as {
    status?: string;
    priority?: string;
    landing_url?: string;
    notes?: string;
    campaign_name?: string;
  };

  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
  if (priority !== undefined) { updates.push(`priority = $${idx++}`); params.push(priority); }
  if (landing_url !== undefined) { updates.push(`landing_url = $${idx++}`); params.push(landing_url); }
  if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(notes); }
  if (campaign_name !== undefined) { updates.push(`campaign_name = $${idx++}`); params.push(campaign_name); }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  updates.push(`updated_at = NOW()`);
  params.push(id);

  try {
    const rows = await query<MediaRequest>(
      `UPDATE media_requests SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ request: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update media request" });
  }
});

// DELETE /api/media-requests/:id
router.delete("/media-requests/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  try {
    await query(`DELETE FROM media_requests WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete media request" });
  }
});

export default router;
