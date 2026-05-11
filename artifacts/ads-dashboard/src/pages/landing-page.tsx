import { useState } from "react";
import { API } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FileText,
  Sparkles,
  Copy,
  Check,
  Loader2,
  Eye,
  Code2,
  RefreshCw,
} from "lucide-react";

const TONES = [
  { id: "urgent", label: "عاجل ومباشر" },
  { id: "emotional", label: "عاطفي وملهم" },
  { id: "professional", label: "احترافي وموثوق" },
  { id: "friendly", label: "ودي وبسيط" },
];

const PAGE_TYPES = [
  { id: "product", label: "صفحة منتج" },
  { id: "lead", label: "صفحة جذب عملاء" },
  { id: "webinar", label: "صفحة ويبينار" },
  { id: "offer", label: "صفحة عرض خاص" },
];

export default function LandingPage() {
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [benefits, setBenefits] = useState("");
  const [cta, setCta] = useState("اطلب الآن");
  const [tone, setTone] = useState("urgent");
  const [pageType, setPageType] = useState("product");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (!productName.trim()) {
      setError("أدخل اسم المنتج أولاً");
      return;
    }
    setError("");
    setLoading(true);
    setResult("");

    try {
      const prompt = `أنت خبير في تصميم صفحات الهبوط العربية لمتاجر الإلكترونيات المصرية.

اكتب صفحة هبوط HTML كاملة باللغة العربية (RTL) للمنتج التالي:
- اسم المنتج: ${productName}
- وصف المنتج: ${productDesc || "غير محدد"}
- المزايا والفوائد: ${benefits || "غير محددة"}
- زر الـ CTA: ${cta}
- نوع الصفحة: ${PAGE_TYPES.find((p) => p.id === pageType)?.label}
- الأسلوب: ${TONES.find((t) => t.id === tone)?.label}
${price ? `- السعر: ${price} EGP` : ""}

المتطلبات:
- HTML كامل مع CSS مدمج في <style>
- تصميم احترافي داكن (dark) بألوان: #0f172a للخلفية، #3b82f6 للـ CTA
- RTL Arabic
- قسم Hero مع عنوان جذاب وCTA
- قسم المزايا (3-5 نقاط)
- قسم السعر والعرض (إن وجد)
- قسم testimonials (اخترع 3 تقييمات إيجابية)
- قسم الضمان والشحن
- Footer مع CTA أخيرة
- لا تستخدم JavaScript
- الكود لازم يكون في كود بلوك \`\`\`html`;

      const res = await fetch(`${API}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      });

      if (!res.body) throw new Error("No response");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.content) full += evt.content;
            else if (evt.type === "delta" && evt.content) full += evt.content;
          } catch { /* ignore */ }
        }
      }

      // Extract HTML from code block
      const htmlMatch = full.match(/```html\n?([\s\S]*?)```/);
      setResult(htmlMatch ? htmlMatch[1].trim() : full.trim());
      setViewMode("preview");
    } catch {
      setError("فشل توليد الصفحة. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-screen-xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-400" />
          صفحات البيع
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          توليد صفحات هبوط احترافية عربية بالذكاء الاصطناعي
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Form */}
        <div className="xl:col-span-1 bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4 self-start">
          <h2 className="text-sm font-bold text-white">تفاصيل الصفحة</h2>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">اسم المنتج / الخدمة *</label>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="مثال: كريم فيتامين سي"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">وصف المنتج</label>
            <textarea
              value={productDesc}
              onChange={(e) => setProductDesc(e.target.value)}
              placeholder="اكتب وصفاً موجزاً للمنتج..."
              rows={3}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">المزايا والفوائد (سطر لكل ميزة)</label>
            <textarea
              value={benefits}
              onChange={(e) => setBenefits(e.target.value)}
              placeholder="نتيجة في 7 أيام&#10;طبيعي 100%&#10;ضمان استرداد"
              rows={4}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">نص الـ CTA</label>
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="اطلب الآن"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">السعر (EGP)</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="299"
                type="number"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">نوع الصفحة</label>
            <div className="grid grid-cols-2 gap-2">
              {PAGE_TYPES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPageType(p.id)}
                  className={cn(
                    "py-1.5 px-2 rounded-lg border text-xs font-medium transition-all",
                    pageType === p.id
                      ? "border-blue-500 bg-blue-950/40 text-blue-300"
                      : "border-slate-600 text-slate-400 hover:border-slate-500"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">أسلوب الكتابة</label>
            <div className="grid grid-cols-2 gap-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTone(t.id)}
                  className={cn(
                    "py-1.5 px-2 rounded-lg border text-xs font-medium transition-all",
                    tone === t.id
                      ? "border-blue-500 bg-blue-950/40 text-blue-300"
                      : "border-slate-600 text-slate-400 hover:border-slate-500"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <Button
            onClick={generate}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "جارٍ التوليد..." : "توليد الصفحة"}
          </Button>
        </div>

        {/* Preview */}
        <div className="xl:col-span-2 bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden min-h-[500px] flex flex-col">
          {result && (
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700">
              <div className="flex gap-1">
                <button
                  onClick={() => setViewMode("preview")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors",
                    viewMode === "preview" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                  )}
                >
                  <Eye className="w-3 h-3" /> معاينة
                </button>
                <button
                  onClick={() => setViewMode("code")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors",
                    viewMode === "code" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                  )}
                >
                  <Code2 className="w-3 h-3" /> الكود
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={generate}
                  disabled={loading}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> إعادة
                </button>
                <button
                  onClick={copyCode}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? "تم النسخ" : "نسخ HTML"}
                </button>
              </div>
            </div>
          )}

          <div className="flex-1">
            {!result && !loading && (
              <div className="flex flex-col items-center justify-center h-full gap-3 py-20 text-center">
                <FileText className="w-14 h-14 text-slate-700" />
                <p className="text-slate-500 text-sm">
                  أدخل تفاصيل المنتج وانقر "توليد الصفحة"
                </p>
              </div>
            )}
            {loading && (
              <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
                <p className="text-slate-400 text-sm">الـ AI يكتب صفحتك...</p>
              </div>
            )}
            {result && viewMode === "preview" && (
              <iframe
                srcDoc={result}
                className="w-full h-full min-h-[600px] border-0"
                title="Landing Page Preview"
                sandbox="allow-same-origin"
              />
            )}
            {result && viewMode === "code" && (
              <pre className="p-4 text-xs text-slate-300 whitespace-pre-wrap overflow-auto h-full max-h-[600px] font-mono leading-relaxed">
                {result}
              </pre>
            )}
          </div>
        </div>
      </div>

      <AIChatWidget />
    </div>
  );
}
