import { Router } from "express";
import { query } from "../lib/db";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();

const PAGE_LABELS: Record<string, string> = {
  "/":          "تحليل الحملة",
  "/overview":  "نظرة عامة",
  "/creative":  "مركز الكريتف",
  "/activity":  "نشاط الفريق",
  "/media":     "طلبات الميديا",
  "/admin":     "إدارة المستخدمين",
};

const ACTION_LABELS: Record<string, string> = {
  page_visit:              "زار صفحة",
  diagnosis_run:           "فتح التشخيص",
  media_request_created:   "أنشأ طلب ميديا",
  login:                   "سجّل الدخول",
  heartbeat:               "متصل",
};

// POST /api/activity/log — called by frontend on page change or action
router.post("/activity/log", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "غير مصرح" });

  const { action, page, meta } = req.body as {
    action?: string;
    page?: string;
    meta?: Record<string, unknown>;
  };

  if (!action) return res.status(400).json({ error: "action مطلوب" });

  try {
    const pageLabel = page ? (PAGE_LABELS[page] ?? page) : null;

    if (action !== "heartbeat") {
      await query(
        `INSERT INTO user_activity_logs (user_id, action, page, meta)
         VALUES ($1, $2, $3, $4)`,
        [userId, action, pageLabel, JSON.stringify(meta ?? {})]
      );
    }
    await query(
      `UPDATE users SET last_seen_at = NOW() WHERE id = $1`,
      [userId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "فشل تسجيل النشاط" });
  }
});

// GET /api/admin/user-activity — admin only, returns users + recent activity
router.get("/admin/user-activity", requireAdmin, async (_req, res) => {
  try {
    const users = await query<{
      id: number;
      username: string;
      role: string;
      last_seen_at: string | null;
      ad_account_id: string | null;
    }>(
      `SELECT id, username, role, last_seen_at, ad_account_id
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY last_seen_at DESC NULLS LAST, created_at DESC`
    );

    const [logs, pushSubs] = await Promise.all([
      query<{
        user_id: number;
        action: string;
        page: string | null;
        meta: Record<string, unknown>;
        created_at: string;
      }>(
        `SELECT user_id, action, page, meta, created_at
         FROM user_activity_logs
         WHERE action != 'heartbeat'
           AND user_id = ANY($1::int[])
         ORDER BY created_at DESC
         LIMIT 200`,
        [users.map((u) => u.id)]
      ),
      query<{ user_id: number; cnt: string }>(
        `SELECT user_id, COUNT(*) AS cnt
         FROM push_subscriptions
         WHERE user_id = ANY($1::int[])
         GROUP BY user_id`,
        [users.map((u) => u.id)]
      ),
    ]);

    const pushByUser: Record<number, number> = {};
    for (const p of pushSubs) pushByUser[p.user_id] = Number(p.cnt);

    const logsByUser: Record<number, typeof logs> = {};
    for (const log of logs) {
      if (!logsByUser[log.user_id]) logsByUser[log.user_id] = [];
      if ((logsByUser[log.user_id]?.length ?? 0) < 20) {
        logsByUser[log.user_id]!.push(log);
      }
    }

    const result = users.map((u) => ({
      ...u,
      push_sub_count: pushByUser[u.id] ?? 0,
      recent_activity: (logsByUser[u.id] ?? []).map((l) => ({
        action: l.action,
        action_label: ACTION_LABELS[l.action] ?? l.action,
        page: l.page,
        meta: l.meta,
        created_at: l.created_at,
      })),
    }));

    res.json({ users: result });
  } catch {
    res.status(500).json({ error: "فشل جلب النشاط" });
  }
});

export default router;
