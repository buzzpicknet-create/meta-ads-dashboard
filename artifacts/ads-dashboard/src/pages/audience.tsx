import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDashboard } from "@/context/dashboard-context";
import { API } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { cn } from "@/lib/utils";
import { Users, Globe, ChevronDown, RefreshCw } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface Campaign {
  id: string;
  name: string;
}

interface Segment {
  key: string;
  spend: number;
  impressions: number;
  clicks: number;
  actions: number;
  ctr: number;
  cpa: number;
}

interface BreakdownData {
  by_age: Segment[];
  by_gender: Segment[];
  by_placement: Segment[];
}

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

const GENDER_MAP: Record<string, string> = {
  male: "ذكور",
  female: "إناث",
  unknown: "غير محدد",
};

function fmt(n: number, dec = 0) {
  return n.toLocaleString("ar-EG", { maximumFractionDigits: dec });
}

export default function Audience() {
  const { dateRange, selectedAccount } = useDashboard();
  const [selectedCampaign, setSelectedCampaign] = useState("");

  const accountId = selectedAccount;
  const accountParams = new URLSearchParams({
    ...(accountId ? { ad_account_id: accountId } : {}),
    since: dateRange.since,
    until: dateRange.until,
  });

  const { data: campaigns = [], isLoading: cLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns-list-aud", accountId, dateRange],
    queryFn: () =>
      fetch(`${API}/meta/campaigns?${accountParams}`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.campaigns ?? []),
    staleTime: 5 * 60_000,
  });

  const breakdownParams = new URLSearchParams({
    campaign_id: selectedCampaign,
    since: dateRange.since,
    until: dateRange.until,
  });

  const { data, isLoading } = useQuery<BreakdownData>({
    queryKey: ["breakdowns", selectedCampaign, dateRange],
    queryFn: () =>
      fetch(`${API}/meta/breakdowns?${breakdownParams}`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: !!selectedCampaign,
    staleTime: 30 * 60_000,
  });

  const ageData = (data?.by_age ?? [])
    .sort((a, b) => b.spend - a.spend)
    .map((s) => ({ age: s.key, إنفاق: Math.round(s.spend), طلبات: s.actions }));

  const genderData = (data?.by_gender ?? []).map((s) => ({
    name: GENDER_MAP[s.key] ?? s.key,
    value: Math.round(s.spend),
  }));

  const placementData = (data?.by_placement ?? [])
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8)
    .map((s) => ({
      name: s.key.length > 30 ? s.key.slice(0, 30) + "…" : s.key,
      إنفاق: Math.round(s.spend),
    }));

  return (
    <div className="p-4 md:p-6 max-w-screen-2xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-400" />
          الجمهور والمنصات
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          توزيع الإنفاق والأداء حسب الفئة العمرية والجنس والمنصة
        </p>
      </div>

      {/* Campaign Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400 shrink-0">اختر الحملة:</label>
        <div className="relative">
          <select
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-white px-3 py-2 pr-8 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[260px]"
          >
            <option value="">— اختر حملة —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        {isLoading && <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />}
      </div>

      {!selectedCampaign && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <Users className="w-14 h-14 text-slate-700" />
          <p className="text-slate-400 text-sm">اختر حملة لعرض بيانات الجمهور</p>
        </div>
      )}

      {selectedCampaign && isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 h-64 animate-pulse" />
          ))}
        </div>
      )}

      {selectedCampaign && !isLoading && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Age Chart */}
          {ageData.length > 0 && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
              <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                التوزيع العمري (حسب الإنفاق)
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ageData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="age" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9" }} />
                  <Bar dataKey="إنفاق" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Gender Pie */}
          {genderData.length > 0 && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
              <h2 className="text-sm font-bold text-white mb-4">توزيع الجنس</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={genderData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {genderData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9" }}
                    formatter={(v: number) => `${fmt(v, 0)} EGP`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Placement Chart */}
          {placementData.length > 0 && (
            <div className="lg:col-span-2 bg-slate-800/80 border border-slate-700 rounded-xl p-4">
              <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-purple-400" />
                توزيع المنصات والمواضع
              </h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={placementData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} width={140} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9" }} />
                  <Bar dataKey="إنفاق" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Gender Table */}
          {data.by_gender.length > 0 && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
              <h2 className="text-sm font-bold text-white mb-3">تفاصيل الجنس</h2>
              <div className="space-y-2">
                {data.by_gender.map((s) => {
                  const total = data.by_gender.reduce((a, x) => a + x.spend, 0);
                  const pct = total > 0 ? (s.spend / total) * 100 : 0;
                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      <div className="w-16 text-xs text-slate-400 text-right shrink-0">
                        {GENDER_MAP[s.key] ?? s.key}
                      </div>
                      <div className="flex-1 bg-slate-700 rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full rounded-full flex items-center justify-end px-2"
                          style={{ width: `${Math.max(pct, 5)}%`, background: "#3b82f6" }}
                        >
                          <span className="text-[10px] font-bold text-white">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="flex gap-3 shrink-0 text-xs">
                        <span className="text-slate-300">{fmt(s.spend, 0)} EGP</span>
                        <span className="text-slate-500">{fmt(s.actions)} طلب</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Age Details Table */}
          {data.by_age.length > 0 && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
              <h2 className="text-sm font-bold text-white mb-3">تفاصيل الأعمار</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="pb-2 text-right">الفئة</th>
                      <th className="pb-2 text-right">الإنفاق</th>
                      <th className="pb-2 text-right">الطلبات</th>
                      <th className="pb-2 text-right">CPA</th>
                      <th className="pb-2 text-right">CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_age.sort((a, b) => b.spend - a.spend).map((s) => (
                      <tr key={s.key} className="border-b border-slate-700/40">
                        <td className="py-2 font-medium text-white">{s.key}</td>
                        <td className="py-2 text-slate-300">{fmt(s.spend, 0)} EGP</td>
                        <td className="py-2 text-slate-300">{fmt(s.actions)}</td>
                        <td className={cn("py-2 font-semibold", s.cpa > 100 ? "text-red-400" : s.cpa > 40 ? "text-amber-400" : "text-emerald-400")}>
                          {s.cpa > 0 ? `${fmt(s.cpa, 0)} EGP` : "—"}
                        </td>
                        <td className={cn("py-2", s.ctr >= 2 ? "text-emerald-400" : s.ctr >= 1.5 ? "text-amber-400" : "text-red-400")}>
                          {s.ctr.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <AIChatWidget />
    </div>
  );
}
