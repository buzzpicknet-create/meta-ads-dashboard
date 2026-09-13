import { Router, type Request, type Response } from "express";
import { query } from "../lib/db";

const router = Router();

function botToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

async function telegramFilePath(fileId: string): Promise<string | null> {
  const token = botToken();
  if (!token) return null;
  const response = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json() as any;
  return response.ok && data?.ok ? String(data.result?.file_path || "") || null : null;
}

async function ensureBridge() {
  await query(`
    CREATE OR REPLACE FUNCTION attach_hunting_media_to_task() RETURNS trigger AS $$
    BEGIN
      INSERT INTO task_media (task_id, original_name, file_path, mime_type, is_primary)
      WITH matched_product AS (
        SELECT p.*
        FROM product_hunting_items p
        WHERE p.source_type = 'telegram_bot'
          AND p.source_url IS NOT NULL
          AND POSITION(p.source_url IN COALESCE(NEW.notes, '')) > 0
        ORDER BY p.id DESC
        LIMIT 1
      ), media_rows AS (
        SELECT m.value AS media, m.ordinality AS ord
        FROM matched_product p,
             LATERAL jsonb_array_elements(COALESCE(p.media, '[]'::jsonb)) WITH ORDINALITY AS m(value, ordinality)
        WHERE COALESCE(m.value->>'url','') LIKE '/api/telegram-product-bot/media/%'
      )
      SELECT NEW.id,
             'product-hunting-' || ord || CASE WHEN media->>'type' = 'video' THEN '.mp4' ELSE '.jpg' END,
             '/objects/telegram-product/' || regexp_replace(media->>'url', '^.*/media/', ''),
             CASE WHEN media->>'type' = 'video' THEN 'video/mp4' ELSE 'image/jpeg' END,
             ord = 1
      FROM media_rows
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await query(`DROP TRIGGER IF EXISTS trg_attach_hunting_media_to_task ON tasks`);
  await query(`
    CREATE TRIGGER trg_attach_hunting_media_to_task
    AFTER INSERT ON tasks
    FOR EACH ROW EXECUTE FUNCTION attach_hunting_media_to_task()
  `);

  await query(`
    INSERT INTO task_media (task_id, original_name, file_path, mime_type, is_primary)
    SELECT t.id,
           'product-hunting-' || m.ordinality || CASE WHEN m.value->>'type' = 'video' THEN '.mp4' ELSE '.jpg' END,
           '/objects/telegram-product/' || regexp_replace(m.value->>'url', '^.*/media/', ''),
           CASE WHEN m.value->>'type' = 'video' THEN 'video/mp4' ELSE 'image/jpeg' END,
           m.ordinality = 1
    FROM tasks t
    JOIN LATERAL (
      SELECT p.* FROM product_hunting_items p
      WHERE p.source_type = 'telegram_bot'
        AND p.source_url IS NOT NULL
        AND POSITION(p.source_url IN COALESCE(t.notes, '')) > 0
      ORDER BY p.id DESC LIMIT 1
    ) p ON TRUE
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.media, '[]'::jsonb)) WITH ORDINALITY AS m(value, ordinality)
    WHERE t.created_at >= NOW() - INTERVAL '24 hours'
      AND COALESCE(m.value->>'url','') LIKE '/api/telegram-product-bot/media/%'
      AND NOT EXISTS (SELECT 1 FROM task_media tm WHERE tm.task_id = t.id)
  `);
}

ensureBridge().catch(err => console.error("product hunting task media bridge init error", err));

router.get("/storage/objects/telegram-product/:fileId", async (req: Request, res: Response) => {
  try {
    const fileId = decodeURIComponent(String(req.params.fileId || ""));
    if (!fileId || !botToken()) return res.status(404).end();
    const filePath = await telegramFilePath(fileId);
    if (!filePath) return res.status(404).end();

    const headers: Record<string, string> = {};
    if (req.headers.range) headers.range = String(req.headers.range);
    const upstream = await fetch(`https://api.telegram.org/file/bot${botToken()}/${filePath}`, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).end();

    res.status(upstream.status);
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    res.setHeader("cache-control", "private, max-age=3600");
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.send(bytes);
  } catch (error) {
    console.error("product hunting task media proxy error", error);
    res.status(502).end();
  }
});

export default router;
