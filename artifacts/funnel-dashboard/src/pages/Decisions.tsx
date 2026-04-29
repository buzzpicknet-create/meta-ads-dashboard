import { useMemo, useState } from "react";
import {
  CheckCircle2, AlertTriangle, XCircle, PauseCircle, Zap, TrendingDown,
  ChevronDown, RefreshCw, Loader2, BarChart2, Target,
  Eye, ShoppingCart, Filter,
} from "lucide-react";
import { useAccounts, useAccountOverview, useInsights } from "@/hooks/use-meta";
import {
  type CampaignSummaryFull,
  type DatePreset,
  rangeFromPreset,
} from "@/lib/meta-api";
import {
  diagnoseCampaign,
  diagnoseSegment,
  MetricGrid,
  ActionList,
  COLOR_CFG,
  FLAG_TEXT,
} from "@/components/DiagnosisModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Constants ─────────────────────────────────────────────────
const CPA_WIN   = 45;
const CPA_NEAR  = 55;
const CPA_WARN  = 80;

// ── Score ─────────────────────────────────────────────────────
function computeScore(c: CampaignSummaryFull): number {
  if (c.spend === 0) return 0;
  let s = 100;

  if (c.purchases === 0) { s -= 55; }
  else if (c.cpa > CPA_WARN)  { s -= 40; }
  else if (c.cpa > CPA_NEAR)  { s -= 25; }
  else if (c.cpa > CPA_WIN)   { s -= 12; }

  if (c.ctr < 0.5)        s -= 18;
  else if (c.ctr < 1)     s -= 12;
  else if (c.ctr < 1.5)   s -= 6;

  const lpvRate = c.link_clicks > 0 ? (c.lpv / c.link_clicks) * 100 : 0;
  if (lpvRate > 0 && lpvRate < 50)  s -= 12;
  else if (lpvRate > 0 && lpvRate < 70) s -= 6;

  if (c.cr > 0 && c.cr < 1)  s -= 8;
  else if (c.cr > 0 && c.cr < 2) s -= 4;

  if (c.frequency > 3)    s -= 5;
  else if (c.frequency > 2.5) s -= 3;

  return Math.max(0, Math.min(100, Math.round(s)));
}

// ── Category ──────────────────────────────────────────────────
type Category =
  | "winner"    // رابح
  | "near"      // قريب من الفور
  | "fatigue"   // إرهاق جمهور
  | "creative"  // كريتف ضعيف
  | "tech"      // مشكلة تقنية
  | "landing"   // صفحة هبوط
  | "noconv"    // لا تحويلات
  | "critical"  // حرجة
  | "improve"   // يحتاج تحسين
  | "paused"    // متوقفة
  | "nodata";   // لا بيانات

const CAT_LABELS: Record<Category, string> = {
  winner:   "رابح ✅",
  near:     "قريب من الفور 🟡",
  fatigue:  "إرهاق جمهور 🔄",
  creative: "كريتف ضعيف 🎬",
  tech:     "مشكلة تقنية ⚙️",
  landing:  "صفحة هبوط 🛒",
  noconv:   "لا تحويلات 🔴",
  critical: "حرجة 🆘",
  improve:  "يحتاج تحسين 🟠",
  paused:   "متوقفة ⏸",
  nodata:   "لا بيانات",
};

const CAT_COLORS: Record<Category, { text: string; bg: string; border: string }> = {
  winner:   { text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
  near:     { text: "text-lime-700 dark:text-lime-400",       bg: "bg-lime-500/10",    border: "border-lime-500/25" },
  fatigue:  { text: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-500/10",   border: "border-amber-500/25" },
  creative: { text: "text-orange-700 dark:text-orange-400",   bg: "bg-orange-500/10",  border: "border-orange-500/25" },
  tech:     { text: "text-blue-700 dark:text-blue-400",       bg: "bg-blue-500/10",    border: "border-blue-500/25" },
  landing:  { text: "text-violet-700 dark:text-violet-400",   bg: "bg-violet-500/10",  border: "border-violet-500/25" },
  noconv:   { text: "text-rose-700 dark:text-rose-400",       bg: "bg-rose-500/10",    border: "border-rose-500/25" },
  critical: { text: "text-rose-700 dark:text-rose-400",       bg: "bg-rose-500/10",    border: "border-rose-500/25" },
  improve:  { text: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-500/10",   border: "border-amber-500/25" },
  paused:   { text: "text-muted-foreground",                  bg: "bg-muted/30",       border: "border-border" },
  nodata:   { text: "text-muted-foreground",                  bg: "bg-muted/20",       border: "border-border" },
};

function getCategoryIcon(cat: Category) {
  const map: Record<Category, typeof CheckCircle2> = {
    winner:   CheckCircle2,
    near:     TrendingDown,
    fatigue:  RefreshCw,
    creative: Eye,
    tech:     Zap,
    landing:  ShoppingCart,
    noconv:   XCircle,
    critical: XCircle,
    improve:  AlertTriangle,
    paused:   PauseCircle,
    nodata:   BarChart2,
  };
  return map[cat] ?? BarChart2;
}

function getCategory(c: CampaignSummaryFull): Category {
  if (["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(c.effective_status)) return "paused";
  if (c.spend === 0) return "nodata";
  if (c.purchases === 0 && c.spend > 100) return "noconv";
  if (c.cpa > 0 && c.cpa <= CPA_WIN) return "winner";
  if (c.cpa > 0 && c.cpa <= CPA_NEAR) return "near";

  const lpvRate = c.link_clicks > 0 ? (c.lpv / c.link_clicks) * 100 : 0;

  if (c.frequency > 2.5 && c.ctr < 1) return "fatigue";
  if (c.ctr < 1) return "creative";
  if (lpvRate > 0 && lpvRate < 60) return "tech";
  if (c.cr > 0 && c.cr < 1.5 && lpvRate >= 60) return "landing";
  if (c.cpa > CPA_WARN) return "critical";
  if (c.cpa > CPA_NEAR) return "improve";
  return "improve";
}

function scoreColor(score: number): { ring: string; text: string; fill: string } {
  if (score >= 80) return { ring: "#10b981", text: "text-emerald-600 dark:text-emerald-400", fill: "#10b981" };
  if (score >= 60) return { ring: "#f59e0b", text: "text-amber-600 dark:text-amber-400", fill: "#f59e0b" };
  if (score >= 40) return { ring: "#f97316", text: "text-orange-600 dark:text-orange-400", fill: "#f97316" };
  return { ring: "#f43f5e", text: "text-rose-600 dark:text-rose-400", fill: "#f43f5e" };
}

function MetricBar({ label, value, pct, flag }: { label: string; value: string; pct: number; flag: "good" | "warn" | "bad" }) {
  const barColor = flag === "good" ? "bg-emerald-500" : flag === "warn" ? "bg-amber-500" : "bg-rose-500";
  const textColor = flag === "good" ? "text-emerald-700 dark:text-emerald-400" : flag === "warn" ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] text-muted-foreground leading-none">{label}</span>
        <span className={`text-xs font-bold font-mono leading-none ${textColor}`} dir="ltr">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function ScoreCircle({ score }: { score: number }) {
  const { ring, text } = scoreColor(score);
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="relative flex-shrink-0 flex items-center justify-center w-12 h-12">
      <svg className="absolute inset-0 -rotate-90" width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
        <circle
          cx="24" cy="24" r={r}
          fill="none" stroke={ring} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`text-xs font-extrabold z-10 leading-none ${text}`}>{score}</span>
    </div>
  );
}

// ── Diagnosis Panel (loaded on expand) ────────────────────────
function DiagnosisPanel({
  campaignId, accountId, since, until,
}: {
  campaignId: string; accountId: string; since: string; until: string;
}) {
  const { data, isLoading } = useInsights({ campaign_id: campaignId, ad_account_id: accountId, since, until });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        جاري تحميل التشخيص...
      </div>
    );
  }
  if (!data) {
    return <p className="text-center text-sm text-muted-foreground py-6">تعذّر تحميل البيانات</p>;
  }

  const diag = diagnoseCampaign(data.totals, data.daily);
  const cfg = COLOR_CFG[diag.color];

  return (
    <div className="space-y-4 pt-2">
      {/* Decision banner */}
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${cfg.bg} ${cfg.border}`}>
        <span className="text-xl">{diag.emoji}</span>
        <div className="min-w-0">
          <div className={`text-sm font-bold ${cfg.text}`}>{diag.decision}</div>
          <div className="text-xs text-muted-foreground leading-snug mt-0.5">{diag.problem}</div>
        </div>
      </div>

      {/* Funnel */}
      {diag.funnel.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">الفانل</div>
          <div className="space-y-1">
            {diag.funnel.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-xs rounded-lg bg-muted/10 border border-border px-3 py-2">
                <span className="text-muted-foreground">{f.label}</span>
                <span className={`font-bold font-mono ${FLAG_TEXT[f.flag]}`} dir="ltr">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics grid */}
      <MetricGrid metrics={diag.metrics} />

      {/* Action plan */}
      <ActionList actions={diag.actionPlan} color={diag.color} />

      {/* Ad sets & ads */}
      {data.by_adset.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">تشخيص Ad Sets</div>
          {data.by_adset.map((seg) => {
            const d = diagnoseSegment(seg);
            const c = COLOR_CFG[d.color];
            return (
              <div key={seg.key} className={`rounded-xl border p-3 ${c.bg} ${c.border}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-xs font-medium leading-snug flex-1">{seg.label}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.badge}`}>{d.decision}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px] text-muted-foreground">
                  <span>CPA: <b className={`font-mono ${FLAG_TEXT[d.metrics.find(m=>m.label==="CPA")?.flag ?? "bad"]}`} dir="ltr">{seg.cpa > 0 ? `${Math.round(seg.cpa)} EGP` : "—"}</b></span>
                  <span>CTR: <b className="font-mono" dir="ltr">{seg.ctr.toFixed(2)}%</b></span>
                  <span>Spend: <b className="font-mono" dir="ltr">{Math.round(seg.spend)} EGP</b></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Campaign Card ─────────────────────────────────────────────
function CampaignDecisionCard({
  campaign, accountId, since, until,
}: {
  campaign: CampaignSummaryFull;
  accountId: string;
  since: string;
  until: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const score   = computeScore(campaign);
  const cat     = getCategory(campaign);
  const catClr  = CAT_COLORS[cat];
  const CatIcon = getCategoryIcon(cat);

  const lpvRate   = campaign.link_clicks > 0 ? (campaign.lpv / campaign.link_clicks) * 100 : 0;
  const ctrFlag   = campaign.ctr >= 1.5 ? "good" : campaign.ctr >= 0.8 ? "warn" : "bad";
  const cpaFlag   = campaign.cpa > 0 && campaign.cpa <= CPA_WIN ? "good" : campaign.cpa <= CPA_NEAR ? "warn" : "bad";
  const lpvFlag   = lpvRate >= 70 ? "good" : lpvRate >= 50 ? "warn" : "bad";
  const cpaText   = campaign.cpa > 0 ? `${Math.round(campaign.cpa)} EGP` : campaign.purchases === 0 ? "لا أوردر" : "—";
  const isPaused  = cat === "paused" || cat === "nodata";

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${catClr.border} ${isPaused ? "opacity-60" : ""}`}>
      {/* Card header */}
      <div className={`${catClr.bg} px-4 pt-4 pb-3`}>
        <div className="flex items-start gap-3">
          <ScoreCircle score={score} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-snug line-clamp-2">{campaign.name}</p>
            <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 ${catClr.bg} ${catClr.text} border ${catClr.border}`}>
              <CatIcon className="h-2.5 w-2.5" />
              {CAT_LABELS[cat]}
            </span>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="bg-card px-4 py-3 space-y-2.5">
        <MetricBar
          label="Outbound CTR"
          value={`${campaign.ctr.toFixed(2)}%`}
          pct={Math.min((campaign.ctr / 3) * 100, 100)}
          flag={ctrFlag}
        />
        <MetricBar
          label={`LPV Rate (${campaign.link_clicks > 0 ? `${Math.round(lpvRate)}%` : "—"})`}
          value={lpvRate > 0 ? `${Math.round(lpvRate)}%` : "—"}
          pct={lpvRate}
          flag={lpvRate > 0 ? lpvFlag : "bad"}
        />
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="text-xs text-muted-foreground">
            CPA: <span className={`font-bold font-mono ${cpaFlag === "good" ? "text-emerald-600 dark:text-emerald-400" : cpaFlag === "warn" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`} dir="ltr">{cpaText}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            إنفاق: <span className="font-mono font-medium" dir="ltr">{Math.round(campaign.spend).toLocaleString()} EGP</span>
          </div>
        </div>
      </div>

      {/* Expand button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20 hover:bg-muted/40 transition-colors text-xs font-medium text-muted-foreground"
      >
        <span>{expanded ? "إخفاء التحليل" : "عرض التحليل"}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Diagnosis panel */}
      {expanded && (
        <div className="border-t border-border bg-muted/5 px-4 py-4">
          <DiagnosisPanel
            campaignId={campaign.id}
            accountId={accountId}
            since={since}
            until={until}
          />
        </div>
      )}
    </div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────
function SummaryBar({ campaigns }: { campaigns: CampaignSummaryFull[] }) {
  const counts = useMemo(() => {
    const map: Partial<Record<Category, number>> = {};
    for (const c of campaigns) {
      const cat = getCategory(c);
      map[cat] = (map[cat] ?? 0) + 1;
    }
    return map;
  }, [campaigns]);

  const highlights: { cat: Category; emoji: string }[] = [
    { cat: "winner",   emoji: "✅" },
    { cat: "near",     emoji: "🟡" },
    { cat: "improve",  emoji: "🟠" },
    { cat: "creative", emoji: "🎬" },
    { cat: "noconv",   emoji: "🔴" },
    { cat: "critical", emoji: "🆘" },
    { cat: "fatigue",  emoji: "🔄" },
    { cat: "tech",     emoji: "⚙️" },
    { cat: "landing",  emoji: "🛒" },
    { cat: "paused",   emoji: "⏸" },
  ].filter(({ cat }) => (counts[cat] ?? 0) > 0);

  return (
    <div className="flex flex-wrap gap-2">
      {highlights.map(({ cat, emoji }) => {
        const c = CAT_COLORS[cat];
        return (
          <div key={cat} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 border text-xs font-semibold ${c.bg} ${c.border} ${c.text}`}>
            <span>{emoji}</span>
            <span>{counts[cat]}</span>
            <span className="font-normal opacity-80">{CAT_LABELS[cat].split(" ")[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
const PRESET_LABELS: Record<DatePreset, string> = {
  today: "اليوم",
  yesterday: "أمس",
  "7d": "آخر 7 أيام",
  "14d": "آخر 14 يوم",
  "28d": "آخر 28 يوم",
  current_month: "الشهر الحالي",
  prev_month: "الشهر السابق",
  custom: "مخصص",
};

type FilterKey = "all" | Category;
const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "all",      label: "الكل" },
  { key: "winner",   label: "رابح ✅" },
  { key: "near",     label: "قريب 🟡" },
  { key: "improve",  label: "يحتاج تحسين 🟠" },
  { key: "creative", label: "كريتف ضعيف 🎬" },
  { key: "noconv",   label: "لا تحويلات 🔴" },
  { key: "critical", label: "حرجة 🆘" },
  { key: "fatigue",  label: "إرهاق 🔄" },
  { key: "tech",     label: "تقنية ⚙️" },
  { key: "landing",  label: "هبوط 🛒" },
  { key: "paused",   label: "متوقفة ⏸" },
];

export default function DecisionsPage() {
  const { data: accountsData } = useAccounts();
  const accounts = accountsData?.accounts ?? [];

  const [accountId, setAccountId] = useState<string | null>(null);
  const [preset, setPreset]       = useState<DatePreset>("7d");
  const [filter, setFilter]       = useState<FilterKey>("all");

  const selectedAccountId = accountId ?? accounts[0]?.id ?? null;
  const range             = useMemo(() => rangeFromPreset(preset), [preset]);

  const { data: overview, isLoading } = useAccountOverview({
    ad_account_id: selectedAccountId,
    since: range.since,
    until: range.until,
  });

  const campaigns = useMemo((): CampaignSummaryFull[] => {
    if (!overview) return [];
    return overview.campaigns
      .filter((c) => filter === "all" || getCategory(c) === filter)
      .sort((a, b) => computeScore(b) - computeScore(a));
  }, [overview, filter]);

  const allCampaigns = overview?.campaigns ?? [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              تشخيص الحملات الإعلانية
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              تحليل — CTR · LPV Rate · CPA · القرار
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {accounts.length > 1 && (
              <Select value={selectedAccountId ?? ""} onValueChange={setAccountId}>
                <SelectTrigger className="h-8 text-xs w-44">
                  <SelectValue placeholder="اختر الحساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRESET_LABELS) as DatePreset[])
                  .filter((k) => k !== "custom")
                  .map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">{PRESET_LABELS[k]}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary badges */}
        {allCampaigns.length > 0 && <SummaryBar campaigns={allCampaigns} />}

        {/* Filter tabs */}
        <div className="flex gap-1.5 flex-wrap" role="tablist">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${filter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            جاري تحميل الحملات...
          </div>
        )}

        {/* Empty */}
        {!isLoading && campaigns.length === 0 && allCampaigns.length > 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Filter className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">لا توجد حملات في هذا التصنيف</p>
            <button onClick={() => setFilter("all")} className="mt-2 text-xs text-primary underline">عرض الكل</button>
          </div>
        )}

        {!isLoading && allCampaigns.length === 0 && selectedAccountId && (
          <div className="text-center py-16 text-muted-foreground">
            <BarChart2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">لا توجد حملات في هذه الفترة</p>
          </div>
        )}

        {/* Campaign grid */}
        {campaigns.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => (
              <CampaignDecisionCard
                key={c.id}
                campaign={c}
                accountId={selectedAccountId!}
                since={range.since}
                until={range.until}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
