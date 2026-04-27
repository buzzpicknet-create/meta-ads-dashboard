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
  const lpvRate = seg.link_clicks > 0 ? (seg.lpv / seg.link_clicks) * 100 : 0;
  const lostAtClick = seg.link_clicks > 0 ? Math.round(seg.link_clicks * (1 - lpvRate / 100)) : 0;
  const visitorsLost = seg.lpv > 0 ? seg.lpv - seg.purchases : 0;

  const metrics: Metric[] = [
    { label: "Spend", value: `${fmt(seg.spend, 0)} EGP` },
    { label: "Purchases", value: `${seg.purchases}`, flag: seg.purchases > 0 ? "good" : "bad" },
    { label: "CPA", value: seg.cpa > 0 ? `${fmt(seg.cpa, 0)} EGP` : "—", flag: seg.cpa > 0 ? flagCpa(seg.cpa) : "bad" },
    { label: "CTR", value: `${f2(seg.ctr)}%`, flag: flagPct(seg.ctr, 2, CTR_MIN) },
    { label: "Hook Rate", value: `${f1(seg.hookRate)}%`, flag: flagPct(seg.hookRate, HOOK_MIN, 15) },
    { label: "LPR", value: lpvRate > 0 ? `${f1(lpvRate)}%` : "—", flag: lpvRate > 0 ? flagPct(lpvRate, LPR_MIN, 50) : "bad" },
    { label: "CR (LPV)", value: seg.cr > 0 ? `${f2(seg.cr)}%` : "—", flag: seg.cr > 0 ? flagPct(seg.cr, CR_MIN, 1) : "bad" },
    { label: "Frequency", value: f2(seg.frequency), flag: seg.frequency <= 2.5 ? "good" : "bad" },
  ];

  if (seg.spend === 0) {
    return { verdict: "kill", decision: "أوقف", mainIssue: "لا يوجد إنفاق", color: "gray", metrics, actions: ["مفيش إنفاق — تحقق من حالة الـ Ad Set والميزانية."] };
  }
  if (seg.cpa > 0 && seg.cpa <= CPA_SCALE_MAX) {
    return {
      verdict: "scale", decision: "Scale 🟢", mainIssue: `CPA رابح — ${fmt(seg.cpa, 0)} EGP`, color: "green", metrics,
      actions: [
        `CPA ${fmt(seg.cpa, 0)} EGP — تحت الـ ${CPA_SCALE_MAX} المستهدف. هذا المستوى رابح وجاهز للتوسع.`,
        `زود ميزانية هذا الـ Ad Set 20% كل 48 ساعة. لا تلمس الكريتف ولا الاستهداف.`,
      ],
    };
  }
  if (seg.purchases === 0 && seg.spend > 100) {
    return {
      verdict: "kill", decision: "أوقف 🔴", mainIssue: `${fmt(seg.spend, 0)} EGP بدون أوردر`, color: "red", metrics,
      actions: [
        `${fmt(seg.spend, 0)} EGP إنفاق وصفر أوردرات من هذا المستوى. كل جنيه بيتحرق هنا من غير عائد.`,
        `أوقف هذا الـ Ad Set/Ad دلوقتي وحوّل ميزانيته للمستوى الأفضل أداءً.`,
      ],
    };
  }
  if (seg.cpa > CPA_IMPROVE_MAX) {
    return {
      verdict: "kill", decision: "أوقف 🔴", mainIssue: `CPA مرتفع جداً — ${fmt(seg.cpa, 0)} EGP`, color: "red", metrics,
      actions: [
        `CPA ${fmt(seg.cpa, 0)} EGP — أعلى من ${CPA_IMPROVE_MAX} EGP بكتير. كل أوردر بيكلفك خسارة مؤكدة.`,
        `أوقف هذا المستوى فوراً. لا تحاول تحسينه — أعد البناء من الصفر باستهداف مختلف.`,
      ],
    };
  }
  if (seg.hookRate < HOOK_MIN || seg.ctr < CTR_MIN) {
    const isHook = seg.hookRate < HOOK_MIN;
    return {
      verdict: "creative", decision: "كريتف ضعيف 🔴",
      mainIssue: isHook ? `Hook Rate ${f1(seg.hookRate)}% (المطلوب +${HOOK_MIN}%)` : `CTR ${f2(seg.ctr)}% (المطلوب +${CTR_MIN}%)`,
      color: "red", metrics,
      actions: [
        isHook
          ? `Hook Rate ${f1(seg.hookRate)}% — من كل 100 شاف الإعلان، ${Math.round(100 - seg.hookRate)} سكب في أول 3 ثواني. الكريتف مش بيجذب.`
          : `CTR ${f2(seg.ctr)}% — الناس شايفة الإعلان بس مش ضاغطة. الـ Copy أو الـ CTA مش مقنع.`,
        `أعد تصوير أول 3 ثواني. ابدأ بمشكلة الجمهور بالصوت مباشرة في الكادر الأول — لا Intro، لا شعار.`,
        `جرّب UGC (شخص بيتكلم للكاميرا) بدل الإعلان المنتج.`,
      ],
    };
  }
  if (lpvRate > 0 && lpvRate < LPR_MIN) {
    return {
      verdict: "tech", decision: "مشكلة تقنية 🔴", mainIssue: `LPR ${f1(lpvRate)}% — نقرات ضايعة`, color: "red", metrics,
      actions: [
        `${fmt(seg.link_clicks, 0)} نقرة على الإعلان، وصل منهم ${fmt(seg.lpv, 0)} للصفحة فقط (LPR ${f1(lpvRate)}%). ${fmt(lostAtClick, 0)} شخص ضاعوا في الطريق — ده مش كريتف، ده موقع بطيء أو رابط غلط.`,
        `افتح PageSpeed Insights على رابط الإعلان من الموبايل. لو Speed Score < 50 — الاستضافة هي المشكلة.`,
        `تأكد من الرابط في الإعلان نفسه — أحياناً Redirect بيخسر جزء من الزوار.`,
      ],
    };
  }
  if (seg.cr < CR_MIN && seg.lpv > 0) {
    return {
      verdict: "landing", decision: "صفحة هبوط 🔴", mainIssue: `CR ${f2(seg.cr)}% — الصفحة مش بتقنع`, color: "red", metrics,
      actions: [
        `${fmt(seg.lpv, 0)} زيارة للصفحة من هذا المستوى، وطلعت منهم ${seg.purchases} أوردر بس (CR ${f2(seg.cr)}%). ${fmt(visitorsLost, 0)} شخص دخل وخرج — الصفحة مش بتقنع.`,
        `زرّ الشراء لازم يكون أول حاجة بتتشوف على الموبايل قبل ما يسكرولوا. لو محتاجين يسكرولوا عشان يلاقوه — بتخسر نص الزيارات.`,
        `أضف جملة ضمان صغيرة جنب الزرار مباشرةً. ده بيرفع الثقة ويزود الـ CR.`,
      ],
    };
  }
  if (seg.cpa > CPA_SCALE_MAX) {
    const gap = Math.round(seg.cpa - CPA_SCALE_MAX);
    return {
      verdict: "improve", decision: "حسّن 🟡", mainIssue: `CPA ${fmt(seg.cpa, 0)} EGP — قابل للتحسين`, color: "amber", metrics,
      actions: [
        `CPA ${fmt(seg.cpa, 0)} EGP — فوق الـ ${CPA_SCALE_MAX} المستهدف بـ ${gap} EGP. الحملة مش خسارة بس مش في الوضع المثالي.`,
        `ضيّق الاستهداف — جرّب Lookalike 1% من قاعدة المشترين بدل Interest Targeting.`,
        `اختبر كريتف بزاوية مختلفة. الكريتف الحالي وصل لسقف كفاءته.`,
      ],
    };
  }
  return { verdict: "okay", decision: "مقبول ✅", mainIssue: "أداء مقبول", color: "green", metrics, actions: ["مفيش مشكلة واضحة — استمر بالرصد اليومي وابحث عن أفضل Ad Set عشان تزود ميزانيته."] };
}

// ── Campaign-level diagnosis ───────────────────────────────────
export function diagnoseCampaign(totals: DerivedMetrics | undefined, daily: DailyPoint[]): CampaignDiag {
  if (!totals) {
    return { verdict: "nodata", decision: "لا توجد بيانات", problem: "لم يتم تحميل البيانات بعد", color: "gray", emoji: "⚪", funnel: [], metrics: [], actionPlan: ["أعد تحديث الصفحة."] };
  }
  const holdRate = (totals.video_plays ?? 0) > 0 ? ((totals.v95 ?? 0) / totals.video_plays) * 100 : 0;
  const ctr2lp = totals.link_clicks > 0 ? (totals.lpv / totals.link_clicks) * 100 : 0;
  const lostAtHook = totals.impressions > 0 ? Math.round(totals.impressions * (1 - totals.hookRate / 100)) : 0;
  const lostAtClick = totals.link_clicks > 0 ? Math.round(totals.link_clicks * (1 - ctr2lp / 100)) : 0;

  const funnel = [
    { label: "المشاهدات", value: fmt(totals.impressions), flag: "good" as Flag },
    { label: "Hook Rate (3ث)", value: `${f1(totals.hookRate)}%`, rate: `${f1(totals.hookRate)}%`, flag: flagPct(totals.hookRate, HOOK_MIN, 15) },
    { label: "Outbound CTR", value: `${f2(totals.ctr)}%`, rate: `${f2(totals.ctr)}%`, flag: flagPct(totals.ctr, 2, CTR_MIN) },
    { label: "Landing Page Rate", value: `${f1(ctr2lp)}%`, rate: `${f1(ctr2lp)}%`, flag: flagPct(ctr2lp, LPR_MIN, 50) },
    { label: "Conversion Rate", value: `${f2(totals.crLpv)}%`, rate: `${f2(totals.crLpv)}%`, flag: flagPct(totals.crLpv, CR_MIN, 1) },
    { label: "Hold Rate (95%)", value: holdRate > 0 ? `${f1(holdRate)}%` : "—", flag: holdRate > 0 ? flagPct(holdRate, 25, 15) : ("bad" as Flag) },
  ];

  const metrics: Metric[] = [
    { label: "CPA", value: totals.cpa > 0 ? `${fmt(totals.cpa, 0)} EGP` : "—", flag: totals.cpa > 0 ? flagCpa(totals.cpa) : "bad" },
    { label: "Spend", value: `${fmt(totals.spend, 0)} EGP` },
    { label: "Purchases", value: `${totals.purchases}`, flag: totals.purchases > 0 ? "good" : "bad" },
    { label: "Frequency", value: f2(totals.frequency), flag: totals.frequency <= 2.5 ? "good" : "bad" },
    { label: "CPM", value: `${fmt(totals.cpm, 0)} EGP` },
    { label: "CPC", value: `${fmt(totals.cpc, 0)} EGP` },
    { label: "Link Clicks", value: fmt(totals.link_clicks) },
    { label: "LPV", value: fmt(totals.lpv) },
  ];

  if (totals.spend === 0) {
    return { verdict: "nodata", decision: "لا توجد بيانات", problem: "لا يوجد إنفاق في الفترة المحددة", color: "gray", emoji: "⚪", funnel, metrics, actionPlan: ["اختر فترة زمنية مختلفة أو تأكد من تشغيل الحملة."] };
  }

  if (totals.cpa > 0 && totals.cpa <= CPA_SCALE_MAX) {
    return {
      verdict: "scale", decision: "Scale", problem: "الحملة شغالة صح", color: "green", emoji: "🟢", funnel, metrics,
      actionPlan: [
        `CPA بـ ${fmt(totals.cpa, 0)} EGP — تحت الـ ${CPA_SCALE_MAX} المستهدف. الحملة رابحة وdّلوقتي هو وقت التوسع مش التجربة.`,
        `زود الميزانية 20% كل 48 ساعة بس — مش أكتر عشان مش تدخل Learning Phase من أول.`,
        `لا تلمس الكريتف ولا الاستهداف. أي تعديل دلوقتي ممكن يرمي الـ Algorithm في حلقة تعلم جديدة وترجع CPA للوراء.`,
        `لو CPA عدى ${CPA_SCALE_MAX + 5} EGP بعد الزيادة — وقّف الزيادة وسيب يستقر يومين.`,
      ],
    };
  }

  if (totals.frequency > 2.5 && isCtrDeclining(daily)) {
    return {
      verdict: "refresh", decision: "Ad Fatigue", problem: "تشبع الجمهور", color: "yellow", emoji: "🟡", funnel, metrics,
      actionPlan: [
        `Frequency وصلت ${f2(totals.frequency)} والـ CTR بيقل كل يوم — الجمهور شاف إعلانك أكتر من المطلوب وبدأ يتجاهله. مش مشكلة في الكريتف، مشكلة في التكرار.`,
        `أوقف الإعلانات اللي Frequency > 3.5 دلوقتي من داخل Ad Set.`,
        `اعمل كريتف جديد خالص — مش تعديل، مش تغيير ثامبنيل. زاوية بيعية مختلفة من الصفر.`,
        `وسّع الجمهور بـ Lookalike 2% بدل الـ 1% — أو أضف Interest Exclusions عشان تطرد المحروقين.`,
      ],
    };
  }

  if (totals.hookRate < HOOK_MIN || totals.ctr < CTR_MIN) {
    const isHookProblem = totals.hookRate < HOOK_MIN;
    const narrative = isHookProblem
      ? `الكريتف بيخسر الناس في أول 3 ثواني. Hook Rate ${f1(totals.hookRate)}% — من كل 100 مشاهدة، ${Math.round(100 - totals.hookRate)} شخص سكب قبل ما يكمل. المطلوب +${HOOK_MIN}%. المشكلة مش في المنتج، في أول جملة.`
      : `الناس بتشوف الإعلان بس مش بتضغط. CTR ${f2(totals.ctr)}% تحت الـ ${CTR_MIN}% المطلوب — يعني من كل 100 مشاهدة، أقل من واحد بيكبس. الإعلان مش بيخلق فضول كفاية.`;
    return {
      verdict: "creative", decision: "Improve Creative", problem: isHookProblem ? `كريتف ضعيف — Hook Rate ${f1(totals.hookRate)}%` : `CTR منخفض — ${f2(totals.ctr)}%`, color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        narrative,
        isHookProblem
          ? `أعد تصوير أول 3 ثواني بس. الكادر الأول لازم يطرح مشكلة الجمهور بالصوت مباشرة — لا Logo، لا Intro، لا موسيقى بدون كلام.`
          : `غيّر الـ CTA في الإعلان. بدل "اطلب دلوقتي" جرّب سؤال مباشر عن مشكلة بتخص الجمهور. الضغط بيجي من الفضول مش من الأمر.`,
        `اختبر UGC (شخص بيتكلم للكاميرا) بدل الإعلان المنتج — عادةً Hook Rate بيطلع ضعف.`,
      ],
    };
  }

  if (totals.ctr >= CTR_MIN && totals.lpv > 0 && ctr2lp < LPR_MIN) {
    return {
      verdict: "tech", decision: "Fix Tech", problem: `نقرات بدون وصول — LPR ${f1(ctr2lp)}%`, color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        `${fmt(totals.link_clicks, 0)} شخص ضغط على الإعلان، وصل منهم ${fmt(totals.lpv, 0)} بس للصفحة (LPR ${f1(ctr2lp)}%). يعني ${fmt(lostAtClick, 0)} شخص اتفقد في الطريق — ده مش كريتف، ده موقع بطيء أو رابط مكسور.`,
        `افتح PageSpeed Insights على رابط الإعلان على موبايل دلوقتي. لو Speed Score أقل من 50 — الاستضافة هي المشكلة الرئيسية.`,
        `افتح Meta Pixel Helper في المتصفح وادخل على الرابط. لو مفيش أحداث بتطلع — الـ Pixel نفسه مش شغال على هذه الصفحة.`,
        `لو الموقع سريع والـ Pixel شغال — تأكد من الرابط في الإعلان نفسه، ممكن يكون فيه Redirect بيضيع الـ UTM.`,
      ],
    };
  }

  if (totals.crLpv < CR_MIN && (totals.lpv > 0 || ctr2lp >= LPR_MIN)) {
    const visitorsLost = totals.lpv > 0 ? totals.lpv - totals.purchases : 0;
    return {
      verdict: "landing", decision: "Improve Landing Page", problem: `الصفحة مش بتقنع — CR ${f2(totals.crLpv)}%`, color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        `${fmt(totals.lpv, 0)} زيارة للصفحة وطلعت منهم ${totals.purchases} أوردر بس (CR ${f2(totals.crLpv)}%). يعني ${fmt(visitorsLost, 0)} شخص دخل وخرج بدون شراء — الصفحة مش بتقنع. الكريتف مش المشكلة.`,
        `زرّ الشراء لازم يكون أول حاجة بتتشوف على الموبايل قبل ما يسكرولوا. لو محتاجين يسكرولوا عشان يلاقوا الزرار — بتخسر نص الزيارات هناك.`,
        `أضف جملة ضمان صغيرة جنب زرّ الشراء مباشرةً — "ضمان استرداد 7 أيام" أو "دفع عند الاستلام". ده بيرفع CR 20-40%.`,
        `احذف أي Navigation Menu أو روابط خارجية من الصفحة — أي تشتيت بعيد عن الشراء بيكلفك.`,
      ],
    };
  }

  if (totals.purchases > 0 && totals.cpa > CPA_SCALE_MAX && totals.cpa <= CPA_IMPROVE_MAX) {
    const gap = Math.round(totals.cpa - CPA_SCALE_MAX);
    return {
      verdict: "refresh", decision: "حسّن الأداء", problem: `CPA بـ ${fmt(totals.cpa, 0)} EGP — قابل للتحسين`, color: "yellow", emoji: "🟡", funnel, metrics,
      actionPlan: [
        `الحملة بتحقق ${totals.purchases} أوردر بس CPA ${fmt(totals.cpa, 0)} EGP — فوق الـ ${CPA_SCALE_MAX} المستهدف بـ ${gap} EGP. مش خسارة بس كمان مش الوضع الأمثل. المشكلة غالباً في اتساع الجمهور أو الكريتف مش موجّه كفاية.`,
        `ضيّق الجمهور — اعمل Lookalike 1% من قاعدة المشترين الحاليين بدل Interest Targeting. ده عادةً بيخفض CPA 20-30%.`,
        `اختبر كريتف جديد بزاوية مختلفة — مش تغيير بسيط، بزاوية بيعية مختلفة. الكريتف الحالي وصل لسقفه.`,
        `لو CPA نزل تحت ${CPA_SCALE_MAX} — ابدأ تزود الميزانية 20% كل 48 ساعة.`,
      ],
    };
  }

  if (totals.purchases === 0 && totals.spend > 0 && totals.ctr >= CTR_MIN && totals.hookRate >= HOOK_MIN) {
    return {
      verdict: "tech", decision: "راجع التتبع", problem: `${fmt(totals.spend, 0)} EGP إنفاق بدون أوردر واحد`, color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        `الكريتف كويس — Hook Rate ${f1(totals.hookRate)}% والـ CTR ${f2(totals.ctr)}% — الناس بتضغط. بس مفيش أوردر واحد من ${fmt(totals.spend, 0)} EGP إنفاق. ده مش طبيعي. إما الـ Pixel مش بيسجّل الشراء، وإما الصفحة بتعطّل الطلب قبل الإتمام.`,
        `افتح Events Manager دلوقتي وشوف لو Purchase Event بيوصلك. لو لأ — الـ Pixel Code ناقص من صفحة الشكر.`,
        `اعمل شراء تجريبي حقيقي وشوف هو بيكمل ولا بيتعطل. ممكن الفورم نفسه فيه مشكلة أو الـ Payment Gateway بيرفض.`,
        `لو الـ Pixel سليم والطلبات بتكمل — اتحقق من Attribution Window في إعداد الإعلانات. ممكن أوردرات بتتعزى لحملة تانية.`,
      ],
    };
  }

  return {
    verdict: "nodata", decision: "أداء مقبول", problem: "لا توجد مشكلة محددة", color: "gray", emoji: "🟡", funnel, metrics,
    actionPlan: [
      `مفيش مشكلة واضحة دلوقتي — الحملة في منطقة الرصد. CPA ومؤشرات الفانل مقبولة بس مش استثنائية.`,
      `استمر بالرصد اليومي لـ CPA والـ CTR — لو حصل انحدار لأكتر من يومين متتاليين، راجع التشخيص بعد جمع بيانات أكتر.`,
      `افتح Breakdown على مستوى Ad Set وشوف لو فيه Ad Set بيسحب الميزانية بدون أداء — أوقفه وحوّل الميزانية للأفضل.`,
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
