import { Router } from "express";
import { query } from "../lib/db";
import { getVapidPublicKey, sendPushToUser, sendPushToRoles, logNotificationEvent } from "../lib/push";

interface NotifSetting {
  event_type: string;
  enabled: boolean;
  recipient_roles: string[];
}

const router = Router();

router.get("/push/vapid-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: "Push not initialized" });
  res.json({ publicKey: key });
});

router.post("/push/subscribe", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { endpoint, keys } = req.body as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "Invalid subscription data" });
  }

  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth_key = $4`,
    [userId, endpoint, keys.p256dh, keys.auth]
  );

  res.json({ ok: true });
});

router.delete("/push/subscribe", async (req, res) => {
  const { endpoint } = req.body as { endpoint: string };
  if (endpoint) {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  }
  res.json({ ok: true });
});

router.get("/push/settings", async (req, res) => {
  if (req.session?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const rows = await query<NotifSetting>(
      `SELECT event_type, enabled, recipient_roles FROM notification_settings ORDER BY event_type`
    );
    res.json({ settings: rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.post("/push/broadcast", async (req, res) => {
  if (req.session?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const { title, body, url, roles } = req.body as {
      title: string;
      body: string;
      url?: string;
      roles: string[];
    };
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: "العنوان والنص مطلوبان" });
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ error: "اختر مستقبلاً واحداً على الأقل" });
    }
    await sendPushToRoles(roles, {
      title: title.trim(),
      body: body.trim(),
      ...(url?.trim() ? { url: url.trim() } : {}),
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "فشل إرسال الإشعار" });
  }
});

router.post("/push/test", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const sent = await sendPushToUser(userId, {
      title: "🔔 إشعار تجريبي",
      body: "الإشعارات تعمل بنجاح على جهازك!",
      url: "/admin",
    });
    if (sent === 0) {
      return res.status(400).json({ error: "لا يوجد اشتراك إشعارات — تأكد من تفعيل الإشعارات أولاً" });
    }
    res.json({ ok: true, sent });
  } catch {
    res.status(500).json({ error: "فشل إرسال الإشعار التجريبي" });
  }
});

// ── Notification tracking (called by Service Worker — no session required) ────
router.post("/push/track", async (req, res) => {
  const { notificationId, event } = req.body as {
    notificationId: string;
    event: "shown" | "clicked" | "dismissed";
  };
  if (!notificationId || !["shown", "clicked", "dismissed"].includes(event)) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  try {
    await logNotificationEvent(notificationId, event);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Track failed" });
  }
});

// ── Notification log (admin only) ─────────────────────────────────────────────
router.get("/push/log", async (req, res) => {
  if (req.session?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const rows = await query<{
      notification_id: string;
      username: string | null;
      title: string;
      body: string;
      url: string | null;
      sent_at: string;
      shown_at: string | null;
      clicked_at: string | null;
      dismissed_at: string | null;
    }>(
      `SELECT nl.notification_id, u.username, nl.title, nl.body, nl.url,
              nl.sent_at, nl.shown_at, nl.clicked_at, nl.dismissed_at
       FROM notification_log nl
       LEFT JOIN users u ON u.id = nl.user_id
       ORDER BY nl.sent_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ log: rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch log" });
  }
});

router.put("/push/settings", async (req, res) => {
  if (req.session?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const { settings } = req.body as { settings: NotifSetting[] };
    if (!Array.isArray(settings)) return res.status(400).json({ error: "Invalid body" });
    for (const s of settings) {
      await query(
        `UPDATE notification_settings SET enabled = $2, recipient_roles = $3 WHERE event_type = $1`,
        [s.event_type, s.enabled, s.recipient_roles]
      );
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save settings" });
  }
});

export default router;
