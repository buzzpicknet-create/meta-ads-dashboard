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
import { useCampaigns, useInsights, useAccount, useAccounts } from "@/hooks/use-meta";
import {
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
function AlertSystem({ totals, byAd }: { totals: DerivedMetrics; byAd: SegmentEntry[] }) {
  const alerts: { type: "danger" | "warn" | "info"; msg: string }[] = [];

  // Drain ads
  const drainAds = byAd.filter((a) => a.spend >= 100 && (a.purchases === 0 || a.cpa > CPA_STOP));
  drainAds.forEach((a) => {
    alerts.push({
      type: "danger",
      msg: `"${a.label.slice(0, 40)}" يستهلك ${fmt(a.spend, 0)} EGP بدون نتائج كافية — أوقفه فوراً`,
    });
  });

  if (totals.ctr < 1) alerts.push({ type: "danger", msg: `CTR منخفض جداً (${fmtPct(totals.ctr)}) — الكريتف مش بيوقف أحد` });
  else if (totals.ctr < 1.5) alerts.push({ type: "warn", msg: `CTR (${fmtPct(totals.ctr)}) أقل من المعدل الصحي — حسّن الـ Creative` });

  if (totals.lpv > 0 && totals.lpvRate < 60) alerts.push({ type: "danger", msg: `${fmt(totals.lpvRate, 0)}% فقط من الكليكات وصلت الصفحة — الصفحة بطيئة أو متكسرة` });
  else if (totals.lpv > 0 && totals.lpvRate < 75) alerts.push({ type: "warn", msg: `${fmt(totals.lpvRate, 0)}% من الكليكات وصلت الصفحة — سرعة التحميل تحتاج مراجعة` });

  if (totals.lpv > 0 && totals.crLpv < 2) alerts.push({ type: "danger", msg: `CR (${fmtPct(totals.crLpv)}) منخفض جداً — مشكلة في الفورم أو التسعير` });
  else if (totals.lpv > 0 && totals.crLpv < 5) alerts.push({ type: "warn", msg: `CR (${fmtPct(totals.crLpv)}) أقل من 5% — راجعي صفحة الـ Checkout` });

  if (totals.hookRate > 0 && totals.hookRate < 20) alerts.push({ type: "warn", msg: `Hook Rate (${fmt(totals.hookRate, 0)}%) ضعيف — أول 3 ثواني في الفيديو مش بتمسك الناس` });

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
          {a.msg}
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

      {/* PRIORITY ENGINE */}
      <PriorityEngine totals={totals} byAd={insights.by_ad} byAdset={insights.by_adset} />

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

      {/* PERFORMANCE ANALYSIS */}
      <PerformanceAnalysis byAd={insights.by_ad} byAdset={insights.by_adset} />

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
