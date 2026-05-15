import { logger } from "../lib/logger";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const GEMINI_LP_MODEL = "gemini-2.5-pro-preview-06-05";
const GEMINI_FAST_MODEL = "gemini-2.5-flash-preview-05-20";

export const LP_SYSTEM_INSTRUCTION = `أنت مطور ويب ومسوّق رقمي خبير في بناء صفحات هبوط عربية عالية التحويل.
مهمتك: توليد صفحة HTML كاملة standalone احترافية.
أرجع دائماً JSON فقط بالهيكل المطلوب — لا تكتب أي نص خارج الـ JSON.
الـ HTML المُولَّد يجب أن يكون:
- كامل ومكتمل (DOCTYPE → </html>)
- RTL/Arabic بالكامل
- متجاوب 100% مع الموبايل
- بدون تعليقات TODO أو أكواد غير مكتملة`;

interface GeminiCallOptions {
  systemInstruction?: string;
  lpMode?: boolean;
  imageUrls?: string[];
  model?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LPGenerator/1.0)" },
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "image/jpeg";
    const mimeType = ct.split(";")[0]?.trim() ?? "image/jpeg";
    const buf = await resp.arrayBuffer();
    const data = Buffer.from(buf).toString("base64");
    return { data, mimeType };
  } catch {
    return null;
  }
}

export async function callGeminiJson(
  prompt: string,
  options: GeminiCallOptions = {},
): Promise<Record<string, unknown>> {
  const { systemInstruction, lpMode = false, imageUrls = [], model } = options;

  const selectedModel = model ?? (lpMode ? GEMINI_LP_MODEL : GEMINI_FAST_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${GOOGLE_API_KEY}`;

  const userParts: GeminiPart[] = [];

  // Add vision images when in LP mode
  if (lpMode && imageUrls.length > 0) {
    const validUrls = imageUrls.filter(u => {
      const t = u.trim();
      return t.startsWith("http://") || t.startsWith("https://");
    }).slice(0, 5);

    const imageResults = await Promise.allSettled(validUrls.map(fetchImageAsBase64));
    for (let i = 0; i < imageResults.length; i++) {
      const r = imageResults[i];
      if (r.status === "fulfilled" && r.value) {
        userParts.push({
          inlineData: { mimeType: r.value.mimeType, data: r.value.data },
        });
      } else {
        // Fallback: reference URL as text
        userParts.push({ text: `[Image URL: ${validUrls[i]}]` });
      }
    }
  }

  userParts.push({ text: prompt });

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: userParts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: lpMode ? 0.9 : 0.7,
      maxOutputTokens: lpMode ? 65536 : 16384,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(lpMode ? 180_000 : 60_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    logger.error({ status: resp.status, errText }, "gemini_api_error");
    if (resp.status === 429) throw new Error("rate_limit: Gemini rate limit exceeded");
    throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(`Gemini error: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini returned empty response. finishReason: ${reason}`);
  }

  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Try to extract JSON object from response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        throw new Error(`Failed to parse Gemini JSON: ${cleaned.slice(0, 300)}`);
      }
    }
    throw new Error(`Gemini did not return valid JSON: ${cleaned.slice(0, 300)}`);
  }
}
