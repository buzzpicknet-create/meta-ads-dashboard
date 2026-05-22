import { Router } from "express";
import { query } from "../lib/db.js";
import { requireAdmin } from "../lib/auth-middleware.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

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

// ── GET /api/tasks/stats ──────────────────────────────────────────────────────

router.get("/tasks/stats", async (_req, res) => {
  const rows = await query<Task>(`SELECT * FROM tasks WHERE assigned_to_id IS NOT NULL`);

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

  const stats = Array.from(map.values()).map(s => ({
    ...s,
    avg_score: s.completed_on_time + s.completed_late > 0
      ? Math.round(s.score / (s.completed_on_time + s.completed_late)) : 0,
  }));
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
  if (!title || !deadline) return res.status(400).json({ error: "title وdeadline مطلوبان" });

  const [row] = await query<Task>(`
    INSERT INTO tasks (title, product_name, assigned_to_id, assigned_to_name, deadline, success_metric, notes, created_by_id, created_by_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, [title, product_name ?? null, assigned_to_id ?? null, assigned_to_name ?? null,
      deadline, success_metric ?? null, notes ?? null, req.session!.userId, req.session!.username]);

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

export default router;
