import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  Cell,
  ComposedChart,
  Area,
} from "recharts";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  MousePointerClick,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ExecutiveSummary } from "@/components/executive-summary";
import { ImpactCalculator } from "@/components/impact-calculator";
import { ActionChecklist } from "@/components/action-checklist";
import { DashboardControls } from "@/components/dashboard-controls";
import { useCampaigns, useInsights, useAccount, useAccounts } from "@/hooks/use-meta";
import {
  type DatePreset,
  type SegmentEntry,
  type CampaignInsights,
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
  return <span className="num">{children}</span>;
}

// ---------- KPI Card ----------
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
  sub?: string;
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
            <div className="text-3xl font-bold tracking-tight">
              <Num>{value}</Num>
            </div>
            {sub && (
              <div className="text-xs text-muted-foreground">
                <Num>{sub}</Num>
              </div>
            )}
            {trend && (
              <div
                className={`inline-flex items-center gap-1 text-xs font-medium ${
                  trend.good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {trend.dir === "up" ? (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" />
                )}
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

// ---------- Funnel Bar ----------
function FunnelStep({
  label,
  value,
  pctOfPrev,
  pctOfTop,
  color,
  drop,
  good,
}: {
  label: string;
  value: number;
  pctOfPrev: number;
  pctOfTop: number;
  color: string;
  drop?: number;
  good: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="flex items-baseline gap-3">
          <div className="text-xs text-muted-foreground">
            <Num>{fmtPct(pctOfPrev)}</Num> من السابق
          </div>
          <div className="text-lg font-bold tabular-nums">
            <Num>{fmt(value)}</Num>
          </div>
        </div>
      </div>
      <div className="relative h-9 w-full overflow-hidden rounded-md bg-muted">
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-start pr-3 text-xs font-semibold text-white"
          style={{
            width: `${Math.max(pctOfTop, 4)}%`,
            backgroundColor: color,
            transition: "width .6s ease",
          }}
        >
          <Num>{fmtPct(pctOfTop)}</Num>
        </div>
      </div>
      {drop !== undefined && (
        <div
          className={`text-xs flex items-center gap-1.5 ${
            good ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {good ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          فاقد <Num>{fmt(drop)}</Num> مستخدم في الخطوة دي
        </div>
      )}
    </div>
  );
}

// ---------- Verdict ----------
function Verdict({ type }: { type: "winner" | "kill" | "okay" | "weak" }) {
  const config = {
    winner: { icon: Sparkles, text: "Winner", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30" },
    kill: { icon: XCircle, text: "Kill", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-rose-500/30" },
    okay: { icon: CheckCircle2, text: "OK", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-sky-500/30" },
    weak: { icon: TrendingDown, text: "Weak", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30" },
  }[type];
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${config.cls}`}
    >
      <Icon className="h-3 w-3" />
      {config.text}
    </span>
  );
}

function verdictFor(s: SegmentEntry, all: SegmentEntry[]): "winner" | "kill" | "okay" | "weak" {
  const cpas = all.filter((x) => x.purchases > 0).map((x) => x.cpa);
  const minCpa = cpas.length > 0 ? Math.min(...cpas) : 0;
  const noPurchases = s.purchases === 0;
  if (noPurchases || (minCpa > 0 && s.cpa > minCpa * 2.5)) return "kill";
  if (minCpa > 0 && s.cpa <= minCpa * 1.15) return "winner";
  if (minCpa > 0 && s.cpa <= minCpa * 1.6) return "okay";
  return "weak";
}

// ---------- Segment Table ----------
function SegmentTable({ segments, label }: { segments: SegmentEntry[]; label: string }) {
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
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-right font-medium px-3 py-2">{label}</th>
            <th className="text-left font-medium px-2 py-2">CPA</th>
            <th className="text-left font-medium px-2 py-2">Purchases</th>
            <th className="text-left font-medium px-2 py-2">Spend</th>
            <th className="text-left font-medium px-2 py-2">CTR</th>
            <th className="text-left font-medium px-2 py-2">CR</th>
            <th className="text-left font-medium px-2 py-2">CPC</th>
            <th className="text-left font-medium px-2 py-2">الحكم</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => {
            const v = verdictFor(s, segments);
            return (
              <tr key={s.key} className="border-t border-border hover:bg-muted/30 transition-colors">
                <td className="px-3 py-3 font-medium max-w-[260px]">
                  <div className="truncate">{s.label}</div>
                </td>
                <td className="px-2 py-3 tabular-nums text-left">
                  <Num>{s.cpa > 0 ? fmt(s.cpa, 2) : "—"}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left font-semibold">
                  <Num>{fmt(s.purchases)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmt(s.spend, 2)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmtPct(s.ctr)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmtPct(s.cr)}</Num>
                </td>
                <td className="px-2 py-3 tabular-nums text-left text-muted-foreground">
                  <Num>{fmt(s.cpc, 2)}</Num>
                </td>
                <td className="px-2 py-3 text-left">
                  <Verdict type={v} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Loading skeleton ----------
function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-32 rounded-2xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

// ---------- Insights body ----------
function InsightsBody({ insights }: { insights: CampaignInsights }) {
  const [segView, setSegView] = useState<"adset" | "ad">("adset");
  const totals = insights.totals;
  const segments = segView === "adset" ? insights.by_adset : insights.by_ad;
  const segLabel = segView === "adset" ? "Ad Set" : "Creative";

  // Funnel data
  const funnelSteps = [
    {
      label: "Impressions",
      value: totals.impressions,
      color: "hsl(220 15% 50%)",
      good: true,
    },
    {
      label: "Link Clicks",
      value: totals.link_clicks,
      color: CHART_COLORS.info,
      good: totals.ctr > 2.5,
    },
    {
      label: "Landing Page Views",
      value: totals.lpv,
      color: CHART_COLORS.primary,
      good: totals.lpvRate > 75,
    },
    {
      label: "Purchases",
      value: totals.purchases,
      color: CHART_COLORS.good,
      good: totals.crLpv > 5,
    },
  ];

  const top = funnelSteps[0].value;
  const funnelStepsEnriched = funnelSteps.map((s, i) => {
    const prev = i === 0 ? s.value : funnelSteps[i - 1].value;
    return {
      ...s,
      pctOfPrev: prev ? (s.value / prev) * 100 : 0,
      pctOfTop: top ? (s.value / top) * 100 : 0,
      drop: i === 0 ? undefined : prev - s.value,
    };
  });

  // Video retention
  const videoData = [
    { stage: "Hook (Plays)", views: totals.video_plays },
    { stage: "25%", views: totals.v25 },
    { stage: "50%", views: totals.v50 },
    { stage: "75%", views: totals.v75 },
    { stage: "95%", views: totals.v95 },
    { stage: "100%", views: totals.v100 },
  ];
  const hasVideo = videoData.some((v) => v.views > 0);
  const v25to100Pct =
    totals.v25 > 0 ? (totals.v100 / totals.v25) * 100 : 0;

  // Daily trend with CPA
  const trendData = insights.daily.map((d) => ({
    ...d,
    cpa: d.purchases ? d.spend / d.purchases : null,
    day: d.day.slice(5),
  }));

  // CPA target heuristic
  const cpaTarget = Math.round(totals.cpa * 0.8);

  return (
    <div className="space-y-8">
      {/* EXECUTIVE SUMMARY */}
      <ExecutiveSummary totals={totals} byAd={insights.by_ad} byAdset={insights.by_adset} />

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={CircleDollarSign}
          label="إجمالي الإنفاق"
          value={`${fmt(totals.spend, 2)} EGP`}
          sub={`CPM ${fmt(totals.cpm, 2)} EGP`}
          tone="neutral"
        />
        <KpiCard
          icon={ShoppingCart}
          label="الأوردرات"
          value={fmt(totals.purchases)}
          sub={
            totals.lpv > 0
              ? `من ${fmt(totals.lpv)} LPV — CR ${fmtPct(totals.crLpv)}`
              : "لا توجد بيانات LPV"
          }
          tone={totals.crLpv >= 5 ? "good" : "warn"}
          trend={
            totals.crLpv >= 5
              ? { dir: "up", text: "CR صحي", good: true }
              : totals.purchases > 0
              ? { dir: "down", text: "CR منخفض", good: false }
              : undefined
          }
        />
        <KpiCard
          icon={CircleDollarSign}
          label="تكلفة الأوردر (CPA)"
          value={totals.cpa > 0 ? `${fmt(totals.cpa, 2)} EGP` : "—"}
          sub={cpaTarget > 0 ? `الهدف: تحت ${cpaTarget} EGP` : ""}
          tone={
            totals.cpa === 0 ? "bad" : totals.cpa < 30 ? "good" : totals.cpa < 60 ? "warn" : "bad"
          }
        />
        <KpiCard
          icon={MousePointerClick}
          label="CTR (Link)"
          value={fmtPct(totals.ctr)}
          sub={`CPC ${fmt(totals.cpc, 2)} EGP · ${fmt(totals.link_clicks)} كليك`}
          tone={totals.ctr >= 2 ? "good" : "warn"}
        />
      </div>

      {/* FUNNEL + VIDEO RETENTION */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowDownRight className="h-4 w-4 text-primary" />
              الفانل من الإعلان للأوردر
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            {funnelStepsEnriched.map((s) => (
              <FunnelStep key={s.label} {...s} />
            ))}
            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
              <div>
                <div className="text-xs text-muted-foreground">CTR</div>
                <div className="text-lg font-bold">
                  <Num>{fmtPct(totals.ctr)}</Num>
                </div>
                <div className={`text-[10px] ${totals.ctr >= 2 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {totals.ctr >= 2 ? "صحي ✓" : "محتاج تحسين"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Click → LPV</div>
                <div className="text-lg font-bold">
                  <Num>{fmtPct(totals.lpvRate)}</Num>
                </div>
                <div className={`text-[10px] ${totals.lpvRate >= 75 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {totals.lpvRate >= 75 ? "ممتاز ✓" : "صفحة بطيئة"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">LPV → Buy</div>
                <div className="text-lg font-bold">
                  <Num>{fmtPct(totals.crLpv)}</Num>
                </div>
                <div className={`text-[10px] ${totals.crLpv >= 5 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {totals.crLpv >= 5 ? "جيد ✓" : "محتاج تحسين"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-primary" />
              Retention الفيديو — هنا الفلوس بتتحرق
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasVideo ? (
              <>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={videoData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="stage"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RTooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="views" radius={[6, 6, 0, 0]}>
                        {videoData.map((d, i) => (
                          <Cell
                            key={i}
                            fill={i === 0 ? CHART_COLORS.bad : i < 2 ? CHART_COLORS.warn : CHART_COLORS.primary}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 p-3 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 text-xs leading-relaxed">
                  <strong className="text-amber-700 dark:text-amber-400">تشخيص:</strong>{" "}
                  من اللي وصلوا 25% من الفيديو، <Num>{fmt(v25to100Pct, 0)}%</Num> أكملوا للنهاية.
                  {totals.hookRate < 30 && (
                    <>
                      {" "}الـ Hook Rate (<Num>{fmt(totals.hookRate, 1)}%</Num>) منخفض — أول 3 ثواني محتاجة قوة.
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm italic">
                لا توجد بيانات فيديو لهذه الحملة
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="spend"
                    name="Spend (EGP)"
                    stroke={CHART_COLORS.primary}
                    fill="url(#spendGrad)"
                    strokeWidth={2}
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="purchases"
                    name="Purchases"
                    fill={CHART_COLORS.good}
                    radius={[4, 4, 0, 0]}
                    barSize={28}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="cpa"
                    name="CPA (EGP)"
                    stroke={CHART_COLORS.bad}
                    strokeWidth={2.5}
                    dot={{ fill: CHART_COLORS.bad, r: 4 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* IMPACT CALCULATOR */}
      <ImpactCalculator totals={totals} byAd={insights.by_ad} />

      {/* SEGMENTS */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            مقارنة الأداء — اشطبي الخاسر، ضاعفي على الفائز
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={segView} onValueChange={(v) => setSegView(v as typeof segView)} dir="rtl">
            <TabsList className="mb-4">
              <TabsTrigger value="adset">Ad Set ({insights.by_adset.length})</TabsTrigger>
              <TabsTrigger value="ad">Creative ({insights.by_ad.length})</TabsTrigger>
            </TabsList>
            <TabsContent value={segView} className="m-0">
              <SegmentTable segments={segments} label={segLabel} />

              {/* CPA Bar Chart */}
              {segments.length > 0 && (
                <div className="mt-6 h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={segments.map((s) => ({
                        name: s.label.length > 30 ? s.label.slice(0, 30) + "…" : s.label,
                        cpa: s.cpa || 0,
                        purchases: s.purchases,
                      }))}
                      margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RTooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="cpa" name="CPA (EGP)" radius={[6, 6, 0, 0]}>
                        {segments.map((s, i) => {
                          const v = verdictFor(s, segments);
                          const color =
                            v === "winner"
                              ? CHART_COLORS.good
                              : v === "kill"
                              ? CHART_COLORS.bad
                              : v === "okay"
                              ? CHART_COLORS.info
                              : CHART_COLORS.warn;
                          return <Cell key={i} fill={color} />;
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

      {/* ACTION CHECKLIST */}
      <ActionChecklist />
    </div>
  );
}

// ---------- Main Dashboard ----------
export default function Dashboard() {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<DatePreset>("7d");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const range = useMemo(() => rangeFromPreset(preset), [preset]);

  const account = useAccount();
  const accounts = useAccounts();
  const campaigns = useCampaigns({
    ...range,
    ad_account_id: selectedAccountId || undefined,
  });
  const insights = useInsights({
    campaign_id: selectedCampaignId,
    ad_account_id: selectedAccountId || undefined,
    since: range.since,
    until: range.until,
  });

  // Auto-select the top-spending campaign when campaigns load
  useEffect(() => {
    if (campaigns.data && !selectedCampaignId) {
      const top = [...campaigns.data.campaigns]
        .filter((c) => c.spend > 0)
        .sort((a, b) => b.spend - a.spend)[0];
      if (top) setSelectedCampaignId(top.id);
    }
  }, [campaigns.data, selectedCampaignId]);

  useEffect(() => {
    const available = accounts.data?.accounts || [];
    if (!selectedAccountId && available.length > 0) {
      setSelectedAccountId(available[0].id);
    }
  }, [accounts.data, selectedAccountId]);

  useEffect(() => {
    setSelectedCampaignId(null);
  }, [selectedAccountId]);

  const visibleCampaigns = useMemo(() => {
    const list = campaigns.data?.campaigns || [];
    return selectedAccountId
      ? list.filter((c) => c.id && c.name)
      : list;
  }, [campaigns.data?.campaigns, selectedAccountId]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["meta"] });
  };

  const isRefreshing = campaigns.isFetching || insights.isFetching;

  const accountLine = account.data
    ? `${account.data.name} · ${account.data.currency} · ${account.data.timezone_name}`
    : "Meta Ads";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* HEADER */}
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            مباشر من Meta Ads · {accountLine}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                تحليل الفانل الكامل
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Meta Ads — تشخيص وقرارات مباشرة
              </p>
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
          campaigns={visibleCampaigns}
          accounts={accounts.data?.accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          isLoadingCampaigns={campaigns.isLoading}
          selectedCampaignId={selectedCampaignId}
          onSelectCampaign={setSelectedCampaignId}
          preset={preset}
          onPresetChange={setPreset}
          range={range}
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
              {(campaigns.error as Error)?.message ||
                (insights.error as Error)?.message}
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
            <AlertDescription>
              جرّبي فترة أطول أو افتحي Meta Ads Manager للتأكد.
            </AlertDescription>
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
