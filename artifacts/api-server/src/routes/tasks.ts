import { Router } from "express";
import { query } from "../lib/db.js";
import { requireAdmin } from "../lib/auth-middleware.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { sendPushToUser, sendPushToRoles } from "../lib/push.js";

const router = Router();
const objectStorage = new ObjectStorageService();

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  id: number;
  title: string;
  product_name: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  deadline: string;
  success_metric: string | null;
  status: "pending" | "in_progress" | "completed" | "expired";
  created_by_id: number | null;
  created_by_name: string | null;
  completed_at: string | null;
  checkin_count: number;
  last_checkin_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskMedia {
  id: number;
  task_id: number;
  original_name: string;
  file_path: string;
  mime_type: string;
  is_primary: boolean;
}

interface TaskNote {
  id: number;
  task_id: number;
  user_id: number;
  username: string;
  note_text: string;
  created_at: string;
}

interface TaskView {
  id: number;
  task_id: number;
  user_id: number;
  username: string;
  viewed_at: string;
}

// ── Scoring algorithm ─────────────────────────────────────────────────────────
// Score = (deadline - completed_at) / (deadline - created_at) * 100
// e.g. 10h task, done in 1h → remaining 9h → score = 9/10 * 100 = 90%
// Late completions score 0.

export function calcScore(task: Task): number {
  if (task.status !== "completed" || !task.completed_at) return 0;
  const created  = new Date(task.created_at).getTime();
  const deadline = new Date(task.deadline).getTime();
  const done     = new Date(task.completed_at).getTime();
  const duration = Math.max(1, deadline - created);

  if (done > deadline) return 0;

  const remaining = deadline - done;
  return Math.max(0, Math.min(100, Math.round((remaining / duration) * 100)));
}

// ── Auto-expire ───────────────────────────────────────────────────────────────

async function autoExpire() {
  await query(`
    UPDATE tasks SET status = 'expired', updated_at = NOW()
    WHERE status IN ('pending','in_progress') AND deadline < NOW()
  `);
}

// ── Attach media to tasks ─────────────────────────────────────────────────────

async function attachMedia(tasks: (Task & { media?: TaskMedia[]; opus_score?: number })[]) {
  if (!tasks.length) return tasks;
  const ids = tasks.map(t => t.id);
  const mediaRows = await query<TaskMedia>(
    `SELECT * FROM task_media WHERE task_id = ANY($1::int[]) ORDER BY is_primary DESC, created_at ASC`,
    [ids]
  );
  const map = new Map<number, TaskMedia[]>();
  for (const m of mediaRows) {
    if (!map.has(m.task_id)) map.set(m.task_id, []);
    map.get(m.task_id)!.push(m);
  }
  return tasks.map(t => ({ ...t, media: map.get(t.id) ?? [] }));
}

// ── GET /api/tasks ────────────────────────────────────────────────────────────

router.get("/tasks", async (req, res) => {
  await autoExpire();
  const userId = req.session!.userId;
  const role   = req.session!.role;

  const rows: Task[] = role === "admin"
    ? await query<Task>(`
        SELECT * FROM tasks ORDER BY
          CASE status WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 WHEN 'expired' THEN 3 ELSE 4 END,
          deadline ASC
      `)
    : await query<Task>(`
        SELECT * FROM tasks WHERE assigned_to_id = $1
        ORDER BY
          CASE status WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 WHEN 'expired' THEN 3 ELSE 4 END,
          deadline ASC
      `, [userId]);

  const withMedia = await attachMedia(rows.map(t => ({ ...t, opus_score: calcScore(t) })));
  res.json(withMedia);
});


// ── GET /api/tasks/by-product/:productId ─────────────────────────────────────

router.get("/tasks/by-product/:productId", async (req, res) => {
  const productId = parseInt(String(req.params.productId), 10);
  if (isNaN(productId)) return res.status(400).json({ error: "productId غير صحيح" });

  const rows = await query<Task>(`
    SELECT * FROM tasks
    WHERE inventory_product_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [productId]);

  const withMedia = await attachMedia(rows.map(t => ({ ...t, opus_score: calcScore(t) })));
  res.json(withMedia);
});

// ── GET /api/tasks/stats ──────────────────────────────────────────────────────

router.get("/tasks/stats", async (_req, res) => {
  const rows = await query<Task>(`
    SELECT t.* FROM tasks t
    INNER JOIN users u ON u.id = t.assigned_to_id
    WHERE t.assigned_to_id IS NOT NULL
      AND u.role = 'media_buyer'
      AND u.deleted_at IS NULL
  `);

  type BuyerStat = {
    userId: number; name: string; total_tasks: number;
    completed_on_time: number; completed_late: number;
    in_progress: number; expired: number; total_checkins: number;
    score: number; avg_score: number;
  };

  const map = new Map<number, BuyerStat>();
  for (const t of rows) {
    if (!t.assigned_to_id) continue;
    if (!map.has(t.assigned_to_id)) {
      map.set(t.assigned_to_id, {
        userId: t.assigned_to_id, name: t.assigned_to_name ?? `User ${t.assigned_to_id}`,
        total_tasks: 0, completed_on_time: 0, completed_late: 0,
        in_progress: 0, expired: 0, total_checkins: 0, score: 0, avg_score: 0,
      });
    }
    const s = map.get(t.assigned_to_id)!;
    s.total_tasks++;
    s.total_checkins += t.checkin_count;
    if (t.status === "completed") {
      const done = new Date(t.completed_at!).getTime();
      if (done <= new Date(t.deadline).getTime()) s.completed_on_time++;
      else s.completed_late++;
      s.score += calcScore(t);
    } else if (t.status === "in_progress") s.in_progress++;
    else if (t.status === "expired") s.expired++;
  }

  const rawStats = Array.from(map.values()).map(s => ({
    ...s,
    avg_score: s.completed_on_time + s.completed_late > 0
      ? Math.round(s.score / (s.completed_on_time + s.completed_late)) : 0,
  }));

  // أكبر عدد تاسكات مكتملة بين كل الميديا باير
  const maxCompleted = Math.max(1, ...rawStats.map(s => s.completed_on_time + s.completed_late));

  const stats = rawStats.map(s => {
    const speedScore    = s.avg_score; // 0-100
    const totalCompleted = s.completed_on_time + s.completed_late;
    const volumeScore   = Math.round((totalCompleted / maxCompleted) * 100); // 0-100
    const finalScore    = Math.round(speedScore * 0.7 + volumeScore * 0.3);
    return { ...s, avg_score: finalScore, speed_score: speedScore, volume_score: volumeScore };
  });

  stats.sort((a, b) => b.avg_score - a.avg_score);
  res.json(stats);
});

// ── GET /api/tasks/assignees ──────────────────────────────────────────────────

router.get("/tasks/assignees", async (_req, res) => {
  const rows = await query<{ id: number; username: string; role: string }>(
    `SELECT id, username, role FROM users WHERE deleted_at IS NULL AND role IN ('admin','media_buyer') ORDER BY username`
  );
  res.json(rows);
});

// ── POST /api/tasks ───────────────────────────────────────────────────────────

router.post("/tasks", requireAdmin, async (req, res) => {
  const { title, product_name, assigned_to_id, assigned_to_name, deadline, success_metric, notes } =
    req.body as Partial<Task>;
  const inventory_product_id = (req.body.inventory_product_id as number) ?? null;
  const inventory_snapshot = req.body.inventory_snapshot ?? null;

  if (!title || !deadline) return res.status(400).json({ error: "title وdeadline مطلوبان" });

  // تحقق من وجود تاسكات شغالة — للمعلومية بس مش للمنع
  let existingTasks: { id: number; title: string; assigned_to_name: string | null; status: string }[] = [];
  if (inventory_product_id) {
    existingTasks = await query<{ id: number; title: string; assigned_to_name: string | null; status: string }>(
      `SELECT id, title, assigned_to_name, status FROM tasks WHERE inventory_product_id = $1 AND status IN ('pending', 'in_progress')`,
      [inventory_product_id]
    );
  }

  const [row] = await query<Task>(`
    INSERT INTO tasks (title, product_name, assigned_to_id, assigned_to_name, deadline, success_metric, notes, created_by_id, created_by_name, inventory_product_id, inventory_snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
  `, [title, product_name ?? null, assigned_to_id ?? null, assigned_to_name ?? null,
      deadline, success_metric ?? null, notes ?? null, req.session!.userId, req.session!.username,
      inventory_product_id, inventory_snapshot ? JSON.stringify(inventory_snapshot) : null]);

  const [withMedia] = await attachMedia([row]);
  res.status(201).json(withMedia);
});

// ── POST /api/tasks/:id/media ─────────────────────────────────────────────────

router.post("/tasks/:id/media", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const { objectPath, originalName, mimeType } =
    req.body as { objectPath?: string; originalName?: string; mimeType?: string };
  if (!objectPath || !originalName || !mimeType)
    return res.status(400).json({ error: "objectPath, originalName, mimeType مطلوبة" });

  const [task] = await query<Task>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });

  const role   = req.session!.role;
  const userId = req.session!.userId;
  if (role !== "admin" && task.assigned_to_id !== userId)
    return res.status(403).json({ error: "غير مصرح" });

  const [countRow] = await query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM task_media WHERE task_id = $1`, [id]
  );
  const isPrimary = Number(countRow?.c ?? 0) === 0;

  const [media] = await query<TaskMedia>(`
    INSERT INTO task_media (task_id, original_name, file_path, mime_type, is_primary)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [id, originalName, objectPath, mimeType, isPrimary]);

  res.status(201).json(media);
});

// ── PATCH /api/tasks/media/:mediaId/primary ───────────────────────────────────

router.patch("/tasks/media/:mediaId/primary", async (req, res) => {
  const mediaId = parseInt(String(req.params.mediaId), 10);
  if (isNaN(mediaId)) return res.status(400).json({ error: "mediaId غير صحيح" });

  const [m] = await query<TaskMedia>(`SELECT * FROM task_media WHERE id = $1`, [mediaId]);
  if (!m) return res.status(404).json({ error: "الميديا غير موجودة" });

  const role   = req.session!.role;
  const userId = req.session!.userId;
  const [task] = await query<Task>(`SELECT assigned_to_id FROM tasks WHERE id = $1`, [m.task_id]);
  if (role !== "admin" && task?.assigned_to_id !== userId) return res.status(403).json({ error: "غير مصرح" });

  await query(`UPDATE task_media SET is_primary = FALSE WHERE task_id = $1`, [m.task_id]);
  await query(`UPDATE task_media SET is_primary = TRUE WHERE id = $1`, [mediaId]);
  res.json({ ok: true });
});

// ── DELETE /api/tasks/media/:mediaId ─────────────────────────────────────────

router.delete("/tasks/media/:mediaId", async (req, res) => {
  const mediaId = parseInt(String(req.params.mediaId), 10);
  if (isNaN(mediaId)) return res.status(400).json({ error: "mediaId غير صحيح" });

  const [m] = await query<TaskMedia>(`SELECT * FROM task_media WHERE id = $1`, [mediaId]);
  if (!m) return res.status(404).json({ error: "الميديا غير موجودة" });

  const role   = req.session!.role;
  const userId = req.session!.userId;
  const [task] = await query<Task>(`SELECT assigned_to_id FROM tasks WHERE id = $1`, [m.task_id]);
  if (role !== "admin" && task?.assigned_to_id !== userId) return res.status(403).json({ error: "غير مصرح" });

  try {
    const file = await objectStorage.getObjectEntityFile(m.file_path);
    await file.delete({ ignoreNotFound: true });
  } catch { /* already missing */ }

  await query(`DELETE FROM task_media WHERE id = $1`, [mediaId]);

  if (m.is_primary) {
    await query(`
      UPDATE task_media SET is_primary = TRUE
      WHERE task_id = $1 AND id = (SELECT id FROM task_media WHERE task_id = $1 ORDER BY created_at LIMIT 1)
    `, [m.task_id]);
  }
  res.json({ ok: true });
});

// ── PATCH /api/tasks/:id ──────────────────────────────────────────────────────

router.patch("/tasks/:id", async (req, res) => {
  const id     = parseInt(String(req.params.id), 10);
  const role   = req.session!.role;
  const userId = req.session!.userId;

  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const [task] = await query<Task>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });

  if (role !== "admin" && task.assigned_to_id !== userId)
    return res.status(403).json({ error: "غير مصرح" });

  const { action, notes } = req.body as { action?: string; notes?: string };

  if (action === "checkin") {
    const [updated] = await query<Task>(`
      UPDATE tasks SET checkin_count = checkin_count + 1, last_checkin_at = NOW(),
        status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END,
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);
    // Save check-in note if provided
    if (notes?.trim()) {
      await query(
        `INSERT INTO task_notes (task_id, user_id, username, note_text) VALUES ($1,$2,$3,$4)`,
        [id, userId, req.session!.username, notes.trim()]
      );
    }
    const [withMedia] = await attachMedia([updated]);
    return res.json(withMedia);
  }

  if (action === "complete") {
    const [updated] = await query<Task>(`
      UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);
    const [withMedia] = await attachMedia([updated]);

    // إشعار للأدمن عند إتمام التاسك
    sendPushToRoles(["admin"], {
      title: "✅ مهمة مكتملة",
      body: `${updated.assigned_to_name ?? "الميديا باير"} أكمل: ${updated.title}`,
      url: "/tasks",
    }).catch(() => null);

    return res.json({ ...withMedia, opus_score: calcScore(updated) });
  }

  if (action === "reopen" && role === "admin") {
    const [updated] = await query<Task>(`
      UPDATE tasks SET status = 'pending', completed_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);
    const [withMedia] = await attachMedia([updated]);
    return res.json(withMedia);
  }

  if (role === "admin") {
    const { title, product_name, assigned_to_id, assigned_to_name, deadline, success_metric, status } =
      req.body as Partial<Task>;

    // Bug fix: if deadline is extended to a future date, un-expire the task
    const newDeadline = deadline ?? null;
    const [updated] = await query<Task>(`
      UPDATE tasks SET
        title = COALESCE($2, title),
        product_name = COALESCE($3, product_name),
        assigned_to_id = COALESCE($4, assigned_to_id),
        assigned_to_name = COALESCE($5, assigned_to_name),
        deadline = COALESCE($6, deadline),
        success_metric = COALESCE($7, success_metric),
        status = CASE
          WHEN $6::timestamptz IS NOT NULL AND $6::timestamptz > NOW() AND status = 'expired'
          THEN 'pending'
          ELSE COALESCE($8, status)
        END,
        notes = COALESCE($9, notes),
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, title ?? null, product_name ?? null, assigned_to_id ?? null,
        assigned_to_name ?? null, newDeadline, success_metric ?? null,
        status ?? null, notes ?? null]);
    const [withMedia] = await attachMedia([updated]);
    return res.json(withMedia);
  }

  res.status(400).json({ error: "action غير معروف" });
});

// ── GET /api/tasks/:id/notes ──────────────────────────────────────────────────

router.get("/tasks/:id/notes", async (req, res) => {
  const id     = parseInt(String(req.params.id), 10);
  const role   = req.session!.role;
  const userId = req.session!.userId;
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const [task] = await query<Task>(`SELECT assigned_to_id FROM tasks WHERE id = $1`, [id]);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });
  if (role !== "admin" && task.assigned_to_id !== userId)
    return res.status(403).json({ error: "غير مصرح" });

  const rows = await query<TaskNote>(
    `SELECT * FROM task_notes WHERE task_id = $1 ORDER BY created_at ASC`, [id]
  );
  res.json(rows);
});

// ── POST /api/tasks/:id/notes ─────────────────────────────────────────────────

router.post("/tasks/:id/notes", async (req, res) => {
  const id     = parseInt(String(req.params.id), 10);
  const role   = req.session!.role;
  const userId = req.session!.userId;
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const { note_text } = req.body as { note_text?: string };
  if (!note_text?.trim()) return res.status(400).json({ error: "نص الملاحظة مطلوب" });

  const [task] = await query<Task>(`SELECT assigned_to_id FROM tasks WHERE id = $1`, [id]);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });
  if (role !== "admin" && task.assigned_to_id !== userId)
    return res.status(403).json({ error: "غير مصرح" });

  const [row] = await query<TaskNote>(
    `INSERT INTO task_notes (task_id, user_id, username, note_text) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, userId, req.session!.username, note_text.trim()]
  );
  res.status(201).json(row);
});

// ── POST /api/tasks/:id/view ──────────────────────────────────────────────────

router.post("/tasks/:id/view", async (req, res) => {
  const id     = parseInt(String(req.params.id), 10);
  const userId = req.session!.userId;
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  await query(
    `INSERT INTO task_views (task_id, user_id, username) VALUES ($1,$2,$3)`,
    [id, userId, req.session!.username]
  );
  res.json({ ok: true });
});

// ── GET /api/tasks/:id/views ──────────────────────────────────────────────────

router.get("/tasks/:id/views", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const rows = await query<TaskView>(
    `SELECT * FROM task_views WHERE task_id = $1 ORDER BY viewed_at DESC LIMIT 100`, [id]
  );
  res.json(rows);
});

// ── DELETE /api/tasks/:id ─────────────────────────────────────────────────────

router.delete("/tasks/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const mediaRows = await query<{ file_path: string }>(
    `SELECT file_path FROM task_media WHERE task_id = $1`, [id]
  );
  await Promise.allSettled(
    mediaRows.map(async m => {
      try {
        const file = await objectStorage.getObjectEntityFile(m.file_path);
        await file.delete({ ignoreNotFound: true });
      } catch { /* already missing */ }
    })
  );

  await query(`DELETE FROM tasks WHERE id = $1`, [id]);
  res.json({ ok: true });
});


// ── GET /api/tasks/:id/inventory-result ──────────────────────────────────────
// بيحسب حركة البيع للصنف بعد إتمام التاسك (3 أو 7 أيام)

router.get("/tasks/:id/inventory-result", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const [task] = await query<Task & { inventory_product_id?: number; inventory_snapshot?: any; completed_at?: string }>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });
  if (!task.inventory_product_id) return res.status(400).json({ error: "التاسك مش مرتبط بصنف في المخزون" });
  if (!task.completed_at) return res.status(400).json({ error: "التاسك لم يكتمل بعد" });

  const INVENTORY_BASE = "https://inventory-flow-seomasr.replit.app";
  const completedAt = new Date(task.completed_at).toISOString().slice(0, 10);

  try {
    // جيب حركات الصنف من تاريخ الإتمام
    const movRes = await fetch(`${INVENTORY_BASE}/api/movements?productId=${task.inventory_product_id}&limit=1000`);
    if (!movRes.ok) return res.status(502).json({ error: "فشل جلب حركات المخزون" });
    const movements: any[] = await movRes.json();

    // حركات البيع (out) بعد إتمام التاسك
    const after3days  = new Date(new Date(task.completed_at).getTime() + 3  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const after7days  = new Date(new Date(task.completed_at).getTime() + 7  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today       = new Date().toISOString().slice(0, 10);

    let sold3days = 0, sold7days = 0;
    for (const m of movements) {
      if (m.type !== "out") continue;
      if (m.date >= completedAt && m.date <= after3days) sold3days += m.quantity;
      if (m.date >= completedAt && m.date <= after7days) sold7days += m.quantity;
    }

    // الكمية الحالية
    const prodRes = await fetch(`${INVENTORY_BASE}/api/products/${task.inventory_product_id}`);
    const currentStock = prodRes.ok ? (await prodRes.json()).currentStock ?? null : null;
    const snapshotStock = task.inventory_snapshot?.stock ?? null;

    const result = {
      productId: task.inventory_product_id,
      snapshotStock,
      currentStock,
      sold3days,
      sold7days,
      completedAt: task.completed_at,
      daysElapsed: Math.floor((Date.now() - new Date(task.completed_at).getTime()) / (24 * 60 * 60 * 1000)),
      success: sold7days > 0,
    };

    // احفظ النتيجة في قاعدة البيانات
    await query(`UPDATE tasks SET inventory_result = $1 WHERE id = $2`, [JSON.stringify(result), id]);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "فشل حساب النتيجة" });
  }
});

export default router;
