import { Router } from "express";
import { query } from "../lib/db.js";
import { requireAdmin } from "../lib/auth-middleware.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { createInboxAndPush } from "../lib/notifications.js";
import { fetchAllInventory } from "./inventory.js";

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
  task_kind?: string;
  platform?: string | null;
  daily_followup_date?: string | null;
  admin_highlighted?: boolean;
  admin_highlight_note_id?: number | null;
  admin_highlighted_at?: string | null;
  admin_highlighted_by?: string | null;
}

interface TaskPlatformFollowup {
  id: number;
  task_id: number;
  platform: "meta" | "google" | "tiktok";
  status: "pending" | "completed";
  comment_text: string | null;
  completed_at: string | null;
  completed_by_id: number | null;
  completed_by_name: string | null;
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
  is_important?: boolean;
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
// On-time score rewards finishing early.
// Late completions are still rewarded, but with a much lower score:
// just-late starts around 40%, then decays gradually to a 10% floor.

export function calcScore(task: Task): number {
  if (task.status !== "completed" || !task.completed_at) return 0;
  const created  = new Date(task.created_at).getTime();
  const deadline = new Date(task.deadline).getTime();
  const done     = new Date(task.completed_at).getTime();
  const duration = Math.max(1, deadline - created);

  if (done > deadline) {
    const lateBy = done - deadline;
    const lateRatio = Math.min(1, lateBy / duration);
    return Math.max(10, Math.round(40 - lateRatio * 30));
  }

  const remaining = deadline - done;
  return Math.max(0, Math.min(100, Math.round((remaining / duration) * 100)));
}

// ── Daily product/platform follow-up generation ──────────────────────────────

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
};

export async function generateDailyProductFollowupTasks(): Promise<{ created: number; skipped: boolean }> {
  const [clock] = await query<{ today: string; hour: number }>(`
    SELECT
      (NOW() AT TIME ZONE 'Africa/Cairo')::date::text AS today,
      EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Africa/Cairo'))::int AS hour
  `);

  if (!clock || clock.hour < 6 || clock.hour >= 21) {
    return { created: 0, skipped: true };
  }

  const assignments = await query<{
    inventory_product_id: number;
    product_name: string;
    source_store: string;
    platform: "meta" | "google" | "tiktok";
    assigned_to_id: number;
    assigned_to_name: string;
  }>(`
    SELECT
      a.inventory_product_id,
      a.product_name,
      a.source_store,
      a.platform,
      a.assigned_to_id,
      a.assigned_to_name
    FROM inventory_media_assignments a
    INNER JOIN users u ON u.id = a.assigned_to_id
    WHERE a.is_active = TRUE
      AND u.deleted_at IS NULL
      AND u.role = 'media_buyer'
    ORDER BY a.assigned_to_id, a.inventory_product_id, a.platform
  `);

  const { products } = await fetchAllInventory();
  const stockByProductId = new Map(
    products.map((product) => [product.id, product.availableStock])
  );

  type AssignmentGroup = {
    inventory_product_id: number;
    product_name: string;
    source_store: string;
    assigned_to_id: number;
    assigned_to_name: string;
    platforms: Array<"meta" | "google" | "tiktok">;
  };

  const grouped = new Map<string, AssignmentGroup>();
  let skippedOutOfStock = 0;

  for (const a of assignments) {
    const availableStock = stockByProductId.get(a.inventory_product_id) ?? 0;
    if (availableStock <= 0) {
      skippedOutOfStock++;
      continue;
    }

    const key = `${a.inventory_product_id}:${a.assigned_to_id}`;
    const group = grouped.get(key) ?? {
      inventory_product_id: a.inventory_product_id,
      product_name: a.product_name,
      source_store: a.source_store,
      assigned_to_id: a.assigned_to_id,
      assigned_to_name: a.assigned_to_name,
      platforms: [],
    };
    if (!group.platforms.includes(a.platform)) group.platforms.push(a.platform);
    grouped.set(key, group);
  }

  let created = 0;

  for (const group of grouped.values()) {
    const availableStock = stockByProductId.get(group.inventory_product_id) ?? 0;
    const platformLabels = group.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(" + ");
    const title = `متابعة يومية — ${group.product_name}`;

    const rows = await query<{ id: number }>(`
      INSERT INTO tasks (
        title,
        product_name,
        assigned_to_id,
        assigned_to_name,
        deadline,
        success_metric,
        notes,
        created_by_id,
        created_by_name,
        inventory_product_id,
        inventory_snapshot,
        task_kind,
        platform,
        daily_followup_date
      )
      VALUES (
        $1,$2,$3,$4,
        (($5::date + TIME '21:00') AT TIME ZONE 'Africa/Cairo'),
        $6,$7,NULL,'النظام',$8,$9,
        'daily_product_followup',NULL,$5::date
      )
      ON CONFLICT (inventory_product_id, assigned_to_id, daily_followup_date)
      WHERE task_kind = 'daily_product_followup'
        AND daily_followup_date IS NOT NULL
        AND platform IS NULL
      DO UPDATE SET
        title = EXCLUDED.title,
        product_name = EXCLUDED.product_name,
        assigned_to_name = EXCLUDED.assigned_to_name,
        inventory_snapshot = EXCLUDED.inventory_snapshot,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING id
    `, [
      title,
      group.product_name,
      group.assigned_to_id,
      group.assigned_to_name,
      clock.today,
      "اكتب تعليق منفصل لكل منصة مسؤولة عنها",
      `متابعة يومية للمنصات: ${platformLabels}. يكتمل التاسك بعد كتابة تعليق لكل منصة قبل الساعة 9:00 مساءً.`,
      group.inventory_product_id,
      JSON.stringify({
        sourceStore: group.source_store,
        storeName: group.source_store,
        availableStock,
      }),
    ]);

    const taskId = rows[0]?.id;
    if (!taskId) continue;

    for (const platform of group.platforms) {
      await query(`
        INSERT INTO task_platform_followups (task_id, platform)
        VALUES ($1,$2)
        ON CONFLICT (task_id, platform) DO NOTHING
      `, [taskId, platform]);
    }

    created++;
  }

  if (skippedOutOfStock > 0) {
    console.info(
      `Daily product follow-ups skipped ${skippedOutOfStock} out-of-stock assignment(s)`
    );
  }

  return { created, skipped: false };
}

// ── Auto-expire ───────────────────────────────────────────────────────────────

async function autoExpire() {
  await query(`
    UPDATE tasks SET status = 'expired', updated_at = NOW()
    WHERE status IN ('pending','in_progress') AND deadline < NOW()
  `);
}

// ── Attach media to tasks ─────────────────────────────────────────────────────

async function attachMedia(tasks: (Task & { media?: TaskMedia[]; opus_score?: number; platform_followups?: TaskPlatformFollowup[] })[]) {
  if (!tasks.length) return tasks;
  const ids = tasks.map(t => t.id);

  const [mediaRows, platformRows] = await Promise.all([
    query<TaskMedia>(
      `SELECT * FROM task_media WHERE task_id = ANY($1::int[]) ORDER BY is_primary DESC, created_at ASC`,
      [ids]
    ),
    query<TaskPlatformFollowup>(
      `SELECT * FROM task_platform_followups WHERE task_id = ANY($1::int[]) ORDER BY id ASC`,
      [ids]
    ),
  ]);

  const mediaMap = new Map<number, TaskMedia[]>();
  for (const m of mediaRows) {
    if (!mediaMap.has(m.task_id)) mediaMap.set(m.task_id, []);
    mediaMap.get(m.task_id)!.push(m);
  }

  const platformMap = new Map<number, TaskPlatformFollowup[]>();
  for (const p of platformRows) {
    if (!platformMap.has(p.task_id)) platformMap.set(p.task_id, []);
    platformMap.get(p.task_id)!.push(p);
  }

  return tasks.map(t => ({
    ...t,
    media: mediaMap.get(t.id) ?? [],
    platform_followups: platformMap.get(t.id) ?? [],
  }));
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
  const productId = Number(String(req.params.productId));

  // META_INVENTORY_TASKS_STABILITY_V1
  // inventory_product_id is PostgreSQL INTEGER, so never send an unsigned
  // 32-bit hash to the database.
  if (
    !Number.isSafeInteger(productId)
    || productId === 0
    || productId < -2147483647
    || productId > 2147483647
  ) {
    return res.status(400).json({
      error: "productId خارج النطاق المسموح",
      tasks: [],
    });
  }

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
    deduction_points: number;
  };

  const map = new Map<number, BuyerStat>();
  for (const t of rows) {
    if (!t.assigned_to_id) continue;
    if (!map.has(t.assigned_to_id)) {
      map.set(t.assigned_to_id, {
        userId: t.assigned_to_id, name: t.assigned_to_name ?? `User ${t.assigned_to_id}`,
        total_tasks: 0, completed_on_time: 0, completed_late: 0,
        in_progress: 0, expired: 0, total_checkins: 0, score: 0, avg_score: 0, deduction_points: 0,
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

  const deductionRows = await query<{ media_buyer_id: number; total: string }>(`
    SELECT media_buyer_id, COALESCE(SUM(points), 0)::text AS total
    FROM media_buyer_score_deductions
    WHERE reversed_at IS NULL
    GROUP BY media_buyer_id
  `);
  const deductionMap = new Map(
    deductionRows.map((row) => [row.media_buyer_id, Number(row.total || 0)])
  );

  const rawStats = Array.from(map.values()).map(s => ({
    ...s,
    deduction_points: deductionMap.get(s.userId) ?? 0,
    avg_score: s.completed_on_time + s.completed_late > 0
      ? Math.round(s.score / (s.completed_on_time + s.completed_late)) : 0,
  }));

  // أكبر عدد تاسكات مكتملة بين كل الميديا باير
  const maxCompleted = Math.max(1, ...rawStats.map(s => s.completed_on_time + s.completed_late));

  const stats = rawStats.map(s => {
    const speedScore    = s.avg_score; // 0-100
    const totalCompleted = s.completed_on_time + s.completed_late;
    const volumeScore   = Math.round((totalCompleted / maxCompleted) * 100); // 0-100
    const scoreBeforeDeductions = Math.round(speedScore * 0.7 + volumeScore * 0.3);
    const finalScore = Math.max(0, scoreBeforeDeductions - s.deduction_points);
    return {
      ...s,
      avg_score: finalScore,
      score_before_deductions: scoreBeforeDeductions,
      speed_score: speedScore,
      volume_score: volumeScore,
    };
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


router.get("/tasks/score-deductions", async (req, res) => {
  const role = req.session!.role;
  const userId = req.session!.userId;
  const requestedBuyerId = Number(req.query.buyerId || 0);

  if (role === "admin") {
    const rows = requestedBuyerId
      ? await query(`
          SELECT * FROM media_buyer_score_deductions
          WHERE media_buyer_id = $1
          ORDER BY created_at DESC
          LIMIT 100
        `, [requestedBuyerId])
      : await query(`
          SELECT * FROM media_buyer_score_deductions
          ORDER BY created_at DESC
          LIMIT 200
        `);
    return res.json(rows);
  }

  const rows = await query(`
    SELECT * FROM media_buyer_score_deductions
    WHERE media_buyer_id = $1
    ORDER BY created_at DESC
    LIMIT 100
  `, [userId]);
  res.json(rows);
});

router.post("/tasks/score-deductions", requireAdmin, async (req, res) => {
  const buyerId = Number(req.body?.media_buyer_id);
  const points = Number(req.body?.points);
  const reason = String(req.body?.reason || "").trim();
  const taskId = req.body?.task_id == null ? null : Number(req.body.task_id);

  if (!Number.isSafeInteger(buyerId)) {
    return res.status(400).json({ error: "الميديا باير غير صحيح" });
  }
  if (!Number.isInteger(points) || points < 1 || points > 20) {
    return res.status(400).json({ error: "الخصم لازم يكون من 1 إلى 20 نقطة" });
  }
  if (!reason) {
    return res.status(400).json({ error: "سبب الخصم مطلوب" });
  }
  if (taskId !== null && !Number.isSafeInteger(taskId)) {
    return res.status(400).json({ error: "رقم التاسك غير صحيح" });
  }

  const [buyer] = await query<{ id: number; username: string }>(`
    SELECT id, username
    FROM users
    WHERE id = $1 AND role = 'media_buyer' AND deleted_at IS NULL
  `, [buyerId]);
  if (!buyer) {
    return res.status(404).json({ error: "الميديا باير غير موجود أو غير نشط" });
  }

  if (taskId !== null) {
    const [task] = await query<{ id: number; assigned_to_id: number | null }>(`
      SELECT id, assigned_to_id FROM tasks WHERE id = $1
    `, [taskId]);
    if (!task) return res.status(404).json({ error: "التاسك غير موجود" });
    if (task.assigned_to_id !== buyerId) {
      return res.status(400).json({ error: "التاسك مش تابع للميديا باير المختار" });
    }
  }

  const [row] = await query(`
    INSERT INTO media_buyer_score_deductions (
      media_buyer_id,
      media_buyer_name,
      points,
      reason,
      task_id,
      created_by_id,
      created_by_name
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [
    buyer.id,
    buyer.username,
    points,
    reason,
    taskId,
    req.session!.userId,
    req.session!.username,
  ]);

  await createInboxAndPush({
    eventType: "media_buyer_score_deduction",
    recipientUserIds: [buyer.id],
    title: `خصم ${points} نقطة من الاسكور`,
    body: reason,
    url: taskId ? `/tasks?taskId=${taskId}` : "/tasks",
    metadata: { deductionId: row.id, points, taskId },
  });

  res.status(201).json(row);
});

router.delete("/tasks/score-deductions/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "رقم الخصم غير صحيح" });
  }

  const [row] = await query(`
    UPDATE media_buyer_score_deductions
    SET reversed_at = NOW(),
        reversed_by_id = $2,
        reversed_by_name = $3
    WHERE id = $1 AND reversed_at IS NULL
    RETURNING *
  `, [id, req.session!.userId, req.session!.username]);

  if (!row) return res.status(404).json({ error: "الخصم غير موجود أو ملغي بالفعل" });
  res.json(row);
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
  if (row.assigned_to_id) {
    await createInboxAndPush({
      eventType: "task_assigned",
      recipientUserIds: [row.assigned_to_id],
      title: "مهمة جديدة",
      body: row.title,
      url: "/tasks",
      metadata: { taskId: row.id },
    });
  }
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

  const { action, notes, platform } = req.body as { action?: string; notes?: string; platform?: string };

  if (action === "checkin") {
    const isDailyFollowup = task.task_kind === "daily_product_followup";

    if (isDailyFollowup) {
      const platformRows = await query<TaskPlatformFollowup>(
        `SELECT * FROM task_platform_followups WHERE task_id = $1 ORDER BY id ASC`,
        [id]
      );

      // New grouped daily task: each platform has its own required comment.
      if (platformRows.length > 0) {
        const normalizedPlatform = String(platform || "").toLowerCase();
        if (!["meta", "google", "tiktok"].includes(normalizedPlatform)) {
          return res.status(400).json({ error: "اختار المنصة التي تكتب لها المتابعة" });
        }
        if (!notes?.trim()) {
          return res.status(400).json({ error: "تعليق المنصة مطلوب" });
        }

        const target = platformRows.find((row) => row.platform === normalizedPlatform);
        if (!target) {
          return res.status(400).json({ error: "المنصة دي مش ضمن مسؤولياتك في التاسك" });
        }
        if (target.status === "completed") {
          return res.status(400).json({ error: "متابعة المنصة دي مكتملة بالفعل" });
        }

        await query(`
          UPDATE task_platform_followups
          SET status = 'completed',
              comment_text = $3,
              completed_at = NOW(),
              completed_by_id = $4,
              completed_by_name = $5,
              updated_at = NOW()
          WHERE task_id = $1 AND platform = $2
        `, [id, normalizedPlatform, notes.trim(), userId, req.session!.username]);

        await query(
          `INSERT INTO task_notes (task_id, user_id, username, note_text)
           VALUES ($1,$2,$3,$4)`,
          [
            id,
            userId,
            req.session!.username,
            `[${PLATFORM_LABEL[normalizedPlatform] ?? normalizedPlatform}] ${notes.trim()}`,
          ]
        );

        const [progress] = await query<{ total: string; completed: string }>(`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'completed')::text AS completed
          FROM task_platform_followups
          WHERE task_id = $1
        `, [id]);

        const allDone =
          Number(progress?.total ?? 0) > 0 &&
          Number(progress?.total ?? 0) === Number(progress?.completed ?? 0);

        const [updated] = await query<Task>(`
          UPDATE tasks
          SET checkin_count = checkin_count + 1,
              last_checkin_at = NOW(),
              status = CASE WHEN $2 THEN 'completed' ELSE 'in_progress' END,
              completed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `, [id, allDone]);

        if (allDone) {
          const completedLate =
            new Date(updated.completed_at ?? "").getTime() > new Date(updated.deadline).getTime();
          if (completedLate) {
            await query(
              `INSERT INTO task_notes (task_id, user_id, username, note_text) VALUES ($1,$2,$3,$4)`,
              [id, userId, "تنبيه النظام", "تم إكمال المتابعة بعد الموعد المحدد. تم احتساب Score أقل — حاول إنهاء المتابعة في موعدها القادم."]
            );
          }

          await createInboxAndPush({
            eventType: "task_completed",
            recipientRoles: ["admin", "media_manager"],
            title: "اكتملت متابعة المنتج",
            body: `${updated.assigned_to_name ?? "الميديا باير"} أكمل كل منصات: ${updated.product_name ?? updated.title}`,
            url: `/tasks?taskId=${updated.id}`,
            metadata: { taskId: updated.id, assignedToId: updated.assigned_to_id },
          });
        }

        const [withMedia] = await attachMedia([updated]);
        return res.json({ ...withMedia, opus_score: calcScore(updated) });
      }

      // Legacy daily task: one platform per task.
      if (!notes?.trim()) {
        return res.status(400).json({ error: "تعليق المتابعة مطلوب للمهمة اليومية" });
      }
    }

    const [updated] = await query<Task>(`
      UPDATE tasks SET
        checkin_count = checkin_count + 1,
        last_checkin_at = NOW(),
        status = CASE
          WHEN task_kind = 'daily_product_followup' THEN 'completed'
          WHEN status = 'pending' THEN 'in_progress'
          ELSE status
        END,
        completed_at = CASE
          WHEN task_kind = 'daily_product_followup' THEN NOW()
          ELSE completed_at
        END,
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);

    if (notes?.trim()) {
      await query(
        `INSERT INTO task_notes (task_id, user_id, username, note_text) VALUES ($1,$2,$3,$4)`,
        [id, userId, req.session!.username, notes.trim()]
      );
    }

    const completedLate = new Date(updated.completed_at ?? "").getTime() > new Date(updated.deadline).getTime();
    if (isDailyFollowup && completedLate) {
      await query(
        `INSERT INTO task_notes (task_id, user_id, username, note_text) VALUES ($1,$2,$3,$4)`,
        [id, userId, "تنبيه النظام", "تم إكمال المتابعة بعد الموعد المحدد. تم احتساب Score أقل — حاول إنهاء المتابعة في موعدها القادم."]
      );
    }

    if (isDailyFollowup) {
      await createInboxAndPush({
        eventType: "task_completed",
        recipientRoles: ["admin", "media_manager"],
        title: "تمت متابعة منتج",
        body: `${updated.assigned_to_name ?? "الميديا باير"} تابع: ${updated.title}`,
        url: "/tasks",
        metadata: { taskId: updated.id, assignedToId: updated.assigned_to_id },
      });
    }

    const [withMedia] = await attachMedia([updated]);
    return res.json({ ...withMedia, opus_score: calcScore(updated) });
  }

  if (action === "complete") {
    if (task.task_kind === "daily_product_followup") {
      const [platformProgress] = await query<{ total: string; completed: string }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::text AS completed
        FROM task_platform_followups
        WHERE task_id = $1
      `, [id]);

      if (Number(platformProgress?.total ?? 0) > 0) {
        if (Number(platformProgress.total) !== Number(platformProgress.completed)) {
          return res.status(400).json({ error: "لا يمكن إتمام التاسك قبل كتابة تعليق لكل منصة" });
        }
      } else {
        const [noteCount] = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM task_notes WHERE task_id = $1`,
          [id]
        );
        if (Number(noteCount?.count ?? 0) === 0) {
          return res.status(400).json({ error: "لا يمكن إتمام المتابعة اليومية بدون تعليق" });
        }
      }
    }

    const [updated] = await query<Task>(`
      UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);

    const completedLate = new Date(updated.completed_at ?? "").getTime() > new Date(updated.deadline).getTime();
    if (completedLate) {
      await query(
        `INSERT INTO task_notes (task_id, user_id, username, note_text) VALUES ($1,$2,$3,$4)`,
        [id, userId, "تنبيه النظام", "تم إكمال المهمة بعد الموعد المحدد. تم احتساب Score أقل — حاول إنهاء المهمة في موعدها القادم."]
      );
    }

    const [withMedia] = await attachMedia([updated]);

    await createInboxAndPush({
      eventType: "task_completed",
      recipientRoles: ["admin", "media_manager"],
      title: "مهمة مكتملة",
      body: `${updated.assigned_to_name ?? "الميديا باير"} أكمل: ${updated.title}`,
      url: "/tasks",
      metadata: { taskId: updated.id, assignedToId: updated.assigned_to_id },
    });

    return res.json({ ...withMedia, opus_score: calcScore(updated) });
  }

  if (action === "clear_highlight" && role === "admin") {
    const [updated] = await query<Task>(`
      UPDATE tasks
      SET admin_highlighted = FALSE,
          admin_highlight_note_id = NULL,
          admin_highlighted_at = NULL,
          admin_highlighted_by = NULL,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);
    const [withMedia] = await attachMedia([updated]);
    return res.json(withMedia);
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
    if (
      assigned_to_id !== undefined &&
      assigned_to_id !== null &&
      assigned_to_id !== task.assigned_to_id
    ) {
      await createInboxAndPush({
        eventType: "task_assigned",
        recipientUserIds: [assigned_to_id],
        title: "مهمة مسندة لك",
        body: updated.title,
        url: "/tasks",
        metadata: { taskId: updated.id },
      });
    }
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

  const [task] = await query<Task>(`SELECT * FROM tasks WHERE id = $1`, [id]);
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

  const { note_text, important } = req.body as { note_text?: string; important?: boolean };
  if (!note_text?.trim()) return res.status(400).json({ error: "نص الملاحظة مطلوب" });

  const [task] = await query<Task>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });
  if (role !== "admin" && task.assigned_to_id !== userId)
    return res.status(403).json({ error: "غير مصرح" });

  const markImportant = role === "admin" && important === true;
  const [row] = await query<TaskNote>(
    `INSERT INTO task_notes (task_id, user_id, username, note_text, is_important)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, userId, req.session!.username, note_text.trim(), markImportant]
  );

  if (markImportant) {
    await query(`
      UPDATE tasks
      SET admin_highlighted = TRUE,
          admin_highlight_note_id = $2,
          admin_highlighted_at = NOW(),
          admin_highlighted_by = $3,
          updated_at = NOW()
      WHERE id = $1
    `, [id, row.id, req.session!.username]);

    if (task.assigned_to_id) {
      await createInboxAndPush({
        eventType: "task_admin_important_note",
        recipientUserIds: [task.assigned_to_id],
        title: "تعليق مهم من الإدارة",
        body: `${task.title} — ${note_text.trim().slice(0, 140)}`,
        url: `/tasks?taskId=${id}`,
        metadata: { taskId: id, noteId: row.id, important: true },
      });
    }
  }

  // Admin comments are guidance, not the media buyer's daily check-in.
  // Grouped daily tasks only complete through their per-platform comments.
  if (role !== "admin" && task.task_kind === "daily_product_followup" && task.status !== "completed") {
    const [platformCount] = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM task_platform_followups WHERE task_id = $1`,
      [id]
    );
    if (Number(platformCount?.count ?? 0) === 0) {
      await query(`
        UPDATE tasks
        SET status = 'completed',
            completed_at = NOW(),
            checkin_count = GREATEST(checkin_count, 1),
            last_checkin_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `, [id]);
    }
  }

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
    type InventoryMovementResponse = {
      type?: string;
      date?: string;
      quantity?: number;
    };
    const movementPayload: unknown = await movRes.json();
    const movements: InventoryMovementResponse[] = Array.isArray(movementPayload)
      ? movementPayload
      : [];

    // حركات البيع (out) بعد إتمام التاسك
    const after3days  = new Date(new Date(task.completed_at).getTime() + 3  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const after7days  = new Date(new Date(task.completed_at).getTime() + 7  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today       = new Date().toISOString().slice(0, 10);

    let sold3days = 0, sold7days = 0;
    for (const m of movements) {
      if (m.type !== "out" || !m.date) continue;
      const quantity = Number(m.quantity || 0);
      if (m.date >= completedAt && m.date <= after3days) sold3days += quantity;
      if (m.date >= completedAt && m.date <= after7days) sold7days += quantity;
    }

    // الكمية الحالية
    const prodRes = await fetch(`${INVENTORY_BASE}/api/products/${task.inventory_product_id}`);
    type InventoryProductResponse = {
      availableStock?: number;
      currentStock?: number;
      reservedQty?: number;
    };
    const prodData: InventoryProductResponse | null = prodRes.ok
      ? (await prodRes.json()) as InventoryProductResponse
      : null;
    // الكمية الحالية بعد خصم الحجوزات — نفس الرقم الظاهر للميديا باير في صفحة المخزون
    const currentStock = prodData?.availableStock ?? prodData?.currentStock ?? null;
    const reservedQty = prodData?.reservedQty ?? 0;
    const snapshotStock = task.inventory_snapshot?.stock ?? null;

    const result = {
      productId: task.inventory_product_id,
      snapshotStock,
      currentStock,
      reservedQty,
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
