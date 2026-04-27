import { useMemo, useState, useEffect } from "react";
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
    return { verdict: "kill", decision: "أوقف", mainIssue: "لا يوجد إنفاق", color: "gray", metrics, actions: ["تحقق من إعدادات الميزانية وحالة Ad Set."] };
  }
  if (seg.cpa > 0 && seg.cpa <= CPA_SCALE_MAX) {
    return { verdict: "scale", decision: "Scale 🟢", mainIssue: `CPA رابح — ${fmt(seg.cpa, 0)} EGP`, color: "green", metrics, actions: ["زد ميزانية هذا المستوى 20% كل 48 ساعة.", "لا تغير الاستهداف أو الكريتف."] };
  }
  if (seg.purchases === 0 && seg.spend > 100) {
    return { verdict: "kill", decision: "أوقف 🔴", mainIssue: `إنفاق ${fmt(seg.spend, 0)} EGP بدون أوردرات`, color: "red", metrics, actions: ["أوقف هذا المستوى فوراً.", "افحص الكريتف والاستهداف وأعد البناء."] };
  }
  if (seg.cpa > CPA_IMPROVE_MAX) {
    return { verdict: "kill", decision: "أوقف 🔴", mainIssue: `CPA مرتفع جداً — ${fmt(seg.cpa, 0)} EGP`, color: "red", metrics, actions: ["أوقف هذا المستوى فوراً.", "راجع الاستهداف والكريتف من الصفر."] };
  }
  if (seg.hookRate < HOOK_MIN || seg.ctr < CTR_MIN) {
    const issue = seg.hookRate < HOOK_MIN
      ? `Hook Rate ضعيف — ${f1(seg.hookRate)}% (المطلوب: +${HOOK_MIN}%)`
      : `CTR منخفض — ${f2(seg.ctr)}% (المطلوب: +${CTR_MIN}%)`;
    return { verdict: "creative", decision: "كريتف ضعيف 🔴", mainIssue: issue, color: "red", metrics, actions: ["غيّر أول 3 ثواني في الفيديو.", "جرّب Hook مختلف — مشكلة + حل.", "اختبر UGC بدل الفيديو الاحترافي."] };
  }
  if (lpvRate > 0 && lpvRate < LPR_MIN) {
    return { verdict: "tech", decision: "مشكلة تقنية 🔴", mainIssue: `LPR منخفض — ${f1(lpvRate)}% (المطلوب: +${LPR_MIN}%)`, color: "red", metrics, actions: ["افحص سرعة تحميل الموقع (PageSpeed).", "تحقق من Pixel Helper.", "تأكد من صحة رابط الإعلان."] };
  }
  if (seg.cr < CR_MIN && seg.lpv > 0) {
    return { verdict: "landing", decision: "صفحة هبوط 🔴", mainIssue: `CR منخفض — ${f2(seg.cr)}% (المطلوب: +${CR_MIN}%)`, color: "red", metrics, actions: ["أصلح صفحة الهبوط — قوّي الـ CTA.", "أضف Social Proof بالقرب من زر الشراء.", "بسّط الفورم."] };
  }
  if (seg.cpa > CPA_SCALE_MAX) {
    return { verdict: "improve", decision: "حسّن 🟡", mainIssue: `CPA قابل للتحسين — ${fmt(seg.cpa, 0)} EGP`, color: "amber", metrics, actions: ["اختبر كريتف جديد.", "ضيّق الاستهداف لجمهور أكثر دفئاً."] };
  }
  return { verdict: "okay", decision: "مقبول ✅", mainIssue: "أداء مقبول", color: "green", metrics, actions: ["استمر بالرصد اليومي."] };
}

// ── Campaign-level diagnosis ───────────────────────────────────
export function diagnoseCampaign(totals: DerivedMetrics | undefined, daily: DailyPoint[]): CampaignDiag {
  if (!totals) {
    return { verdict: "nodata", decision: "لا توجد بيانات", problem: "لم يتم تحميل البيانات بعد", color: "gray", emoji: "⚪", funnel: [], metrics: [], actionPlan: ["أعد تحديث الصفحة."] };
  }
  const holdRate = (totals.video_plays ?? 0) > 0 ? ((totals.v95 ?? 0) / totals.video_plays) * 100 : 0;
  const ctr2lp = totals.link_clicks > 0 ? (totals.lpv / totals.link_clicks) * 100 : 0;

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
    return { verdict: "scale", decision: "Scale", problem: "الحملة تحقق أداءً ممتازاً — لا توجد مشكلة", color: "green", emoji: "🟢", funnel, metrics, actionPlan: ["زد الميزانية 20% كل 48 ساعة.", "فعّل Advantage+ Budget Optimization.", "لا تغير الكريتف أو الاستهداف.", "راقب CPA يومياً — أوقف الزيادة إذا تجاوز 50 EGP."] };
  }
  if (totals.frequency > 2.5 && isCtrDeclining(daily)) {
    return { verdict: "refresh", decision: "Refresh", problem: "تشبع الجمهور — Ad Fatigue", color: "yellow", emoji: "🟡", funnel, metrics, actionPlan: ["وسّع الجمهور أو اختبر Lookalike جديد.", "أطلق كريتيف جديد كلياً.", "جرّب تغيير الـ Placement.", `أوقف الإعلانات بـ Frequency > 3.5 مؤقتاً.`] };
  }
  if (totals.hookRate < HOOK_MIN || totals.ctr < CTR_MIN) {
    return { verdict: "creative", decision: "Improve Creative", problem: `كريتف ضعيف — Hook Rate ${f1(totals.hookRate)}% · CTR ${f2(totals.ctr)}%`, color: "red", emoji: "🔴", funnel, metrics, actionPlan: ["غيّر أول 3 ثواني — الـ Hook هو المشكلة.", "اختبر زاوية بيعية مختلفة (مشكلة + حل).", "جرّب UGC بدل الإعلان التقليدي.", `Hook Rate المطلوب: +${HOOK_MIN}% | CTR المطلوب: +${CTR_MIN}%`] };
  }
  if (totals.ctr >= CTR_MIN && totals.lpv > 0 && ctr2lp < LPR_MIN) {
    return { verdict: "tech", decision: "Fix Tech", problem: `نقرات بدون زيارات — LPR ${f1(ctr2lp)}% فقط`, color: "red", emoji: "🔴", funnel, metrics, actionPlan: ["افحص سرعة الموقع فوراً (PageSpeed Insights).", "تحقق من Meta Pixel Helper.", "راجع الاستضافة وانقطاعاتها.", "تأكد من صحة رابط الإعلان.", "جرّب Instant Experience."] };
  }
  if (totals.crLpv < CR_MIN && (totals.lpv > 0 || ctr2lp >= LPR_MIN)) {
    return { verdict: "landing", decision: "Improve Landing Page", problem: `صفحة الهبوط تفشل في الإقناع — CR ${f2(totals.crLpv)}%`, color: "red", emoji: "🔴", funnel, metrics, actionPlan: ["صمّم بنموذج AIDA مع Zigzag layout.", "احذف Header/Footer الافتراضيين.", "اربط أزرار الشراء بـ Anchor Link.", "أضف Social Proof بالقرب من CTA.", "بسّط الفورم إلى الحد الأدنى."] };
  }
  // CPA في النطاق القابل للتحسين (45–80) وكل المؤشرات الأخرى مقبولة
  if (totals.purchases > 0 && totals.cpa > CPA_SCALE_MAX && totals.cpa <= CPA_IMPROVE_MAX) {
    return { verdict: "refresh", decision: "حسّن الأداء 🟡", problem: `CPA قابل للتحسين — ${fmt(totals.cpa, 0)} EGP (الهدف: أقل من ${CPA_SCALE_MAX} EGP)`, color: "yellow", emoji: "🟡", funnel, metrics, actionPlan: [`خفّض CPA من ${fmt(totals.cpa, 0)} إلى أقل من ${CPA_SCALE_MAX} EGP.`, "اختبر كريتف جديد بـ Hook مختلف.", "ضيّق الجمهور لأكثر الشرائح تحويلاً.", "راجع صفحة الهبوط — قوّي الـ CTA.", "اختبر Lookalike من قاعدة المشترين."] };
  }
  // إنفاق بدون أوردرات والمؤشرات الأمامية جيدة → مشكلة في التتبع أو الصفحة
  if (totals.purchases === 0 && totals.spend > 0 && totals.ctr >= CTR_MIN && totals.hookRate >= HOOK_MIN) {
    return { verdict: "tech", decision: "راجع التتبع 🔴", problem: `كريتف يجذب النقرات لكن لا أوردرات — ${fmt(totals.spend, 0)} EGP إنفاق`, color: "red", emoji: "🔴", funnel, metrics, actionPlan: ["تحقق من Meta Pixel Helper — هل الـ Purchase Event يُطلق صح؟", "افتح Events Manager وتأكد من استقبال أحداث الشراء.", "اختبر شراء حقيقي وتتبع مساره.", "افحص سرعة تحميل صفحة الهبوط (PageSpeed Insights).", "إذا كان الـ Pixel سليم — صفحة الهبوط هي المشكلة، عزّز الـ CTA."] };
  }
  // أداء مقبول عام — لا مشكلة محددة
  return { verdict: "nodata", decision: "أداء مقبول 🟡", problem: "لا توجد مشكلة واضحة — الحملة في منطقة الرصد", color: "gray", emoji: "🟡", funnel, metrics, actionPlan: ["استمر بالرصد اليومي.", "تأكد أن تتبع الـ Pixel يعمل بشكل صحيح.", "إذا استمر الأداء المتوسط 3 أيام — جرّب كريتف جديد.", "راجع الاستهداف إذا ارتفع الـ CPA تدريجياً."] };
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
  return (
    <div className={`rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">خطة العمل</div>
      <ul className="space-y-2">
        {actions.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span className={`shrink-0 h-5 w-5 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5 ${cfg.badge}`}>{i + 1}</span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ul>
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

  useEffect(() => { if (open) setActiveTab(defaultTab); }, [open, defaultTab]);

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
