import { Router } from "express";
import { query } from "../lib/db";

const router = Router();

interface ConvRow {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
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

// GET /api/chat/conversations — list user conversations (optionally filter by campaign_id or search q)
router.get("/chat/conversations", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const campaignId = String(req.query["campaign_id"] || "").trim() || null;
    const q = String(req.query["q"] || "").trim();

    let rows: ConvRow[];

    if (q) {
      const pattern = `%${q}%`;
      if (campaignId) {
        rows = await query<ConvRow>(
          `SELECT DISTINCT cc.id, cc.title, cc.created_at, cc.updated_at,
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
          `SELECT DISTINCT cc.id, cc.title, cc.created_at, cc.updated_at,
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
        `SELECT id, title, created_at, updated_at
         FROM chat_conversations
         WHERE user_id = $1 AND campaign_id = $2
         ORDER BY updated_at DESC
         LIMIT 60`,
        [userId, campaignId]
      );
    } else {
      rows = await query<ConvRow>(
        `SELECT id, title, created_at, updated_at
         FROM chat_conversations
         WHERE user_id = $1 AND campaign_id IS NULL
         ORDER BY updated_at DESC
         LIMIT 60`,
        [userId]
      );
    }
    const conversations = rows.map((row) => {
      const { matching_content, ...rest } = row;
      if (!q || matching_content == null) return { ...rest, snippet: null };
      return { ...rest, snippet: extractSnippet(matching_content, q) };
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
    const { title, campaign_id } = req.body as { title?: string; campaign_id?: string };
    const rows = await query<ConvRow>(
      `INSERT INTO chat_conversations (user_id, title, campaign_id)
       VALUES ($1, $2, $3)
       RETURNING id, title, created_at, updated_at`,
      [userId, (title ?? "محادثة جديدة").slice(0, 120), campaign_id ?? null]
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
      const tc = hasTc ? msg.tool_calls! : null;
      await query(
        `INSERT INTO chat_messages (conversation_id, role, content, tool_calls)
         VALUES ($1, $2, $3, $4)`,
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
