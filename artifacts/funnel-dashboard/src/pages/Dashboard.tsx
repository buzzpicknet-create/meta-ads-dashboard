import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Cell,
  ComposedChart,
  Area,
  Line,
  Legend,
} from "recharts";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Eye,
  Flame,
  MousePointerClick,
  PauseCircle,
  RotateCcw,
  Rocket,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { DashboardControls } from "@/components/dashboard-controls";
import {
  analyzeTrends,
  buildInsight,
  buildPrediction,
  buildFrequencyAlert,
  type MetricTrend,
  type FrequencyAlert,
} from "@/lib/trend-analysis";
import { useCampaigns, useInsights, useAccount, useAccounts } from "@/hooks/use-meta";
import {
  type AdIssue,
  type DatePreset,
  type SegmentEntry,
  type CampaignInsights,
  type DerivedMetrics,
  rangeFromPreset,
} from "@/lib/meta-api";

const CHART_COLORS = {
  primary: "hsl(244 75% 57%)",
  good: "hsl(152 60% 42%)",
  warn: "hsl(38 92% 55%)",
  bad: "hsl(0 75% 55%)",
  info: "hsl(199 89% 48%)",
  muted: "hsl(220 10% 60%)",
};

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function Num({ children }: { children: React.ReactNode }) {
  return <span dir="ltr" className="num">{children}</span>;
}

// ──────────────────────────────────────────────────────────────
// Verdict logic
// ──────────────────────────────────────────────────────────────
const CPA_STOP = 55;
const CPA_IMPROVE = 50;

function verdictFor(s: SegmentEntry, all: SegmentEntry[]): "winner" | "kill" | "okay" | "improve" {
  if (s.purchases === 0 || s.cpa > CPA_STOP) return "kill";
  if (s.cpa > CPA_IMPROVE) return "improve";
  const cpas = all.filter((x) => x.purchases > 0 && x.cpa <= CPA_IMPROVE).map((x) => x.cpa);
  const minCpa = cpas.length > 0 ? Math.min(...cpas) : 0;
  if (minCpa > 0 && s.cpa <= minCpa * 1.2) return "winner";
  return "okay";
}

function VerdictBadge({ type }: { type: "winner" | "kill" | "okay" | "improve" }) {
  const cfg = {
    winner:  { icon: Sparkles,    text: "رابح",          cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30" },
    kill:    { icon: XCircle,     text: "أوقفه",         cls: "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-rose-500/30" },
    okay:    { icon: CheckCircle2,text: "مقبول",         cls: "bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-sky-500/30" },
    improve: { icon: TrendingDown,text: "قم بتحسين",     cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30" },
  }[type];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cfg.cls}`}>
      <Icon className="h-3 w-3" />
      {cfg.text}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────
// KPI Card
// ──────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: React.ReactNode;
  trend?: { dir: "up" | "down"; text: string; good?: boolean };
  tone?: "good" | "bad" | "warn" | "neutral";
}) {
  const toneRing = {
    good: "ring-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    bad: "ring-rose-500/20 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400",
    warn: "ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
    neutral: "ring-primary/15 bg-primary/5 text-primary",
  }[tone];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="text-sm text-muted-foreground font-medium">{label}</div>
            <div className="text-2xl font-bold tracking-tight">
              <Num>{value}</Num>
            </div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
            {trend && (
              <div className={`inline-flex items-center gap-1 text-xs font-medium ${trend.good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {trend.dir === "up" ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {trend.text}
              </div>
            )}
          </div>
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ring-1 shrink-0 ${toneRing}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Alert System
// ──────────────────────────────────────────────────────────────
function HowToBtn({ problem }: { problem: string }) {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return (
    <a
      href={`${base}/how-to?problem=${problem}`}
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-background/60 hover:bg-background border border-border/60 text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
      onClick={(e) => e.stopPropagation()}
    >
      كيف أحلها؟ ↗
    </a>
  );
}

function AlertSystem({ totals, byAd }: { totals: DerivedMetrics; byAd: SegmentEntry[] }) {
  const alerts: { type: "danger" | "warn" | "info"; msg: string; problem?: string }[] = [];

  // Drain ads
  const drainAds = byAd.filter((a) => a.spend >= 100 && (a.purchases === 0 || a.cpa > CPA_STOP));
  drainAds.forEach((a) => {
    alerts.push({
      type: "danger",
      msg: `"${a.label.slice(0, 40)}" يستهلك ${fmt(a.spend, 0)} EGP بدون نتائج كافية — أوقفه فوراً`,
      problem: "no-conversions",
    });
  });

  if (totals.ctr < 1) alerts.push({ type: "danger", msg: `CTR منخفض جداً (${fmtPct(totals.ctr)}) — الكريتف مش بيوقف أحد`, problem: "ctr-low" });
  else if (totals.ctr < 1.5) alerts.push({ type: "warn", msg: `CTR (${fmtPct(totals.ctr)}) أقل من المعدل الصحي — حسّن الـ Creative`, problem: "ctr-low" });

  if (totals.lpv > 0 && totals.lpvRate < 60) alerts.push({ type: "danger", msg: `${fmt(totals.lpvRate, 0)}% فقط من الكليكات وصلت الصفحة — الصفحة بطيئة أو متكسرة`, problem: "slow-landing" });
  else if (totals.lpv > 0 && totals.lpvRate < 75) alerts.push({ type: "warn", msg: `${fmt(totals.lpvRate, 0)}% من الكليكات وصلت الصفحة — سرعة التحميل تحتاج مراجعة`, problem: "slow-landing" });

  if (totals.lpv > 0 && totals.crLpv < 2) alerts.push({ type: "danger", msg: `CR (${fmtPct(totals.crLpv)}) منخفض جداً — مشكلة في الفورم أو التسعير`, problem: "low-cr" });
  else if (totals.lpv > 0 && totals.crLpv < 5) alerts.push({ type: "warn", msg: `CR (${fmtPct(totals.crLpv)}) أقل من 5% — راجعي صفحة الـ Checkout`, problem: "low-cr" });

  if (totals.hookRate > 0 && totals.hookRate < 20) alerts.push({ type: "warn", msg: `Hook Rate (${fmt(totals.hookRate, 0)}%) ضعيف — أول 3 ثواني في الفيديو مش بتمسك الناس`, problem: "low-hook" });

  // Winner scaling alert
  const winners = byAd.filter((a) => a.purchases > 0 && a.cpa <= CPA_IMPROVE);
  if (winners.length > 0) {
    alerts.push({ type: "info", msg: `🏆 ${winners.length} إعلان رابح — ضاعف ميزانيتهم قبل ما الـ Audience يتشبع` });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {alerts.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium ring-1 ring-inset ${
            a.type === "danger"
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/30"
              : a.type === "warn"
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30"
          }`}
        >
          {a.type === "danger" ? (
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          ) : a.type === "warn" ? (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <Bell className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span className="flex-1">{a.msg}</span>
          {a.problem && <HowToBtn problem={a.problem} />}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Priority Engine — أهم 3 قرارات
// ──────────────────────────────────────────────────────────────
function PriorityEngine({ totals, byAd, byAdset }: { totals: DerivedMetrics; byAd: SegmentEntry[]; byAdset: SegmentEntry[] }) {
  const actions: { priority: number; icon: React.ComponentType<{ className?: string }>; label: string; sub: string; tone: "kill" | "scale" | "fix" | "watch" }[] = [];

  const worstAd = [...byAd].filter((a) => a.spend >= 50).sort((a, b) => {
    if (a.purchases === 0 && b.purchases > 0) return -1;
    if (b.purchases === 0 && a.purchases > 0) return 1;
    return b.cpa - a.cpa;
  })[0];

  if (worstAd && worstAd.purchases === 0) {
    actions.push({
      priority: 1,
      icon: PauseCircle,
      label: `أوقف: ${worstAd.label.slice(0, 45)}`,
      sub: `إنفاق ${fmt(worstAd.spend, 0)} EGP · لا طلبات — وقّفه فوراً`,
      tone: "kill",
    });
  } else if (worstAd && worstAd.cpa > CPA_STOP) {
    actions.push({
      priority: 1,
      icon: PauseCircle,
      label: `راقب: ${worstAd.label.slice(0, 45)}`,
      sub: `CPA ${fmt(worstAd.cpa, 0)} EGP · ${worstAd.purchases} طلب — حسّن قبل ما توقف`,
      tone: "watch",
    });
  } else if (worstAd && worstAd.cpa > CPA_IMPROVE) {
    actions.push({
      priority: 1,
      icon: PauseCircle,
      label: `حسّن: ${worstAd.label.slice(0, 45)}`,
      sub: `CPA ${fmt(worstAd.cpa, 0)} EGP · ${worstAd.purchases} طلب — فوق هدف ${CPA_IMPROVE} EGP`,
      tone: "fix",
    });
  }

  const bestAd = byAd.find((a) => a.purchases > 0 && a.cpa <= CPA_IMPROVE);
  if (bestAd) {
    actions.push({
      priority: 2,
      icon: Rocket,
      label: `ضاعف ميزانية: ${bestAd.label.slice(0, 45)}`,
      sub: `CPA ${fmt(bestAd.cpa, 0)} EGP · ${bestAd.purchases} طلب — أفضل عندك`,
      tone: "scale",
    });
  }

  if (totals.crLpv < 5 && totals.lpv > 0) {
    actions.push({
      priority: 3,
      icon: Zap,
      label: "حسّن صفحة المنتج والـ Checkout",
      sub: `CR ${fmtPct(totals.crLpv)} — لو وصل 5% هتزيد ${fmt(Math.round((totals.lpv * 0.05) - totals.purchases))} طلب`,
      tone: "fix",
    });
  } else if (totals.ctr < 1.5) {
    actions.push({
      priority: 3,
      icon: Zap,
      label: "اختبر Creative جديد لرفع الـ CTR",
      sub: `CTR ${fmtPct(totals.ctr)} — حاول توصل لـ 2%+`,
      tone: "fix",
    });
  } else if (byAdset.length > 1) {
    const worstAdset = [...byAdset].filter((a) => a.spend >= 50).sort((a, b) => {
      if (a.purchases === 0) return -1;
      if (b.purchases === 0) return 1;
      return b.cpa - a.cpa;
    })[0];
    if (worstAdset) {
      actions.push({
        priority: 3,
        icon: Zap,
        label: `راجع الـ Ad Set: ${worstAdset.label.slice(0, 40)}`,
        sub: `أداء ضعيف — قد تحتاج تغيير الأوديانس أو الـ Placement`,
        tone: "fix",
      });
    }
  }

  const toneConfig = {
    kill:  { bg: "bg-rose-500/10 ring-rose-500/30 text-rose-700 dark:text-rose-400",         iconBg: "bg-rose-500/15",   label: "أوقف"       },
    scale: { bg: "bg-emerald-500/10 ring-emerald-500/30 text-emerald-700 dark:text-emerald-400", iconBg: "bg-emerald-500/15", label: "ضاعف"    },
    fix:   { bg: "bg-amber-500/10 ring-amber-500/30 text-amber-700 dark:text-amber-400",      iconBg: "bg-amber-500/15",  label: "قم بتحسين" },
    watch: { bg: "bg-orange-500/10 ring-orange-500/30 text-orange-700 dark:text-orange-400",  iconBg: "bg-orange-500/15", label: "راقب"       },
  };

  if (actions.length === 0) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          أهم {Math.min(actions.length, 3)} قرارات تنفيذية دلوقتي
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-3 gap-3">
          {actions.slice(0, 3).map((a, i) => {
            const cfg = toneConfig[a.tone];
            const Icon = a.icon;
            return (
              <div key={i} className={`rounded-xl p-4 ring-1 ring-inset space-y-3 ${cfg.bg}`}>
                <div className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${cfg.iconBg}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wide">#{i + 1} — {cfg.label}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold leading-snug">{a.label}</div>
                  <div className="mt-1 text-xs opacity-80">{a.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Performance Analysis — Best & Worst Ads
// ──────────────────────────────────────────────────────────────
function PerformanceAnalysis({ byAd, byAdset }: { byAd: SegmentEntry[]; byAdset: SegmentEntry[] }) {
  const [view, setView] = useState<"ad" | "adset">("ad");
  const segs = view === "ad" ? byAd : byAdset;

  const winners = segs.filter((s) => s.purchases > 0 && s.cpa <= CPA_IMPROVE).slice(0, 3);
  const losers = [...segs]
    .filter((s) => s.spend >= 30)
    .filter((s) => s.purchases === 0 || s.cpa > CPA_IMPROVE)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3);

  function getProblem(s: SegmentEntry): string {
    if (s.purchases === 0) return "صرف ولا طلب واحد";
    if (s.cpa > CPA_STOP) return `CPA ${fmt(s.cpa, 0)} EGP — يتجاوز حد الإيقاف (${CPA_STOP} EGP)`;
    return `CPA ${fmt(s.cpa, 0)} EGP — يتجاوز حد التحسين (${CPA_IMPROVE} EGP)`;
  }

  function getDecision(s: SegmentEntry): string {
    if (s.purchases === 0) return "أوقفه فوراً — لا أوردرات";
    if (s.cpa > CPA_STOP) return "أوقفه وحوّل الميزانية للرابح";
    return "قم بتحسين الـ Creative والأوديانس";
  }

  function getRec(s: SegmentEntry): string {
    if (s.purchases === 0) return `${fmt(s.spend, 0)} EGP ضاعت — ارفع ميزانية الأفضل بدلاً منه`;
    if (s.cpa > CPA_STOP) return "حوّل الميزانية للإعلان الرابح";
    return "اختبر Creative جديد أو ضيّق الأوديانس";
  }

  function getWinRec(s: SegmentEntry): string {
    return `زود ميزانيته تدريجياً (×1.3 كل يومين) — CPA ${fmt(s.cpa, 0)} EGP على ${s.purchases} طلب`;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            تحليل الأداء — الرابح والخاسر
          </CardTitle>
          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
            <button
              onClick={() => setView("ad")}
              className={`px-3 py-1.5 transition-colors ${view === "ad" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Ads ({byAd.length})
            </button>
            <button
              onClick={() => setView("adset")}
              className={`px-3 py-1.5 transition-colors ${view === "adset" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Ad Sets ({byAdset.length})
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Winners */}
        {winners.length > 0 && (
          <div>
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4" /> الرابحين — ضاعف عليهم
            </div>
            <div className="space-y-2">
              {winners.map((s) => (
                <div key={s.key} className="flex items-start gap-3 rounded-xl bg-emerald-500/8 ring-1 ring-emerald-500/20 p-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{s.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      <span className="inline-flex flex-wrap items-baseline gap-x-1 gap-y-0.5">CPA <Num>{fmt(s.cpa, 0)} EGP</Num> · <Num>{fmt(s.purchases)}</Num> طلب · Spend <Num>{fmt(s.spend, 0)} EGP</Num> · CTR <Num>{fmtPct(s.ctr)}</Num></span>
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-1 font-medium">التوصية: {getWinRec(s)}</div>
                  </div>
                  <VerdictBadge type="winner" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Losers */}
        {losers.length > 0 && (
          <div>
            <div className="text-sm font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2 mb-3">
              <XCircle className="h-4 w-4" /> الخاسرين — أوقف أو صلّح
            </div>
            <div className="space-y-2">
              {losers.map((s) => {
                const lv = verdictFor(s, segs);
                const isKill = lv === "kill";
                const rowCls = isKill ? "rounded-xl bg-rose-500/8 ring-1 ring-rose-500/20 p-3" : "rounded-xl bg-amber-500/8 ring-1 ring-amber-500/20 p-3";
                const iconCls = isKill ? "h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" : "h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5";
                return (
                <div key={s.key} className={rowCls}>
                  <div className="flex items-start gap-3">
                    {isKill
                      ? <XCircle className={iconCls} />
                      : <TrendingDown className={iconCls} />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{s.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        <span className="inline-flex flex-wrap items-baseline gap-x-1 gap-y-0.5">Spend <Num>{fmt(s.spend, 0)} EGP</Num> · <Num>{fmt(s.purchases)}</Num> طلب · CTR <Num>{fmtPct(s.ctr)}</Num></span>
                      </div>
                    </div>
                    <VerdictBadge type={lv} />
                  </div>
                  <div className="mt-2 mr-7 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg bg-rose-500/10 p-2">
                      <div className="text-rose-800 dark:text-rose-300 font-bold">المشكلة</div>
                      <div className="mt-0.5 text-muted-foreground">{getProblem(s)}</div>
                    </div>
                    <div className="rounded-lg bg-rose-500/10 p-2">
                      <div className="text-rose-800 dark:text-rose-300 font-bold">القرار</div>
                      <div className="mt-0.5 text-muted-foreground">{getDecision(s)}</div>
                    </div>
                    <div className="rounded-lg bg-rose-500/10 p-2">
                      <div className="text-rose-800 dark:text-rose-300 font-bold">التوصية</div>
                      <div className="mt-0.5 text-muted-foreground">{getRec(s)}</div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {winners.length === 0 && losers.length === 0 && (
          <div className="text-center text-sm text-muted-foreground italic py-8">لا توجد بيانات كافية للتحليل في الفترة دي</div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Breakdown Table
// ──────────────────────────────────────────────────────────────
function BreakdownTable({ segments, label }: { segments: SegmentEntry[]; label: string }) {
  if (segments.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic text-center py-8">
        لا توجد بيانات على مستوى {label} في الفترة دي
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm" dir="rtl">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <th className="text-right font-medium px-3 py-2.5">{label}</th>
            <th className="text-left font-medium px-2 py-2.5">CPA</th>
            <th className="text-left font-medium px-2 py-2.5">طلبات</th>
            <th className="text-left font-medium px-2 py-2.5">Spend</th>
            <th className="text-left font-medium px-2 py-2.5">CTR</th>
            <th className="text-left font-medium px-2 py-2.5">CR</th>
            <th className="text-left font-medium px-2 py-2.5">CPC</th>
            <th className="text-left font-medium px-2 py-2.5">الحكم</th>
          </tr>
        </thead>
        <tbody>
          {[...segments].sort((a, b) => {
            if (a.purchases === 0 && b.purchases > 0) return 1;
            if (b.purchases === 0 && a.purchases > 0) return -1;
            return a.cpa - b.cpa;
          }).map((s) => {
            const v = verdictFor(s, segments);
            return (
              <tr key={s.key} className="border-t border-border hover:bg-muted/30 transition-colors">
                <td className="px-3 py-3 font-medium max-w-[220px]">
                  <div className="truncate">{s.label}</div>
                </td>
                <td className="px-2 py-3 tabular-nums text-left font-semibold">
                  <Num>{s.cpa > 0 ? `${fmt(s.cpa, 0)} EGP` : "—"}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left font-bold">
                  <Num>{fmt(s.purchases)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmt(s.spend, 0)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmtPct(s.ctr)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmtPct(s.cr)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmt(s.cpc, 0)}</Num>
                </td>
                <td className="px-2 py-3 text-left">
                  <VerdictBadge type={v} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// What-if Simulator
// ──────────────────────────────────────────────────────────────
type SimState = {
  killed: Set<string>;
  budgetMult: number;
  ctrBoost: number;
  crBoost: number;
};

type ScenarioPreset = "scale_safe" | "max_profit" | "reduce_risk";

function WhatIfSimulator({ totals, byAd }: { totals: DerivedMetrics; byAd: SegmentEntry[] }) {
  const killCandidates = useMemo(() => {
    return [...byAd]
      .filter((a) => a.spend >= 50)
      .filter((a) => a.purchases === 0 || a.cpa > CPA_IMPROVE)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 4);
  }, [byAd]);

  const [sim, setSim] = useState<SimState>({
    killed: new Set(),
    budgetMult: 1,
    ctrBoost: 0,
    crBoost: 0,
  });

  function applyScenario(preset: ScenarioPreset) {
    if (preset === "scale_safe") {
      setSim({ killed: new Set(), budgetMult: 1.5, ctrBoost: 0, crBoost: 0 });
    } else if (preset === "max_profit") {
      const allKill = new Set(killCandidates.map((a) => a.id));
      setSim({ killed: allKill, budgetMult: 1.5, ctrBoost: 0, crBoost: 0 });
    } else if (preset === "reduce_risk") {
      setSim({ killed: new Set(), budgetMult: 0.7, ctrBoost: 0, crBoost: 20 });
    }
  }

  function reset() {
    setSim({ killed: new Set(), budgetMult: 1, ctrBoost: 0, crBoost: 0 });
  }

  function toggleKill(id: string) {
    setSim((prev) => {
      const next = new Set(prev.killed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, killed: next };
    });
  }

  const result = useMemo(() => {
    const killedSpend = killCandidates.filter((a) => sim.killed.has(a.id)).reduce((s, a) => s + a.spend, 0);
    const killedOrders = killCandidates.filter((a) => sim.killed.has(a.id)).reduce((s, a) => s + a.purchases, 0);

    let spend = totals.spend - killedSpend;
    let orders = totals.purchases - killedOrders;

    // CTR boost
    const baseCtr = totals.ctr || 1;
    const ctrMult = (baseCtr + sim.ctrBoost) / baseCtr;
    orders = orders * ctrMult;

    // Budget multiplier with diminishing returns
    const m = sim.budgetMult;
    const orderMult = m <= 1.5 ? m : 1.5 + (m - 1.5) * 0.6;
    spend = spend * m;
    orders = orders * orderMult;

    // CR boost recovery
    const recoverable = Math.max(0, totals.lpv - totals.purchases) * 0.05;
    const recovered = (sim.crBoost / 100) * recoverable;
    orders = orders + recovered;

    const cpa = orders > 0 ? spend / orders : 0;
    const deltaCpa = cpa - totals.cpa;
    const deltaOrders = orders - totals.purchases;
    return { spend, orders, cpa, deltaCpa, deltaOrders };
  }, [sim, killCandidates, totals]);

  const verdict = useMemo(() => {
    const d = result.deltaCpa;
    if (totals.cpa === 0) return null;
    if (d < -totals.cpa * 0.3) return { good: true, text: "تحسّن قوي — نفّذي" };
    if (d < -totals.cpa * 0.05) return { good: true, text: "تحسّن ملحوظ" };
    if (Math.abs(d) <= totals.cpa * 0.05) return { good: null, text: "تأثير محدود" };
    return { good: false, text: "هتزيد التكلفة — راجعي القرار" };
  }, [result.deltaCpa, totals.cpa]);

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-primary" />
              محاكاة "ماذا لو؟" — جرّبي قبل ما تنفّذي
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">غيّري الإعدادات وشوفي التأثير الفوري على الأوردرات والـ CPA</p>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5 ml-1.5" />
            صفّري
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Scenario Buttons */}
        <div>
          <div className="text-sm font-semibold mb-3">سيناريوهات جاهزة</div>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => applyScenario("scale_safe")}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-emerald-500/30 bg-emerald-500/8 p-3.5 hover:border-emerald-500/60 transition-all text-center"
            >
              <Rocket className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Scale Safe</div>
              <div className="text-[11px] text-muted-foreground">زيادة ×1.5 على الكل</div>
            </button>
            <button
              onClick={() => applyScenario("max_profit")}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-amber-500/30 bg-amber-500/8 p-3.5 hover:border-amber-500/60 transition-all text-center"
            >
              <Wallet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div className="text-sm font-bold text-amber-700 dark:text-amber-400">Max Profit</div>
              <div className="text-[11px] text-muted-foreground">أوقف الخاسر + ضاعف الرابح</div>
            </button>
            <button
              onClick={() => applyScenario("reduce_risk")}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-rose-500/30 bg-rose-500/8 p-3.5 hover:border-rose-500/60 transition-all text-center"
            >
              <Eye className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              <div className="text-sm font-bold text-rose-700 dark:text-rose-400">Reduce Risk</div>
              <div className="text-[11px] text-muted-foreground">قلل الإنفاق + حسّن الصفحة</div>
            </button>
          </div>
        </div>

        {/* Predictive Results */}
        <div className="rounded-xl bg-primary/5 ring-1 ring-primary/20 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">النتيجة المتوقعة</div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "الأوردرات", before: totals.purchases, after: result.orders, unit: "", better: "up" },
              { label: "CPA", before: totals.cpa, after: result.cpa, unit: " EGP", better: "down" },
              { label: "Spend", before: totals.spend, after: result.spend, unit: " EGP", better: "neither" },
            ].map(({ label, before, after, unit, better }) => {
              const delta = after - before;
              const isBetter = better === "up" ? delta > 0 : better === "down" ? delta < 0 : null;
              const toneCls =
                isBetter === null || Math.abs(delta) < 0.5
                  ? "text-muted-foreground"
                  : isBetter
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400";
              return (
                <div key={label}>
                  <div className="text-xs text-muted-foreground font-medium">{label}</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums"><Num>{fmt(after, label === "CPA" ? 0 : 0)}{unit}</Num></div>
                  <div className={`text-xs mt-0.5 flex items-center gap-1 font-medium ${toneCls}`}>
                    {Math.abs(delta) >= 0.5 && (isBetter ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
                    <Num>{delta >= 0 ? "+" : ""}{fmt(delta, 0)}{unit}</Num>
                  </div>
                  <div className="text-[11px] text-muted-foreground/60 line-through tabular-nums"><Num>{fmt(before, 0)}{unit}</Num></div>
                </div>
              );
            })}
          </div>
          {verdict && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ring-1 ring-inset ${
              verdict.good === true ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30" :
              verdict.good === false ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/30" :
              "bg-muted text-muted-foreground ring-border"
            }`}>
              الحكم: {verdict.text}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-5">
          {/* Kill toggles */}
          {killCandidates.length > 0 && (
            <div className="md:col-span-2 space-y-3">
              <div className="text-sm font-semibold">إيقاف الإعلانات الضعيفة</div>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {killCandidates.map((a) => (
                  <label
                    key={a.id}
                    className={`flex items-start justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                      sim.killed.has(a.id) ? "border-rose-500/40 bg-rose-500/8" : "border-border bg-card hover:bg-muted/40"
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-sm font-medium leading-snug truncate">{a.label}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        <span className="inline-flex flex-wrap items-baseline gap-x-1">−<Num>{fmt(a.spend, 0)} EGP</Num> · −<Num>{fmt(a.purchases, 0)}</Num> طلب</span>
                      </div>
                      {sim.killed.has(a.id) && (
                        <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">⚠️ إيقاف هذا الإعلان = خسارة {fmt(a.purchases, 0)} طلب</div>
                      )}
                    </div>
                    <Switch checked={sim.killed.has(a.id)} onCheckedChange={() => toggleKill(a.id)} />
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Budget slider */}
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium">زيادة / تخفيض الميزانية</div>
              <div className="text-sm font-bold text-primary tabular-nums">×{sim.budgetMult.toFixed(1)}</div>
            </div>
            <Slider value={[sim.budgetMult]} onValueChange={(v) => setSim((s) => ({ ...s, budgetMult: v[0] }))} min={0.5} max={3} step={0.1} dir="ltr" />
            <div className="text-xs text-muted-foreground">
              {sim.budgetMult > 1.5 ? "⚠️ فوق ×1.5 الفعالية بتقل بسبب Audience Saturation" : "زيادة متوازنة"}
            </div>
          </div>

          {/* CTR boost */}
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium">تحسين الكريتف (رفع CTR)</div>
              <div className="text-sm font-bold text-primary tabular-nums">من {fmtPct(totals.ctr)} لـ {fmtPct(totals.ctr + sim.ctrBoost)}</div>
            </div>
            <Slider value={[sim.ctrBoost]} onValueChange={(v) => setSim((s) => ({ ...s, ctrBoost: v[0] }))} min={0} max={3} step={0.1} dir="ltr" />
            <div className="text-xs text-muted-foreground">كل +0.1% CTR = زيادة نسبية في الكليكات والأوردرات</div>
          </div>

          {/* CR boost */}
          <div className="space-y-2.5 md:col-span-2">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium">تحسين صفحة المنتج / الـ Checkout (CR Recovery)</div>
              <div className="text-sm font-bold text-primary tabular-nums">{sim.crBoost}% تعافي</div>
            </div>
            <Slider value={[sim.crBoost]} onValueChange={(v) => setSim((s) => ({ ...s, crBoost: v[0] }))} min={0} max={100} step={10} dir="ltr" />
            <div className="text-xs text-muted-foreground">
              بافتراض 5% من الـ LPV ممكن يتحوّل — عندك <Num>{fmt(Math.max(0, totals.lpv - totals.purchases))}</Num> زيارة فقدتيها
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Funnel Diagnostic — CPA Root Cause
// ──────────────────────────────────────────────────────────────
// Delivery Warnings — Meta ad-level issues & status
// ──────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, { ar: string; tone: "bad" | "warn" | "info" }> = {
  WITH_ISSUES:       { ar: "بها مشاكل",         tone: "bad" },
  DISAPPROVED:       { ar: "مرفوض",             tone: "bad" },
  PENDING_REVIEW:    { ar: "قيد المراجعة",       tone: "warn" },
  IN_PROCESS:        { ar: "قيد المعالجة",       tone: "warn" },
  CAMPAIGN_PAUSED:   { ar: "الحملة موقوفة",      tone: "info" },
  ADSET_PAUSED:      { ar: "الأد ست موقوف",      tone: "info" },
  PAUSED:            { ar: "موقوف",              tone: "info" },
  PREAPPROVED:       { ar: "موافق مسبق",         tone: "info" },
};

// ── Fix suggestion knowledge base ───────────────────────────
interface DashFixSuggestion {
  title: string;
  steps: string[];
  urgency: "critical" | "high" | "medium";
}

function getDashFix(issue: AdIssue): DashFixSuggestion {
  const code = issue.error_code ?? 0;
  const combined = ((issue.summary ?? "") + " " + (issue.error_message ?? "")).toLowerCase();

  if (code >= 1000 && code < 2000) {
    if (combined.includes("image") || combined.includes("صورة")) return {
      title: "صورة الإعلان مخالفة لسياسات Meta",
      steps: ["استبدل الصورة بأخرى تتوافق مع السياسات (لا نص > 20%، لا محتوى مضلل)", "تجنب صور قبل/بعد أو وعود بنتائج مضمونة", "أعد تشغيل الإعلان بعد تعديل الصورة"],
      urgency: "critical",
    };
    if (combined.includes("video") || combined.includes("فيديو")) return {
      title: "فيديو الإعلان مخالف لسياسات Meta",
      steps: ["راجع الفيديو — لا ادعاءات صحية/مالية مبالغ فيها", "تأكد أن الموسيقى مرخّصة", "أعد رفع الفيديو بعد التعديل أو استبدله بفيديو بديل"],
      urgency: "critical",
    };
    if (combined.includes("text") || combined.includes("نص") || combined.includes("copy")) return {
      title: "نص الإعلان مخالف لسياسات Meta",
      steps: ["احذف الادعاءات غير المدعومة: \"الأفضل\"، \"مضمون\"، \"أسرع\"", "تجنب المقارنات المضللة مع المنافسين", "أعد صياغة النص ثم أعد تشغيل الإعلان"],
      urgency: "critical",
    };
    if (combined.includes("landing") || combined.includes("url") || combined.includes("الصفحة")) return {
      title: "صفحة الهبوط مخالفة لسياسات Meta",
      steps: ["تأكد أن الصفحة تعمل ولا تُعيد توجيه غير مرغوب", "أضف Privacy Policy واضحة على الموقع", "تأكد أن محتوى الصفحة يطابق محتوى الإعلان", "احذف Pop-ups المزعجة اللي تظهر فور الدخول"],
      urgency: "critical",
    };
    return {
      title: "الإعلان مرفوض بسبب مخالفة السياسات",
      steps: [
        `كود الخطأ ${code} — افتح Ads Manager واضغط \"اعرف السبب\" بجانب الإعلان`,
        "راجع محتوى الإعلان (نص، صورة، فيديو، الرابط) وعدّل ما يخالف السياسات",
        "إذا اعتقدت أن القرار خاطئ، اضغط \"طعن في القرار\" من Ads Manager",
      ],
      urgency: "critical",
    };
  }
  if (combined.includes("audience") || combined.includes("reach") || combined.includes("أوديانس")) return {
    title: "الأوديانس ضيق — تعذّر التسليم",
    steps: ["وسّع الاستهداف (رفع الحد العمري، مناطق أكثر)", "فعّل Advantage+ Audience لتترك Meta تبحث عن المهتمين", "وسّع Lookalike من 1% إلى 3–5%", "الهدف: أوديانس لا يقل عن 500,000 شخص"],
    urgency: "high",
  };
  if (combined.includes("pixel") || combined.includes("بيكسل") || combined.includes("event")) return {
    title: "البيكسل لا يستقبل بيانات كافية",
    steps: ["افتح Events Manager وتأكد أن البيكسل نشط", "فعّل Conversions API (CAPI) بجانب البيكسل", "اختبر الأحداث بـ Test Events في Events Manager", "إذا البيانات شحيحة، غيّر optimization event لـ AddToCart أو ViewContent مؤقتاً"],
    urgency: "high",
  };
  if (combined.includes("learning") || combined.includes("تعلم")) return {
    title: "الإعلان في وضع 'Learning Limited'",
    steps: ["ارفع الميزانية اليومية — القاعدة: الميزانية ≥ CPA المستهدف × 5", "ادمج Ad Sets المتشابهة لتجميع التحويلات", "قلّل التعديلات اليدوية — كل تعديل يُعيد التعلم من الصفر", "أعط الإعلان 7 أيام كاملة قبل الحكم عليه"],
    urgency: "high",
  };
  if (combined.includes("budget") || combined.includes("ميزانية")) return {
    title: "الميزانية أقل من الحد الأدنى",
    steps: ["ارفع الميزانية اليومية فوق الحد الأدنى (عادةً 5–10$)", "تحقق من ميزانية الحملة الإجمالية ولم تنته"],
    urgency: "high",
  };
  if (combined.includes("payment") || combined.includes("billing") || combined.includes("دفع")) return {
    title: "مشكلة في طريقة الدفع",
    steps: ["افتح إعدادات Billing في Business Manager", "تأكد من صحة بيانات البطاقة وأن بها رصيد", "أضف طريقة دفع احتياطية إذا لم تكن موجودة"],
    urgency: "critical",
  };
  if (combined.includes("pending") || combined.includes("review") || combined.includes("مراجعة")) return {
    title: "الإعلان قيد المراجعة من Meta",
    steps: ["المراجعة تستغرق من 30 دقيقة إلى 24 ساعة", "لا تجري أي تعديلات أثناء المراجعة — هذا يُعيد العملية", "إذا تأخرت أكثر من 24 ساعة، تواصل مع دعم Meta"],
    urgency: "medium",
  };
  return {
    title: issue.summary || "مشكلة في تسليم الإعلان",
    steps: ["افتح Ads Manager واطلع على تفاصيل المشكلة بجانب الإعلان", "راجع إعدادات الإعلان وابحث عن سبب المشكلة", "إذا المشكلة غير واضحة، تواصل مع دعم Meta مع ذكر كود الخطأ"],
    urgency: "medium",
  };
}

function DeliveryWarnings({ byAd }: { byAd: SegmentEntry[] }) {
  // Only show truly problematic statuses — paused/stopped is expected for inactive ads
  const ACTIVE_PROBLEMS = new Set(["WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW", "IN_PROCESS"]);

  const problematic = byAd.filter((ad) => {
    const hasIssues = (ad.issues ?? []).length > 0;
    const badStatus = ad.effective_status && ACTIVE_PROBLEMS.has(ad.effective_status);
    return hasIssues || badStatus;
  });

  if (problematic.length === 0) return null;

  const toneCfg = {
    bad:  { bg: "bg-rose-500/5 ring-rose-500/20",   icon: "text-rose-600 dark:text-rose-400",   title: "text-rose-700 dark:text-rose-300",   dot: "bg-rose-500",   badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400" },
    warn: { bg: "bg-amber-500/5 ring-amber-500/20", icon: "text-amber-600 dark:text-amber-400", title: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    info: { bg: "bg-sky-500/5 ring-sky-500/20",     icon: "text-sky-600 dark:text-sky-400",     title: "text-sky-700 dark:text-sky-300",     dot: "bg-sky-500",   badge: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  };

  const STATUS_AR_DASH: Record<string, string> = {
    WITH_ISSUES:    "بها مشاكل",
    DISAPPROVED:    "مرفوض",
    PENDING_REVIEW: "قيد المراجعة",
    IN_PROCESS:     "قيد المعالجة",
  };

  function issueTone(issue: AdIssue): "bad" | "warn" {
    const code = issue.error_code;
    if (code >= 1000 && code < 2000) return "bad";
    return "warn";
  }

  function urgencyBadge(u: DashFixSuggestion["urgency"]) {
    if (u === "critical") return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400">عاجل</span>;
    if (u === "high")     return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">مهم</span>;
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-400">تنبيه</span>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          تحذيرات التسليم — مشاكل على مستوى الإعلانات
          <span className="mr-auto rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-bold text-rose-600 dark:text-rose-400">
            {problematic.length} إعلان
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          هذه التحذيرات تظهر في Ads Manager — إصلاحها يحسّن التوزيع ويقلل CPM
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {problematic.map((ad) => {
          const overallTone = (ad.issues ?? []).some(i => issueTone(i) === "bad") || ad.effective_status === "DISAPPROVED"
            ? "bad" : ad.effective_status === "PENDING_REVIEW" || (ad.issues ?? []).length > 0 ? "warn" : "info";
          const c = toneCfg[overallTone];

          // Build fix list — one per issue, or one based on status if no issues
          const fixes = (ad.issues ?? []).length > 0
            ? (ad.issues ?? []).map((iss) => ({ issue: iss, fix: getDashFix(iss) }))
            : [{ issue: { summary: ad.effective_status, error_message: ad.effective_status, error_code: 0, level: "" } as AdIssue, fix: getDashFix({ summary: ad.effective_status ?? "", error_message: ad.effective_status ?? "", error_code: 0, level: "" } as AdIssue) }];

          return (
            <details key={ad.id} className={`rounded-xl ring-1 ${c.bg} group`}>
              <summary className="flex items-center gap-3 cursor-pointer list-none px-4 py-3 select-none">
                <div className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold truncate ${c.title}`}>{ad.label}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {ad.effective_status && STATUS_AR_DASH[ad.effective_status] && (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ring-1 ${c.bg} ${c.title}`}>
                        {STATUS_AR_DASH[ad.effective_status]}
                      </span>
                    )}
                    {(ad.issues ?? []).length > 0 && (
                      <span className="text-xs text-muted-foreground">{(ad.issues ?? []).length} مشكلة</span>
                    )}
                    {ad.spend > 0 && (
                      <span className="text-xs text-muted-foreground">إنفاق: <Num>{fmt(ad.spend, 0)} EGP</Num></span>
                    )}
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground/60 group-open:rotate-180 transition-transform shrink-0" />
              </summary>

              <div className="px-4 pb-4 space-y-3 mr-5">
                {fixes.map(({ issue, fix }, fi) => (
                  <div key={fi} className="space-y-1.5">
                    {/* Severity + title */}
                    <div className="flex items-center gap-2 pt-1">
                      {urgencyBadge(fix.urgency)}
                      <span className={`text-xs font-bold ${c.title}`}>{fix.title}</span>
                      {(issue.error_code ?? 0) > 0 && (
                        <span className="text-[10px] font-mono text-muted-foreground/60 mr-auto">#{issue.error_code}</span>
                      )}
                    </div>
                    {/* Original Meta message */}
                    {issue.error_message && (
                      <div className="flex items-start gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                        <span>{issue.error_message}</span>
                      </div>
                    )}
                    {/* Fix steps */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> خطوات الإصلاح
                      </div>
                      <ol className="space-y-0.5 pr-4">
                        {fix.steps.map((step, si) => (
                          <li key={si} className="text-xs text-muted-foreground list-decimal leading-relaxed">{step}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
function FunnelDiagnostic({ totals }: { totals: DerivedMetrics }) {
  type Health = "good" | "warn" | "bad" | "neutral";

  const steps: {
    id: string; label: string; sublabel: string; value: string;
    health: Health; tip: string; icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: "cpm", label: "تكلفة المزاد", sublabel: "CPM",
      value: fmt(totals.cpm, 0) + " EGP",
      health: totals.cpm < 30 ? "good" : totals.cpm < 60 ? "warn" : "bad",
      tip: totals.cpm > 60
        ? "المزاد غالي — الأوديانس ضيقة أو المنافسة شرسة في وقت الإعلان"
        : totals.cpm > 30 ? "CPM معتدل — راقبه لو ارتفع فجأة"
        : "CPM صحي — التوزيع كفء",
      icon: CircleDollarSign,
    },
    {
      id: "ctr", label: "جذب الانتباه", sublabel: "CTR",
      value: fmtPct(totals.ctr),
      health: totals.ctr >= 2 ? "good" : totals.ctr >= 1 ? "warn" : "bad",
      tip: totals.ctr < 1
        ? "CTR ضعيف جداً — الكريتف مش بيوقف أحد في الفيد"
        : totals.ctr < 2 ? "CTR أقل من المثالي — فرصة تحسين الـ Hook"
        : "CTR صحي — الكريتف شاد الانتباه",
      icon: MousePointerClick,
    },
    {
      id: "lpv", label: "وصول للصفحة", sublabel: "LPV Rate",
      value: totals.lpv > 0 ? fmtPct(totals.lpvRate) : "—",
      health: totals.lpv === 0 ? "neutral" : totals.lpvRate >= 75 ? "good" : totals.lpvRate >= 60 ? "warn" : "bad",
      tip: totals.lpv === 0
        ? "لا توجد بيانات LPV — تأكد من pixel الصفحة"
        : totals.lpvRate < 60
        ? "الصفحة بطيئة جداً — معظم الكليكات بتنسحب قبل التحميل"
        : totals.lpvRate < 75 ? "بعض الكليكات بتضيع — سرعة الصفحة تحتاج مراجعة"
        : "معظم الكليكات بتوصل للصفحة",
      icon: Eye,
    },
    {
      id: "cr", label: "إتمام الشراء", sublabel: "CR من LPV",
      value: totals.lpv > 0 ? fmtPct(totals.crLpv) : fmtPct(totals.crClick),
      health: (totals.lpv > 0 ? totals.crLpv : totals.crClick) >= 5 ? "good"
        : (totals.lpv > 0 ? totals.crLpv : totals.crClick) >= 2 ? "warn" : "bad",
      tip: (totals.lpv > 0 ? totals.crLpv : totals.crClick) < 2
        ? "CR منخفض جداً — مشكلة في الفورم أو السعر أو عدم الثقة"
        : (totals.lpv > 0 ? totals.crLpv : totals.crClick) < 5
        ? "CR أقل من 5% — راجع صفحة المنتج والـ Checkout"
        : "CR صحي — الصفحة بتحوّل زوارها",
      icon: ShoppingCart,
    },
  ];

  const priorityOrder: Health[] = ["bad", "warn", "good", "neutral"];
  const worstStep = [...steps].sort(
    (a, b) => priorityOrder.indexOf(a.health) - priorityOrder.indexOf(b.health)
  )[0];

  const healthColor: Record<Health, string> = {
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-rose-600 dark:text-rose-400",
    neutral: "text-muted-foreground",
  };
  const healthBg: Record<Health, string> = {
    good: "bg-emerald-500/10 ring-emerald-500/20",
    warn: "bg-amber-500/10 ring-amber-500/20",
    bad: "bg-rose-500/10 ring-rose-500/20",
    neutral: "bg-muted/40 ring-border",
  };
  const healthDot: Record<Health, string> = {
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-rose-500",
    neutral: "bg-muted-foreground",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          تشخيص ارتفاع الـ CPA — أين تكمن المشكلة؟
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          CPA = CPM ÷ CTR ÷ CR — أي حلقة ضعيفة ترفع التكلفة على كل الحملة
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.id} className="relative">
                <div className={`rounded-xl ring-1 p-3.5 space-y-2 ${healthBg[step.health]}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${healthDot[step.health]}`} />
                      <span className="text-xs font-semibold">{step.label}</span>
                    </div>
                    <Icon className={`h-3.5 w-3.5 ${healthColor[step.health]}`} />
                  </div>
                  <div className={`text-xl font-bold tabular-nums ${healthColor[step.health]}`}>
                    <Num>{step.value}</Num>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight">{step.tip}</div>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden md:flex absolute -left-1.5 top-[38%] z-10 text-muted-foreground text-base font-bold">↓</div>
                )}
              </div>
            );
          })}
        </div>

        {worstStep && worstStep.health !== "good" && worstStep.health !== "neutral" && (
          <div className={`flex items-start gap-3 rounded-xl ring-1 p-3.5 ${healthBg[worstStep.health]}`}>
            <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${healthColor[worstStep.health]}`} />
            <div>
              <div className={`text-sm font-bold mb-0.5 ${healthColor[worstStep.health]}`}>
                أكبر عائق الآن: {worstStep.label} ({worstStep.sublabel} = {worstStep.value})
              </div>
              <div className="text-xs text-muted-foreground">
                {worstStep.health === "bad"
                  ? "هذه المرحلة تضاعف الـ CPA — ركّز عليها أولاً قبل أي تحسين آخر"
                  : "هذه المرحلة تستهلك جزءاً من ميزانيتك — تحسينها يقلل CPA بشكل ملحوظ"}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Expert Tips — نصائح الخبير المبنية على البيانات
// ──────────────────────────────────────────────────────────────
interface ExpertTip {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action: string;
  tone: "info" | "warn" | "good" | "bad";
}

function ExpertTips({ totals, byAd }: { totals: DerivedMetrics; byAd: SegmentEntry[] }) {
  const tips = useMemo<ExpertTip[]>(() => {
    const t: ExpertTip[] = [];

    if (totals.cpm > 60) {
      t.push({
        icon: CircleDollarSign,
        title: "المزاد غالي — CPM مرتفع فوق 60 EGP",
        body: `CPM حالياً ${fmt(totals.cpm, 0)} EGP يعني إنك بتدفع أكتر لكل 1000 مشاهدة. الأسباب الشائعة: أوديانس ضيق جداً، وقت إعلان غالي (Prime Time)، أو Quality Score منخفضة عند Meta. Meta بتكافئ الإعلانات عالية الجودة بـ CPM أرخص.`,
        action: "وسّع الأوديانس أو جرّب Advantage+ Audience. اختبر Placements مختلفة (Stories vs Reels vs Feed). ارفع جودة الكريتف — إعلانات بـ CTR عالي بتاخد CPM أرخص تلقائياً.",
        tone: "warn",
      });
    } else if (totals.cpm > 30) {
      t.push({
        icon: CircleDollarSign,
        title: "CPM معتدل — راقبه لو ارتفع",
        body: `CPM حالياً ${fmt(totals.cpm, 0)} EGP — في النطاق المقبول. ارتفاعه المفاجئ يعني إما منافسة متزايدة في الـ Auction أو تشبع الأوديانس.`,
        action: "راقب CPM يومياً. لو ارتفع أكتر من 20% في أسبوع، راجع الـ Frequency وفكّر في تجديد الكريتف.",
        tone: "info",
      });
    }

    if (totals.ctr < 1) {
      t.push({
        icon: MousePointerClick,
        title: "الكريتف مش بيوقف أحد — CTR أقل من 1%",
        body: `كل 100 شخص شافوا إعلانك، أقل من ${fmt(totals.ctr, 2)} نقروا. Meta بتعاقب الإعلانات الضعيفة بتقليل التوزيع ورفع CPM. الـ Hook (أول 3 ثواني أو أول سطر) حاسم في قرار النقر.`,
        action: "ابدأ بسؤال مباشر يلمس المشكلة ('تعبت من..؟'). استخدم رقم مثير في الـ headline ('وفّر 30% من مصروفك'). جرّب 3 hooks مختلفة ووقّف الأضعف بعد 3 أيام.",
        tone: "bad",
      });
    } else if (totals.ctr < 2) {
      t.push({
        icon: MousePointerClick,
        title: "CTR أقل من 2% — فرصة تحسين الكريتف",
        body: `CTR حالياً ${fmtPct(totals.ctr)}. تحسينه من 1.5% لـ 2% بيعني 33% طلبات زيادة من نفس الميزانية — بدون أي زيادة في الإنفاق. الإعلانات الناجحة في مصر عادةً فوق 2%.`,
        action: "اختبر UGC (فيديو عميل حقيقي). أضف نص CTA واضح في أول 3 ثواني. جرّب Carousel بدل الصورة الواحدة لمنتجات متعددة.",
        tone: "warn",
      });
    }

    if (totals.lpv > 0 && totals.lpvRate < 65) {
      t.push({
        icon: Eye,
        title: `الصفحة بطيئة — ${fmt(100 - totals.lpvRate, 0)}% من الكليكات بتضيع`,
        body: `${fmt(100 - totals.lpvRate, 0)}% من الناس اللي نقروا الإعلان خرجوا قبل ما يشوفوا الصفحة. ده بيضاعف CPA لأنك بتدفع على كليكات مش بتوصلك. الصفحة المثالية تفتح في أقل من 2 ثانية على الموبايل — الدراسات بتقول كل ثانية تأخير = 20% تراجع في التحويل.`,
        action: "افحص سرعة الصفحة على Google PageSpeed Insights. حوّل الصور لـ WebP. فكّر في Meta Instant Experience أو Lead Form لتجنب مشكلة التحميل كلياً.",
        tone: "bad",
      });
    }

    const cr = totals.lpv > 0 ? totals.crLpv : totals.crClick;
    if (cr < 2) {
      t.push({
        icon: ShoppingCart,
        title: "CR منخفض جداً — الزوار مش بيكملوا الشراء",
        body: `أقل من 2% من زوار الصفحة بيشتروا. ده يعني المشكلة مش في الإعلان، المشكلة في الصفحة أو الـ Offer. الأسباب الشائعة: السعر غالي بدون مبرر، الفورم طويل ومعقد، ما فيش ضمان أو اجتماعي proof كافي.`,
        action: "أضف شهادات عملاء وصور حقيقية. وضّح ضمان الإسترجاع بشكل بارز. قصّر الفورم لأقل حقول. جرّب عرض 'محدود الوقت' أو 'آخر 5 قطع'.",
        tone: "bad",
      });
    } else if (cr < 5) {
      t.push({
        icon: ShoppingCart,
        title: "CR أقل من 5% — صفحة المنتج تحتاج تحسين",
        body: `CR من 2-5% مقبول لكن فيه فرصة كبيرة. الفرق بين CR 3% و5% يعني 67% طلبات زيادة من نفس الميزانية — بدون زيادة إنفاق. ده أسهل وأرخص طريقة لتحسين الـ ROAS.`,
        action: "A/B test صفحة المنتج (جرّب ترتيب مختلف للمحتوى). غيّر لون زر الشراء. أضف Sticky CTA في الأسفل. استخدم بيانات Hotjar لمعرفة أين يوقف الزوار.",
        tone: "warn",
      });
    }

    if (totals.hookRate > 0 && totals.hookRate < 25) {
      t.push({
        icon: Flame,
        title: `Hook Rate ${fmt(totals.hookRate, 0)}% — الفيديو مش بيمسك`,
        body: `${fmt(100 - totals.hookRate, 0)}% بيجروا الفيديو قبل 3 ثواني. Meta بتراقب Hook Rate وبتقلل توزيع الإعلانات الضعيفة تدريجياً. إعلان بـ Hook Rate 50%+ بيكلف أرخص بكتير لنفس عدد المشاهدات.`,
        action: "ابدأ بالمشكلة أو النتيجة مباشرة ('خسرت 3000 EGP في إعلانات؟'). تجنّب الـ Logo في البداية. استخدم Text Overlay سريع. الـ Hook المثالي: سؤال + وجه إنسان + نص واضح.",
        tone: "warn",
      });
    }

    const goodAds = byAd.filter(a => a.purchases > 0 && a.cpa <= CPA_IMPROVE);
    if (goodAds.length > 0) {
      t.push({
        icon: Rocket,
        title: `فرصة Scale — عندك ${goodAds.length} إعلان بـ CPA تحت ${CPA_IMPROVE} EGP`,
        body: `لما CPA يكون تحت هدفك والإعلان شغّال، ده وقت ذهبي للتوسع. الانتظار بيعني الـ Audience يتشبع تدريجياً، الـ CPM يرتفع، والـ CTR ينخفض — والنافذة تقفل.`,
        action: "ارفع ميزانية الإعلانات الرابحة بـ 20-30% كل 48-72 ساعة. لو ارتفع CPA بعد الرفع، وقّف 24 ساعة ثم ارفع بنسبة أصغر. استخدم CBO (Campaign Budget Optimization) لتوزيع ذكي.",
        tone: "good",
      });
    }

    const activeAds = byAd.filter(a => a.spend > 50);
    if (activeAds.length > 4 && totals.purchases > 0 && totals.purchases / activeAds.length < 10) {
      t.push({
        icon: Zap,
        title: "الميزانية متفرقة — أقل من 50 طلب لكل إعلان",
        body: `عندك ${activeAds.length} إعلان نشط. لما الميزانية موزعة كتير، كل إعلان يظل في Learning Phase طول الوقت. Meta محتاجة 50 طلب في 7 أيام لكل Ad Set لتفعيل التحسين التلقائي للجمهور.`,
        action: "دمج Ad Sets الضعيفة. ركّز الميزانية على 2-3 Ad Sets بدلاً من تشتيتها. استخدم Advantage Campaign Budget لتوزيع تلقائي على الأفضل أداءً.",
        tone: "info",
      });
    }

    return t.slice(0, 6);
  }, [totals, byAd]);

  if (tips.length === 0) return null;

  const toneStyle: Record<ExpertTip["tone"], { bg: string; icon: string; title: string; border: string }> = {
    info: { bg: "bg-sky-500/5",     icon: "text-sky-600 dark:text-sky-400",       title: "text-sky-700 dark:text-sky-300",     border: "ring-sky-500/20" },
    warn: { bg: "bg-amber-500/5",   icon: "text-amber-600 dark:text-amber-400",   title: "text-amber-700 dark:text-amber-300", border: "ring-amber-500/20" },
    good: { bg: "bg-emerald-500/5", icon: "text-emerald-600 dark:text-emerald-400", title: "text-emerald-700 dark:text-emerald-300", border: "ring-emerald-500/20" },
    bad:  { bg: "bg-rose-500/5",    icon: "text-rose-600 dark:text-rose-400",     title: "text-rose-700 dark:text-rose-300",   border: "ring-rose-500/20" },
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          نصائح الخبير — تحليل مخصص لبياناتك
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          كل نصيحة مبنية على الأرقام الفعلية في حملتك — اضغط لتفاصيل الإجراء
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {tips.map((tip, i) => {
            const Icon = tip.icon;
            const s = toneStyle[tip.tone];
            return (
              <details key={i} className={`rounded-xl ring-1 ${s.border} ${s.bg} group`}>
                <summary className="flex items-center gap-3 cursor-pointer list-none px-4 py-3 select-none">
                  <Icon className={`h-4 w-4 shrink-0 ${s.icon}`} />
                  <span className={`text-sm font-bold flex-1 leading-snug ${s.title}`}>{tip.title}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground/60 group-open:rotate-180 transition-transform shrink-0" />
                </summary>
                <div className="px-4 pb-4 mr-7 space-y-2.5">
                  <p className="text-sm text-muted-foreground leading-relaxed">{tip.body}</p>
                  <div className="rounded-lg bg-primary/8 ring-1 ring-primary/20 px-3 py-2.5 text-sm">
                    <span className="font-bold text-primary ml-1">الإجراء:</span>
                    <span className="text-muted-foreground">{tip.action}</span>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Trend Alerts + Prediction + Daily Insight
// ──────────────────────────────────────────────────────────────

function MetricAlertCard({ trend }: { trend: MetricTrend }) {
  const isWorse = trend.direction === "worsening";
  const isBetter = trend.direction === "improving";

  const pct = Math.abs(trend.pctChange).toFixed(0);
  const predFmt = trend.unit === "%" ? `${trend.predictedIn3Days.toFixed(2)}%` : `${Math.round(trend.predictedIn3Days)} ${trend.unit}`;
  const curFmt = trend.unit === "%" ? `${trend.currentValue.toFixed(2)}%` : `${Math.round(trend.currentValue)} ${trend.unit}`;

  const REC: Record<string, { alert: string; rec: string }> = {
    cpa_worse: {
      alert: `CPA ارتفع ${pct}%${trend.consecutiveWorse >= 2 ? ` (${trend.consecutiveWorse} أيام متتالية)` : ""}`,
      rec: "راجع الكريتف · وسّع الاستهداف · قلّل الميزانية مؤقتاً لو استمر",
    },
    cpa_better: {
      alert: `CPA تحسّن ${pct}% — فرصة Scale`,
      rec: "زوّد الميزانية 20–30% واستغل الزخم",
    },
    ctr_worse: {
      alert: `CTR انخفض ${pct}%${trend.consecutiveWorse >= 2 ? ` (${trend.consecutiveWorse} أيام)` : ""} — الكريتف يشبع`,
      rec: "غيّر الميديا فوراً · جرّب Hook جديد في أول 3 ثواني",
    },
    ctr_better: {
      alert: `CTR تحسّن ${pct}% — الجمهور يتفاعل أكثر`,
      rec: "ثبّت الكريتف الحالي وزوّد الميزانية عليه",
    },
    cpc_worse: {
      alert: `CPC ارتفع ${pct}% — تكلفة المزاد تزيد`,
      rec: "جرّب Audience جديد · غيّر الكريتف لتقليل تكلفة المزاد",
    },
    cpc_better: {
      alert: `CPC انخفض ${pct}% — تكلفة الترافيك تتحسن`,
      rec: "وسّع الأوديانس تدريجياً واستغل الكفاءة",
    },
  };

  const key = `${trend.metric}_${isWorse ? "worse" : isBetter ? "better" : "stable"}`;
  const content = REC[key];
  if (!content) return null;

  const bgCls = isWorse
    ? trend.consecutiveWorse >= 3
      ? "bg-rose-500/8 ring-rose-500/30"
      : "bg-amber-500/8 ring-amber-500/25"
    : "bg-emerald-500/8 ring-emerald-500/25";
  const iconCls = isWorse
    ? trend.consecutiveWorse >= 3
      ? "text-rose-500"
      : "text-amber-500"
    : "text-emerald-500";
  const badgeCls = isWorse
    ? trend.consecutiveWorse >= 3
      ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
      : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  const TIcon = isWorse ? TrendingDown : TrendingUp;

  return (
    <div className={`rounded-xl ring-1 px-4 py-3 flex items-start gap-3 ${bgCls}`}>
      <TIcon className={`h-4 w-4 shrink-0 mt-0.5 ${iconCls}`} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeCls}`}>
            {trend.label}
          </span>
          <span className="text-sm font-bold leading-tight">{content.alert}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>الحالي: <span className="num font-semibold text-foreground">{curFmt}</span></span>
          <span>التوقع خلال 3 أيام: <span className={`num font-semibold ${isWorse ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{predFmt}</span></span>
        </div>
        <div className="flex items-start gap-1 text-xs">
          <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
          <span className="text-muted-foreground">{content.rec}</span>
        </div>
      </div>
    </div>
  );
}

function FreqBadge({ freq }: { freq: number | undefined }) {
  if (!freq || freq <= 0) return <span className="text-[10px] text-muted-foreground">—</span>;
  const cls =
    freq < 1.5  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
    freq < 2.5  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
    freq < 3.5  ? "bg-orange-500/15 text-orange-700 dark:text-orange-400" :
    freq < 5.0  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" :
                  "bg-rose-700/20 text-rose-800 dark:text-rose-300";
  return (
    <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${cls}`}>
      {freq.toFixed(1)}x
    </span>
  );
}

function FrequencyCard({ alert }: { alert: FrequencyAlert }) {
  const levelCls: Record<string, string> = {
    fresh:     "bg-emerald-500/8 ring-emerald-500/20 text-emerald-700 dark:text-emerald-400",
    normal:    "bg-sky-500/8 ring-sky-500/20 text-sky-700 dark:text-sky-400",
    warning:   "bg-amber-500/8 ring-amber-500/20 text-amber-700 dark:text-amber-400",
    danger:    "bg-orange-500/8 ring-orange-500/20 text-orange-700 dark:text-orange-400",
    saturated: "bg-rose-500/8 ring-rose-500/20 text-rose-700 dark:text-rose-400",
  };
  const TrendIcon = alert.trend === "rising" ? TrendingUp : alert.trend === "falling" ? TrendingDown : Activity;
  return (
    <div className={`rounded-xl ring-1 px-4 py-3 space-y-1.5 ${levelCls[alert.level]}`}>
      <div className="flex items-center gap-2">
        <TrendIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-bold">تشبع الجمهور (Frequency)</span>
        <span className="mr-auto text-[10px] font-bold num">{alert.frequency.toFixed(2)}x</span>
        {alert.trend === "rising" && alert.consecutiveRising >= 2 && (
          <span className="text-[10px] font-bold">↑ {alert.consecutiveRising} أيام</span>
        )}
      </div>
      <div className="text-xs font-medium">{alert.headline}</div>
      <div className="text-[11px] text-muted-foreground">{alert.action}</div>
      {alert.trend === "rising" && alert.predictedIn3Days > alert.frequency && (
        <div className="text-[10px] font-medium">
          التوقع بعد 3 أيام: <span className="num font-bold">{alert.predictedIn3Days.toFixed(1)}x</span>
        </div>
      )}
    </div>
  );
}

function TrendAlertsPanel({ daily, totals }: { daily: CampaignInsights["daily"]; totals: DerivedMetrics }) {
  const trends    = useMemo(() => analyzeTrends(daily), [daily]);
  const freqAlert = useMemo(() => buildFrequencyAlert(daily), [daily]);
  const prediction = useMemo(() => buildPrediction(daily, trends), [daily, trends]);

  const active = trends.filter((t) => t.direction !== "stable");
  if (active.length === 0 && daily.length < 3) return null;

  const verdictCfg = {
    danger: { cls: "bg-rose-500/10 ring-rose-500/30 text-rose-700 dark:text-rose-400", Icon: AlertTriangle, text: "خطر" },
    watch:  { cls: "bg-amber-500/10 ring-amber-500/25 text-amber-700 dark:text-amber-400", Icon: Bell, text: "مراقبة" },
    scale:  { cls: "bg-emerald-500/10 ring-emerald-500/25 text-emerald-700 dark:text-emerald-400", Icon: Rocket, text: "Scale" },
  };

  return (
    <Card className="border-primary/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          تحليل الاتجاهات — Trend Analysis
          {prediction && (
            <span className={`mr-auto text-[11px] font-bold px-2.5 py-0.5 rounded-full ring-1 ${verdictCfg[prediction.verdict].cls}`}>
              {prediction.verdictText}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Metric Alerts */}
        {active.length > 0 ? (
          <div className="space-y-2">
            {active.map((t) => <MetricAlertCard key={t.metric} trend={t} />)}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/8 ring-1 ring-emerald-500/20 rounded-xl px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            جميع المؤشرات مستقرة — لا توجد اتجاهات سلبية
          </div>
        )}

        {/* Frequency / Audience Saturation */}
        {freqAlert && (freqAlert.level !== "fresh" || freqAlert.trend === "rising") && (
          <FrequencyCard alert={freqAlert} />
        )}

        {/* Prediction Row */}
        {prediction && prediction.predictedCpa3d > 0 && (
          <div className={`rounded-xl ring-1 px-4 py-3 space-y-1.5 ${prediction.verdict === "danger" ? "bg-rose-500/5 ring-rose-500/20" : prediction.verdict === "scale" ? "bg-emerald-500/5 ring-emerald-500/20" : "bg-muted/40 ring-border"}`}>
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">توقع الأداء خلال 3 أيام</div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>CPA المتوقع: <span className={`num font-bold ${prediction.verdict === "danger" ? "text-rose-600 dark:text-rose-400" : prediction.verdict === "scale" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{Math.round(prediction.predictedCpa3d)} EGP</span></span>
              <span>الأوردرات المتوقعة: <span className="num font-bold text-foreground">{prediction.predictedOrders3d}</span></span>
              <span>الإنفاق المتوقع: <span className="num font-bold text-foreground">{Math.round(prediction.predictedSpend3d)} EGP</span></span>
            </div>
            {prediction.verdict === "danger" && (
              <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                🚨 لو استمر الوضع → تكلفة الأوردر ستزيد بشكل ملحوظ — تدخّل الآن
              </div>
            )}
            {prediction.verdict === "scale" && (
              <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                🔥 الأداء يتحسن — فرصة Scale واضحة خلال الأيام القادمة
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyInsightCard({ daily, totals }: { daily: CampaignInsights["daily"]; totals: DerivedMetrics }) {
  const trends = useMemo(() => analyzeTrends(daily), [daily]);
  const insight = useMemo(() => buildInsight(trends, totals.purchases), [trends, totals.purchases]);

  if (!insight.mainProblem && !insight.bestOpportunity) return null;

  return (
    <Card className="border-primary/15 bg-primary/2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Insight اليوم
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {insight.mainProblem && (
          <div className={`rounded-xl ring-1 px-4 py-3 space-y-1.5 ${insight.mainProblem.severity === "critical" ? "bg-rose-500/8 ring-rose-500/25" : "bg-amber-500/8 ring-amber-500/20"}`}>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${insight.mainProblem.severity === "critical" ? "bg-rose-500/20 text-rose-700 dark:text-rose-400" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"}`}>
                أهم مشكلة
              </span>
              <span className="text-sm font-bold">{insight.mainProblem.headline}</span>
            </div>
            <div className="text-xs text-muted-foreground">السبب: {insight.mainProblem.reason}</div>
            <div className="flex items-start gap-1 text-xs">
              <Zap className="h-3 w-3 text-primary shrink-0 mt-0.5" />
              <span className="font-medium text-primary">{insight.mainProblem.action}</span>
            </div>
          </div>
        )}

        {insight.bestOpportunity && (
          <div className="rounded-xl ring-1 bg-emerald-500/8 ring-emerald-500/20 px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                أفضل فرصة
              </span>
              <span className="text-sm font-bold">{insight.bestOpportunity.headline}</span>
            </div>
            <div className="text-xs text-muted-foreground">السبب: {insight.bestOpportunity.reason}</div>
            <div className="flex items-start gap-1 text-xs">
              <Rocket className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span className="font-medium text-emerald-700 dark:text-emerald-400">{insight.bestOpportunity.action}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Adset / Ad breakdown — who's hurting / helping performance
// ──────────────────────────────────────────────────────────────

interface BreakdownRow {
  key: string;
  label: string;
  spend: number;
  purchases: number;
  cpa: number;
  ctr: number;
  cpc: number;
  cpaDev: number;   // % vs avg (positive = worse for CPA)
  ctrDev: number;   // % vs avg (positive = better for CTR)
  cpcDev: number;   // % vs avg (positive = worse for CPC)
  score: number;    // combined health: higher = worse
}

function buildRows(entries: SegmentEntry[], avgCpa: number, avgCtr: number, avgCpc: number): BreakdownRow[] {
  return entries
    .filter((e) => e.spend > 0)
    .map((e) => {
      const cpaDev = avgCpa > 0 && e.cpa > 0 ? ((e.cpa - avgCpa) / avgCpa) * 100 : 0;
      const ctrDev = avgCtr > 0 && e.ctr > 0 ? ((e.ctr - avgCtr) / avgCtr) * 100 : 0;
      const cpcDev = avgCpc > 0 && e.cpc > 0 ? ((e.cpc - avgCpc) / avgCpc) * 100 : 0;
      // Higher score = worse performer
      const score = cpaDev * 0.5 - ctrDev * 0.3 + cpcDev * 0.2;
      return { key: e.key, label: e.label, spend: e.spend, purchases: e.purchases, cpa: e.cpa, ctr: e.ctr, cpc: e.cpc, cpaDev, ctrDev, cpcDev, score };
    })
    .sort((a, b) => b.score - a.score);
}

function DevBadge({ value, lowerIsBetter }: { value: number; lowerIsBetter: boolean }) {
  if (Math.abs(value) < 5) return <span className="text-[10px] text-muted-foreground font-mono">~</span>;
  const isGood = lowerIsBetter ? value < 0 : value > 0;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${isGood ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/15 text-rose-700 dark:text-rose-400"}`}>
      {sign}{value.toFixed(0)}%
    </span>
  );
}

function DevBreakdownTable({ rows, label, segments }: { rows: BreakdownRow[]; label: string; segments: SegmentEntry[] }) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground text-center py-4">لا توجد بيانات لـ {label}</div>;
  const freqMap = new Map(segments.map((s) => [s.key, s.frequency ?? 0]));
  return (
    <div className="space-y-2">
      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pb-1 border-b border-border">
        <span>{label}</span>
        <span className="text-center w-12">Freq</span>
        <span className="text-center w-16">CPA</span>
        <span className="text-center w-16">CTR</span>
        <span className="text-center w-16">CPC</span>
        <span className="text-center w-14">أوردر</span>
      </div>

      {rows.map((r, i) => {
        const isWorst = i < Math.ceil(rows.length * 0.3) && r.score > 10;
        const isBest  = i >= rows.length - Math.ceil(rows.length * 0.3) && r.score < -10;
        const rowBg = isWorst ? "bg-rose-500/5 ring-1 ring-rose-500/10" : isBest ? "bg-emerald-500/5 ring-1 ring-emerald-500/10" : "bg-muted/20";
        const freq = freqMap.get(r.key) ?? 0;
        return (
          <div key={r.key}>
            {/* ── Mobile card layout ── */}
            <div className={`sm:hidden rounded-xl px-3 py-3 space-y-2 ${rowBg}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {isWorst && <TrendingDown className="h-3.5 w-3.5 text-rose-500 shrink-0" />}
                  {isBest  && <TrendingUp   className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                  <span className="text-sm font-semibold leading-snug line-clamp-2">{r.label}</span>
                </div>
                <FreqBadge freq={freq} />
              </div>
              <div className="text-[11px] text-muted-foreground num">{fmt(r.spend, 0)} EGP إنفاق</div>
              <div className="grid grid-cols-4 gap-1 pt-1 border-t border-border/50">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">CPA</span>
                  <span className="text-sm font-bold num">{r.cpa > 0 ? fmt(r.cpa, 0) : "—"}</span>
                  <DevBadge value={r.cpaDev} lowerIsBetter />
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">CTR</span>
                  <span className="text-sm font-bold num">{fmtPct(r.ctr)}</span>
                  <DevBadge value={r.ctrDev} lowerIsBetter={false} />
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">CPC</span>
                  <span className="text-sm font-bold num">{r.cpc > 0 ? fmt(r.cpc, 0) : "—"}</span>
                  <DevBadge value={r.cpcDev} lowerIsBetter />
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">أوردر</span>
                  <span className={`text-sm font-bold num ${r.purchases > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    {r.purchases > 0 ? r.purchases : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Desktop row (hidden on mobile) ── */}
            <div className={`hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 items-center rounded-lg px-3 py-2 ${rowBg}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {isWorst && <TrendingDown className="h-3 w-3 text-rose-500 shrink-0" />}
                  {isBest  && <TrendingUp   className="h-3 w-3 text-emerald-500 shrink-0" />}
                  <span className="text-xs font-medium truncate">{r.label}</span>
                </div>
                <span className="text-[10px] text-muted-foreground num">{fmt(r.spend, 0)} EGP</span>
              </div>
              <div className="flex justify-center w-12"><FreqBadge freq={freq} /></div>
              <div className="flex flex-col items-center gap-0.5 w-16">
                <span className="text-xs font-bold num">{r.cpa > 0 ? fmt(r.cpa, 0) : "—"}</span>
                <DevBadge value={r.cpaDev} lowerIsBetter />
              </div>
              <div className="flex flex-col items-center gap-0.5 w-16">
                <span className="text-xs font-bold num">{fmtPct(r.ctr)}</span>
                <DevBadge value={r.ctrDev} lowerIsBetter={false} />
              </div>
              <div className="flex flex-col items-center gap-0.5 w-16">
                <span className="text-xs font-bold num">{r.cpc > 0 ? fmt(r.cpc, 0) : "—"}</span>
                <DevBadge value={r.cpcDev} lowerIsBetter />
              </div>
              <div className="text-center w-14">
                <span className={`text-xs font-bold num ${r.purchases > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                  {r.purchases > 0 ? r.purchases : "—"}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownByAdsetAd({
  byAdset,
  byAd,
  totals,
}: {
  byAdset: SegmentEntry[];
  byAd: SegmentEntry[];
  totals: DerivedMetrics;
}) {
  const [view, setView] = useState<"adset" | "ad">("adset");

  const adsetRows = useMemo(
    () => buildRows(byAdset, totals.cpa, totals.ctr, totals.cpc),
    [byAdset, totals]
  );
  const adRows = useMemo(
    () => buildRows(byAd, totals.cpa, totals.ctr, totals.cpc),
    [byAd, totals]
  );

  const activeRows = view === "adset" ? adsetRows : adRows;
  if (adsetRows.length === 0 && adRows.length === 0) return null;

  const worstCount = activeRows.filter((r) => r.score > 10).length;
  const bestCount  = activeRows.filter((r) => r.score < -10).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" />
            مقارنة الأداء — من يرفع ومن يخفض؟
          </CardTitle>
          <div className="flex items-center gap-1.5 mr-auto">
            {worstCount > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-400">{worstCount} خاسر</span>}
            {bestCount  > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{bestCount} رابح</span>}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          المقارنة بالنسبة لمتوسط الحملة — الانحراف بالـ% عن CPA و CTR و CPC
        </p>
        {/* Toggle */}
        <div className="flex gap-1 mt-2">
          {(["adset", "ad"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${view === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {v === "adset" ? `مجموعات (${adsetRows.length})` : `إعلانات (${adRows.length})`}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <DevBreakdownTable rows={activeRows} label={view === "adset" ? "المجموعة الإعلانية" : "الإعلان"} segments={view === "adset" ? byAdset : byAd} />
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Loading skeleton
// ──────────────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
      </div>
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Insights Body — main content
// ──────────────────────────────────────────────────────────────
function InsightsBody({ insights }: { insights: CampaignInsights }) {
  const [breakView, setBreakView] = useState<"adset" | "ad">("adset");
  const totals = insights.totals;
  const cpaTarget = Math.round(totals.cpa * 0.8);

  const trendData = insights.daily.map((d) => ({
    ...d,
    cpa: d.purchases ? Math.round(d.spend / d.purchases) : null,
    day: d.day.slice(5),
  }));

  return (
    <div className="space-y-6">
      {/* ALERT SYSTEM */}
      <AlertSystem totals={totals} byAd={insights.by_ad} />

      {/* DELIVERY WARNINGS — only for actively running campaigns */}
      {insights.campaign.effective_status === "ACTIVE" && (
        <DeliveryWarnings byAd={insights.by_ad} />
      )}

      {/* PRIORITY ENGINE */}
      <PriorityEngine totals={totals} byAd={insights.by_ad} byAdset={insights.by_adset} />

      {/* FUNNEL DIAGNOSTIC */}
      <FunnelDiagnostic totals={totals} />

      {/* KPI CARDS — 6 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          icon={CircleDollarSign}
          label="إجمالي الإنفاق"
          value={`${fmt(totals.spend, 0)} EGP`}
          sub={<Num>CPM {fmt(totals.cpm, 0)} EGP</Num>}
          tone="neutral"
        />
        <KpiCard
          icon={ShoppingCart}
          label="الأوردرات"
          value={fmt(totals.purchases)}
          sub={totals.lpv > 0 ? <><Num>{fmt(totals.lpv)}</Num> زيارة</> : undefined}
          tone={totals.purchases > 0 ? "good" : "bad"}
          trend={totals.purchases > 0 ? undefined : { dir: "down", text: "لا يوجد طلبات", good: false }}
        />
        <KpiCard
          icon={Target}
          label="تكلفة الأوردر (CPA)"
          value={totals.cpa > 0 ? `${fmt(totals.cpa, 0)} EGP` : "—"}
          sub={cpaTarget > 0 ? <>الهدف: تحت <Num>{cpaTarget} EGP</Num></> : ""}
          tone={totals.cpa === 0 ? "bad" : totals.cpa < 80 ? "good" : totals.cpa < 150 ? "warn" : "bad"}
        />
        <KpiCard
          icon={MousePointerClick}
          label="CTR (Link)"
          value={fmtPct(totals.ctr)}
          sub={<><Num>CPC {fmt(totals.cpc, 0)} EGP</Num> · <Num>{fmt(totals.link_clicks)}</Num> كليك</>}
          tone={totals.ctr >= 2 ? "good" : totals.ctr >= 1 ? "warn" : "bad"}
          trend={totals.ctr >= 2 ? { dir: "up", text: "CTR صحي", good: true } : { dir: "down", text: "CTR منخفض", good: false }}
        />
        <KpiCard
          icon={Eye}
          label="CPM"
          value={`${fmt(totals.cpm, 0)} EGP`}
          sub={<><Num>{fmt(totals.impressions)}</Num> ظهور</>}
          tone={totals.cpm < 30 ? "good" : totals.cpm < 60 ? "warn" : "bad"}
        />
        <KpiCard
          icon={TrendingUp}
          label="Conversion Rate"
          value={totals.lpv > 0 ? fmtPct(totals.crLpv) : fmtPct(totals.crClick)}
          sub={totals.lpv > 0 ? "من LPV للأوردر" : "من Click للأوردر"}
          tone={totals.crLpv >= 5 ? "good" : totals.crLpv >= 2 ? "warn" : "bad"}
          trend={totals.crLpv >= 5 ? { dir: "up", text: "CR صحي", good: true } : { dir: "down", text: "CR منخفض", good: false }}
        />
      </div>

      {/* TREND ALERTS + DAILY INSIGHT */}
      <TrendAlertsPanel daily={insights.daily} totals={totals} />
      <DailyInsightCard daily={insights.daily} totals={totals} />

      {/* BREAKDOWN: who's hurting / helping */}
      <BreakdownByAdsetAd byAdset={insights.by_adset} byAd={insights.by_ad} totals={totals} />

      {/* PERFORMANCE ANALYSIS */}
      <PerformanceAnalysis byAd={insights.by_ad} byAdset={insights.by_adset} />

      {/* EXPERT TIPS */}
      <ExpertTips totals={totals} byAd={insights.by_ad} />

      {/* WHAT-IF SIMULATOR */}
      <WhatIfSimulator totals={totals} byAd={insights.by_ad} />

      {/* DAILY TREND */}
      {trendData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              الأداء اليومي — Spend vs Purchases vs CPA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <RTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                  <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                  <Area yAxisId="left" type="monotone" dataKey="spend" name="Spend (EGP)" stroke={CHART_COLORS.primary} fill="url(#spendGrad)" strokeWidth={2} />
                  <Bar yAxisId="right" dataKey="purchases" name="Purchases" fill={CHART_COLORS.good} radius={[4, 4, 0, 0]} barSize={20} />
                  <Line yAxisId="left" type="monotone" dataKey="cpa" name="CPA (EGP)" stroke={CHART_COLORS.bad} strokeWidth={2.5} dot={{ fill: CHART_COLORS.bad, r: 3 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* BREAKDOWN ANALYSIS */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Breakdown Analysis — تفصيل كامل
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={breakView} onValueChange={(v) => setBreakView(v as typeof breakView)} dir="rtl">
            <TabsList className="mb-4">
              <TabsTrigger value="adset">Ad Set ({insights.by_adset.length})</TabsTrigger>
              <TabsTrigger value="ad">Ads / Creative ({insights.by_ad.length})</TabsTrigger>
            </TabsList>
            <TabsContent value={breakView} className="m-0">
              <BreakdownTable
                segments={breakView === "adset" ? insights.by_adset : insights.by_ad}
                label={breakView === "adset" ? "Ad Set" : "Creative"}
              />
              {(breakView === "adset" ? insights.by_adset : insights.by_ad).length > 0 && (
                <div className="mt-6 h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(breakView === "adset" ? insights.by_adset : insights.by_ad).map((s) => ({
                        name: s.label.length > 25 ? s.label.slice(0, 25) + "…" : s.label,
                        cpa: s.cpa || 0,
                        purchases: s.purchases,
                        _verdict: verdictFor(s, breakView === "adset" ? insights.by_adset : insights.by_ad),
                      }))}
                      margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <RTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                      <Bar dataKey="cpa" name="CPA (EGP)" radius={[6, 6, 0, 0]}>
                        {(breakView === "adset" ? insights.by_adset : insights.by_ad).map((s, i) => {
                          const v = verdictFor(s, breakView === "adset" ? insights.by_adset : insights.by_ad);
                          return (
                            <Cell
                              key={i}
                              fill={v === "winner" ? CHART_COLORS.good : v === "kill" ? CHART_COLORS.bad : v === "okay" ? CHART_COLORS.info : CHART_COLORS.warn}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main Dashboard
// ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<DatePreset>("7d");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const defaultCustom = useMemo(() => rangeFromPreset("7d"), []);
  const [customRange, setCustomRange] = useState<{ since: string; until: string }>(defaultCustom);

  const range = useMemo(
    () => (preset === "custom" ? customRange : rangeFromPreset(preset)),
    [preset, customRange],
  );

  const account = useAccount();
  const accounts = useAccounts();
  const campaigns = useCampaigns({ ...range, ad_account_id: selectedAccountId || undefined });
  const insights = useInsights({
    campaign_id: selectedCampaignId,
    ad_account_id: selectedAccountId || undefined,
    since: range.since,
    until: range.until,
  });

  const accountCampaigns = useMemo(() => campaigns.data?.campaigns ?? [], [campaigns.data?.campaigns]);

  useEffect(() => {
    if (!selectedAccountId) return;
    const top = [...accountCampaigns].filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend)[0];
    setSelectedCampaignId(top?.id || null);
  }, [accountCampaigns, selectedAccountId]);

  useEffect(() => {
    const available = accounts.data?.accounts || [];
    if (!selectedAccountId && available.length > 0) {
      setSelectedAccountId(available[0].id);
    }
  }, [accounts.data, selectedAccountId]);

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ["meta"] });
  const isRefreshing = campaigns.isFetching || insights.isFetching;

  const accountLine = account.data
    ? `${account.data.name} · ${account.data.currency} · ${account.data.timezone_name}`
    : "Meta Ads";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* HEADER */}
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            مباشر من Meta Ads · {accountLine}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">نظام القرارات التفاعلي</h1>
              <p className="mt-1 text-sm text-muted-foreground">Meta Ads — تحليل حي · محاكاة · قرارات فورية</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-card">
                <Activity className="h-3 w-3 ml-1" />
                Live API
              </Badge>
              {insights.data && (
                <Badge variant="outline" className="bg-card">
                  <Num>{insights.data.period.days}</Num> يوم
                </Badge>
              )}
            </div>
          </div>
        </header>

        {/* CONTROLS */}
        <DashboardControls
          campaigns={accountCampaigns}
          accounts={accounts.data?.accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          isLoadingCampaigns={campaigns.isLoading}
          selectedCampaignId={selectedCampaignId}
          onSelectCampaign={setSelectedCampaignId}
          preset={preset}
          onPresetChange={setPreset}
          range={range}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          lastUpdated={insights.data?.fetched_at}
        />

        {/* Errors */}
        {(campaigns.error || insights.error) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>تعذّر تحميل البيانات من Meta</AlertTitle>
            <AlertDescription className="mt-1 text-xs">
              {(campaigns.error as Error)?.message || (insights.error as Error)?.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Content */}
        {insights.isLoading || (campaigns.isLoading && !insights.data) ? (
          <DashboardSkeleton />
        ) : insights.data ? (
          <InsightsBody insights={insights.data} />
        ) : !selectedCampaignId && campaigns.data?.campaigns.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>لا توجد حملات في الفترة المحددة</AlertTitle>
            <AlertDescription>جرّبي فترة أطول أو افتحي Meta Ads Manager للتأكد.</AlertDescription>
          </Alert>
        ) : null}

        {/* FOOTER */}
        <footer className="pt-6 mt-6 border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              البيانات مباشرة من Meta Marketing API ·{" "}
              {insights.data && (
                <>
                  <Num>{insights.data.daily.length}</Num> يوم ·{" "}
                  <Num>{insights.data.by_ad.length}</Num> creative ·{" "}
                  <Num>{insights.data.by_adset.length}</Num> ad set
                </>
              )}
            </div>
            <div>كل الأرقام بالـ EGP</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
