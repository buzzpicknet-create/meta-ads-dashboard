import { Router } from "express";
import { query } from "../lib/db";
import { getVapidPublicKey } from "../lib/push";

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
