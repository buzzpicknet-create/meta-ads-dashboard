import { useMemo, useState, useEffect, useRef } from "react";
import { logDiagnosisRun } from "@/hooks/use-activity-logger";
import { ChevronDown, Stethoscope, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type {
  SegmentEntry,
  CampaignInsights,
  DailyPoint,
  DerivedMetrics,
} from "@/lib/meta-api";
import { useInsights } from "@/hooks/use-meta";

// ── Types ─────────────────────────────────────────────────────
export type Flag = "good" | "warn" | "bad";
export interface Metric { label: string; value: string; flag?: Flag }

export type CampaignVerdict = "scale" | "refresh" | "creative" | "tech" | "landing" | "nodata";
export type SegVerdict = "scale" | "kill" | "improve" | "creative" | "tech" | "landing" | "okay";

export interface CampaignDiag {
  verdict: CampaignVerdict;
  decision: string;
  problem: string;
  color: "green" | "yellow" | "red" | "gray";
  emoji: string;
  funnel: Array<{ label: string; value: string; rate?: string; flag: Flag }>;
  metrics: Metric[];
  actionPlan: string[];
}

export interface SegDiag {
  verdict: SegVerdict;
  decision: string;
  mainIssue: string;
  color: "green" | "amber" | "red" | "gray";
  metrics: Metric[];
  actions: string[];
}

export interface DiagnosisResult {
  campaign: CampaignDiag;
  adsets: Array<{ seg: SegmentEntry; diag: SegDiag }>;
  ads: Array<{ seg: SegmentEntry; diag: SegDiag }>;
}

// ── Thresholds ────────────────────────────────────────────────
const CPA_SCALE_MAX = 45;
const CPA_IMPROVE_MAX = 80;
const HOOK_MIN = 25;
const CTR_MIN = 1;
const LPR_MIN = 70;
const CR_MIN = 2;

// ── Helpers ───────────────────────────────────────────────────
function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function f1(n: number) { return n.toFixed(1); }
function f2(n: number) { return n.toFixed(2); }
function flagCpa(cpa: number): Flag { return cpa > 0 && cpa <= CPA_SCALE_MAX ? "good" : cpa <= CPA_IMPROVE_MAX ? "warn" : "bad"; }
function flagPct(v: number, good: number, warn: number): Flag { return v >= good ? "good" : v >= warn ? "warn" : "bad"; }

function isCtrDeclining(daily: DailyPoint[]): boolean {
  const rows = daily.filter((d) => d.impressions > 0).map((d) => (d.link_clicks / d.impressions) * 100);
  if (rows.length < 4) return false;
  const half = Math.floor(rows.length / 2);
  const firstAvg = rows.slice(0, half).reduce((s, v) => s + v, 0) / half;
  const secondAvg = rows.slice(half).reduce((s, v) => s + v, 0) / (rows.length - half);
  return secondAvg < firstAvg * 0.85;
}

// ── Segment-level diagnosis ───────────────────────────────────
export function diagnoseSegment(seg: SegmentEntry): SegDiag {
  const lpvRate   = seg.link_clicks > 0 ? (seg.lpv / seg.link_clicks) * 100 : 0;
  const lostAtClk = seg.link_clicks > 0 ? Math.round(seg.link_clicks * (1 - lpvRate / 100)) : 0;
  const lostAtLpv = seg.lpv > 0 ? seg.lpv - seg.purchases : 0;
  const cplpv     = seg.lpv > 0 ? seg.spend / seg.lpv : 0;

  const metrics: Metric[] = [
    { label: "Spend",      value: `${fmt(seg.spend, 0)} EGP` },
    { label: "Purchases",  value: `${seg.purchases}`, flag: seg.purchases > 0 ? "good" : "bad" },
    { label: "CPA",        value: seg.cpa > 0 ? `${fmt(seg.cpa, 0)} EGP` : "—", flag: seg.cpa > 0 ? flagCpa(seg.cpa) : "bad" },
    { label: "Hook Rate",  value: `${f1(seg.hookRate)}%`, flag: flagPct(seg.hookRate, HOOK_MIN, 15) },
    { label: "Outbound CTR", value: `${f2(seg.ctr)}%`, flag: flagPct(seg.ctr, 2, CTR_MIN) },
    { label: "LPR",        value: lpvRate > 0 ? `${f1(lpvRate)}%` : "—", flag: lpvRate > 0 ? flagPct(lpvRate, LPR_MIN, 50) : "bad" },
    { label: "CR (LPV)",   value: seg.cr > 0 ? `${f2(seg.cr)}%` : "—", flag: seg.cr > 0 ? flagPct(seg.cr, CR_MIN, 1) : "bad" },
    { label: "Frequency",  value: f2(seg.frequency), flag: seg.frequency <= 2.5 ? "good" : seg.frequency <= 3.5 ? "warn" : "bad" },
    { label: "CPLPV",      value: cplpv > 0 ? `${f1(cplpv)} EGP` : "—", flag: cplpv > 0 ? (cplpv < 3 ? "good" : cplpv < 7 ? "warn" : "bad") : "bad" },
  ];

  if (seg.spend === 0) {
    return { verdict: "kill", decision: "موقوف ⏸", mainIssue: "لا يوجد إنفاق", color: "gray", metrics,
      actions: ["مفيش إنفاق — تحقق من حالة الـ Ad Set والميزانية، وتأكد إنه Active ومش Paused."] };
  }

  // Scale: CPA رابح
  if (seg.cpa > 0 && seg.cpa <= CPA_SCALE_MAX) {
    const isLearning = seg.purchases < 10;
    return {
      verdict: "scale", decision: "Scale 🟢", mainIssue: `CPA ${fmt(seg.cpa, 0)} EGP — رابح${isLearning ? " (لسه بيتعلم)" : ""}`,
      color: "green", metrics,
      actions: [
        `CPA ${fmt(seg.cpa, 0)} EGP على مستوى الـ ${isLearning ? "Ad" : "Ad Set"} — رابح ومحقق الهدف. ${isLearning ? `بس لسه في مرحلة التعلم (${seg.purchases} تحويل فقط) — لا تعدّل شيء دلوقتي.` : "اتخذ قرار التوسع."}`,
        ...(isLearning ? [
          `كل تعديل تعمله (ميزانية، جمهور، كريتف) بيرجع عداد التعلم للصفر. سيب يشتغل يومين أكتر أولاً.`,
        ] : [
          `زود ميزانية هذا الـ ${isLearning ? "Ad" : "Ad Set"} بـ 20% كل 48 ساعة. مش أكتر — أي زيادة أكبر بتُعيد Algorithm للتعلم.`,
          `لا تلمس الـ Audience ولا الكريتف طالما CPA في المنطقة الرابحة. الـ Algorithm اتعلّم الجمهور المثالي — أي تغيير ممكن يُضيّع هذا التعلم.`,
          `احتاط بكريتف بديل جاهز في حالة ظهور Fatigue (Frequency > 3) — عشان تستبدل بدون توقف.`,
        ]),
      ],
    };
  }

  // لا تحويلات + إنفاق كبير
  if (seg.purchases === 0 && seg.spend > 150) {
    const isCreativeIssue = seg.hookRate > 0 && seg.hookRate < 20;
    const isTrackingIssue = seg.ctr >= CTR_MIN && lpvRate >= 60;
    return {
      verdict: "kill", decision: "أوقف 🔴", mainIssue: `${fmt(seg.spend, 0)} EGP بدون أوردر واحد`,
      color: "red", metrics,
      actions: [
        `${fmt(seg.spend, 0)} EGP إنفاق وصفر تحويلات من هذا المستوى. كل جنيه بيتحرق هنا بدون عائد — القرار واضح.`,
        ...(isTrackingIssue ? [
          `CTR وLPR معقولين — ده بيشير إلى مشكلة Pixel مش مشكلة كريتف. افتح Events Manager > Test Events وتأكد إن Purchase Event بيوصل من الصفحة دي.`,
          `تحقق إن الـ Ad Set محسّن على Purchase وليس Add to Cart أو View Content — خطأ شائع بيودي إنفاق كبير بدون تحويل حقيقي.`,
        ] : isCreativeIssue ? [
          `Hook Rate ${f1(seg.hookRate)}% منخفض جداً — الناس مش بتشوف الإعلان كفاية. غيّر الكريتف قبل إعادة الإطلاق.`,
          `أوقف وحوّل الميزانية للـ Ad Set/Ad الأفضل أداءً. لا تسيب المال يُحرق على نتائج مؤكدة.`,
        ] : [
          `أوقف هذا المستوى فوراً. راجع الـ Audience (ممكن يكون ضيّق جداً أو غير مناسب) والـ Offer على الصفحة.`,
          `قبل إعادة الإطلاق: اعمل شراء تجريبي حقيقي وتحقق من إن Pixel بيسجّل الأوردر بشكل صحيح.`,
        ]),
      ],
    };
  }

  // CPA مرتفع جداً → وقّف
  if (seg.cpa > CPA_IMPROVE_MAX) {
    return {
      verdict: "kill", decision: "أوقف 🔴", mainIssue: `CPA ${fmt(seg.cpa, 0)} EGP — خسارة مؤكدة`,
      color: "red", metrics,
      actions: [
        `CPA ${fmt(seg.cpa, 0)} EGP — أعلى من حد الخسارة (${CPA_IMPROVE_MAX} EGP) بـ ${Math.round(seg.cpa - CPA_IMPROVE_MAX)} EGP. كل أوردر بيكلفك خسارة مؤكدة.`,
        `أوقف هذا المستوى فوراً وحوّل ميزانيته للأفضل أداءً. لا تحاول "إنقاذه" بتغييرات صغيرة — الـ Audience غلط من الأساس.`,
        `عند إعادة البناء: ابدأ بـ Lookalike 1-2% من قاعدة مشترين حقيقيين — مش Interest Targeting — للوصول لجمهور مشابه لمن اشترى فعلاً.`,
      ],
    };
  }

  // ميت Hook (VR < 15%)
  if (seg.hookRate > 0 && seg.hookRate < 15) {
    const skipPct = Math.round(100 - seg.hookRate);
    return {
      verdict: "creative", decision: "ميت Hook 🔴", mainIssue: `Hook Rate ${f1(seg.hookRate)}% — ${skipPct}% سكبوا في 3ث`,
      color: "red", metrics,
      actions: [
        `Hook Rate ${f1(seg.hookRate)}% — من كل 100 مشاهد، ${skipPct} شخص سكب قبل ما يعدّي 3 ثواني. ده مش إعلان ضعيف — الكريتف ده مش بيوقف السكرول خالص، والـ Algorithm بيقلل Reach تدريجياً.`,
        `أعد تصوير أول 3 ثواني فقط بـ Pattern Interrupt حقيقي: وجه بنظرة مباشرة للكاميرا + سؤال مشكلة الجمهور بالاسم في أول جملة، بدون Intro أو موسيقى بدون كلام.`,
        `جرّب صيغة UGC (Unboxing أو Testimonial حقيقي) — متوسط Hook Rate بتاع UGC على Meta 25-40% مقارنة بـ 8-18% للإعلانات المنتجة في نفس الـ Niche.`,
      ],
    };
  }

  // كريتف ضعيف: Hook أو CTR
  if (seg.hookRate > 0 && (seg.hookRate < HOOK_MIN || seg.ctr < CTR_MIN)) {
    const isHookWeak = seg.hookRate < HOOK_MIN;
    return {
      verdict: "creative", decision: isHookWeak ? "Hook ضعيف 🟠" : "CTR منخفض 🟠",
      mainIssue: isHookWeak ? `Hook Rate ${f1(seg.hookRate)}% (المطلوب +${HOOK_MIN}%)` : `Outbound CTR ${f2(seg.ctr)}% (المطلوب +${CTR_MIN}%)`,
      color: "red", metrics,
      actions: [
        isHookWeak
          ? `Hook Rate ${f1(seg.hookRate)}% — من كل 100 مشاهد، ${Math.round(100 - seg.hookRate)} شخص سكب في أول 3ث. الإعلان مش بيوقف السكرول. الـ Meta Algorithm بيعاقب الكريتف الضعيف بزيادة CPM تدريجياً.`
          : `Outbound CTR ${f2(seg.ctr)}% — الناس بتشوف الإعلان لكن مش بتضغط. الكريتف بيستحوذ على الانتباه لكن الـ Offer أو الـ CTA مش بيخلق Action.`,
        isHookWeak
          ? `أعد تصوير أول 3 ثواني بزاوية مختلفة خالص. جرّب: (1) سؤال مباشر عن مشكلة الجمهور، (2) رقم صادم/إحصاء مثير للفضول، (3) نتيجة المنتج قبل تقديمه.`
          : `اختبر CTAs مختلفة: بدل "اشتري الآن" جرّب سؤال مباشر أو "شوف الأسعار" أو "احجز نسختك". أضف Urgency حقيقية لو ممكن (كمية محدودة، سعر عرض).`,
        `اعمل A/B Test رسمي: 3 إعلانات بـ Hook مختلف، نفس الميزانية (50 EGP/يوم لكل)، 3 أيام. خذ الأفضل وأغلق الباقي.`,
      ],
    };
  }

  // مشكلة تقنية (LPR)
  if (lpvRate > 0 && lpvRate < LPR_MIN) {
    return {
      verdict: "tech", decision: "مشكلة تقنية 🔴", mainIssue: `LPR ${f1(lpvRate)}% — ${fmt(lostAtClk, 0)} نقرة ضاعت`,
      color: "red", metrics,
      actions: [
        `${fmt(seg.link_clicks, 0)} نقرة دفعت Meta ثمنها، وصل منهم ${fmt(seg.lpv, 0)} للصفحة فقط (LPR ${f1(lpvRate)}%). ${fmt(lostAtClk, 0)} شخص اختفى في الطريق — ده مش كريتف، ده موقع بطيء أو Pixel غلط.`,
        `افتح PageSpeed Insights (pagespeed.web.dev) على رابط الإعلان من الموبايل. لو Performance < 50 — الصفحة بطيئة وبتخسر أكتر من نص النقرات قبل ما تفتح.`,
        `ثبّت Meta Pixel Helper Extension في Chrome وافتح الرابط. تأكد إن PageView Event بيطلع فوراً — لو مش بيطلع الـ Pixel مش مربوط على هذه الصفحة تحديداً.`,
        `تحقق من إن الرابط مباشر — كل Redirect زيادة بيخسّر 5-10% من الزوار. استخدم الرابط النهائي مباشرةً في الإعلان بدون URL Shortener.`,
      ],
    };
  }

  // صفحة هبوط (CR منخفض)
  if (seg.cr < CR_MIN && seg.lpv > 10) {
    return {
      verdict: "landing", decision: "صفحة هبوط ضعيفة 🔴", mainIssue: `CR ${f2(seg.cr)}% — ${fmt(lostAtLpv, 0)} زيارة بدون شراء`,
      color: "red", metrics,
      actions: [
        `${fmt(seg.lpv, 0)} زيارة من Meta وصلت الصفحة، ${seg.purchases} أوردر فقط (CR ${f2(seg.cr)}%). ${fmt(lostAtLpv, 0)} شخص دخل وخرج بدون شراء — الكريتف والاستهداف شغالين، الصفحة مش بتحوّل.`,
        `اعمل Screenshot من موبايل Android وشوف: هل زرّ الشراء والسعر ظاهرين Above the Fold (بدون Scroll)؟ لو لأ — بتخسر 40-60% من الزوار هناك.`,
        `أضف Social Proof فوري فوق الزرار: عدد الأوردرات ("وصلنا 3500 طلب") أو تقييم نجوم 4.8+. في السوق المصري ده بيرفع CR 25-45%.`,
        `جرّب "دفع عند الاستلام" كخيار — حتى لو بتأخذ مخاطرة أعلى، في السوق المصري بيضاعف CR في معظم المنتجات. اختبره لمدة 3 أيام وقيس الفرق.`,
      ],
    };
  }

  // يحتاج تحسين (CPA فوق الهدف)
  if (seg.cpa > CPA_SCALE_MAX) {
    const gap = Math.round(seg.cpa - CPA_SCALE_MAX);
    return {
      verdict: "improve", decision: "حسّن 🟡", mainIssue: `CPA ${fmt(seg.cpa, 0)} EGP — أعلى من الهدف بـ ${gap} EGP`,
      color: "amber", metrics,
      actions: [
        `CPA ${fmt(seg.cpa, 0)} EGP — فوق الـ ${CPA_SCALE_MAX} المستهدف بـ ${gap} EGP. الحملة مش خاسرة بس مش في نقطة الـ Scale بعد. في الغالب المشكلة في الجمهور أو أن الكريتف وصل لسقف كفاءته.`,
        `افتح Breakdown > Placement على مستوى هذا الـ Ad Set وشوف: هل Reels أو Feed أو Stories هو الأرخص CPA؟ حوّل الميزانية على الأكفأ وأغلق الباقي.`,
        `جرّب Lookalike 1% من قاعدة المشترين الحاليين بدل Interest Targeting. في السوق المصري ده بيخفض CPA بنسبة 15-30% في معظم المنتجات.`,
        `لو عدد التحويلات < 50 في 7 أيام — أنت لسه في Learning Phase. الـ Algorithm لسه بيتعلم ولم يصل للكفاءة القصوى. سيب يشتغل بدون تغيير يومين قبل أي قرار.`,
      ],
    };
  }

  return {
    verdict: "okay", decision: "مقبول ✅", mainIssue: "أداء مقبول — استمر بالرصد",
    color: "green", metrics,
    actions: [
      `الأرقام مقبولة على مستوى هذا الـ ${seg.key.startsWith("ad_") ? "Ad" : "Ad Set"}. مفيش مشكلة واضحة — لكن "مقبول" مش "ممتاز".`,
      `افتح Breakdown > Age وشوف لو فيه شريحة عمرية بـ CPA أقل. اعمل لها Ad Set منفصل بميزانية أعلى وضيّق الباقي.`,
    ],
  };
}

// ── Campaign-level diagnosis ───────────────────────────────────
export function diagnoseCampaign(totals: DerivedMetrics | undefined, daily: DailyPoint[]): CampaignDiag {
  if (!totals) {
    return { verdict: "nodata", decision: "لا توجد بيانات", problem: "لم يتم تحميل البيانات بعد", color: "gray", emoji: "⚪", funnel: [], metrics: [], actionPlan: ["أعد تحديث الصفحة."] };
  }

  const holdRate   = (totals.video_plays ?? 0) > 0 ? ((totals.v95 ?? 0) / totals.video_plays) * 100 : 0;
  const ctr2lp     = totals.link_clicks > 0 ? (totals.lpv / totals.link_clicks) * 100 : 0;
  const lostAtClk  = totals.link_clicks > 0 ? Math.round(totals.link_clicks * (1 - ctr2lp / 100)) : 0;
  const lostAtLpv  = totals.lpv > 0 ? totals.lpv - totals.purchases : 0;
  const cplpv      = totals.lpv > 0 ? totals.spend / totals.lpv : 0;
  const isVideo    = (totals.video_plays ?? 0) > 0;
  const isLearning = totals.purchases < 50;

  const funnel = [
    { label: "المشاهدات (Impressions)", value: fmt(totals.impressions), flag: "good" as Flag },
    ...(isVideo ? [
      { label: "Hook Rate (3ث — وقف السكرول)", value: `${f1(totals.hookRate)}%`, rate: `${f1(totals.hookRate)}%`, flag: flagPct(totals.hookRate, HOOK_MIN, 15) as Flag },
      ...(holdRate > 0 ? [{ label: "Hold Rate (ThruPlay 95%)", value: `${f1(holdRate)}%`, rate: `${f1(holdRate)}%`, flag: flagPct(holdRate, 25, 15) as Flag }] : []),
    ] : []),
    { label: "Outbound CTR (نقر للخروج)", value: `${f2(totals.ctr)}%`, rate: `${f2(totals.ctr)}%`, flag: flagPct(totals.ctr, 2, CTR_MIN) as Flag },
    { label: "Landing Page Rate (LPR)", value: ctr2lp > 0 ? `${f1(ctr2lp)}%` : "—", rate: `${f1(ctr2lp)}%`, flag: flagPct(ctr2lp, LPR_MIN, 50) as Flag },
    { label: "Conv. Rate — LPV→شراء", value: `${f2(totals.crLpv)}%`, rate: `${f2(totals.crLpv)}%`, flag: flagPct(totals.crLpv, CR_MIN, 1) as Flag },
  ];

  const metrics: Metric[] = [
    { label: "CPA",         value: totals.cpa > 0 ? `${fmt(totals.cpa, 0)} EGP` : "—", flag: totals.cpa > 0 ? flagCpa(totals.cpa) : "bad" },
    { label: "Spend",       value: `${fmt(totals.spend, 0)} EGP` },
    { label: "Purchases",   value: `${totals.purchases}`, flag: totals.purchases > 0 ? "good" : "bad" },
    { label: "Frequency",   value: f2(totals.frequency), flag: totals.frequency <= 2.5 ? "good" : totals.frequency <= 3.5 ? "warn" : "bad" },
    { label: "CPM",         value: `${fmt(totals.cpm, 0)} EGP`, flag: totals.cpm < 30 ? "good" : totals.cpm < 70 ? "warn" : "bad" },
    { label: "CPLPV",       value: cplpv > 0 ? `${f1(cplpv)} EGP` : "—", flag: cplpv > 0 ? (cplpv < 3 ? "good" : cplpv < 8 ? "warn" : "bad") : "bad" },
    { label: "Hook Rate",   value: `${f1(totals.hookRate)}%`, flag: flagPct(totals.hookRate, HOOK_MIN, 15) },
    ...(holdRate > 0 ? [{ label: "Hold Rate (95%)", value: `${f1(holdRate)}%`, flag: flagPct(holdRate, 25, 15) as Flag }] : []),
    { label: "CPC",         value: `${fmt(totals.cpc, 0)} EGP` },
    { label: "LPV",         value: fmt(totals.lpv) },
  ];

  if (totals.spend === 0) {
    return { verdict: "nodata", decision: "لا توجد بيانات", problem: "لا يوجد إنفاق في الفترة المحددة", color: "gray", emoji: "⚪", funnel, metrics,
      actionPlan: ["اختر فترة زمنية مختلفة أو تأكد من تشغيل الحملة وأنها لم تنتهِ ميزانيتها."] };
  }

  // ① Scale — CPA رابح
  if (totals.cpa > 0 && totals.cpa <= CPA_SCALE_MAX) {
    const freqWarning = totals.frequency > 2.8;
    return {
      verdict: "scale", decision: "Scale 🟢", problem: `CPA ${fmt(totals.cpa, 0)} EGP — الحملة رابحة${isLearning ? " (Learning Phase)" : ""}`,
      color: "green", emoji: "🟢", funnel, metrics,
      actionPlan: [
        `CPA ${fmt(totals.cpa, 0)} EGP — تحت الهدف بـ ${Math.round(CPA_SCALE_MAX - totals.cpa)} EGP. الحملة رابحة وجاهزة للتوسع. ${isLearning ? `⚠️ لسه في Learning Phase (${totals.purchases}/50 تحويل) — لا تعدّل أي شيء الآن، سيب Algorithm يكمل تعلمه.` : `الـ Algorithm خرج من Learning Phase ومستقر على الجمهور المثالي.`}`,
        ...(isLearning ? [
          `في Learning Phase: أي تعديل — حتى الميزانية بأكتر من 20% — بيُعيد العداد للصفر ويبدأ التعلم من جديد. الصبر هنا هو الاستراتيجية.`,
          `بعد وصول 50 تحويل: ابدأ رفع الميزانية 20% كل 48 ساعة، وفكر في الانتقال لـ Campaign Budget Optimization (CBO) لتوزيع أذكى.`,
        ] : [
          `زود الميزانية 20% كل 48 ساعة بالظبط — ليس 30% أو 50%. الـ Meta Algorithm حساس لتغييرات الميزانية الكبيرة وبيرجع للتعلم لو الزيادة كبيرة.`,
          ...(freqWarning ? [`⚠️ Frequency وصلت ${f2(totals.frequency)} — ابدأ في تجهيز كريتف بديل الآن. لما Fatigue يظهر ويكون الكريتف جاهز بتستبدل فوراً بدون إيقاف الحملة.`] : [
            `جهّز Lookalike 2% من المشترين كـ Ad Set إضافي في نفس الحملة (CBO) — لو الـ 1% بدأ يتشبع ينقل الميزانية للـ 2% أوتوماتيكياً.`,
          ]),
          `لو CPA تجاوز ${Math.round(CPA_SCALE_MAX * 1.15)} EGP بعد زيادة الميزانية — أوقف الزيادة وسيب الحملة تستقر يومين قبل أي قرار آخر.`,
        ]),
      ],
    };
  }

  // ② ميت Hook (VR < 15%) — أخطر من كريتف ضعيف
  if (isVideo && totals.hookRate < 15) {
    const skipPct = Math.round(100 - totals.hookRate);
    return {
      verdict: "creative", decision: "ميت Hook 💀", problem: `Hook Rate ${f1(totals.hookRate)}% — ${skipPct}% سكبوا في 3ث الأولى`,
      color: "red", emoji: "💀", funnel, metrics,
      actionPlan: [
        `Hook Rate ${f1(totals.hookRate)}% — من كل 100 شخص شاف الإعلان، ${skipPct} شخص سكب قبل ما يعدي 3 ثواني. ده مش إعلان ضعيف — ده إعلان مش بيوقف السكرول خالص. الـ Meta Algorithm يلاحظ نسبة الـ Skip ويرفع CPM تدريجياً عقاباً على جودة الكريتف المنخفضة.`,
        `أول 3 ثواني هي القرار الوحيد. الـ Pattern Interrupt الأكتر فاعلية على Meta حالياً: (1) وجه بنظرة مباشرة للكاميرا + سؤال "هل عندك مشكلة [X]؟"، (2) رقم صادم يخص الجمهور في الكادر الأول، (3) النتيجة/التحول قبل عرض المنتج.`,
        `جرّب UGC (Unboxing أو Testimonial حقيقي من عميل) — متوسط Hook Rate بتاع UGC على Meta 25-40% مقارنة بـ 8-15% للإعلانات المنتجة في نفس الـ Niche وهذا بيفسر الفارق الكبير في النتائج.`,
        `طريقة الـ A/B Test الأسرع: اعمل 3 إعلانات بنفس المنتج لكن Hook مختلف في كل واحد. كل Ad بميزانية 70 EGP/يوم، شغّل 3 أيام. الـ Hook الأعلى VR يكمل، الباقي يتوقف.`,
      ],
    };
  }

  // ③ إرهاق جمهور (Frequency عالية + CTR هابط)
  if (totals.frequency > 2.5 && isCtrDeclining(daily)) {
    return {
      verdict: "refresh", decision: "إرهاق جمهور 😴", problem: `Frequency ${f2(totals.frequency)} + CTR هابط — الجمهور محروق`,
      color: "yellow", emoji: "😴", funnel, metrics,
      actionPlan: [
        `Frequency ${f2(totals.frequency)} مع CTR هابط — نفس الجمهور شاف إعلانك ${f2(totals.frequency)} مرة في المتوسط وبدأ يتجاهله. ده مش مشكلة في المنتج أو الكريتف — مشكلة في تكرار التعرض وضيق Pool الجمهور.`,
        `الحل الفوري (48 ساعة): أضف Exclusion Audience في الـ Ad Set — استبعد "اشترى خلال آخر 60 يوم" + "زار الصفحة خلال آخر 30 يوم". ده بيخفض Frequency للجمهور الجديد بدون إيقاف الحملة.`,
        `الحل المتوسط (1 أسبوع): انقل لـ Advantage+ Audience (Broad Targeting) وخلّي الـ Meta يبحث عن جمهور مشابه بنفسه. في الغالب بيوصل لـ Pool أكبر بكتير من Interest Targeting وCPM أرخص.`,
        `اعمل كريتف جديد خالص بزاوية بيعية مختلفة — مش تعديل أو إعادة نشر. إعلان جديد كامل بـ Hook مختلف، مش نفس الإعلان بـ Thumbnail جديد.`,
      ],
    };
  }

  // ④ Hook Rate ضعيف (15-25%) — الكريتف مش بيوقف السكرول بكفاءة
  if (isVideo && totals.hookRate < HOOK_MIN) {
    return {
      verdict: "creative", decision: "Hook ضعيف 🔴", problem: `Hook Rate ${f1(totals.hookRate)}% — المطلوب +${HOOK_MIN}%`,
      color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        `Hook Rate ${f1(totals.hookRate)}% — أقل من المعيار (${HOOK_MIN}%). من كل 100 مشاهد، ${Math.round(100 - totals.hookRate)} شخص سكب في أول 3ث. الـ Meta Algorithm بيستخدم Hook Rate كمؤشر جودة — كل ما انخفض، رفع CPM بالتدريج (ده يفسر ارتفاع تكلفة الوصول مع الوقت).`,
        `أعد تصوير أول 3 ثواني فقط — مش كل الإعلان. الكادر الأول: وجه إنسان + صوت عالي واضح + مشكلة الجمهور بالاسم في أول جملة (بدون Logo أو Intro).`,
        `3 أنواع Hook الأقوى على Meta حالياً: (1) "أنت لسه بتعمل [خطأ شائع]؟" (2) "اكتشفنا إن [حقيقة غير متوقعة] عن [مشكلة الجمهور]" (3) نتيجة مدهشة قبل شرح المنتج.`,
        `اعمل A/B Test: نفس الإعلان بـ 3 Hook مختلفين، كل Hook في Ad منفصل تحت نفس الـ Ad Set. بعد 500 EGP إنفاق على كل واحد، شيّل الأدنى Hook Rate وضاعف ميزانية الأعلى.`,
      ],
    };
  }

  // ⑤ CTR منخفض (VR كويس، بس مش بيضغطوا)
  if (totals.ctr < CTR_MIN) {
    return {
      verdict: "creative", decision: "CTR منخفض 🔴", problem: `Outbound CTR ${f2(totals.ctr)}% — المطلوب +${CTR_MIN}%`,
      color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        `Outbound CTR ${f2(totals.ctr)}% — الناس بتشوف الإعلان (Hook Rate ${f1(totals.hookRate)}%) لكن مش بتضغط. الكريتف بيستحوذ الانتباه لكن الـ Offer أو الـ CTA مش بيخلق Action. المشكلة في الوسط أو النهاية مش في الـ Hook.`,
        `اختبر CTAs مختلفة: بدل "اطلب الآن / اشتري" جرّب (1) سؤال مباشر، (2) "شوف السعر" أو "احجز نسختك"، (3) إضافة Scarcity حقيقية "آخر [X] قطعة". الـ CTA الذي يثير فضول > الأمر المباشر في السوق المصري.`,
        `راجع الـ Offer نفسه: هل السعر ظاهر في الإعلان؟ السعر المخفي بيقلل الضغط. إظهار السعر بيفلتر جمهور غير مهتم ويجيب جمهور جاهز للشراء = CTR أقل لكن CR أعلى.`,
        `تحقق من موضع الـ CTA في الفيديو — لو الـ CTA في الدقيقة 1:30 وناس كتير بتسكب قبلها، انقل الـ CTA للـ 30 ثانية الأولى وضعّها مرتين.`,
      ],
    };
  }

  // ⑥ مشكلة تقنية (LPR)
  if (totals.ctr >= CTR_MIN && totals.lpv > 0 && ctr2lp < LPR_MIN) {
    return {
      verdict: "tech", decision: "مشكلة تقنية ⚙️", problem: `LPR ${f1(ctr2lp)}% — ${fmt(lostAtClk, 0)} نقرة دفعتها ضاعت`,
      color: "red", emoji: "⚙️", funnel, metrics,
      actionPlan: [
        `${fmt(totals.link_clicks, 0)} شخص ضغط على الإعلان، وصل منهم ${fmt(totals.lpv, 0)} للصفحة فقط (LPR ${f1(ctr2lp)}%). ${fmt(lostAtClk, 0)} شخص دفع Meta ثمن نقرتهم واختفوا — ده مش مشكلة كريتف أو استهداف، ده موقع بطيء أو Pixel مش شغال.`,
        `الاختبار الأهم والأسرع: افتح pagespeed.web.dev على رابط الإعلان من Mobile. لو Performance Score < 50 — الصفحة بطيئة وبتخسر نص النقرات. أسرع صفحات الـ Landing هي أهم استثمار تقني لأي حملة Meta.`,
        `ثبّت Meta Pixel Helper في Chrome وافتح الرابط. لازم يظهر PageView Event فوراً. لو مش بيظهر — الـ Pixel مش موجود أو مش مربوط على هذه الصفحة بالذات.`,
        `تحقق من إن الرابط مباشر بدون Redirects زيادة. كل Redirect Chain (bit.ly → landing.page → product) بيضيع 5-15% من الزوار على Android وأكتر على iOS 17 بسبب Tracking Prevention. استخدم الرابط النهائي مباشرةً.`,
        `فكّر في Conversion API (CAPI): إضافة Server-Side Tracking بيضيف 15-25% من الأحداث اللي Ad Blockers و iOS بتضيّعها. ده بيحسن بيانات الـ Algorithm ويخفض CPA تلقائياً.`,
      ],
    };
  }

  // ⑦ صفحة هبوط ضعيفة (CR منخفض)
  if (totals.crLpv < CR_MIN && totals.lpv > 20) {
    return {
      verdict: "landing", decision: "صفحة هبوط ضعيفة 🛒", problem: `CR ${f2(totals.crLpv)}% — ${fmt(lostAtLpv, 0)} زيارة بدون شراء`,
      color: "red", emoji: "🛒", funnel, metrics,
      actionPlan: [
        `${fmt(totals.lpv, 0)} زيارة من Meta وصلت الصفحة، وطلعت منهم ${totals.purchases} أوردر فقط (CR ${f2(totals.crLpv)}%). ${fmt(lostAtLpv, 0)} شخص دخل وخرج بدون شراء — الكريتف والاستهداف مظبوطين، الصفحة هي المشكلة.`,
        `اعمل Screenshot من Android عادي وشوف الصفحة: زرّ الشراء والسعر لازم يكونوا Above the Fold (بدون أي Scroll). لو مخفيين — بتخسر 40-60% من الزوار هناك مباشرةً.`,
        `أضف 3 عناصر Conversion فوق زرّ الشراء: (1) عدد الأوردرات السابقة ("3,500+ عميل سعيد")، (2) تقييم نجوم بصورة حقيقية، (3) ضمان صريح ("دفع عند الاستلام / استرداد 7 أيام"). هذه الـ 3 عناصر في السوق المصري بترفع CR بنسبة 30-60%.`,
        `احذف أي Navigation Menu أو روابط خارجية من الصفحة. كل رابط زيادة هو طريق للهروب بعيد عن الشراء.`,
        `جرّب "دفع عند الاستلام" كخيار إضافي — حتى لو بتأخذ مخاطرة أعلى في الإلغاء. في معظم المنتجات في مصر بيضاعف CR. اختبره لـ 72 ساعة وقيس.`,
      ],
    };
  }

  // ⑧ Pixel/Tracking issue (كريتف كويس، لا تحويلات)
  if (totals.purchases === 0 && totals.spend > 100 && totals.ctr >= CTR_MIN && totals.hookRate >= HOOK_MIN) {
    return {
      verdict: "tech", decision: "مشكلة Pixel 🔴", problem: `${fmt(totals.spend, 0)} EGP إنفاق — Pixel مش شغال`,
      color: "red", emoji: "⚙️", funnel, metrics,
      actionPlan: [
        `الكريتف جيد — Hook Rate ${f1(totals.hookRate)}%، CTR ${f2(totals.ctr)}% — الناس بتضغط ووصلوا للصفحة. لكن مفيش أوردر واحد مسجّل من ${fmt(totals.spend, 0)} EGP إنفاق. 95% من الحالات دي مشكلة Pixel مش مشكلة حملة.`,
        `افتح Meta Events Manager الآن > Test Events > ادخل رابط صفحة الشكر مباشرةً. لازم يظهر Purchase Event. لو مش بيظهر — الـ Pixel Code غايب من صفحة الشكر (Thank You Page). أضفه.`,
        `اعمل شراء تجريبي حقيقي بنفسك وتابع الـ Events Manager في نفس الوقت. لو الأوردر بيتكمل بس الـ Event مش بيوصل — المشكلة في Code Integration.`,
        `تحقق من إن الـ Ad Set محسّن على Purchase Event وليس Add to Cart أو Initiate Checkout — خطأ شائع بيودي إنفاق كبير على مراحل غير الشراء.`,
        `أضف Meta Conversions API (Server-Side) كطبقة إضافية فوق Browser Pixel — ده بيضيف 20-35% من الأحداث المفقودة بسبب iOS وAd Blockers.`,
      ],
    };
  }

  // ⑨ يحتاج تحسين (CPA فوق الهدف لكن مقبول)
  if (totals.purchases > 0 && totals.cpa > CPA_SCALE_MAX && totals.cpa <= CPA_IMPROVE_MAX) {
    const gap = Math.round(totals.cpa - CPA_SCALE_MAX);
    return {
      verdict: "refresh", decision: "يحتاج تحسين 🟡", problem: `CPA ${fmt(totals.cpa, 0)} EGP — فوق الهدف بـ ${gap} EGP`,
      color: "yellow", emoji: "🟡", funnel, metrics,
      actionPlan: [
        `CPA ${fmt(totals.cpa, 0)} EGP — فوق الـ ${CPA_SCALE_MAX} المستهدف بـ ${gap} EGP. الحملة مش خاسرة بس مش في نقطة الـ Scale بعد. ${isLearning ? `والأهم: لسه في Learning Phase (${totals.purchases}/50 تحويل) — الـ CPA هيتحسن أوتوماتيكياً لما تعدي 50 تحويل بدون أي تدخل.` : ""}`,
        `أسرع تحسين للـ CPA: افتح Breakdown على مستوى Ad Set > شوف أي Ad Set عنده CPA > ${CPA_IMPROVE_MAX} EGP > أوقفه فوراً وحوّل ميزانيته للأفضل. ده لوحده ممكن يخفض CPA الحملة كلها بـ 15-25%.`,
        `جرّب Lookalike 1% من قاعدة المشترين الحاليين بدل Interest Targeting. في السوق المصري Lookalike من قاعدة مشترين حقيقيين بيوصل لنتائج أفضل بـ 15-35% في معظم المنتجات.`,
        `افتح Placement Breakdown وشوف: Reels vs Feed vs Stories — في الغالب Reels بيجيب Hook Rate أعلى، Feed بيجيب CR أعلى. حوّل الميزانية على الـ Placement الأكثر كفاءة.`,
      ],
    };
  }

  return {
    verdict: "nodata", decision: "أداء مقبول 🟡", problem: "لا توجد مشكلة محددة — استمر بالرصد",
    color: "gray", emoji: "🟡", funnel, metrics,
    actionPlan: [
      `الحملة في منطقة الرصد — الأرقام مقبولة لكن مش استثنائية. CPA ${totals.cpa > 0 ? fmt(totals.cpa, 0) + " EGP" : "غير محدد"} مع ${totals.purchases} تحويل.`,
      `افتح Breakdown > Age & Gender وشوف لو فيه شريحة بـ CPA ممتاز مقارنة بالباقي. اعمل لها Ad Set منفصل بميزانية أعلى وضيّق الشرائح الأغلى.`,
      `افتح Placement Breakdown > قارن Reels vs Feed vs Stories vs Stories. في الغالب Placement واحد أو اثنين بيحقق 80% من النتائج. حوّل الميزانية عليهم وأغلق الباقي.`,
      `لو CPM مرتفع (> 70 EGP) — الجمهور ضيّق أو تنافسي. جرّب Advantage+ Audience (Broad) وخلّي Meta يبحث بنفسه عن أرخص جمهور مهتم.`,
    ],
  };
}

// ── Master runner ──────────────────────────────────────────────
export function runDiagnosis(insights: CampaignInsights): DiagnosisResult {
  return {
    campaign: diagnoseCampaign(insights.totals, insights.daily),
    adsets: insights.by_adset.map((seg) => ({ seg, diag: diagnoseSegment(seg) })),
    ads: insights.by_ad.map((seg) => ({ seg, diag: diagnoseSegment(seg) })),
  };
}

// ── UI Constants ──────────────────────────────────────────────
export const FLAG_TEXT: Record<Flag, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad:  "text-rose-600 dark:text-rose-400",
};

type ColorKey = "green" | "yellow" | "amber" | "red" | "gray";
export const COLOR_CFG: Record<ColorKey, { bg: string; border: string; text: string; badge: string }> = {
  green:  { bg: "bg-emerald-500/8",  border: "border-emerald-500/25", text: "text-emerald-600 dark:text-emerald-400", badge: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  yellow: { bg: "bg-amber-500/8",    border: "border-amber-500/25",   text: "text-amber-600 dark:text-amber-400",   badge: "bg-amber-500/20 text-amber-700 dark:text-amber-300" },
  amber:  { bg: "bg-amber-500/8",    border: "border-amber-500/25",   text: "text-amber-600 dark:text-amber-400",   badge: "bg-amber-500/20 text-amber-700 dark:text-amber-300" },
  red:    { bg: "bg-rose-500/8",     border: "border-rose-500/25",    text: "text-rose-600 dark:text-rose-400",     badge: "bg-rose-500/20 text-rose-700 dark:text-rose-300" },
  gray:   { bg: "bg-muted/20",       border: "border-border",         text: "text-muted-foreground",                badge: "bg-muted text-muted-foreground" },
};

// ── Shared UI components ──────────────────────────────────────
export function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-lg border border-border bg-muted/10 px-3 py-2">
          <div className="text-[10px] text-muted-foreground font-medium leading-tight">{m.label}</div>
          <div className={`text-sm font-bold font-mono mt-0.5 ${m.flag ? FLAG_TEXT[m.flag] : "text-foreground"}`} dir="ltr">{m.value}</div>
        </div>
      ))}
    </div>
  );
}

export function ActionList({ actions, color }: { actions: string[]; color: ColorKey }) {
  const cfg = COLOR_CFG[color];
  const [narrative, ...steps] = actions;
  return (
    <div className="space-y-2.5">
      {narrative && (
        <div className={`rounded-xl border p-3.5 ${cfg.bg} ${cfg.border}`}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">المشكلة</div>
          <p className="text-sm leading-relaxed">{narrative}</p>
        </div>
      )}
      {steps.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/10 p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">الحل</div>
          <ul className="space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className={`shrink-0 h-5 w-5 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5 ${cfg.badge}`}>{i + 1}</span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FunnelStep({ label, value, rate, flag, isLast }: { label: string; value: string; rate?: string; flag: Flag; isLast?: boolean }) {
  const dotCls = flag === "good" ? "bg-emerald-500" : flag === "warn" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-stretch gap-3">
      <div className="flex flex-col items-center gap-0">
        <div className={`h-3 w-3 rounded-full mt-0.5 shrink-0 ${dotCls}`} />
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-1" />}
      </div>
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          {rate && <span className={`text-xs font-bold font-mono ${FLAG_TEXT[flag]}`} dir="ltr">{rate}</span>}
        </div>
        <div className="text-sm font-semibold font-mono" dir="ltr">{value}</div>
      </div>
    </div>
  );
}

export function SegmentRow({ seg, diag, expanded, onToggle }: { seg: SegmentEntry; diag: SegDiag; expanded: boolean; onToggle: () => void }) {
  const cfg = COLOR_CFG[diag.color];
  const statusBadge = seg.effective_status ? (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${seg.effective_status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
      {seg.effective_status === "ACTIVE" ? "نشط" : seg.effective_status === "PAUSED" ? "موقوف" : seg.effective_status}
    </span>
  ) : null;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-right hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-md border ${cfg.bg} ${cfg.border} ${cfg.text}`}>{diag.decision}</span>
          <span className="text-xs truncate text-foreground font-medium">{seg.label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusBadge}
          <span className="text-[10px] text-muted-foreground font-mono" dir="ltr">{seg.cpa > 0 ? `${fmt(seg.cpa, 0)} EGP` : "—"}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border bg-muted/5 px-3 pt-3 pb-3 space-y-3">
          <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${cfg.bg} ${cfg.border} ${cfg.text}`}>{diag.mainIssue}</div>
          <MetricGrid metrics={diag.metrics} />
          {seg.issues && seg.issues.length > 0 && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-rose-600 dark:text-rose-400 mb-1">تحذيرات Meta</div>
              {seg.issues.map((iss, i) => <div key={i} className="text-xs text-rose-700 dark:text-rose-300">{iss.summary}</div>)}
            </div>
          )}
          <ActionList actions={diag.actions} color={diag.color} />
        </div>
      )}
    </div>
  );
}

export function CreativeTab({ ads }: { ads: Array<{ seg: SegmentEntry; diag: SegDiag }> }) {
  const sorted = [...ads].sort((a, b) => b.seg.spend - a.seg.spend);
  if (sorted.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات إعلانات</div>;
  return (
    <div className="space-y-2">
      {sorted.map(({ seg }) => {
        const hookFlag = seg.hookRate >= HOOK_MIN ? "good" : seg.hookRate >= 15 ? "warn" : "bad";
        const ctrFlag  = seg.ctr >= 2 ? "good" : seg.ctr >= CTR_MIN ? "warn" : "bad";
        const lpvRate  = seg.link_clicks > 0 ? (seg.lpv / seg.link_clicks) * 100 : 0;
        const lprFlag  = lpvRate >= LPR_MIN ? "good" : lpvRate >= 50 ? "warn" : "bad";
        const crFlag   = seg.cr >= CR_MIN ? "good" : seg.cr >= 1 ? "warn" : "bad";

        const weakest = [
          { flag: hookFlag, label: `Hook Rate ${seg.hookRate.toFixed(1)}%` },
          { flag: ctrFlag,  label: `CTR ${seg.ctr.toFixed(2)}%` },
          { flag: lprFlag,  label: `LPR ${lpvRate.toFixed(1)}%` },
          { flag: crFlag,   label: `CR ${seg.cr.toFixed(2)}%` },
        ].filter(x => x.flag === "bad").map(x => x.label);

        const overallFlag: Flag = weakest.length >= 2 ? "bad" : weakest.length === 1 ? "warn" : "good";

        return (
          <div key={seg.id} className="rounded-xl border border-border bg-muted/5 p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-semibold leading-tight flex-1">{seg.label}</div>
              <div className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${FLAG_TEXT[overallFlag]}`} dir="ltr">{fmt(seg.spend, 0)} EGP</div>
            </div>
            <div className="space-y-1.5">
              {[
                { label: "Hook Rate (3ث)", val: seg.hookRate, max: 50, flag: hookFlag, suffix: "%" },
                { label: "Outbound CTR",   val: seg.ctr,      max: 5,  flag: ctrFlag,  suffix: "%" },
                { label: "LPR",            val: lpvRate,      max: 100, flag: lprFlag, suffix: "%" },
                { label: "CR (LPV)",       val: seg.cr,       max: 10, flag: crFlag,   suffix: "%" },
              ].map(({ label, val, max, flag, suffix }) => (
                <div key={label}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-mono font-bold ${FLAG_TEXT[flag as Flag]}`} dir="ltr">{val.toFixed(1)}{suffix}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${flag === "good" ? "bg-emerald-500" : flag === "warn" ? "bg-amber-500" : "bg-rose-500"}`}
                      style={{ width: `${Math.min(100, (val / max) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {weakest.length > 0 && (
              <div className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                ⚠ يحتاج تحسين: {weakest.join(" · ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── DiagnosisModal ─────────────────────────────────────────────
export function DiagnosisModal({ insights, open, onClose, defaultTab = "campaign" }: { insights: CampaignInsights; open: boolean; onClose: () => void; defaultTab?: string }) {
  const result = useMemo(() => runDiagnosis(insights), [insights]);
  const [expandedAdset, setExpandedAdset] = useState<string | null>(null);
  const [expandedAd, setExpandedAd] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(defaultTab);
  const loggedRef = useRef<string | null>(null);

  useEffect(() => { if (open) setActiveTab(defaultTab); }, [open, defaultTab]);

  useEffect(() => {
    if (open && loggedRef.current !== insights.campaign.id) {
      loggedRef.current = insights.campaign.id;
      logDiagnosisRun(insights.campaign.name);
    }
    if (!open) loggedRef.current = null;
  }, [open, insights.campaign.id, insights.campaign.name]);

  const { campaign: camp } = result;
  const cfg = COLOR_CFG[camp.color];

  const campaignName = insights.campaign.name.length > 40
    ? insights.campaign.name.slice(0, 40) + "…"
    : insights.campaign.name;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setExpandedAdset(null); setExpandedAd(null); } }}>
      <DialogContent className="max-w-xl w-full max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Stethoscope className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">تشخيص الحملة — {campaignName}</span>
          </DialogTitle>
          <div className="text-[10px] text-muted-foreground">
            {insights.period.since} → {insights.period.until} · إنفاق: {fmt(insights.totals.spend, 0)} EGP · {insights.by_ad.length} إعلانات · {insights.by_adset.length} Ad Sets
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0 grid grid-cols-4 text-xs h-8">
            <TabsTrigger value="campaign" className="text-[11px]">الحملة</TabsTrigger>
            <TabsTrigger value="adsets" className="text-[11px]">Ad Sets ({result.adsets.length})</TabsTrigger>
            <TabsTrigger value="ads" className="text-[11px]">الإعلانات ({result.ads.length})</TabsTrigger>
            <TabsTrigger value="creative" className="text-[11px]">الكريتف</TabsTrigger>
          </TabsList>

          <TabsContent value="campaign" className="flex-1 overflow-y-auto space-y-4 mt-3 pb-2">
            <div className={`rounded-2xl border p-5 text-center ${cfg.bg} ${cfg.border}`}>
              <div className="text-4xl mb-2 select-none">{camp.emoji}</div>
              <div className={`text-2xl font-black tracking-tight ${cfg.text}`} dir="ltr">{camp.decision}</div>
              <div className="text-xs text-muted-foreground mt-1 font-medium">{camp.problem}</div>
            </div>

            <div className="rounded-xl border border-border bg-muted/5 px-4 pt-4 pb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">مسار القمع — Funnel</div>
              {camp.funnel.map((step, i) => (
                <FunnelStep key={step.label} {...step} isLast={i === camp.funnel.length - 1} />
              ))}
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">الأرقام الكاملة</div>
              <MetricGrid metrics={camp.metrics} />
            </div>

            <ActionList actions={camp.actionPlan} color={camp.color} />
          </TabsContent>

          <TabsContent value="adsets" className="flex-1 overflow-y-auto space-y-2 mt-3 pb-2">
            {result.adsets.length === 0
              ? <div className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات Ad Sets</div>
              : [...result.adsets]
                  .sort((a, b) => b.seg.spend - a.seg.spend)
                  .map(({ seg, diag }) => (
                    <SegmentRow
                      key={seg.id}
                      seg={seg}
                      diag={diag}
                      expanded={expandedAdset === seg.id}
                      onToggle={() => setExpandedAdset(expandedAdset === seg.id ? null : seg.id)}
                    />
                  ))
            }
          </TabsContent>

          <TabsContent value="ads" className="flex-1 overflow-y-auto space-y-2 mt-3 pb-2">
            {result.ads.length === 0
              ? <div className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات إعلانات</div>
              : [...result.ads]
                  .sort((a, b) => b.seg.spend - a.seg.spend)
                  .map(({ seg, diag }) => (
                    <SegmentRow
                      key={seg.id}
                      seg={seg}
                      diag={diag}
                      expanded={expandedAd === seg.id}
                      onToggle={() => setExpandedAd(expandedAd === seg.id ? null : seg.id)}
                    />
                  ))
            }
          </TabsContent>

          <TabsContent value="creative" className="flex-1 overflow-y-auto mt-3 pb-2">
            <CreativeTab ads={result.ads} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── CampaignDiagnosisModal — self-fetching wrapper ─────────────
export function CampaignDiagnosisModal({
  campaignId,
  accountId,
  since,
  until,
  open,
  onClose,
  defaultTab = "campaign",
}: {
  campaignId: string | null;
  accountId: string;
  since: string;
  until: string;
  open: boolean;
  onClose: () => void;
  defaultTab?: string;
}) {
  const query = useInsights({
    campaign_id: campaignId,
    ad_account_id: accountId,
    since,
    until,
  });

  if (!open) return null;

  if (query.isLoading) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-xl w-full" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Stethoscope className="h-4 w-4 text-primary" />
              جاري تحميل التشخيص…
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-3">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">جاري تحليل بيانات الحملة…</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (query.error || !query.data) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-xl w-full" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Stethoscope className="h-4 w-4 text-primary" />
              تعذّر تحميل البيانات
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground py-8 text-center">
            تعذّر تحميل بيانات الحملة. حاول مرة أخرى.
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <DiagnosisModal
      insights={query.data}
      open={open}
      onClose={onClose}
      defaultTab={defaultTab}
    />
  );
}
