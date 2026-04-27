import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "media_manager";
}

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان" });
  }
  try {
    const rows = await query<UserRow>(
      `SELECT id, username, password_hash, role FROM users WHERE username = $1 AND deleted_at IS NULL`,
      [username.trim()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    }
    const user = rows[0]!;
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.save(async (err) => {
      if (err) {
        logger.error({ err }, "Session save failed");
        return res.status(500).json({ error: "فشل حفظ الجلسة" });
      }
      // Log login activity + update last_seen_at
      try {
        await query(
          `INSERT INTO user_activity_logs (user_id, action, page, meta) VALUES ($1, 'login', NULL, '{}')`,
          [user.id]
        );
        await query(`UPDATE users SET last_seen_at = NOW() WHERE id = $1`, [user.id]);
      } catch { /* non-blocking */ }
      res.json({ user: { id: user.id, username: user.username, role: user.role } });
    });
  } catch (err) {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "فشل تسجيل الخروج" });
    res.clearCookie("sid");
    res.json({ success: true });
  });
});

// GET /api/auth/me
router.get("/auth/me", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "غير مسجّل" });
  }
  res.json({
    user: {
      id: req.session.userId,
      username: req.session.username,
      role: req.session.role,
    },
  });
});

export default router;
