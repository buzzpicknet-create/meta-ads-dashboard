-- Safe, backwards-compatible notification scope migration.
-- Existing ai_notifications are preserved. Legacy unscoped AI rows remain
-- visible to admins only at the API layer.

ALTER TABLE ai_notifications
  ADD COLUMN IF NOT EXISTS recipient_user_id INT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(20),
  ADD COLUMN IF NOT EXISTS account_id VARCHAR(50);

ALTER TABLE ai_notifications
  DROP CONSTRAINT IF EXISTS ai_notifications_valid_recipient_role;

ALTER TABLE ai_notifications
  ADD CONSTRAINT ai_notifications_valid_recipient_role
  CHECK (recipient_role IS NULL OR recipient_role IN ('admin','media_manager','media_buyer'));

CREATE INDEX IF NOT EXISTS idx_ai_notifications_recipient_user
  ON ai_notifications (recipient_user_id, created_at DESC)
  WHERE is_executed = FALSE;

CREATE INDEX IF NOT EXISTS idx_ai_notifications_recipient_role
  ON ai_notifications (recipient_role, created_at DESC)
  WHERE is_executed = FALSE;

CREATE TABLE IF NOT EXISTS app_notifications (
  id SERIAL PRIMARY KEY,
  recipient_user_id INT NOT NULL REFERENCES users(id),
  event_type VARCHAR(80) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_recipient_unread
  ON app_notifications (recipient_user_id, is_read, created_at DESC);

ALTER TABLE notification_settings
  DROP CONSTRAINT IF EXISTS notification_settings_valid_roles;

ALTER TABLE notification_settings
  ADD CONSTRAINT notification_settings_valid_roles
  CHECK (recipient_roles <@ ARRAY['admin','media_manager','media_buyer']::text[]);
