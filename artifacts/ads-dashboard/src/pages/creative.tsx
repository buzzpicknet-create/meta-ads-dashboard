import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDashboard } from "@/context/dashboard-context";
import { API } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { cn } from "@/lib/utils";
import {
  Video,
  Eye,
  MousePointerClick,
  TrendingUp,
  ChevronDown,
  RefreshCw,
  BarChart3,
  Zap,
  PlayCircle,
} from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface AdInsight {
  ad_id: string;
  ad_name: string;
  adset_name?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  actions: number;
  cpa: number;
  roas: number;
  video_play_actions?: number;
  video_thruplay_watched_actions?: number;
  video_avg_time_watched_actions?: number;
  hook_rate?: number;
  view_rate?: number;
  thruplay_rate?: number;
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString("ar-EG", { maximumFractionDigits: dec });
}

function CreativeScore(r: number, t: number, ctr: number) {
  const score = r * 0.35 + t * 0.35 + (ctr / 3) * 0.3;
  if (score >= 70) return { label: "رابح 🏆", color: "text-emerald-400", bg: "bg-emerald-900/30 border-emerald-600/40" };
  if (score >= 45) return { label: "متوسط ⚠️", color: "text-amber-400", bg: "bg-amber-900/30 border-amber-600/40" };
  return { label: "ضعيف ❌", color: "text-red-400", bg: "bg-red-900/30 border-red-600/40" };
}

export default function Creative() {
  const { dateRange, selectedAccount } = useDashboard();
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const accountId = selectedAccount;
  const params = new URLSearchParams({
    ...(accountId ? { ad_account_id: accountId } : {}),
    since: dateRange.since,
    until: dateRange.until,
  });

  const { data: campaigns = [], isLoading: cLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns-list", accountId, dateRange],
    queryFn: () =>
      fetch(`${API}/meta/campaigns?${params}`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.campaigns ?? []),
    staleTime: 5 * 60_000,
  });

  const insightParams = new URLSearchParams({
    campaign_id: selectedCampaign,
    since: dateRange.since,
    until: dateRange.until,
  });

  const { data: insights = [], isLoading: iLoading } = useQuery<AdInsight[]>({
    queryKey: ["ad-insights", selectedCampaign, dateRange],
    queryFn: () =>
      fetch(`${API}/meta/insights?${insightParams}`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          const ads = d.ads ?? d ?? [];
          return ads.map((a: AdInsight) => ({
            ...a,
            hook_rate: a.video_play_actions && a.impressions
              ? (a.video_play_actions / a.impressions) * 100
              : undefined,
            thruplay_rate: a.video_thruplay_watched_actions && a.video_play_actions
              ? (a.video_thruplay_watched_actions / a.video_play_actions) * 100
              : undefined,
          }));
        }),
    staleTime: 2 * 60_000,
    enabled: !!selectedCampaign,
  });

  const sorted = [...insights].sort((a, b) => b.roas - a.roas);

  return (
    <div className="p-4 md:p-6 max-w-screen-2xl mx-auto space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-blue-400" />
            مركز الكريتف
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            تحليل أداء الإعلانات على مستوى الكريتف
          </p>
        </div>
        <div className="flex items-center gap-2 mr-auto">
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={cn("p-1.5 rounded", viewMode === "grid" ? "bg-blue-600" : "text-slate-400")}
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn("p-1.5 rounded", viewMode === "table" ? "bg-blue-600" : "text-slate-400")}
            >
              <Video className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Campaign Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400 shrink-0">اختر الحملة:</label>
        <div className="relative">
          <select
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-white px-3 py-2 pr-8 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[240px]"
          >
            <option value="">— اختر حملة —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        {iLoading && <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />}
      </div>

      {!selectedCampaign && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <PlayCircle className="w-14 h-14 text-slate-700" />
          <p className="text-slate-400 text-sm">اختر حملة من القائمة أعلاه لتحليل الكريتف</p>
        </div>
      )}

      {selectedCampaign && !iLoading && sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <BarChart3 className="w-14 h-14 text-slate-700" />
          <p className="text-slate-400 text-sm">لا توجد بيانات كريتف لهذه الحملة</p>
        </div>
      )}

      {/* Creative Cards (Grid Mode) */}
      {viewMode === "grid" && sorted.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sorted.map((ad) => {
            const hook = ad.hook_rate ?? 0;
            const thru = ad.thruplay_rate ?? 0;
            const score = CreativeScore(hook, thru, ad.ctr);
            return (
              <div
                key={ad.ad_id}
                className={cn(
                  "bg-slate-800/80 border rounded-xl p-4 space-y-3",
                  score.bg
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-white leading-snug line-clamp-2 flex-1">
                    {ad.ad_name}
                  </p>
                  <span className={cn("text-[10px] font-bold shrink-0", score.color)}>
                    {score.label}
                  </span>
                </div>
                {ad.adset_name && (
                  <p className="text-[10px] text-slate-500 truncate">{ad.adset_name}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1">
                      <Zap className="w-2.5 h-2.5" /> Hook Rate
                    </p>
                    <p className={cn("text-sm font-bold", hook >= 25 ? "text-emerald-400" : hook >= 15 ? "text-amber-400" : "text-red-400")}>
                      {ad.hook_rate ? `${ad.hook_rate.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1">
                      <Eye className="w-2.5 h-2.5" /> ThruPlay
                    </p>
                    <p className={cn("text-sm font-bold", thru >= 20 ? "text-emerald-400" : thru >= 10 ? "text-amber-400" : "text-red-400")}>
                      {ad.thruplay_rate ? `${ad.thruplay_rate.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1">
                      <MousePointerClick className="w-2.5 h-2.5" /> CTR
                    </p>
                    <p className={cn("text-sm font-bold", (ad.ctr ?? 0) >= 2 ? "text-emerald-400" : (ad.ctr ?? 0) >= 1.5 ? "text-amber-400" : "text-red-400")}>
                      {(ad.ctr ?? 0).toFixed(2)}%
                    </p>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1">
                      <TrendingUp className="w-2.5 h-2.5" /> ROAS
                    </p>
                    <p className={cn("text-sm font-bold", (ad.roas ?? 0) >= 5 ? "text-emerald-400" : (ad.roas ?? 0) >= 2 ? "text-amber-400" : "text-red-400")}>
                      {(ad.roas ?? 0).toFixed(2)}x
                    </p>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-700 text-[10px] text-slate-400">
                  <span>{fmt(ad.spend, 0)} EGP</span>
                  <span>{fmt(ad.actions)} طلب</span>
                  <span>CPA: {fmt(ad.cpa, 0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table Mode */}
      {viewMode === "table" && sorted.length > 0 && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="px-4 py-2.5 text-right font-medium">الإعلان</th>
                  <th className="px-4 py-2.5 text-right font-medium">الإنفاق</th>
                  <th className="px-4 py-2.5 text-right font-medium">Hook Rate</th>
                  <th className="px-4 py-2.5 text-right font-medium">ThruPlay</th>
                  <th className="px-4 py-2.5 text-right font-medium">CTR</th>
                  <th className="px-4 py-2.5 text-right font-medium">ROAS</th>
                  <th className="px-4 py-2.5 text-right font-medium">CPA</th>
                  <th className="px-4 py-2.5 text-right font-medium">الطلبات</th>
                  <th className="px-4 py-2.5 text-right font-medium">التقييم</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((ad) => {
                  const hook = ad.hook_rate ?? 0;
                  const thru = ad.thruplay_rate ?? 0;
                  const score = CreativeScore(hook, thru, ad.ctr);
                  return (
                    <tr key={ad.ad_id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="px-4 py-3 max-w-[200px]">
                        <p className="text-white font-medium truncate" title={ad.ad_name}>{ad.ad_name}</p>
                        {ad.adset_name && <p className="text-slate-500 text-[10px] truncate">{ad.adset_name}</p>}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200">{fmt(ad.spend, 0)} EGP</td>
                      <td className={cn("px-4 py-3 text-right font-semibold", hook >= 25 ? "text-emerald-400" : hook >= 15 ? "text-amber-400" : "text-red-400")}>
                        {ad.hook_rate ? `${ad.hook_rate.toFixed(1)}%` : "—"}
                      </td>
                      <td className={cn("px-4 py-3 text-right font-semibold", thru >= 20 ? "text-emerald-400" : thru >= 10 ? "text-amber-400" : "text-red-400")}>
                        {ad.thruplay_rate ? `${ad.thruplay_rate.toFixed(1)}%` : "—"}
                      </td>
                      <td className={cn("px-4 py-3 text-right", (ad.ctr ?? 0) >= 2 ? "text-emerald-400" : (ad.ctr ?? 0) >= 1.5 ? "text-amber-400" : "text-red-400")}>
                        {(ad.ctr ?? 0).toFixed(2)}%
                      </td>
                      <td className={cn("px-4 py-3 text-right font-semibold", (ad.roas ?? 0) >= 5 ? "text-emerald-400" : (ad.roas ?? 0) >= 2 ? "text-amber-400" : "text-red-400")}>
                        {(ad.roas ?? 0).toFixed(2)}x
                      </td>
                      <td className={cn("px-4 py-3 text-right font-semibold", ad.cpa > 100 ? "text-red-400" : ad.cpa > 40 ? "text-amber-400" : "text-emerald-400")}>
                        {fmt(ad.cpa, 0)} EGP
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200">{fmt(ad.actions)}</td>
                      <td className={cn("px-4 py-3 text-right text-[11px] font-bold", score.color)}>{score.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AIChatWidget />
    </div>
  );
}
