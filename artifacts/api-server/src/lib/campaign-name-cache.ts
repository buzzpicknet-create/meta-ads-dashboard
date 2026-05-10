import { query } from "./db";
import { logger } from "./logger";

/**
 * Upsert one or more campaign_id → name pairs into the local campaign_name_cache.
 * Fire-and-forget: errors are logged but never thrown so callers stay unaffected.
 */
export async function upsertCampaignNameCache(
  entries: { id: string; name: string }[]
): Promise<void> {
  const valid = entries.filter((e) => e.id && e.name);
  if (valid.length === 0) return;

  try {
    const values = valid.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ");
    const params: string[] = valid.flatMap((e) => [e.id, e.name]);
    await query(
      `INSERT INTO campaign_name_cache (campaign_id, campaign_name)
       VALUES ${values}
       ON CONFLICT (campaign_id) DO UPDATE SET campaign_name = EXCLUDED.campaign_name, updated_at = NOW()`,
      params
    );
  } catch (err) {
    logger.warn({ err, count: valid.length }, "campaign_name_cache: upsert failed");
  }
}

/**
 * Look up campaign names from the local cache for a list of campaign IDs.
 * Returns a Map of campaign_id → name for every ID that is cached.
 */
export async function getCachedCampaignNames(
  campaignIds: string[]
): Promise<Map<string, string>> {
  if (campaignIds.length === 0) return new Map();
  try {
    const rows = await query<{ campaign_id: string; campaign_name: string }>(
      `SELECT campaign_id, campaign_name FROM campaign_name_cache WHERE campaign_id = ANY($1::text[])`,
      [campaignIds]
    );
    return new Map(rows.map((r) => [r.campaign_id, r.campaign_name]));
  } catch (err) {
    logger.warn({ err }, "campaign_name_cache: lookup failed");
    return new Map();
  }
}
