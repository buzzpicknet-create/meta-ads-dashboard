import { useQuery } from "@tanstack/react-query";
import { useDashboard } from "@/context/dashboard-context";
import { API } from "@/context/auth-context";
import { KpiCard } from "@/components/kpi-card";
import { AIChatWidget } from "@/components/ai-chat-widget";
import {
  ShoppingCart,
  DollarSign,
  Percent,
  TrendingUp,
  MousePointerClick,
  Target,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Minus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface AccountOverview {
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpm: number;
    cpc: number;
    actions: number;
    action_values: number;
    cpp: number;
    cpa: number;
    roas: number;
  };
  daily_breakdown: {
    date: string;
    spend: number;
    actions: number;
    cpa: number;
    ctr: number;
    impressions: number;
    roas: number;
  }[];
  previous_period?: {
    spend: number;
    actions: number;
    cpa: number;
    ctr: number;
    roas: number;
  };
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  actions: number;
  action_values: number;
  cpa: number;
  roas: number;
  frequency?: number;
}

function pct(a?: number, b?: number) {
  if (!a || !b || b === 0) return undefined;
  return ((a - b) / b) * 100;
}

function fmt(n: number | undefined | null, dec = 0) {
  return (n ?? 0).toLocaleString("ar-EG", { maximumFractionDigits: dec });
}

function safe(n: number | undefined | null, fallback = 0) {
  return n ?? fallback;
}

function priorityLevel(c: Campaign): "danger" | "warn" | "ok" {
  if (safe(c.ctr) < 1.5 || safe(c.cpa) > 100 || (c.frequency ?? 0) > 2.5) return "danger";
  if (safe(c.ctr) < 2 || safe(c.cpa) > 40 || (c.frequency ?? 0) > 1.5) return "warn";
  return "ok";
}

function priorityIssues(c: Campaign): string[] {
  const issues: string[] = [];
  if (safe(c.ctr) < 1.5) issues.push("CTR منخفض جداً");
  else if (safe(c.ctr) < 2) issues.push("CTR ضعيف");
  if (safe(c.cpa) > 100) issues.push("CPA مرتفع جداً");
  else if (safe(c.cpa) > 40) issues.push("CPA يتخطى الهدف");
  if ((c.frequency ?? 0) > 2.5) issues.push("تشبع الجمهور (Freq)");
  else if ((c.frequency ?? 0) > 1.5) issues.push("تكرار عالٍ");
  if (safe(c.roas) < 2) issues.push("ROAS منخفض");
  return issues;
}

type SortKey = keyof Campaign;

export default function Campaigns() {
  const { dateRange, selectedAccount } = useDashboard();
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [chartMetric, setChartMetric] = useState<"spend" | "cpa" | "roas">("spend");

  const accountId = selectedAccount;
  const params = new URLSearchParams({
    ...(accountId ? { ad_account_id: accountId } : {}),
    since: dateRange.since,
    until: dateRange.until,
  });

  const { data: overview, isLoading: ovLoading } = useQuery<AccountOverview>({
    queryKey: ["account-overview", accountId, dateRange],
    queryFn: () =>
      fetch(`${API}/meta/account-overview?${params}`, {
        credentials: "include",
      }).then((r) => r.json()),
    staleTime: 2 * 60_000,
    enabled: !!accountId || true,
  });

  const { data: campaignsRaw = [], isLoading: cLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns", accountId, dateRange],
    queryFn: () =>
      fetch(`${API}/meta/campaigns?${params}`, {
        credentials: "include",
      })
        .then((r) => r.json())
        .then((d) => Array.isArray(d.campaigns) ? d.campaigns : Array.isArray(d) ? d : []),
    staleTime: 2 * 60_000,
  });
  const campaigns: Campaign[] = Array.isArray(campaignsRaw) ? campaignsRaw : [];

  const t = overview?.totals;
  const prev = overview?.previous_period;

  const kpis = [
    {
      label: "تكلفة الطلب (CPA)",
      value: t ? `${fmt(t.cpa, 0)} EGP` : "—",
      change: pct(prev?.cpa ? 1 / t!.cpa : undefined, prev?.cpa ? 1 / prev.cpa : undefined),
      icon: <Target className="w-4 h-4" />,
      highlight: t
        ? t.cpa > 100
          ? "danger"
          : t.cpa > 40
          ? "warn"
          : "good"
        : "neutral",
    },
    {
      label: "إجمالي الطلبات",
      value: t ? fmt(t.actions) : "—",
      change: prev ? pct(t?.actions, prev.actions) : undefined,
      icon: <ShoppingCart className="w-4 h-4" />,
      highlight: "neutral",
    },
    {
      label: "إجمالي الإنفاق",
      value: t ? `${fmt(t.spend, 0)} EGP` : "—",
      change: prev ? pct(t?.spend, prev.spend) : undefined,
      icon: <DollarSign className="w-4 h-4" />,
      highlight: "neutral",
    },
    {
      label: "معدل التحويل (CR)",
      value: t && t.impressions > 0
        ? `${((t.actions / t.clicks) * 100).toFixed(2)}%`
        : "—",
      change: undefined,
      icon: <Percent className="w-4 h-4" />,
      highlight: "neutral",
    },
    {
      label: "العائد على الإنفاق (ROAS)",
      value: t ? `${t.roas.toFixed(2)}x` : "—",
      change: prev ? pct(t?.roas, prev.roas) : undefined,
      icon: <TrendingUp className="w-4 h-4" />,
      highlight: t
        ? t.roas >= 5
          ? "good"
          : t.roas >= 2
          ? "warn"
          : "danger"
        : "neutral",
    },
    {
      label: "نسبة النقر (CTR)",
      value: t ? `${t.ctr.toFixed(2)}%` : "—",
      change: prev ? pct(t?.ctr, prev.ctr) : undefined,
      icon: <MousePointerClick className="w-4 h-4" />,
      highlight: t
        ? t.ctr >= 2
          ? "good"
          : t.ctr >= 1.5
          ? "warn"
          : "danger"
        : "neutral",
    },
  ] as const;

  // Priority engine
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");
  const priorityCampaigns = activeCampaigns
    .map((c) => ({ ...c, _level: priorityLevel(c), _issues: priorityIssues(c) }))
    .filter((c) => c._level !== "ok")
    .sort((a, b) =>
      a._level === "danger" && b._level !== "danger"
        ? -1
        : b._level === "danger" && a._level !== "danger"
        ? 1
        : 0
    );

  // Sort campaigns
  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const av = (a[sortKey] as number) ?? 0;
    const bv = (b[sortKey] as number) ?? 0;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <Minus className="w-3 h-3 text-slate-600" />;
    return sortDir === "desc" ? (
      <ChevronDown className="w-3 h-3 text-blue-400" />
    ) : (
      <ChevronUp className="w-3 h-3 text-blue-400" />
    );
  }

  const chartData = (overview?.daily_breakdown ?? []).map((d) => ({
    date: d.date.slice(5),
    إنفاق: Math.round(safe(d.spend)),
    CPA: Math.round(safe(d.cpa)),
    ROAS: parseFloat(safe(d.roas).toFixed(2)),
  }));

  return (
    <div className="p-4 md:p-6 max-w-screen-2xl mx-auto space-y-6" dir="rtl">
      {/* ── KPI Grid ── */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => (
            <KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              change={k.change}
              changeLabel="عن الفترة السابقة"
              icon={k.icon}
              highlight={k.highlight as "good" | "warn" | "danger" | "neutral"}
              loading={ovLoading}
            />
          ))}
        </div>
      </section>

      {/* ── Priority Engine ── */}
      {priorityCampaigns.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-amber-300">
              محرك الأولويات — {priorityCampaigns.length} حملة تحتاج تدخل
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {priorityCampaigns.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className={cn(
                  "bg-slate-800/80 border rounded-xl p-4 space-y-2",
                  c._level === "danger"
                    ? "border-red-600/50"
                    : "border-amber-500/40"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-white leading-snug line-clamp-2 flex-1">
                    {c.name}
                  </p>
                  <span
                    className={cn(
                      "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full",
                      c._level === "danger"
                        ? "bg-red-900/60 text-red-300"
                        : "bg-amber-900/60 text-amber-300"
                    )}
                  >
                    {c._level === "danger" ? "خطر" : "تحذير"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c._issues.map((issue) => (
                    <span
                      key={issue}
                      className="text-[10px] bg-slate-700 text-slate-300 rounded px-1.5 py-0.5"
                    >
                      {issue}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-700">
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500">CPA</p>
                    <p className="text-xs font-bold text-white">
                      {fmt(c.cpa, 0)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500">CTR</p>
                    <p className="text-xs font-bold text-white">
                      {safe(c.ctr).toFixed(2)}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500">ROAS</p>
                    <p className="text-xs font-bold text-white">
                      {safe(c.roas).toFixed(2)}x
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Daily Trend Chart ── */}
      {chartData.length > 0 && (
        <section className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">الأداء اليومي</h2>
            <div className="flex gap-1">
              {(["spend", "cpa", "roas"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMetric(m)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-md transition-colors",
                    chartMetric === m
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:text-white hover:bg-slate-700"
                  )}
                >
                  {m === "spend" ? "الإنفاق" : m === "cpa" ? "CPA" : "ROAS"}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#f1f5f9",
                }}
              />
              <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey={
                  chartMetric === "spend"
                    ? "إنفاق"
                    : chartMetric === "cpa"
                    ? "CPA"
                    : "ROAS"
                }
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Campaign Table ── */}
      <section className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h2 className="text-sm font-bold text-white">
            الحملات ({campaigns.length})
          </h2>
          {cLoading && (
            <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                {[
                  { k: "name" as SortKey, label: "الحملة" },
                  { k: "status" as SortKey, label: "الحالة" },
                  { k: "spend" as SortKey, label: "الإنفاق" },
                  { k: "actions" as SortKey, label: "الطلبات" },
                  { k: "cpa" as SortKey, label: "CPA" },
                  { k: "roas" as SortKey, label: "ROAS" },
                  { k: "ctr" as SortKey, label: "CTR" },
                  { k: "cpm" as SortKey, label: "CPM" },
                  { k: "impressions" as SortKey, label: "الظهورات" },
                ].map(({ k, label }) => (
                  <th
                    key={k}
                    onClick={() => toggleSort(k)}
                    className="px-4 py-2.5 text-right font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1 justify-end">
                      {label}
                      <SortIcon k={k} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-700/50">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-slate-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!cLoading && sortedCampaigns.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    لا توجد بيانات للفترة المحددة
                  </td>
                </tr>
              )}
              {sortedCampaigns.map((c) => {
                const level = priorityLevel(c);
                return (
                  <tr
                    key={c.id}
                    className={cn(
                      "border-b border-slate-700/50 transition-colors hover:bg-slate-700/30",
                      level === "danger" && "bg-red-950/10",
                      level === "warn" && "bg-amber-950/10"
                    )}
                  >
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="font-medium text-white truncate" title={c.name}>
                        {c.name}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                          c.status === "ACTIVE"
                            ? "bg-emerald-900/60 text-emerald-400"
                            : "bg-slate-700 text-slate-400"
                        )}
                      >
                        {c.status === "ACTIVE" ? "نشط" : c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 whitespace-nowrap">
                      {fmt(c.spend, 0)} EGP
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200">
                      {fmt(c.actions)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-semibold whitespace-nowrap",
                        c.cpa > 100
                          ? "text-red-400"
                          : c.cpa > 40
                          ? "text-amber-400"
                          : "text-emerald-400"
                      )}
                    >
                      {fmt(c.cpa, 0)} EGP
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-semibold",
                        safe(c.roas) >= 5
                          ? "text-emerald-400"
                          : safe(c.roas) >= 2
                          ? "text-amber-400"
                          : "text-red-400"
                      )}
                    >
                      {safe(c.roas).toFixed(2)}x
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right",
                        safe(c.ctr) >= 2
                          ? "text-emerald-400"
                          : safe(c.ctr) >= 1.5
                          ? "text-amber-400"
                          : "text-red-400"
                      )}
                    >
                      {safe(c.ctr).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {fmt(c.cpm, 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {fmt(c.impressions)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <AIChatWidget />
    </div>
  );
}
