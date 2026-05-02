import { Router } from "express";
import { query } from "../lib/db";

const router = Router();

interface ConvRow {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MsgRow {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

// GET /api/chat/conversations — list user conversations
router.get("/chat/conversations", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const rows = await query<ConvRow>(
      `SELECT id, title, created_at, updated_at
       FROM chat_conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 60`,
      [userId]
    );
    res.json({ conversations: rows });
  } catch (err) {
    req.log.error({ err }, "chat/conversations GET error");
    res.status(500).json({ error: "خطأ في جلب المحادثات" });
  }
});

// POST /api/chat/conversations — create new conversation
router.post("/chat/conversations", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const { title } = req.body as { title?: string };
    const rows = await query<ConvRow>(
      `INSERT INTO chat_conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [userId, (title ?? "محادثة جديدة").slice(0, 120)]
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
      `SELECT id, role, content, created_at
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
    const { messages } = req.body as { messages: { role: string; content: string }[] };

    const owns = await query<{ id: number }>(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [convId, userId]
    );
    if (!owns.length) return res.status(404).json({ error: "المحادثة غير موجودة" });

    for (const msg of messages ?? []) {
      if (!msg.role || !msg.content) continue;
      await query(
        `INSERT INTO chat_messages (conversation_id, role, content)
         VALUES ($1, $2, $3)`,
        [convId, msg.role, msg.content]
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
