import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
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
  ChevronUp,
  CircleDollarSign,
  Eye,
  Info,
  MousePointerClick,
  PauseCircle,
  RefreshCw,
  Rocket,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Stethoscope,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarRange } from "lucide-react";
import { useAccounts, useAccountOverview, useCpaAlerts } from "@/hooks/use-meta";
import {
  analyzeTrends,
  buildInsight,
  buildPrediction,
  buildFrequencyAlert,
  type MetricTrend,
  type FrequencyAlert,
} from "@/lib/trend-analysis";
import {
  type AccountOverview,
  type AdWithIssues,
  type AdIssue,
  type CampaignSummaryFull,
  type DatePreset,
  type AdAccountSummary,
  type DailyPoint,
  type DerivedMetrics,
  type CpaWinner,
  type CpaWarning,
  type CpaAlertsResult,
  rangeFromPreset,
  formatRange,
} from "@/lib/meta-api";
import { snapshotAlerts, type AlertSnapshotInput } from "@/lib/alerts-api";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { CampaignDiagnosisModal } from "@/components/DiagnosisModal";
import { CampaignLink } from "@/components/CampaignLink";

// ──────────────────────────────────────────────────────────────
// Diagnose button — opens CampaignDiagnosisModal in-place when
// campaignId/accountId/since/until are provided; otherwise just
// renders an inert indicator badge.
// ──────────────────────────────────────────────────────────────
function HowToBtn({
  size = "sm",
  campaignId,
  accountId,
  since,
  until,
}: {
  problem?: string;
  metrics?: Record<string, unknown>;
  size?: "sm" | "xs";
  campaignId?: string;
  accountId?: string;
  since?: string;
  until?: string;
}) {
  const [open, setOpen] = useState(false);
  const cls = `shrink-0 inline-flex items-center gap-1 font-bold rounded-lg bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-700 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 transition-colors whitespace-nowrap cursor-pointer ${
    size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-1"
  }`;

  if (campaignId && accountId && since && until) {
    return (
      <>
        <button
          type="button"
          className={cls}
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        >
          <Stethoscope className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
          تشخيص
        </button>
        {open && (
          <CampaignDiagnosisModal
            campaignId={campaignId}
            accountId={accountId}
            since={since}
            until={until}
            open={open}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <span className={cls} onClick={(e) => e.stopPropagation()}>
      <Stethoscope className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      تشخيص
    </span>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function fmt(n: number, d = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n: number): string { return `${n.toFixed(2)}%`; }
function Num({ children }: { children: React.ReactNode }) { return <span dir="ltr" className="num">{children}</span>; }

const CHART_COLORS = {
  primary: "hsl(244 75% 57%)",
  good: "hsl(152 60% 42%)",
  bad: "hsl(0 75% 55%)",
};

const presetLabels: Record<DatePreset, string> = {
  today: "اليوم",
  yesterday: "أمس",
  "7d": "آخر 7 أيام",
  "14d": "آخر 14 يوم",
  "28d": "آخر 28 يوم",
  current_month: "الشهر الحالي",
  prev_month: "الشهر السابق",
  custom: "مخصص",
};

// ──────────────────────────────────────────────────────────────
// Delta indicator
// ──────────────────────────────────────────────────────────────
function Delta({
  current,
  prev,
  lowerIsBetter = false,
  unit = "",
}: {
  current: number;
  prev: number;
  lowerIsBetter?: boolean;
  unit?: string;
}) {
  if (prev === 0) return null;
  const delta = ((current - prev) / prev) * 100;
  const isGood = lowerIsBetter ? delta < 0 : delta > 0;
  const sign = delta >= 0 ? "+" : "";
  return (
    <div
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        isGood ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {sign}{fmt(Math.abs(delta), 0)}%{unit}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Health Status
// ──────────────────────────────────────────────────────────────
function healthScore(overview: AccountOverview): "good" | "warn" | "danger" {
  const { totals, campaigns } = overview;
  const activeCampaigns = campaigns.filter((c) => c.spend > 0);
  if (activeCampaigns.length === 0) return "warn";

  const cpas = activeCampaigns.filter((c) => c.purchases > 0).map((c) => c.cpa);
  const minCpa = cpas.length ? Math.min(...cpas) : 0;
  const loserCount = activeCampaigns.filter(
    (c) => c.purchases === 0 || (minCpa > 0 && c.cpa > minCpa * 2.5)
  ).length;
  const loserRatio = loserCount / activeCampaigns.length;

  if (loserRatio > 0.5 || totals.ctr < 0.5) return "danger";
  if (loserRatio > 0.25 || totals.crLpv < 2) return "warn";
  return "good";
}

function HealthBadge({ status }: { status: "good" | "warn" | "danger" }) {
  const cfg = {
    good: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30", dot: "bg-emerald-500", text: "الحساب شغّال كويس" },
    warn: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30", dot: "bg-amber-500", text: "يحتاج تحسين" },
    danger: { cls: "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-rose-500/30", dot: "bg-rose-500", text: "تحذير — تحرّك الآن" },
  }[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${cfg.cls}`}>
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      {cfg.text}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────
// CPA Alerts Panel — 72-hour scale / warning signals
// ──────────────────────────────────────────────────────────────

function CpaWinnerCard({ w }: { w: CpaWinner }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-emerald-500/8 ring-1 ring-emerald-500/25 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30 text-[10px] font-bold px-2 py-0.5">
              <Rocket className="h-3 w-3" /> فرصة توسع — CPA {fmt(w.cpa, 0)} EGP
            </span>
            <span className="text-[10px] text-muted-foreground">{w.purchases} أوردر · {fmt(w.spend, 0)} EGP</span>
          </div>
          <div dir="ltr" className="text-sm font-semibold mt-1.5 truncate text-right" title={w.name}>{w.name}</div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 p-1 rounded-lg hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Reasons */}
          <div>
            <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-1.5">لماذا هي رابحة؟</div>
            <ul className="space-y-1">
              {w.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  {r}
                </li>
              ))}
            </ul>
          </div>

          {/* Best Ad/Adset */}
          {(w.best_adset || w.best_ad) && (
            <div className="grid sm:grid-cols-2 gap-2">
              {w.best_adset && (
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2.5">
                  <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1">أفضل Ad Set</div>
                  <div dir="ltr" className="text-xs font-semibold truncate text-right" title={w.best_adset.name}>{w.best_adset.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    CPA <span className="num font-bold text-emerald-600 dark:text-emerald-400">{fmt(w.best_adset.cpa, 0)}</span> EGP
                    {" · "}{w.best_adset.purchases} أوردر
                  </div>
                </div>
              )}
              {w.best_ad && (
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2.5">
                  <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1">أفضل إعلان (Ad)</div>
                  <div dir="ltr" className="text-xs font-semibold truncate text-right" title={w.best_ad.name}>{w.best_ad.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    CPA <span className="num font-bold text-emerald-600 dark:text-emerald-400">{fmt(w.best_ad.cpa, 0)}</span> EGP
                    {" · "}{w.best_ad.purchases} أوردر
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            ✅ الإجراء المقترح: ضاعف ميزانية هذه الحملة بنسبة 30-50% واستغل الزخم الآن
          </div>
        </div>
      )}
    </div>
  );
}

function CpaWarningCard({ w, accountId, since, until }: { w: CpaWarning; accountId?: string; since?: string; until?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-amber-500/8 ring-1 ring-amber-500/25 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30 text-[10px] font-bold px-2 py-0.5">
              <AlertTriangle className="h-3 w-3" /> راقب CPA — {w.purchases === 0 ? "بدون أوردر" : `${fmt(w.cpa, 0)} EGP`}
            </span>
            <span className="text-[10px] text-muted-foreground">{w.purchases} أوردر · {fmt(w.spend, 0)} EGP</span>
            <HowToBtn
              problem={w.purchases === 0 ? "no-conversions" : "cpa-high"}
              metrics={{ name: w.name, cpa: w.purchases > 0 ? w.cpa : undefined, spend: w.spend, purchases: w.purchases }}
              size="xs"
              campaignId={w.id}
              accountId={accountId}
              since={since}
              until={until}
            />
          </div>
          <div className="text-sm font-semibold mt-1.5 truncate">
            <CampaignLink
              campaignId={w.id}
              campaignName={w.name}
              accountId={accountId}
              since={since}
              until={until}
              className="text-sm font-semibold"
            />
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 p-1 rounded-lg hover:bg-amber-500/10 text-amber-600 dark:text-amber-400"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Causes */}
          <div>
            <div className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1.5">أسباب المشكلة</div>
            <ul className="space-y-1">
              {w.causes.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {/* Worst Ad/Adset */}
          {(w.worst_adset || w.worst_ad) && (
            <div className="grid sm:grid-cols-2 gap-2">
              {w.worst_adset && (
                <div className="rounded-lg bg-rose-500/8 px-3 py-2.5">
                  <div className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wide mb-1">أضعف Ad Set</div>
                  <div dir="ltr" className="text-xs font-semibold truncate text-right" title={w.worst_adset.name}>{w.worst_adset.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {w.worst_adset.purchases > 0
                      ? <>CPA <span className="num font-bold text-rose-600 dark:text-rose-400">{fmt(w.worst_adset.cpa, 0)}</span> EGP</>
                      : <span className="text-rose-600 dark:text-rose-400 font-bold">بدون أوردر</span>}
                    {" · "}{fmt(w.worst_adset.spend, 0)} EGP إنفاق
                  </div>
                </div>
              )}
              {w.worst_ad && (
                <div className="rounded-lg bg-rose-500/8 px-3 py-2.5">
                  <div className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wide mb-1">أضعف إعلان (Ad)</div>
                  <div dir="ltr" className="text-xs font-semibold truncate text-right" title={w.worst_ad.name}>{w.worst_ad.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {w.worst_ad.purchases > 0
                      ? <>CPA <span className="num font-bold text-rose-600 dark:text-rose-400">{fmt(w.worst_ad.cpa, 0)}</span> EGP</>
                      : <span className="text-rose-600 dark:text-rose-400 font-bold">بدون أوردر</span>}
                    {" · "}{fmt(w.worst_ad.spend, 0)} EGP إنفاق
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Solutions */}
          <div>
            <div className="text-xs font-bold text-foreground mb-1.5">الحلول المقترحة</div>
            <ul className="space-y-1">
              {w.solutions.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Wrench className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function CpaAlertsPanel({ accountId }: { accountId: string }) {
  const alerts = useCpaAlerts({ ad_account_id: accountId });

  if (alerts.isLoading) {
    return (
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            جاري تحليل بيانات الـ 72 ساعة الأخيرة…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (alerts.error || !alerts.data) return null;

  const { winners, warnings, period } = alerts.data;
  if (winners.length === 0 && warnings.length === 0) return null;

  const fmt72 = (d: string) => {
    const [, m, day] = d.split("-");
    return `${Number(day)}/${Number(m)}`;
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Zap className="h-4 w-4 text-primary" />
          تنبيهات CPA — آخر 72 ساعة
          <span className="text-xs font-normal text-muted-foreground mr-auto">
            ({fmt72(period.since)} → {fmt72(period.until)})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {winners.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Rocket className="h-3.5 w-3.5" />
              {winners.length === 1 ? "حملة رابحة" : `${winners.length} حملات رابحة`} — CPA أقل من 30 EGP
            </div>
            {winners.map((w) => <CpaWinnerCard key={w.id} w={w} />)}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warnings.length === 1 ? "حملة تحتاج مراقبة" : `${warnings.length} حملات تحتاج مراقبة`} — CPA أعلى من 40 EGP
            </div>
            {warnings.map((w) => <CpaWarningCard key={w.id} w={w} accountId={accountId} since={period.since} until={period.until} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// KPI Card with prev comparison
// ──────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  current,
  prev,
  lowerIsBetter = false,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: React.ReactNode;
  current?: number;
  prev?: number;
  lowerIsBetter?: boolean;
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
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="text-xs text-muted-foreground font-medium">{label}</div>
            <div className="text-xl font-bold tracking-tight"><Num>{value}</Num></div>
            {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
            {current !== undefined && prev !== undefined && (
              <Delta current={current} prev={prev} lowerIsBetter={lowerIsBetter} />
            )}
          </div>
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 shrink-0 ${toneRing}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Trend Alerts + Prediction + Daily Insight (account level)
// ──────────────────────────────────────────────────────────────

function CampaignChips({ names, variant }: { names: string[]; variant: "warn" | "good" }) {
  if (names.length === 0) return null;
  const cls = variant === "warn"
    ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20"
    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20";
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      <span className="text-[10px] text-muted-foreground self-center">الحملات:</span>
      {names.map((n) => (
        <span key={n} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 ${cls}`}>
          {n.length > 35 ? n.slice(0, 35) + "…" : n}
        </span>
      ))}
    </div>
  );
}

function getRelevantCampaigns(
  campaigns: CampaignSummaryFull[] | undefined,
  metric: "cpa" | "ctr" | "cpc",
  direction: "worsening" | "improving"
): string[] {
  const active = (campaigns ?? []).filter((c) => c.spend > 0);
  let sorted: CampaignSummaryFull[] = [];
  if (metric === "cpa") {
    const withPurchases = active.filter((c) => c.cpa > 0);
    sorted = direction === "worsening"
      ? [...withPurchases].sort((a, b) => b.cpa - a.cpa)
      : [...withPurchases].sort((a, b) => a.cpa - b.cpa);
  } else if (metric === "ctr") {
    sorted = direction === "worsening"
      ? [...active].sort((a, b) => a.ctr - b.ctr)
      : [...active].sort((a, b) => b.ctr - a.ctr);
  } else {
    const withCpc = active.filter((c) => c.cpc > 0);
    sorted = direction === "worsening"
      ? [...withCpc].sort((a, b) => b.cpc - a.cpc)
      : [...withCpc].sort((a, b) => a.cpc - b.cpc);
  }
  return sorted.slice(0, 3).map((c) => c.name);
}

function OvMetricAlertCard({ trend, campaigns }: { trend: MetricTrend; campaigns: CampaignSummaryFull[] | undefined }) {
  const isWorse = trend.direction === "worsening";
  const isBetter = trend.direction === "improving";
  if (trend.direction === "stable") return null;

  const pct = Math.abs(trend.pctChange).toFixed(0);
  const predFmt = trend.unit === "%" ? `${trend.predictedIn3Days.toFixed(2)}%` : `${Math.round(trend.predictedIn3Days)} ${trend.unit}`;
  const curFmt  = trend.unit === "%" ? `${trend.currentValue.toFixed(2)}%`       : `${Math.round(trend.currentValue)} ${trend.unit}`;

  const RECS: Record<string, { alert: string; rec: string }> = {
    cpa_worse:  { alert: `CPA ارتفع ${pct}%${trend.consecutiveWorse >= 2 ? ` (${trend.consecutiveWorse} أيام متتالية)` : ""}`, rec: "راجع الكريتف · وسّع الاستهداف · قلّل الميزانية مؤقتاً لو استمر" },
    cpa_better: { alert: `CPA تحسّن ${pct}% — فرصة Scale`, rec: "زوّد الميزانية 20–30% واستغل الزخم" },
    ctr_worse:  { alert: `CTR انخفض ${pct}%${trend.consecutiveWorse >= 2 ? ` (${trend.consecutiveWorse} أيام)` : ""} — الكريتف يشبع`, rec: "غيّر الميديا فوراً · جرّب Hook جديد في أول 3 ثواني" },
    ctr_better: { alert: `CTR تحسّن ${pct}% — الجمهور يتفاعل أكثر`, rec: "ثبّت الكريتف الحالي وزوّد الميزانية عليه" },
    cpc_worse:  { alert: `CPC ارتفع ${pct}% — تكلفة المزاد تزيد`, rec: "جرّب Audience جديد · غيّر الكريتف لتقليل تكلفة المزاد" },
    cpc_better: { alert: `CPC انخفض ${pct}% — تكلفة الترافيك تتحسن`, rec: "وسّع الأوديانس تدريجياً واستغل الكفاءة" },
  };

  const key = `${trend.metric}_${isWorse ? "worse" : isBetter ? "better" : "stable"}`;
  const content = RECS[key];
  if (!content) return null;

  const bgCls   = isWorse ? (trend.consecutiveWorse >= 3 ? "bg-rose-500/8 ring-rose-500/30" : "bg-amber-500/8 ring-amber-500/25") : "bg-emerald-500/8 ring-emerald-500/25";
  const iconCls  = isWorse ? (trend.consecutiveWorse >= 3 ? "text-rose-500" : "text-amber-500") : "text-emerald-500";
  const badgeCls = isWorse ? (trend.consecutiveWorse >= 3 ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400") : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  const TIcon = isWorse ? TrendingDown : TrendingUp;

  const relatedCampaigns = getRelevantCampaigns(campaigns, trend.metric, trend.direction as "worsening" | "improving");

  const metricProblemKey: Record<string, string> = {
    cpa: "cpa-high",
    ctr: "ctr-low",
    cpc: "cpc-high",
  };
  const problemKey = isWorse ? (metricProblemKey[trend.metric] ?? "") : "";

  return (
    <div className={`rounded-xl ring-1 px-4 py-3 flex items-start gap-3 ${bgCls}`}>
      <TIcon className={`h-4 w-4 shrink-0 mt-0.5 ${iconCls}`} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeCls}`}>{trend.label}</span>
          <span className="text-sm font-bold leading-tight">{content.alert}</span>
          {isWorse && problemKey && (
            <HowToBtn
              problem={problemKey}
              size="xs"
              metrics={{
                cpa: trend.metric === "cpa" ? trend.currentValue : undefined,
                ctr: trend.metric === "ctr" ? trend.currentValue : undefined,
                cpc: trend.metric === "cpc" ? trend.currentValue : undefined,
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>الحالي: <span className="num font-semibold text-foreground">{curFmt}</span></span>
          <span>التوقع خلال 3 أيام: <span className={`num font-semibold ${isWorse ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{predFmt}</span></span>
        </div>
        <div className="flex items-start gap-1 text-xs">
          <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
          <span className="text-muted-foreground">{content.rec}</span>
        </div>
        <CampaignChips names={relatedCampaigns} variant={isWorse ? "warn" : "good"} />
      </div>
    </div>
  );
}

function OvFreqBadge({ freq }: { freq: number | undefined }) {
  if (!freq || freq <= 0) return <span className="text-[10px] text-muted-foreground">—</span>;
  const cls =
    freq < 1.5  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
    freq < 2.0  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
                  "bg-rose-500/15 text-rose-700 dark:text-rose-400";
  return (
    <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${cls}`}>
      {freq.toFixed(1)}x
    </span>
  );
}

function OvFrequencyCard({ alert }: { alert: FrequencyAlert }) {
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
        <span className="mr-auto text-[10px] font-bold">{alert.frequency.toFixed(2)}x</span>
        {alert.trend === "rising" && alert.consecutiveRising >= 2 && (
          <span className="text-[10px] font-bold">↑ {alert.consecutiveRising} أيام</span>
        )}
        <HowToBtn problem="high-frequency" size="xs" metrics={{ freq: alert.frequency }} />
      </div>
      <div className="text-xs font-medium">{alert.headline}</div>
      <div className="text-[11px] text-muted-foreground">{alert.action}</div>
      {alert.trend === "rising" && alert.predictedIn3Days > alert.frequency && (
        <div className="text-[10px] font-medium">
          التوقع بعد 3 أيام: <span className="font-bold">{alert.predictedIn3Days.toFixed(1)}x</span>
        </div>
      )}
    </div>
  );
}

function FrequencyDangerPanel({ campaigns }: { campaigns: CampaignSummaryFull[] }) {
  const danger = useMemo(
    () =>
      campaigns
        .filter((c) => (c.frequency ?? 0) >= 1.5 && c.spend > 0)
        .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0)),
    [campaigns]
  );
  if (danger.length === 0) return null;

  function freqLabel(f: number) {
    if (f < 2.0) return "حرج — جهّز كريتف بديل";
    return "خطر — غيّر الكريتف الآن";
  }
  function freqCls(f: number) {
    if (f < 2.0) return { row: "bg-amber-500/8 border-amber-500/20 text-amber-700 dark:text-amber-400", badge: "bg-amber-500/20 text-amber-800 dark:text-amber-300" };
    return { row: "bg-rose-500/8 border-rose-500/20 text-rose-700 dark:text-rose-400", badge: "bg-rose-500/20 text-rose-800 dark:text-rose-300" };
  }

  return (
    <Card className="border-rose-500/20 bg-rose-500/3">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-rose-700 dark:text-rose-400">
          <Bell className="h-4 w-4 shrink-0" />
          تنبيه تشبع الجمهور — {danger.length} {danger.length === 1 ? "حملة" : "حملات"} دخلت نطاق الخطر (Frequency ≥ 1.5x)
          <HowToBtn problem="high-frequency" size="xs" metrics={{ freq: Math.max(...danger.map((c) => c.frequency ?? 0)) }} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[11px] text-muted-foreground mb-3">
          كل حملة تجاوزت التكرار 1.5x تحتاج مراجعة فورية — غيّر الكريتف أو الجمهور أو الزاوية الإعلانية
        </p>
        {danger.map((c) => {
          const f = c.frequency ?? 0;
          const cls = freqCls(f);
          return (
            <div
              key={c.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${cls.row}`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 text-xs font-medium truncate">{c.name}</span>
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${cls.badge}`}>
                {f.toFixed(2)}x
              </span>
              <span className="text-[10px] font-medium opacity-80 whitespace-nowrap">{freqLabel(f)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function OvTrendAlertsPanel({ daily, totals, campaigns }: { daily: DailyPoint[]; totals: DerivedMetrics; campaigns: CampaignSummaryFull[] | undefined }) {
  const trends    = useMemo(() => analyzeTrends(daily), [daily]);
  const freqAlert = useMemo(() => buildFrequencyAlert(daily), [daily]);
  const prediction = useMemo(() => buildPrediction(daily, trends), [daily, trends]);
  const active    = trends.filter((t) => t.direction !== "stable");
  if (daily.length < 3) return null;

  const verdictCfg = {
    danger: "bg-rose-500/10 ring-rose-500/30 text-rose-700 dark:text-rose-400",
    watch:  "bg-amber-500/10 ring-amber-500/25 text-amber-700 dark:text-amber-400",
    scale:  "bg-emerald-500/10 ring-emerald-500/25 text-emerald-700 dark:text-emerald-400",
  };

  return (
    <Card className="border-primary/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          تحليل الاتجاهات — Trend Analysis
          {prediction && (
            <span className={`mr-auto text-[11px] font-bold px-2.5 py-0.5 rounded-full ring-1 ${verdictCfg[prediction.verdict]}`}>
              {prediction.verdictText}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length > 0 ? (
          <div className="space-y-2">
            {active.map((t) => <OvMetricAlertCard key={t.metric} trend={t} campaigns={campaigns} />)}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/8 ring-1 ring-emerald-500/20 rounded-xl px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            جميع المؤشرات مستقرة — لا توجد اتجاهات سلبية
          </div>
        )}

        {/* Frequency / Audience Saturation */}
        {freqAlert && (freqAlert.level !== "fresh" || freqAlert.trend === "rising") && (
          <OvFrequencyCard alert={freqAlert} />
        )}

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

function OvDailyInsightCard({ daily, totals, campaigns }: { daily: DailyPoint[]; totals: DerivedMetrics; campaigns: CampaignSummaryFull[] | undefined }) {
  const trends  = useMemo(() => analyzeTrends(daily), [daily]);
  const insight = useMemo(() => buildInsight(trends, totals.purchases), [trends, totals.purchases]);
  if (!insight.mainProblem && !insight.bestOpportunity) return null;

  const problemCampaigns = useMemo(() => {
    if (!insight.mainProblem) return [];
    const m = insight.mainProblem.metric as "cpa" | "ctr" | "cpc";
    return getRelevantCampaigns(campaigns, m, "worsening");
  }, [insight.mainProblem, campaigns]);

  const opportunityCampaigns = useMemo(() => {
    if (!insight.bestOpportunity) return [];
    const m = insight.bestOpportunity.metric as "cpa" | "ctr" | "cpc";
    return getRelevantCampaigns(campaigns, m, "improving");
  }, [insight.bestOpportunity, campaigns]);

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
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${insight.mainProblem.severity === "critical" ? "bg-rose-500/20 text-rose-700 dark:text-rose-400" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"}`}>أهم مشكلة</span>
              <span className="text-sm font-bold">{insight.mainProblem.headline}</span>
            </div>
            <div className="text-xs text-muted-foreground">السبب: {insight.mainProblem.reason}</div>
            <div className="flex items-start gap-1 text-xs">
              <Zap className="h-3 w-3 text-primary shrink-0 mt-0.5" />
              <span className="font-medium text-primary">{insight.mainProblem.action}</span>
            </div>
            <CampaignChips names={problemCampaigns} variant="warn" />
          </div>
        )}
        {insight.bestOpportunity && (
          <div className="rounded-xl ring-1 bg-emerald-500/8 ring-emerald-500/20 px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">أفضل فرصة</span>
              <span className="text-sm font-bold">{insight.bestOpportunity.headline}</span>
            </div>
            <div className="text-xs text-muted-foreground">السبب: {insight.bestOpportunity.reason}</div>
            <div className="flex items-start gap-1 text-xs">
              <Rocket className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span className="font-medium text-emerald-700 dark:text-emerald-400">{insight.bestOpportunity.action}</span>
            </div>
            <CampaignChips names={opportunityCampaigns} variant="good" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Alerts section
// ──────────────────────────────────────────────────────────────
function AccountAlerts({ overview }: { overview: AccountOverview }) {
  const { totals, campaigns } = overview;
  const alerts: { type: "danger" | "warn" | "info"; msg: string; problem?: string; metrics?: Record<string, unknown> }[] = [];

  const activeCampaigns = campaigns.filter((c) => c.spend > 0);
  const cpas = activeCampaigns.filter((c) => c.purchases > 0).map((c) => c.cpa);
  const minCpa = cpas.length ? Math.min(...cpas) : 0;

  const drainers = activeCampaigns.filter((c) => c.spend >= 100 && (c.purchases === 0 || (minCpa > 0 && c.cpa > minCpa * 3)));
  drainers.forEach((c) => {
    alerts.push({
      type: "danger",
      msg: `"${c.name.slice(0, 45)}" يستهلك ${fmt(c.spend, 0)} EGP بدون نتائج كافية`,
      problem: "no-conversions",
      metrics: { name: c.name, spend: c.spend, purchases: c.purchases, cpa: c.purchases > 0 ? c.cpa : undefined },
    });
  });

  if (totals.ctr < 1.5)
    alerts.push({ type: "danger", msg: `CTR منخفض جداً (${fmtPct(totals.ctr)}) — الهدف ≥ 2% لخفض CPC`, problem: "ctr-low", metrics: { ctr: totals.ctr, cpc: totals.cpc, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases } });
  else if (totals.ctr < 2)
    alerts.push({ type: "warn", msg: `CTR منخفض (${fmtPct(totals.ctr)}) — الهدف ≥ 2% لتقليل تكلفة النقرة`, problem: "ctr-low", metrics: { ctr: totals.ctr, cpc: totals.cpc, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases } });
  if (totals.cpc > 5)
    alerts.push({ type: "danger", msg: `CPC مرتفع جداً (${fmt(totals.cpc, 2)} EGP) — الهدف ≤ 3 EGP`, problem: "cpc-high", metrics: { cpc: totals.cpc, ctr: totals.ctr, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases } });
  else if (totals.cpc > 3)
    alerts.push({ type: "warn", msg: `CPC مرتفع (${fmt(totals.cpc, 2)} EGP) — الهدف ≤ 3 EGP لتحسين الربحية`, problem: "cpc-high", metrics: { cpc: totals.cpc, ctr: totals.ctr, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases } });
  if (totals.cpm > 70 && totals.cpa > 55)
    alerts.push({ type: "danger", msg: `CPM مرتفع جداً (${fmt(totals.cpm, 0)} EGP) — منافسة عالية في المزاد`, problem: "cpc-high", metrics: { cpc: totals.cpc, ctr: totals.ctr, cpa: totals.cpa, spend: totals.spend } });
  if (totals.crLpv < 2 && totals.lpv > 0)
    alerts.push({ type: "warn", msg: `CR ضعيف (${fmtPct(totals.crLpv)}) — صفحة المنتج تحتاج مراجعة`, problem: "low-cr", metrics: { cr: totals.crLpv, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases } });

  const winners = activeCampaigns.filter((c) => minCpa > 0 && c.cpa <= minCpa * 1.15 && c.purchases > 0);
  if (winners.length > 0) {
    alerts.push({ type: "info", msg: `🏆 ${winners.length} حملة رابحة — ضاعف ميزانيتها الآن` });
  }

  // CPA increase compared to prev
  if (overview.prev_totals.cpa > 0 && totals.cpa > overview.prev_totals.cpa * 1.2) {
    alerts.push({
      type: "warn",
      msg: `CPA زاد ${fmt(((totals.cpa - overview.prev_totals.cpa) / overview.prev_totals.cpa) * 100, 0)}% مقارنة بالفترة السابقة`,
      problem: "cpa-high",
      metrics: { cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases, ctr: totals.ctr, cpc: totals.cpc },
    });
  }

  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className={`flex items-start gap-2.5 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 ring-inset ${
          a.type === "danger" ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/30" :
          a.type === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30" :
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30"
        }`}>
          {a.type === "danger" ? <XCircle className="h-4 w-4 shrink-0 mt-0.5" /> :
           a.type === "warn" ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> :
           <Bell className="h-4 w-4 shrink-0 mt-0.5" />}
          <span className="flex-1">{a.msg}</span>
          {a.problem && <HowToBtn problem={a.problem} metrics={a.metrics} />}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Account Health Panel — always-visible diagnostic for all key metrics
// ──────────────────────────────────────────────────────────────
type HealthStatus = "good" | "warn" | "danger";

interface MetricHealth {
  key: string;
  label: string;
  value: string;
  bench: string;
  status: HealthStatus;
  statusLabel: string;
  problem?: string;
  metrics?: Record<string, unknown>;
  badCampaigns: { name: string; value: string }[];
}

function HealthDot({ status }: { status: HealthStatus }) {
  return (
    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${status === "good" ? "bg-emerald-500" : status === "warn" ? "bg-amber-500" : "bg-rose-500"}`} />
  );
}

function AccountHealthPanel({ totals, campaigns }: { totals: DerivedMetrics; campaigns: CampaignSummaryFull[] }) {
  const active = campaigns.filter((c) => c.spend > 0);
  const cr = totals.lpv > 0 ? totals.crLpv : totals.crClick;

  const ctrStatus = (v: number): HealthStatus => v >= 2 ? "good" : v >= 1.5 ? "warn" : "danger";
  const cpcStatus = (v: number): HealthStatus => v <= 3 ? "good" : v <= 5 ? "warn" : "danger";
  const cpmStatus = (v: number): HealthStatus => v <= 50 ? "good" : v <= 70 ? "warn" : "danger";
  const freqStatus = (v: number): HealthStatus => v <= 1.5 ? "good" : v <= 2.0 ? "warn" : "danger";
  const cpaStatus = (v: number): HealthStatus => v === 0 ? "danger" : v <= 40 ? "good" : v <= 100 ? "warn" : "danger";
  const crStatus  = (v: number): HealthStatus => v >= 3 ? "good" : v >= 1.5 ? "warn" : "danger";

  const freqCampaigns = active
    .filter((c) => (c.frequency ?? 0) > 1.5)
    .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
    .slice(0, 4)
    .map((c) => ({ name: c.name, value: `${fmt(c.frequency ?? 0, 2)}x` }));

  const rows: MetricHealth[] = [
    {
      key: "ctr",
      label: "CTR — نسبة النقر",
      value: fmtPct(totals.ctr),
      bench: "الهدف ≥ 2%",
      status: ctrStatus(totals.ctr),
      statusLabel: totals.ctr >= 2 ? "جيد ✓" : totals.ctr >= 1.5 ? "منخفض — مراقبة" : "خطر — منخفض جداً",
      problem: totals.ctr < 2 ? "ctr-low" : undefined,
      metrics: { ctr: totals.ctr, cpc: totals.cpc, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases },
      badCampaigns: active
        .filter((c) => c.ctr > 0 && c.ctr < 2)
        .sort((a, b) => a.ctr - b.ctr)
        .slice(0, 4)
        .map((c) => ({ name: c.name, value: fmtPct(c.ctr) })),
    },
    {
      key: "cpc",
      label: "CPC — تكلفة النقرة",
      value: `${fmt(totals.cpc, 2)} EGP`,
      bench: "الهدف ≤ 3 EGP",
      status: cpcStatus(totals.cpc),
      statusLabel: totals.cpc <= 3 ? "جيد ✓" : totals.cpc <= 5 ? "مرتفع — مراقبة" : "خطر — مرتفع جداً",
      problem: totals.cpc > 3 ? "cpc-high" : undefined,
      metrics: { cpc: totals.cpc, ctr: totals.ctr, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases },
      badCampaigns: active
        .filter((c) => c.cpc > 3)
        .sort((a, b) => b.cpc - a.cpc)
        .slice(0, 4)
        .map((c) => ({ name: c.name, value: `${fmt(c.cpc, 2)} EGP` })),
    },
    {
      key: "cpa",
      label: "CPA — تكلفة الأوردر",
      value: totals.cpa > 0 ? `${fmt(totals.cpa, 0)} EGP` : "—",
      bench: "الهدف ≤ 40 EGP",
      status: cpaStatus(totals.cpa),
      statusLabel: totals.cpa === 0 ? "لا أوردرات" : totals.cpa <= 40 ? "جيد ✓" : totals.cpa <= 100 ? "مرتفع — مراقبة" : "خطر — مرتفع جداً",
      problem: totals.cpa === 0 || totals.cpa > 40 ? "cpa-high" : undefined,
      metrics: { cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases, ctr: totals.ctr, cpc: totals.cpc },
      badCampaigns: active
        .filter((c) => c.spend > 50 && (c.purchases === 0 || c.cpa > 40))
        .sort((a, b) => (b.cpa || 9999) - (a.cpa || 9999))
        .slice(0, 4)
        .map((c) => ({ name: c.name, value: c.purchases === 0 ? "لا أوردرات" : `${fmt(c.cpa, 0)} EGP` })),
    },
    {
      key: "cr",
      label: "CR — معدل التحويل",
      value: cr > 0 ? fmtPct(cr) : "—",
      bench: "الهدف ≥ 3%",
      status: crStatus(cr),
      statusLabel: cr >= 3 ? "جيد ✓" : cr >= 1.5 ? "ضعيف — مراقبة" : "خطر — منخفض جداً",
      problem: cr < 3 ? "low-cr" : undefined,
      metrics: { cr, cpa: totals.cpa, spend: totals.spend, purchases: totals.purchases },
      badCampaigns: active
        .filter((c) => c.cr > 0 && c.cr < 3)
        .sort((a, b) => a.cr - b.cr)
        .slice(0, 4)
        .map((c) => ({ name: c.name, value: fmtPct(c.cr) })),
    },
    {
      key: "cpm",
      label: "CPM — تكلفة الألف ظهور",
      value: `${fmt(totals.cpm, 0)} EGP`,
      bench: "الهدف ≤ 70 EGP",
      status: totals.cpa <= 55 ? "good" : cpmStatus(totals.cpm),
      statusLabel: totals.cpa <= 55 && totals.cpm > 50 ? "مقبول — CPA ممتاز" : totals.cpm <= 50 ? "جيد ✓" : totals.cpm <= 70 ? "مرتفع — مراقبة" : "خطر — منافسة عالية",
      problem: (totals.cpm > 70 && totals.cpa > 55) ? "cpc-high" : undefined,
      metrics: { cpc: totals.cpc, ctr: totals.ctr, cpa: totals.cpa, spend: totals.spend },
      badCampaigns: active
        .filter((c) => c.cpm > 70 && (c.cpa ?? 0) > 55)
        .sort((a, b) => b.cpm - a.cpm)
        .slice(0, 4)
        .map((c) => ({ name: c.name, value: `${fmt(c.cpm, 0)} EGP` })),
    },
    {
      key: "freq",
      label: "Frequency — تكرار الإعلان",
      value: active.filter((c) => (c.frequency ?? 0) > 0).length > 0
        ? `${fmt(Math.max(...active.map((c) => c.frequency ?? 0)), 2)}x`
        : "—",
      bench: "الهدف ≤ 1.5x",
      status: freqCampaigns.length === 0 ? "good" : freqStatus(Math.max(...active.map((c) => c.frequency ?? 0))),
      statusLabel: freqCampaigns.length === 0 ? "جيد ✓" : Math.max(...active.map((c) => c.frequency ?? 0)) <= 2.0 ? "حرج — جهّز كريتف بديل" : "خطر — غيّر الكريتف الآن",
      problem: freqCampaigns.length > 0 ? "high-frequency" : undefined,
      metrics: { freq: active.filter((c) => (c.frequency ?? 0) > 0).length > 0 ? Math.max(...active.map((c) => c.frequency ?? 0)) : 0 },
      badCampaigns: freqCampaigns,
    },
  ];

  const problemCount = rows.filter((r) => r.status !== "good").length;

  return (
    <Card className="border-primary/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          صحة الأداء — تشخيص شامل
          <span
            className={`mr-auto text-[11px] font-bold px-2.5 py-0.5 rounded-full ring-1 ${
              problemCount === 0
                ? "bg-emerald-500/10 ring-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                : problemCount <= 2
                  ? "bg-amber-500/10 ring-amber-500/30 text-amber-700 dark:text-amber-400"
                  : "bg-rose-500/10 ring-rose-500/30 text-rose-700 dark:text-rose-400"
            }`}
          >
            {problemCount === 0
              ? "✅ كل المؤشرات جيدة"
              : `⚠ ${problemCount} مؤشر${problemCount === 1 ? "" : "ات"} تحتاج مراجعة`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/50">
          {rows.map((r) => {
            const isGood = r.status === "good";
            const valueCls = isGood
              ? "text-emerald-600 dark:text-emerald-400"
              : r.status === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400";
            return (
              <div key={r.key} className={`px-5 py-3 ${!isGood && r.badCampaigns.length > 0 ? "" : ""}`}>
                <div className="flex items-center gap-3">
                  <HealthDot status={r.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground leading-tight">{r.label}</div>
                    <div className="text-[11px] text-muted-foreground">{r.bench}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`num text-sm font-bold ${valueCls}`}>{r.value}</div>
                    <div className={`text-[10px] font-medium ${valueCls} opacity-75`}>{r.statusLabel}</div>
                  </div>
                  {r.problem && !isGood ? (
                    <HowToBtn problem={r.problem} metrics={r.metrics} size="xs" />
                  ) : (
                    <div className="w-16 shrink-0" />
                  )}
                </div>
                {!isGood && r.badCampaigns.length > 0 && (
                  <div className="mt-2 mr-5 space-y-1">
                    {r.badCampaigns.map((c, i) => (
                      <div key={i} className={`flex items-center justify-between gap-2 text-[11px] rounded-lg px-3 py-1.5 ${r.status === "danger" ? "bg-rose-500/8 text-rose-700 dark:text-rose-400" : "bg-amber-500/8 text-amber-700 dark:text-amber-400"}`}>
                        <span dir="ltr" className="truncate font-medium flex-1 text-right" title={c.name}>{c.name}</span>
                        <span className="num font-bold shrink-0">{c.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Campaign Breakdown — who's hurting / helping the account
// ──────────────────────────────────────────────────────────────

interface CampaignBreakdownRow {
  id: string;
  name: string;
  spend: number;
  purchases: number;
  cpa: number;
  ctr: number;
  cpc: number;
  frequency: number;
  cpaDev: number;
  ctrDev: number;
  cpcDev: number;
  score: number;
}

function buildCampaignRows(
  campaigns: CampaignSummaryFull[],
  avgCpa: number,
  avgCtr: number,
  avgCpc: number
): CampaignBreakdownRow[] {
  return campaigns
    .filter((c) => c.spend > 0)
    .map((c) => {
      const cpaDev = avgCpa > 0 && c.cpa > 0 ? ((c.cpa - avgCpa) / avgCpa) * 100 : 0;
      const ctrDev = avgCtr > 0 && c.ctr > 0 ? ((c.ctr - avgCtr) / avgCtr) * 100 : 0;
      const cpcDev = avgCpc > 0 && c.cpc > 0 ? ((c.cpc - avgCpc) / avgCpc) * 100 : 0;
      const score = cpaDev * 0.5 - ctrDev * 0.3 + cpcDev * 0.2;
      return { id: c.id, name: c.name, spend: c.spend, purchases: c.purchases, cpa: c.cpa, ctr: c.ctr, cpc: c.cpc, frequency: c.frequency ?? 0, cpaDev, ctrDev, cpcDev, score };
    })
    .sort((a, b) => b.score - a.score);
}

function OvDevBadge({ value, lowerIsBetter }: { value: number; lowerIsBetter: boolean }) {
  if (Math.abs(value) < 5) return <span className="text-[10px] text-muted-foreground">~</span>;
  const isGood = lowerIsBetter ? value < 0 : value > 0;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${isGood ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/15 text-rose-700 dark:text-rose-400"}`}>
      {sign}{value.toFixed(0)}%
    </span>
  );
}

type SortKey = "score" | "frequency" | "cpa" | "ctr" | "cpc" | "purchases" | "spend";
type SortDir = "asc" | "desc";

function SortBtn({
  label,
  sortKey,
  active,
  dir,
  onClick,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  return (
    <button
      onClick={() => onClick(sortKey)}
      className={`flex items-center justify-center gap-0.5 hover:text-foreground transition-colors ${active ? "text-primary font-bold" : ""} ${className}`}
    >
      {label}
      {active ? (
        dir === "asc"
          ? <ChevronUp className="h-2.5 w-2.5" />
          : <ChevronDown className="h-2.5 w-2.5" />
      ) : (
        <span className="h-2.5 w-2.5 opacity-30">↕</span>
      )}
    </button>
  );
}

function CampaignBreakdown({
  campaigns,
  totals,
}: {
  campaigns: CampaignSummaryFull[];
  totals: DerivedMetrics;
}) {
  const baseRows = useMemo(
    () => buildCampaignRows(campaigns, totals.cpa, totals.ctr, totals.cpc),
    [campaigns, totals]
  );

  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // "lower is better" keys default asc so worst shows first, rest desc
      setSortDir(key === "cpa" || key === "cpc" || key === "frequency" ? "desc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const sorted = [...baseRows].sort((a, b) => {
      const av = a[sortKey as keyof CampaignBreakdownRow] as number;
      const bv = b[sortKey as keyof CampaignBreakdownRow] as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [baseRows, sortKey, sortDir]);

  if (rows.length === 0) return null;

  const worstCount = baseRows.filter((r) => r.score > 10).length;
  const bestCount  = baseRows.filter((r) => r.score < -10).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" />
            مقارنة الحملات — من يرفع ومن يخفض؟
          </CardTitle>
          <div className="flex items-center gap-1.5 mr-auto">
            {worstCount > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 border border-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">
                {worstCount} خاسر
              </span>
            )}
            {bestCount > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                {bestCount} رابح
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          مقارنة كل حملة بمتوسط الحساب — الانحراف بالـ% عن CPA و CTR و CPC
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {/* Mobile cards */}
        <div className="sm:hidden px-4 pb-4 space-y-2">
          {rows.map((r) => {
            const isWorst = r.score > 10;
            const isBest  = r.score < -10;
            const rowBg = isWorst ? "bg-rose-500/5 ring-1 ring-rose-500/10" : isBest ? "bg-emerald-500/5 ring-1 ring-emerald-500/10" : "bg-muted/20";
            return (
              <div key={r.id} className={`rounded-xl px-3 py-3 space-y-2 ${rowBg}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {isWorst && <TrendingDown className="h-3.5 w-3.5 text-rose-500 shrink-0" />}
                    {isBest  && <TrendingUp   className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                    <span dir="ltr" className="text-sm font-bold leading-snug line-clamp-2 text-right" title={r.name}>{r.name}</span>
                  </div>
                  <OvFreqBadge freq={r.frequency} />
                </div>
                <div className="text-[11px] text-muted-foreground num">{r.spend.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} EGP إنفاق</div>
                <div className="grid grid-cols-4 gap-1 pt-1 border-t border-border/50">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">CPA</span>
                    <span className="text-sm font-bold num">{r.cpa > 0 ? r.cpa.toLocaleString("ar-EG", { maximumFractionDigits: 0 }) : "—"}</span>
                    <OvDevBadge value={r.cpaDev} lowerIsBetter />
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">CTR</span>
                    <span className="text-sm font-bold num">{r.ctr.toFixed(2)}%</span>
                    <OvDevBadge value={r.ctrDev} lowerIsBetter={false} />
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">CPC</span>
                    <span className="text-sm font-bold num">{r.cpc > 0 ? r.cpc.toLocaleString("ar-EG", { maximumFractionDigits: 0 }) : "—"}</span>
                    <OvDevBadge value={r.cpcDev} lowerIsBetter />
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wide">أوردر</span>
                    <span className={`text-sm font-bold num ${r.purchases > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                      {r.purchases > 0 ? r.purchases : "—"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop Elite table */}
        <div className="hidden sm:block rounded-b-xl overflow-hidden elite-scroll">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm" dir="rtl">
              <thead className="sticky top-0 z-30 backdrop-blur-md bg-white/90 dark:bg-card/90 border-b border-slate-200 dark:border-border">
                <tr>
                  <th className="text-right px-5 py-4 text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold">
                    <button onClick={() => handleSort("score")} className={`flex items-center gap-1 hover:text-foreground transition-colors ${sortKey === "score" ? "text-primary" : ""}`}>
                      الحملة
                      {sortKey === "score" ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <span className="opacity-30 text-[10px]">↕</span>}
                    </button>
                  </th>
                  <th className="text-center px-4 py-4 text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold w-16">
                    <SortBtn label="FREQ" sortKey="frequency" active={sortKey === "frequency"} dir={sortDir} onClick={handleSort} />
                  </th>
                  <th className="text-left px-4 py-4 text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold w-28">
                    <SortBtn label="CPA" sortKey="cpa" active={sortKey === "cpa"} dir={sortDir} onClick={handleSort} />
                  </th>
                  <th className="text-left px-4 py-4 text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold w-24">
                    <SortBtn label="CTR" sortKey="ctr" active={sortKey === "ctr"} dir={sortDir} onClick={handleSort} />
                  </th>
                  <th className="text-left px-4 py-4 text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold w-28">
                    <SortBtn label="CPC" sortKey="cpc" active={sortKey === "cpc"} dir={sortDir} onClick={handleSort} />
                  </th>
                  <th className="text-left px-4 py-4 text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold w-20">
                    <SortBtn label="أوردر" sortKey="purchases" active={sortKey === "purchases"} dir={sortDir} onClick={handleSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const isWorst = r.score > 10;
                  const isBest  = r.score < -10;
                  return (
                    <tr
                      key={r.id}
                      className={`border-t border-slate-100 dark:border-border/50 transition-all duration-200 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 ${
                        isWorst ? "bg-rose-500/5" : isBest ? "bg-emerald-500/5" : idx % 2 === 1 ? "bg-slate-50/40 dark:bg-slate-800/10" : ""
                      }`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-end gap-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {isWorst && <TrendingDown className="h-3 w-3 text-rose-500 shrink-0" />}
                            {isBest  && <TrendingUp   className="h-3 w-3 text-emerald-500 shrink-0" />}
                            <span dir="ltr" className="font-bold text-slate-900 dark:text-slate-100 truncate max-w-[260px] text-sm text-right" title={r.name}>{r.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span dir="ltr" className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{r.id}</span>
                            <span className="text-[10px] text-muted-foreground num">{r.spend.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} EGP</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center w-16">
                        <OvFreqBadge freq={r.frequency} />
                      </td>
                      <td className="px-4 py-4 text-left w-28">
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-sm font-bold tabular-nums">{r.cpa > 0 ? r.cpa.toLocaleString("ar-EG", { maximumFractionDigits: 0 }) : "—"}</span>
                          <OvDevBadge value={r.cpaDev} lowerIsBetter />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-left w-24">
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-sm font-bold tabular-nums">{r.ctr.toFixed(2)}%</span>
                          <OvDevBadge value={r.ctrDev} lowerIsBetter={false} />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-left w-28">
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-sm font-bold tabular-nums">{r.cpc > 0 ? r.cpc.toLocaleString("ar-EG", { maximumFractionDigits: 0 }) : "—"}</span>
                          <OvDevBadge value={r.cpcDev} lowerIsBetter />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-left w-20">
                        <span className={`text-sm font-bold tabular-nums ${r.purchases > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                          {r.purchases > 0 ? r.purchases : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// Priority Engine
// ──────────────────────────────────────────────────────────────
function AccountPriorityEngine({ overview }: { overview: AccountOverview }) {
  const { campaigns } = overview;
  const activeCampaigns = campaigns.filter((c) => c.spend > 0);
  const cpas = activeCampaigns.filter((c) => c.purchases > 0).map((c) => c.cpa);
  const minCpa = cpas.length ? Math.min(...cpas) : 0;

  const actions: { icon: React.ComponentType<{ className?: string }>; label: string; sub: string; tone: "kill" | "scale" | "fix" }[] = [];

  const worstCampaign = [...activeCampaigns].sort((a, b) => {
    if (a.purchases === 0 && b.purchases > 0) return -1;
    if (b.purchases === 0 && a.purchases > 0) return 1;
    return b.cpa - a.cpa;
  })[0];

  if (worstCampaign && (worstCampaign.purchases === 0 || (minCpa > 0 && worstCampaign.cpa > minCpa * 2.5))) {
    actions.push({
      icon: PauseCircle,
      label: `أوقف: ${worstCampaign.name.slice(0, 50)}`,
      sub: `${fmt(worstCampaign.spend, 0)} EGP · ${worstCampaign.purchases} طلب`,
      tone: "kill",
    });
  }

  const bestCampaign = activeCampaigns.find((c) => minCpa > 0 && c.cpa <= minCpa * 1.15 && c.purchases > 0);
  if (bestCampaign) {
    actions.push({
      icon: Rocket,
      label: `ضاعف ميزانية: ${bestCampaign.name.slice(0, 50)}`,
      sub: `CPA ${fmt(bestCampaign.cpa, 0)} EGP · ${bestCampaign.purchases} طلب`,
      tone: "scale",
    });
  }

  if (overview.totals.crLpv < 5 && overview.totals.lpv > 0) {
    actions.push({
      icon: Zap,
      label: "حسّن صفحة المنتج — CR ضعيف",
      sub: `CR ${fmtPct(overview.totals.crLpv)} — الهدف 5%+`,
      tone: "fix",
    });
  } else if (overview.totals.ctr < 1.5) {
    actions.push({
      icon: Zap,
      label: "اختبر Creative جديد لرفع الـ CTR",
      sub: `CTR ${fmtPct(overview.totals.ctr)} — الهدف 2%+`,
      tone: "fix",
    });
  }

  const toneConfig = {
    kill: { bg: "bg-rose-500/10 ring-rose-500/30 text-rose-700 dark:text-rose-400", iconBg: "bg-rose-500/15", tag: "أوقف" },
    scale: { bg: "bg-emerald-500/10 ring-emerald-500/30 text-emerald-700 dark:text-emerald-400", iconBg: "bg-emerald-500/15", tag: "ضاعف" },
    fix: { bg: "bg-amber-500/10 ring-amber-500/30 text-amber-700 dark:text-amber-400", iconBg: "bg-amber-500/15", tag: "صلّح" },
  };

  if (actions.length === 0) return (
    <div className="text-sm text-muted-foreground italic text-center py-4">الحساب في وضع جيد — لا توجد إجراءات عاجلة</div>
  );

  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {actions.slice(0, 3).map((a, i) => {
        const cfg = toneConfig[a.tone];
        const Icon = a.icon;
        return (
          <div key={i} className={`rounded-xl p-3.5 ring-1 ring-inset space-y-2 ${cfg.bg}`}>
            <div className="flex items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${cfg.iconBg}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wide">#{i + 1} — {cfg.tag}</span>
            </div>
            <div>
              <div className="text-sm font-semibold leading-snug">{a.label}</div>
              <div className="mt-0.5 text-xs opacity-80">{a.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Top & Worst Campaigns
// ──────────────────────────────────────────────────────────────
function CampaignTable({ campaigns }: { campaigns: CampaignSummaryFull[] }) {
  const activeCampaigns = campaigns.filter((c) => c.spend > 0);
  const cpas = activeCampaigns.filter((c) => c.purchases > 0).map((c) => c.cpa);
  const minCpa = cpas.length ? Math.min(...cpas) : 0;

  const winners = [...activeCampaigns]
    .filter((c) => minCpa > 0 && c.cpa <= minCpa * 1.3 && c.purchases > 0)
    .sort((a, b) => a.cpa - b.cpa)
    .slice(0, 3);

  const losers = [...activeCampaigns]
    .filter((c) => c.spend >= 50 && (c.purchases === 0 || (minCpa > 0 && c.cpa > minCpa * 2.5)))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3);

  const wastedSpend = losers.reduce((s, c) => s + c.spend, 0);
  const winnerOrders = winners.reduce((s, c) => s + c.purchases, 0);

  return (
    <div className="space-y-4">
      {/* Profit Insight */}
      {(wastedSpend > 0 || winnerOrders > 0) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {wastedSpend > 0 && (
            <div className="rounded-xl bg-rose-500/8 ring-1 ring-rose-500/20 p-3.5">
              <div className="text-xs font-bold text-rose-700 dark:text-rose-400 mb-1">💸 يتم إهداره</div>
              <div className="text-2xl font-bold"><Num>{fmt(wastedSpend, 0)} EGP</Num></div>
              <div className="text-xs text-muted-foreground mt-0.5">إنفاق على حملات خاسرة — يمكن توجيهه للرابحة</div>
            </div>
          )}
          {winnerOrders > 0 && (
            <div className="rounded-xl bg-emerald-500/8 ring-1 ring-emerald-500/20 p-3.5">
              <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-1">📈 أداء رابحين</div>
              <div className="text-2xl font-bold"><Num>{winnerOrders}</Num> طلب</div>
              <div className="text-xs text-muted-foreground mt-0.5">من الحملات الرابحة — زيادة ميزانيتها تزيد النتائج</div>
            </div>
          )}
        </div>
      )}

      {/* Winners */}
      {winners.length > 0 && (
        <div>
          <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4" /> أفضل الحملات — الرابحون
          </div>
          <div className="rounded-2xl border border-emerald-100 dark:border-emerald-500/20 overflow-hidden bg-white dark:bg-card shadow-sm">
            {winners.map((c, idx) => (
              <div key={c.id} className={`flex items-center gap-3 px-4 py-3.5 ${idx > 0 ? "border-t border-emerald-50 dark:border-emerald-500/10" : ""} hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5 transition-colors`}>
                <div className="flex-1 min-w-0">
                  <div dir="ltr" className="text-sm font-bold truncate text-right text-slate-900 dark:text-slate-100" title={c.name}>{c.name}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                    <span className="text-[11px] text-muted-foreground">CPA <span className="font-bold text-emerald-600 dark:text-emerald-400 num">{fmt(c.cpa, 0)} EGP</span></span>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground"><span className="font-bold text-slate-700 dark:text-slate-300 num">{c.purchases}</span> طلب</span>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground num">{fmt(c.spend, 0)} EGP</span>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground">CTR <span className="font-bold num">{fmtPct(c.ctr)}</span></span>
                  </div>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-2.5 py-1 rounded-full">
                  <Sparkles className="h-3 w-3" /> رابح
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Losers */}
      {losers.length > 0 && (
        <div>
          <div className="text-sm font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2 mb-2">
            <XCircle className="h-4 w-4" /> أسوأ الحملات — الخاسرون
          </div>
          <div className="rounded-2xl border border-rose-100 dark:border-rose-500/20 overflow-hidden bg-white dark:bg-card shadow-sm">
            {losers.map((c, idx) => (
              <div key={c.id} className={`flex items-center gap-3 px-4 py-3.5 ${idx > 0 ? "border-t border-rose-50 dark:border-rose-500/10" : ""} hover:bg-rose-50/50 dark:hover:bg-rose-500/5 transition-colors`}>
                <div className="flex-1 min-w-0">
                  <div dir="ltr" className="text-sm font-bold truncate text-right text-slate-900 dark:text-slate-100" title={c.name}>{c.name}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                    <span className="text-[11px] text-muted-foreground">إنفاق <span className="font-bold text-rose-600 dark:text-rose-400 num">{fmt(c.spend, 0)} EGP</span></span>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground"><span className="font-bold text-slate-700 dark:text-slate-300 num">{c.purchases}</span> طلب</span>
                    {c.purchases > 0 && <>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <span className="text-[11px] text-muted-foreground">CPA <span className="font-bold text-rose-600 dark:text-rose-400 num">{fmt(c.cpa, 0)} EGP</span></span>
                    </>}
                  </div>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 px-2.5 py-1 rounded-full">
                  <XCircle className="h-3 w-3" /> أوقف
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {winners.length === 0 && losers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-2xl border border-slate-200 dark:border-border bg-slate-50/50 dark:bg-muted/10">
          <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-muted/30 flex items-center justify-center">
            <Target className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-sm text-muted-foreground">لا توجد بيانات كافية لتحليل الحملات</p>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Delivery Warnings Panel (with fix suggestions)
// ──────────────────────────────────────────────────────────────

interface FixSuggestion {
  title: string;
  steps: string[];
  urgency: "critical" | "high" | "medium";
}

function getFixSuggestion(issue: AdIssue): FixSuggestion {
  const code = issue.error_code ?? 0;
  const summary = (issue.summary ?? "").toLowerCase();
  const msg = (issue.error_message ?? "").toLowerCase();
  const combined = summary + " " + msg;

  // ── DISAPPROVAL / POLICY VIOLATION (codes 1000–1999) ──
  if (code >= 1000 && code < 2000) {
    if (combined.includes("image") || combined.includes("صورة")) {
      return {
        title: "صورة الإعلان مخالفة لسياسات Meta",
        steps: [
          "اذهب لـ Ads Manager وافتح إعدادات الإعلان",
          "استبدل الصورة بأخرى تتوافق مع سياسات Meta (لا نص يزيد عن 20%، لا محتوى مضلل)",
          "تجنب الصور التي تُظهر قبل/بعد أو تعد بنتائج مضمونة",
          "أعد تشغيل الإعلان بعد تعديل الصورة",
        ],
        urgency: "critical",
      };
    }
    if (combined.includes("video") || combined.includes("فيديو")) {
      return {
        title: "فيديو الإعلان مخالف لسياسات Meta",
        steps: [
          "راجع محتوى الفيديو وتأكد أنه لا يحتوي على ادعاءات صحية أو مالية مبالغ فيها",
          "تأكد أن الفيديو لا يحتوي على موسيقى محمية بحقوق ملكية",
          "أعد رفع الفيديو بعد التعديل أو استخدم فيديو بديل",
          "راجع Meta Advertising Policies لقائمة المحتوى المحظور",
        ],
        urgency: "critical",
      };
    }
    if (combined.includes("text") || combined.includes("نص") || combined.includes("copy")) {
      return {
        title: "نص الإعلان مخالف لسياسات Meta",
        steps: [
          "احذف أي ادعاءات غير مدعومة بدليل (\"أسرع\"، \"الأفضل\", \"مضمون\")",
          "تجنب المقارنات المضللة مع منافسين",
          "لا تستخدم لغة تخلق إحساساً زائفاً بالإلحاح",
          "راجع وأعد صياغة النص الإعلاني ثم أعد تشغيل الإعلان",
        ],
        urgency: "critical",
      };
    }
    if (combined.includes("landing page") || combined.includes("الصفحة") || combined.includes("url")) {
      return {
        title: "الـ Landing Page مخالف لسياسات Meta",
        steps: [
          "تأكد أن الصفحة المقصودة تعمل بشكل صحيح ولا تُعيد التوجيه",
          "تأكد أن محتوى الصفحة يتطابق مع محتوى الإعلان",
          "أضف صفحة Privacy Policy واضحة على الموقع",
          "احذف أي Pop-ups مزعجة تظهر فور دخول الصفحة",
          "تأكد أن الصفحة تعمل على الموبايل",
        ],
        urgency: "critical",
      };
    }
    if (combined.includes("targeting") || combined.includes("استهداف")) {
      return {
        title: "مشكلة في إعدادات الاستهداف",
        steps: [
          "افتح إعدادات Ad Set وراجع خيارات الاستهداف",
          "تأكد أن الفئة العمرية والموقع الجغرافي لا يخالفان سياسات الإعلانات",
          "إذا كانت المنتجات حساسة (مالية، صحة، سياسة)، راجع متطلبات الاستهداف الخاصة",
        ],
        urgency: "critical",
      };
    }
    return {
      title: "الإعلان مرفوض بسبب مخالفة السياسات",
      steps: [
        `كود الخطأ: ${code} — راجع Meta Advertising Policies لمعرفة السبب بالتفصيل`,
        "افتح Ads Manager وانقر على \"اعرف السبب\" بجانب الإعلان المرفوض",
        "راجع محتوى الإعلان (نص، صورة، فيديو، وجهة الرابط) وعدّل ما يخالف السياسات",
        "إذا اعتقدت أن القرار خاطئ، اضغط على \"طعن في القرار\" من Ads Manager",
      ],
      urgency: "critical",
    };
  }

  // ── AUDIENCE / DELIVERY ISSUES ──
  if (combined.includes("audience") || combined.includes("أوديانس") || combined.includes("reach") || combined.includes("وصول")) {
    return {
      title: "الأوديانس ضيق جداً — تعذّر التسليم",
      steps: [
        "افتح Ad Set ووسّع الاستهداف (رفع الحد العمري، إضافة مناطق جغرافية أكثر)",
        "فعّل خاصية Advantage+ Audience لتترك لـ Meta حرية العثور على المهتمين",
        "أضف Interests بديلة أو وسّع Lookalike من 1% إلى 3–5%",
        "احذف القيود الزائدة (behavioral exclusions) إذا وُجدت",
        "الهدف: أوديانس لا يقل عن 500,000 شخص",
      ],
      urgency: "high",
    };
  }

  if (combined.includes("pixel") || combined.includes("بيكسل") || combined.includes("event") || combined.includes("conversion api")) {
    return {
      title: "البيكسل لا يستقبل بيانات كافية",
      steps: [
        "افتح Events Manager وتأكد أن البيكسل نشط ويستقبل أحداثاً",
        "فعّل Conversions API (CAPI) بجانب البيكسل لتجنب مشاكل iOS",
        "اختبر الأحداث باستخدام Test Events في Events Manager",
        "تأكد أن حدث Purchase/Lead يُطلق بشكل صحيح على صفحة الشكر",
        "إذا كانت البيانات شحيحة، غيّر optimization event لحدث أعلى في الفانل (AddToCart أو ViewContent)",
      ],
      urgency: "high",
    };
  }

  if (combined.includes("learning") || combined.includes("تعلم") || combined.includes("learning limited")) {
    return {
      title: "الإعلان في وضع 'Learning Limited'",
      steps: [
        "زِد الميزانية اليومية — القاعدة: الميزانية = CPA المستهدف × 5 على الأقل",
        "ادمج Ad Sets المتشابهة في ad set واحد لتجميع التحويلات",
        "إذا كان الحدث المحسَّن نادر (Purchase)، حوّل لـ AddToCart مؤقتاً حتى تتجمع بيانات كافية",
        "قلّل التعديلات اليدوية على الإعلانات — كل تعديل يُعيد التعلم من الصفر",
        "أعط الإعلان 7 أيام على الأقل قبل الحكم عليه",
      ],
      urgency: "high",
    };
  }

  if (combined.includes("budget") || combined.includes("ميزانية") || combined.includes("minimum")) {
    return {
      title: "الميزانية أقل من الحد الأدنى للتسليم",
      steps: [
        "ارفع الميزانية اليومية فوق الحد الأدنى المطلوب (عادةً 5–10 دولار/يوم)",
        "تحقق من أن ميزانية الحملة (Campaign Budget) لم تنته",
        "إذا كانت ميزانية الحساب محدودة، ارفع Account Spending Limit في إعدادات الدفع",
      ],
      urgency: "high",
    };
  }

  if (combined.includes("payment") || combined.includes("billing") || combined.includes("دفع") || combined.includes("فاتورة")) {
    return {
      title: "مشكلة في طريقة الدفع",
      steps: [
        "افتح إعدادات Billing في Business Manager",
        "تأكد من صحة بيانات البطاقة وأن لها رصيد كافٍ",
        "أضف طريقة دفع احتياطية إذا لم تكن موجودة",
        "إذا كان الحساب مُوقَفاً بسبب الدفع، ادفع الرصيد المستحق أولاً",
      ],
      urgency: "critical",
    };
  }

  if (combined.includes("account") || combined.includes("حساب") || combined.includes("disabled") || combined.includes("suspended")) {
    return {
      title: "مشكلة على مستوى حساب الإعلانات",
      steps: [
        "تحقق من حالة حساب الإعلانات في Account Quality (facebook.com/accountquality)",
        "إذا كان الحساب موقوفاً، قدّم طعناً عبر زر \"طلب مراجعة\"",
        "تأكد أن Business Manager مرتبط بصفحة نشطة وموثّقة",
        "تواصل مع دعم Meta إذا لم تُفلح الخطوات السابقة",
      ],
      urgency: "critical",
    };
  }

  if (combined.includes("pending") || combined.includes("review") || combined.includes("مراجعة")) {
    return {
      title: "الإعلان قيد المراجعة من Meta",
      steps: [
        "المراجعة عادةً تستغرق من 30 دقيقة إلى 24 ساعة",
        "لا تجري أي تعديلات على الإعلان أثناء المراجعة — هذا يُعيد العملية من الأول",
        "إذا تأخرت المراجعة أكثر من 24 ساعة، تواصل مع دعم Meta",
      ],
      urgency: "medium",
    };
  }

  if (combined.includes("paused") || combined.includes("متوقف")) {
    return {
      title: "الإعلان متوقف",
      steps: [
        "تحقق إذا كانت الحملة أو الـ Ad Set هي المتوقفة وليس الإعلان فقط",
        "تأكد من تواريخ تشغيل الحملة — ربما انتهت مدتها",
        "إذا كان التوقف مقصوداً، لا حاجة لأي إجراء",
      ],
      urgency: "medium",
    };
  }

  // Default
  return {
    title: issue.summary || "مشكلة في تسليم الإعلان",
    steps: [
      "افتح Ads Manager واطلع على تفاصيل المشكلة بجانب الإعلان",
      "راجع معلومات الإعلان (creative, targeting, budget) وابحث عن سبب المشكلة",
      "إذا كانت المشكلة غير واضحة، تواصل مع دعم Meta مع ذكر كود الخطأ",
    ],
    urgency: "medium",
  };
}

const STATUS_AR: Record<string, { label: string; color: string }> = {
  WITH_ISSUES:      { label: "بها مشاكل",        color: "text-rose-600 dark:text-rose-400" },
  DISAPPROVED:      { label: "مرفوض",             color: "text-rose-700 dark:text-rose-500" },
  PENDING_REVIEW:   { label: "قيد المراجعة",      color: "text-amber-600 dark:text-amber-400" },
  IN_PROCESS:       { label: "قيد المعالجة",      color: "text-amber-500 dark:text-amber-300" },
  PAUSED:           { label: "متوقف",             color: "text-slate-500" },
  CAMPAIGN_PAUSED:  { label: "الحملة متوقفة",     color: "text-slate-500" },
  ADSET_PAUSED:     { label: "المجموعة متوقفة",   color: "text-slate-500" },
};

function urgencyBadge(u: FixSuggestion["urgency"]) {
  if (u === "critical") return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400">عاجل</span>;
  if (u === "high")     return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">مهم</span>;
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-400">تنبيه</span>;
}

function AdIssueCard({ ad, accountId, since, until }: { ad: AdWithIssues; accountId?: string; since?: string; until?: string }) {
  const [open, setOpen] = useState(false);
  const statusCfg = STATUS_AR[ad.effective_status ?? ""] ?? { label: ad.effective_status ?? "غير معروف", color: "text-slate-500" };
  const isCritical = ad.effective_status === "DISAPPROVED" || ad.effective_status === "WITH_ISSUES";
  const borderCls = isCritical
    ? "border-rose-500/30 bg-rose-500/5"
    : "border-amber-500/25 bg-amber-500/5";

  const fixes = ad.issues.length > 0
    ? ad.issues.map((iss) => ({ issue: iss, fix: getFixSuggestion(iss) }))
    : [{ issue: { summary: ad.effective_status, error_message: "", error_code: 0, level: "" } as AdIssue, fix: getFixSuggestion({ summary: ad.effective_status, error_message: ad.effective_status, error_code: 0, level: "" } as AdIssue) }];

  return (
    <div className={`rounded-xl border ${borderCls} overflow-hidden`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-white/5 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ring-1 ring-current/20 ${statusCfg.color}`}>
          {statusCfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <div dir="ltr" className="text-sm font-semibold truncate text-right" title={ad.name}>{ad.name}</div>
          {ad.campaign_name && (
            <div className="text-xs text-muted-foreground truncate">
              حملة:&nbsp;
              <CampaignLink
                campaignId={ad.campaign_id}
                campaignName={ad.campaign_name}
                accountId={accountId}
                since={since}
                until={until}
                className="text-xs"
              />
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{ad.issues.length > 0 ? `${ad.issues.length} مشكلة` : "تحذير"}</span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/50 px-4 py-3 space-y-4">
          {fixes.map(({ issue, fix }, i) => (
            <div key={i} className="space-y-2">
              {/* Issue header */}
              <div className="flex items-start gap-2">
                {urgencyBadge(fix.urgency)}
                <span className="text-sm font-bold">{fix.title}</span>
                {(issue.error_code ?? 0) > 0 && (
                  <span className="text-[10px] text-muted-foreground font-mono ml-auto shrink-0">
                    #{issue.error_code}
                  </span>
                )}
              </div>

              {/* Original Meta message */}
              {issue.error_message && (
                <div className="flex items-start gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{issue.error_message}</span>
                </div>
              )}

              {/* Fix steps */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <Wrench className="h-3.5 w-3.5" />
                  خطوات الإصلاح
                </div>
                <ol className="space-y-1 pr-4">
                  {fix.steps.map((step, si) => (
                    <li key={si} className="text-xs text-muted-foreground list-decimal">
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryWarningsPanel({ adIssues, accountId, since, until }: { adIssues: AdWithIssues[]; accountId?: string; since?: string; until?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!adIssues || adIssues.length === 0) return null;

  const criticalCount = adIssues.filter(
    (a) => a.effective_status === "DISAPPROVED" || a.effective_status === "WITH_ISSUES"
  ).length;
  const warnCount = adIssues.length - criticalCount;

  return (
    <div className="space-y-3">
      <button
        className="w-full flex items-center gap-2 text-right"
        onClick={() => setCollapsed((c) => !c)}
      >
        <AlertTriangle className={`h-4 w-4 shrink-0 ${criticalCount > 0 ? "text-rose-500" : "text-amber-500"}`} />
        <span className={`text-sm font-bold ${criticalCount > 0 ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}>
          تحذيرات التسليم
        </span>
        <div className="flex items-center gap-2 mr-1">
          {criticalCount > 0 && (
            <span className="text-[11px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-400 px-2 py-0.5 rounded-full">
              {criticalCount} حرج
            </span>
          )}
          {warnCount > 0 && (
            <span className="text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
              {warnCount} تنبيه
            </span>
          )}
        </div>
        <div className="mr-auto shrink-0 text-muted-foreground">
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </div>
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {adIssues
            .sort((a, b) => {
              const order = ["DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW", "IN_PROCESS", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"];
              return (order.indexOf(a.effective_status ?? "") - order.indexOf(b.effective_status ?? ""));
            })
            .map((ad) => (
              <AdIssueCard key={ad.id} ad={ad} accountId={accountId} since={since} until={until} />
            ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Trend chart
// ──────────────────────────────────────────────────────────────
function TrendChart({ daily }: { daily: AccountOverview["daily"] }) {
  if (daily.length === 0) return (
    <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground italic">
      لا توجد بيانات يومية
    </div>
  );
  const data = daily.map((d) => ({
    ...d,
    day: d.day.slice(5),
    cpa: d.purchases ? Math.round(d.spend / d.purchases) : null,
  }));
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spendGradOv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
              <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <RTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
          <Area yAxisId="left" type="monotone" dataKey="spend" name="Spend (EGP)" stroke={CHART_COLORS.primary} fill="url(#spendGradOv)" strokeWidth={2} />
          <Bar yAxisId="right" dataKey="purchases" name="Purchases" fill={CHART_COLORS.good} radius={[4, 4, 0, 0]} barSize={18} />
          <Line yAxisId="left" type="monotone" dataKey="cpa" name="CPA (EGP)" stroke={CHART_COLORS.bad} strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Single account tab content
// ──────────────────────────────────────────────────────────────
function AccountTabContent({
  accountId,
  accountName,
  since,
  until,
}: {
  accountId: string;
  accountName: string;
  since: string;
  until: string;
}) {
  const overview = useAccountOverview({ ad_account_id: accountId, since, until });

  // ── Auto-snapshot current alerts (must be before any early returns) ──
  useEffect(() => {
    if (!overview.data) return;
    const { totals, campaigns } = overview.data;
    const active = campaigns.filter((c) => c.spend > 0);
    const alerts: AlertSnapshotInput[] = [];

    if (totals.ctr < 2)
      alerts.push({ alertKey: "ctr-low:account", alertType: "ctr-low", severity: totals.ctr < 1.5 ? "danger" : "warn", metricValue: totals.ctr, metricLabel: `CTR ${totals.ctr.toFixed(2)}%` });
    if (totals.cpc > 3)
      alerts.push({ alertKey: "cpc-high:account", alertType: "cpc-high", severity: totals.cpc > 5 ? "danger" : "warn", metricValue: totals.cpc, metricLabel: `CPC ${totals.cpc.toFixed(2)} EGP` });
    if (totals.cpm > 50 && totals.cpa > 55)
      alerts.push({ alertKey: "cpM-high:account", alertType: "cpM-high", severity: totals.cpm > 70 ? "danger" : "warn", metricValue: totals.cpm, metricLabel: `CPM ${totals.cpm.toFixed(0)} EGP` });
    if (totals.cpa > 40)
      alerts.push({ alertKey: "cpa-high:account", alertType: "cpa-high", severity: totals.cpa > 100 ? "danger" : "warn", metricValue: totals.cpa, metricLabel: `CPA ${totals.cpa.toFixed(0)} EGP` });
    if (totals.cpa === 0 && totals.spend > 0)
      alerts.push({ alertKey: "no-conversions:account", alertType: "no-conversions", severity: "danger", metricValue: 0, metricLabel: "لا أوردرات" });

    for (const c of active.filter((c) => (c.frequency ?? 0) > 1.5).slice(0, 5))
      alerts.push({ alertKey: `high-frequency:campaign-${c.id}`, alertType: "high-frequency", severity: (c.frequency ?? 0) > 2.0 ? "danger" : "warn", metricValue: c.frequency ?? 0, metricLabel: `Freq ${(c.frequency ?? 0).toFixed(2)}x`, campaignId: c.id, campaignName: c.name });

    snapshotAlerts(accountId, alerts).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, overview.dataUpdatedAt]);

  if (overview.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (overview.error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>تعذّر تحميل بيانات الحساب</AlertTitle>
        <AlertDescription className="text-xs">{(overview.error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  if (!overview.data) return null;
  const { totals, prev_totals, campaigns, daily, ad_issues } = overview.data;
  const health = healthScore(overview.data);
  const activeCampaigns = campaigns.filter((c) => c.spend > 0);

  return (
    <div className="space-y-5">
      {/* Health + summary row — always visible */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HealthBadge status={health} />
        <div className="text-xs text-muted-foreground">
          <span className="num font-medium text-foreground">{activeCampaigns.length}</span> حملة نشطة ·{" "}
          <span className="num font-medium text-foreground">{campaigns.length}</span> إجمالي
        </div>
      </div>

      {/* Alerts */}
      <CollapsibleSection title="التنبيهات">
        <AccountAlerts overview={overview.data} />
      </CollapsibleSection>

      {/* Delivery Warnings Panel */}
      {ad_issues && ad_issues.length > 0 && (
        <CollapsibleSection title="تحذيرات التسليم">
          <Card className="border-rose-500/20 bg-rose-500/3">
            <CardContent className="pt-5 pb-4 px-5">
              <DeliveryWarningsPanel adIssues={ad_issues} accountId={accountId} since={since} until={until} />
            </CardContent>
          </Card>
        </CollapsibleSection>
      )}

      {/* KPI Cards */}
      <CollapsibleSection title="مؤشرات الأداء">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard
            icon={CircleDollarSign}
            label="إجمالي الإنفاق"
            value={`${fmt(totals.spend, 0)} EGP`}
            sub={<Num>CPM {fmt(totals.cpm, 0)} EGP</Num>}
            current={totals.spend}
            prev={prev_totals.spend}
            tone="neutral"
          />
          <KpiCard
            icon={ShoppingCart}
            label="الأوردرات"
            value={fmt(totals.purchases)}
            sub={totals.lpv > 0 ? <><Num>{fmt(totals.lpv)}</Num> زيارة</> : undefined}
            current={totals.purchases}
            prev={prev_totals.purchases}
            tone={totals.purchases > 0 ? "good" : "bad"}
          />
          <KpiCard
            icon={Target}
            label="CPA"
            value={totals.cpa > 0 ? `${fmt(totals.cpa, 0)} EGP` : "—"}
            current={totals.cpa}
            prev={prev_totals.cpa}
            lowerIsBetter
            tone={totals.cpa === 0 ? "bad" : totals.cpa < 80 ? "good" : totals.cpa < 150 ? "warn" : "bad"}
          />
          <KpiCard
            icon={MousePointerClick}
            label="CTR"
            value={fmtPct(totals.ctr)}
            sub={<Num>CPC {fmt(totals.cpc, 0)} EGP</Num>}
            current={totals.ctr}
            prev={prev_totals.ctr}
            tone={totals.ctr >= 2 ? "good" : totals.ctr >= 1 ? "warn" : "bad"}
          />
          <KpiCard
            icon={Eye}
            label="CPM"
            value={`${fmt(totals.cpm, 0)} EGP`}
            sub={<><Num>{fmt(totals.impressions)}</Num> ظهور</>}
            current={totals.cpm}
            prev={prev_totals.cpm}
            lowerIsBetter
            tone={totals.cpa <= 55 ? "good" : (totals.cpm < 30 ? "good" : totals.cpm < 60 ? "warn" : "bad")}
          />
          <KpiCard
            icon={TrendingUp}
            label="Conversion Rate"
            value={totals.lpv > 0 ? fmtPct(totals.crLpv) : fmtPct(totals.crClick)}
            sub={totals.lpv > 0 ? "LPV → أوردر" : "Click → أوردر"}
            current={totals.crLpv || totals.crClick}
            prev={prev_totals.crLpv || prev_totals.crClick}
            tone={totals.crLpv >= 5 ? "good" : totals.crLpv >= 2 ? "warn" : "bad"}
          />
        </div>
      </CollapsibleSection>

      {/* HEALTH PANEL */}
      <CollapsibleSection title="صحة الحساب">
        <AccountHealthPanel totals={totals} campaigns={campaigns} />
      </CollapsibleSection>

      {/* CPA ALERTS */}
      <CollapsibleSection title="تنبيهات CPA">
        <CpaAlertsPanel accountId={accountId} />
      </CollapsibleSection>

      {/* FREQUENCY DANGER ALERT */}
      <CollapsibleSection title="خطر التكرار (Frequency)">
        <FrequencyDangerPanel campaigns={campaigns} />
      </CollapsibleSection>

      {/* TREND ALERTS + DAILY INSIGHT */}
      <CollapsibleSection title="تنبيهات الاتجاه">
        <div className="space-y-4">
          <OvTrendAlertsPanel daily={daily} totals={totals} campaigns={campaigns} />
          <OvDailyInsightCard daily={daily} totals={totals} campaigns={campaigns} />
        </div>
      </CollapsibleSection>

      {/* CAMPAIGN BREAKDOWN */}
      <CollapsibleSection title="تفصيل الحملات">
        <CampaignBreakdown campaigns={campaigns} totals={totals} />
      </CollapsibleSection>

      {/* Priority Engine */}
      <CollapsibleSection title="أهم القرارات">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Target className="h-4 w-4 text-primary" />
              أهم القرارات لهذا الحساب
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AccountPriorityEngine overview={overview.data} />
          </CardContent>
        </Card>
      </CollapsibleSection>

      {/* Trend */}
      <CollapsibleSection title="الأداء اليومي">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              الأداء اليومي
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart daily={daily} />
          </CardContent>
        </Card>
      </CollapsibleSection>

      {/* Top & Worst Campaigns */}
      <CollapsibleSection title="أفضل وأسوأ الحملات">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" />
              أفضل وأسوأ الحملات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignTable campaigns={campaigns} />
          </CardContent>
        </Card>
      </CollapsibleSection>

      {/* Quick Actions */}
      <CollapsibleSection title="إجراءات سريعة" defaultOpen={false}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-primary" />
              إجراءات سريعة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-emerald-500/8 ring-1 ring-emerald-500/20 p-4 text-center space-y-2">
                <Rocket className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mx-auto" />
                <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Scale Winners</div>
                <div className="text-xs text-muted-foreground">ضاعف ميزانية الرابحين</div>
              </div>
              <div className="rounded-xl bg-rose-500/8 ring-1 ring-rose-500/20 p-4 text-center space-y-2">
                <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 mx-auto" />
                <div className="text-sm font-bold text-rose-700 dark:text-rose-400">Kill Losers</div>
                <div className="text-xs text-muted-foreground">أوقف الحملات الخاسرة</div>
              </div>
              <div className="rounded-xl bg-amber-500/8 ring-1 ring-amber-500/20 p-4 text-center space-y-2">
                <Target className="h-5 w-5 text-amber-600 dark:text-amber-400 mx-auto" />
                <div className="text-sm font-bold text-amber-700 dark:text-amber-400">Optimize CPA</div>
                <div className="text-xs text-muted-foreground">راجع الـ Creative والـ Landing Page</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </CollapsibleSection>

      {/* Footer */}
      <div className="text-xs text-muted-foreground">
        آخر تحديث: {new Date(overview.data.fetched_at).toLocaleTimeString("ar-EG")}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main Overview Page
// ──────────────────────────────────────────────────────────────
export default function Overview() {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [preset, setPreset] = useState<DatePreset>("7d");
  const [customRange, setCustomRange] = useState(() => rangeFromPreset("7d"));

  const range = useMemo(
    () => (preset === "custom" ? customRange : rangeFromPreset(preset)),
    [preset, customRange]
  );

  const accountList: AdAccountSummary[] = accounts.data?.accounts ?? [];
  const today = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Auto-select first account
  const effectiveAccountId = activeAccountId ?? accountList[0]?.id ?? null;

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ["meta", "account-overview"] });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            نظرة عامة على جميع الحسابات الإعلانية
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">نظرة عامة</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                كل حساب في 10 ثواني — اعرف مين كسب ومين خسر
              </p>
            </div>
          </div>
        </header>

        {/* Controls */}
        <div className="rounded-2xl border border-border bg-card/50 p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {/* Date preset */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">الفترة</label>
              <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)} dir="rtl">
                <SelectTrigger className="h-11 min-w-[170px]">
                  <CalendarRange className="h-4 w-4 ml-1 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>فترات سريعة</SelectLabel>
                    {(["today", "yesterday", "7d", "14d", "28d"] as DatePreset[]).map((p) => (
                      <SelectItem key={p} value={p}>{presetLabels[p]}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>شهري</SelectLabel>
                    {(["current_month", "prev_month"] as DatePreset[]).map((p) => (
                      <SelectItem key={p} value={p}>{presetLabels[p]}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>مخصص</SelectLabel>
                    <SelectItem value="custom">مخصص</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Refresh */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider invisible">تحديث</label>
              <Button onClick={handleRefresh} variant="outline" className="h-11 gap-2">
                <RefreshCw className="h-4 w-4" />
                تحديث
              </Button>
            </div>
          </div>

          {/* Custom date range */}
          {preset === "custom" && (
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">من تاريخ</label>
                <input
                  type="date"
                  max={customRange.until || today}
                  value={customRange.since}
                  onChange={(e) => setCustomRange((r) => ({ ...r, since: e.target.value }))}
                  className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">إلى تاريخ</label>
                <input
                  type="date"
                  min={customRange.since}
                  max={today}
                  value={customRange.until}
                  onChange={(e) => setCustomRange((r) => ({ ...r, until: e.target.value }))}
                  className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          )}

          <div className="border-t border-border pt-3 text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            فترة البيانات: <span className="num font-medium text-foreground">{formatRange(range.since, range.until)}</span>
            · <span className="num font-medium text-foreground">{accountList.length}</span> حساب إعلاني
          </div>
        </div>

        {/* Account Tabs */}
        {accounts.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 rounded-xl" />
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          </div>
        ) : accountList.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>لا توجد حسابات إعلانية</AlertTitle>
            <AlertDescription>تأكد من إعداد الحسابات في الإعدادات.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5">
            {/* Tab bar */}
            <div className="flex flex-wrap gap-2">
              {accountList.map((acc) => {
                const isActive = (activeAccountId ?? accountList[0].id) === acc.id;
                return (
                  <button
                    key={acc.id}
                    onClick={() => setActiveAccountId(acc.id)}
                    className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-card border border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {acc.name || acc.id}
                  </button>
                );
              })}
            </div>

            {/* Active account content */}
            {effectiveAccountId && (() => {
              const acc = accountList.find((a) => a.id === effectiveAccountId);
              return (
                <AccountTabContent
                  key={effectiveAccountId}
                  accountId={effectiveAccountId}
                  accountName={acc?.name || effectiveAccountId}
                  since={range.since}
                  until={range.until}
                />
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
