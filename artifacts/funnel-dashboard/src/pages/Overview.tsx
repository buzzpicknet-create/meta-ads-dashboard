import { useMemo, useState } from "react";
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
  CircleDollarSign,
  Eye,
  MousePointerClick,
  PauseCircle,
  RefreshCw,
  Rocket,
  ShoppingCart,
  Target,
  TrendingDown,
  TrendingUp,
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
import { useAccounts, useAccountOverview } from "@/hooks/use-meta";
import {
  type AccountOverview,
  type CampaignSummaryFull,
  type DatePreset,
  type AdAccountSummary,
  rangeFromPreset,
  formatRange,
} from "@/lib/meta-api";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function fmt(n: number, d = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n: number): string { return `${n.toFixed(2)}%`; }
function Num({ children }: { children: React.ReactNode }) { return <span className="num">{children}</span>; }

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
  sub?: string;
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
            {sub && <div className="text-[11px] text-muted-foreground"><Num>{sub}</Num></div>}
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
// Alerts section
// ──────────────────────────────────────────────────────────────
function AccountAlerts({ overview }: { overview: AccountOverview }) {
  const { totals, campaigns } = overview;
  const alerts: { type: "danger" | "warn" | "info"; msg: string }[] = [];

  const activeCampaigns = campaigns.filter((c) => c.spend > 0);
  const cpas = activeCampaigns.filter((c) => c.purchases > 0).map((c) => c.cpa);
  const minCpa = cpas.length ? Math.min(...cpas) : 0;

  const drainers = activeCampaigns.filter((c) => c.spend >= 100 && (c.purchases === 0 || (minCpa > 0 && c.cpa > minCpa * 3)));
  drainers.forEach((c) => {
    alerts.push({ type: "danger", msg: `"${c.name.slice(0, 45)}" يستهلك ${fmt(c.spend, 0)} EGP بدون نتائج كافية` });
  });

  if (totals.ctr < 1) alerts.push({ type: "danger", msg: `CTR منخفض جداً (${fmtPct(totals.ctr)}) على مستوى الحساب` });
  if (totals.crLpv < 2 && totals.lpv > 0) alerts.push({ type: "warn", msg: `CR ضعيف (${fmtPct(totals.crLpv)}) — صفحة المنتج تحتاج مراجعة` });

  const winners = activeCampaigns.filter((c) => minCpa > 0 && c.cpa <= minCpa * 1.15 && c.purchases > 0);
  if (winners.length > 0) {
    alerts.push({ type: "info", msg: `🏆 ${winners.length} حملة رابحة — ضاعف ميزانيتها الآن` });
  }

  // CPA increase compared to prev
  if (overview.prev_totals.cpa > 0 && totals.cpa > overview.prev_totals.cpa * 1.2) {
    alerts.push({ type: "warn", msg: `CPA زاد ${fmt(((totals.cpa - overview.prev_totals.cpa) / overview.prev_totals.cpa) * 100, 0)}% مقارنة بالفترة السابقة` });
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
          {a.msg}
        </div>
      ))}
    </div>
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
              <div className="text-2xl font-bold"><Num>{winnerOrders} طلب</Num></div>
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
          <div className="space-y-2">
            {winners.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl bg-emerald-500/8 ring-1 ring-emerald-500/15 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    <Num>CPA {fmt(c.cpa, 0)} EGP · {c.purchases} طلب · {fmt(c.spend, 0)} EGP · CTR {fmtPct(c.ctr)}</Num>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">رابح</span>
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
          <div className="space-y-2">
            {losers.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl bg-rose-500/8 ring-1 ring-rose-500/15 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    <Num>إنفاق {fmt(c.spend, 0)} EGP · {c.purchases} طلب · {c.purchases === 0 ? "لا أوردرات" : `CPA ${fmt(c.cpa, 0)} EGP`}</Num>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full">أوقف</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {winners.length === 0 && losers.length === 0 && (
        <div className="text-center text-sm text-muted-foreground italic py-6">لا توجد بيانات كافية لتحليل الحملات</div>
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
  const { totals, prev_totals, campaigns, daily } = overview.data;
  const health = healthScore(overview.data);
  const activeCampaigns = campaigns.filter((c) => c.spend > 0);

  return (
    <div className="space-y-6">
      {/* Health + summary row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HealthBadge status={health} />
        <div className="text-xs text-muted-foreground">
          <span className="num font-medium text-foreground">{activeCampaigns.length}</span> حملة نشطة ·{" "}
          <span className="num font-medium text-foreground">{campaigns.length}</span> إجمالي
        </div>
      </div>

      {/* Alerts */}
      <AccountAlerts overview={overview.data} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          icon={CircleDollarSign}
          label="إجمالي الإنفاق"
          value={`${fmt(totals.spend, 0)} EGP`}
          sub={`CPM ${fmt(totals.cpm, 0)} EGP`}
          current={totals.spend}
          prev={prev_totals.spend}
          tone="neutral"
        />
        <KpiCard
          icon={ShoppingCart}
          label="الأوردرات"
          value={fmt(totals.purchases)}
          sub={totals.lpv > 0 ? `من ${fmt(totals.lpv)} زيارة` : undefined}
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
          sub={`CPC ${fmt(totals.cpc, 0)} EGP`}
          current={totals.ctr}
          prev={prev_totals.ctr}
          tone={totals.ctr >= 2 ? "good" : totals.ctr >= 1 ? "warn" : "bad"}
        />
        <KpiCard
          icon={Eye}
          label="CPM"
          value={`${fmt(totals.cpm, 0)} EGP`}
          sub={`${fmt(totals.impressions)} ظهور`}
          current={totals.cpm}
          prev={prev_totals.cpm}
          lowerIsBetter
          tone={totals.cpm < 30 ? "good" : totals.cpm < 60 ? "warn" : "bad"}
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

      {/* Priority Engine */}
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

      {/* Trend */}
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

      {/* Top & Worst Campaigns */}
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

      {/* Quick Actions */}
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
