import { query } from "./db";
import { logger } from "./logger";

// ── In-memory cache ────────────────────────────────────────────────────────
// Fast O(1) campaign_id → name lookup without a DB round-trip.
// Populated automatically whenever campaigns are fetched (write-through).
// TTL: 15 minutes — stale entries evicted lazily on read.
const MEM_TTL_MS = 15 * 60 * 1000;

interface MemEntry {
  name: string;
  ts: number;
}

const _memCache = new Map<string, MemEntry>();

/** Store names in the in-memory cache. */
function memSet(entries: { id: string; name: string }[]): void {
  const ts = Date.now();
  for (const e of entries) {
    if (e.id && e.name) _memCache.set(e.id, { name: e.name, ts });
  }
}

/** Look up a campaign name from the in-memory cache. Returns null if missing or expired. */
export function memGetCampaignName(campaignId: string): string | null {
  const entry = _memCache.get(campaignId);
  if (!entry) return null;
  if (Date.now() - entry.ts > MEM_TTL_MS) {
    _memCache.delete(campaignId);
    return null;
  }
  return entry.name;
}

/** Return the current in-memory cache size (for diagnostics). */
export function memCacheSize(): number {
  return _memCache.size;
}

/**
 * Upsert one or more campaign_id → name pairs into the local campaign_name_cache.
 * Also updates the in-memory cache immediately.
 * Fire-and-forget: errors are logged but never thrown so callers stay unaffected.
 */
export async function upsertCampaignNameCache(
  entries: { id: string; name: string }[]
): Promise<void> {
  const valid = entries.filter((e) => e.id && e.name);
  if (valid.length === 0) return;

  // Update in-memory cache immediately (synchronous, zero latency)
  memSet(valid);

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

export interface CachedCampaignEntry {
  name: string;
  updatedAt: Date;
}

/**
 * Look up campaign names for a list of campaign IDs.
 * Checks in-memory cache first (zero latency); falls back to DB for misses.
 */
export async function getCachedCampaignNames(
  campaignIds: string[]
): Promise<Map<string, CachedCampaignEntry>> {
  if (campaignIds.length === 0) return new Map();

  const result = new Map<string, CachedCampaignEntry>();
  const dbMisses: string[] = [];

  // Phase 1: serve from in-memory cache (no DB round-trip)
  for (const id of campaignIds) {
    const name = memGetCampaignName(id);
    if (name !== null) {
      result.set(id, { name, updatedAt: new Date() });
    } else {
      dbMisses.push(id);
    }
  }

  if (dbMisses.length === 0) return result;

  // Phase 2: DB lookup for cache misses only
  try {
    const rows = await query<{ campaign_id: string; campaign_name: string; updated_at: string }>(
      `SELECT campaign_id, campaign_name, updated_at FROM campaign_name_cache WHERE campaign_id = ANY($1::text[])`,
      [dbMisses]
    );
    for (const r of rows) {
      result.set(r.campaign_id, { name: r.campaign_name, updatedAt: new Date(r.updated_at) });
      // Backfill in-memory cache from DB hit
      _memCache.set(r.campaign_id, { name: r.campaign_name, ts: Date.now() });
    }
  } catch (err) {
    logger.warn({ err }, "campaign_name_cache: lookup failed");
  }

  return result;
}
