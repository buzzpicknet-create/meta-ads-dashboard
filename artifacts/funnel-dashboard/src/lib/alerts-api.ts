const BASE = "";

export interface AlertSnapshotInput {
  alertKey: string;
  alertType: string;
  severity: "danger" | "warn";
  metricValue?: number;
  metricLabel?: string;
  campaignId?: string;
  campaignName?: string;
}

export interface AlertAction {
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
  // joined from snapshot
  snap_alert_type?: string;
  snap_severity?: string;
  snap_metric_label?: string;
  snap_campaign_name?: string;
  snap_detected_at?: string;
  snap_is_resolved?: boolean;
}

export interface AlertSnapshot {
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
  actions: AlertAction[];
  action_count?: string;
}

export interface ActivityData {
  actions: AlertAction[];
  unresolved: AlertSnapshot[];
}

export async function snapshotAlerts(
  accountId: string,
  alerts: AlertSnapshotInput[]
): Promise<void> {
  await fetch(`${BASE}/api/alerts/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, alerts }),
  });
}

export async function logAction(params: {
  accountId: string;
  alertKey: string;
  snapshotId?: number;
  actionType: string;
  actionNote: string;
  metricBefore?: number;
  actionedBy?: string;
}): Promise<AlertAction> {
  const res = await fetch(`${BASE}/api/alerts/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json() as Promise<AlertAction>;
}

export async function fetchActivity(
  accountId: string,
  days = 14
): Promise<ActivityData> {
  const res = await fetch(`${BASE}/api/alerts/activity?accountId=${accountId}&days=${days}`);
  return res.json() as Promise<ActivityData>;
}

export async function fetchHistory(
  accountId: string,
  days = 30
): Promise<{ snapshots: AlertSnapshot[]; actions: AlertAction[] }> {
  const res = await fetch(`${BASE}/api/alerts/history?accountId=${accountId}&days=${days}`);
  return res.json() as Promise<{ snapshots: AlertSnapshot[]; actions: AlertAction[] }>;
}
