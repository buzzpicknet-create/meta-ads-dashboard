import { useMemo, useState } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ExecutiveSummary } from "@/components/executive-summary";
import { ImpactCalculator } from "@/components/impact-calculator";
import { ActionChecklist } from "@/components/action-checklist";
import {
  funnelTotals,
  adSetSegments,
  adSegments,
  headlineSegments,
  dailyTrend,
  clarityInsights,
  type Segment,
  type ClarityInsight,
} from "@/lib/data";

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
            width: `${pctOfTop}%`,
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
function Verdict({
  type,
}: {
  type: "winner" | "kill" | "okay" | "weak";
}) {
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

function verdictFor(s: Segment, all: Segment[]): "winner" | "kill" | "okay" | "weak" {
  const cpas = all.filter(x => x.purchases > 0).map(x => x.cpa);
  const minCpa = Math.min(...cpas);
  const noPurchases = s.purchases === 0;
  if (noPurchases || s.cpa > minCpa * 2.5) return "kill";
  if (s.cpa <= minCpa * 1.15) return "winner";
  if (s.cpa <= minCpa * 1.6) return "okay";
  return "weak";
}

// ---------- Segment Table ----------
function SegmentTable({ segments, label }: { segments: Segment[]; label: string }) {
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
          {segments.map(s => {
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

// ---------- Clarity Card ----------
function ClarityCard({ insight }: { insight: ClarityInsight }) {
  const sevConfig = {
    critical: { cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/30", label: "حرج" },
    high: { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30", label: "عالي" },
    medium: { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/30", label: "متوسط" },
    low: { cls: "bg-muted text-muted-foreground ring-border", label: "منخفض" },
  }[insight.severity];

  const stageIcons = {
    Ad: Eye,
    Landing: MousePointerClick,
    Offer: Sparkles,
    Checkout: ShoppingCart,
  };
  const StageIcon = stageIcons[insight.funnelStage];

  return (
    <Card className="h-full">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${sevConfig.cls}`}
              >
                {sevConfig.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground ring-1 ring-inset ring-border">
                <StageIcon className="h-3 w-3" />
                {insight.funnelStage}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                <Num>{fmt(insight.affectedSessions)}</Num> سيشن
              </span>
            </div>
            <h3 className="text-base font-bold leading-snug">{insight.title}</h3>
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          {insight.arabicSummary}
        </p>

        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3.5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              التشخيص
            </div>
            <p className="text-sm leading-relaxed">{insight.diagnosis}</p>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              التوصية
            </div>
            <p className="text-sm leading-relaxed">{insight.recommendation}</p>
          </div>
          <div className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-3 py-2 ring-1 ring-emerald-500/20">
            <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span className="text-sm text-emerald-800 dark:text-emerald-300 leading-relaxed">
              {insight.expectedImpact}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Main Dashboard ----------
export default function Dashboard() {
  const [segView, setSegView] = useState<"adset" | "ad" | "headline">("adset");

  const segments = useMemo(() => {
    if (segView === "adset") return adSetSegments;
    if (segView === "ad") return adSegments;
    return headlineSegments;
  }, [segView]);

  const segLabel = segView === "adset" ? "Ad Set" : segView === "ad" ? "Creative" : "Headline";

  // Funnel data
  const funnelSteps = [
    {
      label: "Impressions",
      value: funnelTotals.impressions,
      color: "hsl(220 15% 50%)",
      good: true,
    },
    {
      label: "Link Clicks",
      value: funnelTotals.linkClicks,
      color: CHART_COLORS.info,
      good: funnelTotals.ctr > 2.5,
    },
    {
      label: "Landing Page Views",
      value: funnelTotals.lpv,
      color: CHART_COLORS.primary,
      good: funnelTotals.lpvRate > 75,
    },
    {
      label: "Purchases",
      value: funnelTotals.purchases,
      color: CHART_COLORS.good,
      good: funnelTotals.crLpv > 5,
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
    { stage: "Hook (3s)", views: Math.round(funnelTotals.impressions * funnelTotals.hookRate / 100) },
    { stage: "25%", views: funnelTotals.v25 },
    { stage: "50%", views: funnelTotals.v50 },
    { stage: "75%", views: funnelTotals.v75 },
    { stage: "95%", views: funnelTotals.v95 },
    { stage: "100%", views: funnelTotals.v100 },
  ];

  // Daily trend with CPA
  const trendData = dailyTrend.map(d => ({
    ...d,
    cpa: d.purchases ? d.spend / d.purchases : null,
    day: d.day.slice(5),
  }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* HEADER */}
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            تقرير تحليلي · فترة <Num>17 → 23 أبريل 2026</Num>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                تحليل الفانل الكامل
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Meta Ads × Microsoft Clarity — تشخيص وقرارات مباشرة
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-card">
                <Activity className="h-3 w-3 ml-1" />
                Active
              </Badge>
              <Badge variant="outline" className="bg-card">
                <Num>16</Num> صف بيانات يومية
              </Badge>
            </div>
          </div>
        </header>

        {/* EXECUTIVE SUMMARY — TL;DR في 30 ثانية */}
        <ExecutiveSummary />

        {/* KPI CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={CircleDollarSign}
            label="إجمالي الإنفاق"
            value={`${fmt(funnelTotals.spend, 2)} EGP`}
            sub={`CPM ${fmt(funnelTotals.cpm, 2)} EGP`}
            tone="neutral"
          />
          <KpiCard
            icon={ShoppingCart}
            label="الأوردرات"
            value={fmt(funnelTotals.purchases)}
            sub={`من ${fmt(funnelTotals.lpv)} LPV — CR ${fmtPct(funnelTotals.crLpv)}`}
            tone="good"
            trend={{ dir: "up", text: "CR صحي", good: true }}
          />
          <KpiCard
            icon={CircleDollarSign}
            label="تكلفة الأوردر (CPA)"
            value={`${fmt(funnelTotals.costPerPurchase, 2)} EGP`}
            sub={`الهدف: تحت 35 EGP`}
            tone="warn"
            trend={{ dir: "down", text: "ممكن ينزل لـ 28", good: true }}
          />
          <KpiCard
            icon={MousePointerClick}
            label="CTR (Link)"
            value={fmtPct(funnelTotals.ctr)}
            sub={`CPC ${fmt(funnelTotals.cpc, 2)} EGP · ${fmt(funnelTotals.linkClicks)} كليك`}
            tone="good"
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
              {funnelStepsEnriched.map(s => (
                <FunnelStep key={s.label} {...s} />
              ))}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                <div>
                  <div className="text-xs text-muted-foreground">CTR</div>
                  <div className="text-lg font-bold">
                    <Num>{fmtPct(funnelTotals.ctr)}</Num>
                  </div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400">صحي ✓</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Click → LPV</div>
                  <div className="text-lg font-bold">
                    <Num>{fmtPct(funnelTotals.lpvRate)}</Num>
                  </div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400">ممتاز ✓</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">LPV → Buy</div>
                  <div className="text-lg font-bold">
                    <Num>{fmtPct(funnelTotals.crLpv)}</Num>
                  </div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400">جيد ✓</div>
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
                <Num>80%</Num> من الناس بتعدّي أول 3 ثواني. اللي بيكمّل أول 3 بيكمّل لآخر الفيديو ({" "}
                <Num>{fmt((funnelTotals.v100 / funnelTotals.v25) * 100, 0)}%</Num> retention من 25% لـ 100%). الـ Hook هو البلوك الوحيد.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* DAILY TREND */}
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

        {/* IMPACT CALCULATOR */}
        <ImpactCalculator />

        {/* SEGMENTS */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              مقارنة الأداء — اشطبي الخاسر، ضاعفي على الفائز
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={segView} onValueChange={v => setSegView(v as typeof segView)} dir="rtl">
              <TabsList className="mb-4">
                <TabsTrigger value="adset">Ad Set</TabsTrigger>
                <TabsTrigger value="ad">Creative</TabsTrigger>
                <TabsTrigger value="headline">Headline</TabsTrigger>
              </TabsList>
              <TabsContent value={segView} className="m-0">
                <SegmentTable segments={segments} label={segLabel} />

                {/* CPA Bar Chart */}
                <div className="mt-6 h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={segments.map(s => ({
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
                            v === "winner" ? CHART_COLORS.good :
                            v === "kill" ? CHART_COLORS.bad :
                            v === "okay" ? CHART_COLORS.info : CHART_COLORS.warn;
                          return <Cell key={i} fill={color} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* CLARITY INSIGHTS */}
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                رؤى Microsoft Clarity — سلوك المستخدم
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                <Num>4</Num> مشاكل سلوكية مرصودة، مرتّبة من الأخطر للأقل خطورة
              </p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {clarityInsights.map(i => (
              <ClarityCard key={i.id} insight={i} />
            ))}
          </div>
        </section>

        {/* ACTION CHECKLIST */}
        <ActionChecklist />

        {/* FOOTER */}
        <footer className="pt-6 mt-6 border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              تم التحليل من <Num>16</Num> صف بيانات يومية + <Num>4</Num> رؤى Clarity على{" "}
              <Num>{fmt(clarityInsights.reduce((s, i) => s + i.affectedSessions, 0))}</Num> سيشن
            </div>
            <div>كل الأرقام بالـ EGP</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
