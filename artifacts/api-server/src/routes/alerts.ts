import { Router } from "express";
import { query } from "../lib/db";

const router = Router();

// ── Types ─────────────────────────────────────────────────────
interface AlertSnapshot {
  id: number;
  account_id: string;
  alert_key: string;
  alert_type: string;
  severity: string;
  metric_value: number | null;
  metric_label: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  detected_at: string;
  resolved_at: string | null;
  is_resolved: boolean;
  created_at: string;
}

interface AlertAction {
  id: number;
  snapshot_id: number | null;
  account_id: string;
  alert_key: string;
  action_type: string;
  action_note: string;
  metric_before: number | null;
  metric_after: number | null;
  actioned_by: string;
  actioned_at: string;
  follow_up_at: string | null;
  outcome: string | null;
}

// ── POST /api/alerts/snapshot ─────────────────────────────────
// Called by frontend to record current alerts for an account
router.post("/alerts/snapshot", async (req, res) => {
  const { accountId, alerts } = req.body as {
    accountId: string;
    alerts: {
      alertKey: string;
      alertType: string;
      severity: string;
      metricValue?: number;
      metricLabel?: string;
      campaignId?: string;
      campaignName?: string;
    }[];
  };

  if (!accountId || !Array.isArray(alerts)) {
    return res.status(400).json({ error: "accountId and alerts[] required" });
  }

  try {
    const inserted: AlertSnapshot[] = [];

    for (const alert of alerts) {
      // Check if this exact alert was already recorded in the last 6 hours
      const existing = await query<AlertSnapshot>(
        `SELECT id FROM alert_snapshots
         WHERE account_id = $1 AND alert_key = $2
           AND detected_at > NOW() - INTERVAL '6 hours'
           AND is_resolved = FALSE
         LIMIT 1`,
        [accountId, alert.alertKey]
      );

      if (existing.length === 0) {
        const rows = await query<AlertSnapshot>(
          `INSERT INTO alert_snapshots
             (account_id, alert_key, alert_type, severity, metric_value, metric_label, campaign_id, campaign_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [
            accountId,
            alert.alertKey,
            alert.alertType,
            alert.severity,
            alert.metricValue ?? null,
            alert.metricLabel ?? null,
            alert.campaignId ?? null,
            alert.campaignName ?? null,
          ]
        );
        if (rows[0]) inserted.push(rows[0]);
      }
    }

    // Auto-resolve alerts that are no longer active
    const activeKeys = alerts.map((a) => a.alertKey);
    if (activeKeys.length > 0) {
      await query(
        `UPDATE alert_snapshots
         SET is_resolved = TRUE, resolved_at = NOW()
         WHERE account_id = $1
           AND is_resolved = FALSE
           AND alert_key NOT IN (${activeKeys.map((_, i) => `$${i + 2}`).join(",")})
           AND detected_at > NOW() - INTERVAL '7 days'`,
        [accountId, ...activeKeys]
      );
    } else {
      // No active alerts → resolve all
      await query(
        `UPDATE alert_snapshots
         SET is_resolved = TRUE, resolved_at = NOW()
         WHERE account_id = $1 AND is_resolved = FALSE`,
        [accountId]
      );
    }

    return res.json({ inserted: inserted.length, total: alerts.length });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/alerts/action ───────────────────────────────────
// Log a manual action taken on an alert
router.post("/alerts/action", async (req, res) => {
  const {
    accountId,
    alertKey,
    snapshotId,
    actionType,
    actionNote,
    metricBefore,
    actionedBy,
  } = req.body as {
    accountId: string;
    alertKey: string;
    snapshotId?: number;
    actionType: string;
    actionNote: string;
    metricBefore?: number;
    actionedBy?: string;
  };

  if (!accountId || !alertKey || !actionType || !actionNote) {
    return res.status(400).json({ error: "accountId, alertKey, actionType, actionNote required" });
  }

  try {
    const followUpAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const rows = await query<AlertAction>(
      `INSERT INTO alert_actions
         (snapshot_id, account_id, alert_key, action_type, action_note, metric_before, actioned_by, follow_up_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        snapshotId ?? null,
        accountId,
        alertKey,
        actionType,
        actionNote,
        metricBefore ?? null,
        actionedBy ?? "الميدياباير",
        followUpAt,
      ]
    );

    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/alerts/history ───────────────────────────────────
// Get alert history with actions for an account
router.get("/alerts/history", async (req, res) => {
  const { accountId, days = "30" } = req.query as { accountId?: string; days?: string };

  if (!accountId) return res.status(400).json({ error: "accountId required" });

  try {
    const snapshots = await query<AlertSnapshot & { actions: AlertAction[] }>(
      `SELECT s.*
       FROM alert_snapshots s
       WHERE s.account_id = $1
         AND s.detected_at > NOW() - INTERVAL '${parseInt(days)} days'
       ORDER BY s.detected_at DESC
       LIMIT 200`,
      [accountId]
    );

    const actions = await query<AlertAction>(
      `SELECT a.*
       FROM alert_actions a
       WHERE a.account_id = $1
         AND a.actioned_at > NOW() - INTERVAL '${parseInt(days)} days'
       ORDER BY a.actioned_at DESC
       LIMIT 200`,
      [accountId]
    );

    // Map actions to snapshots
    const actionsByKey = new Map<string, AlertAction[]>();
    for (const action of actions) {
      const existing = actionsByKey.get(action.alert_key) ?? [];
      existing.push(action);
      actionsByKey.set(action.alert_key, existing);
    }

    const result = snapshots.map((s) => ({
      ...s,
      actions: actionsByKey.get(s.alert_key)?.filter(
        (a) => new Date(a.actioned_at) >= new Date(s.detected_at)
      ) ?? [],
    }));

    return res.json({ snapshots: result, actions });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/alerts/activity ──────────────────────────────────
// Team activity feed — actions taken in the last N days
router.get("/alerts/activity", async (req, res) => {
  const { accountId, days = "14" } = req.query as { accountId?: string; days?: string };

  if (!accountId) return res.status(400).json({ error: "accountId required" });

  try {
    const actions = await query<AlertAction & { snapshot: AlertSnapshot | null }>(
      `SELECT a.*, 
              s.alert_type   AS snap_alert_type,
              s.severity     AS snap_severity,
              s.metric_label AS snap_metric_label,
              s.campaign_name AS snap_campaign_name,
              s.detected_at  AS snap_detected_at,
              s.is_resolved  AS snap_is_resolved
       FROM alert_actions a
       LEFT JOIN alert_snapshots s ON s.id = a.snapshot_id
       WHERE a.account_id = $1
         AND a.actioned_at > NOW() - INTERVAL '${parseInt(days)} days'
       ORDER BY a.actioned_at DESC
       LIMIT 100`,
      [accountId]
    );

    // Unresolved alerts (no action in last 48h)
    const unresolved = await query<AlertSnapshot>(
      `SELECT s.*,
              (SELECT COUNT(*) FROM alert_actions a 
               WHERE a.alert_key = s.alert_key AND a.account_id = s.account_id
                 AND a.actioned_at > s.detected_at) AS action_count
       FROM alert_snapshots s
       WHERE s.account_id = $1
         AND s.is_resolved = FALSE
         AND s.detected_at > NOW() - INTERVAL '7 days'
       ORDER BY s.severity DESC, s.detected_at ASC`,
      [accountId]
    );

    return res.json({ actions, unresolved });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/alerts/outcome ─────────────────────────────────
// Update outcome of an action after follow-up check
router.patch("/alerts/outcome", async (req, res) => {
  const { actionId, metricAfter, outcome } = req.body as {
    actionId: number;
    metricAfter: number;
    outcome: "improved" | "no-change" | "worsened";
  };

  try {
    const rows = await query<AlertAction>(
      `UPDATE alert_actions
       SET metric_after = $2, outcome = $3
       WHERE id = $1
       RETURNING *`,
      [actionId, metricAfter, outcome]
    );
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
