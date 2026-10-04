import { fileURLToPath } from "url";
import { dirname, join } from "path";
import app from "./app";
import { logger } from "./lib/logger";
import { query } from "./lib/db";
import { runMediaScan } from "./lib/media-scan";
import { warmCreativeCache, proactiveInsightsRefresh, setLastWarmupStats, setWarmupInProgress, getLastWarmupStats, rehydrateWarmupHistory } from "./routes/meta";
import { getAdAccountIds, initTokenFromDb, getTokenInfo, refreshLongLivedToken } from "./lib/meta-token";
import { initVapid, sendPushToRoles, sendPushForCpaAlert } from "./lib/push";
import { getCpaAlerts, type CpaAlertsResult } from "./lib/meta-api";
import { runScheduledReportsCron } from "./routes/scheduled-reports";
import { startWatchdogCron } from "./routes/watchdog";
import { sendTelegramAlert } from "./lib/telegram.js";
import { checkInventoryAlerts } from "./routes/inventory";
import { initJobsTable } from "./lib/job-runner";
import "./lib/job-handlers"; // registers all job handlers
import bcrypt from "bcryptjs";
import cron from "node-cron";
import { generateDailyProductFollowupTasks } from "./routes/tasks";

async function runMigrations() {
  // Session store table (for connect-pg-simple)
  await query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      "sid" VARCHAR NOT NULL COLLATE "default",
      "sess" JSON NOT NULL,
      "expire" TIMESTAMP(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON user_sessions ("expire")
  `);

  // Users table for authentication
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'media_manager',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS alert_snapshots (
      id SERIAL PRIMARY KEY,
      account_id VARCHAR(50) NOT NULL,
      alert_key VARCHAR(200) NOT NULL,
      alert_type VARCHAR(50),
      severity VARCHAR(20),
      metric_value DOUBLE PRECISION,
      metric_label VARCHAR(200),
      campaign_id VARCHAR(100),
      campaign_name VARCHAR(500),
      detected_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      is_resolved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS alert_actions (
      id SERIAL PRIMARY KEY,
      snapshot_id INT,
      account_id VARCHAR(50) NOT NULL,
      alert_key VARCHAR(200) NOT NULL,
      action_type VARCHAR(50),
      action_note TEXT,
      metric_before DOUBLE PRECISION,
      metric_after DOUBLE PRECISION,
      actioned_by VARCHAR(200),
      actioned_at TIMESTAMPTZ DEFAULT NOW(),
      follow_up_at TIMESTAMPTZ,
      outcome TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS media_requests (
      id SERIAL PRIMARY KEY,
      campaign_id VARCHAR(100),
      campaign_name VARCHAR(500) NOT NULL,
      landing_url TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      priority VARCHAR(10) DEFAULT 'normal',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS media_scan_log (
      id SERIAL PRIMARY KEY,
      scanned_at TIMESTAMPTZ DEFAULT NOW(),
      campaigns_checked INT DEFAULT 0,
      requests_created INT DEFAULT 0,
      error TEXT
    )
  `);
  // Soft delete support
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS deleted_reason TEXT`);
  // Rich brief fields
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS drive_link TEXT`);
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS product_description TEXT`);
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS angles TEXT`);
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS scripts TEXT`);
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS reference_links TEXT`);
  // Delivery fields
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS output_link TEXT`);
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS upload_link TEXT`);
  // Prevent duplicate active requests for the same campaign_id (race-condition safe)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS media_requests_campaign_active
    ON media_requests (campaign_id)
    WHERE campaign_id IS NOT NULL
      AND deleted_at IS NULL
      AND status IN ('needs_review', 'pending', 'in_progress')
  `);
  // needs_review status for auto-scanned requests
  await query(`
    CREATE TABLE IF NOT EXISTS media_delete_log (
      id SERIAL PRIMARY KEY,
      request_id INT NOT NULL,
      campaign_name VARCHAR(500) NOT NULL,
      status_at_deletion VARCHAR(20),
      priority_at_deletion VARCHAR(10),
      notes TEXT,
      deleted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Unified audit log for approvals and rejections
  await query(`
    CREATE TABLE IF NOT EXISTS media_audit_log (
      id SERIAL PRIMARY KEY,
      request_id INT NOT NULL,
      campaign_name VARCHAR(500) NOT NULL,
      action VARCHAR(20) NOT NULL,
      priority VARCHAR(10),
      actioned_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Campaign issue tracking (first_seen_at) + team notes
  await query(`
    CREATE TABLE IF NOT EXISTS campaign_issues (
      id SERIAL PRIMARY KEY,
      campaign_id VARCHAR(100) NOT NULL,
      campaign_name VARCHAR(500),
      account_id VARCHAR(50) NOT NULL,
      issue_types VARCHAR(300),
      first_seen_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(campaign_id, account_id)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS campaign_notes (
      id SERIAL PRIMARY KEY,
      campaign_id VARCHAR(100) NOT NULL,
      campaign_name VARCHAR(500),
      account_id VARCHAR(50) NOT NULL,
      note TEXT NOT NULL,
      action_type VARCHAR(100),
      noted_by VARCHAR(200),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // DB-backed campaigns cache (survives server restarts — permanent rate-limit solution)
  await query(`
    CREATE TABLE IF NOT EXISTS meta_campaigns_cache (
      id SERIAL PRIMARY KEY,
      account_id VARCHAR(50) NOT NULL,
      period_since VARCHAR(10) NOT NULL,
      period_until VARCHAR(10) NOT NULL,
      campaigns JSONB NOT NULL DEFAULT '[]',
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(account_id, period_since, period_until)
    )
  `);
  // DB-backed campaign details cache (status + budget — used by write-tool confirmation cards)
  await query(`
    CREATE TABLE IF NOT EXISTS meta_campaign_details_cache (
      campaign_id VARCHAR(100) PRIMARY KEY,
      data JSONB NOT NULL,
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // DB-backed adset details cache (status + budget — used by write-tool confirmation cards)
  await query(`
    CREATE TABLE IF NOT EXISTS meta_adset_details_cache (
      adset_id VARCHAR(100) PRIMARY KEY,
      data JSONB NOT NULL,
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // One-time cleanup: soft-delete media requests created solely because of CPM
  // CPM was removed as a trigger metric; these records are no longer valid
  const cleaned = await query<{ id: number }>(
    `UPDATE media_requests
     SET deleted_at = NOW(),
         deleted_reason = 'أُزيل تلقائياً: أُنشئ بناءً على CPM — تم إلغاء هذا المعيار'
     WHERE deleted_at IS NULL
       AND notes ILIKE '%CPM%'
       AND notes NOT ILIKE '%CTR في انخفاض%'
       AND notes NOT ILIKE '%CPA في ارتفاع%'
     RETURNING id`
  );
  if (cleaned.length > 0) {
    logger.info({ count: cleaned.length }, "Cleaned up CPM-only media requests");
  }
  // Also strip CPM lines from mixed records that also have valid trend reasons
  await query(
    `UPDATE media_requests
     SET notes = regexp_replace(notes, '• CPM[^\n]*\n?', '', 'g')
     WHERE deleted_at IS NULL
       AND notes ILIKE '%CPM%'`
  );
  // User activity logs (page visits, diagnosis runs, media requests)
  await query(`
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id),
      action VARCHAR(50) NOT NULL,
      page VARCHAR(200),
      meta JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_activity_user_created
    ON user_activity_logs(user_id, created_at DESC)
  `);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  // Account-specific notification: link user to a specific ad account
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_account_id VARCHAR(50)`);
  // Per-user page permissions for ads-dashboard (null = all pages visible)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_pages JSONB`);
  await query(`ALTER TABLE media_requests ADD COLUMN IF NOT EXISTS account_id VARCHAR(50)`);
  await query(`
    CREATE TABLE IF NOT EXISTS push_config (
      key VARCHAR(50) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth_key TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS notification_settings (
      event_type VARCHAR(50) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      recipient_roles TEXT[] NOT NULL DEFAULT '{}'
    )
  `);
  await query(`
    ALTER TABLE notification_settings
    DROP CONSTRAINT IF EXISTS notification_settings_valid_roles
  `);
  await query(`
    ALTER TABLE notification_settings
    ADD CONSTRAINT notification_settings_valid_roles
    CHECK (recipient_roles <@ ARRAY['admin','media_manager','media_buyer']::text[])
  `);
  await query(`
    INSERT INTO notification_settings (event_type, enabled, recipient_roles) VALUES
      ('manual_request_created', true, ARRAY['media_manager']),
      ('request_completed', true, ARRAY['admin','media_buyer']),
      ('request_rejected', true, ARRAY['admin']),
      ('new_scan_request', true, ARRAY['admin','media_manager']),
      ('no_op_spike', true, ARRAY['admin']),
      ('inventory_low_stock', true, ARRAY['admin','media_buyer']),
      ('inventory_restock', true, ARRAY['media_buyer'])
    ON CONFLICT (event_type) DO NOTHING
  `);

  // Notification delivery log — tracks per-user sent/shown/clicked/dismissed
  await query(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id SERIAL PRIMARY KEY,
      notification_id VARCHAR(36) NOT NULL,
      user_id INT REFERENCES users(id),
      title TEXT,
      body TEXT,
      url TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      shown_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_notif_log_notif_id ON notification_log (notification_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notif_log_sent ON notification_log (sent_at DESC)`);

  // AI Watchdog notifications — proactive anomaly alerts from the background scan
  await query(`
    CREATE TABLE IF NOT EXISTS ai_notifications (
      id SERIAL PRIMARY KEY,
      campaign_id VARCHAR(100),
      campaign_name VARCHAR(500),
      severity VARCHAR(20) NOT NULL DEFAULT 'high',
      message TEXT NOT NULL,
      recommended_action JSONB,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      is_executed BOOLEAN NOT NULL DEFAULT FALSE,
      executed_at TIMESTAMPTZ,
      executed_by VARCHAR(200),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE ai_notifications ADD COLUMN IF NOT EXISTS recipient_user_id INT REFERENCES users(id)`);
  await query(`ALTER TABLE ai_notifications ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(20)`);
  await query(`ALTER TABLE ai_notifications ADD COLUMN IF NOT EXISTS account_id VARCHAR(50)`);
  await query(`
    ALTER TABLE ai_notifications
    DROP CONSTRAINT IF EXISTS ai_notifications_valid_recipient_role
  `);
  await query(`
    ALTER TABLE ai_notifications
    ADD CONSTRAINT ai_notifications_valid_recipient_role
    CHECK (recipient_role IS NULL OR recipient_role IN ('admin','media_manager','media_buyer'))
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ai_notifications_active
    ON ai_notifications (created_at DESC)
    WHERE is_executed = FALSE
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ai_notifications_recipient_user
    ON ai_notifications (recipient_user_id, created_at DESC)
    WHERE is_executed = FALSE
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ai_notifications_recipient_role
    ON ai_notifications (recipient_role, created_at DESC)
    WHERE is_executed = FALSE
  `);

  await query(`
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
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_app_notifications_recipient_unread
    ON app_notifications (recipient_user_id, is_read, created_at DESC)
  `);

  // CPA alert log — tracks sent push notifications to avoid duplicates
  await query(`
    CREATE TABLE IF NOT EXISTS cpa_alert_log (
      id SERIAL PRIMARY KEY,
      campaign_id VARCHAR(100) NOT NULL,
      account_id VARCHAR(50) NOT NULL,
      alert_type VARCHAR(20) NOT NULL,
      campaign_name VARCHAR(500),
      cpa DOUBLE PRECISION,
      notified_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_cpa_alert_log_lookup
    ON cpa_alert_log (campaign_id, account_id, alert_type, notified_at DESC)
  `);

  // Page visibility settings per role
  await query(`
    CREATE TABLE IF NOT EXISTS page_visibility (
      page_path TEXT NOT NULL,
      role TEXT NOT NULL,
      visible BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (page_path, role)
    )
  `);
  // Seed defaults (won't overwrite existing settings)
  await query(`
    INSERT INTO page_visibility (page_path, role, visible) VALUES
      ('/overview',  'admin',         true),
      ('/overview',  'media_buyer',   true),
      ('/overview',  'media_manager', false),
      ('/',          'admin',         true),
      ('/',          'media_buyer',   true),
      ('/',          'media_manager', false),
      ('/creative',  'admin',         true),
      ('/creative',  'media_buyer',   true),
      ('/creative',  'media_manager', false),
      ('/activity',  'admin',         true),
      ('/activity',  'media_buyer',   true),
      ('/activity',  'media_manager', false),
      ('/media',     'admin',         true),
      ('/media',     'media_buyer',   true),
      ('/media',     'media_manager', true),
      ('/decisions', 'admin',         true),
      ('/decisions', 'media_buyer',   false),
      ('/decisions', 'media_manager', false),
      ('/tasks',         'admin',         true),
      ('/tasks',         'media_buyer',   true),
      ('/tasks',         'media_manager', false),
      ('/landing-page',  'admin',         true),
      ('/landing-page',  'media_buyer',   true),
      ('/landing-page',  'media_manager', false)
    ON CONFLICT (page_path, role) DO NOTHING
  `);
  // AI assistant action log — every write action executed via pipeboard
  await query(`
    CREATE TABLE IF NOT EXISTS pipeboard_actions (
      id SERIAL PRIMARY KEY,
      executed_at TIMESTAMPTZ DEFAULT NOW(),
      executed_by VARCHAR(200) NOT NULL,
      tool_name VARCHAR(100) NOT NULL,
      args JSONB NOT NULL DEFAULT '{}',
      success BOOLEAN NOT NULL,
      result_message TEXT,
      campaign_name VARCHAR(500),
      adset_name VARCHAR(500)
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_pipeboard_actions_executed_at
    ON pipeboard_actions (executed_at DESC)
  `);
  await query(`ALTER TABLE pipeboard_actions ADD COLUMN IF NOT EXISTS is_no_op BOOLEAN NOT NULL DEFAULT FALSE`);

  // Scheduled redundant-actions email reports
  await query(`
    CREATE TABLE IF NOT EXISTS scheduled_reports (
      id SERIAL PRIMARY KEY,
      email VARCHAR(254) NOT NULL,
      frequency VARCHAR(10) NOT NULL DEFAULT 'weekly',
      created_by VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_sent_at TIMESTAMPTZ,
      next_send_at TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_send
    ON scheduled_reports (next_send_at) WHERE is_active = TRUE
  `);

  // Track one-time migrations
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Hide overview & campaign-analysis from non-admin roles — one-time migration
  const hiddenMig = await query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id = 'hide_overview_analysis_2025'`
  );
  if (hiddenMig.length === 0) {
    await query(`
      UPDATE page_visibility
      SET visible = false
      WHERE page_path IN ('/overview', '/')
        AND role IN ('media_buyer', 'media_manager')
    `);
    await query(`INSERT INTO schema_migrations (id) VALUES ('hide_overview_analysis_2025')`);
  }

  // Create default admin user if no users exist
  const existingUsers = await query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM users WHERE deleted_at IS NULL`);
  if (Number(existingUsers[0]?.cnt ?? 0) === 0) {
    const hash = await bcrypt.hash("admin123", 12);
    await query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') ON CONFLICT (username) DO NOTHING`,
      ["admin", hash]
    );
    logger.info("Default admin user created: admin / admin123");
  }

  // Cache warm-up run log — persists stats across server restarts
  await query(`
    CREATE TABLE IF NOT EXISTS cache_warmup_log (
      id SERIAL PRIMARY KEY,
      ran_at TIMESTAMPTZ NOT NULL,
      duration_ms INT NOT NULL,
      insights INT NOT NULL DEFAULT 0,
      campaigns INT NOT NULL DEFAULT 0,
      overview INT NOT NULL DEFAULT 0,
      campaign_details INT NOT NULL DEFAULT 0,
      adset_details INT NOT NULL DEFAULT 0,
      skipped INT NOT NULL DEFAULT 0
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_cache_warmup_log_ran_at
    ON cache_warmup_log (ran_at DESC)
  `);

  await query(`CREATE TABLE IF NOT EXISTS chat_conversations (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    campaign_name TEXT,
    campaign_id TEXT,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    tool_calls JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS campaign_id TEXT`);
  await query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS campaign_name TEXT`);
  await query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tool_calls JSONB`);

  // campaign_name_cache: persistent lookup of campaign_id → name
  // Populated from any path that receives a campaign name (campaigns API, insights, alerts).
  // Used by the chat resolver as a first-pass before calling the Meta API.
  await query(`
    CREATE TABLE IF NOT EXISTS campaign_name_cache (
      campaign_id VARCHAR(100) PRIMARY KEY,
      campaign_name TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Backfill campaign_name_cache from the existing meta_campaigns_cache JSONB store.
  // Guarded by schema_migrations so it runs exactly once.
  const campaignNameCacheBackfillMig = await query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id = 'backfill_campaign_name_cache_2026'`
  );
  if (campaignNameCacheBackfillMig.length === 0) {
    const backfilled = await query<{ count: string }>(`
      WITH src AS (
        SELECT DISTINCT ON (camp->>'id')
          camp->>'id'   AS campaign_id,
          camp->>'name' AS campaign_name
        FROM meta_campaigns_cache,
             jsonb_array_elements(campaigns) AS camp
        WHERE camp->>'id' IS NOT NULL AND camp->>'name' IS NOT NULL
        ORDER BY camp->>'id', fetched_at DESC
      ),
      ins AS (
        INSERT INTO campaign_name_cache (campaign_id, campaign_name)
        SELECT campaign_id, campaign_name FROM src
        ON CONFLICT (campaign_id) DO UPDATE SET campaign_name = EXCLUDED.campaign_name, updated_at = NOW()
        RETURNING 1
      )
      SELECT COUNT(*) AS count FROM ins
    `);
    const count = Number(backfilled[0]?.count ?? 0);
    logger.info({ count }, "Backfilled campaign_name_cache from meta_campaigns_cache");
    await query(`INSERT INTO schema_migrations (id) VALUES ('backfill_campaign_name_cache_2026') ON CONFLICT (id) DO NOTHING`);
  }

  // One-time backfill: populate campaign_name for historical conversations that
  // already have a campaign_id but were created before the campaign_name column existed.
  // Guarded by schema_migrations so it runs exactly once (not on every boot).
  const campaignNameBackfillMig = await query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id = 'backfill_conversation_campaign_names_2026'`
  );
  if (campaignNameBackfillMig.length === 0) {
    const backfilled = await query<{ count: string }>(`
      WITH updated AS (
        UPDATE chat_conversations cc
        SET campaign_name = c.name
        FROM (
          SELECT DISTINCT ON (camp->>'id')
            camp->>'id'   AS campaign_id,
            camp->>'name' AS name
          FROM meta_campaigns_cache,
               jsonb_array_elements(campaigns) AS camp
          ORDER BY camp->>'id', fetched_at DESC
        ) c
        WHERE cc.campaign_id = c.campaign_id
          AND cc.campaign_id IS NOT NULL
          AND cc.campaign_name IS NULL
        RETURNING 1
      )
      SELECT COUNT(*) AS count FROM updated
    `);
    const count = Number(backfilled[0]?.count ?? 0);
    logger.info({ count }, "Backfilled campaign_name on historical chat conversations");
    await query(`INSERT INTO schema_migrations (id) VALUES ('backfill_conversation_campaign_names_2026') ON CONFLICT (id) DO NOTHING`);
  }

  // Long-Term Memory table — stores learned KPIs, rules, and insights per user
  await query(`
    CREATE TABLE IF NOT EXISTS user_ai_memory (
      user_id INT PRIMARY KEY REFERENCES users(id),
      target_kpis JSONB NOT NULL DEFAULT '{}',
      strategic_rules JSONB NOT NULL DEFAULT '[]',
      historical_insights TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Meta access tokens — persistent storage survives autoscale restarts
  await query(`
    CREATE TABLE IF NOT EXISTS meta_tokens (
      id SERIAL PRIMARY KEY,
      access_token TEXT NOT NULL,
      app_id TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMPTZ,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Account-level permissions per user (replaces single ad_account_id)
  await query(`
    CREATE TABLE IF NOT EXISTS user_account_permissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      account_type TEXT NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, account_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_uap_user_id ON user_account_permissions (user_id)`);

  await initJobsTable();

  // Inventory stock state — tracks last-known stock per product for alert diffing
  await query(`
    CREATE TABLE IF NOT EXISTS inventory_stock_state (
      product_id INTEGER PRIMARY KEY,
      product_name TEXT,
      last_stock INTEGER NOT NULL DEFAULT 0,
      alert_sent_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Daily tasks system — media buyer task management with gamified scoring
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      product_name TEXT,
      assigned_to_id INT REFERENCES users(id) ON DELETE SET NULL,
      assigned_to_name TEXT,
      deadline TIMESTAMPTZ NOT NULL,
      success_metric TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT,
      completed_at TIMESTAMPTZ,
      checkin_count INT NOT NULL DEFAULT 0,
      last_checkin_at TIMESTAMPTZ,
      notes TEXT,
      inventory_product_id INTEGER,
      inventory_snapshot JSONB,
      inventory_result JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks (assigned_to_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks (deadline)`);

  // Product/platform daily follow-up workflow
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_kind TEXT NOT NULL DEFAULT 'manual'`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS platform TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS daily_followup_date DATE`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS admin_highlighted BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS admin_highlight_note_id INT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS admin_highlighted_at TIMESTAMPTZ`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS admin_highlighted_by VARCHAR(200)`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_daily_product_platform
    ON tasks (inventory_product_id, platform, daily_followup_date)
    WHERE task_kind = 'daily_product_followup' AND daily_followup_date IS NOT NULL
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_daily_product_buyer_grouped
    ON tasks (inventory_product_id, assigned_to_id, daily_followup_date)
    WHERE task_kind = 'daily_product_followup'
      AND daily_followup_date IS NOT NULL
      AND platform IS NULL
  `);

  // Extend today's unfinished follow-up tasks to the new 21:00 Cairo deadline.
  // If an older process already expired one today, reopen it so the team still gets the full window.
  await query(`
    UPDATE tasks
    SET deadline = ((daily_followup_date + TIME '21:00') AT TIME ZONE 'Africa/Cairo'),
        status = CASE WHEN status = 'expired' THEN 'pending' ELSE status END,
        notes = CASE
          WHEN notes IS NOT NULL THEN REPLACE(notes, '5:00 مساءً', '9:00 مساءً')
          ELSE notes
        END,
        updated_at = NOW()
    WHERE task_kind = 'daily_product_followup'
      AND daily_followup_date = (NOW() AT TIME ZONE 'Africa/Cairo')::date
      AND completed_at IS NULL
      AND status IN ('pending', 'in_progress', 'expired')
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS inventory_media_assignments (
      id SERIAL PRIMARY KEY,
      inventory_product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      source_store TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('meta','google','tiktok')),
      assigned_to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_to_name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (inventory_product_id, platform)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_inventory_media_assignments_user ON inventory_media_assignments (assigned_to_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_inventory_media_assignments_active ON inventory_media_assignments (is_active)`);

  // One-time cleanup: remove the accidental Oct 1 follow-ups created by the
  // temporary hourly generator at 18:02 Cairo, but only if nobody touched them.
  await query(`
    DELETE FROM tasks
    WHERE task_kind = 'daily_product_followup'
      AND daily_followup_date = DATE '2026-10-01'
      AND created_at >= TIMESTAMPTZ '2026-10-01 18:02:00+03'
      AND created_at <  TIMESTAMPTZ '2026-10-01 18:03:00+03'
      AND status = 'pending'
      AND completed_at IS NULL
      AND checkin_count = 0
      AND last_checkin_at IS NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS task_media (
      id SERIAL PRIMARY KEY,
      task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_media_task_id ON task_media (task_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS task_notes (
      id SERIAL PRIMARY KEY,
      task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INT NOT NULL,
      username TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_notes_task_id ON task_notes (task_id)`);
  await query(`ALTER TABLE task_notes ADD COLUMN IF NOT EXISTS is_important BOOLEAN NOT NULL DEFAULT FALSE`);

  await query(`
    CREATE TABLE IF NOT EXISTS task_platform_followups (
      id SERIAL PRIMARY KEY,
      task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('meta','google','tiktok')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
      comment_text TEXT,
      completed_at TIMESTAMPTZ,
      completed_by_id INT REFERENCES users(id) ON DELETE SET NULL,
      completed_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (task_id, platform)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_platform_followups_task ON task_platform_followups (task_id)`);

  // Grouped follow-up status semantics:
  // - all platforms completed => completed
  // - some completed after deadline => partial_completed
  // - none completed after deadline => expired
  await query(`
    UPDATE tasks t
    SET status = 'partial_completed',
        updated_at = NOW()
    WHERE t.task_kind = 'daily_product_followup'
      AND t.platform IS NULL
      AND t.status = 'expired'
      AND EXISTS (
        SELECT 1
        FROM task_platform_followups pf
        WHERE pf.task_id = t.id
          AND pf.status = 'completed'
      )
      AND EXISTS (
        SELECT 1
        FROM task_platform_followups pf
        WHERE pf.task_id = t.id
          AND pf.status = 'pending'
      )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS media_buyer_score_deductions (
      id SERIAL PRIMARY KEY,
      media_buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_buyer_name TEXT NOT NULL,
      points INT NOT NULL CHECK (points BETWEEN 1 AND 20),
      reason TEXT NOT NULL,
      task_id INT REFERENCES tasks(id) ON DELETE SET NULL,
      created_by_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reversed_at TIMESTAMPTZ,
      reversed_by_id INT REFERENCES users(id) ON DELETE SET NULL,
      reversed_by_name TEXT
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_score_deductions_buyer ON media_buyer_score_deductions (media_buyer_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_score_deductions_active ON media_buyer_score_deductions (media_buyer_id) WHERE reversed_at IS NULL`);

  await query(`
    CREATE TABLE IF NOT EXISTS task_views (
      id SERIAL PRIMARY KEY,
      task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INT NOT NULL,
      username TEXT NOT NULL,
      viewed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_views_task_id ON task_views (task_id)`);


  // One-time migration: convert Oct 4 daily follow-ups from one-task-per-platform
  // into one task per Product + Media Buyer, preserving completed platform work.
  const oct4Groups = await query<{
    inventory_product_id: number;
    assigned_to_id: number;
    assigned_to_name: string;
    product_name: string;
    source_store: string | null;
    deadline: string;
    created_at: string;
    admin_highlighted: boolean;
    admin_highlight_note_id: number | null;
    admin_highlighted_at: string | null;
    admin_highlighted_by: string | null;
  }>(`
    SELECT
      t.inventory_product_id,
      t.assigned_to_id,
      MAX(t.assigned_to_name) AS assigned_to_name,
      MAX(t.product_name) AS product_name,
      MAX(t.inventory_snapshot->>'sourceStore') AS source_store,
      MAX(t.deadline)::text AS deadline,
      MIN(t.created_at)::text AS created_at,
      BOOL_OR(COALESCE(t.admin_highlighted, FALSE)) AS admin_highlighted,
      MAX(t.admin_highlight_note_id) AS admin_highlight_note_id,
      MAX(t.admin_highlighted_at)::text AS admin_highlighted_at,
      MAX(t.admin_highlighted_by) AS admin_highlighted_by
    FROM tasks t
    WHERE t.task_kind = 'daily_product_followup'
      AND t.daily_followup_date = DATE '2026-10-04'
      AND t.platform IS NOT NULL
      AND t.inventory_product_id IS NOT NULL
      AND t.assigned_to_id IS NOT NULL
    GROUP BY t.inventory_product_id, t.assigned_to_id
    ORDER BY t.assigned_to_id, t.inventory_product_id
  `);

  for (const group of oct4Groups) {
    const sourceTasks = await query<{
      id: number;
      platform: string;
      status: string;
      completed_at: string | null;
      checkin_count: number;
      last_checkin_at: string | null;
    }>(`
      SELECT id, platform, status, completed_at::text, checkin_count, last_checkin_at::text
      FROM tasks
      WHERE task_kind = 'daily_product_followup'
        AND daily_followup_date = DATE '2026-10-04'
        AND platform IS NOT NULL
        AND inventory_product_id = $1
        AND assigned_to_id = $2
      ORDER BY id
    `, [group.inventory_product_id, group.assigned_to_id]);

    if (sourceTasks.length === 0) continue;

    const sourceIds = sourceTasks.map((task) => task.id);
    const platformLabels = sourceTasks
      .map((task) => task.platform === 'meta' ? 'Meta' : task.platform === 'google' ? 'Google' : 'TikTok')
      .join(' + ');

    const [groupedTask] = await query<{ id: number }>(`
      INSERT INTO tasks (
        title,
        product_name,
        assigned_to_id,
        assigned_to_name,
        deadline,
        success_metric,
        notes,
        created_by_id,
        created_by_name,
        inventory_product_id,
        inventory_snapshot,
        task_kind,
        platform,
        daily_followup_date,
        created_at,
        admin_highlighted,
        admin_highlight_note_id,
        admin_highlighted_at,
        admin_highlighted_by
      )
      SELECT
        'متابعة يومية — ' || $3,
        $3,
        $2,
        $4,
        $5::timestamptz,
        'اكتب تعليق منفصل لكل منصة مسؤولة عنها',
        'متابعة يومية للمنصات: ' || $6 || '. يكتمل التاسك بعد كتابة تعليق لكل منصة.',
        NULL,
        'النظام',
        $1,
        (
          SELECT inventory_snapshot
          FROM tasks
          WHERE id = ANY($7::int[])
          ORDER BY id
          LIMIT 1
        ),
        'daily_product_followup',
        NULL,
        DATE '2026-10-04',
        $8::timestamptz,
        $9,
        $10,
        $11::timestamptz,
        $12
      ON CONFLICT (inventory_product_id, assigned_to_id, daily_followup_date)
      WHERE task_kind = 'daily_product_followup'
        AND daily_followup_date IS NOT NULL
        AND platform IS NULL
      DO UPDATE SET
        title = EXCLUDED.title,
        product_name = EXCLUDED.product_name,
        assigned_to_name = EXCLUDED.assigned_to_name,
        deadline = EXCLUDED.deadline,
        success_metric = EXCLUDED.success_metric,
        notes = EXCLUDED.notes,
        inventory_snapshot = COALESCE(tasks.inventory_snapshot, EXCLUDED.inventory_snapshot),
        admin_highlighted = tasks.admin_highlighted OR EXCLUDED.admin_highlighted,
        admin_highlight_note_id = COALESCE(tasks.admin_highlight_note_id, EXCLUDED.admin_highlight_note_id),
        admin_highlighted_at = COALESCE(tasks.admin_highlighted_at, EXCLUDED.admin_highlighted_at),
        admin_highlighted_by = COALESCE(tasks.admin_highlighted_by, EXCLUDED.admin_highlighted_by),
        updated_at = NOW()
      RETURNING id
    `, [
      group.inventory_product_id,
      group.assigned_to_id,
      group.product_name,
      group.assigned_to_name,
      group.deadline,
      platformLabels,
      sourceIds,
      group.created_at,
      group.admin_highlighted,
      group.admin_highlight_note_id,
      group.admin_highlighted_at,
      group.admin_highlighted_by,
    ]);

    if (!groupedTask) continue;

    for (const sourceTask of sourceTasks) {
      const [commentRow] = await query<{ comment_text: string | null }>(`
        SELECT NULLIF(
          STRING_AGG(n.note_text, E'\n---\n' ORDER BY n.created_at),
          ''
        ) AS comment_text
        FROM task_notes n
        WHERE n.task_id = $1
          AND n.user_id = $2
      `, [sourceTask.id, group.assigned_to_id]);

      await query(`
        INSERT INTO task_platform_followups (
          task_id,
          platform,
          status,
          comment_text,
          completed_at,
          completed_by_id,
          completed_by_name,
          created_at,
          updated_at
        )
        VALUES (
          $1,$2,
          CASE WHEN $3 = 'completed' THEN 'completed' ELSE 'pending' END,
          $4,
          CASE WHEN $3 = 'completed' THEN $5::timestamptz ELSE NULL END,
          CASE WHEN $3 = 'completed' THEN $6::int ELSE NULL END,
          CASE WHEN $3 = 'completed' THEN $7 ELSE NULL END,
          (SELECT created_at FROM tasks WHERE id = $8),
          NOW()
        )
        ON CONFLICT (task_id, platform)
        DO UPDATE SET
          status = CASE
            WHEN task_platform_followups.status = 'completed' OR EXCLUDED.status = 'completed'
            THEN 'completed'
            ELSE 'pending'
          END,
          comment_text = COALESCE(task_platform_followups.comment_text, EXCLUDED.comment_text),
          completed_at = COALESCE(task_platform_followups.completed_at, EXCLUDED.completed_at),
          completed_by_id = COALESCE(task_platform_followups.completed_by_id, EXCLUDED.completed_by_id),
          completed_by_name = COALESCE(task_platform_followups.completed_by_name, EXCLUDED.completed_by_name),
          updated_at = NOW()
      `, [
        groupedTask.id,
        sourceTask.platform,
        sourceTask.status,
        commentRow?.comment_text ?? null,
        sourceTask.completed_at,
        group.assigned_to_id,
        group.assigned_to_name,
        sourceTask.id,
      ]);

      const label = sourceTask.platform === 'meta' ? 'Meta' : sourceTask.platform === 'google' ? 'Google' : 'TikTok';
      await query(`
        UPDATE task_notes
        SET note_text = CASE
          WHEN note_text LIKE $3 THEN note_text
          ELSE $4 || note_text
        END,
        task_id = $1
        WHERE task_id = $2
      `, [groupedTask.id, sourceTask.id, `[${label}]%`, `[${label}] `]);

      await query(`UPDATE task_media SET task_id = $1 WHERE task_id = $2`, [groupedTask.id, sourceTask.id]);
      await query(`UPDATE task_views SET task_id = $1 WHERE task_id = $2`, [groupedTask.id, sourceTask.id]);
      await query(`
        UPDATE media_buyer_score_deductions
        SET task_id = $1
        WHERE task_id = $2
      `, [groupedTask.id, sourceTask.id]);
    }

    const [progress] = await query<{
      total: string;
      completed: string;
      latest_completed_at: string | null;
    }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
        MAX(completed_at)::text AS latest_completed_at
      FROM task_platform_followups
      WHERE task_id = $1
    `, [groupedTask.id]);

    const totalPlatforms = Number(progress?.total ?? 0);
    const completedPlatforms = Number(progress?.completed ?? 0);
    const allCompleted = totalPlatforms > 0 && totalPlatforms === completedPlatforms;
    const anyCompleted = completedPlatforms > 0;

    await query(`
      UPDATE tasks
      SET
        status = CASE
          WHEN $2 THEN 'completed'
          WHEN deadline < NOW() THEN 'expired'
          WHEN $3 THEN 'in_progress'
          ELSE 'pending'
        END,
        completed_at = CASE WHEN $2 THEN $4::timestamptz ELSE NULL END,
        checkin_count = $5,
        last_checkin_at = CASE WHEN $5 > 0 THEN $4::timestamptz ELSE NULL END,
        updated_at = NOW()
      WHERE id = $1
    `, [
      groupedTask.id,
      allCompleted,
      anyCompleted,
      progress?.latest_completed_at ?? null,
      completedPlatforms,
    ]);

    await query(`DELETE FROM tasks WHERE id = ANY($1::int[])`, [sourceIds]);

    logger.info({
      groupedTaskId: groupedTask.id,
      productId: group.inventory_product_id,
      assignedToId: group.assigned_to_id,
      sourceTaskCount: sourceIds.length,
      completedPlatforms,
      totalPlatforms,
    }, 'Migrated Oct 4 daily tasks into grouped task');
  }

  // Landing Page Generator tables
  await query(`
    CREATE TABLE IF NOT EXISTS shopify_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS shopify_stores (
      id SERIAL PRIMARY KEY,
      domain TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      shop_name TEXT,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS landing_page_records (
      id SERIAL PRIMARY KEY,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_handle TEXT NOT NULL DEFAULT '',
      product_image TEXT NOT NULL DEFAULT '',
      page_url TEXT NOT NULL,
      admin_url TEXT NOT NULL DEFAULT '',
      suffix TEXT NOT NULL DEFAULT '',
      asset_key TEXT NOT NULL DEFAULT '',
      headline TEXT NOT NULL DEFAULT '',
      lp_model TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '',
      html_body TEXT,
      ad_creatives JSONB,
      published_at TIMESTAMPTZ DEFAULT NOW(),
      store_id INTEGER
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS real_reviews_store (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      reviews JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_real_reviews_token ON real_reviews_store (token)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_lp_records_published ON landing_page_records (published_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_lp_records_product ON landing_page_records (product_id)`);

  logger.info("Database migrations complete");
}

// ── Creative cache warmup ──────────────────────────────────────────────────────
function cairoDateOffset(daysBack: number): string {
  return new Date(Date.now() + 2 * 3600000 - daysBack * 86400000).toISOString().slice(0, 10);
}
function cairoToday(): string {
  return new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
}

async function startCreativeCacheWarmer() {
  // Guard: skip if a warmup already ran within the last 60 minutes (prevents
  // hammering Meta API on rapid restarts / deploys).
  try {
    const rows = await query<{ ran_at: string }>(
      `SELECT ran_at FROM cache_warmup_log ORDER BY ran_at DESC LIMIT 1`
    );
    if (rows[0]) {
      const ageMs = Date.now() - new Date(rows[0].ran_at).getTime();
      if (ageMs < 60 * 60 * 1000) {
        logger.info({ age_min: Math.round(ageMs / 60_000) }, "Creative cache warmup skipped — ran recently");
        return;
      }
    }
  } catch {
    // DB not ready yet — proceed anyway
  }

  // Warm only the most critical preset (7d) to cut startup Meta calls in half.
  // The 14d preset is warmed lazily on first user request.
  const presets = [
    { since: cairoDateOffset(6), until: cairoToday() },  // 7d only
  ];
  try {
    const accountIds = getAdAccountIds();
    logger.info({ accounts: accountIds.length, presets: presets.length }, "Starting creative cache warmup");
    // Warm accounts sequentially to avoid rate-limits
    for (const accountId of accountIds) {
      for (const preset of presets) {
        await warmCreativeCache(accountId, preset.since, preset.until);
      }
    }
    // Record this run so rapid restarts skip the warmup
    await query(
      `INSERT INTO cache_warmup_log (ran_at, stats) VALUES (NOW(), '{}') ON CONFLICT DO NOTHING`
    ).catch(() => null);
  } catch (err) {
    logger.warn({ err }, "Creative cache warmer encountered an error");
  }
}

// ── CPA Alert Cron ────────────────────────────────────────────────────────────
// Runs every 2 hours. Sends push to admin + media_buyer when:
//   winner: CPA < 30 EGP (scaling opportunity)
//   warning: CPA > 40 EGP or zero purchases (needs intervention)
// Deduplication: won't re-notify same campaign+type within 6 hours.

const CPA_CRON_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CPA_DEDUP_HOURS = 24;
const CPA_RECIPIENT_ROLES = ["admin", "media_buyer"];

const CPA_ROUTE_CACHE_FRESH_MS = 15 * 60 * 1000; // same as route's CPA_FRESH_MS

async function getCpaAlertsWithCache(accountId: string): Promise<CpaAlertsResult> {
  // Check DB cache first (same table the route uses) — avoid extra Meta calls
  const rows = await query<{ data: string; fetched_at: string }>(
    `SELECT data, fetched_at FROM meta_cpa_alerts_cache WHERE account_id=$1`,
    [accountId]
  );
  const cached = rows[0] ?? null;
  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < CPA_ROUTE_CACHE_FRESH_MS) {
      logger.info({ accountId, age_s: Math.round(age / 1000) }, "CPA cron: serving from DB cache");
      return cached.data as unknown as CpaAlertsResult;
    }
  }
  // Cache is stale or missing — fetch fresh data and store it
  const result = await getCpaAlerts({ adAccountId: accountId });
  await query(
    `INSERT INTO meta_cpa_alerts_cache (account_id, data, fetched_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (account_id) DO UPDATE SET data=$2, fetched_at=NOW()`,
    [accountId, JSON.stringify(result)]
  ).catch(() => null);
  return result;
}

async function runCpaAlertCron() {
  const accountIds = getAdAccountIds();
  if (accountIds.length === 0) {
    logger.info("CPA cron: no ad accounts configured, skipping");
    return;
  }

  for (const accountId of accountIds) {
    try {
      const result = await getCpaAlertsWithCache(accountId);

      // Build list of (campaignId, alertType) that were recently notified
      const recentRows = await query<{ campaign_id: string; alert_type: string }>(`
        SELECT campaign_id, alert_type
        FROM cpa_alert_log
        WHERE account_id = $1
          AND notified_at > NOW() - INTERVAL '${CPA_DEDUP_HOURS} hours'
      `, [accountId]);
      const recentSet = new Set(recentRows.map((r) => `${r.campaign_id}:${r.alert_type}`));

      // Process winners
      for (const w of result.winners) {
        const key = `${w.id}:winner`;
        if (recentSet.has(key)) continue;
        if (w.effective_status && w.effective_status !== "ACTIVE") continue;

        await sendPushForCpaAlert(accountId, CPA_RECIPIENT_ROLES, {
          title: "🚀 حملة جاهزة للتوسع",
          body: `${w.name} — CPA ${w.cpa.toFixed(0)} ج.م (${w.purchases} أوردر) — ضاعف الميزانية الآن`,
          url: "/decisions",
        });
        await sendTelegramAlert(
          `🚀 <b>حملة جاهزة للـ Scale</b>\n` +
          `📌 ${w.name}\n` +
          `💰 CPA: ${w.cpa.toFixed(0)} EGP | طلبات: ${w.purchases}\n` +
          `✅ ضاعف الميزانية الآن`
        );
        await query(
          `INSERT INTO cpa_alert_log (campaign_id, account_id, alert_type, campaign_name, cpa) VALUES ($1,$2,'winner',$3,$4)`,
          [w.id, accountId, w.name, w.cpa]
        );
        logger.info({ campaign: w.name, cpa: w.cpa }, "CPA winner alert sent");
      }

      // Process warnings
      for (const w of result.warnings) {
        const key = `${w.id}:warning`;
        if (recentSet.has(key)) continue;
        if (w.effective_status && w.effective_status !== "ACTIVE") continue;

        const cpaText = w.purchases === 0
          ? `إنفاق ${w.spend.toFixed(0)} ج.م بدون أوردرات`
          : `CPA ${w.cpa.toFixed(0)} ج.م`;
        await sendPushForCpaAlert(accountId, CPA_RECIPIENT_ROLES, {
          title: "⚠️ حملة تحتاج تدخل فوري",
          body: `${w.name} — ${cpaText} — راجع الحملة وقلل الميزانية`,
          url: "/decisions",
        });
        await sendTelegramAlert(
          `⚠️ <b>تحذير — حملة تحتاج تدخل</b>\n` +
          `📌 ${w.name}\n` +
          `💸 ${cpaText}\n` +
          `❌ راجع الحملة وقلل الميزانية فوراً`
        );
        await query(
          `INSERT INTO cpa_alert_log (campaign_id, account_id, alert_type, campaign_name, cpa) VALUES ($1,$2,'warning',$3,$4)`,
          [w.id, accountId, w.name, w.cpa]
        );
        logger.info({ campaign: w.name, cpa: w.cpa }, "CPA warning alert sent");
      }

      logger.info(
        { account: accountId, winners: result.winners.length, warnings: result.warnings.length },
        "CPA cron run complete"
      );
    } catch (err) {
      logger.error({ err, account: accountId }, "CPA cron failed for account");
    }
  }
}

function startCpaAlertCron() {
  // First run: 10 minutes after startup (let scan cron go first)
  setTimeout(() => {
    runCpaAlertCron().catch((err) => logger.error({ err }, "Initial CPA alert cron failed"));
    setInterval(() => {
      runCpaAlertCron().catch((err) => logger.error({ err }, "Scheduled CPA alert cron failed"));
    }, CPA_CRON_INTERVAL_MS);
  }, 10 * 60 * 1000);
  logger.info({ interval_hours: 2 }, "CPA alert cron scheduled");
}

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Proactive Cache Refresh Cron ──────────────────────────────────────────────
// Runs every 60 minutes. Silently refreshes any DB cache entries that are
// >50 min old so user requests always hit the DB instead of calling Meta live.
const REFRESH_CRON_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

async function runProactiveRefreshCron() {
  const { inProgress } = getLastWarmupStats();
  if (inProgress) {
    logger.info("Proactive cache refresh skipped — already in progress");
    return;
  }
  setWarmupInProgress(true);
  const ranAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const stats = await proactiveInsightsRefresh();
    setLastWarmupStats({ ...stats, ran_at: ranAt, duration_ms: Date.now() - t0 });
    if (stats.insights + stats.campaigns + stats.overview + stats.campaign_details + stats.adset_details > 0) {
      logger.info(stats, "Proactive cache refresh complete");
    }
  } catch (err) {
    setWarmupInProgress(false);
    logger.warn({ err }, "Proactive cache refresh failed");
  }
}

function startProactiveRefreshCron() {
  // First run: 3 minutes after startup (after other crons have settled)
  setTimeout(() => {
    runProactiveRefreshCron();
    setInterval(runProactiveRefreshCron, REFRESH_CRON_INTERVAL_MS);
  }, 3 * 60 * 1000);
  logger.info({ interval_min: 30 }, "Proactive cache refresh cron scheduled");
}

// ── Scheduled Reports Cron ────────────────────────────────────────────────────
// Runs every 15 minutes — sends due scheduled redundant-actions CSV reports by email.
const SCHEDULED_REPORTS_CRON_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function startScheduledReportsCron() {
  // First run: 2 minutes after startup
  setTimeout(() => {
    runScheduledReportsCron().catch((err) =>
      logger.error({ err }, "Initial scheduled-reports cron failed")
    );
    setInterval(() => {
      runScheduledReportsCron().catch((err) =>
        logger.error({ err }, "Scheduled-reports cron failed")
      );
    }, SCHEDULED_REPORTS_CRON_INTERVAL_MS);
  }, 2 * 60 * 1000);
  logger.info({ interval_min: 15 }, "Scheduled reports cron started");
}

const INVENTORY_ALERT_CRON_MS = 30 * 60 * 1000; // 30 minutes

function startDailyProductFollowupCron() {
  const run = () => {
    generateDailyProductFollowupTasks().catch((err) =>
      logger.error({ err }, "Daily product follow-up generation failed")
    );
  };

  // Daily follow-ups are generated once at 06:00 Cairo.
  // Assignments created after 06:00 are picked up the next day.
  cron.schedule("0 6 * * *", run, { timezone: "Africa/Cairo" });
  logger.info({
    cadence: "daily",
    time: "06:00",
    timezone: "Africa/Cairo",
    deadline: "21:00",
  }, "Daily product follow-up cron scheduled");
}

function startInventoryAlertCron() {
  // First check: 7 minutes after startup
  setTimeout(() => {
    checkInventoryAlerts().catch((err) =>
      logger.error({ err }, "Initial inventory alert check failed")
    );
    setInterval(() => {
      checkInventoryAlerts().catch((err) =>
        logger.error({ err }, "Inventory alert cron failed")
      );
    }, INVENTORY_ALERT_CRON_MS);
  }, 7 * 60 * 1000);
  logger.info({ interval_min: 30 }, "Inventory alert cron scheduled");
}

function startScanCron() {
  const runScan = () => {
    runMediaScan().catch((err) => logger.error({ err }, "Scheduled media scan failed"));
  };
  // First scan: 5 minutes after startup
  setTimeout(() => {
    logger.info("Running initial media scan");
    runScan();
    // Then every 6 hours
    setInterval(runScan, SCAN_INTERVAL_MS);
  }, 5 * 60 * 1000);
  logger.info({ interval_hours: 6 }, "Media scan cron scheduled");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Token Health Auto-Refresh Cron ────────────────────────────────────────────
// Runs once daily. If the token is still valid but has < 14 days left,
// auto-extends it to a fresh 60-day token. If it's already expired or
// the refresh fails, sends a push notification to admins.

async function runTokenRefreshCron() {
  try {
    const info = getTokenInfo();
    if (info.days_left > 14) {
      logger.info({ days_left: info.days_left }, "Token refresh cron: token healthy, skipping");
      return;
    }
    if (info.days_left <= 0) {
      logger.warn("Token refresh cron: token already expired — manual refresh required");
      await sendPushToRoles(["admin"], {
        title: "⛔ Meta Token منتهي الصلاحية",
        body: "الـ Token انتهى — افتح لوحة الإدارة وأضف Token جديداً من Meta Business",
        url: "/admin",
      }).catch(() => null);
      return;
    }
    logger.info({ days_left: info.days_left }, "Token refresh cron: < 14 days left, auto-refreshing...");
    const refreshed = await refreshLongLivedToken();
    logger.info({ expires_at: refreshed.expires_at }, "Token refresh cron: success");
    await sendPushToRoles(["admin"], {
      title: "✅ Meta Token تم تجديده",
      body: `الـ Token تجدد تلقائياً — صالح حتى ${new Date(refreshed.expires_at).toLocaleDateString("ar-EG")}`,
      url: "/admin",
    }).catch(() => null);
  } catch (err) {
    logger.error({ err }, "Token refresh cron failed");
    await sendPushToRoles(["admin"], {
      title: "⚠️ فشل تجديد Meta Token",
      body: "فشل التجديد التلقائي — افتح لوحة الإدارة وجدّد الـ Token يدوياً",
      url: "/admin",
    }).catch(() => null);
  }
}

function startTokenRefreshCron() {
  // Run once at startup (after a 30s delay) then every 24 hours
  setTimeout(() => {
    runTokenRefreshCron().catch((err) => logger.error({ err }, "Initial token refresh cron failed"));
    setInterval(() => {
      runTokenRefreshCron().catch((err) => logger.error({ err }, "Token refresh cron failed"));
    }, 24 * 60 * 60 * 1000);
  }, 30_000);
  logger.info("Token health cron scheduled (daily)");
}

runMigrations()
  .then(() => initTokenFromDb())
  .then(() => rehydrateWarmupHistory())
  .then(() => initVapid())
  .then(() => {
const server = app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      startScanCron();
      startCpaAlertCron();
      startProactiveRefreshCron();
      startScheduledReportsCron();
      // Pre-warm creative cache in background (don't block server startup)
      startCreativeCacheWarmer();
      startWatchdogCron();
      startInventoryAlertCron();
      startDailyProductFollowupCron();
      startTokenRefreshCron();
    });
    // 180s timeout — AI streaming with multi-tool flows (get_adsets × 15 + get_ads_in_adset × 17+)
    // can exceed 90s. Must be larger than the 120s runAiStream abort signal.
    server.setTimeout(180_000);

    // Graceful shutdown: close HTTP server before exiting so port is freed
    const shutdown = (signal: string) => {
      logger.info({ signal }, "Shutting down gracefully");
      server.close(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
      // Force-exit after 10s if still hanging
      setTimeout(() => { process.exit(1); }, 10_000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT",  () => shutdown("SIGINT"));
  })
  .catch((err) => {
    logger.error({ err }, "Failed to run migrations");
    process.exit(1);
  });
