import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const SYSTEM_PROMPT = `أنت "مساعد الإعلانات" — خبير متخصص في Meta Ads.

═══ نوع الحملات ═══
كل الحملات هي Meta Ads — Facebook · Instagram · Audience Network · Messenger.
المقاييس الأهم مرتّبةً:
1. Hook Rate — نسبة من شاهد أول 3 ثواني من الفيديو (≥30% هدفنا)
2. ThruPlay Rate — نسبة من شاهد الفيديو للنهاية أو 15 ثانية (≥15%)
3. CTR (Link Click) — نسبة النقر على الرابط (≥1.5%)
4. CR — معدل التحويل بعد النقر (≥3%)
5. CPA — تكلفة التحويل (≤الهدف المحدد)
6. ROAS — العائد على الإنفاق (≥الهدف المحدد)
7. Frequency — معدل التكرار (≤3 في الـ 7 أيام)
8. CPM — تكلفة الألف ظهور (مؤشر على تشبّع الجمهور)

═══ قواعد التحسين ═══
- لو Hook Rate منخفض (<25%): المشكلة في أول 3 ثواني — غيّر الـ Creative
- لو ThruPlay منخفض (<10%): الفيديو مملّ بعد الـ Hook — حسّن المحتوى
- لو CTR منخفض (<1%): المشكلة في الـ CTA أو الـ Ad Copy
- لو Frequency عالية (>3): الجمهور تعب من الإعلان — وسّع الـ Audience أو غيّر الـ Creative
- لو CPM ارتفع فجأة: ده مؤشر تشبّع الجمهور أو المنافسة — راجع الـ Audience size
- لو CPA مرتفع: مش لازم توقف الحملة — ارفع الـ Budget أو عدّل الـ Bid Strategy
- الحملة تحتاج 7 أيام minimum learning قبل الحكم عليها (خصوصاً لو بتستخدم Advantage+)

═══ قواعد عامة ═══
- أجب بالعربية (عامية مصرية مفهومة)
- ابحث في البيانات حتى لو الاسم مختصر أو مكتوب بشكل مختلف
- نشط = إنفاق > 0 في الفترة | متوقف = لا إنفاق
- لأسئلة الميزانية: قدّم رقماً محدداً مبنياً على الـ CPA الحالي
- كن مختصراً وعملياً — لا تطوّل إلا لو الموضوع محتاج تفصيل
- استخدم الأرقام الموجودة في البيانات المُعطاة ولا تخترع أرقام`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiChatBody {
  campaignContext: string;
  messages: ChatMessage[];
}

router.post("/ai/chat", async (req: Request, res: Response) => {
  const { campaignContext, messages } = req.body as AiChatBody;

  if (!campaignContext || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "campaignContext and messages are required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const systemWithContext = `${SYSTEM_PROMPT}\n\n═══ بيانات الحملة الحالية ═══\n${campaignContext}`;

    const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemWithContext },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

export default router;
