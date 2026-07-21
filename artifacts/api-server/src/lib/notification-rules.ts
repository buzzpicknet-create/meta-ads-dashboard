export const VALID_ROLES = ["admin", "media_manager", "media_buyer"] as const;

export type UserRole = (typeof VALID_ROLES)[number];

export function isValidRole(role: string): role is UserRole {
  return (VALID_ROLES as readonly string[]).includes(role);
}

export function assertValidRoles(roles: string[]): roles is UserRole[] {
  return roles.every(isValidRole);
}

export function scopeAiNotificationSql(role: UserRole): string {
  if (role === "admin") {
    return `(
      recipient_user_id = $1
      OR recipient_role = $2
      OR (recipient_user_id IS NULL AND recipient_role IS NULL)
    )`;
  }

  return `(
    recipient_user_id = $1
    OR recipient_role = $2
  )`;
}

export function dedupeUserIds(userIds: Array<number | null | undefined>): number[] {
  return Array.from(
    new Set(
      userIds.filter(
        (userId): userId is number =>
          Number.isSafeInteger(userId) && Number(userId) > 0,
      ),
    ),
  );
}

export function fallbackInventoryRoles(hasMappedResponsible: boolean): UserRole[] {
  return hasMappedResponsible ? [] : ["admin", "media_manager"];
}

export interface RecipientPlan {
  recipientUserIds: number[];
  recipientRoles: UserRole[];
}

export function taskAssignedRecipients(assignedToId: number | null | undefined): RecipientPlan {
  return {
    recipientUserIds: dedupeUserIds([assignedToId]),
    recipientRoles: [],
  };
}

export function taskCompletedRecipients(): RecipientPlan {
  return {
    recipientUserIds: [],
    recipientRoles: ["admin", "media_manager"],
  };
}

export function mediaRequestCompletedRecipients(buyerUserIds: number[]): RecipientPlan {
  return {
    recipientUserIds: dedupeUserIds(buyerUserIds),
    recipientRoles: ["admin"],
  };
}

export function inventoryAlertRecipients(mappedUserIds: number[]): RecipientPlan {
  const recipientUserIds = dedupeUserIds(mappedUserIds);
  return {
    recipientUserIds,
    recipientRoles: fallbackInventoryRoles(recipientUserIds.length > 0),
  };
}

export interface AiNotificationScope {
  recipient_user_id: number | null;
  recipient_role: UserRole | null;
  is_read: boolean;
  is_executed: boolean;
}

export function canSeeAiNotification(
  notification: AiNotificationScope,
  currentUser: { userId: number; role: UserRole },
): boolean {
  if (notification.is_executed) return false;
  if (notification.recipient_user_id === currentUser.userId) return true;
  if (notification.recipient_role === currentUser.role) return true;
  return (
    currentUser.role === "admin" &&
    notification.recipient_user_id === null &&
    notification.recipient_role === null
  );
}

export function unreadAiCount(
  notifications: AiNotificationScope[],
  currentUser: { userId: number; role: UserRole },
): number {
  return notifications.filter(
    (notification) =>
      !notification.is_read && canSeeAiNotification(notification, currentUser),
  ).length;
}

export function markAllVisibleAiRead(
  notifications: AiNotificationScope[],
  currentUser: { userId: number; role: UserRole },
): AiNotificationScope[] {
  return notifications.map((notification) =>
    canSeeAiNotification(notification, currentUser)
      ? { ...notification, is_read: true }
      : notification,
  );
}
