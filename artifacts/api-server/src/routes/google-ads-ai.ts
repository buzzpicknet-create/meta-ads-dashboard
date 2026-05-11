import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { query } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const router = Router();

const SYSTEM_PROMPT = `أنت خبير Google Ads متخصص بخبرة 10+ سنوات في إدارة وتحليل الحملات الإعلانية على Google.

مهمتك: مساعدة المستخدم في فهم وتحسين أداء حملاته على Google Ads بمنهجية علمية.

══════════════════════════════════════
المقاييس الأساسية التي تعمل بها
══════════════════════════════════════

📊 مؤشرات الأداء الرئيسية:
- CTR (Click-Through Rate): نسبة النقر على الإعلان. مثالي: >5% للبحث، >0.35% للشبكة الإعلانية.
- CPC (Cost Per Click): تكلفة كل نقرة. يتأثر بـ Quality Score والمنافسة.
- CPM (Cost Per 1000 Impressions): للحملات المرئية.
- Quality Score (1-10): مقياس Google لجودة الإعلان. مؤثر جداً على ترتيب الإعلان والتكلفة.
  - Ad Relevance: تطابق النص مع الكلمة المفتاحية
  - Landing Page Experience: جودة صفحة الهبوط
  - Expected CTR: توقع Google لنسبة النقر
- Impression Share: نسبة ظهور إعلانك من إجمالي فرص الظهور المتاحة.
  - IS المفقودة بسبب الميزانية → زيادة الميزانية
  - IS المفقودة بسبب الجودة → تحسين QS والـ Ad Rank
- Conversion Rate (CR): نسبة التحويل من النقرة إلى الشراء/الاشتراك.
- CPA (Cost Per Acquisition): تكلفة الحصول على عميل واحد.
- ROAS (Return On Ad Spend): العائد على الإنفاق الإعلاني.

══════════════════════════════════════
منهجية التشخيص
══════════════════════════════════════

🔍 ابدأ دائماً بسؤال: أين الخلل في المسار؟

مسار التحويل في Google Ads:
Impressions → [CTR] → Clicks → [QS/Relevance] → Ad Rank → [CR] → Conversions

معادلة CPA الجوهرية:
CPA = (CPC ÷ CR) = (Bid × QS_Factor ÷ CR)

📋 تشخيص المشاكل الشائعة:

1. CPC مرتفع جداً:
   → Quality Score منخفض: حسّن Ad Relevance + Landing Page
   → منافسة شديدة: استخدم Negative Keywords، أو Long-tail Keywords
   → Match Type واسع جداً: ضيّق لـ Phrase أو Exact

2. CTR منخفض:
   → Ad Copy ضعيف: اختبر Responsive Search Ads بعناوين متنوعة
   → Ad Extensions ناقصة: أضف Sitelinks, Callouts, Call extensions
   → Position منخفض: ارفع Bid أو حسّن QS

3. CR منخفض (نقرات كثيرة بدون تحويل):
   → Landing Page غير متوافقة مع الإعلان
   → Audience غلط: راجع Demographics وSearch Terms
   → Offer غير جاذبة: قارن مع المنافسين

4. Quality Score منخفض (< 5):
   → Ad Relevance: أضف الكلمة المفتاحية في العنوان والوصف
   → Landing Page: تأكد من تطابق المحتوى مع الكلمة + سرعة التحميل
   → CTR التاريخي: حسّن Ad Copy لرفع نسبة النقر

5. Impression Share منخفض:
   → بسبب Budget: زيادة الميزانية اليومية
   → بسبب Rank: رفع Bid أو تحسين QS

══════════════════════════════════════
قواعد الرد
══════════════════════════════════════

✅ أجب دائماً بالعربية
✅ استخدم الأرقام والنسب في تحليلاتك
✅ قدّم توصيات عملية وقابلة للتطبيق
✅ اشرح السبب والتأثير لكل توصية
✅ استخدم جداول Markdown عند مقارنة أرقام أو حملات
✅ إذا طلب المستخدم رسماً بيانياً، استخدم json chart في كتلة كود خاصة
✅ ركّز على الأولويات: الأكثر تأثيراً على الـ CPA/ROAS أولاً

❌ لا تخمّن إذا لم تتوفر بيانات كافية — اطلب من المستخدم مشاركة الأرقام
❌ لا تقترح إجراءات خطيرة (حذف حملة، رفع ميزانية ضخمة) دون تحليل كافٍ`;

router.post("/google-ads-ai/chat", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  const { messages, attachment } = req.body as {
    messages: { role: "user" | "assistant"; content: string }[];
    attachment?: { name: string; mimeType: string; base64: string };
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages مطلوب" });
    return;
  }

  // Load LTM for this user
  let ltmContext = "";
  try {
    const ltmRow = await query<{ memory_json: unknown }>(
      "SELECT memory_json FROM user_ltm WHERE user_id = $1",
      [userId]
    );
    if (ltmRow.rows.length > 0) {
      const mem = ltmRow.rows[0]!.memory_json as {
        target_kpis?: Record<string, number | null>;
        strategic_rules?: string[];
        historical_insights?: string;
      };
      const parts: string[] = [];
      if (mem.target_kpis && Object.keys(mem.target_kpis).length > 0) {
        const kpiLines = Object.entries(mem.target_kpis)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `  - ${k}: ${v}`)
          .join("\n");
        if (kpiLines) parts.push(`أهداف KPI المستهدفة:\n${kpiLines}`);
      }
      if (mem.strategic_rules && mem.strategic_rules.length > 0) {
        parts.push(`القواعد الاستراتيجية:\n${mem.strategic_rules.map(r => `  - ${r}`).join("\n")}`);
      }
      if (mem.historical_insights?.trim()) {
        parts.push(`رؤى تاريخية:\n${mem.historical_insights}`);
      }
      if (parts.length > 0) {
        ltmContext = `\n\n══════════════════════════════════════\nذاكرة المستخدم (محفوظة من محادثات سابقة)\n══════════════════════════════════════\n${parts.join("\n\n")}`;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load LTM for google-ads-ai");
  }

  const systemPrompt = SYSTEM_PROMPT + ltmContext;

  // Build OpenAI messages
  const apiMessages: Parameters<typeof openai.chat.completions.create>[0]["messages"] = [
    { role: "system", content: systemPrompt },
  ];

  for (const m of messages) {
    if (m.role === "user" && attachment && m === messages[messages.length - 1]) {
      if (attachment.mimeType.startsWith("image/")) {
        apiMessages.push({
          role: "user",
          content: [
            { type: "text", text: m.content || "حلل هذه الصورة" },
            { type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}` } },
          ],
        });
      } else {
        const decoded = Buffer.from(attachment.base64, "base64").toString("utf-8").slice(0, 8000);
        apiMessages.push({
          role: "user",
          content: `${m.content}\n\n[محتوى الملف: ${attachment.name}]\n${decoded}`,
        });
      }
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: apiMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    });

    let tokenCount = 0;
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        tokenCount += text.length;
        res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    req.log.info({ userId, tokens: tokenCount }, "google-ads-ai chat completed");
  } catch (err) {
    logger.error({ err }, "google-ads-ai streaming error");
    if (!res.headersSent) {
      res.status(500).json({ error: "خطأ في الذكاء الاصطناعي" });
      return;
    }
    res.write(`data: ${JSON.stringify({ type: "text", text: "\n\n❌ حصل خطأ في الاتصال." })}\n\n`);
    res.write("data: [DONE]\n\n");
  } finally {
    res.end();
  }
});

export default router;
