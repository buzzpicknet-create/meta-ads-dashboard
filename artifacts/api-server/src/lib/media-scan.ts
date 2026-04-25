import { getAccessToken, getAdAccountIds } from "./meta-token";
import { query } from "./db";
import { logger } from "./logger";

const API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

interface InsightRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  ctr?: string;
  frequency?: string;
  cpm?: string;
  impressions?: string;
}

interface AdRow {
  id: string;
  campaign_id: string;
  creative?: {
    object_url?: string;
    call_to_action?: {
      value?: { link?: string };
    };
  };
}

interface CampaignRow {
  id: string;
  name: string;
  created_time: string;
}

interface FbApiResponse<T> {
  data?: T[];
  paging?: { next?: string };
  error?: { message: string; code: number };
}

async function fbGet<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("access_token", getAccessToken());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const allRows: T[] = [];
  let nextUrl: string | undefined = url.toString();
  let pageCount = 0;

  while (nextUrl && pageCount < 20) {
    const res = await fetch(nextUrl);
    const json = (await res.json()) as FbApiResponse<T>;
    if (json.error) throw new Error(`Meta API (${json.error.code}): ${json.error.message}`);
    if (json.data) allRows.push(...json.data);
    nextUrl = json.paging?.next;
    pageCount++;
  }
  return allRows;
}

function nDaysAgo(n: number): string {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface ScanTriggered {
  campaign_id: string;
  campaign_name: string;
  reasons: string[];
}

export interface ScanResult {
  campaigns_checked: number;
  requests_created: number;
  scanned_at: string;
  triggered: ScanTriggered[];
}

export async function runMediaScan(): Promise<ScanResult> {
  const accountIds = getAdAccountIds();
  const since = nDaysAgo(3);
  const until = nDaysAgo(1);

  // 1. Existing open requests — for deduplication
  const existingRows = await query<{ campaign_id: string | null; campaign_name: string }>(
    `SELECT campaign_id, campaign_name FROM media_requests WHERE status IN ('pending', 'in_progress')`
  );
  const existingCampaignIds = new Set(
    existingRows.map((r) => r.campaign_id).filter((id): id is string => !!id)
  );
  const existingCampaignNames = new Set(
    existingRows.map((r) => r.campaign_name.trim().toLowerCase())
  );

  // 2. Fetch campaign-level insights (daily breakdown, last 3 days)
  const allInsights: InsightRow[] = [];
  for (const accountId of accountIds) {
    try {
      const rows = await fbGet<InsightRow>(`/act_${accountId}/insights`, {
        level: "campaign",
        fields: "campaign_id,campaign_name,ctr,frequency,cpm,impressions",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        filtering: JSON.stringify([
          { field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] },
        ]),
        limit: "500",
      });
      allInsights.push(...rows);
    } catch (err) {
      logger.warn({ err, accountId }, "Failed to fetch insights for account");
    }
  }

  // 3. Group by campaign → sorted daily rows
  const campaignMap = new Map<string, { name: string; days: InsightRow[] }>();
  for (const row of allInsights) {
    if (!row.campaign_id) continue;
    if (!campaignMap.has(row.campaign_id)) {
      campaignMap.set(row.campaign_id, { name: row.campaign_name, days: [] });
    }
    campaignMap.get(row.campaign_id)!.days.push(row);
  }
  for (const [, entry] of campaignMap) {
    entry.days.sort((a, b) => a.date_start.localeCompare(b.date_start));
  }

  // 4. Find "new" campaigns: created 48h–7d ago (completed 48h but still recent)
  const newCampaignIds = new Set<string>();
  const now = Date.now();
  for (const accountId of accountIds) {
    try {
      const rows = await fbGet<CampaignRow>(`/act_${accountId}/campaigns`, {
        fields: "id,name,created_time",
        filtering: JSON.stringify([
          { field: "effective_status", operator: "IN", value: ["ACTIVE"] },
        ]),
        limit: "500",
      });
      for (const c of rows) {
        const hoursOld = (now - new Date(c.created_time).getTime()) / (1000 * 60 * 60);
        if (hoursOld >= 48 && hoursOld <= 7 * 24) {
          newCampaignIds.add(c.id);
        }
      }
    } catch (err) {
      logger.warn({ err, accountId }, "Failed to fetch campaigns for new-campaign rule");
    }
  }

  // 5. Evaluate rules per campaign
  const triggeredCampaigns: ScanTriggered[] = [];

  for (const [campaignId, { name, days }] of campaignMap) {
    if (days.length === 0) continue;

    // Skip if already has open request
    if (
      existingCampaignIds.has(campaignId) ||
      existingCampaignNames.has(name.trim().toLowerCase())
    ) continue;

    const totalImpressions = days.reduce((s, d) => s + Number(d.impressions ?? 0), 0);
    if (totalImpressions < 100) continue; // not enough data

    const avgCtr = days.reduce((s, d) => s + Number(d.ctr ?? 0), 0) / days.length;
    const avgFreq = days.reduce((s, d) => s + Number(d.frequency ?? 0), 0) / days.length;
    const avgCpm = days.reduce((s, d) => s + Number(d.cpm ?? 0), 0) / days.length;

    const reasons: string[] = [];

    // Rule 1: CTR < 2%
    if (avgCtr > 0 && avgCtr < 2) {
      reasons.push(`CTR منخفض ${avgCtr.toFixed(2)}% (أقل من 2%)`);
    }

    // Rule 2: Frequency > 1.5
    if (avgFreq > 1.5) {
      reasons.push(`تكرار التردد مرتفع ${avgFreq.toFixed(2)} (أكثر من 1.5)`);
    }

    // Rule 3: CPM > 75 EGP
    if (avgCpm > 75) {
      reasons.push(`CPM مرتفع ${avgCpm.toFixed(0)} جنيه (أكثر من 75 جنيه)`);
    }

    // Rule 4: CTR declining progressively (requires 3 days of data)
    if (days.length >= 3) {
      const ctrs = days.slice(-3).map((d) => Number(d.ctr ?? 0));
      if (ctrs[0] > ctrs[1] && ctrs[1] > ctrs[2] && ctrs[2] > 0) {
        const trend = ctrs.map((v) => v.toFixed(2) + "%").join(" → ");
        reasons.push(`CTR في انخفاض تدريجي: ${trend}`);
      }
    }

    // Rule 5: New campaign (48h+ old) with any bad metric
    if (newCampaignIds.has(campaignId) && (avgCtr < 2 || avgFreq > 1.5 || avgCpm > 75)) {
      reasons.push("حملة جديدة (48+ ساعة) بمقاييس ضعيفة");
    }

    if (reasons.length > 0) {
      triggeredCampaigns.push({ campaign_id: campaignId, campaign_name: name, reasons });
    }
  }

  // 6. Fetch landing URLs for triggered campaigns
  const landingUrlMap = new Map<string, string>();
  const triggeredIds = triggeredCampaigns.map((c) => c.campaign_id);

  if (triggeredIds.length > 0) {
    for (const accountId of accountIds) {
      try {
        const ads = await fbGet<AdRow>(`/act_${accountId}/ads`, {
          fields: "campaign_id,creative{object_url,call_to_action}",
          filtering: JSON.stringify([
            { field: "effective_status", operator: "IN", value: ["ACTIVE"] },
            { field: "campaign.id", operator: "IN", value: triggeredIds },
          ]),
          limit: "500",
        });
        for (const ad of ads) {
          if (!ad.campaign_id || landingUrlMap.has(ad.campaign_id)) continue;
          const url =
            ad.creative?.call_to_action?.value?.link ?? ad.creative?.object_url ?? null;
          if (url) landingUrlMap.set(ad.campaign_id, url);
        }
      } catch (err) {
        logger.warn({ err, accountId }, "Failed to fetch landing URLs");
      }
    }
  }

  // 7. Create media requests
  let requestsCreated = 0;
  for (const { campaign_id, campaign_name, reasons } of triggeredCampaigns) {
    const landingUrl = landingUrlMap.get(campaign_id) ?? null;
    const notes = `3 ميديا بزوايا مختلفة\n\nالأسباب:\n${reasons.map((r) => `• ${r}`).join("\n")}`;

    try {
      await query(
        `INSERT INTO media_requests (campaign_id, campaign_name, landing_url, priority, notes)
         VALUES ($1, $2, $3, 'high', $4)`,
        [campaign_id, campaign_name, landingUrl, notes]
      );
      requestsCreated++;
      logger.info({ campaign_name, reasons }, "Auto media request created");
    } catch (err) {
      logger.error({ err, campaign_name }, "Failed to insert auto media request");
    }
  }

  // 8. Log the scan
  try {
    await query(
      `INSERT INTO media_scan_log (campaigns_checked, requests_created) VALUES ($1, $2)`,
      [campaignMap.size, requestsCreated]
    );
  } catch (err) {
    logger.warn({ err }, "Failed to write scan log");
  }

  const result: ScanResult = {
    campaigns_checked: campaignMap.size,
    requests_created: requestsCreated,
    scanned_at: new Date().toISOString(),
    triggered: triggeredCampaigns,
  };

  logger.info(
    { campaigns_checked: result.campaigns_checked, requests_created: result.requests_created },
    "Media scan complete"
  );
  return result;
}
