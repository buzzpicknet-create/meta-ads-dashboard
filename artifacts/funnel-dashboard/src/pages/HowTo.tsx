import { useEffect, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  Eye,
  Lightbulb,
  MousePointerClick,
  RefreshCw,
  ShoppingCart,
  Target,
  TrendingDown,
  Wrench,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";

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
  rose: {
    badge:   "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-1 ring-rose-500/30",
    card:    "border-rose-500/20",
    step:    "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    sidebar: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    tipBg:   "bg-rose-500/6 border-rose-500/20",
  },
  amber: {
    badge:   "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30",
    card:    "border-amber-500/20",
    step:    "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    sidebar: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    tipBg:   "bg-amber-500/6 border-amber-500/20",
  },
  orange: {
    badge:   "bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-orange-500/30",
    card:    "border-orange-500/20",
    step:    "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    sidebar: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    tipBg:   "bg-orange-500/6 border-orange-500/20",
  },
  purple: {
    badge:   "bg-purple-500/15 text-purple-700 dark:text-purple-400 ring-1 ring-purple-500/30",
    card:    "border-purple-500/20",
    step:    "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    sidebar: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    tipBg:   "bg-purple-500/6 border-purple-500/20",
  },
  sky: {
    badge:   "bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-1 ring-sky-500/30",
    card:    "border-sky-500/20",
    step:    "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    sidebar: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    tipBg:   "bg-sky-500/6 border-sky-500/20",
  },
};

// ──────────────────────────────────────────────────────────────
// Problem detail card
// ──────────────────────────────────────────────────────────────

function ProblemCard({ p, highlight }: { p: Problem; highlight: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const c = COLOR[p.color];
  const Icon = p.icon;

  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [highlight]);

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
                  أهم مشكلة لديك الآن
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

  // Sort: highlighted problem first
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
                دليل الحلول
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                المشكلة → السبب → الحل — كل ما تحتاجه لتحسين أداء إعلاناتك
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

        {/* Problem cards */}
        <div className="space-y-6">
          {ordered.map((p) => (
            <ProblemCard
              key={p.key}
              p={p}
              highlight={p.key === activeProblem}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
