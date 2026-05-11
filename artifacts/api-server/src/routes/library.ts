import { Router } from "express";
import { query } from "../lib/db";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

// ── DB bootstrap ───────────────────────────────────────────────────────────────
async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS lib_products (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS lib_angles (
      id         SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES lib_products(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS lib_assets (
      id         SERIAL PRIMARY KEY,
      angle_id   INTEGER NOT NULL REFERENCES lib_angles(id) ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK (type IN ('LANDING_PAGE','PRIMARY_TEXT','HEADLINE','DRIVE_LINK')),
      content    TEXT NOT NULL,
      title      TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS lib_prompt_history (
      id               SERIAL PRIMARY KEY,
      product_id       INTEGER REFERENCES lib_products(id) ON DELETE SET NULL,
      product_name     TEXT NOT NULL,
      angle_name       TEXT NOT NULL,
      generated_prompt TEXT NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT now()
    )
  `);
}

ensureTables().catch((err) => {
  console.error("library: ensureTables failed", err);
});

// ── Products ──────────────────────────────────────────────────────────────────

router.get("/library/products", async (_req, res) => {
  try {
    const rows = await query<{ id: number; name: string; created_at: string }>(
      `SELECT id, name, created_at FROM lib_products ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/library/products", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) return res.status(400).json({ error: "اسم المنتج مطلوب" });
  try {
    const rows = await query<{ id: number; name: string; created_at: string }>(
      `INSERT INTO lib_products (name) VALUES ($1) RETURNING id, name, created_at`,
      [name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/library/products/:id", async (req, res) => {
  try {
    await query(`DELETE FROM lib_products WHERE id = $1`, [req.params["id"]]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Angles ────────────────────────────────────────────────────────────────────

router.get("/library/products/:productId/angles", async (req, res) => {
  try {
    const rows = await query<{ id: number; name: string; product_id: number; created_at: string }>(
      `SELECT id, name, product_id, created_at FROM lib_angles WHERE product_id = $1 ORDER BY created_at ASC`,
      [req.params["productId"]]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/library/products/:productId/angles", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) return res.status(400).json({ error: "اسم الزاوية مطلوب" });
  try {
    const rows = await query<{ id: number; name: string; product_id: number; created_at: string }>(
      `INSERT INTO lib_angles (product_id, name) VALUES ($1, $2) RETURNING id, name, product_id, created_at`,
      [req.params["productId"], name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/library/angles/:id", async (req, res) => {
  try {
    await query(`DELETE FROM lib_angles WHERE id = $1`, [req.params["id"]]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Assets ────────────────────────────────────────────────────────────────────

router.get("/library/angles/:angleId/assets", async (req, res) => {
  try {
    const rows = await query<{ id: number; angle_id: number; type: string; content: string; title: string | null; created_at: string }>(
      `SELECT id, angle_id, type, content, title, created_at FROM lib_assets WHERE angle_id = $1 ORDER BY type, created_at ASC`,
      [req.params["angleId"]]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/library/angles/:angleId/assets", async (req, res) => {
  const { type, content, title } = req.body as { type?: string; content?: string; title?: string };
  const validTypes = ["LANDING_PAGE", "PRIMARY_TEXT", "HEADLINE", "DRIVE_LINK"];
  if (!type || !validTypes.includes(type)) return res.status(400).json({ error: "نوع الأصل غير صالح" });
  if (!content?.trim()) return res.status(400).json({ error: "محتوى الأصل مطلوب" });
  try {
    const rows = await query<{ id: number; angle_id: number; type: string; content: string; title: string | null; created_at: string }>(
      `INSERT INTO lib_assets (angle_id, type, content, title) VALUES ($1, $2, $3, $4) RETURNING id, angle_id, type, content, title, created_at`,
      [req.params["angleId"], type, content.trim(), title?.trim() ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/library/assets/:id", async (req, res) => {
  try {
    await query(`DELETE FROM lib_assets WHERE id = $1`, [req.params["id"]]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── AI Content Generation ──────────────────────────────────────────────────────

router.post("/library/angles/:angleId/generate-content", async (req, res) => {
  const { productName, angleName, landingPageUrls } = req.body as {
    productName?: string;
    angleName?: string;
    landingPageUrls?: string[];
  };

  if (!angleName || !landingPageUrls?.length) {
    return res.status(400).json({ error: "اسم الزاوية وروابط اللاندينج مطلوبة" });
  }

  const urlList = landingPageUrls.slice(0, 3).join("، ");

  const systemPrompt = `أنت خبير كتابة إعلانات Meta Ads محترف متخصص في اللهجة المصرية العامية.
أسلوبك: عاطفي، حياتي، يخلق Empathy مع الجمهور، يبدأ بـ Hook قوي يصف مشكلة أو موقف يعيشه العميل.

قواعد الأسلوب الإلزامية:
- ابدأ كل نص بـ Hook حياتي يصف لحظة أو مشاعر العميل (مثال: "بترجع من الشغل آخر اليوم… دماغك لسه شغالة ألف فكرة؟ 🤯")
- استخدم إيموجي بشكل طبيعي (2-4 إيموجي لكل نص)
- استخدم ✅ لقائمة 3-4 مميزات محددة
- اختم بـ CTA قوي مع "الدفع عند الاستلام"
- اللهجة: عربي مصري عامي بسيط ومفهوم
- طول النص: 80-150 كلمة فعلية
- العناوين: 4-7 كلمات فقط، جذابة ومباشرة

مهم جداً: يجب أن تولّد المحتوى بناءً على اسم المنتج والزاوية التسويقية المذكورة — لا تنتظر محتوى خارجياً.`;

  const userPrompt = `المنتج: ${productName ?? "منتج"}
الزاوية التسويقية: ${angleName}
رابط اللاندينج (للإشارة فقط): ${urlList}

ولّد الآن بناءً على الزاوية التسويقية "${angleName}" للمنتج "${productName ?? "المنتج"}":
1. أربعة (4) نصوص إعلانية كاملة مختلفة الـ Hook — كل نص يبدأ بـ Hook مختلف
2. ستة (6) عناوين قصيرة مختلفة (لا تتجاوز 7 كلمات لكل عنوان)

أعد JSON بهذا الشكل الدقيق فقط، بدون أي نص خارج الـ JSON:
{"texts":[{"title":"hook_1","content":"نص كامل هنا"},{"title":"hook_2","content":"نص كامل هنا"},{"title":"hook_3","content":"نص كامل هنا"},{"title":"hook_4","content":"نص كامل هنا"}],"headlines":[{"content":"عنوان 1"},{"content":"عنوان 2"},{"content":"عنوان 3"},{"content":"عنوان 4"},{"content":"عنوان 5"},{"content":"عنوان 6"}]}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_completion_tokens: 3000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { texts?: { title?: string; content?: string }[]; headlines?: { content?: string }[] };
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const texts    = (parsed.texts    ?? []).filter(t => t.content?.trim());
    const headlines = (parsed.headlines ?? []).filter(h => h.content?.trim());

    // Save all generated items as assets in DB
    const angleId = req.params["angleId"];
    for (const t of texts) {
      await query(
        `INSERT INTO lib_assets (angle_id, type, content, title) VALUES ($1, 'PRIMARY_TEXT', $2, $3)`,
        [angleId, t.content!.trim(), t.title?.trim() ?? "AI ✨"]
      );
    }
    for (const h of headlines) {
      await query(
        `INSERT INTO lib_assets (angle_id, type, content, title) VALUES ($1, 'HEADLINE', $2, $3)`,
        [angleId, h.content!.trim(), "AI ✨"]
      );
    }

    res.json({ texts, headlines });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Prompt History ─────────────────────────────────────────────────────────────

router.get("/library/history", async (req, res) => {
  const productId = req.query["productId"] ? Number(req.query["productId"]) : null;
  try {
    const rows = await query<{ id: number; product_id: number | null; product_name: string; angle_name: string; generated_prompt: string; created_at: string }>(
      `SELECT id, product_id, product_name, angle_name, generated_prompt, created_at
       FROM lib_prompt_history
       ${productId ? "WHERE product_id = $1" : ""}
       ORDER BY created_at DESC
       LIMIT 100`,
      productId ? [productId] : []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/library/history", async (req, res) => {
  const { product_id, product_name, angle_name, generated_prompt } = req.body as {
    product_id?: number;
    product_name?: string;
    angle_name?: string;
    generated_prompt?: string;
  };
  if (!product_name || !angle_name || !generated_prompt) {
    return res.status(400).json({ error: "بيانات ناقصة" });
  }
  try {
    const rows = await query<{ id: number; created_at: string }>(
      `INSERT INTO lib_prompt_history (product_id, product_name, angle_name, generated_prompt)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [product_id ?? null, product_name, angle_name, generated_prompt]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
