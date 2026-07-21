import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidRoles,
  canSeeAiNotification,
  inventoryAlertRecipients,
  markAllVisibleAiRead,
  mediaRequestCompletedRecipients,
  taskAssignedRecipients,
  taskCompletedRecipients,
  unreadAiCount,
  type AiNotificationScope,
} from "../src/lib/notification-rules";

test("task assigned targets only assigned_to_id", () => {
  assert.deepEqual(taskAssignedRecipients(42), {
    recipientUserIds: [42],
    recipientRoles: [],
  });
});

test("task completed targets admin and media_manager", () => {
  assert.deepEqual(taskCompletedRecipients(), {
    recipientUserIds: [],
    recipientRoles: ["admin", "media_manager"],
  });
});

test("media request completed targets admin plus scoped buyers only", () => {
  assert.deepEqual(mediaRequestCompletedRecipients([7, 7, 9]), {
    recipientUserIds: [7, 9],
    recipientRoles: ["admin"],
  });
});

test("low stock uses mapped responsible user when available", () => {
  assert.deepEqual(inventoryAlertRecipients([12]), {
    recipientUserIds: [12],
    recipientRoles: [],
  });
});

test("restock falls back to admin and media_manager without mapping", () => {
  assert.deepEqual(inventoryAlertRecipients([]), {
    recipientUserIds: [],
    recipientRoles: ["admin", "media_manager"],
  });
});

test("AI notification visibility is scoped by role and user", () => {
  const adminOnlyLegacy: AiNotificationScope = {
    recipient_user_id: null,
    recipient_role: null,
    is_read: false,
    is_executed: false,
  };
  const buyerDirect: AiNotificationScope = {
    recipient_user_id: 3,
    recipient_role: null,
    is_read: false,
    is_executed: false,
  };
  const managerRole: AiNotificationScope = {
    recipient_user_id: null,
    recipient_role: "media_manager",
    is_read: false,
    is_executed: false,
  };

  assert.equal(canSeeAiNotification(adminOnlyLegacy, { userId: 1, role: "admin" }), true);
  assert.equal(canSeeAiNotification(adminOnlyLegacy, { userId: 3, role: "media_buyer" }), false);
  assert.equal(canSeeAiNotification(adminOnlyLegacy, { userId: 2, role: "media_manager" }), false);
  assert.equal(canSeeAiNotification(buyerDirect, { userId: 3, role: "media_buyer" }), true);
  assert.equal(canSeeAiNotification(managerRole, { userId: 2, role: "media_manager" }), true);
});

test("unread count includes visible unread notifications only", () => {
  const notifications: AiNotificationScope[] = [
    { recipient_user_id: 3, recipient_role: null, is_read: false, is_executed: false },
    { recipient_user_id: 3, recipient_role: null, is_read: true, is_executed: false },
    { recipient_user_id: null, recipient_role: "admin", is_read: false, is_executed: false },
    { recipient_user_id: null, recipient_role: "media_buyer", is_read: false, is_executed: true },
  ];
  assert.equal(unreadAiCount(notifications, { userId: 3, role: "media_buyer" }), 1);
});

test("mark all read updates only visible AI notifications", () => {
  const notifications: AiNotificationScope[] = [
    { recipient_user_id: 3, recipient_role: null, is_read: false, is_executed: false },
    { recipient_user_id: null, recipient_role: "admin", is_read: false, is_executed: false },
  ];
  const marked = markAllVisibleAiRead(notifications, { userId: 3, role: "media_buyer" });
  assert.equal(marked[0]?.is_read, true);
  assert.equal(marked[1]?.is_read, false);
});

test("invalid role is rejected", () => {
  assert.equal(assertValidRoles(["admin", "media_manager", "media_buyer"]), true);
  assert.equal(assertValidRoles(["admin", "buyer"]), false);
});

