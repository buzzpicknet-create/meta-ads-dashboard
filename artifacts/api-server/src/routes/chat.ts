import { Router } from "express";
import { query } from "../lib/db";
import { getCampaignDetails } from "../lib/meta-api";
import { logger } from "../lib/logger";
import { getCachedCampaignNames, upsertCampaignNameCache } from "../lib/campaign-name-cache";

const router = Router();

interface ConvRow {
  id: number;
  title: string;
  campaign_id: string | null;
  campaign_name: string | null;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  matching_content?: string | null;
}

function extractSnippet(content: string, queryStr: string, maxLen = 120): string {
  const lc = content.toLowerCase();
  const lcQ = queryStr.toLowerCase();
  const idx = lc.indexOf(lcQ);
  if (idx === -1) {
    const s = content.slice(0, maxLen);
    return s + (content.length > maxLen ? "…" : "");
  }
  const center = idx + Math.floor(queryStr.length / 2);
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, center - half);
  let end = start + maxLen;
  if (end > content.length) {
    end = content.length;
    start = Math.max(0, end - maxLen);
  }
  const snippet = content.slice(start, end);
  return (start > 0 ? "…" : "") + snippet + (end < content.length ? "…" : "");
}

interface MsgRow {
  id: number;
  role: string;
  content: string;
  tool_calls: string[] | null;
  created_at: string;
}

const RESOLVE_CONCURRENCY = 3;
const RESOLVE_TIMEOUT_MS = 2500;
/** Cache entries older than this many days are considered stale and will be re-validated against the Meta API. */
const CACHE_STALE_DAYS = 30;

/**
 * For any conversation rows that have a campaign_id but no campaign_name,
 * resolve the name from the Meta API and persist it to the DB (fire-and-forget).
 * Returns a map of campaign_id → resolved name so the current response can
 * include the name without waiting for the DB write.
 *
 * Capped at RESOLVE_CONCURRENCY simultaneous Meta calls, each with a
 * RESOLVE_TIMEOUT_MS timeout, so a slow or rate-limited Meta API never
 * delays the conversation list response for long.
 *
 * Stale cache entries (older than CACHE_STALE_DAYS) are still returned
 * immediately as a fallback, but a background refresh against the Meta API
 * is also triggered so the cache stays accurate over time.
 */
async function resolveMissingCampaignNames(rows: ConvRow[]): Promise<Map<string, string>> {
  const needsResolution = new Map<string, number[]>();
  for (const row of rows) {
    if (row.campaign_id && !row.campaign_name) {
      const ids = needsResolution.get(row.campaign_id) ?? [];
      ids.push(row.id);
      needsResolution.set(row.campaign_id, ids);
    }
  }

  const resolved = new Map<string, string>();
  if (needsResolution.size === 0) return resolved;

  const campaignIds = [...needsResolution.keys()];

  // ① Check local campaign_name_cache first — works even when Meta API is unavailable
  const cachedNames = await getCachedCampaignNames(campaignIds);

  const staleCutoff = Date.now() - CACHE_STALE_DAYS * 24 * 60 * 60 * 1000;

  // IDs with no cache entry at all — need a Meta API call
  const stillNeeds = new Map<string, number[]>();
  // IDs with a stale cache entry — use stale name now, refresh in background
  const staleEntries = new Map<string, { convIds: number[]; staleName: string }>();

  for (const [campaignId, convIds] of needsResolution) {
    const cached = cachedNames.get(campaignId);
    if (cached) {
      // Always resolve immediately with the cached name (fresh or stale)
      resolved.set(campaignId, cached.name);
      query(
        `UPDATE chat_conversations SET campaign_name = $1 WHERE id = ANY($2::int[]) AND campaign_name IS NULL`,
        [cached.name, convIds]
      ).catch((err) => logger.warn({ err, campaignId }, "chat: failed to persist cached campaign_name"));

      // If stale, queue a background refresh
      if (cached.updatedAt.getTime() < staleCutoff) {
        staleEntries.set(campaignId, { convIds, staleName: cached.name });
      }
    } else {
      stillNeeds.set(campaignId, convIds);
    }
  }

  // ② Refresh stale entries in the background (fire-and-forget — don't await)
  if (staleEntries.size > 0) {
    const staleToRefresh = [...staleEntries.entries()].slice(0, RESOLVE_CONCURRENCY);
    Promise.all(
      staleToRefresh.map(async ([campaignId, { convIds, staleName }]) => {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), RESOLVE_TIMEOUT_MS)
        );
        try {
          const details = await Promise.race([getCampaignDetails(campaignId), timeout]);
          if (!details.name) return;
          if (details.name === staleName) {
            // Name unchanged — bump updated_at to mark the entry as revalidated
            upsertCampaignNameCache([{ id: campaignId, name: staleName }]).catch(() => null);
            return;
          }
          // Name changed — update cache and conversations
          upsertCampaignNameCache([{ id: campaignId, name: details.name }]).catch(() => null);
          query(
            `UPDATE chat_conversations SET campaign_name = $1 WHERE id = ANY($2::int[])`,
            [details.name, convIds]
          ).catch((err) => logger.warn({ err, campaignId }, "chat: failed to refresh stale campaign_name"));
          logger.info({ campaignId, old: staleName, new: details.name }, "chat: refreshed stale campaign name");
        } catch (err) {
          // Transient error (timeout, rate-limit, etc.) — do NOT bump updated_at.
          // The entry stays stale and will be retried on the next conversation list fetch.
          logger.debug({ err, campaignId }, "chat: stale campaign name refresh failed, will retry next fetch");
        }
      })
    ).catch(() => null);
  }

  if (stillNeeds.size === 0) return resolved;

  // ③ Fall back to Meta API for any IDs not found in local cache at all
  const entries = [...stillNeeds.entries()].slice(0, RESOLVE_CONCURRENCY);

  await Promise.all(
    entries.map(async ([campaignId, convIds]) => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), RESOLVE_TIMEOUT_MS)
      );
      try {
        const details = await Promise.race([getCampaignDetails(campaignId), timeout]);
        if (!details.name) return;
        resolved.set(campaignId, details.name);
        // Persist to local cache so future requests don't need to hit Meta API
        upsertCampaignNameCache([{ id: campaignId, name: details.name }]).catch(() => null);
        query(
          `UPDATE chat_conversations SET campaign_name = $1 WHERE id = ANY($2::int[]) AND campaign_name IS NULL`,
          [details.name, convIds]
        ).catch((err) => logger.warn({ err, campaignId }, "chat: failed to persist resolved campaign_name"));
      } catch (err) {
        logger.warn({ err, campaignId }, "chat: could not resolve campaign_name from Meta API");
      }
    })
  );

  return resolved;
}

// GET /api/chat/conversations — list user conversations (optionally filter by campaign_id or search q)
// When global=true is passed with q, searches across ALL campaigns (ignores campaign_id filter)
router.get("/chat/conversations", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const campaignId = String(req.query["campaign_id"] || "").trim() || null;
    const q = String(req.query["q"] || "").trim();
    const global = String(req.query["global"] || "") === "true";

    let rows: ConvRow[];

    if (global && !q) {
      // Global recent: all conversations across all campaigns, pinned first then most-recent
      rows = await query<ConvRow>(
        `SELECT id, title, campaign_id, campaign_name, created_at, updated_at, is_pinned, NULL AS matching_content
         FROM chat_conversations
         WHERE user_id = $1
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT 20`,
        [userId]
      );
    } else if (q && global) {
      // Global search: across all campaigns, returns matching_content for snippet generation
      const pattern = `%${q}%`;
      rows = await query<ConvRow>(
        `SELECT DISTINCT cc.id, cc.title, cc.campaign_id, cc.campaign_name, cc.created_at, cc.updated_at, cc.is_pinned,
           (SELECT cm2.content
            FROM chat_messages cm2
            WHERE cm2.conversation_id = cc.id AND cm2.content ILIKE $2
            ORDER BY cm2.created_at ASC
            LIMIT 1) AS matching_content
         FROM chat_conversations cc
         LEFT JOIN chat_messages cm ON cm.conversation_id = cc.id
         WHERE cc.user_id = $1
           AND (cc.title ILIKE $2 OR cm.content ILIKE $2)
         ORDER BY cc.updated_at DESC
         LIMIT 60`,
        [userId, pattern]
      );
    } else if (q) {
      const pattern = `%${q}%`;
      if (campaignId) {
        rows = await query<ConvRow>(
          `SELECT DISTINCT cc.id, cc.title, cc.campaign_id, cc.campaign_name, cc.created_at, cc.updated_at, cc.is_pinned,
             (SELECT cm2.content
              FROM chat_messages cm2
              WHERE cm2.conversation_id = cc.id AND cm2.content ILIKE $3
              ORDER BY cm2.created_at ASC
              LIMIT 1) AS matching_content
           FROM chat_conversations cc
           LEFT JOIN chat_messages cm ON cm.conversation_id = cc.id
           WHERE cc.user_id = $1 AND cc.campaign_id = $2
             AND (cc.title ILIKE $3 OR cm.content ILIKE $3)
           ORDER BY cc.updated_at DESC
           LIMIT 60`,
          [userId, campaignId, pattern]
        );
      } else {
        rows = await query<ConvRow>(
          `SELECT DISTINCT cc.id, cc.title, cc.campaign_id, cc.campaign_name, cc.created_at, cc.updated_at, cc.is_pinned,
             (SELECT cm2.content
              FROM chat_messages cm2
              WHERE cm2.conversation_id = cc.id AND cm2.content ILIKE $2
              ORDER BY cm2.created_at ASC
              LIMIT 1) AS matching_content
           FROM chat_conversations cc
           LEFT JOIN chat_messages cm ON cm.conversation_id = cc.id
           WHERE cc.user_id = $1 AND cc.campaign_id IS NULL
             AND (cc.title ILIKE $2 OR cm.content ILIKE $2)
           ORDER BY cc.updated_at DESC
           LIMIT 60`,
          [userId, pattern]
        );
      }
    } else if (campaignId) {
      rows = await query<ConvRow>(
        `SELECT id, title, campaign_id, campaign_name, created_at, updated_at, is_pinned, NULL AS matching_content
         FROM chat_conversations
         WHERE user_id = $1 AND campaign_id = $2
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT 60`,
        [userId, campaignId]
      );
    } else {
      rows = await query<ConvRow>(
        `SELECT id, title, campaign_id, campaign_name, created_at, updated_at, is_pinned, NULL AS matching_content
         FROM chat_conversations
         WHERE user_id = $1 AND campaign_id IS NULL
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT 60`,
        [userId]
      );
    }
    const resolvedNames = await resolveMissingCampaignNames(rows);

    const conversations = rows.map((row) => {
      const { matching_content, ...rest } = row;
      const campaign_name = rest.campaign_name ?? (rest.campaign_id ? resolvedNames.get(rest.campaign_id) ?? null : null);
      const base = { ...rest, campaign_name };
      if (!q || matching_content == null) return { ...base, snippet: null };
      return { ...base, snippet: extractSnippet(matching_content, q) };
    });

    res.json({ conversations });
  } catch (err) {
    req.log.error({ err }, "chat/conversations GET error");
    res.status(500).json({ error: "خطأ في جلب المحادثات" });
  }
});

// POST /api/chat/conversations — create new conversation
router.post("/chat/conversations", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const { title, campaign_id, campaign_name } = req.body as { title?: string; campaign_id?: string; campaign_name?: string };
    const rows = await query<ConvRow>(
      `INSERT INTO chat_conversations (user_id, title, campaign_id, campaign_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, campaign_id, campaign_name, created_at, updated_at`,
      [userId, (title ?? "محادثة جديدة").slice(0, 120), campaign_id ?? null, campaign_name ? campaign_name.slice(0, 255) : null]
    );
    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "chat/conversations POST error");
    res.status(500).json({ error: "خطأ في إنشاء المحادثة" });
  }
});

// GET /api/chat/conversations/:id/messages
router.get("/chat/conversations/:id/messages", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const convId = Number(req.params["id"]);
    const owns = await query<{ id: number }>(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [convId, userId]
    );
    if (!owns.length) return res.status(404).json({ error: "المحادثة غير موجودة" });

    const rows = await query<MsgRow>(
      `SELECT id, role, content, tool_calls, created_at
       FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [convId]
    );
    res.json({ messages: rows });
  } catch (err) {
    req.log.error({ err }, "chat/messages GET error");
    res.status(500).json({ error: "خطأ في جلب الرسائل" });
  }
});

// POST /api/chat/conversations/:id/messages — save messages
router.post("/chat/conversations/:id/messages", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const convId = Number(req.params["id"]);
    const { messages } = req.body as { messages: { role: string; content: string; tool_calls?: string[] }[] };

    const owns = await query<{ id: number }>(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [convId, userId]
    );
    if (!owns.length) return res.status(404).json({ error: "المحادثة غير موجودة" });

    for (const msg of messages ?? []) {
      const hasTc = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      if (!msg.role || (!msg.content && !hasTc)) continue;
      const tc = hasTc ? JSON.stringify(msg.tool_calls!) : null;
      await query(
        `INSERT INTO chat_messages (conversation_id, role, content, tool_calls)
         VALUES ($1, $2, $3, $4::json)`,
        [convId, msg.role, msg.content, tc]
      );
    }
    await query(
      `UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`,
      [convId]
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "chat/messages POST error");
    res.status(500).json({ error: "خطأ في حفظ الرسائل" });
  }
});

// PATCH /api/chat/conversations/:id/pin — toggle pin status
router.patch("/chat/conversations/:id/pin", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const convId = Number(req.params["id"]);
    if (!convId || isNaN(convId)) return res.status(400).json({ error: "معرف المحادثة غير صالح" });
    const { pinned } = req.body as { pinned: boolean };
    if (typeof pinned !== "boolean") return res.status(400).json({ error: "pinned مطلوب (boolean)" });
    const updated = await query<{ id: number }>(
      `UPDATE chat_conversations SET is_pinned = $1 WHERE id = $2 AND user_id = $3 RETURNING id`,
      [pinned, convId, userId]
    );
    if (!updated.length) return res.status(404).json({ error: "المحادثة غير موجودة" });
    res.json({ ok: true, pinned });
  } catch (err) {
    req.log.error({ err }, "chat/conversations/:id/pin PATCH error");
    res.status(500).json({ error: "خطأ في تحديث التثبيت" });
  }
});

// PATCH /api/chat/conversations/:id — rename
router.patch("/chat/conversations/:id", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const convId = Number(req.params["id"]);
    const { title } = req.body as { title?: string };
    if (!title) return res.status(400).json({ error: "العنوان مطلوب" });
    await query(
      `UPDATE chat_conversations SET title = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3`,
      [title.slice(0, 120), convId, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "chat/conversations PATCH error");
    res.status(500).json({ error: "خطأ في تعديل المحادثة" });
  }
});

// DELETE /api/chat/conversations/:id
router.delete("/chat/conversations/:id", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const convId = Number(req.params["id"]);
    await query(
      `DELETE FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [convId, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "chat/conversations DELETE error");
    res.status(500).json({ error: "خطأ في حذف المحادثة" });
  }
});

export default router;
