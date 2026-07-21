import webpush from "web-push";
import { query } from "./db";
import { logger } from "./logger";
import { randomUUID } from "crypto";
import { assertValidRoles, dedupeUserIds } from "./notification-rules";

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

  // Build per-user payloads — each user gets a unique notificationId for tracking
  const perUserFixed = subs.map((sub) => {
    const notificationId = randomUUID();
    return { sub, notificationId, payloadStr: JSON.stringify({ ...payload, notificationId }) };
  });

  const results = await Promise.allSettled(
    perUserFixed.map(({ sub, payloadStr }) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        payloadStr
      )
    )
  );

  const expired: number[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const { sub, notificationId } = perUserFixed[i]!;
    if (
      r.status === "rejected" ||
      (r.status === "fulfilled" && r.value.statusCode === 410)
    ) {
      expired.push(sub.id);
      logger.warn(
        {
          subscriptionId: sub.id,
          userId: sub.user_id,
          notificationId,
          err: r.status === "rejected" ? r.reason : undefined,
          statusCode: r.status === "fulfilled" ? r.value.statusCode : undefined,
        },
        "Push notification delivery failed",
      );
    } else {
      // Log successful sends
      await query(
        `INSERT INTO notification_log (notification_id, user_id, title, body, url, sent_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [notificationId, sub.user_id, payload.title, payload.body, payload.url ?? null]
      ).catch((err) => {
        logger.warn({ err, notificationId, userId: sub.user_id }, "Push notification log insert failed");
      });
    }
  }
  if (expired.length > 0) {
    await query(`DELETE FROM push_subscriptions WHERE id = ANY($1)`, [expired]);
  }
  logger.info({ sent: subs.length - expired.length, expired: expired.length }, "Push sent");
}

// Called by the service worker to record shown/clicked/dismissed events
export async function logNotificationEvent(
  notificationId: string,
  event: "shown" | "clicked" | "dismissed"
): Promise<void> {
  const col = event === "shown" ? "shown_at" : event === "clicked" ? "clicked_at" : "dismissed_at";
  await query(
    `UPDATE notification_log SET ${col} = NOW() WHERE notification_id = $1 AND ${col} IS NULL`,
    [notificationId]
  );
}

export async function sendPushToRoles(roles: string[], payload: PushPayload) {
  if (!vapidPublicKey) return;
  try {
    if (!assertValidRoles(roles)) {
      logger.warn({ roles }, "sendPushToRoles rejected invalid role");
      return;
    }
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

/**
 * Sends CPA alerts scoped to a specific ad account.
 * - Admin users (ad_account_id IS NULL) receive all alerts regardless of account.
 * - Non-admin users only receive alerts if their ad_account_id matches the campaign's account.
 */
export async function sendPushForCpaAlert(
  campaignAccountId: string,
  roles: string[],
  payload: PushPayload
) {
  if (!vapidPublicKey) return;
  try {
    const subs = await query<PushSubscriptionRow>(
      `SELECT ps.* FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
       WHERE u.role = ANY($1)
         AND u.deleted_at IS NULL
         AND (
           u.ad_account_id IS NULL
           OR u.ad_account_id = $2
         )`,
      [roles, campaignAccountId]
    );
    await sendToSubs(subs, payload);
  } catch (err) {
    logger.warn({ err }, "sendPushForCpaAlert failed");
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
    if (!assertValidRoles(setting.recipient_roles)) {
      logger.warn({ eventType, roles: setting.recipient_roles }, "Notification setting contains invalid role");
      return;
    }
    await sendPushToRoles(setting.recipient_roles, payload);
  } catch (err) {
    logger.warn({ err }, "sendPushForEvent failed");
  }
}

export async function sendPushToUser(userId: number, payload: PushPayload) {
  if (!vapidPublicKey) return 0;
  try {
    const subs = await query<PushSubscriptionRow>(
      `SELECT * FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    await sendToSubs(subs, payload);
    return subs.length;
  } catch (err) {
    logger.warn({ err }, "sendPushToUser failed");
    return 0;
  }
}

export async function sendPushToUserIds(userIds: number[], payload: PushPayload) {
  if (!vapidPublicKey) return 0;
  const safeUserIds = dedupeUserIds(userIds);
  if (!safeUserIds.length) return 0;
  try {
    const subs = await query<PushSubscriptionRow>(
      `SELECT * FROM push_subscriptions WHERE user_id = ANY($1::int[])`,
      [safeUserIds]
    );
    await sendToSubs(subs, payload);
    return subs.length;
  } catch (err) {
    logger.warn({ err, userIds: safeUserIds }, "sendPushToUserIds failed");
    return 0;
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
