import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Trophy, ChevronDown, ChevronUp, Zap, BarChart2,
  FileText, Type, Film, CalendarDays, RefreshCw, Layers,
} from "lucide-react";
import { useAccounts } from "@/hooks/use-meta";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface AdCreativeRow {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  status: string;
  effective_status: string;
  primary_text: string | null;
  headline: string | null;
  media_type: "video" | "image" | "unknown";
  media_id: string | null;
  spend: number;
  purchases: number;
  cpa: number;
  ctr: number;
  cr: number;
  cpc: number;
  impressions: number;
  link_clicks: number;
}

interface CreativeResponse {
  account_id: string;
  period: { since: string; until: string };
  fetched_at: string;
  ads: AdCreativeRow[];
}

interface CampaignOption {
  campaign_id: string;
  campaign_name: string;
  totalSpend: number;
  totalOrders: number;
  avgCpa: number;
  totalAds: number;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function cairoToday(): string {
  return new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
}
function cairoOffset(n: number): string {
  return new Date(Date.now() + 2 * 3600000 - n * 86400000).toISOString().slice(0, 10);
}

type PresetKey = "7d" | "14d" | "30d" | "custom";
interface DateRange { since: string; until: string }

function presetToRange(p: PresetKey, custom: DateRange): DateRange {
  if (p === "custom") return custom;
  const days = p === "7d" ? 6 : p === "14d" ? 13 : 29;
  return { since: cairoOffset(days), until: cairoToday() };
}

// ── Tier helpers ──────────────────────────────────────────────────────────────
type Tier = "winner" | "ok" | "danger" | "no-data";

function getTier(cpa: number, purchases: number): Tier {
  if (purchases === 0) return "no-data";
  if (cpa <= 45) return "winner";
  if (cpa <= 55) return "ok";
  return "danger";
}

const TIER_CFG: Record<Tier, { label: string; bg: string; border: string; badgeBg: string; badgeText: string }> = {
  winner:    { label: "فائز",          bg: "bg-emerald-500/8",  border: "border-emerald-400/30", badgeBg: "bg-emerald-100 dark:bg-emerald-900/40", badgeText: "text-emerald-700 dark:text-emerald-300" },
  ok:        { label: "مقبول",         bg: "bg-amber-500/6",    border: "border-amber-400/25",   badgeBg: "bg-amber-100 dark:bg-amber-900/40",    badgeText: "text-amber-700 dark:text-amber-300" },
  danger:    { label: "يحتاج تحسين",  bg: "bg-rose-500/6",     border: "border-rose-400/25",    badgeBg: "bg-rose-100 dark:bg-rose-900/40",      badgeText: "text-rose-700 dark:text-rose-300" },
  "no-data": { label: "بيانات قليلة", bg: "bg-muted/20",       border: "border-border/40",      badgeBg: "bg-muted",                             badgeText: "text-muted-foreground" },
};

// ── Component analysis ────────────────────────────────────────────────────────
type CompKey = "primary_text" | "headline" | "media_id";

interface CompGroup {
  key: string; label: string; avgCpa: number; totalOrders: number;
}

function groupByComponent(ads: AdCreativeRow[], field: CompKey, minSpend: number): CompGroup[] {
  const map = new Map<string, { label: string; cpaSum: number; count: number; orders: number }>();
  ads.filter(a => a.spend >= minSpend && a.purchases > 0).forEach(ad => {
    const rawKey = ad[field] ?? "(none)";
    const key = String(rawKey).slice(0, 80);
    const label = field === "media_id"
      ? `${ad.media_type === "video" ? "🎬" : "🖼️"} ${key.slice(0, 22)}`
      : key.length > 50 ? key.slice(0, 47) + "…" : key;
    if (!map.has(key)) map.set(key, { label, cpaSum: 0, count: 0, orders: 0 });
    const g = map.get(key)!;
    g.cpaSum += ad.cpa; g.count++; g.orders += ad.purchases;
  });
  return [...map.entries()].map(([k, v]) => ({
    key: k, label: v.label, avgCpa: v.cpaSum / v.count, totalOrders: v.orders,
  })).sort((a, b) => a.avgCpa - b.avgCpa).slice(0, 6);
}

// ── CompBar ───────────────────────────────────────────────────────────────────
function CompBar({ title, groups, icon: Icon }: { title: string; groups: CompGroup[]; icon: React.ElementType }) {
  const maxOrders = Math.max(...groups.map(g => g.totalOrders), 1);
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold">{title}</span>
        {groups[0] && (
          <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold px-1.5 py-0.5 rounded-full mr-auto whitespace-nowrap">
            أفضل: {groups[0].avgCpa.toFixed(0)} EGP
          </span>
        )}
      </div>
      {groups.length === 0 && <p className="text-xs text-muted-foreground">لا بيانات كافية</p>}
      <div className="space-y-2.5">
        {groups.map((g, idx) => (
          <div key={g.key}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className={`text-[11px] font-semibold leading-tight ${idx === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`} title={g.key}>{g.label}</span>
              <div className="flex items-center gap-2 text-[11px] shrink-0">
                <span className={`font-black ${idx === 0 ? "text-emerald-600" : ""}`}>{g.avgCpa.toFixed(0)} EGP</span>
                <span className="text-muted-foreground">{g.totalOrders} طلب</span>
              </div>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${idx === 0 ? "bg-emerald-500" : "bg-primary/30"}`}
                style={{ width: `${(g.totalOrders / maxOrders) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Pill ──────────────────────────────────────────────────────────────────────
function Pill({ v, good }: { v: string; good?: boolean | null }) {
  return (
    <span className={`tabular-nums font-bold text-[12px] ${
      good === true ? "text-emerald-600" : good === false ? "text-rose-500" : "text-foreground"
    }`}>{v}</span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CreativePage() {
  const accounts = useAccounts();
  const [accountId, setAccountId]           = useState<string>("");
  const [preset, setPreset]                 = useState<PresetKey>("7d");
  const [custom, setCustom]                 = useState<DateRange>({ since: cairoOffset(29), until: cairoToday() });
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [minSpend, setMinSpend]             = useState(50);
  const [sortBy, setSortBy]                 = useState<"cpa" | "orders" | "spend">("cpa");
  const [expanded, setExpanded]             = useState<string | null>(null);

  useEffect(() => {
    if (!accountId && accounts.data?.accounts?.length) {
      setAccountId(accounts.data.accounts[0]?.id ?? "");
    }
  }, [accounts.data, accountId]);

  const range = presetToRange(preset, custom);

  const query = useQuery({
    queryKey: ["creative-intelligence", accountId, range.since, range.until],
    queryFn: async (): Promise<CreativeResponse> => {
      const res = await fetch(
        `${BASE}/api/meta/creative-intelligence?ad_account_id=${accountId}&since=${range.since}&until=${range.until}`
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<CreativeResponse>;
    },
    enabled: !!accountId && !!range.since && !!range.until,
    staleTime: 10 * 60_000,
  });

  const allAds = query.data?.ads ?? [];

  // Build campaign list sorted by spend desc
  const campaignOptions: CampaignOption[] = useMemo(() => {
    const map = new Map<string, CampaignOption>();
    for (const ad of allAds) {
      if (!map.has(ad.campaign_id)) {
        map.set(ad.campaign_id, {
          campaign_id: ad.campaign_id,
          campaign_name: ad.campaign_name,
          totalSpend: 0, totalOrders: 0, avgCpa: 0, totalAds: 0,
        });
      }
      const c = map.get(ad.campaign_id)!;
      c.totalSpend  += ad.spend;
      c.totalOrders += ad.purchases;
      c.totalAds++;
    }
    return [...map.values()]
      .map(c => ({ ...c, avgCpa: c.totalOrders > 0 ? c.totalSpend / c.totalOrders : 0 }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }, [allAds]);

  // Auto-select first campaign when data arrives
  useEffect(() => {
    if (campaignOptions.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(campaignOptions[0].campaign_id);
    }
  }, [campaignOptions, selectedCampaignId]);

  // Reset campaign selection when account changes
  useEffect(() => { setSelectedCampaignId(""); setExpanded(null); }, [accountId]);

  // Ads for selected campaign
  const campaignAds = useMemo(() =>
    selectedCampaignId ? allAds.filter(a => a.campaign_id === selectedCampaignId) : [],
  [allAds, selectedCampaignId]);

  const displayAds = useMemo(() => {
    return campaignAds.filter(a => a.spend >= minSpend).sort((a, b) => {
      if (sortBy === "cpa") {
        if (a.purchases === 0 && b.purchases === 0) return b.spend - a.spend;
        if (a.purchases === 0) return 1;
        if (b.purchases === 0) return -1;
        return a.cpa - b.cpa;
      }
      if (sortBy === "orders") return b.purchases - a.purchases;
      return b.spend - a.spend;
    });
  }, [campaignAds, minSpend, sortBy]);

  const ptGroups       = useMemo(() => groupByComponent(campaignAds, "primary_text", minSpend), [campaignAds, minSpend]);
  const headlineGroups = useMemo(() => groupByComponent(campaignAds, "headline",     minSpend), [campaignAds, minSpend]);
  const mediaGroups    = useMemo(() => groupByComponent(campaignAds, "media_id",     minSpend), [campaignAds, minSpend]);

  const topWinner   = displayAds.find(a => getTier(a.cpa, a.purchases) === "winner");
  const winnerCount = displayAds.filter(a => getTier(a.cpa, a.purchases) === "winner").length;
  const okCount     = displayAds.filter(a => getTier(a.cpa, a.purchases) === "ok").length;
  const dangerCount = displayAds.filter(a => getTier(a.cpa, a.purchases) === "danger").length;

  const selectedCampaignInfo = campaignOptions.find(c => c.campaign_id === selectedCampaignId);

  const PRESETS: { key: PresetKey; label: string }[] = [
    { key: "7d",  label: "٧ أيام" },
    { key: "14d", label: "١٤ يوم" },
    { key: "30d", label: "٣٠ يوم" },
    { key: "custom", label: "مخصص" },
  ];

  return (
    <div dir="rtl" className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 space-y-5 pb-24 sm:pb-8">

      {/* ── Header ── */}
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">أداء الكريتف</p>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          مركز الكريتف
        </h1>
      </div>

      {/* ── Controls bar ── */}
      <div className="bg-card border border-border rounded-2xl p-3 flex flex-wrap items-center gap-2">

        {/* Account */}
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider px-1">الحساب</label>
          <select value={accountId}
            onChange={e => { setAccountId(e.target.value); setSelectedCampaignId(""); setExpanded(null); }}
            className="text-xs border border-border rounded-xl px-3 py-2 bg-muted/40 font-medium min-w-[150px]">
            {accounts.data?.accounts?.map(a => (
              <option key={a.id} value={a.id}>{a.name ?? a.id}</option>
            ))}
          </select>
        </div>

        {/* Campaign — the main selector */}
        <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
          <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider px-1 flex items-center gap-1">
            <Layers className="h-3 w-3" /> الحملة الإعلانية
          </label>
          <select
            value={selectedCampaignId}
            onChange={e => { setSelectedCampaignId(e.target.value); setExpanded(null); }}
            disabled={!query.isSuccess || campaignOptions.length === 0}
            className="text-xs border border-primary/40 rounded-xl px-3 py-2 bg-primary/5 font-bold w-full disabled:opacity-50"
          >
            {query.isLoading && <option value="">جاري التحميل…</option>}
            {query.isSuccess && campaignOptions.length === 0 && <option value="">لا توجد حملات</option>}
            {campaignOptions.map(c => (
              <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>
            ))}
          </select>
        </div>

        {/* Date presets */}
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider px-1 flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> الفترة
          </label>
          <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1">
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => setPreset(p.key)}
                className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-colors ${
                  preset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>{p.label}</button>
            ))}
          </div>
        </div>

        {/* Custom date */}
        {preset === "custom" && (
          <div className="flex items-center gap-1 text-xs self-end pb-1">
            <input type="date" value={custom.since} max={custom.until}
              onChange={e => setCustom(p => ({ ...p, since: e.target.value }))}
              className="border border-border rounded-lg px-2 py-1.5 bg-card text-xs" />
            <span className="text-muted-foreground">←</span>
            <input type="date" value={custom.until} min={custom.since}
              onChange={e => setCustom(p => ({ ...p, until: e.target.value }))}
              className="border border-border rounded-lg px-2 py-1.5 bg-card text-xs" />
          </div>
        )}

        {/* Refresh */}
        <button onClick={() => query.refetch()} disabled={query.isFetching}
          className="p-2 rounded-xl border border-border bg-muted/40 hover:bg-muted transition-colors self-end mb-0.5">
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin text-primary" : "text-muted-foreground"}`} />
        </button>
      </div>

      {/* Date range label */}
      <p className="text-[11px] text-muted-foreground -mt-3">{range.since} → {range.until}</p>

      {/* ── Loading ── */}
      {query.isLoading && (
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      )}

      {/* ── Error ── */}
      {query.isError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/8 p-4 text-rose-600 text-sm">
          {String(query.error instanceof Error ? query.error.message : query.error)}
        </div>
      )}

      {/* ── No campaign selected ── */}
      {query.isSuccess && !selectedCampaignId && (
        <div className="text-center py-12 text-muted-foreground">
          <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">اختار الحملة الإعلانية من القائمة بالأعلى</p>
        </div>
      )}

      {/* ── Leaderboard ── */}
      {query.isSuccess && selectedCampaignId && (
        <>
          {/* Campaign summary strip */}
          {selectedCampaignInfo && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">الحملة المختارة</p>
                <p className="text-sm font-black truncate">{selectedCampaignInfo.campaign_name}</p>
              </div>
              <div className="flex gap-5 text-center">
                <div>
                  <p className={`text-lg font-black ${
                    selectedCampaignInfo.totalOrders === 0 ? "text-muted-foreground" :
                    selectedCampaignInfo.avgCpa <= 45 ? "text-emerald-600" :
                    selectedCampaignInfo.avgCpa <= 55 ? "text-amber-600" : "text-rose-500"
                  }`}>{selectedCampaignInfo.totalOrders === 0 ? "—" : `${selectedCampaignInfo.avgCpa.toFixed(0)} EGP`}</p>
                  <p className="text-[9px] text-muted-foreground">متوسط CPA</p>
                </div>
                <div>
                  <p className="text-lg font-black">{selectedCampaignInfo.totalOrders}</p>
                  <p className="text-[9px] text-muted-foreground">طلبات</p>
                </div>
                <div>
                  <p className="text-lg font-black">{selectedCampaignInfo.totalSpend.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground">SPEND EGP</p>
                </div>
                <div>
                  <p className="text-lg font-black">{selectedCampaignInfo.totalAds}</p>
                  <p className="text-[9px] text-muted-foreground">إعلان</p>
                </div>
              </div>
            </div>
          )}

          {/* Winner strip */}
          {topWinner && (
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/8 p-4 flex items-center gap-3">
              <Trophy className="h-9 w-9 text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-emerald-600 font-black uppercase tracking-widest">أفضل كريتف في الحملة</p>
                <p className="text-sm font-black truncate">{topWinner.ad_name}</p>
                {topWinner.primary_text && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
                    {topWinner.primary_text.slice(0, 90)}{topWinner.primary_text.length > 90 ? "…" : ""}
                  </p>
                )}
              </div>
              <div className="flex gap-4 shrink-0 text-center">
                <div>
                  <p className="text-xl font-black text-emerald-600">{topWinner.cpa.toFixed(0)}</p>
                  <p className="text-[9px] text-muted-foreground">EGP CPA</p>
                </div>
                <div>
                  <p className="text-xl font-black">{topWinner.purchases}</p>
                  <p className="text-[9px] text-muted-foreground">طلبات</p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-xl font-black">{topWinner.ctr.toFixed(1)}%</p>
                  <p className="text-[9px] text-muted-foreground">CTR</p>
                </div>
              </div>
            </div>
          )}

          {/* Ad-level filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {winnerCount} فائز
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block mr-2" /> {okCount} مقبول
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block mr-2" /> {dangerCount} يحتاج تحسين
            </div>
            <div className="flex items-center gap-2 mr-auto flex-wrap">
              <label className="text-xs text-muted-foreground">إنفاق أدنى</label>
              <select value={minSpend} onChange={e => setMinSpend(+e.target.value)}
                className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card">
                <option value={0}>الكل</option>
                <option value={50}>50 EGP+</option>
                <option value={200}>200 EGP+</option>
                <option value={500}>500 EGP+</option>
              </select>
              <label className="text-xs text-muted-foreground">ترتيب</label>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card">
                <option value="cpa">CPA</option>
                <option value="orders">طلبات</option>
                <option value="spend">إنفاق</option>
              </select>
            </div>
          </div>

          {/* Ad rows */}
          <div className="space-y-2">
            {displayAds.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">لا توجد إعلانات تستوفي الفلتر</p>
            )}
            {displayAds.map((ad, idx) => {
              const tier = getTier(ad.cpa, ad.purchases);
              const cfg  = TIER_CFG[tier];
              const isOpen = expanded === ad.ad_id;
              return (
                <div key={ad.ad_id} className={`rounded-xl border transition-all ${cfg.bg} ${cfg.border}`}>
                  <button className="w-full flex items-center gap-3 p-3 text-right"
                    onClick={() => setExpanded(isOpen ? null : ad.ad_id)}>
                    {/* Rank */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-black ${
                      idx === 0 ? "bg-emerald-500 text-white" :
                      idx === 1 ? "bg-emerald-300/40 text-emerald-800 dark:text-emerald-300" :
                      idx === 2 ? "bg-amber-300/40 text-amber-800 dark:text-amber-300" :
                      "bg-muted text-muted-foreground"
                    }`}>{idx + 1}</div>

                    <div className="flex-1 min-w-0 text-right">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold">{ad.ad_name}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badgeBg} ${cfg.badgeText}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{ad.adset_name}</p>
                    </div>

                    <div className="flex gap-4 shrink-0">
                      <div className="text-center">
                        <Pill v={ad.purchases === 0 ? "—" : `${ad.cpa.toFixed(0)} EGP`}
                          good={ad.purchases === 0 ? null : ad.cpa <= 45 ? true : ad.cpa <= 55 ? null : false} />
                        <p className="text-[9px] text-muted-foreground">CPA</p>
                      </div>
                      <div className="text-center">
                        <Pill v={String(ad.purchases)} />
                        <p className="text-[9px] text-muted-foreground">طلبات</p>
                      </div>
                      <div className="text-center hidden sm:block">
                        <Pill v={`${ad.ctr.toFixed(1)}%`} good={ad.ctr >= 3 ? true : ad.ctr >= 2 ? null : false} />
                        <p className="text-[9px] text-muted-foreground">CTR</p>
                      </div>
                      <div className="text-center hidden sm:block">
                        <Pill v={`${ad.cr.toFixed(1)}%`} good={ad.cr >= 5 ? true : ad.cr >= 3 ? null : false} />
                        <p className="text-[9px] text-muted-foreground">CR</p>
                      </div>
                      <div className="text-center hidden md:block">
                        <Pill v={ad.spend.toLocaleString()} />
                        <p className="text-[9px] text-muted-foreground">SPEND</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-muted-foreground">
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  {/* Creative breakdown */}
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-border/40 space-y-3">
                      <p className="text-[10px] text-muted-foreground font-black uppercase tracking-wider">مكونات الإعلان</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="bg-background/70 rounded-lg border border-border p-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <FileText className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Primary Text</span>
                          </div>
                          {ad.primary_text
                            ? <p className="text-[11px] leading-relaxed line-clamp-5">{ad.primary_text}</p>
                            : <p className="text-[11px] text-muted-foreground italic">غير متوفر</p>}
                        </div>
                        <div className="bg-background/70 rounded-lg border border-border p-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Type className="h-3.5 w-3.5 text-violet-500" />
                            <span className="text-[10px] font-black text-violet-500 uppercase tracking-widest">Headline</span>
                          </div>
                          {ad.headline
                            ? <p className="text-[12px] font-bold">{ad.headline}</p>
                            : <p className="text-[11px] text-muted-foreground italic">غير متوفر</p>}
                        </div>
                        <div className="bg-background/70 rounded-lg border border-border p-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Film className="h-3.5 w-3.5 text-amber-500" />
                            <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                              {ad.media_type === "video" ? "Video" : ad.media_type === "image" ? "Image" : "Media"}
                            </span>
                          </div>
                          <p className="text-[11px] font-mono break-all text-muted-foreground">{ad.media_id ?? "—"}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {ad.effective_status === "ACTIVE" ? "🟢 نشط" : ad.effective_status === "PAUSED" ? "⏸ موقوف" : ad.effective_status}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-5 text-center pt-1">
                        {[
                          { label: "Impressions", v: ad.impressions.toLocaleString() },
                          { label: "Link Clicks",  v: ad.link_clicks.toLocaleString() },
                          { label: "CPC",          v: `${ad.cpc.toFixed(2)} EGP` },
                          { label: "SPEND",        v: `${ad.spend.toLocaleString()} EGP` },
                        ].map(m => (
                          <div key={m.label}>
                            <p className="text-[12px] font-bold">{m.v}</p>
                            <p className="text-[9px] text-muted-foreground uppercase">{m.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Component analysis */}
          {(ptGroups.length > 0 || headlineGroups.length > 0 || mediaGroups.length > 0) && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="h-5 w-5 text-primary" />
                <h2 className="text-base font-black">تحليل المكونات</h2>
                <span className="text-xs text-muted-foreground">أيهم بيجيب أفضل CPA في الحملة دي؟</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <CompBar title="Primary Text" groups={ptGroups}       icon={FileText} />
                <CompBar title="Headline"     groups={headlineGroups} icon={Type} />
                <CompBar title="Media"        groups={mediaGroups}    icon={Film} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
