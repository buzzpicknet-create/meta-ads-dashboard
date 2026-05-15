import { Router } from "express";
import { query } from "../lib/db.js";
import { requireAdmin } from "../lib/auth-middleware.js";

const router = Router();

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

// ── Scoring algorithm ─────────────────────────────────────────────────────────
// Base:     50% for completing the task
// Bonus:    up to +30% for finishing early (proportional to deadline)
// Penalty:  -20% for finishing late
// Activity: +5% per check-in (max +20%)

export function calcScore(task: Task): number {
  if (task.status !== "completed" || !task.completed_at) return 0;
  const created  = new Date(task.created_at).getTime();
  const deadline = new Date(task.deadline).getTime();
  const done     = new Date(task.completed_at).getTime();
  const duration = Math.max(1, deadline - created);

  let score = 50;

  if (done <= deadline) {
    const saved      = deadline - done;
    const earlyBonus = Math.min(30, (saved / duration) * 30);
    score += earlyBonus;
  } else {
    score -= 20;
  }

  const activityBonus = Math.min(20, task.checkin_count * 5);
  score += activityBonus;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Auto-expire helper ─────────────────────────────────────────────────────────

async function autoExpire() {
  await query(`
    UPDATE tasks
    SET status = 'expired', updated_at = NOW()
    WHERE status IN ('pending', 'in_progress')
      AND deadline < NOW()
  `);
}

// ── GET /api/tasks ────────────────────────────────────────────────────────────

router.get("/tasks", async (req, res) => {
  await autoExpire();
  const userId = req.session!.userId;
  const role   = req.session!.role;

  let rows: Task[];
  if (role === "admin") {
    rows = await query<Task>(`
      SELECT * FROM tasks ORDER BY
        CASE status
          WHEN 'in_progress' THEN 1
          WHEN 'pending'     THEN 2
          WHEN 'expired'     THEN 3
          WHEN 'completed'   THEN 4
        END,
        deadline ASC
    `);
  } else {
    rows = await query<Task>(`
      SELECT * FROM tasks
      WHERE assigned_to_id = $1
      ORDER BY
        CASE status
          WHEN 'in_progress' THEN 1
          WHEN 'pending'     THEN 2
          WHEN 'expired'     THEN 3
          WHEN 'completed'   THEN 4
        END,
        deadline ASC
    `, [userId]);
  }

  res.json(rows);
});

// ── GET /api/tasks/stats ──────────────────────────────────────────────────────

router.get("/tasks/stats", async (_req, res) => {
  const rows = await query<Task>(`
    SELECT * FROM tasks WHERE assigned_to_id IS NOT NULL
  `);

  type BuyerStat = {
    userId: number;
    name: string;
    total_tasks: number;
    completed_on_time: number;
    completed_late: number;
    in_progress: number;
    expired: number;
    total_checkins: number;
    score: number;
    avg_score: number;
  };

  const map = new Map<number, BuyerStat>();

  for (const t of rows) {
    if (!t.assigned_to_id) continue;
    if (!map.has(t.assigned_to_id)) {
      map.set(t.assigned_to_id, {
        userId: t.assigned_to_id,
        name: t.assigned_to_name ?? `User ${t.assigned_to_id}`,
        total_tasks: 0,
        completed_on_time: 0,
        completed_late: 0,
        in_progress: 0,
        expired: 0,
        total_checkins: 0,
        score: 0,
        avg_score: 0,
      });
    }
    const s = map.get(t.assigned_to_id)!;
    s.total_tasks++;
    s.total_checkins += t.checkin_count;

    if (t.status === "completed") {
      const done = new Date(t.completed_at!).getTime();
      const dl   = new Date(t.deadline).getTime();
      if (done <= dl) s.completed_on_time++;
      else            s.completed_late++;
      s.score += calcScore(t);
    } else if (t.status === "in_progress") {
      s.in_progress++;
    } else if (t.status === "expired") {
      s.expired++;
    }
  }

  const stats = Array.from(map.values()).map(s => ({
    ...s,
    avg_score: s.completed_on_time + s.completed_late > 0
      ? Math.round(s.score / (s.completed_on_time + s.completed_late))
      : 0,
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
  const {
    title, product_name, assigned_to_id, assigned_to_name,
    deadline, success_metric, notes,
  } = req.body as Partial<Task>;

  if (!title || !deadline) {
    return res.status(400).json({ error: "title وdeadline مطلوبان" });
  }

  const [row] = await query<Task>(`
    INSERT INTO tasks (title, product_name, assigned_to_id, assigned_to_name, deadline, success_metric, notes, created_by_id, created_by_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
  `, [
    title, product_name ?? null, assigned_to_id ?? null, assigned_to_name ?? null,
    deadline, success_metric ?? null, notes ?? null,
    req.session!.userId, req.session!.username,
  ]);

  res.status(201).json(row);
});

// ── PATCH /api/tasks/:id ──────────────────────────────────────────────────────

router.patch("/tasks/:id", async (req, res) => {
  const id   = parseInt(String(req.params.id), 10);
  const role = req.session!.role;
  const userId = req.session!.userId;

  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });

  const [task] = await query<Task>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });

  if (role !== "admin" && task.assigned_to_id !== userId) {
    return res.status(403).json({ error: "غير مصرح" });
  }

  const { action, notes } = req.body as { action?: string; notes?: string };

  if (action === "checkin") {
    const [updated] = await query<Task>(`
      UPDATE tasks
      SET checkin_count = checkin_count + 1,
          last_checkin_at = NOW(),
          status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END,
          notes = COALESCE($2, notes),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, notes ?? null]);
    return res.json(updated);
  }

  if (action === "complete") {
    const [updated] = await query<Task>(`
      UPDATE tasks
      SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);
    return res.json({ ...updated, opus_score: calcScore(updated) });
  }

  if (action === "reopen" && role === "admin") {
    const [updated] = await query<Task>(`
      UPDATE tasks
      SET status = 'pending', completed_at = NULL, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);
    return res.json(updated);
  }

  if (role === "admin") {
    const { title, product_name, assigned_to_id, assigned_to_name, deadline, success_metric, status } =
      req.body as Partial<Task>;
    const [updated] = await query<Task>(`
      UPDATE tasks
      SET title            = COALESCE($2, title),
          product_name     = COALESCE($3, product_name),
          assigned_to_id   = COALESCE($4, assigned_to_id),
          assigned_to_name = COALESCE($5, assigned_to_name),
          deadline         = COALESCE($6, deadline),
          success_metric   = COALESCE($7, success_metric),
          status           = COALESCE($8, status),
          notes            = COALESCE($9, notes),
          updated_at       = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, title ?? null, product_name ?? null, assigned_to_id ?? null,
        assigned_to_name ?? null, deadline ?? null, success_metric ?? null,
        status ?? null, notes ?? null]);
    return res.json(updated);
  }

  res.status(400).json({ error: "action غير معروف" });
});

// ── DELETE /api/tasks/:id ─────────────────────────────────────────────────────

router.delete("/tasks/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "id غير صحيح" });
  await query(`DELETE FROM tasks WHERE id = $1`, [id]);
  res.json({ ok: true });
});

export default router;
