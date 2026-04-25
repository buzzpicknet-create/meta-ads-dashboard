import app from "./app";
import { logger } from "./lib/logger";
import { query } from "./lib/db";

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
  logger.info("Database migrations complete");
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
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to run migrations");
    process.exit(1);
  });
