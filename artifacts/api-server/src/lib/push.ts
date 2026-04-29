import webpush from "web-push";
import { query } from "./db";
import { logger } from "./logger";

interface PushSubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

let vapidPublicKey: string | null = null;
let vapidPrivateKey: string | null = null;

export async function initVapid() {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM push_config WHERE key IN ('vapid_public', 'vapid_private')`
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  if (!map["vapid_public"] || !map["vapid_private"]) {
    const keys = webpush.generateVAPIDKeys();
    await query(
      `INSERT INTO push_config (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [keys.publicKey, keys.privateKey]
    );
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
    logger.info("VAPID keys generated and stored");
  } else {
    vapidPublicKey = map["vapid_public"];
    vapidPrivateKey = map["vapid_private"];
  }

  webpush.setVapidDetails(
    "mailto:admin@dashboard.local",
    vapidPublicKey,
    vapidPrivateKey
  );
  logger.info("VAPID initialized");
}

export function getVapidPublicKey() {
  return vapidPublicKey;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

async function sendToSubs(subs: PushSubscriptionRow[], payload: PushPayload) {
  if (subs.length === 0) return;
  const payloadStr = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        payloadStr
      )
    )
  );
  const expired: number[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (
      r.status === "rejected" ||
      (r.status === "fulfilled" && r.value.statusCode === 410)
    ) {
      expired.push(subs[i]!.id);
    }
  }
  if (expired.length > 0) {
    await query(`DELETE FROM push_subscriptions WHERE id = ANY($1)`, [expired]);
  }
  logger.info({ sent: subs.length - expired.length, expired: expired.length }, "Push sent");
}

export async function sendPushToRoles(roles: string[], payload: PushPayload) {
  if (!vapidPublicKey) return;
  try {
    const subs = await query<PushSubscriptionRow>(
      `SELECT ps.* FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
       WHERE u.role = ANY($1) AND u.deleted_at IS NULL`,
      [roles]
    );
    await sendToSubs(subs, payload);
  } catch (err) {
    logger.warn({ err }, "sendPushToRoles failed");
  }
}

export async function sendPushForEvent(eventType: string, payload: PushPayload) {
  if (!vapidPublicKey) return;
  try {
    const rows = await query<{ enabled: boolean; recipient_roles: string[] }>(
      `SELECT enabled, recipient_roles FROM notification_settings WHERE event_type = $1`,
      [eventType]
    );
    const setting = rows[0];
    if (!setting || !setting.enabled || setting.recipient_roles.length === 0) return;
    await sendPushToRoles(setting.recipient_roles, payload);
  } catch (err) {
    logger.warn({ err }, "sendPushForEvent failed");
  }
}

export async function sendPushToAllUsers(payload: PushPayload) {
  if (!vapidPublicKey) return;
  try {
    const subs = await query<PushSubscriptionRow>(
      `SELECT ps.* FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
       WHERE u.deleted_at IS NULL`
    );
    await sendToSubs(subs, payload);
  } catch (err) {
    logger.warn({ err }, "sendPushToAllUsers failed");
  }
}
