import { Router } from "express";
import { query } from "../lib/db";
import { runMediaScan } from "../lib/media-scan";

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

interface DeleteLogEntry {
  id: number;
  request_id: number;
  campaign_name: string;
  status_at_deletion: string;
  priority_at_deletion: string;
  notes: string | null;
  deleted_at: string;
}

interface AuditLogEntry {
  id: number;
  request_id: number;
  campaign_name: string;
  action: string;
  priority: string | null;
  actioned_at: string;
}

// GET /api/media-requests — active (not deleted)
router.get("/media-requests", async (_req, res) => {
  try {
    const rows = await query<MediaRequest>(
      `SELECT id, campaign_id, campaign_name, landing_url, status, priority, notes, created_at, updated_at
       FROM media_requests
       WHERE deleted_at IS NULL
       ORDER BY
         CASE status WHEN 'needs_review' THEN 0 WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
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
      `INSERT INTO media_requests (campaign_id, campaign_name, landing_url, status, priority, notes)
       VALUES ($1, $2, $3, 'pending', $4, $5)
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
    // Fetch current row before update to detect approval
    const before = await query<MediaRequest>(
      `SELECT * FROM media_requests WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (before.length === 0) return res.status(404).json({ error: "Not found" });

    const rows = await query<MediaRequest>(
      `UPDATE media_requests SET ${updates.join(", ")} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    // Log approval: needs_review → pending
    const prev = before[0]!;
    const updated = rows[0]!;
    if (prev.status === "needs_review" && updated.status === "pending") {
      await query(
        `INSERT INTO media_audit_log (request_id, campaign_name, action, priority) VALUES ($1, $2, 'approved', $3)`,
        [id, updated.campaign_name, updated.priority]
      );
    }

    res.json({ request: updated });
  } catch (err) {
    res.status(500).json({ error: "Failed to update media request" });
  }
});

// DELETE /api/media-requests/:id — soft delete with audit log
router.delete("/media-requests/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  try {
    const existing = await query<MediaRequest>(
      `SELECT * FROM media_requests WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.length === 0) return res.status(404).json({ error: "Not found" });

    const row = existing[0]!;

    // Soft delete
    await query(
      `UPDATE media_requests SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    // Audit log (delete log)
    await query(
      `INSERT INTO media_delete_log (request_id, campaign_name, status_at_deletion, priority_at_deletion, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, row.campaign_name, row.status, row.priority, row.notes]
    );

    // Unified audit log — rejection
    await query(
      `INSERT INTO media_audit_log (request_id, campaign_name, action, priority) VALUES ($1, $2, 'rejected', $3)`,
      [id, row.campaign_name, row.priority]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete media request" });
  }
});

// GET /api/media-requests/audit-log — unified approvals + rejections
router.get("/media-requests/audit-log", async (_req, res) => {
  try {
    const rows = await query<AuditLogEntry>(
      `SELECT * FROM media_audit_log ORDER BY actioned_at DESC LIMIT 100`
    );
    res.json({ log: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// GET /api/media-requests/delete-log
router.get("/media-requests/delete-log", async (_req, res) => {
  try {
    const rows = await query<DeleteLogEntry>(
      `SELECT * FROM media_delete_log ORDER BY deleted_at DESC LIMIT 50`
    );
    res.json({ log: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch delete log" });
  }
});

// POST /api/media-requests/scan — manual trigger
router.post("/media-requests/scan", async (_req, res) => {
  try {
    const result = await runMediaScan();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/media-requests/scan-status — last scan info
router.get("/media-requests/scan-status", async (_req, res) => {
  try {
    const rows = await query<{
      scanned_at: string;
      campaigns_checked: number;
      requests_created: number;
    }>(
      `SELECT scanned_at, campaigns_checked, requests_created
       FROM media_scan_log ORDER BY scanned_at DESC LIMIT 1`
    );
    res.json({ last_scan: rows[0] ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scan status" });
  }
});

export default router;
