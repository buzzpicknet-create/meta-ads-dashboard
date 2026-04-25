import app from "./app";
import { logger } from "./lib/logger";
import { query } from "./lib/db";
import { runMediaScan } from "./lib/media-scan";

async function runMigrations() {
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
  logger.info("Database migrations complete");
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
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      startScanCron();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to run migrations");
    process.exit(1);
  });
