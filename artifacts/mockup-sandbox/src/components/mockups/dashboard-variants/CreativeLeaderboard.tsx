import { useState } from "react";
import { ChevronDown, ChevronUp, Zap, BarChart2, FileText, Type, Film, Trophy } from "lucide-react";

// ── Mock data ───────────────────────────────────────────────────────────────
// Meta API fields: primary_text (body), headline (title), creative (video/image)
const MOCK_ADS = [
  { id:"1", name:"Ad 1", campaign:"رمضان — Broad",    spend:1050, orders:26, cpa:40.4, ctr:3.38, cr:6.37, primaryText:"PT1", headline:"H1", media:"M1" },
  { id:"2", name:"Ad 2", campaign:"رمضان — Broad",    spend: 850, orders:24, cpa:35.4, ctr:3.90, cr:5.80, primaryText:"PT2", headline:"H1", media:"M1" },
  { id:"3", name:"Ad 3", campaign:"رمضان — Retarget", spend: 620, orders:13, cpa:47.7, ctr:2.40, cr:4.10, primaryText:"PT1", headline:"H2", media:"M2" },
  { id:"4", name:"Ad 4", campaign:"Product Launch",   spend: 520, orders: 9, cpa:57.8, ctr:1.90, cr:3.20, primaryText:"PT2", headline:"H2", media:"M1" },
  { id:"5", name:"Ad 5", campaign:"Product Launch",   spend: 420, orders: 7, cpa:60.0, ctr:1.75, cr:2.90, primaryText:"PT1", headline:"H3", media:"M2" },
  { id:"6", name:"Ad 6", campaign:"Awareness — Top",  spend:  93, orders: 1, cpa:93.0, ctr:2.42, cr:5.56, primaryText:"PT2", headline:"H3", media:"M2" },
  { id:"7", name:"Ad 7", campaign:"Awareness — Top",  spend:  22, orders: 0, cpa:   0, ctr:1.11, cr:0.00, primaryText:"PT1", headline:"H1", media:"M3" },
];

// Primary text variants (Meta: ad.creative.body)
const PRIMARY_TEXT_LABELS: Record<string, { short: string; preview: string }> = {
  PT1: { short:"Primary Text 1", preview: "بتعاني من مشكلة X؟ جرّبنا وهتحل في أول أسبوع — نتائج حقيقية من عملاء زيّك..." },
  PT2: { short:"Primary Text 2", preview: "أكتر من ٥٠٠٠ عميل وثقوا فينا. النتيجة مضمونة أو مرجعلك فلوسك كاملة..." },
};

// Headline variants (Meta: ad.creative.title)
const HEADLINE_LABELS: Record<string, { short: string; preview: string }> = {
  H1: { short:"Headline 1", preview: "اشتري دلوقتي — شحن مجاني" },
  H2: { short:"Headline 2", preview: "عرض محدود — خصم ٣٠٪" },
  H3: { short:"Headline 3", preview: "جرّب ٧ أيام مجاناً" },
};

// Media variants (Meta: ad.creative.video_id / image_hash)
const MEDIA_LABELS: Record<string, { short: string; type: "video"|"image"; preview: string }> = {
  M1: { short:"Media 1", type:"video", preview: "فيديو — UGC طبيعي ٣٠ث (عميل حقيقي)" },
  M2: { short:"Media 2", type:"video", preview: "فيديو — إيموشن + نتيجة قبل/بعد ١٥ث" },
  M3: { short:"Media 3", type:"image", preview: "صورة — Static design بالعرض" },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
type Tier = "winner" | "ok" | "danger" | "no-data";
const getTier = (cpa: number, orders: number): Tier => {
  if (orders === 0) return "no-data";
  if (cpa <= 45) return "winner";
  if (cpa <= 55) return "ok";
  return "danger";
};
const TIER_CONFIG: Record<Tier, { label: string; bg: string; border: string; badgeBg: string; badgeText: string; dotColor: string }> = {
  winner:   { label:"فائز",            bg:"bg-emerald-500/8",  border:"border-emerald-400/30", badgeBg:"bg-emerald-100", badgeText:"text-emerald-700", dotColor:"bg-emerald-500" },
  ok:       { label:"مقبول",           bg:"bg-amber-500/6",    border:"border-amber-400/25",   badgeBg:"bg-amber-100",   badgeText:"text-amber-700",   dotColor:"bg-amber-400" },
  danger:   { label:"يحتاج تحسين",    bg:"bg-rose-500/6",     border:"border-rose-400/25",    badgeBg:"bg-rose-100",    badgeText:"text-rose-700",    dotColor:"bg-rose-500" },
  "no-data":{ label:"بيانات قليلة",   bg:"bg-muted/20",       border:"border-border/40",      badgeBg:"bg-muted",       badgeText:"text-muted-foreground", dotColor:"bg-muted-foreground/40" },
};

// Compute component-level averages (only ads with orders>0)
function componentAvg(key: "primaryText"|"headline"|"media") {
  const map: Record<string, { totalCpa: number; count: number; orders: number; spend: number }> = {};
  MOCK_ADS.filter(a => a.orders > 0).forEach(a => {
    const k = a[key];
    if (!map[k]) map[k] = { totalCpa: 0, count: 0, orders: 0, spend: 0 };
    map[k].totalCpa += a.cpa;
    map[k].count++;
    map[k].orders += a.orders;
    map[k].spend += a.spend;
  });
  return Object.entries(map).map(([k, v]) => ({
    key: k,
    avgCpa: v.totalCpa / v.count,
    totalOrders: v.orders,
    totalSpend: v.spend,
  })).sort((a, b) => a.avgCpa - b.avgCpa);
}

function Pill({ v, good }: { v: string; good?: boolean | null }) {
  return (
    <span className={`tabular-nums font-bold text-[12px] ${good === true ? "text-emerald-600" : good === false ? "text-rose-500" : "text-foreground"}`}>{v}</span>
  );
}

function ComponentBar({ label, items, labelMap, icon: Icon }: {
  label: string;
  items: { key: string; avgCpa: number; totalOrders: number; totalSpend: number }[];
  labelMap: Record<string, { short: string; preview?: string; type?: string }>;
  icon: React.ElementType;
}) {
  const best = items[0];
  const maxOrders = Math.max(...items.map(i => i.totalOrders), 1);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold text-foreground">{label}</span>
        {best && (
          <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full mr-auto">
            أفضل: {labelMap[best.key]?.short ?? best.key}
          </span>
        )}
      </div>
      <div className="space-y-2.5">
        {items.map((item, idx) => {
          const isBest = idx === 0;
          const barW = (item.totalOrders / maxOrders) * 100;
          const lbl = labelMap[item.key];
          return (
            <div key={item.key}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[11px] font-semibold truncate max-w-[55%] ${isBest ? "text-emerald-700" : "text-foreground"}`}>
                  {lbl?.short ?? item.key}
                </span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className={`font-black ${isBest ? "text-emerald-600" : "text-foreground"}`}>
                    {item.avgCpa.toFixed(0)} EGP CPA
                  </span>
                  <span className="text-muted-foreground">{item.totalOrders} طلب</span>
                </div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${isBest ? "bg-emerald-500" : "bg-primary/30"}`}
                  style={{ width: `${barW}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export function CreativeLeaderboard() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [minSpend, setMinSpend] = useState(50);

  const validAds = MOCK_ADS
    .filter(a => a.spend >= minSpend)
    .sort((a, b) => {
      if (a.orders === 0 && b.orders === 0) return 0;
      if (a.orders === 0) return 1;
      if (b.orders === 0) return -1;
      return a.cpa - b.cpa;
    });

  const primaryTextAvg = componentAvg("primaryText");
  const headlineAvg    = componentAvg("headline");
  const mediaAvg       = componentAvg("media");

  const topWinner = validAds.find(a => getTier(a.cpa, a.orders) === "winner");

  return (
    <div dir="rtl" className="min-h-screen bg-background p-5 space-y-5" style={{ fontFamily: "'Cairo','Segoe UI',sans-serif" }}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-black text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            مركز الكريتف
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">كل الكريتف عبر الحملات — مرتّب بالـ CPA</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">إنفاق أدنى</label>
          <select value={minSpend} onChange={e=>setMinSpend(+e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card">
            <option value={0}>الكل</option>
            <option value={50}>50 EGP+</option>
            <option value={200}>200 EGP+</option>
          </select>
        </div>
      </div>

      {/* ── Top winner strip ── */}
      {topWinner && (
        <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/8 p-3.5 flex items-center gap-3">
          <Trophy className="h-8 w-8 text-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">أفضل كريتف الآن</p>
            <p className="text-sm font-black">{topWinner.name} — {topWinner.campaign}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {PRIMARY_TEXT_LABELS[topWinner.primaryText]?.short} · {HEADLINE_LABELS[topWinner.headline]?.short} · {MEDIA_LABELS[topWinner.media]?.short}
            </p>
          </div>
          <div className="flex gap-4 shrink-0 text-center">
            <div><p className="text-lg font-black text-emerald-600">{topWinner.cpa.toFixed(0)}</p><p className="text-[9px] text-muted-foreground">EGP CPA</p></div>
            <div><p className="text-lg font-black">{topWinner.orders}</p><p className="text-[9px] text-muted-foreground">طلبات</p></div>
          </div>
        </div>
      )}

      {/* ── Leaderboard rows ── */}
      <div className="space-y-2">
        {validAds.map((ad, idx) => {
          const tier = getTier(ad.cpa, ad.orders);
          const cfg = TIER_CONFIG[tier];
          const isOpen = expanded === ad.id;

          return (
            <div key={ad.id} className={`rounded-xl border transition-all ${cfg.bg} ${cfg.border}`}>
              {/* Main row */}
              <button
                className="w-full flex items-center gap-3 p-3 text-right"
                onClick={() => setExpanded(isOpen ? null : ad.id)}
              >
                {/* Rank */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-black ${
                  idx===0?"bg-emerald-500 text-white":idx===1?"bg-emerald-300/40 text-emerald-800":idx===2?"bg-amber-300/40 text-amber-800":"bg-muted text-muted-foreground"
                }`}>{idx+1}</div>

                {/* Name */}
                <div className="flex-1 min-w-0 text-right">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{ad.name}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badgeBg} ${cfg.badgeText}`}>{cfg.label}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{ad.campaign}</p>
                </div>

                {/* Metrics */}
                <div className="flex gap-4 shrink-0">
                  <div className="text-center">
                    <Pill v={ad.orders===0?"—":`${ad.cpa.toFixed(0)} EGP`} good={ad.orders===0?null:ad.cpa<=45?true:ad.cpa<=55?null:false} />
                    <p className="text-[9px] text-muted-foreground">CPA</p>
                  </div>
                  <div className="text-center">
                    <Pill v={String(ad.orders)} />
                    <p className="text-[9px] text-muted-foreground">طلبات</p>
                  </div>
                  <div className="text-center">
                    <Pill v={`${ad.ctr.toFixed(1)}%`} good={ad.ctr>=3?true:ad.ctr>=2?null:false} />
                    <p className="text-[9px] text-muted-foreground">CTR</p>
                  </div>
                  <div className="text-center">
                    <Pill v={`${ad.cr.toFixed(1)}%`} good={ad.cr>=5?true:ad.cr>=3?null:false} />
                    <p className="text-[9px] text-muted-foreground">CR</p>
                  </div>
                  <div className="text-center">
                    <Pill v={ad.spend.toLocaleString()} />
                    <p className="text-[9px] text-muted-foreground">SPEND</p>
                  </div>
                </div>

                {/* Expand icon */}
                <div className="shrink-0 text-muted-foreground">
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </button>

              {/* Expanded: Meta creative components */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-border/40">
                  <p className="text-[10px] text-muted-foreground mb-2.5 font-bold uppercase tracking-wider">مكونات الكريتف — Meta Ad Creative</p>
                  <div className="grid grid-cols-3 gap-2">
                    {/* Primary Text */}
                    <div className="bg-background/70 rounded-lg border border-border p-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <FileText className="h-3 w-3 text-blue-500" />
                        <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Primary Text</span>
                      </div>
                      <p className="text-[11px] font-bold text-foreground mb-0.5">{PRIMARY_TEXT_LABELS[ad.primaryText]?.short ?? ad.primaryText}</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">{PRIMARY_TEXT_LABELS[ad.primaryText]?.preview}</p>
                    </div>
                    {/* Headline */}
                    <div className="bg-background/70 rounded-lg border border-border p-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Type className="h-3 w-3 text-violet-500" />
                        <span className="text-[9px] font-black text-violet-500 uppercase tracking-widest">Headline</span>
                      </div>
                      <p className="text-[11px] font-bold text-foreground mb-0.5">{HEADLINE_LABELS[ad.headline]?.short ?? ad.headline}</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{HEADLINE_LABELS[ad.headline]?.preview}</p>
                    </div>
                    {/* Media */}
                    <div className="bg-background/70 rounded-lg border border-border p-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Film className="h-3 w-3 text-amber-500" />
                        <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">
                          Media — {MEDIA_LABELS[ad.media]?.type === "video" ? "Video" : "Image"}
                        </span>
                      </div>
                      <p className="text-[11px] font-bold text-foreground mb-0.5">{MEDIA_LABELS[ad.media]?.short ?? ad.media}</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{MEDIA_LABELS[ad.media]?.preview}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Component Analysis ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-black text-foreground">تحليل المكونات — أيهم بيجيب أفضل CPA؟</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ComponentBar label="Primary Text"  items={primaryTextAvg} labelMap={PRIMARY_TEXT_LABELS} icon={FileText} />
          <ComponentBar label="Headline"      items={headlineAvg}    labelMap={HEADLINE_LABELS}     icon={Type} />
          <ComponentBar label="Media"         items={mediaAvg}       labelMap={MEDIA_LABELS}        icon={Film} />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground text-center pt-1">بيانات تجريبية — سيتم ربطها بـ Meta API عند التنفيذ</p>
    </div>
  );
}
