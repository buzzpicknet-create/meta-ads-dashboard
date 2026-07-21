import { query } from "./db";
import { sendPushToUserIds, type PushPayload } from "./push";
import { dedupeUserIds, type UserRole } from "./notification-rules";

export interface InboxNotificationInput extends PushPayload {
  eventType: string;
  recipientUserIds?: number[];
  recipientRoles?: UserRole[];
  metadata?: Record<string, unknown>;
}

interface UserIdRow {
  id: number;
}

export async function resolveRecipientUserIds(input: {
  recipientUserIds?: number[];
  recipientRoles?: UserRole[];
}): Promise<number[]> {
  const directIds = dedupeUserIds(input.recipientUserIds ?? []);
  const roleRows = input.recipientRoles?.length
    ? await query<UserIdRow>(
        `SELECT id FROM users
         WHERE role = ANY($1::text[])
           AND deleted_at IS NULL`,
        [input.recipientRoles],
      )
    : [];

  return dedupeUserIds([...directIds, ...roleRows.map((row) => row.id)]);
}

export async function createInboxAndPush(input: InboxNotificationInput): Promise<number[]> {
  const recipientIds = await resolveRecipientUserIds(input);
  if (!recipientIds.length) return [];

  await query(
    `INSERT INTO app_notifications
       (recipient_user_id, event_type, title, body, url, metadata)
     SELECT user_id, $2, $3, $4, $5, $6::jsonb
     FROM unnest($1::int[]) AS user_id`,
    [
      recipientIds,
      input.eventType,
      input.title,
      input.body,
      input.url ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  await sendPushToUserIds(recipientIds, {
    title: input.title,
    body: input.body,
    ...(input.url ? { url: input.url } : {}),
  });

  return recipientIds;
}

export async function findBuyerIdsForAccountOrCampaign(input: {
  accountId?: string | null;
  campaignId?: string | null;
}): Promise<number[]> {
  const accountId = input.accountId?.trim() || null;
  const campaignId = input.campaignId?.trim() || null;
  if (!accountId && !campaignId) return [];

  const rows = await query<UserIdRow>(
    `SELECT DISTINCT u.id
     FROM users u
     LEFT JOIN user_account_permissions uap ON uap.user_id = u.id
     LEFT JOIN chat_conversations cc ON cc.user_id = u.id
     WHERE u.role = 'media_buyer'
       AND u.deleted_at IS NULL
       AND (
         ($1::text IS NOT NULL AND (u.ad_account_id = $1 OR uap.account_id = $1))
         OR ($2::text IS NOT NULL AND cc.campaign_id = $2)
       )`,
    [accountId, campaignId],
  );

  return dedupeUserIds(rows.map((row) => row.id));
}

export async function findInventoryResponsibleUserIds(productId: number): Promise<number[]> {
  if (!Number.isSafeInteger(productId)) return [];

  const rows = await query<UserIdRow>(
    `SELECT DISTINCT u.id
     FROM tasks t
     JOIN users u ON u.id = t.assigned_to_id
     WHERE t.inventory_product_id = $1
       AND t.assigned_to_id IS NOT NULL
       AND u.deleted_at IS NULL
     ORDER BY u.id
     LIMIT 20`,
    [productId],
  );

  return dedupeUserIds(rows.map((row) => row.id));
}

