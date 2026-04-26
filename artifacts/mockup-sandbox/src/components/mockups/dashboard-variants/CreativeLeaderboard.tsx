import { useState } from "react";
import { TrendingDown, TrendingUp, Trophy, AlertTriangle, CheckCircle2, Filter, Star, Zap } from "lucide-react";

const MOCK_ADS = [
  { id: "1", name: "فيديو A — إيموشن + عرض", campaign: "رمضان 2026 — Broad", spend: 1050, orders: 26, cpa: 40.4, ctr: 3.38, cr: 6.37, cpc: 2.1 },
  { id: "2", name: "فيديو B — UGC طبيعي", campaign: "رمضان 2026 — Retarget", spend: 850, orders: 24, cpa: 35.4, ctr: 3.90, cr: 5.80, cpc: 1.9 },
  { id: "3", name: "فيديو C — كريتف جديد", campaign: "Product Launch", spend: 620, orders: 13, cpa: 47.7, ctr: 2.40, cr: 4.10, cpc: 2.8 },
  { id: "4", name: "فيديو D — سرد قصة", campaign: "Product Launch", spend: 520, orders: 9, cpa: 57.8, ctr: 1.90, cr: 3.20, cpc: 3.3 },
  { id: "5", name: "فيديو E — مقارنة منافس", campaign: "رمضان 2026 — Broad", spend: 420, orders: 7, cpa: 60.0, ctr: 1.75, cr: 2.90, cpc: 3.7 },
  { id: "6", name: "فيديو F — تستيمونيال", campaign: "Awareness — Top", spend: 93, orders: 1, cpa: 93.0, ctr: 2.42, cr: 5.56, cpc: 4.0 },
  { id: "7", name: "فيديو G — Static Image", campaign: "Awareness — Top", spend: 22, orders: 0, cpa: 0, ctr: 1.11, cr: 0, cpc: 7.0 },
];

const TIER = (cpa: number, orders: number) => {
  if (orders === 0) return "no-data";
  if (cpa <= 45) return "winner";
  if (cpa <= 55) return "ok";
  return "danger";
};

const TIER_CONFIG = {
  winner: { label: "فائز", icon: Trophy, bg: "bg-emerald-500/10", border: "border-emerald-400/30", text: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700" },
  ok:     { label: "مقبول", icon: CheckCircle2, bg: "bg-amber-500/8", border: "border-amber-400/25", text: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
  danger: { label: "يحتاج تحسين", icon: AlertTriangle, bg: "bg-rose-500/8", border: "border-rose-400/25", text: "text-rose-600", badge: "bg-rose-100 text-rose-700" },
  "no-data": { label: "بيانات غير كافية", icon: Filter, bg: "bg-muted/30", border: "border-border/40", text: "text-muted-foreground", badge: "bg-muted text-muted-foreground" },
};

function MetricPill({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-[11px] font-bold tabular-nums ${good === true ? "text-emerald-600" : good === false ? "text-rose-500" : "text-foreground"}`}>{value}</span>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

export function CreativeLeaderboard() {
  const [minSpend, setMinSpend] = useState(50);
  const [sortBy, setSortBy] = useState<"cpa" | "spend" | "orders">("cpa");

  const validAds = MOCK_ADS.filter(a => a.spend >= minSpend);
  const sorted = [...validAds].sort((a, b) => {
    if (sortBy === "cpa") {
      if (a.orders === 0 && b.orders === 0) return 0;
      if (a.orders === 0) return 1;
      if (b.orders === 0) return -1;
      return a.cpa - b.cpa;
    }
    if (sortBy === "spend") return b.spend - a.spend;
    return b.orders - a.orders;
  });

  const winners = sorted.filter(a => TIER(a.cpa, a.orders) === "winner");
  const topWinner = winners[0];

  return (
    <div dir="rtl" className="min-h-screen bg-background p-6 font-sans" style={{ fontFamily: "'Cairo', 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            مركز الكريتف
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">أداء الكريتف عبر كل الحملات — مرتّب بالـ CPA</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">إنفاق أدنى</label>
          <select
            value={minSpend}
            onChange={e => setMinSpend(+e.target.value)}
            className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-card text-foreground"
          >
            <option value={0}>الكل</option>
            <option value={50}>50 EGP+</option>
            <option value={200}>200 EGP+</option>
            <option value={500}>500 EGP+</option>
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-card text-foreground"
          >
            <option value="cpa">ترتيب: CPA</option>
            <option value="orders">ترتيب: طلبات</option>
            <option value="spend">ترتيب: إنفاق</option>
          </select>
        </div>
      </div>

      {/* Top winner highlight */}
      {topWinner && (
        <div className="rounded-2xl border border-emerald-400/40 bg-gradient-to-l from-emerald-500/10 to-transparent p-4 mb-5 flex items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <Trophy className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest mb-0.5">أفضل كريتف الآن</p>
            <p className="text-sm font-black text-foreground truncate">{topWinner.name}</p>
            <p className="text-[11px] text-muted-foreground">{topWinner.campaign}</p>
          </div>
          <div className="flex gap-5 shrink-0">
            <div className="text-center">
              <p className="text-xl font-black text-emerald-600">{topWinner.cpa.toFixed(0)}</p>
              <p className="text-[9px] text-muted-foreground">EGP CPA</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-foreground">{topWinner.orders}</p>
              <p className="text-[9px] text-muted-foreground">طلبات</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-foreground">{topWinner.ctr.toFixed(1)}%</p>
              <p className="text-[9px] text-muted-foreground">CTR</p>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard rows */}
      <div className="space-y-2">
        {sorted.map((ad, idx) => {
          const tier = TIER(ad.cpa, ad.orders);
          const cfg = TIER_CONFIG[tier];
          const Icon = cfg.icon;
          const isTop = idx === 0 && tier !== "no-data";

          return (
            <div
              key={ad.id}
              className={`rounded-xl border p-3 flex items-center gap-3 transition-all ${cfg.bg} ${cfg.border} ${isTop ? "shadow-sm" : ""}`}
            >
              {/* Rank */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-black ${
                idx === 0 ? "bg-emerald-500 text-white" :
                idx === 1 ? "bg-emerald-400/30 text-emerald-700" :
                idx === 2 ? "bg-amber-400/30 text-amber-700" :
                "bg-muted text-muted-foreground"
              }`}>
                {idx + 1}
              </div>

              {/* Name + campaign */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground truncate">{ad.name}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${cfg.badge}`}>
                    {cfg.label}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{ad.campaign}</p>
              </div>

              {/* Metrics */}
              <div className="flex gap-4 shrink-0">
                <MetricPill
                  label="CPA"
                  value={ad.orders === 0 ? "—" : `${ad.cpa.toFixed(0)} EGP`}
                  good={ad.orders === 0 ? null : ad.cpa <= 45 ? true : ad.cpa <= 55 ? null : false}
                />
                <MetricPill label="طلبات" value={String(ad.orders)} />
                <MetricPill label="CTR" value={`${ad.ctr.toFixed(1)}%`} good={ad.ctr >= 3 ? true : ad.ctr >= 2 ? null : false} />
                <MetricPill label="CR" value={`${ad.cr.toFixed(1)}%`} good={ad.cr >= 5 ? true : ad.cr >= 3 ? null : false} />
                <MetricPill label="SPEND" value={`${ad.spend.toLocaleString()}`} />
              </div>

              {/* Trend icon */}
              <div className="shrink-0">
                {tier === "winner" && <TrendingUp className="h-4 w-4 text-emerald-500" />}
                {tier === "danger" && <TrendingDown className="h-4 w-4 text-rose-500" />}
                {(tier === "ok" || tier === "no-data") && <div className="w-4" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary footer */}
      <div className="mt-5 pt-4 border-t border-border flex items-center gap-6 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {sorted.filter(a=>TIER(a.cpa,a.orders)==="winner").length} فائز</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> {sorted.filter(a=>TIER(a.cpa,a.orders)==="ok").length} مقبول</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> {sorted.filter(a=>TIER(a.cpa,a.orders)==="danger").length} يحتاج تحسين</span>
        <span className="mr-auto text-[10px]">بيانات تجريبية — سيتم ربطها بـ Meta API عند التنفيذ</span>
      </div>
    </div>
  );
}
