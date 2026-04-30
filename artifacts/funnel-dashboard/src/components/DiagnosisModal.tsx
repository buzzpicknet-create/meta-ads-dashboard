import { useMemo, useState, useEffect, useRef } from "react";
import { logDiagnosisRun } from "@/hooks/use-activity-logger";
import { ChevronDown, Stethoscope, RefreshCw, Search, X } from "lucide-react";
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
const CPA_IMPROVE_MAX = 65;
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
function crTier(cr: number): { label: string; flag: Flag } {
  if (cr >= 5) return { label: "جيد ✅", flag: "good" };
  if (cr >= 4) return { label: "مقبول 🟡", flag: "warn" };
  if (cr >= 3) return { label: "محتاج تحسين 🟠", flag: "warn" };
  return { label: "محتاج تدخل فوري 🔴", flag: "bad" };
}

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
    { label: seg.cr > 0 ? `CR — ${crTier(seg.cr).label}` : "CR (LPV)", value: seg.cr > 0 ? `${f2(seg.cr)}%` : "—", flag: seg.cr > 0 ? crTier(seg.cr).flag : "bad" },
    { label: "Frequency",  value: f2(seg.frequency), flag: seg.frequency <= 2.5 ? "good" : seg.frequency <= 3.5 ? "warn" : "bad" },
    { label: "CPLPV",      value: cplpv > 0 ? `${f1(cplpv)} EGP` : "—", flag: cplpv > 0 ? (cplpv < 3 ? "good" : cplpv < 7 ? "warn" : "bad") : "bad" },
  ];

  if (seg.spend === 0) {
    return { verdict: "kill", decision: "موقوف ⏸", mainIssue: "لا يوجد إنفاق", color: "gray", metrics,
      actions: ["الحملة مش بتصرف أصلًا.", "تأكد إن الـ Ad Set شغال ومش معمول له Pause.", "راجع الميزانية وجدول التشغيل."] };
  }

  // Scale: CPA رابح
  if (seg.cpa > 0 && seg.cpa <= CPA_SCALE_MAX) {
    const isLearning = seg.purchases < 10;
    return {
      verdict: "scale", decision: "Scale 🟢", mainIssue: `CPA ${fmt(seg.cpa, 0)} EGP — رابح${isLearning ? " (لسه بيتعلم)" : ""}`,
      color: "green", metrics,
      actions: [
        `الحملة مستقرة وتقدر تبدأ تسكيل عليها.`,
        `زوّد الميزانية 20% كل شوية طالما الـ CPA ثابت.`,
        `خد الإعلانات اللي شغالة كويس واعمل لها حملة جديدة بميزانية منفصلة.`,
        `لو الـ CPA بدأ يعلى بعد التوسيع، ارجع للميزانية القديمة وسيب الحملة تهدى.`,
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
      actions: isTrackingIssue ? [
        `في إنفاق ومفيش طلبات، لكن الناس بتتفاعل مع الإعلان طبيعي.`,
        `غالبًا المشكلة في اللاندينج أو العروض والتسعير، راجع منافسيك.`,
        `اتأكد من لينك اللاندينج بيفتح كويس وإن مفيش مشاكل في اللاندينج.`,
      ] : isCreativeIssue ? [
        `الناس بتعمل تخطي للإعلان بسرعة جدًا، أول 3 ثواني ضعيفة.`,
        `ابدأ الفيديو بمشكلة العميل مباشرة أو لقطة تلفت الانتباه.`,
        `جرّب UGC (Unboxing أو Testimonial حقيقي من عميل).`,
        `اختبر أكتر من بداية للفيديو وشوف مين الأفضل.`,
      ] : [
        `${fmt(seg.spend, 0)} EGP إنفاق وصفر تحويلات من هذا المستوى. كل جنيه بيتحرق هنا بدون عائد.`,
        `راجع اللاندينج والعروض بتاعتك ومنافسيك.`,
      ],
    };
  }

  // CPA مرتفع جداً → وقّف
  if (seg.cpa > CPA_IMPROVE_MAX) {
    return {
      verdict: "kill", decision: "أوقف 🔴", mainIssue: `CPA ${fmt(seg.cpa, 0)} EGP — خسارة مؤكدة`,
      color: "red", metrics,
      actions: [
        `تكلفة الطلب عالية جدًا وبتخسّرك.`,
        `وقّف الخسارة وأوقفها لو الأداء بيضعف تدريجي.`,
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
        `بداية الفيديو مش قوية كفاية، الناس بتقفل بسرعة.`,
        `غيّر أول 3 ثواني فقط، مش لازم تعيد تصوير الفيديو كله.`,
        `ابدأ بحاجة تشد: (سؤال - مشكلة - نتيجة قوية).`,
        `اختبر أكتر من Hook وشوف مين بيشد الناس أكتر.`,
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
      actions: isHookWeak ? [
        `بداية الفيديو مش قوية كفاية، الناس بتقفل بسرعة.`,
        `غيّر أول 3 ثواني فقط، مش لازم تعيد تصوير الفيديو كله.`,
        `ابدأ بحاجة تشد: (سؤال - مشكلة - نتيجة قوية).`,
        `اختبر أكتر من Hook وشوف مين بيشد الناس أكتر.`,
      ] : [
        `جرّب طريقة كلام مختلفة أو زاوية مختلفة، ادي CTA في الفيديو واطلب دلوقتي، اعمل تحفيز للناس تاخد إجراء.`,
        `اختبر CTAs مختلفة: بدل "اطلب الآن / اشتري" جرّب سؤال مباشر، أو "شوف السعر"، أو إضافة Scarcity حقيقية.`,
      ],
    };
  }

  // مشكلة تقنية (LPR)
  if (lpvRate > 0 && lpvRate < LPR_MIN) {
    return {
      verdict: "tech", decision: "مشكلة تقنية 🔴", mainIssue: `LPR ${f1(lpvRate)}% — ${fmt(lostAtClk, 0)} نقرة ضاعت`,
      color: "red", metrics,
      actions: [
        `الناس بتضغط لكن الصفحة مبتحملش بسرعة، راجع الصور والميديا في الموقع لو حجمهم كبير أو اعمل فحص للصفحة وشوف بتحمل أكتر من 3 ثواني ولا لأ.`,
        `افتح pagespeed.web.dev على رابط الإعلان من Mobile. لو Performance Score < 50 — الصفحة بطيئة وبتخسر نص النقرات.`,
        `ثبّت Meta Pixel Helper في Chrome وافتح الرابط. لازم يظهر PageView Event فوراً.`,
        `تحقق من إن الرابط مباشر بدون Redirects زيادة.`,
      ],
    };
  }

  // صفحة هبوط (CR منخفض)
  if (seg.cr < CR_MIN && seg.lpv > 10) {
    return {
      verdict: "landing", decision: "صفحة هبوط ضعيفة 🔴", mainIssue: `CR ${f2(seg.cr)}% — ${fmt(lostAtLpv, 0)} زيارة بدون شراء`,
      color: "red", metrics,
      actions: [
        `الناس بتوصل الصفحة لكن مبتشتريش.`,
        `راجع أسعارك أو عروض بينك وبين المنافسين.`,
        `ضيف عناصر الضمان أو آراء عملاء.`,
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
        `راجع المنافسين وحاول توصل لعرض أفضل.`,
        `علشان تعوّض اللي هتقلل من بيعك حاول تعمل Upsell تزود بيه قيمة الطلب.`,
      ],
    };
  }

  return {
    verdict: "okay", decision: "مقبول ✅", mainIssue: "أداء مقبول — استمر بالرصد",
    color: "green", metrics,
    actions: [
      `الحملة في منطقة الرصد — الأرقام مقبولة لكن مش استثنائية.`,
      `لو مفيش تحسين خلال 48 ساعة من إطلاق الحملة — اعمل كريتف جديد خالص بزاوية بيعية مختلفة.`,
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
    { label: `Conv. Rate — LPV→شراء (${crTier(totals.crLpv).label})`, value: `${f2(totals.crLpv)}%`, rate: `${f2(totals.crLpv)}%`, flag: crTier(totals.crLpv).flag as Flag },
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
      actionPlan: isLearning ? [
        `الـ CPA كويس لكن الحملة لسه بتتعلم. متزوّدش الميزانية دلوقتي علشان الأداء ممكن يبوظ.`,
        `أي تعديل كبير دلوقتي هيخلي ميتا تبدأ تتعلم من الأول تاني، فسيب الحملة تستقر.`,
        `لما الـ CPA يبدأ يظبط معاك هتكون مستعد انك تزود ميزانيتك 20% كل شوية وتراقب لو الأمور تمام مستقرة هتزود كل شوية.`,
      ] : freqWarning ? [
        `الإعلان بدأ يتكرر على نفس الناس، وده ممكن يخلي الأداء يقع فجأة.`,
        `حضّر كريتف جديد من دلوقتي قبل ما الأداء يضرب.`,
        `بدّل الإعلان بسرعة أول ما تلاحظ الـ CTR بيقل أو الـ CPA بيعلى.`,
      ] : [
        `الحملة مستقرة وتقدر تبدأ تسكيل عليها.`,
        `زوّد الميزانية 20% كل شوية طالما الـ CPA ثابت.`,
        `خد الإعلانات اللي شغالة كويس واعمل لها حملة جديدة بميزانية منفصلة.`,
        `لو الـ CPA بدأ يعلى بعد التوسيع، ارجع للميزانية القديمة وسيب الحملة تهدى.`,
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
        `الناس بتعمل تخطي للإعلان بسرعة جدًا، أول 3 ثواني ضعيفة.`,
        `ابدأ الفيديو بمشكلة العميل مباشرة أو لقطة تلفت الانتباه.`,
        `جرّب UGC (Unboxing أو Testimonial حقيقي من عميل).`,
        `اختبر أكتر من بداية للفيديو وشوف مين الأفضل.`,
      ],
    };
  }

  // ③ إرهاق جمهور (Frequency عالية + CTR هابط)
  if (totals.frequency > 2.5 && isCtrDeclining(daily)) {
    return {
      verdict: "refresh", decision: "إرهاق جمهور 😴", problem: `Frequency ${f2(totals.frequency)} + CTR هابط — الجمهور محروق`,
      color: "yellow", emoji: "😴", funnel, metrics,
      actionPlan: [
        `الجمهور شاف الإعلان كتير وبدأ يتجاهله.`,
        `اعمل إعلان جديد بفكرة مختلفة، مش مجرد تعديل بسيط.`,
        `مش لازم توقف الحملة، ضيف الإعلان الجديد وسيب الاتنين يشتغلوا.`,
      ],
    };
  }

  // ④ Hook Rate ضعيف (15-25%) — الكريتف مش بيوقف السكرول بكفاءة
  if (isVideo && totals.hookRate < HOOK_MIN) {
    return {
      verdict: "creative", decision: "Hook ضعيف 🔴", problem: `Hook Rate ${f1(totals.hookRate)}% — المطلوب +${HOOK_MIN}%`,
      color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        `بداية الفيديو مش قوية كفاية، الناس بتقفل بسرعة.`,
        `غيّر أول 3 ثواني فقط، مش لازم تعيد تصوير الفيديو كله.`,
        `ابدأ بحاجة تشد: (سؤال - مشكلة - نتيجة قوية).`,
        `اختبر أكتر من Hook وشوف مين بيشد الناس أكتر.`,
      ],
    };
  }

  // ⑤ CTR منخفض (VR كويس، بس مش بيضغطوا)
  if (totals.ctr < CTR_MIN) {
    return {
      verdict: "creative", decision: "CTR منخفض 🔴", problem: `Outbound CTR ${f2(totals.ctr)}% — المطلوب +${CTR_MIN}%`,
      color: "red", emoji: "🔴", funnel, metrics,
      actionPlan: [
        `جرّب طريقة كلام مختلفة أو زاوية مختلفة، ادي CTA في الفيديو واطلب دلوقتي، اعمل تحفيز للناس تاخد إجراء.`,
        `اختبر CTAs مختلفة: بدل "اطلب الآن / اشتري" جرّب سؤال مباشر، أو "شوف السعر"، أو إضافة Scarcity حقيقية.`,
      ],
    };
  }

  // ⑥ مشكلة تقنية (LPR)
  if (totals.ctr >= CTR_MIN && totals.lpv > 0 && ctr2lp < LPR_MIN) {
    return {
      verdict: "tech", decision: "مشكلة تقنية ⚙️", problem: `LPR ${f1(ctr2lp)}% — ${fmt(lostAtClk, 0)} نقرة دفعتها ضاعت`,
      color: "red", emoji: "⚙️", funnel, metrics,
      actionPlan: [
        `الناس بتضغط لكن الصفحة مبتحملش بسرعة، راجع الصور والميديا في الموقع لو حجمهم كبير أو اعمل فحص للصفحة وشوف بتحمل أكتر من 3 ثواني ولا لأ.`,
        `افتح pagespeed.web.dev على رابط الإعلان من Mobile. لو Performance Score < 50 — الصفحة بطيئة وبتخسر نص النقرات.`,
        `ثبّت Meta Pixel Helper في Chrome وافتح الرابط. لازم يظهر PageView Event فوراً.`,
        `تحقق من إن الرابط مباشر بدون Redirects زيادة.`,
      ],
    };
  }

  // ⑦ صفحة هبوط ضعيفة (CR منخفض)
  if (totals.crLpv < CR_MIN && totals.lpv > 20) {
    return {
      verdict: "landing", decision: "صفحة هبوط ضعيفة 🛒", problem: `CR ${f2(totals.crLpv)}% — ${fmt(lostAtLpv, 0)} زيارة بدون شراء`,
      color: "red", emoji: "🛒", funnel, metrics,
      actionPlan: [
        `الناس بتوصل الصفحة لكن مبتشتريش.`,
        `راجع أسعارك أو عروض بينك وبين المنافسين.`,
        `ضيف عناصر الضمان أو آراء عملاء.`,
      ],
    };
  }

  // ⑧ Pixel/Tracking issue (كريتف كويس، لا تحويلات)
  if (totals.purchases === 0 && totals.spend > 100 && totals.ctr >= CTR_MIN && totals.hookRate >= HOOK_MIN) {
    return {
      verdict: "tech", decision: "مشكلة Pixel 🔴", problem: `${fmt(totals.spend, 0)} EGP إنفاق — Pixel مش شغال`,
      color: "red", emoji: "⚙️", funnel, metrics,
      actionPlan: [
        `الكريتف جيد — الناس بتضغط ووصلوا للصفحة. لكن مفيش أوردر واحد مسجّل. 95% من الحالات دي مشكلة منافسة أو سعر أو العروض مش مشكلة حملة.`,
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
        `حملة مش خسرانة، لكن لسه مش قوية كفاية للتوسيع.`,
        `اقفل الإعلانات الضعيفة وحوّل الميزانية للأفضل وابدأ جهّز كريتف جديدة بزوايا تانية.`,
      ],
    };
  }

  return {
    verdict: "nodata", decision: "أداء مقبول 🟡", problem: "لا توجد مشكلة محددة — فرصة للتحسين",
    color: "gray", emoji: "🟡", funnel, metrics,
    actionPlan: [
      `الحملة في منطقة الرصد — الأرقام مقبولة لكن مش استثنائية.`,
      `لو مفيش تحسين خلال 48 ساعة من إطلاق الحملة — اعمل كريتف جديد خالص بزاوية بيعية مختلفة.`,
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
  const [diagnosis, ...steps] = actions;
  return (
    <div className="space-y-3">
      {diagnosis && (
        <div className={`rounded-xl border-2 ${cfg.border} ${cfg.bg} p-4`}>
          <div className={`text-[9px] font-black uppercase tracking-widest mb-2.5 flex items-center gap-1.5 ${cfg.text}`}>
            <span>⚡</span>
            <span>التشخيص</span>
          </div>
          <p className="text-sm leading-[1.75] text-foreground">{diagnosis}</p>
        </div>
      )}
      {steps.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">📋 خطة العمل</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{steps.length} خطوات</span>
          </div>
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-start gap-4 px-4 py-3.5 ${i < steps.length - 1 ? "border-b border-border/50" : ""}`}
            >
              <div className={`shrink-0 w-7 h-7 rounded-full text-[11px] font-black flex items-center justify-center mt-0.5 leading-none ${cfg.badge}`}>
                {i + 1}
              </div>
              <p className="text-sm leading-[1.75] text-foreground flex-1">{step}</p>
            </div>
          ))}
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
  const isActive = seg.effective_status === "ACTIVE";

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${expanded ? cfg.border : "border-border"}`}>
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-right hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        {/* Verdict badge */}
        <span className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-lg border ${cfg.bg} ${cfg.border} ${cfg.text} leading-none`}>
          {diag.decision}
        </span>
        {/* Name */}
        <span className="flex-1 text-xs text-foreground font-medium truncate min-w-0">{seg.label}</span>
        {/* Mini stats */}
        <div className="flex items-center gap-2 shrink-0">
          {seg.effective_status && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isActive ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted/50 text-muted-foreground"}`}>
              {isActive ? "نشط" : "موقوف"}
            </span>
          )}
          {seg.hookRate > 0 && (
            <span className={`text-[10px] font-mono font-bold ${seg.hookRate >= 25 ? "text-emerald-600 dark:text-emerald-400" : seg.hookRate >= 15 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`} dir="ltr">
              VR {seg.hookRate.toFixed(0)}%
            </span>
          )}
          <span className={`text-[10px] font-mono font-bold ${seg.cpa > 0 && seg.cpa <= 45 ? "text-emerald-600 dark:text-emerald-400" : seg.cpa <= 80 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`} dir="ltr">
            {seg.cpa > 0 ? `${fmt(seg.cpa, 0)} EGP` : "—"}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border bg-card px-3 pt-3 pb-4 space-y-3">
          {/* Main issue */}
          <div className={`rounded-lg border-2 px-3 py-2.5 ${cfg.bg} ${cfg.border}`}>
            <div className={`text-[9px] font-black uppercase tracking-widest mb-1 ${cfg.text}`}>المشكلة الرئيسية</div>
            <div className={`text-xs font-bold leading-snug ${cfg.text}`}>{diag.mainIssue}</div>
          </div>
          {/* Metrics */}
          <MetricGrid metrics={diag.metrics} />
          {/* Meta warnings */}
          {seg.issues && seg.issues.length > 0 && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2.5">
              <div className="text-[9px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-1.5">⚠ تحذيرات Meta</div>
              {seg.issues.map((iss, i) => <div key={i} className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">{iss.summary}</div>)}
            </div>
          )}
          {/* Action plan */}
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

// ── Performance Comparison Tab ─────────────────────────────────
type CompareMode = "1d" | "3d" | "custom";
type SegScope = "campaign" | "adset" | "ad";

interface PeriodMetrics {
  spend: number; cpa: number; ctr: number; cr: number;
  cpm: number; purchases: number; lpv: number;
}

function segToMetrics(seg: SegmentEntry): PeriodMetrics {
  const cpm = seg.impressions > 0 ? (seg.spend / seg.impressions) * 1000 : 0;
  return { spend: seg.spend, purchases: seg.purchases, cpa: seg.cpa, ctr: seg.ctr, cr: seg.cr, cpm, lpv: seg.lpv };
}

function aggregateDaily(days: DailyPoint[]): PeriodMetrics {
  const spend      = days.reduce((s, d) => s + d.spend, 0);
  const purchases  = days.reduce((s, d) => s + d.purchases, 0);
  const lpv        = days.reduce((s, d) => s + d.lpv, 0);
  const impressions = days.reduce((s, d) => s + d.impressions, 0);
  const link_clicks = days.reduce((s, d) => s + d.link_clicks, 0);
  return {
    spend, purchases, lpv,
    cpa: purchases > 0 ? spend / purchases : 0,
    ctr: impressions > 0 ? (link_clicks / impressions) * 100 : 0,
    cr:  lpv > 0 ? (purchases / lpv) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
  };
}

interface TurningPoint { day: string; metric: string; direction: "up" | "down"; pct: number }

function findTurningPoint(daily: DailyPoint[]): TurningPoint | null {
  if (daily.length < 3) return null;
  let maxChange = 0;
  let result: TurningPoint | null = null;
  for (let i = 1; i < daily.length; i++) {
    const prev = daily[i - 1];
    const curr = daily[i];
    if (prev.purchases > 0 && curr.purchases > 0 && prev.cpa > 0) {
      const pct = ((curr.cpa - prev.cpa) / prev.cpa) * 100;
      if (pct > 15 && Math.abs(pct) > maxChange) {
        maxChange = Math.abs(pct);
        result = { day: curr.day, metric: "CPA", direction: "up", pct: Math.round(pct) };
      }
    }
    const prevCtr = prev.impressions > 0 ? (prev.link_clicks / prev.impressions) * 100 : 0;
    const currCtr = curr.impressions > 0 ? (curr.link_clicks / curr.impressions) * 100 : 0;
    if (prevCtr > 0) {
      const pct = ((currCtr - prevCtr) / prevCtr) * 100;
      if (pct < -15 && Math.abs(pct) > maxChange) {
        maxChange = Math.abs(pct);
        result = { day: curr.day, metric: "CTR", direction: "down", pct: Math.round(Math.abs(pct)) };
      }
    }
    const prevCr = prev.lpv > 0 ? (prev.purchases / prev.lpv) * 100 : 0;
    const currCr = curr.lpv > 0 ? (curr.purchases / curr.lpv) * 100 : 0;
    if (prevCr > 0) {
      const pct = ((currCr - prevCr) / prevCr) * 100;
      if (pct < -20 && Math.abs(pct) > maxChange) {
        maxChange = Math.abs(pct);
        result = { day: curr.day, metric: "Conv. Rate", direction: "down", pct: Math.round(Math.abs(pct)) };
      }
    }
  }
  return result;
}

interface Insight { icon: string; text: string }

function generateAnalysis(
  current: PeriodMetrics,
  previous: PeriodMetrics,
  turning: TurningPoint | null,
): Insight[] {
  if (previous.spend === 0) return [];

  const d = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;
  const cpaDelta  = d(current.cpa,       previous.cpa);
  const ctrDelta  = d(current.ctr,       previous.ctr);
  const crDelta   = d(current.cr,        previous.cr);
  const cpmDelta  = d(current.cpm,       previous.cpm);
  const purchDelta = d(current.purchases, previous.purchases);
  const spendDelta = d(current.spend,    previous.spend);

  const abs = Math.round;
  const insights: Insight[] = [];

  // ── كل حاجة تحسّنت ──────────────────────────────────────────
  if (cpaDelta < -10 && ctrDelta > 5 && crDelta > 5) {
    insights.push({ icon: "🚀", text: `الحملة شغالة في أحسن حالاتها — الـ CPA نزل ${abs(Math.abs(cpaDelta))}%، الـ CTR تحسّن ${abs(ctrDelta)}%، والـ Conversion Rate زاد ${abs(crDelta)}%. ده وقت مثالي تفكر فيه في التوسيع تدريجياً.` });
    insights.push({ icon: "💡", text: "زوّد الميزانية 20% وراقب 48 ساعة — لو الـ CPA فضل تمام، كرر. ما تتسرعش وتضاعف دفعة واحدة عشان الـ Algorithm هيعيد التعلم." });
    return insights;
  }

  // ── CPA ارتفع + CR انخفض → مشكلة لاندينج أو منافسة ──────────
  if (cpaDelta > 15 && crDelta < -10) {
    insights.push({ icon: "🔍", text: `الـ CPA ارتفع ${abs(cpaDelta)}% مع انخفاض الـ Conversion Rate ${abs(Math.abs(crDelta))}% — ده بيقولك إن الناس لسه بيجوا على صفحتك لكن مبيشتروش زي الأول. المشكلة مش في الإعلان.` });
    insights.push({ icon: "⚔️", text: "أغلب الأسباب: منافس ظهر بسعر أقل أو عرض أقوى. افتح موقع منافسيك دلوقتي وشوف لو في تخفيض أو عرض جديد في الفترة دي. لو لقيت، لازم ترد عليه قبل ما يأكل سوقك." });
    insights.push({ icon: "🛠️", text: "حل سريع: قوّي عرضك في اللاندينج — ضمان واضح، شحن مجاني لو ممكن، أو عرض لفترة محدودة. غيّر الـ Headline للأكثر تركيزاً على الفايدة مش المنتج." });
    return insights;
  }

  // ── CTR انخفض + CPA ارتفع → تعب الكريتف ────────────────────
  if (ctrDelta < -15 && cpaDelta > 5) {
    insights.push({ icon: "😴", text: `الـ CTR نزل ${abs(Math.abs(ctrDelta))}% — الميديا بدأت تفقد تأثيرها. الناس بتشوف الإعلان ومش بتتفاعل زي أول، وده أوضح علامة على تعب الكريتف.` });
    if (cpmDelta > 10) {
      insights.push({ icon: "📈", text: `الـ CPM كمان ارتفع ${abs(cpmDelta)}% — يعني الـ Algorithm بيتعب أكتر عشان يوصّل إعلانك لنفس الناس بسبب تراجع التفاعل. ده بيرفع تكلفتك أكتر.` });
    }
    insights.push({ icon: "🎬", text: "الحل اللي بيشتغل: كريتف جديد بزاوية مختلفة خالص — مش تعديل بسيط، بداية جديدة. جرّب افتتاحية بالمشكلة أو بنتيجة العميل مباشرة. الـ Hook الأولى 3 ثواني هي اللي بتحدد كل حاجة." });
    return insights;
  }

  // ── CTR انخفض وحده بدون تأثير كبير على CPA ─────────────────
  if (ctrDelta < -10 && Math.abs(cpaDelta) < 10) {
    insights.push({ icon: "⚠️", text: `الـ CTR بدأ ينزل ${abs(Math.abs(ctrDelta))}% لكن الـ CPA لسه ثابت — ده إنذار مبكر. لو فضل الـ CTR ينزل، الـ CPA هيتأثر بعدين.` });
    insights.push({ icon: "🕐", text: "عندك وقت تتحرك دلوقتي قبل ما تحسّها على الـ CPA. ابدأ تجهّز كريتف بديل أو جرّب Hook جديد على نفس الإعلان (أول 3 ثواني بس)." });
    return insights;
  }

  // ── CPM ارتفع بشكل واضح مع ثبات CTR و CR ────────────────────
  if (cpmDelta > 25 && Math.abs(ctrDelta) < 10 && Math.abs(crDelta) < 10) {
    insights.push({ icon: "💰", text: `الـ CPM ارتفع ${abs(cpmDelta)}% لكن الـ CTR والـ CR ثابتين — المشكلة مش في إعلانك. المزاد أشرس. منافسين زادوا ميزانياتهم أو في موسم زيادة إنفاق على الجمهور ده.` });
    insights.push({ icon: "🧭", text: "في الحالة دي، ما تتفرنشش على الكريتف. الكريتف تمام. فكّر في توسيع الـ Audience أو تجربة Lookalike جديد عشان تلاقي تخفيض في CPM." });
    return insights;
  }

  // ── CPA ارتفع + CPM ارتفع + CTR و CR ثابت → مشكلة المزاد ───
  if (cpaDelta > 15 && cpmDelta > 15 && Math.abs(ctrDelta) < 10 && Math.abs(crDelta) < 10) {
    insights.push({ icon: "🏛️", text: `الـ CPA ارتفع ${abs(cpaDelta)}% بسبب الـ CPM اللي ارتفع ${abs(cpmDelta)}% — والـ CTR والـ CR لسه زي الأول. ده معناه إن مشكلتك في المزاد مش في الكريتف ولا اللاندينج.` });
    insights.push({ icon: "🎯", text: "الحل: جرّب Advantage+ Audience (Broad) عشان الـ Algorithm يلاقي جمهور بـ CPM أرخص. كمان راجع Placement — ممكن Reels أرخص من Feed في الفترة دي." });
    return insights;
  }

  // ── الأوردرات قلّت بشكل كبير ──────────────────────────────
  if (purchDelta < -30 && current.purchases > 0) {
    insights.push({ icon: "📉", text: `الأوردرات نزلت ${abs(Math.abs(purchDelta))}% — رقم محتاج وقفة وتحليل.` });
    if (cpaDelta > 15) {
      insights.push({ icon: "🚨", text: `والـ CPA كمان ارتفع ${abs(cpaDelta)}% — ده مش مجرد تقلب طبيعي. الحملة بتعاني على جانبين: الحجم والكفاءة في نفس الوقت. راجع كل المقاييس من التشخيص الأساسي.` });
    } else {
      insights.push({ icon: "🔎", text: "الـ CPA لسه معقول لكن الحجم قلّ. ممكن الـ Budget اتقلّص أو الجمهور اتشبّع. فكّر في توسيع الـ Audience أو رفع الميزانية شوية وشوف لو الـ Volume يرجع." });
    }
    return insights;
  }

  // ── CPA ارتفع ارتفاع خفيف ──────────────────────────────────
  if (cpaDelta > 5 && cpaDelta <= 15) {
    insights.push({ icon: "👀", text: `الـ CPA ارتفع ${abs(cpaDelta)}% — ارتفاع خفيف، لسه في المنطقة المقبولة. مش وقت الذعر لكن وقت الانتباه.` });
    insights.push({ icon: "⏱️", text: "راقب خلال 24-48 ساعة الجاية — لو استمر في الارتفاع ابدأ تتحرك (راجع الكريتف والـ Audience). لو استقر أو رجع يبقى تقلب طبيعي." });
    if (spendDelta > 20) {
      insights.push({ icon: "💡", text: `لاحظت إن الإنفاق زاد ${abs(spendDelta)}% في نفس الوقت — ممكن الارتفاع في الـ CPA مجرد نتيجة زيادة الميزانية وإن الـ Algorithm لسه بيتكيف.` });
    }
    return insights;
  }

  // ── CPA تحسّن وحده ─────────────────────────────────────────
  if (cpaDelta < -10) {
    insights.push({ icon: "✅", text: `الـ CPA نزل ${abs(Math.abs(cpaDelta))}% — تحسن واضح في الكفاءة.` });
    if (purchDelta > 10) {
      insights.push({ icon: "🚀", text: `والأوردرات زادت ${abs(purchDelta)}% كمان — ده أفضل سيناريو. الحملة في حالة ممتازة للتوسيع التدريجي.` });
    } else {
      insights.push({ icon: "🔬", text: "الكفاءة بتتحسن لكن الحجم لسه ثابت. فضّل تراقب يومين قبل ما تزوّد الميزانية — عشان تتأكد إن التحسين حقيقي ومش مجرد يوم كويس." });
    }
    return insights;
  }

  // ── أداء مستقر بدون تغيير جوهري ───────────────────────────
  insights.push({ icon: "📊", text: "الأداء مستقر بشكل عام بين الفترتين — مفيش تغيير جوهري في أي مقياس رئيسي." });
  insights.push({ icon: "🧐", text: "الاستقرار مش دايماً خبر سيء — لكن دي فرصة تاخد فيها initiative وتجرب كريتف جديد أو audience جديد قبل ما الأداء يبدأ يتراجع." });

  if (turning) {
    insights.push({ icon: "📍", text: `لاحظت إن في نقطة تحول في ${turning.day} — ${turning.metric} ${turning.direction === "up" ? "ارتفع" : "انخفض"} فجأة ${turning.pct}%. ده يستحق تراجع في الإعلانات أو التغييرات اللي حصلت في اليوم ده.` });
  }

  return insights;
}

function PerformanceCompareTab({
  daily,
  currentAdsets,
  currentAds,
  campaignId,
  accountId,
  until,
}: {
  daily: DailyPoint[];
  currentAdsets: Array<{ seg: SegmentEntry; diag: SegDiag }>;
  currentAds:    Array<{ seg: SegmentEntry; diag: SegDiag }>;
  campaignId:  string | null;
  accountId:   string | undefined;
  until:       string;
}) {
  const [mode, setMode] = useState<CompareMode>("3d");
  const [customDays, setCustomDays] = useState(7);
  const [segScope, setSegScope]   = useState<SegScope>("campaign");
  const [segSearch, setSegSearch] = useState("");
  const [selectedSeg, setSelectedSeg] = useState<string | null>(null);

  // Reset segment selection when scope changes
  useEffect(() => { setSelectedSeg(null); setSegSearch(""); }, [segScope]);

  const sorted = useMemo(() => [...daily].sort((a, b) => a.day.localeCompare(b.day)), [daily]);
  const windowSize = mode === "1d" ? 1 : mode === "3d" ? 3 : customDays;

  const currentDays  = useMemo(() => sorted.slice(-windowSize), [sorted, windowSize]);
  const previousDays = useMemo(() => sorted.slice(-(windowSize * 2), -windowSize), [sorted, windowSize]);

  // ── Campaign-level metrics from daily data ──
  const dailyCurrent  = useMemo(() => aggregateDaily(currentDays),  [currentDays]);
  const dailyPrevious = useMemo(() => aggregateDaily(previousDays), [previousDays]);

  // ── Sub-period date ranges for adset/ad mode ──
  const { subCurrentSince, subPrevSince, subPrevUntil } = useMemo(() => {
    if (!until) return { subCurrentSince: "", subPrevSince: "", subPrevUntil: "" };
    const untilD = new Date(until);
    const curSince = new Date(untilD.getTime() - (windowSize - 1) * 86400000);
    const prevUntilD = new Date(curSince.getTime() - 86400000);
    const prevSinceD = new Date(prevUntilD.getTime() - (windowSize - 1) * 86400000);
    return {
      subCurrentSince: curSince.toISOString().slice(0, 10),
      subPrevSince:    prevSinceD.toISOString().slice(0, 10),
      subPrevUntil:    prevUntilD.toISOString().slice(0, 10),
    };
  }, [until, windowSize]);

  // Only fetch sub-period data when a segment is actually selected (avoids flooding Meta API)
  const segEnabled = segScope !== "campaign" && selectedSeg !== null && Boolean(campaignId) && Boolean(accountId) && Boolean(until) && Boolean(subCurrentSince) && Boolean(subPrevSince);
  const subCurrentQuery = useInsights({ campaign_id: segEnabled ? campaignId : null, ad_account_id: accountId, since: subCurrentSince || "2000-01-01", until: until || "2000-01-01" });
  const subPrevQuery    = useInsights({ campaign_id: segEnabled ? campaignId : null, ad_account_id: accountId, since: subPrevSince    || "2000-01-01", until: subPrevUntil    || "2000-01-01" });

  // ── Segment-level metrics ──
  const segList = segScope === "adset" ? currentAdsets : currentAds;
  const filteredSegs = useMemo(
    () => segList.filter(({ seg }) => !segSearch || seg.label.toLowerCase().includes(segSearch.toLowerCase())),
    [segList, segSearch],
  );

  // In adset/ad mode use sub-period fetched data; fall back to full-period data while loading
  const subCurrentSegs: SegmentEntry[] = segScope === "adset"
    ? (subCurrentQuery.data?.by_adset ?? [])
    : (subCurrentQuery.data?.by_ad    ?? []);
  const subPrevSegs: SegmentEntry[] = segScope === "adset"
    ? (subPrevQuery.data?.by_adset ?? [])
    : (subPrevQuery.data?.by_ad    ?? []);

  const currentSeg: SegmentEntry | null = selectedSeg
    ? (segScope !== "campaign"
        ? (subCurrentSegs.find(s => s.id === selectedSeg) ?? segList.find(({ seg }) => seg.id === selectedSeg)?.seg ?? null)
        : null)
    : null;
  const prevSeg: SegmentEntry | null = selectedSeg
    ? (segScope !== "campaign"
        ? (subPrevSegs.find(s => s.id === selectedSeg) ?? null)
        : null)
    : null;

  // Use segment metrics when a segment is selected, otherwise use daily aggregation
  const current  = currentSeg ? segToMetrics(currentSeg)  : dailyCurrent;
  const previous = prevSeg    ? segToMetrics(prevSeg)      : (segScope === "campaign" ? dailyPrevious : null);

  const turning  = useMemo(() => findTurningPoint(sorted), [sorted]);
  const analysis = useMemo(() => {
    if (!previous) return [];
    return generateAnalysis(current, previous, segScope === "campaign" ? turning : null);
  }, [current, previous, segScope, turning]);

  const isSegLoading = segEnabled && selectedSeg !== null && (subCurrentQuery.isFetching || subPrevQuery.isFetching);
  const isSegError   = segEnabled && selectedSeg !== null && !isSegLoading && (subCurrentQuery.isError || subPrevQuery.isError);
  const hasPrev = segScope === "campaign"
    ? previousDays.length > 0
    : (prevSeg !== null && !isSegLoading && !isSegError);

  const prev0 = previous ?? { spend: 0, purchases: 0, cpa: 0, ctr: 0, cr: 0, cpm: 0, lpv: 0 };
  const rows: { label: string; curr: string; prev: string; delta: number | null; lowerBetter: boolean | null }[] = [
    { label: "CPA",        curr: current.cpa > 0 ? `${Math.round(current.cpa)} EGP` : "—",        prev: prev0.cpa > 0 ? `${Math.round(prev0.cpa)} EGP` : "—",       delta: current.cpa > 0 && prev0.cpa > 0 ? (current.cpa - prev0.cpa) / prev0.cpa * 100 : null, lowerBetter: true  },
    { label: "CTR",        curr: `${current.ctr.toFixed(2)}%`,                                     prev: `${prev0.ctr.toFixed(2)}%`,                                  delta: prev0.ctr > 0 ? (current.ctr - prev0.ctr) / prev0.ctr * 100 : null,                   lowerBetter: false },
    { label: "Conv. Rate", curr: `${current.cr.toFixed(2)}%`,                                      prev: `${prev0.cr.toFixed(2)}%`,                                   delta: prev0.cr > 0 ? (current.cr - prev0.cr) / prev0.cr * 100 : null,                      lowerBetter: false },
    { label: "CPM",        curr: `${Math.round(current.cpm)} EGP`,                                 prev: `${Math.round(prev0.cpm)} EGP`,                              delta: prev0.cpm > 0 ? (current.cpm - prev0.cpm) / prev0.cpm * 100 : null,                  lowerBetter: true  },
    { label: "Purchases",  curr: `${current.purchases}`,                                           prev: `${prev0.purchases}`,                                        delta: prev0.purchases > 0 ? (current.purchases - prev0.purchases) / prev0.purchases * 100 : null, lowerBetter: false },
    { label: "Spend",      curr: `${Math.round(current.spend)} EGP`,                               prev: `${Math.round(prev0.spend)} EGP`,                            delta: prev0.spend > 0 ? (current.spend - prev0.spend) / prev0.spend * 100 : null,            lowerBetter: null  },
  ];

  const chartDays = sorted.slice(-Math.max(windowSize * 2, 7));
  const maxCpa    = Math.max(...sorted.map(x => x.cpa).filter(x => x > 0), 1);

  // Date labels for adset/ad mode
  const fmtDate = (d: string) => d ? d.slice(5).replace("-", "/") : "";
  const currentLabel = segScope !== "campaign"
    ? (selectedSeg
        ? (mode === "1d" ? `${fmtDate(until)}` : `${fmtDate(subCurrentSince)} ← ${fmtDate(until)}`)
        : (mode === "1d" ? "آخر يوم" : `آخر ${windowSize} أيام`))
    : (mode === "1d" ? "أمس" : `آخر ${windowSize} أيام`);
  const previousLabel = segScope !== "campaign"
    ? (selectedSeg
        ? (mode === "1d" ? `${fmtDate(subPrevUntil)}` : `${fmtDate(subPrevSince)} ← ${fmtDate(subPrevUntil)}`)
        : "الفترة السابقة")
    : (mode === "1d" ? "اليوم السابق" : `${windowSize} أيام قبلهم`);

  return (
    <div className="space-y-3">

      {/* ── Scope selector ── */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/30 border border-border">
        {([["campaign", "الحملة كاملة"], ["adset", "Ad Set"], ["ad", "إعلان"]] as [SegScope, string][]).map(([s, lbl]) => (
          <button
            key={s}
            onClick={() => setSegScope(s)}
            className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-colors ${
              segScope === s ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* ── Segment picker (adset / ad mode) ── */}
      {segScope !== "campaign" && (
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="absolute end-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={segSearch}
              onChange={(e) => setSegSearch(e.target.value)}
              placeholder={segScope === "adset" ? "ابحث باسم Ad Set…" : "ابحث باسم الإعلان…"}
              dir="rtl"
              className="w-full h-8 pe-8 ps-3 text-xs rounded-lg border border-border bg-muted/40 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {segSearch && (
              <button onClick={() => setSegSearch("")} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="max-h-36 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {filteredSegs.length === 0
              ? <div className="text-xs text-muted-foreground text-center py-3">لا توجد نتائج</div>
              : filteredSegs.slice(0, 20).map(({ seg }) => (
                  <button
                    key={seg.id}
                    onClick={() => setSelectedSeg(seg.id === selectedSeg ? null : seg.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors text-right ${
                      selectedSeg === seg.id
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-muted/30 text-foreground"
                    }`}
                  >
                    <span className="truncate flex-1">{seg.label}</span>
                    <span className="font-mono text-muted-foreground shrink-0" dir="ltr">{Math.round(seg.spend)} EGP</span>
                  </button>
                ))
            }
          </div>
          {!selectedSeg && (
            <p className="text-[10px] text-muted-foreground text-center">اختر {segScope === "adset" ? "Ad Set" : "إعلانًا"} من القائمة لرؤية المقارنة</p>
          )}
        </div>
      )}

      {/* ── Period buttons (all modes) ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(["1d", "3d", "custom"] as CompareMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors ${
              mode === m
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted/30"
            }`}
          >
            {m === "1d" ? "آخر يوم" : m === "3d" ? "آخر 3 أيام" : "مخصص"}
          </button>
        ))}
        {mode === "custom" && (
          <div className="flex items-center gap-2 mr-1">
            <input
              type="range" min={1} max={30} value={customDays}
              onChange={(e) => setCustomDays(Number(e.target.value))}
              className="w-24 accent-primary"
            />
            <span className="text-[11px] font-bold text-primary tabular-nums">{customDays} يوم</span>
          </div>
        )}
      </div>

      {/* Header row */}
      <div className="grid grid-cols-3 text-[10px] text-center font-semibold px-1">
        <div className="text-muted-foreground text-right">المقياس</div>
        <div className="text-foreground">{currentLabel}</div>
        <div className="text-muted-foreground">{previousLabel}</div>
      </div>

      {/* Loading indicator for segment sub-period fetch */}
      {isSegLoading && (
        <div className="rounded-xl border border-border bg-muted/10 text-xs text-muted-foreground text-center py-6 flex items-center justify-center gap-2">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          جاري تحميل البيانات…
        </div>
      )}

      {/* Error state — rate limit or network failure */}
      {isSegError && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 text-center py-5 px-4 space-y-2">
          <div className="font-semibold">تعذّر تحميل البيانات</div>
          <div className="text-[11px] opacity-80">
            {subCurrentQuery.error instanceof Error && subCurrentQuery.error.message.includes("مش متاحة")
              ? subCurrentQuery.error.message
              : "Meta وصلت للحد المسموح — حاول تاني خلال دقيقة"}
          </div>
          <button
            onClick={() => { subCurrentQuery.refetch(); subPrevQuery.refetch(); }}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-900 border border-amber-300 dark:border-amber-700 text-[11px] font-bold transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            أعد المحاولة
          </button>
        </div>
      )}

      {/* No data notice */}
      {!hasPrev && !isSegLoading && segScope === "campaign" && (
        <div className="rounded-xl border border-border bg-muted/10 text-xs text-muted-foreground text-center py-6">
          لا توجد بيانات كافية للمقارنة<br />
          تحتاج على الأقل <span className="font-bold">{windowSize * 2} يوم</span> من البيانات
        </div>
      )}
      {!hasPrev && !isSegLoading && segScope !== "campaign" && !selectedSeg && null /* handled above */}
      {!hasPrev && !isSegLoading && segScope !== "campaign" && selectedSeg && (
        <div className="rounded-xl border border-border bg-muted/10 text-xs text-muted-foreground text-center py-6">
          لا توجد بيانات للفترة السابقة لهذا {segScope === "adset" ? "Ad Set" : "الإعلان"}
        </div>
      )}

      {/* Comparison table */}
      {hasPrev && (
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
          {rows.map(({ label, curr, prev, delta, lowerBetter }) => {
            let deltaClr = "text-muted-foreground";
            let icon = "";
            if (delta !== null && lowerBetter !== null) {
              const improved = lowerBetter ? delta < -2 : delta > 2;
              const worsened = lowerBetter ? delta > 2  : delta < -2;
              deltaClr = improved ? "text-emerald-600 dark:text-emerald-400"
                       : worsened ? "text-rose-600 dark:text-rose-400"
                       : "text-muted-foreground";
              icon = delta > 0 ? "▲" : "▼";
            }
            return (
              <div key={label} className="grid grid-cols-3 items-center px-3 py-2.5">
                <div className="text-xs text-muted-foreground font-medium">{label}</div>
                <div className="text-xs font-bold font-mono text-center" dir="ltr">{curr}</div>
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground" dir="ltr">{prev}</span>
                  {delta !== null && (
                    <span className={`text-[10px] font-bold ${deltaClr}`} dir="ltr">
                      {icon} {Math.abs(delta).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Turning point (campaign mode only) */}
      {segScope === "campaign" && turning && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-3">
          <div className="text-[9px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-1.5">
            📉 نقطة التحول
          </div>
          <p className="text-xs text-foreground leading-relaxed">
            {turning.direction === "up" ? "ارتفع" : "انخفض"}{" "}
            <span className="font-bold">{turning.metric}</span> بنسبة{" "}
            <span className="font-bold font-mono">{turning.pct}%</span> في يوم{" "}
            <span className="font-bold font-mono" dir="ltr">{turning.day}</span>
          </p>
        </div>
      )}

      {/* AI analyst commentary */}
      {hasPrev && analysis.length > 0 && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <span>🧠</span>
            <span>تحليل الفترة — بعقل ميدياباير</span>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 overflow-hidden divide-y divide-primary/10">
            {analysis.map((item, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-3">
                <span className="text-base shrink-0 leading-none mt-0.5">{item.icon}</span>
                <p className="text-xs leading-[1.85] text-foreground flex-1">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily CPA chart — campaign mode only */}
      {segScope === "campaign" && <div>
        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">
          الأداء اليومي — CPA
        </div>
        <div className="space-y-1">
          {chartDays.map((d) => {
            const isCurrent = currentDays.some((c) => c.day === d.day);
            const barPct    = d.cpa > 0 ? Math.min((d.cpa / maxCpa) * 100, 100) : 0;
            const isHigh    = d.cpa > 45;
            return (
              <div key={d.day} className={`flex items-center gap-2 ${isCurrent ? "" : "opacity-40"}`}>
                <div className="text-[10px] text-muted-foreground font-mono w-[4.5rem] shrink-0 text-left" dir="ltr">
                  {d.day.slice(5)}
                </div>
                <div className="flex-1 h-4 rounded bg-muted/30 overflow-hidden">
                  <div
                    className={`h-full rounded transition-all ${isHigh ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <div
                  className={`text-[10px] font-mono font-bold w-16 text-left shrink-0 ${
                    isHigh ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
                  }`}
                  dir="ltr"
                >
                  {d.cpa > 0 ? `${Math.round(d.cpa)} EGP` : d.spend > 0 ? "لا أوردر" : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
  );
}

// ── DiagnosisModal ─────────────────────────────────────────────
export function DiagnosisModal({ insights, open, onClose, defaultTab = "campaign", accountId, onTabChange }: { insights: CampaignInsights; open: boolean; onClose: () => void; defaultTab?: string; accountId?: string; onTabChange?: (tab: string) => void }) {
  const result     = useMemo(() => runDiagnosis(insights),     [insights]);
  const [expandedAdset, setExpandedAdset] = useState<string | null>(null);
  const [expandedAd, setExpandedAd] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [adsetFilter, setAdsetFilter] = useState("");
  const [adFilter, setAdFilter]       = useState("");
  const loggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      setAdsetFilter("");
      setAdFilter("");
    }
  }, [open, defaultTab]);

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

        <Tabs value={activeTab} onValueChange={(t) => { setActiveTab(t); onTabChange?.(t); }} className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0 grid grid-cols-5 text-xs h-8">
            <TabsTrigger value="campaign" className="text-[10px]">الحملة</TabsTrigger>
            <TabsTrigger value="adsets" className="text-[10px]">Ad Sets ({result.adsets.length})</TabsTrigger>
            <TabsTrigger value="ads" className="text-[10px]">الإعلانات ({result.ads.length})</TabsTrigger>
            <TabsTrigger value="creative" className="text-[10px]">الكريتف</TabsTrigger>
            <TabsTrigger value="compare" className="text-[10px]">مقارنة</TabsTrigger>
          </TabsList>

          <TabsContent value="campaign" className="flex-1 overflow-y-auto space-y-4 mt-3 pb-2">
            {/* ── Verdict Hero ── */}
            <div className={`rounded-2xl border-2 overflow-hidden ${cfg.border}`}>
              <div className={`${cfg.bg} px-4 py-3.5 flex items-center gap-3`}>
                <div className="text-2xl select-none leading-none">{camp.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-base font-black tracking-tight leading-tight ${cfg.text}`}>{camp.decision}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{camp.problem}</div>
                </div>
                {camp.metrics.find(m => m.label === "CPA") && (
                  <div className="text-right shrink-0">
                    <div className={`text-lg font-black font-mono leading-none ${cfg.text}`} dir="ltr">
                      {camp.metrics.find(m => m.label === "CPA")!.value}
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">CPA</div>
                  </div>
                )}
              </div>
              {/* Quick stats strip */}
              <div className="grid grid-cols-4 divide-x divide-x-reverse divide-border border-t border-border bg-muted/10">
                {(["Purchases","Frequency","CPM","Hook Rate"] as const).map((lbl) => {
                  const m = camp.metrics.find(x => x.label === lbl);
                  if (!m) return null;
                  return (
                    <div key={lbl} className="text-center py-2">
                      <div className={`text-xs font-bold font-mono leading-none ${m.flag ? FLAG_TEXT[m.flag] : "text-foreground"}`} dir="ltr">{m.value}</div>
                      <div className="text-[9px] text-muted-foreground leading-none mt-0.5">{lbl}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Funnel ── */}
            <div className="rounded-xl border border-border bg-muted/5 px-4 pt-3.5 pb-1">
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-3">الفانل — من الـ Impression للأوردر</div>
              {camp.funnel.map((step, i) => (
                <FunnelStep key={step.label} {...step} isLast={i === camp.funnel.length - 1} />
              ))}
            </div>

            {/* ── Metrics grid ── */}
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">الأرقام الكاملة</div>
              <MetricGrid metrics={camp.metrics} />
            </div>

            {/* ── Action plan ── */}
            <ActionList actions={camp.actionPlan} color={camp.color} />
          </TabsContent>

          <TabsContent value="adsets" className="flex-1 flex flex-col min-h-0 mt-3">
            {result.adsets.length > 0 && (
              <div className="shrink-0 relative mb-2">
                <Search className="absolute end-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  value={adsetFilter}
                  onChange={(e) => setAdsetFilter(e.target.value)}
                  placeholder="ابحث باسم Ad Set…"
                  dir="rtl"
                  className="w-full h-8 pe-8 ps-3 text-xs rounded-lg border border-border bg-muted/40 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                />
                {adsetFilter && (
                  <button onClick={() => setAdsetFilter("")} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto space-y-2 pb-2">
              {result.adsets.length === 0
                ? <div className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات Ad Sets</div>
                : (() => {
                    const filtered = [...result.adsets]
                      .sort((a, b) => b.seg.spend - a.seg.spend)
                      .filter(({ seg }) => !adsetFilter || seg.label.toLowerCase().includes(adsetFilter.toLowerCase()));
                    return filtered.length === 0
                      ? <div className="text-sm text-muted-foreground text-center py-6">لا توجد نتائج للبحث</div>
                      : filtered.map(({ seg, diag }) => (
                          <SegmentRow
                            key={seg.id}
                            seg={seg}
                            diag={diag}
                            expanded={expandedAdset === seg.id}
                            onToggle={() => setExpandedAdset(expandedAdset === seg.id ? null : seg.id)}
                          />
                        ));
                  })()
              }
            </div>
          </TabsContent>

          <TabsContent value="ads" className="flex-1 flex flex-col min-h-0 mt-3">
            {result.ads.length > 0 && (
              <div className="shrink-0 relative mb-2">
                <Search className="absolute end-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  value={adFilter}
                  onChange={(e) => setAdFilter(e.target.value)}
                  placeholder="ابحث باسم الإعلان…"
                  dir="rtl"
                  className="w-full h-8 pe-8 ps-3 text-xs rounded-lg border border-border bg-muted/40 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                />
                {adFilter && (
                  <button onClick={() => setAdFilter("")} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto space-y-2 pb-2">
              {result.ads.length === 0
                ? <div className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات إعلانات</div>
                : (() => {
                    const filtered = [...result.ads]
                      .sort((a, b) => b.seg.spend - a.seg.spend)
                      .filter(({ seg }) => !adFilter || seg.label.toLowerCase().includes(adFilter.toLowerCase()));
                    return filtered.length === 0
                      ? <div className="text-sm text-muted-foreground text-center py-6">لا توجد نتائج للبحث</div>
                      : filtered.map(({ seg, diag }) => (
                          <SegmentRow
                            key={seg.id}
                            seg={seg}
                            diag={diag}
                            expanded={expandedAd === seg.id}
                            onToggle={() => setExpandedAd(expandedAd === seg.id ? null : seg.id)}
                          />
                        ));
                  })()
              }
            </div>
          </TabsContent>

          <TabsContent value="creative" className="flex-1 overflow-y-auto mt-3 pb-2">
            <CreativeTab ads={result.ads} />
          </TabsContent>

          <TabsContent value="compare" className="flex-1 overflow-y-auto mt-3 pb-2">
            {false
              ? <div className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات يومية للمقارنة</div>
              : <PerformanceCompareTab
                    daily={insights.daily}
                    currentAdsets={result.adsets}
                    currentAds={result.ads}
                    campaignId={insights.campaign.id}
                    accountId={accountId}
                    until={insights.period.until}
                  />
            }
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
  // Extended daily fetch is only needed when the compare tab is opened
  const [compareOpened, setCompareOpened] = useState(false);

  // Extended since: go back an extra period so daily chart has comparison data
  const extendedSince = useMemo(() => {
    const periodDays = Math.max(
      Math.ceil((new Date(until).getTime() - new Date(since).getTime()) / 86400000) + 1,
      1,
    );
    const extMs = new Date(since).getTime() - periodDays * 86400000;
    return new Date(extMs).toISOString().slice(0, 10);
  }, [since, until]);

  const query    = useInsights({ campaign_id: campaignId, ad_account_id: accountId, since, until });
  // Only fetch extended range once the user opens the compare tab (avoids an extra Meta call)
  const extQuery = useInsights({ campaign_id: compareOpened ? campaignId : null, ad_account_id: accountId, since: extendedSince, until });

  // Merge: keep original totals/adsets/ads, enrich `daily` with extended range
  const mergedInsights = useMemo(() => {
    if (!query.data) return null;
    const extDaily = extQuery.data?.daily ?? [];
    if (extDaily.length === 0) return query.data;
    const mainDaySet = new Set(query.data.daily.map((d) => d.day));
    const extraDays = extDaily.filter((d) => !mainDaySet.has(d.day));
    if (extraDays.length === 0) return query.data;
    return {
      ...query.data,
      daily: [...extraDays, ...query.data.daily].sort((a, b) => a.day.localeCompare(b.day)),
    };
  }, [query.data, extQuery.data]);

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
      insights={mergedInsights!}
      open={open}
      onClose={onClose}
      defaultTab={defaultTab}
      accountId={accountId}
      onTabChange={(tab) => { if (tab === "compare") setCompareOpened(true); }}
    />
  );
}
