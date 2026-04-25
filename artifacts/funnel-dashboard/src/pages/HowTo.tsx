import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  Eye,
  Lightbulb,
  MousePointerClick,
  RefreshCw,
  ShoppingCart,
  Sliders,
  Target,
  TrendingDown,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";

// ──────────────────────────────────────────────────────────────
// Metric snapshot — parsed from URL params
// ──────────────────────────────────────────────────────────────
export interface MetricSnapshot {
  name?: string;
  cpa?: number;
  ctr?: number;
  cpc?: number;
  cr?: number;
  freq?: number;
  spend?: number;
  purchases?: number;
  lpvRate?: number;
  hookRate?: number;
}

function parseMetrics(): MetricSnapshot {
  const p = new URLSearchParams(window.location.search);
  const n = (k: string) => (p.get(k) !== null && p.get(k) !== "" ? Number(p.get(k)) : undefined);
  return {
    name: p.get("name") ?? undefined,
    cpa: n("cpa"),
    ctr: n("ctr"),
    cpc: n("cpc"),
    cr: n("cr"),
    freq: n("freq"),
    spend: n("spend"),
    purchases: n("purchases"),
    lpvRate: n("lpvRate"),
    hookRate: n("hookRate"),
  };
}

// ──────────────────────────────────────────────────────────────
// Problem data
// ──────────────────────────────────────────────────────────────

export type ProblemKey =
  | "cpa-high"
  | "ctr-low"
  | "cpc-high"
  | "high-frequency"
  | "no-conversions"
  | "low-cr"
  | "slow-landing"
  | "low-hook";

interface Problem {
  key: ProblemKey;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "rose" | "amber" | "orange" | "purple" | "sky";
  problem: string;
  causes: string[];
  steps: string[];
  tip: string;
}

export const PROBLEMS: Problem[] = [
  {
    key: "cpa-high",
    title: "CPA عالي",
    subtitle: "تكلفة التحويل مرتفعة",
    icon: Target,
    color: "rose",
    problem: "تدفع أكثر مما يجب لكل أوردر، مما يضغط على هامش الربح ويجعل التوسع خطراً.",
    causes: [
      "الاستهداف واسع جداً — تصل لأشخاص غير مهتمين بالمنتج",
      "الكريتف ضعيف لا يُحفّز على الشراء الفوري",
      "صفحة الهبوط بطيئة أو غير مقنعة بما يكفي",
      "منافسة عالية في المزاد (CPM مرتفع في الفترة)",
      "الميزانية منخفضة جداً — الخوارزمية لم تتعلم بعد",
    ],
    steps: [
      "أوقف الإعلانات التي تصرف أكثر من 2× CPA المستهدف بدون أوردر",
      "اختبر كريتف جديد (صورة/فيديو/نص) بميزانية صغيرة 50-100 EGP/يوم",
      "راجع صفحة الهبوط — هل تُحمَّل في أقل من 3 ثوانٍ؟",
      "ضيّق الاستهداف أو جرّب Lookalike Audience من قائمة العملاء",
      "جرّب CBO بدلاً من Manual Budget per Adset",
    ],
    tip: "القاعدة الذهبية: أعطِ الحملة 3× CPA المستهدف كإنفاق قبل الحكم عليها. CPA مقبول في مصر يتراوح بين 30-80 EGP حسب المنتج.",
  },
  {
    key: "ctr-low",
    title: "CTR منخفض",
    subtitle: "الإعلان لا يجذب نقرات",
    icon: MousePointerClick,
    color: "amber",
    problem: "CTR أقل من 1% يعني الإعلان لا يجذب الانتباه ويرفع تكلفة النقرة بشكل كبير.",
    causes: [
      "Hook ضعيف — الثواني الأولى لا تُوقف التمرير",
      "الصورة أو الفيديو لا تبرز في الـ Feed",
      "CTA مبهم أو غير موجود في الإعلان",
      "الجمهور المستهدف غير مناسب لهذا الكريتف",
      "الإعلان مشابه لإعلانات كثيرة في السوق — لا يوجد تميّز",
    ],
    steps: [
      "غيّر الصورة أو الفيديو — ابدأ بشيء يثير الفضول أو الصدمة",
      'اكتب Hook أقوى في أول سطر: "هل تعاني من...؟" أو رقم مثير',
      "اختبر 3 كريتفات مختلفة على نفس الأوديانس لمدة 3 أيام",
      'تأكد أن CTA واضح: "اطلب الآن"، "اشتري بـ X EGP"',
      "جرّب نسبة 1:1 أو 4:5 بدلاً من أفقي 16:9 — تأخذ مساحة أكبر",
    ],
    tip: "الهدف: CTR فوق 2% يعني أن الكريتف يعمل. فوق 3% ممتاز. تحت 0.5% أوقف الكريتف فوراً.",
  },
  {
    key: "cpc-high",
    title: "CPC عالي",
    subtitle: "تكلفة النقرة مرتفعة",
    icon: CircleDollarSign,
    color: "orange",
    problem: "CPC عالي يعني تدفع أكثر لكل زائر مما يقلل العائد على الإنفاق ويرفع CPA.",
    causes: [
      "CTR منخفض — كلما قل CTR زاد CPC تلقائياً",
      "CPM مرتفع بسبب منافسة شديدة في المزاد",
      "الجمهور صغير جداً مما يرفع تكلفة الوصول",
      "Frequency عالية — الجمهور مشبع من إعلانك",
    ],
    steps: [
      "حسّن CTR أولاً (راجع قسم CTR منخفض) — هذا يقلل CPC تلقائياً",
      "وسّع الجمهور — جرّب Broad Audience مع CBO",
      "غيّر وقت الإعلان — جرّب أوقات منخفضة المنافسة",
      "قلل Frequency عبر تغيير الكريتف أو توسيع الجمهور",
      "جرّب حملات Reach بدلاً من Traffic إذا كان الهدف الوعي",
    ],
    tip: "CPC مقبول في مصر للـ E-commerce: 2-5 EGP. فوق 8 EGP يستحق مراجعة عاجلة.",
  },
  {
    key: "high-frequency",
    title: "تكرار عالي (Frequency)",
    subtitle: "الجمهور شاف الإعلان كتير",
    icon: RefreshCw,
    color: "purple",
    problem: "Frequency فوق 3x يعني نفس الأشخاص يشوفون إعلانك مراراً — يؤدي إلى Ad Fatigue وزيادة CPC.",
    causes: [
      "الجمهور المستهدف صغير جداً مقارنة بالميزانية",
      "الحملة شغّالة فترة طويلة بدون تغيير في الكريتف",
      "Exclusions غير كافية — تعيد استهداف نفس الناس",
      "لا يوجد Lookalike أو Broad لتوسيع الوصول",
    ],
    steps: [
      "وسّع الجمهور: أضف Interests جديدة أو جرّب Broad Audience",
      "أضف Exclusions: مشترين حاليين وزوار الصفحة آخر 30 يوم",
      "غيّر الكريتف — نفس الرسالة لكن بشكل مختلف تماماً",
      "أوقف الحملة 3-5 أيام ثم أعد تشغيلها بكريتف جديد",
      "قسّم الميزانية على أوديانس متعددة بدلاً من واحد",
    ],
    tip: "Frequency المقبول: 1.5-2.5x. فوق 3.5x: غيّر الكريتف فوراً. فوق 5x: أوقف الحملة.",
  },
  {
    key: "no-conversions",
    title: "بدون تحويلات",
    subtitle: "إنفاق بدون أي أوردر",
    icon: ShoppingCart,
    color: "rose",
    problem: "تصرف ميزانية لكن لا تتلقى أي أوردرات — مشكلة تقنية في التتبع أو في تجربة الشراء.",
    causes: [
      "Pixel غير مثبّت صح أو لا يُسجّل الـ Conversion Event",
      "صفحة الهبوط لا تعمل صح أو فيها أخطاء تقنية",
      "Conversion Event خاطئ في Ads Manager (مثلاً: PageView بدل Purchase)",
      "المنتج غير جذاب أو السعر غير منافس في السوق",
      "الجمهور المستهدف بعيد جداً عن الجاهزية للشراء",
    ],
    steps: [
      "تحقق من Pixel في Meta Events Manager — هل Purchase Event يُسجَّل؟",
      "اختبر صفحة الهبوط بنفسك من موبايل واضغط شراء كاملاً",
      "في Ads Manager: تأكد Optimization Event = Purchase وليس Click",
      "راجع صفحة الهبوط: السعر، الصور، CTA، زر الطلب، سرعة التحميل",
      "إذا كل شيء صح تقنياً: جرّب أوديانس مختلف أو كريتف جديد",
    ],
    tip: "القاعدة: لو صرفت 3× CPA المستهدف بدون أوردر — أوقف فوراً وافحص Pixel أولاً.",
  },
  {
    key: "low-cr",
    title: "معدل التحويل منخفض",
    subtitle: "زوار كتير لكن شراء قليل",
    icon: TrendingDown,
    color: "amber",
    problem: "Conversion Rate أقل من 2% يعني الصفحة لا تُقنع الزائر بالشراء رغم وصوله.",
    causes: [
      "صفحة الهبوط بطيئة أو مصممة بشكل غير مقنع",
      "السعر غير منافس مقارنة بالسوق والمنافسين",
      "لا يوجد Social Proof: مراجعات، تقييمات، صور عملاء",
      "عملية الشراء معقدة — خطوات كثيرة وتسجيل إجباري",
      "الإعلان يعد بشيء والصفحة تعرض شيئاً مختلفاً",
    ],
    steps: [
      "تأكد أن صفحة الهبوط تُحمَّل في أقل من 3 ثوانٍ على الموبايل",
      "أضف Social Proof: مراجعات حقيقية، صور عملاء، عدد المبيعات",
      "بسّط عملية الشراء: الطلب في خطوة واحدة بدون تسجيل إجباري",
      'أضف Urgency: "عرض لمدة 24 ساعة" أو "آخر 5 قطع متاحة"',
      "تأكد أن رسالة الإعلان تتطابق تماماً مع محتوى صفحة الهبوط",
    ],
    tip: "CR فوق 5% ممتاز للـ E-commerce في مصر. دون 1% يستحق تحسيناً عاجلاً وفورياً.",
  },
  {
    key: "slow-landing",
    title: "صفحة هبوط بطيئة",
    subtitle: "الزوار يغادرون قبل التحميل",
    icon: Activity,
    color: "orange",
    problem: "صفحة تستغرق أكثر من 3 ثوانٍ للتحميل تفقد أكثر من 50% من الزوار قبل رؤية المنتج.",
    causes: [
      "صور ثقيلة غير مضغوطة بجودة عالية جداً",
      "استضافة بطيئة أو بعيدة جغرافياً عن مصر",
      "كود غير محسّن: JavaScript كثير أو Plugins زائدة",
      "لا يوجد CDN لتسريع تحميل الملفات الثابتة",
      "خطوط (Fonts) تُحمَّل من خارج الموقع",
    ],
    steps: [
      "اختبر السرعة على PageSpeed Insights (pagespeed.web.dev) — الهدف فوق 70",
      "اضغط الصور: استخدم WebP بدلاً من PNG/JPEG وخفّض الحجم",
      "فعّل الـ Caching على الاستضافة",
      "استخدم CDN مثل Cloudflare (مجاناً) لتسريع التحميل",
      "قلل عدد الـ Scripts والـ Plugins غير الضرورية",
    ],
    tip: "الهدف: أقل من 2.5 ثانية على الموبايل. كل ثانية تأخير = 7% انخفاض في معدل التحويل.",
  },
  {
    key: "low-hook",
    title: "Hook Rate ضعيف",
    subtitle: "الناس لا تكمل مشاهدة الفيديو",
    icon: Eye,
    color: "amber",
    problem: "Hook Rate أقل من 25% يعني أن أول 3 ثوانٍ في الفيديو لا تُوقف التمرير.",
    causes: [
      "الفيديو يبدأ ببطء — مقدمة طويلة قبل الوصول للمحتوى",
      "لا يوجد عنصر مفاجأة أو فضول في الثانية الأولى",
      "الصورة الثابتة (Thumbnail) لا تثير الاهتمام",
      "الصوت أو الموسيقى لا تتناسب مع الجمهور المستهدف",
    ],
    steps: [
      'ابدأ بالـ Hook مباشرة في أول ثانية: "سر لا يعرفه أحد..." أو رقم مثير',
      "استخدم حركة أو action في أول ثانية — الصور الثابتة أضعف بكثير",
      "اختبر فيديوهات مدتها 15 ثانية مقابل 30 ثانية",
      "أضف نص على الشاشة (CC/Subtitles) لمن يشاهد بدون صوت",
      'جرّب بداية بسؤال مثير: "هل تعرف لماذا منتجك لا يُباع؟"',
    ],
    tip: "Hook Rate فوق 30% ممتاز. فوق 40% = كريتف قوي جداً. استثمر فيه وكرّره.",
  },
];

// ──────────────────────────────────────────────────────────────
// Color config
// ──────────────────────────────────────────────────────────────

const COLOR: Record<string, { badge: string; card: string; step: string; sidebar: string; tipBg: string }> = {
  rose:   { badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-1 ring-rose-500/30", card: "border-rose-500/20", step: "bg-rose-500/10 text-rose-700 dark:text-rose-400", sidebar: "bg-rose-500/10 text-rose-700 dark:text-rose-400", tipBg: "bg-rose-500/6 border-rose-500/20" },
  amber:  { badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30", card: "border-amber-500/20", step: "bg-amber-500/10 text-amber-700 dark:text-amber-400", sidebar: "bg-amber-500/10 text-amber-700 dark:text-amber-400", tipBg: "bg-amber-500/6 border-amber-500/20" },
  orange: { badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-orange-500/30", card: "border-orange-500/20", step: "bg-orange-500/10 text-orange-700 dark:text-orange-400", sidebar: "bg-orange-500/10 text-orange-700 dark:text-orange-400", tipBg: "bg-orange-500/6 border-orange-500/20" },
  purple: { badge: "bg-purple-500/15 text-purple-700 dark:text-purple-400 ring-1 ring-purple-500/30", card: "border-purple-500/20", step: "bg-purple-500/10 text-purple-700 dark:text-purple-400", sidebar: "bg-purple-500/10 text-purple-700 dark:text-purple-400", tipBg: "bg-purple-500/6 border-purple-500/20" },
  sky:    { badge: "bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-1 ring-sky-500/30", card: "border-sky-500/20", step: "bg-sky-500/10 text-sky-700 dark:text-sky-400", sidebar: "bg-sky-500/10 text-sky-700 dark:text-sky-400", tipBg: "bg-sky-500/6 border-sky-500/20" },
};

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function fmt(n: number, d = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ──────────────────────────────────────────────────────────────
// What-If Calculator
// ──────────────────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  onChange,
  max,
  color,
  unit = "%",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
  color: string;
  unit?: string;
}) {
  const trackColor: Record<string, string> = {
    emerald: "#10b981",
    sky: "#0ea5e9",
    violet: "#8b5cf6",
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular-nums" style={{ color: trackColor[color] }}>
          {value > 0 ? "+" : ""}{value}{unit}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={max}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-muted"
          style={{ accentColor: trackColor[color] }}
        />
      </div>
    </div>
  );
}

function CalcResultCard({
  label,
  current,
  projected,
  unit = "",
  lowerIsBetter = false,
}: {
  label: string;
  current: number | null;
  projected: number;
  unit?: string;
  lowerIsBetter?: boolean;
}) {
  const isImproved = current !== null
    ? lowerIsBetter ? projected < current : projected > current
    : false;
  const changePct = current !== null && current !== 0
    ? ((projected - current) / current) * 100
    : null;

  return (
    <div className="rounded-xl bg-muted/50 ring-1 ring-border/60 p-3 space-y-1.5">
      <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
      {current !== null && (
        <div className="text-[11px] text-muted-foreground line-through">
          {fmt(current, current < 10 ? 1 : 0)}{unit}
        </div>
      )}
      <div className={`text-lg font-bold ${isImproved ? "text-emerald-600 dark:text-emerald-400" : current !== null ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
        {fmt(projected, projected < 10 ? 1 : 0)}{unit}
      </div>
      {changePct !== null && (
        <div className={`flex items-center gap-1 text-[10px] font-bold ${isImproved ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {isImproved ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {isImproved ? "" : ""}{Math.abs(changePct).toFixed(0)}% {lowerIsBetter ? (isImproved ? "انخفاض" : "ارتفاع") : (isImproved ? "زيادة" : "انخفاض")}
        </div>
      )}
    </div>
  );
}

function WhatIfCalculator({ metrics }: { metrics: MetricSnapshot }) {
  const [aov, setAov] = useState(metrics.cpa ? String(Math.round(metrics.cpa * 3.5)) : "");
  const [dailySpend, setDailySpend] = useState(metrics.spend ? String(Math.round(metrics.spend)) : "");
  const [ctrImprove, setCtrImprove] = useState(0);
  const [crImprove, setCrImprove] = useState(0);
  const [cpcReduce, setCpcReduce] = useState(0);

  const currentCpa = metrics.cpa ?? 0;
  const aovNum = parseFloat(aov) || 0;
  const spendNum = (parseFloat(dailySpend) || 0) * 30;

  const newCpa =
    currentCpa > 0
      ? (currentCpa * (1 - cpcReduce / 100)) / ((1 + ctrImprove / 100) * (1 + crImprove / 100))
      : 0;

  const currentRoas = aovNum > 0 && currentCpa > 0 ? aovNum / currentCpa : null;
  const newRoas = aovNum > 0 && newCpa > 0 ? aovNum / newCpa : 0;

  const currentMonthlyPurchases = spendNum > 0 && currentCpa > 0 ? spendNum / currentCpa : null;
  const newMonthlyPurchases = spendNum > 0 && newCpa > 0 ? spendNum / newCpa : 0;
  const additionalRevenue =
    currentMonthlyPurchases !== null && aovNum > 0
      ? (newMonthlyPurchases - currentMonthlyPurchases) * aovNum
      : 0;

  const hasAnyChange = ctrImprove > 0 || crImprove > 0 || cpcReduce > 0;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sliders className="h-5 w-5 text-primary" />
          حاسبة التوقعات — ماذا لو حسّنت الأداء؟
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          حرّك الأشرطة لترى تأثير التحسينات على CPA وROAS والإيراد
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Inputs row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              CPA الحالي (EGP)
            </label>
            <input
              type="number"
              placeholder={currentCpa > 0 ? fmt(currentCpa, 0) : "أدخل CPA"}
              defaultValue={currentCpa > 0 ? undefined : undefined}
              value={currentCpa > 0 ? fmt(currentCpa, 0) : undefined}
              readOnly={currentCpa > 0}
              className={`w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono text-left ${currentCpa > 0 ? "opacity-60 cursor-not-allowed" : ""}`}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              متوسط قيمة الطلب AOV (EGP)
            </label>
            <input
              type="number"
              placeholder="مثال: 300"
              value={aov}
              onChange={(e) => setAov(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              الإنفاق اليومي (EGP/يوم) — لحساب الإيراد الشهري
            </label>
            <input
              type="number"
              placeholder="مثال: 500"
              value={dailySpend}
              onChange={(e) => setDailySpend(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>

        {/* Sliders */}
        <div className="rounded-xl bg-muted/40 p-4 space-y-4">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">نسب التحسين المتوقعة</p>
          <SliderRow label="تحسين CTR (نسبة النقر)" value={ctrImprove} onChange={setCtrImprove} max={100} color="emerald" />
          <SliderRow label="تحسين معدل التحويل CR" value={crImprove} onChange={setCrImprove} max={100} color="sky" />
          <SliderRow label="تقليل تكلفة النقرة CPC" value={cpcReduce} onChange={setCpcReduce} max={50} color="violet" />
        </div>

        {/* Results */}
        {currentCpa > 0 && (
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-3">
              {hasAnyChange ? "النتائج المتوقعة" : "حرّك الأشرطة لترى التوقعات"}
            </p>
            {hasAnyChange ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <CalcResultCard label="CPA المتوقع" current={currentCpa} projected={newCpa} unit=" EGP" lowerIsBetter />
                {aovNum > 0 && currentRoas !== null && (
                  <CalcResultCard label="ROAS المتوقع" current={currentRoas} projected={newRoas} unit="×" />
                )}
                {spendNum > 0 && currentMonthlyPurchases !== null && (
                  <CalcResultCard label="أوردرات شهرية" current={currentMonthlyPurchases} projected={newMonthlyPurchases} unit=" طلب" />
                )}
                {spendNum > 0 && aovNum > 0 && currentMonthlyPurchases !== null && (
                  <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25 p-3 space-y-1.5">
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">إيراد شهري إضافي</div>
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      +{fmt(Math.max(0, additionalRevenue), 0)} EGP
                    </div>
                    <div className="text-[10px] text-muted-foreground">من نفس الميزانية</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl bg-muted/30 ring-1 ring-border/40 p-4 text-center text-xs text-muted-foreground">
                حرّك أي شريط من الأشرطة أعلاه لترى التأثير المتوقع على أرقامك
              </div>
            )}
          </div>
        )}

        {currentCpa <= 0 && (
          <div className="rounded-xl bg-muted/30 ring-1 ring-border/40 p-4 text-center text-xs text-muted-foreground">
            الحاسبة تعمل بشكل أفضل عند فتحها من زر "كيف أحلها؟" بجانب أي تنبيه لديك — حيث تُملأ الأرقام تلقائياً
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Dynamic status panel — shown at top of highlighted problem card
// ──────────────────────────────────────────────────────────────

interface StatusRow {
  label: string;
  value: number | undefined;
  benchmark: number;
  unit: string;
  lowerIsBetter: boolean;
  benchmarkLabel?: string;
}

function getStatusRows(key: ProblemKey, m: MetricSnapshot): StatusRow[] {
  switch (key) {
    case "cpa-high":
      return [
        { label: "CPA الحالي", value: m.cpa, benchmark: 40, unit: " EGP", lowerIsBetter: true, benchmarkLabel: "الهدف ≤ 40 EGP" },
        ...(m.cpc !== undefined ? [{ label: "CPC", value: m.cpc, benchmark: 5, unit: " EGP", lowerIsBetter: true, benchmarkLabel: "المقبول ≤ 5 EGP" }] : []),
        ...(m.ctr !== undefined ? [{ label: "CTR", value: m.ctr, benchmark: 1.5, unit: "%", lowerIsBetter: false, benchmarkLabel: "الهدف ≥ 1.5%" }] : []),
      ];
    case "ctr-low":
      return [
        { label: "CTR الحالي", value: m.ctr, benchmark: 1.5, unit: "%", lowerIsBetter: false, benchmarkLabel: "الهدف ≥ 1.5%" },
        ...(m.cpc !== undefined ? [{ label: "CPC", value: m.cpc, benchmark: 5, unit: " EGP", lowerIsBetter: true, benchmarkLabel: "المقبول ≤ 5 EGP" }] : []),
      ];
    case "cpc-high":
      return [
        { label: "CPC الحالي", value: m.cpc, benchmark: 5, unit: " EGP", lowerIsBetter: true, benchmarkLabel: "المقبول ≤ 5 EGP" },
        ...(m.ctr !== undefined ? [{ label: "CTR", value: m.ctr, benchmark: 1.5, unit: "%", lowerIsBetter: false, benchmarkLabel: "الهدف ≥ 1.5%" }] : []),
      ];
    case "high-frequency":
      return [
        { label: "التكرار الحالي", value: m.freq, benchmark: 2.5, unit: "×", lowerIsBetter: true, benchmarkLabel: "المقبول ≤ 2.5×" },
      ];
    case "no-conversions":
      return [
        { label: "الإنفاق المحترق", value: m.spend, benchmark: 0, unit: " EGP", lowerIsBetter: false, benchmarkLabel: "أوردرات: " + (m.purchases ?? 0) },
      ];
    case "low-cr":
      return [
        { label: "معدل التحويل CR", value: m.cr, benchmark: 2, unit: "%", lowerIsBetter: false, benchmarkLabel: "الهدف ≥ 2%" },
        ...(m.lpvRate !== undefined ? [{ label: "وصول الصفحة", value: m.lpvRate, benchmark: 75, unit: "%", lowerIsBetter: false, benchmarkLabel: "الهدف ≥ 75%" }] : []),
      ];
    case "slow-landing":
      return [
        { label: "معدل وصول الصفحة", value: m.lpvRate, benchmark: 75, unit: "%", lowerIsBetter: false, benchmarkLabel: "الهدف ≥ 75%" },
      ];
    case "low-hook":
      return [
        { label: "Hook Rate", value: m.hookRate, benchmark: 25, unit: "%", lowerIsBetter: false, benchmarkLabel: "الهدف ≥ 25%" },
      ];
  }
}

function DynamicStatusPanel({ problemKey, metrics }: { problemKey: ProblemKey; metrics: MetricSnapshot }) {
  const rows = getStatusRows(problemKey, metrics).filter((r) => r.value !== undefined);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl bg-background/80 ring-1 ring-border/60 p-4 space-y-3 mt-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-primary">
          أرقام حملتك الآن
          {metrics.name ? ` — ${metrics.name.slice(0, 50)}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        {rows.map((r) => {
          if (r.value === undefined) return null;
          const isGood = r.lowerIsBetter ? r.value <= r.benchmark : r.value >= r.benchmark;
          const deviation = r.benchmark !== 0 ? ((r.value - r.benchmark) / r.benchmark) * 100 : 0;
          const deviationAbs = Math.abs(deviation);
          const deviationLabel =
            isGood
              ? `✓ ضمن الحد المقبول`
              : r.lowerIsBetter
              ? `أعلى بـ ${deviationAbs.toFixed(0)}% من الحد`
              : `أقل بـ ${deviationAbs.toFixed(0)}% من الهدف`;

          return (
            <div
              key={r.label}
              className={`rounded-lg p-3 ring-1 ${
                isGood
                  ? "bg-emerald-500/8 ring-emerald-500/20"
                  : deviationAbs > 50
                  ? "bg-rose-500/10 ring-rose-500/25"
                  : "bg-amber-500/10 ring-amber-500/25"
              }`}
            >
              <div className="text-[10px] text-muted-foreground mb-1">{r.label}</div>
              <div
                className={`text-xl font-bold font-mono ${
                  isGood
                    ? "text-emerald-600 dark:text-emerald-400"
                    : deviationAbs > 50
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {r.value < 100 ? r.value.toFixed(r.value < 10 ? 2 : 1) : fmt(r.value, 0)}{r.unit}
              </div>
              <div className={`text-[9px] font-medium mt-1 ${isGood ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {deviationLabel}
              </div>
              {r.benchmarkLabel && (
                <div className="text-[9px] text-muted-foreground/70 mt-0.5">{r.benchmarkLabel}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Spend/Purchases summary if available */}
      {(metrics.spend !== undefined || metrics.purchases !== undefined) && problemKey !== "no-conversions" && (
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
          {metrics.spend !== undefined && (
            <span>الإنفاق: <span className="font-bold text-foreground">{fmt(metrics.spend, 0)} EGP</span></span>
          )}
          {metrics.purchases !== undefined && (
            <span>الأوردرات: <span className="font-bold text-foreground">{metrics.purchases}</span></span>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Problem card
// ──────────────────────────────────────────────────────────────

function ProblemCard({ p, highlight, metrics }: { p: Problem; highlight: boolean; metrics: MetricSnapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  const c = COLOR[p.color];
  const Icon = p.icon;

  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [highlight]);

  const hasDynamicData =
    highlight &&
    (metrics.cpa !== undefined ||
      metrics.ctr !== undefined ||
      metrics.cpc !== undefined ||
      metrics.cr !== undefined ||
      metrics.freq !== undefined ||
      metrics.lpvRate !== undefined ||
      metrics.hookRate !== undefined);

  return (
    <div
      ref={ref}
      id={`problem-${p.key}`}
      className={`rounded-2xl border ${c.card} ${highlight ? "ring-2 ring-primary shadow-lg shadow-primary/10" : ""} bg-card overflow-hidden transition-all`}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl ${c.sidebar}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold">{p.title}</h2>
              {highlight && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary ring-1 ring-primary/30">
                  المشكلة المحددة
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{p.subtitle}</p>
          </div>
        </div>

        {/* Problem description */}
        <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <span>{p.problem}</span>
        </div>

        {/* Dynamic status — only when metrics are passed and card is highlighted */}
        {hasDynamicData && <DynamicStatusPanel problemKey={p.key} metrics={metrics} />}
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* Causes */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wide">الأسباب الشائعة</span>
          </div>
          <ul className="space-y-1.5">
            {p.causes.map((cause, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className={`shrink-0 mt-0.5 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${c.step}`}>
                  {i + 1}
                </span>
                {cause}
              </li>
            ))}
          </ul>
        </div>

        {/* Steps */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wide">خطوات الحل</span>
          </div>
          <ol className="space-y-2">
            {p.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className={`shrink-0 mt-0.5 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center ${c.step}`}>
                  {i + 1}
                </span>
                <span className="text-xs text-foreground leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Tip */}
        <div className={`rounded-xl border px-4 py-3 ${c.tipBg}`}>
          <div className="flex items-start gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-bold text-foreground">نصيحة: </span>
              {p.tip}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────

export default function HowTo() {
  const search = new URLSearchParams(window.location.search);
  const activeProblem = (search.get("problem") ?? "") as ProblemKey | "";
  const metrics = parseMetrics();

  const ordered = activeProblem
    ? [
        ...PROBLEMS.filter((p) => p.key === activeProblem),
        ...PROBLEMS.filter((p) => p.key !== activeProblem),
      ]
    : PROBLEMS;

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-[900px] px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <Link
            href="/overview"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            رجوع للنظرة العامة
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-primary" />
                دليل التشخيص والحلول
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {metrics.name
                  ? `تحليل مخصص لـ: ${metrics.name.slice(0, 60)}`
                  : "المشكلة → السبب → الحل + حاسبة التوقعات"}
              </p>
            </div>
            {activeProblem && (
              <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-primary/15 text-primary ring-1 ring-primary/30">
                تم تحديد المشكلة تلقائياً
              </span>
            )}
          </div>
        </div>

        {/* Quick nav */}
        <div className="flex flex-wrap gap-2">
          {PROBLEMS.map((p) => {
            const Icon = p.icon;
            const c = COLOR[p.color];
            const isActive = p.key === activeProblem;
            return (
              <a
                key={p.key}
                href={`#problem-${p.key}`}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : `${c.badge} hover:opacity-80`
                }`}
              >
                <Icon className="h-3 w-3" />
                {p.title}
              </a>
            );
          })}
        </div>

        {/* What-if Calculator */}
        <WhatIfCalculator metrics={metrics} />

        {/* Problem cards */}
        <div className="space-y-6">
          {ordered.map((p) => (
            <ProblemCard
              key={p.key}
              p={p}
              highlight={p.key === activeProblem}
              metrics={metrics}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
