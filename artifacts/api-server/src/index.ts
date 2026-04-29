import app from "./app";
import { logger } from "./lib/logger";
import { query } from "./lib/db";
import { runMediaScan } from "./lib/media-scan";
import { warmCreativeCache } from "./routes/meta";
import { getAdAccountIds } from "./lib/meta-token";
import { initVapid } from "./lib/push";
import bcrypt from "bcryptjs";

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
  // Warm the most common presets: 7d and 14d for each account
  const presets = [
    { since: cairoDateOffset(6), until: cairoToday() },   // 7d
    { since: cairoDateOffset(13), until: cairoToday() },  // 14d
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
  } catch (err) {
    logger.warn({ err }, "Creative cache warmer encountered an error");
  }
}

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

runMigrations()
  .then(() => initVapid())
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      startScanCron();
      // Pre-warm creative cache in background (don't block server startup)
      startCreativeCacheWarmer();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to run migrations");
    process.exit(1);
  });
