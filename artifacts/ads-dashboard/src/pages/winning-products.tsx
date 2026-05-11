import { useState } from "react";
import { API } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Trophy,
  Sparkles,
  TrendingUp,
  DollarSign,
  Target,
  RefreshCw,
  Loader2,
  Star,
  ArrowUpRight,
  Search,
} from "lucide-react";

const NICHES = [
  "منتجات التجميل والعناية",
  "الملابس والأزياء",
  "الإلكترونيات والأكسسوارات",
  "المنزل والديكور",
  "الرياضة واللياقة",
  "الأطفال والألعاب",
  "الطعام والمكملات الغذائية",
  "القرطاسية والمكتبيات",
  "الحيوانات الأليفة",
  "السفر والترفيه",
];

const BUDGET_RANGES = [
  { id: "low", label: "ميزانية منخفضة (500-2000 EGP/يوم)" },
  { id: "medium", label: "ميزانية متوسطة (2000-10000 EGP/يوم)" },
  { id: "high", label: "ميزانية عالية (+10000 EGP/يوم)" },
];

interface WinningProduct {
  name: string;
  niche: string;
  potential_roas: string;
  cpa_estimate: string;
  why_winning: string;
  hook_idea: string;
  target_audience: string;
  scale_potential: "high" | "medium" | "low";
  trend: "rising" | "stable" | "declining";
}

export default function WinningProducts() {
  const [niche, setNiche] = useState("منتجات التجميل والعناية");
  const [budget, setBudget] = useState("medium");
  const [marketContext, setMarketContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<WinningProduct[]>([]);
  const [error, setError] = useState("");

  async function research() {
    setError("");
    setLoading(true);
    setProducts([]);

    try {
      const prompt = `أنت خبير في اكتشاف المنتجات الرابحة للسوق المصري على منصة Meta (Facebook/Instagram).

ابحث وحلل وقدم لي 6 منتجات رابحة في فئة: ${niche}
الميزانية الإعلانية: ${BUDGET_RANGES.find((b) => b.id === budget)?.label}
${marketContext ? `سياق السوق: ${marketContext}` : ""}

لكل منتج قدم تحليلاً في JSON array بالشكل التالي (بدون أي نص خارج JSON):
[
  {
    "name": "اسم المنتج",
    "niche": "الفئة الفرعية",
    "potential_roas": "X-Yx",
    "cpa_estimate": "XX-XX EGP",
    "why_winning": "سبب واحد قوي لماذا هذا المنتج رابح الآن",
    "hook_idea": "فكرة Hook للإعلان",
    "target_audience": "وصف الجمهور المستهدف",
    "scale_potential": "high" أو "medium" أو "low",
    "trend": "rising" أو "stable" أو "declining"
  }
]

ركز على:
- المنتجات التي تحل مشكلة حقيقية
- طلب موجود في السوق المصري
- هامش ربح جيد
- قابل للإعلان على Meta`;

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

      // Extract JSON
      const jsonMatch = full.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as WinningProduct[];
        setProducts(parsed);
      } else {
        setError("لم يتمكن الـ AI من إنتاج بيانات منظمة. حاول مرة أخرى.");
      }
    } catch (e: unknown) {
      setError("فشل البحث. تأكد من الاتصال وحاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  const scaleBadge = (s: WinningProduct["scale_potential"]) => ({
    high: { label: "عالي 🚀", color: "text-emerald-400 bg-emerald-900/40 border-emerald-700/50" },
    medium: { label: "متوسط ⚡", color: "text-amber-400 bg-amber-900/40 border-amber-700/50" },
    low: { label: "محدود ⚠️", color: "text-slate-400 bg-slate-700 border-slate-600" },
  }[s]);

  const trendBadge = (t: WinningProduct["trend"]) => ({
    rising: { label: "↑ صاعد", color: "text-emerald-400" },
    stable: { label: "→ مستقر", color: "text-blue-400" },
    declining: { label: "↓ هابط", color: "text-red-400" },
  }[t]);

  return (
    <div className="p-4 md:p-6 max-w-screen-2xl mx-auto space-y-5" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          منتجات رابحة
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          اكتشف المنتجات الرابحة للسوق المصري بتحليل الذكاء الاصطناعي
        </p>
      </div>

      {/* Search Form */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">الفئة / النيش</label>
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {NICHES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">نطاق الميزانية</label>
            <select
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {BUDGET_RANGES.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">سياق إضافي (اختياري)</label>
            <input
              value={marketContext}
              onChange={(e) => setMarketContext(e.target.value)}
              placeholder="مثال: الموسم الصيفي، مناسبة رمضان..."
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <Button
          onClick={research}
          disabled={loading}
          className="bg-amber-600 hover:bg-amber-500 text-white gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loading ? "جارٍ البحث..." : "ابحث عن منتجات رابحة"}
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="relative">
            <Loader2 className="w-12 h-12 text-amber-400 animate-spin" />
            <Trophy className="w-5 h-5 text-amber-300 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="text-slate-400 text-sm">الـ AI يحلل السوق المصري...</p>
          <p className="text-slate-600 text-xs">قد يستغرق 20-40 ثانية</p>
        </div>
      )}

      {/* Products Grid */}
      {products.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {products.map((product, i) => {
            const scale = scaleBadge(product.scale_potential);
            const trend = trendBadge(product.trend);
            return (
              <div
                key={i}
                className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-amber-400 shrink-0" />
                      <h3 className="text-sm font-bold text-white truncate">{product.name}</h3>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{product.niche}</p>
                  </div>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0", scale.color)}>
                    {scale.label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500">ROAS المتوقع</p>
                    <p className="text-sm font-bold text-emerald-400">{product.potential_roas}</p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500">CPA المتوقع</p>
                    <p className="text-sm font-bold text-blue-400">{product.cpa_estimate}</p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500">الاتجاه</p>
                    <p className={cn("text-sm font-bold", trend.color)}>{trend.label}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-300 leading-relaxed">{product.why_winning}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Target className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-400 leading-relaxed">{product.target_audience}</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-700">
                  <p className="text-[10px] text-slate-500 mb-1 font-medium">💡 فكرة الـ Hook:</p>
                  <p className="text-xs text-amber-300 leading-relaxed italic">
                    "{product.hook_idea}"
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && products.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <Trophy className="w-14 h-14 text-slate-700" />
          <p className="text-slate-400 text-sm">اختر الفئة وانقر "ابحث" لاكتشاف المنتجات الرابحة</p>
          <p className="text-slate-600 text-xs">يستخدم الـ AI بيانات السوق المصري وأداء الحملات لتحديد الفرص</p>
        </div>
      )}

      <AIChatWidget />
    </div>
  );
}
