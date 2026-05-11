import { useState } from "react";
import { API } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Scissors,
  Sparkles,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  ChevronDown,
} from "lucide-react";

const HOOK_TYPES = [
  { id: "question", label: "سؤال استفزازي", example: "هل تعرف ليه..." },
  { id: "problem", label: "مشكلة + حل", example: "تعبت من... جرب..." },
  { id: "result", label: "نتيجة مباشرة", example: "في 7 أيام بس..." },
  { id: "secret", label: "سر مخفي", example: "السر اللي محدش بيقولك..." },
  { id: "mistake", label: "غلطة شائعة", example: "أكتر غلطة بيعملها..." },
];

const PRODUCT_TYPES = [
  "منتج تجميل",
  "ملابس وأزياء",
  "إلكترونيات",
  "طعام ومشروبات",
  "تجهيزات المنزل",
  "رياضة ولياقة",
  "كتب وتعليم",
  "خدمات",
  "أخرى",
];

interface GeneratedContent {
  hooks: string[];
  script: string;
  brief: string;
}

export default function VideoStudio() {
  const [productName, setProductName] = useState("");
  const [productType, setProductType] = useState("منتج تجميل");
  const [targetAudience, setTargetAudience] = useState("");
  const [mainBenefit, setMainBenefit] = useState("");
  const [hookType, setHookType] = useState("question");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeneratedContent | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"hooks" | "script" | "brief">("hooks");

  async function generate() {
    if (!productName.trim()) {
      setError("أدخل اسم المنتج أولاً");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);

    try {
      const prompt = `أنت خبير كريتف في Meta Ads متخصص في فيديوهات الـ DemandGen.

المنتج: ${productName}
نوع المنتج: ${productType}
الجمهور المستهدف: ${targetAudience || "عام"}
الميزة الرئيسية: ${mainBenefit || "غير محدد"}
نوع الـ Hook المطلوب: ${HOOK_TYPES.find((h) => h.id === hookType)?.label}

اكتب:
1. 5 Hook قوية للثواني الـ 3 الأولى (كل hook في سطر منفصل)
2. سكريبت فيديو 30 ثانية كامل (مع تعليمات Visual)
3. Creative Brief للمونتاج (الشات/الموسيقى/الألوان/النص)

افصل الأقسام الثلاثة بـ === بالضبط.`;

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
          } catch {
            // ignore
          }
        }
      }

      const parts = full.split(/===+/).map((s) => s.trim());
      const hooksRaw = parts[0] ?? "";
      const script = parts[1] ?? full;
      const brief = parts[2] ?? "";

      const hooks = hooksRaw
        .split("\n")
        .map((l) => l.replace(/^\d+[\.\-\)]\s*/, "").trim())
        .filter((l) => l.length > 10)
        .slice(0, 5);

      setResult({ hooks, script, brief });
      setActiveTab("hooks");
    } catch {
      setError("فشل توليد المحتوى. تأكد من الاتصال وحاول مجدداً.");
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Scissors className="w-5 h-5 text-purple-400" />
          استوديو الفيديو
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          توليد Hooks وسكريبتات وبريفات للفيديوهات بالذكاء الاصطناعي
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Form */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-white">معلومات المنتج والحملة</h2>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">اسم المنتج *</label>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="مثال: كريم تفتيح البشرة"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">نوع المنتج</label>
            <div className="relative">
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">الجمهور المستهدف</label>
            <input
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="مثال: سيدات 25-40 مهتمات بالعناية بالبشرة"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">الميزة الرئيسية / USP</label>
            <input
              value={mainBenefit}
              onChange={(e) => setMainBenefit(e.target.value)}
              placeholder="مثال: نتيجة ظاهرة في 7 أيام"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-slate-400">نوع الـ Hook</label>
            <div className="grid grid-cols-1 gap-2">
              {HOOK_TYPES.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setHookType(h.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-right transition-all",
                    hookType === h.id
                      ? "border-blue-500 bg-blue-950/40 text-blue-300"
                      : "border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500"
                  )}
                >
                  <div className="flex-1">
                    <p className="font-medium text-white text-right">{h.label}</p>
                    <p className="text-slate-500 text-[10px]">{h.example}</p>
                  </div>
                  {hookType === h.id && (
                    <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
                  )}
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
            className="w-full bg-purple-600 hover:bg-purple-500 text-white gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {loading ? "جارٍ التوليد..." : "توليد المحتوى بالـ AI"}
          </Button>
        </div>

        {/* Output */}
        <div className="space-y-4">
          {!result && !loading && (
            <div className="bg-slate-800/60 border border-dashed border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center gap-3 min-h-[400px]">
              <Sparkles className="w-12 h-12 text-slate-700" />
              <p className="text-slate-500 text-sm text-center">
                أدخل معلومات المنتج وانقر "توليد" لإنشاء Hooks وسكريبت وبريف احترافي
              </p>
            </div>
          )}

          {loading && (
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center gap-4 min-h-[400px]">
              <Loader2 className="w-12 h-12 text-purple-400 animate-spin" />
              <p className="text-slate-400 text-sm">الـ AI شغال على محتوى الفيديو...</p>
              <p className="text-slate-600 text-xs">قد يستغرق 15-30 ثانية</p>
            </div>
          )}

          {result && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-slate-700">
                {(["hooks", "script", "brief"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "flex-1 py-2.5 text-xs font-medium transition-colors",
                      activeTab === tab
                        ? "bg-purple-600/20 text-purple-300 border-b-2 border-purple-500"
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    {tab === "hooks" ? "🎣 الـ Hooks" : tab === "script" ? "📝 السكريبت" : "🎬 البريف"}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {activeTab === "hooks" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold text-white">5 Hooks للثواني الـ 3 الأولى</p>
                      <button
                        onClick={() => copyText(result.hooks.join("\n"), "hooks")}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                      >
                        {copied === "hooks" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        نسخ الكل
                      </button>
                    </div>
                    {result.hooks.map((hook, i) => (
                      <div key={i} className="flex items-start gap-2 bg-slate-700/50 rounded-lg p-3 group">
                        <span className="text-purple-400 font-bold text-sm shrink-0">{i + 1}</span>
                        <p className="text-sm text-white flex-1 leading-relaxed">{hook}</p>
                        <button
                          onClick={() => copyText(hook, `hook-${i}`)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white transition-opacity"
                        >
                          {copied === `hook-${i}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "script" && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold text-white">سكريبت فيديو 30 ثانية</p>
                      <button
                        onClick={() => copyText(result.script, "script")}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                      >
                        {copied === "script" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        نسخ
                      </button>
                    </div>
                    <div className="bg-slate-700/40 rounded-lg p-4">
                      <pre className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed font-sans">
                        {result.script}
                      </pre>
                    </div>
                  </div>
                )}

                {activeTab === "brief" && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold text-white">Creative Brief للمونتاج</p>
                      <button
                        onClick={() => copyText(result.brief, "brief")}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                      >
                        {copied === "brief" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        نسخ
                      </button>
                    </div>
                    <div className="bg-slate-700/40 rounded-lg p-4">
                      <pre className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed font-sans">
                        {result.brief || "لا يوجد بريف — أعد التوليد مرة أخرى"}
                      </pre>
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-700 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={generate}
                    disabled={loading}
                    className="text-xs text-slate-400 hover:text-white gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    إعادة التوليد
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <AIChatWidget />
    </div>
  );
}
