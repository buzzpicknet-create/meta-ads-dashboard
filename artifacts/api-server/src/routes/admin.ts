import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../lib/db";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();

interface UserRow {
  id: number;
  username: string;
  role: "admin" | "media_manager";
  created_at: string;
}

// GET /api/admin/users — list all users
router.get("/admin/users", requireAdmin, async (_req, res) => {
  try {
    const rows = await query<UserRow>(
      `SELECT id, username, role, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    res.json({ users: rows });
  } catch {
    res.status(500).json({ error: "فشل جلب المستخدمين" });
  }
});

// POST /api/admin/users — create a new user
router.post("/admin/users", requireAdmin, async (req, res) => {
  const { username, password, role } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };
  if (!username || !password || !role) {
    return res.status(400).json({ error: "اسم المستخدم وكلمة المرور والدور مطلوبة" });
  }
  if (!["admin", "media_buyer", "media_manager"].includes(role)) {
    return res.status(400).json({ error: "الدور غير صحيح" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
  }
  try {
    const existing = await query<{ id: number }>(
      `SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL`,
      [username.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "اسم المستخدم مستخدم بالفعل" });
    }
    const hash = await bcrypt.hash(password, 12);
    const rows = await query<UserRow>(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at`,
      [username.trim(), hash, role]
    );
    res.status(201).json({ user: rows[0] });
  } catch {
    res.status(500).json({ error: "فشل إنشاء المستخدم" });
  }
});

// PATCH /api/admin/users/:id/password — reset password
router.patch("/admin/users/:id/password", requireAdmin, async (req, res) => {
  const id = Number(req.params["id"]);
  const { password } = req.body as { password?: string };
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const rows = await query<{ id: number }>(
      `UPDATE users SET password_hash = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id`,
      [hash, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "المستخدم غير موجود" });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "فشل تغيير كلمة المرور" });
  }
});

// DELETE /api/admin/users/:id
router.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params["id"]);
  // Prevent deleting the last admin
  try {
    const target = await query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (target.length === 0) return res.status(404).json({ error: "المستخدم غير موجود" });
    if (target[0]!.role === "admin") {
      const adminCount = await query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND deleted_at IS NULL`
      );
      if (Number(adminCount[0]?.cnt ?? 0) <= 1) {
        return res.status(400).json({ error: "لا يمكن حذف الأدمن الأخير" });
      }
    }
    await query(
      `UPDATE users SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "فشل حذف المستخدم" });
  }
});

export default router;
