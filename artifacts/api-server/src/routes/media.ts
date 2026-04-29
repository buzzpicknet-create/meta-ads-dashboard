import { Router } from "express";
import { query } from "../lib/db";
import { runMediaScan } from "../lib/media-scan";
import { sendPushToRoles } from "../lib/push";
import "../lib/auth-middleware";

const router = Router();

interface MediaRequest {
  id: number;
  campaign_id: string | null;
  campaign_name: string;
  account_id: string | null;
  landing_url: string | null;
  status: string;
  priority: string;
  notes: string | null;
  drive_link: string | null;
  product_description: string | null;
  angles: string | null;
  scripts: string | null;
  reference_links: string | null;
  output_link: string | null;
  upload_link: string | null;
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
      `SELECT id, campaign_id, campaign_name, account_id, landing_url, status, priority, notes,
              drive_link, product_description, angles, scripts, reference_links,
              output_link, upload_link, created_at, updated_at
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
  const { campaign_id, campaign_name, account_id, landing_url, priority, notes,
          drive_link, product_description, angles, scripts, reference_links } = req.body as {
    campaign_id?: string;
    campaign_name: string;
    account_id?: string;
    landing_url?: string;
    priority?: string;
    notes?: string;
    drive_link?: string;
    product_description?: string;
    angles?: string;
    scripts?: string;
    reference_links?: string;
  };

  if (!campaign_name) {
    return res.status(400).json({ error: "campaign_name is required" });
  }

  try {
    const rows = await query<MediaRequest>(
      `INSERT INTO media_requests
         (campaign_id, campaign_name, account_id, landing_url, status, priority, notes,
          drive_link, product_description, angles, scripts, reference_links)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [campaign_id ?? null, campaign_name, account_id ?? null, landing_url ?? null,
       priority ?? "normal", notes ?? null,
       drive_link ?? null, product_description ?? null, angles ?? null, scripts ?? null, reference_links ?? null]
    );
    res.status(201).json({ request: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to create media request" });
  }
});

// PATCH /api/media-requests/:id
router.patch("/media-requests/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  const userRole = req.session?.role;

  const { status, priority, landing_url, notes, campaign_name,
          drive_link, product_description, angles, scripts, reference_links,
          output_link, upload_link } = req.body as {
    status?: string;
    priority?: string;
    landing_url?: string;
    notes?: string;
    campaign_name?: string;
    drive_link?: string;
    product_description?: string;
    angles?: string;
    scripts?: string;
    reference_links?: string;
    output_link?: string;
    upload_link?: string;
  };

  // media_manager cannot set status to needs_review
  if (status === "needs_review" && userRole !== "admin") {
    return res.status(403).json({ error: "غير مصرح — لا يمكن تعيين حالة 'قيد المراجعة'" });
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
  if (priority !== undefined) { updates.push(`priority = $${idx++}`); params.push(priority); }
  if (landing_url !== undefined) { updates.push(`landing_url = $${idx++}`); params.push(landing_url); }
  if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(notes); }
  if (campaign_name !== undefined) { updates.push(`campaign_name = $${idx++}`); params.push(campaign_name); }
  if (drive_link !== undefined) { updates.push(`drive_link = $${idx++}`); params.push(drive_link); }
  if (product_description !== undefined) { updates.push(`product_description = $${idx++}`); params.push(product_description); }
  if (angles !== undefined) { updates.push(`angles = $${idx++}`); params.push(angles); }
  if (scripts !== undefined) { updates.push(`scripts = $${idx++}`); params.push(scripts); }
  if (reference_links !== undefined) { updates.push(`reference_links = $${idx++}`); params.push(reference_links); }
  if (output_link !== undefined) { updates.push(`output_link = $${idx++}`); params.push(output_link); }
  if (upload_link !== undefined) { updates.push(`upload_link = $${idx++}`); params.push(upload_link); }

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

    // Push notifications on status changes
    if (prev.status !== updated.status) {
      const name = updated.campaign_name.slice(0, 40);
      if (updated.status === "completed") {
        sendPushToRoles(["admin", "media_buyer"], {
          title: "✅ طلب ميديا مكتمل",
          body: `تم تسليم الميديا لحملة "${name}"`,
          url: "/media",
        }).catch(() => null);
      } else if (updated.status === "rejected") {
        sendPushToRoles(["admin"], {
          title: "🔴 طلب ميديا مرفوض",
          body: `تم رفض طلب حملة "${name}"`,
          url: "/media",
        }).catch(() => null);
      }
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
