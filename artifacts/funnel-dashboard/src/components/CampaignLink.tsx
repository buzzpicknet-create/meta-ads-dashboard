import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DollarSign, ShoppingCart, Target, MousePointerClick,
  Eye, TrendingDown, AlertTriangle, CheckCircle2, XCircle,
  BarChart2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────
interface DrillSeg {
  id: string; label: string; spend: number; purchases: number;
  cpa: number; cpm: number; frequency: number; impressions: number;
}
interface DrillTotals {
  ctr: number; cpm: number; cpc: number; cpa: number; frequency: number;
  spend: number; purchases: number; impressions: number; link_clicks: number;
}
interface DrillData {
  totals: DrillTotals;
  daily: unknown[];
  by_adset: DrillSeg[];
  by_ad: DrillSeg[];
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString("ar-EG", { maximumFractionDigits: dec });
}

function pct(n: number) { return n.toFixed(2) + "%"; }

// ── Single metric tile ─────────────────────────────────────────
function Tile({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
}) {
  return (
    <div className="rounded-xl bg-muted/40 border border-border p-3 flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground leading-none mb-1">{label}</div>
        <div className="text-sm font-bold tabular-nums ltr">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── Adset row ─────────────────────────────────────────────────
function AdsetRow({ seg }: { seg: DrillSeg }) {
  const ok = seg.purchases > 0 && seg.cpa < 120;
  const warn = seg.purchases > 0 && seg.cpa >= 120 && seg.cpa < 180;
  return (
    <div className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg ${
      !ok && !warn ? "bg-rose-500/8 text-rose-700 dark:text-rose-300" :
      warn           ? "bg-amber-500/8 text-amber-700 dark:text-amber-300" :
                       "bg-muted/50 text-muted-foreground"
    }`}>
      {!ok && !warn && <XCircle      className="h-3 w-3 shrink-0 text-rose-500" />}
      {warn          && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />}
      {ok            && <CheckCircle2  className="h-3 w-3 shrink-0 text-emerald-500" />}
      <span className="truncate flex-1">{seg.label}</span>
      <span className="shrink-0 tabular-nums ltr text-[11px]">
        {seg.purchases > 0
          ? `CPA ${fmt(seg.cpa)} · CPM ${fmt(seg.cpm)}`
          : <span className="text-rose-500 font-bold">لا أوردرات</span>}
      </span>
    </div>
  );
}

// ── Popup content (fetches on mount) ─────────────────────────
function CampaignPopup({
  campaignId, campaignName, accountId, since, until,
}: {
  campaignId: string; campaignName: string; accountId: string;
  since: string; until: string;
}) {
  const { data, isLoading, isError } = useQuery<DrillData>({
    queryKey: ["camp-popup", campaignId, since, until, accountId],
    queryFn: async () => {
      const r = await fetch(
        `${BASE}/api/meta/insights?campaign_id=${campaignId}&since=${since}&until=${until}&ad_account_id=${accountId}`
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<DrillData>;
    },
    staleTime: 10 * 60_000,
  });

  if (isLoading) return (
    <div className="space-y-3 py-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
      ))}
    </div>
  );

  if (isError || !data) return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      تعذّر تحميل بيانات الحملة
    </div>
  );

  const t = data.totals;
  const adsets = data.by_adset ?? [];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <Tile
          icon={<DollarSign className="h-4 w-4" />}
          label="الإنفاق"
          value={`${fmt(t.spend)} ج.م`}
        />
        <Tile
          icon={<ShoppingCart className="h-4 w-4" />}
          label="الطلبات"
          value={fmt(t.purchases)}
        />
        <Tile
          icon={<Target className="h-4 w-4" />}
          label="CPA"
          value={t.purchases > 0 ? `${fmt(t.cpa)} ج.م` : "—"}
          sub={t.purchases === 0 ? "لا توجد طلبات" : undefined}
        />
        <Tile
          icon={<MousePointerClick className="h-4 w-4" />}
          label="CTR"
          value={pct(t.ctr)}
        />
        <Tile
          icon={<Eye className="h-4 w-4" />}
          label="الظهورات"
          value={fmt(t.impressions)}
        />
        <Tile
          icon={<TrendingDown className="h-4 w-4" />}
          label="CPM"
          value={`${fmt(t.cpm)} ج.م`}
        />
      </div>

      {/* Adsets breakdown */}
      {adsets.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
            <BarChart2 className="h-3 w-3" />
            المجموعات الإعلانية
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {adsets.map(seg => <AdsetRow key={seg.id} seg={seg} />)}
          </div>
        </div>
      )}

      {/* Date range note */}
      <div className="text-[10px] text-muted-foreground text-center border-t border-border pt-2 ltr">
        {since} → {until}
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────
export interface CampaignLinkProps {
  campaignId?: string | null;
  campaignName: string;
  accountId?: string;
  since?: string;
  until?: string;
  className?: string;
  asSpan?: boolean;
}

function getDefaultDates(): { since: string; until: string } {
  const today = new Date();
  const until = today.toISOString().split("T")[0]!;
  const sevenAgo = new Date(today);
  sevenAgo.setDate(sevenAgo.getDate() - 7);
  const since = sevenAgo.toISOString().split("T")[0]!;
  return { since, until };
}

export function CampaignLink({
  campaignId, campaignName, accountId, since, until, className = "", asSpan = false,
}: CampaignLinkProps) {
  const [open, setOpen] = useState(false);

  // No campaign_id → plain text
  if (!campaignId || !accountId) {
    const Elem = asSpan ? "span" : "span";
    return <Elem className={className}>{campaignName}</Elem>;
  }

  const defaults = getDefaultDates();
  const resolvedSince = since ?? defaults.since;
  const resolvedUntil = until ?? defaults.until;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`underline decoration-dotted underline-offset-2 hover:text-primary transition-colors cursor-pointer text-right ${className}`}
      >
        {campaignName}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-md w-full"
          dir="rtl"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader className="text-right">
            <DialogTitle className="text-base leading-snug">
              {campaignName}
            </DialogTitle>
          </DialogHeader>

          <CampaignPopup
            campaignId={campaignId}
            campaignName={campaignName}
            accountId={accountId}
            since={resolvedSince}
            until={resolvedUntil}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
