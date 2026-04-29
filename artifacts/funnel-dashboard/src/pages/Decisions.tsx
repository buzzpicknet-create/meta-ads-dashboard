import { useMemo, useState } from "react";
import {
  CheckCircle2, AlertTriangle, XCircle, PauseCircle, Zap, TrendingDown,
  RefreshCw, BarChart2, Target, Eye, ShoppingCart, Filter, Stethoscope,
  FlameKindling, TrendingUp,
} from "lucide-react";
import { useAccounts, useAccountOverview } from "@/hooks/use-meta";
import {
  type CampaignSummaryFull,
  type DatePreset,
  rangeFromPreset,
} from "@/lib/meta-api";
import { CampaignDiagnosisModal } from "@/components/DiagnosisModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Thresholds (same as DiagnosisModal) ──────────────────────
const CPA_WIN    = 45;
const CPA_NEAR   = 55;
const CPA_WARN   = 80;
const HOOK_DEAD  = 15;   // ميت Hook: VR < 15%
const HOOK_WEAK  = 25;   // كريتف ضعيف: VR 15-25%
const CTR_MIN    = 1.0;
const CTR_GOOD   = 1.3;

// ── Category ──────────────────────────────────────────────────
type Category =
  | "winner"     // رابح
  | "near"       // قريب من الفور
  | "hookdead"   // ميت Hook
  | "fatigue"    // إرهاق جمهور
  | "creative"   // كريتف ضعيف
  | "sellfluct"  // تذبذب بيع
  | "tech"       // مشكلة تقنية
  | "landing"    // صفحة هبوط
  | "noconv"     // لا تحويلات
  | "critical"   // حرجة
  | "improve"    // يحتاج تحسين
  | "paused"     // متوقفة
  | "nodata";    // لا بيانات

interface CatConfig {
  label: string;
  desc: string;
  text: string;
  bg: string;
  border: string;
  Icon: typeof CheckCircle2;
}

const CAT: Record<Category, CatConfig> = {
  winner:    { label: "رابح",           desc: `VR≥${HOOK_WEAK}% + CTR≥${CTR_GOOD}% + CPA≤${CPA_WIN}`,   text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", Icon: CheckCircle2 },
  near:      { label: "قريب من الفور",  desc: "محور واحد يحتاج تحسين",                                   text: "text-lime-700 dark:text-lime-400",       bg: "bg-lime-500/10",    border: "border-lime-500/25",    Icon: TrendingUp },
  hookdead:  { label: "ميت Hook",       desc: `أول 3ث → VR < ${HOOK_DEAD}%`,                             text: "text-rose-700 dark:text-rose-400",       bg: "bg-rose-500/10",    border: "border-rose-500/25",    Icon: XCircle },
  fatigue:   { label: "إرهاق جمهور",   desc: "Frequency مرتفعة + تراجع CTR",                             text: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-500/10",   border: "border-amber-500/25",   Icon: RefreshCw },
  creative:  { label: "كريتف ضعيف",    desc: `VR ${HOOK_DEAD}-${HOOK_WEAK}% + CTR ضعيف`,                 text: "text-orange-700 dark:text-orange-400",   bg: "bg-orange-500/10",  border: "border-orange-500/25",  Icon: Eye },
  sellfluct: { label: "تذبذب بيع",     desc: "VR+CTR ممتازين لكن CPA مرتفع",                             text: "text-violet-700 dark:text-violet-400",   bg: "bg-violet-500/10",  border: "border-violet-500/25",  Icon: FlameKindling },
  tech:      { label: "مشكلة تقنية",   desc: "نقرات بدون وصول — LPR منخفض",                              text: "text-blue-700 dark:text-blue-400",       bg: "bg-blue-500/10",    border: "border-blue-500/25",    Icon: Zap },
  landing:   { label: "صفحة هبوط",     desc: "زيارات بدون شراء — CR منخفض",                              text: "text-cyan-700 dark:text-cyan-400",       bg: "bg-cyan-500/10",    border: "border-cyan-500/25",    Icon: ShoppingCart },
  noconv:    { label: "لا تحويلات",     desc: "إنفاق بدون أوردر واحد",                                    text: "text-rose-700 dark:text-rose-400",       bg: "bg-rose-500/10",    border: "border-rose-500/25",    Icon: XCircle },
  critical:  { label: "حرجة",           desc: `CPA > ${CPA_WARN} EGP`,                                    text: "text-rose-700 dark:text-rose-400",       bg: "bg-rose-500/10",    border: "border-rose-500/25",    Icon: AlertTriangle },
  improve:   { label: "يحتاج تحسين",   desc: `CPA ${CPA_WIN}-${CPA_WARN} EGP`,                            text: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-500/10",   border: "border-amber-500/25",   Icon: TrendingDown },
  paused:    { label: "متوقفة",         desc: "الحملة موقوفة",                                             text: "text-muted-foreground",                 bg: "bg-muted/30",       border: "border-border",         Icon: PauseCircle },
  nodata:    { label: "لا بيانات",      desc: "لا إنفاق في الفترة",                                        text: "text-muted-foreground",                 bg: "bg-muted/20",       border: "border-border",         Icon: BarChart2 },
};

// ── Categorisation ────────────────────────────────────────────
function getCategory(c: CampaignSummaryFull): Category {
  if (["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(c.effective_status)) return "paused";
  if (c.spend === 0) return "nodata";
  if (c.purchases === 0 && c.spend > 100) return "noconv";

  const lpvRate = c.link_clicks > 0 ? (c.lpv / c.link_clicks) * 100 : 0;
  const vr = c.hookRate; // View Rate (3-sec hook)

  // رابح: VR ممتاز + CTR ممتاز + CPA رابح
  if (vr >= HOOK_WEAK && c.ctr >= CTR_GOOD && c.cpa > 0 && c.cpa <= CPA_WIN) return "winner";

  // قريب من الفور: CPA رابح أو قريب منه (VR/CTR مقبولين)
  if (c.cpa > 0 && c.cpa <= CPA_NEAR) return "near";

  // ميت Hook: VR < 15% (المشكلة في أول 3 ثواني)
  if (c.video_plays > 0 && vr < HOOK_DEAD) return "hookdead";

  // تذبذب بيع: VR+CTR ممتازين لكن CPA مرتفع
  if (vr >= HOOK_WEAK && c.ctr >= CTR_MIN && c.cpa > CPA_NEAR) return "sellfluct";

  // إرهاق جمهور: Frequency عالية + CTR منخفض
  if (c.frequency > 2.5 && c.ctr < CTR_MIN) return "fatigue";

  // كريتف ضعيف: VR متوسط أو CTR ضعيف
  if (vr < HOOK_WEAK || c.ctr < CTR_MIN) return "creative";

  // مشكلة تقنية: LPR منخفض
  if (lpvRate > 0 && lpvRate < 60) return "tech";

  // صفحة هبوط: CR منخفض
  if (c.cr > 0 && c.cr < 1.5 && lpvRate >= 60) return "landing";

  // حرجة / يحتاج تحسين
  if (c.cpa > CPA_WARN) return "critical";
  if (c.cpa > CPA_NEAR) return "improve";

  return "improve";
}

// ── Score (0-100) ─────────────────────────────────────────────
function computeScore(c: CampaignSummaryFull): number {
  if (c.spend === 0) return 0;
  let s = 100;
  const vr = c.hookRate;

  // CPA (40 pts)
  if (c.purchases === 0)        s -= 40;
  else if (c.cpa > CPA_WARN)    s -= 35;
  else if (c.cpa > CPA_NEAR)    s -= 22;
  else if (c.cpa > CPA_WIN)     s -= 10;

  // View Rate (25 pts)
  if (c.video_plays > 0) {
    if (vr < HOOK_DEAD)    s -= 25;
    else if (vr < HOOK_WEAK) s -= 14;
    else if (vr < 35)      s -= 6;
  }

  // CTR (20 pts)
  if (c.ctr < 0.5)        s -= 20;
  else if (c.ctr < CTR_MIN) s -= 13;
  else if (c.ctr < CTR_GOOD) s -= 6;

  // LPV Rate (10 pts)
  const lpvRate = c.link_clicks > 0 ? (c.lpv / c.link_clicks) * 100 : 0;
  if (lpvRate > 0 && lpvRate < 50)   s -= 10;
  else if (lpvRate > 0 && lpvRate < 70) s -= 5;

  // Frequency (5 pts)
  if (c.frequency > 3)         s -= 5;
  else if (c.frequency > 2.5)  s -= 3;

  return Math.max(0, Math.min(100, Math.round(s)));
}

// ── Score colors ──────────────────────────────────────────────
function scoreColor(score: number): { ring: string; text: string } {
  if (score >= 80) return { ring: "#10b981", text: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 60) return { ring: "#f59e0b", text: "text-amber-600 dark:text-amber-400" };
  if (score >= 40) return { ring: "#f97316", text: "text-orange-600 dark:text-orange-400" };
  return { ring: "#f43f5e", text: "text-rose-600 dark:text-rose-400" };
}

function ScoreCircle({ score }: { score: number }) {
  const { ring, text } = scoreColor(score);
  const r    = 18;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative flex-shrink-0 flex items-center justify-center w-12 h-12">
      <svg className="absolute inset-0 -rotate-90" width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={ring} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className={`text-xs font-extrabold z-10 leading-none ${text}`}>{score}</span>
    </div>
  );
}

function MetricBar({ label, value, pct, flag }: { label: string; value: string; pct: number; flag: "good" | "warn" | "bad" }) {
  const barColor  = flag === "good" ? "bg-emerald-500" : flag === "warn" ? "bg-amber-500" : "bg-rose-500";
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

// ── Mini stat badge ───────────────────────────────────────────
function StatBadge({ label, value, flag }: { label: string; value: string; flag: "good" | "warn" | "bad" | "neutral" }) {
  const clr = flag === "good" ? "text-emerald-700 dark:text-emerald-400" : flag === "warn" ? "text-amber-700 dark:text-amber-400" : flag === "bad" ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground";
  const bg  = flag === "good" ? "bg-emerald-500/8" : flag === "warn" ? "bg-amber-500/8" : flag === "bad" ? "bg-rose-500/8" : "bg-muted/30";
  return (
    <div className={`flex flex-col items-center rounded-lg px-2 py-1 ${bg}`}>
      <span className={`text-xs font-bold font-mono leading-none ${clr}`} dir="ltr">{value}</span>
      <span className="text-[9px] text-muted-foreground leading-none mt-0.5">{label}</span>
    </div>
  );
}

// ── Campaign Card ─────────────────────────────────────────────
function CampaignDecisionCard({
  campaign, onDiagnose,
}: {
  campaign: CampaignSummaryFull;
  onDiagnose: (id: string) => void;
}) {
  const score    = computeScore(campaign);
  const cat      = getCategory(campaign);
  const cfg      = CAT[cat];
  const CatIcon  = cfg.Icon;
  const isPaused = cat === "paused" || cat === "nodata";

  // ── Derived metrics ──
  const vr        = campaign.hookRate;
  const hasVR     = campaign.video_plays > 0;
  const holdRate  = hasVR && campaign.v95 > 0 ? (campaign.v95 / campaign.video_plays) * 100 : 0;
  const lpr       = campaign.link_clicks > 0 ? (campaign.lpv / campaign.link_clicks) * 100 : 0;

  // ── Flags ──
  const vrFlag:   "good"|"warn"|"bad" = vr >= HOOK_WEAK ? "good" : vr >= HOOK_DEAD ? "warn" : "bad";
  const holdFlag: "good"|"warn"|"bad" = holdRate >= 25 ? "good" : holdRate >= 15 ? "warn" : "bad";
  const ctrFlag:  "good"|"warn"|"bad" = campaign.ctr >= CTR_GOOD ? "good" : campaign.ctr >= CTR_MIN ? "warn" : "bad";
  const lprFlag:  "good"|"warn"|"bad" = lpr >= 70 ? "good" : lpr >= 50 ? "warn" : "bad";
  const cpaFlag:  "good"|"warn"|"bad" = campaign.cpa > 0 && campaign.cpa <= CPA_WIN ? "good" : campaign.cpa <= CPA_NEAR ? "warn" : "bad";
  const freqFlag: "good"|"warn"|"bad" = campaign.frequency <= 2.5 ? "good" : campaign.frequency <= 3.5 ? "warn" : "bad";
  const cpmFlag:  "good"|"warn"|"bad" = campaign.cpm < 30 ? "good" : campaign.cpm < 70 ? "warn" : "bad";

  const cpaText = campaign.cpa > 0
    ? `${Math.round(campaign.cpa)} EGP`
    : campaign.purchases === 0 ? "لا أوردر" : "—";

  return (
    <div className={`rounded-2xl border overflow-hidden flex flex-col transition-all ${cfg.border} ${isPaused ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className={`${cfg.bg} px-4 pt-4 pb-3`}>
        <div className="flex items-start gap-3">
          <ScoreCircle score={score} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-snug line-clamp-2">{campaign.name}</p>
            <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
              <CatIcon className="h-2.5 w-2.5" />
              {cfg.label}
            </span>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">{cfg.desc}</p>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="bg-card px-4 py-3 space-y-2 flex-1">

        {/* ① Video funnel — Hook Rate */}
        {hasVR && (
          <MetricBar
            label="Hook Rate (3ث — وقف السكرول)"
            value={`${vr.toFixed(1)}%`}
            pct={Math.min((vr / 50) * 100, 100)}
            flag={vrFlag}
          />
        )}

        {/* ② Video funnel — Hold Rate (ThruPlay 95%) */}
        {holdRate > 0 && (
          <MetricBar
            label="Hold Rate (ThruPlay 95%)"
            value={`${holdRate.toFixed(1)}%`}
            pct={Math.min((holdRate / 40) * 100, 100)}
            flag={holdFlag}
          />
        )}

        {/* ③ Click funnel — Outbound CTR */}
        <MetricBar
          label="Outbound CTR"
          value={`${campaign.ctr.toFixed(2)}%`}
          pct={Math.min((campaign.ctr / 3) * 100, 100)}
          flag={ctrFlag}
        />

        {/* ④ Landing Page Rate */}
        {lpr > 0 && (
          <MetricBar
            label="Landing Page Rate (LPR)"
            value={`${lpr.toFixed(1)}%`}
            pct={Math.min(lpr, 100)}
            flag={lprFlag}
          />
        )}

        {/* ⑤ Mini stats row: Frequency · CPM · Purchases */}
        <div className="flex items-center justify-between gap-1.5 pt-1">
          <StatBadge label="Freq." value={campaign.frequency.toFixed(1)} flag={freqFlag} />
          <StatBadge label="CPM" value={`${Math.round(campaign.cpm)}`} flag={cpmFlag} />
          <StatBadge
            label="Orders"
            value={`${campaign.purchases}`}
            flag={campaign.purchases > 0 ? "good" : "bad"}
          />
          <StatBadge
            label="Spend"
            value={`${Math.round(campaign.spend / 1000) > 0 ? (campaign.spend / 1000).toFixed(1) + "K" : Math.round(campaign.spend) + ""}`}
            flag="neutral"
          />
        </div>

        {/* ⑥ CPA bottom row */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="text-xs text-muted-foreground">
            CPA:{" "}
            <span className={`font-bold font-mono ${
              cpaFlag === "good" ? "text-emerald-600 dark:text-emerald-400"
              : cpaFlag === "warn" ? "text-amber-600 dark:text-amber-400"
              : "text-rose-600 dark:text-rose-400"
            }`} dir="ltr">{cpaText}</span>
          </div>
          <div className="text-xs text-muted-foreground font-mono" dir="ltr">
            {Math.round(campaign.spend).toLocaleString()} EGP
          </div>
        </div>
      </div>

      {/* Diagnose button */}
      <button
        onClick={() => onDiagnose(campaign.id)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-t border-border bg-muted/20 hover:bg-primary/10 hover:text-primary transition-colors text-xs font-semibold text-muted-foreground"
      >
        <Stethoscope className="h-3.5 w-3.5" />
        عرض التحليل الكامل
      </button>
    </div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────
const SUMMARY_ORDER: Category[] = [
  "winner", "near", "sellfluct", "improve",
  "hookdead", "creative", "fatigue",
  "noconv", "critical", "tech", "landing", "paused",
];

function SummaryBar({ campaigns }: { campaigns: CampaignSummaryFull[] }) {
  const counts = useMemo(() => {
    const map: Partial<Record<Category, number>> = {};
    for (const c of campaigns) {
      const cat = getCategory(c);
      map[cat] = (map[cat] ?? 0) + 1;
    }
    return map;
  }, [campaigns]);

  return (
    <div className="flex flex-wrap gap-2">
      {SUMMARY_ORDER.filter((cat) => (counts[cat] ?? 0) > 0).map((cat) => {
        const c = CAT[cat];
        return (
          <div key={cat} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 border text-xs font-semibold ${c.bg} ${c.border} ${c.text}`}>
            <c.Icon className="h-3 w-3" />
            <span>{counts[cat]}</span>
            <span className="font-normal opacity-80">{c.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Filter tabs ───────────────────────────────────────────────
type FilterKey = "all" | Category;
const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "all",       label: "الكل" },
  { key: "winner",    label: "رابح ✅" },
  { key: "near",      label: "قريب 🟡" },
  { key: "sellfluct", label: "تذبذب بيع 💜" },
  { key: "improve",   label: "يحتاج تحسين 🟠" },
  { key: "hookdead",  label: "ميت Hook 🔴" },
  { key: "creative",  label: "كريتف ضعيف 🎬" },
  { key: "fatigue",   label: "إرهاق 🔄" },
  { key: "noconv",    label: "لا تحويلات ❌" },
  { key: "critical",  label: "حرجة 🆘" },
  { key: "tech",      label: "تقنية ⚙️" },
  { key: "landing",   label: "هبوط 🛒" },
  { key: "paused",    label: "متوقفة ⏸" },
];

// ── Date presets ──────────────────────────────────────────────
const PRESET_LABELS: Record<DatePreset, string> = {
  today:         "اليوم",
  yesterday:     "أمس",
  "7d":          "آخر 7 أيام",
  "14d":         "آخر 14 يوم",
  "28d":         "آخر 28 يوم",
  current_month: "الشهر الحالي",
  prev_month:    "الشهر السابق",
  custom:        "مخصص",
};

// ── Main Page ─────────────────────────────────────────────────
export default function DecisionsPage() {
  const { data: accountsData } = useAccounts();
  const accounts = accountsData?.accounts ?? [];

  const [accountId, setAccountId] = useState<string | null>(null);
  const [preset, setPreset]       = useState<DatePreset>("7d");
  const [filter, setFilter]       = useState<FilterKey>("all");
  const [diagId, setDiagId]       = useState<string | null>(null);

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

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              تشخيص الحملات الإعلانية
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              View Rate · CTR · CPA · القرار لكل حملة
            </p>
          </div>

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
            <RefreshCw className="h-5 w-5 animate-spin" />
            جاري تحميل الحملات...
          </div>
        )}

        {/* Empty — filter */}
        {!isLoading && campaigns.length === 0 && allCampaigns.length > 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Filter className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">لا توجد حملات في هذا التصنيف</p>
            <button onClick={() => setFilter("all")} className="mt-2 text-xs text-primary underline">
              عرض الكل
            </button>
          </div>
        )}

        {/* Empty — no campaigns */}
        {!isLoading && allCampaigns.length === 0 && selectedAccountId && (
          <div className="text-center py-16 text-muted-foreground">
            <BarChart2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">لا توجد حملات في هذه الفترة</p>
          </div>
        )}

        {/* Grid */}
        {campaigns.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => (
              <CampaignDecisionCard
                key={c.id}
                campaign={c}
                onDiagnose={setDiagId}
              />
            ))}
          </div>
        )}

      </div>

      {/* Full diagnosis modal */}
      {selectedAccountId && (
        <CampaignDiagnosisModal
          campaignId={diagId}
          accountId={selectedAccountId}
          since={range.since}
          until={range.until}
          open={diagId !== null}
          onClose={() => setDiagId(null)}
        />
      )}
    </div>
  );
}
