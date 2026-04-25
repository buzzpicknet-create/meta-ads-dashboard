import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, Bell, XCircle, RefreshCw,
  Activity as ActivityIcon, Pause, Play, Plus, Edit3, Trash2,
  DollarSign, Target, Eye, Zap, ChevronDown, ChevronUp,
  CalendarRange, CalendarDays,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchActivity,
  logAction,
  type AlertSnapshot,
} from "@/lib/alerts-api";
import { useAccounts } from "@/hooks/use-meta";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────
interface MetaActivity {
  id?: string;
  actor_name?: string;
  actor_id?: string;
  object_name?: string;
  object_id?: string;
  event_type?: string;
  translated_event_type?: string;
  event_time?: string | number;
  extra_data?: string;
}

interface ActivitiesResponse {
  account_id: string;
  period: { since: string; until: string };
  fetched_at: string;
  activities: MetaActivity[];
}

// ── Date helpers (Cairo = UTC+2) ───────────────────────────────
function cairoToday(): string {
  return new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
}
function cairoOffset(n: number): string {
  return new Date(Date.now() + 2 * 3600000 - n * 86400000).toISOString().slice(0, 10);
}

type PresetKey = "today" | "yesterday" | "7d" | "custom";
interface DateRange { since: string; until: string }

function presetToRange(preset: PresetKey, custom: DateRange): DateRange {
  const today = cairoToday();
  const yesterday = cairoOffset(1);
  if (preset === "today")     return { since: today,     until: today };
  if (preset === "yesterday") return { since: yesterday, until: yesterday };
  if (preset === "7d")        return { since: cairoOffset(6), until: today };
  return custom;
}

const PRESET_LABELS: Record<PresetKey, string> = {
  today: "اليوم", yesterday: "أمس", "7d": "آخر ٧ أيام", custom: "مخصص",
};

// ── Formatting helpers ────────────────────────────────────────

// event_time from Meta is an ISO string like "2026-04-25T14:14:46+0000"
// (sometimes a Unix number — handle both)
function toDate(event_time?: string | number): Date | null {
  if (!event_time) return null;
  let d: Date;
  if (typeof event_time === "number") {
    if (event_time <= 0 || isNaN(event_time)) return null;
    d = new Date(event_time * 1000);
  } else {
    d = new Date(event_time);
  }
  return isNaN(d.getTime()) ? null : d;
}

function timeAgo(event_time?: string | number): string {
  const d = toDate(event_time);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `منذ ${days} ${days === 1 ? "يوم" : "أيام"}`;
  if (hrs > 0)  return `منذ ${hrs} ${hrs === 1 ? "ساعة" : "ساعات"}`;
  if (mins > 0) return `منذ ${mins} ${mins === 1 ? "دقيقة" : "دقائق"}`;
  return "الآن";
}

function formatDateShort(event_time?: string | number): string {
  const d = toDate(event_time);
  if (!d) return "";
  try {
    return d.toLocaleString("ar-EG", {
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function dayLabel(event_time?: string | number): string {
  const d = toDate(event_time);
  if (!d) return "";
  try {
    return d.toLocaleDateString("ar-EG", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });
  } catch {
    return "";
  }
}

// ── Status label translation ───────────────────────────────────
const STATUS_AR: Record<string, string> = {
  "Active":          "مفعّل",
  "Inactive":        "موقوف",
  "Paused":          "موقوف",
  "Deleted":         "محذوف",
  "Pending Review":  "قيد المراجعة",
  "Pending Process": "قيد المعالجة",
  "Disapproved":     "مرفوض",
  "Preapproved":     "معتمد مسبقاً",
  "Completed":       "مكتمل",
};
function statusAr(s?: unknown): string {
  if (!s || typeof s !== "string") return "";
  return STATUS_AR[s] ?? s;
}

// ── Event type translation ─────────────────────────────────────
function translateEvent(
  eventType?: string,
  extra?: Record<string, unknown> | null,
): { label: string; icon: React.ElementType; color: string } {
  const t = (eventType ?? "").toLowerCase();

  if (t.includes("run_status")) {
    const nv = extra?.new_value;
    if (nv === "Active")                return { label: "تفعيل",          icon: Play,       color: "text-emerald-500" };
    if (nv === "Inactive" || nv === "Paused")
                                        return { label: "إيقاف",          icon: Pause,      color: "text-rose-500" };
    return { label: "تغيير الحالة",                                        icon: Edit3,      color: "text-primary" };
  }
  if (t.includes("budget_schedul") || t.includes("group_budget_schedul"))
                                        return { label: "جدولة ميزانية",  icon: CalendarDays, color: "text-muted-foreground" };
  if (t.includes("pause"))             return { label: "إيقاف",           icon: Pause,      color: "text-rose-500" };
  if (t.includes("resume") || t.includes("reactivat"))
                                        return { label: "تفعيل",           icon: Play,       color: "text-emerald-500" };
  if (t === "first_delivery_event")    return { label: "بدء التوصيل",     icon: Play,       color: "text-emerald-600" };
  if (t.includes("create"))            return { label: "إنشاء",            icon: Plus,       color: "text-blue-500" };
  if (t.includes("delete") || t.includes("archive"))
                                        return { label: "حذف / أرشفة",    icon: Trash2,     color: "text-rose-600" };
  if (t.includes("budget"))            return { label: "تغيير الميزانية", icon: DollarSign, color: "text-amber-500" };
  if (t.includes("bid"))               return { label: "تعديل العطاء",    icon: Target,     color: "text-purple-500" };
  if (t.includes("target_spec") || t.includes("audience"))
                                        return { label: "تعديل الاستهداف",icon: Eye,        color: "text-cyan-500" };
  if (t.includes("creative"))          return { label: "تغيير الكريتف",   icon: Zap,        color: "text-orange-500" };
  if (t.includes("billing") || t.includes("charge"))
                                        return { label: "خصم رصيد",        icon: DollarSign, color: "text-rose-500" };
  if (t.includes("funding"))           return { label: "شحن رصيد",         icon: DollarSign, color: "text-emerald-500" };
  if (t.includes("edit") || t.includes("update"))
                                        return { label: "تعديل",            icon: Edit3,      color: "text-primary" };
  return { label: eventType ?? "إجراء", icon: Edit3, color: "text-muted-foreground" };
}

function objectLevel(eventType?: string): string {
  const t = (eventType ?? "").toLowerCase();
  if (t.includes("campaign_group") || t === "create_campaign_group") return "حملة";
  if (t.includes("campaign"))                    return "حملة";
  if (t.includes("adset") || t.includes("ad_set")) return "مجموعة إعلانية";
  if (t.includes("creative"))                    return "كريتف";
  if (t.includes("_ad") || t.startsWith("ad_")) return "إعلان";
  return "";
}

function parseExtra(extra?: string): Record<string, unknown> | null {
  if (!extra) return null;
  try { return JSON.parse(extra) as Record<string, unknown>; }
  catch { return null; }
}

// ── Human-readable summary ─────────────────────────────────────
interface ActivitySummary { text: string; direction: "up" | "down" | "neutral" }

function parseSummary(act: MetaActivity): ActivitySummary | null {
  const extra = parseExtra(act.extra_data);
  const t = act.event_type ?? "";

  // ── Budget change ──────────────────────────────────────────
  if (t.includes("budget") && !t.includes("schedul") && extra?.type === "composite_data") {
    const oldObj = extra.old_value as Record<string, unknown> | null;
    const newObj = extra.new_value as Record<string, unknown> | null;
    const oldRaw = typeof oldObj?.old_value === "number" ? oldObj.old_value : null;
    const newRaw = typeof newObj?.new_value === "number" ? newObj.new_value : null;
    if (oldRaw !== null && newRaw !== null) {
      const oldEGP = Math.round(oldRaw / 100);
      const newEGP = Math.round(newRaw / 100);
      const dir: "up" | "down" | "neutral" = newEGP > oldEGP ? "up" : newEGP < oldEGP ? "down" : "neutral";
      const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
      return {
        text: `${arrow} ${oldEGP.toLocaleString("ar-EG")} → ${newEGP.toLocaleString("ar-EG")} ج/يوم`,
        direction: dir,
      };
    }
    // Initial budget on create
    if (newRaw !== null) {
      return { text: `ميزانية ${Math.round(newRaw / 100).toLocaleString("ar-EG")} ج/يوم`, direction: "neutral" };
    }
  }

  // ── Run status change ──────────────────────────────────────
  if (t.includes("run_status") && extra) {
    const oldS = statusAr(extra.old_value);
    const newS = statusAr(extra.new_value);
    if (oldS && newS) {
      const dir: "up" | "down" | "neutral" =
        extra.new_value === "Active" ? "up" :
        (extra.new_value === "Inactive" || extra.new_value === "Paused") ? "down" : "neutral";
      return { text: `${oldS} ← ${newS}`, direction: dir };
    }
  }

  // ── Create campaign ────────────────────────────────────────
  if (t === "create_campaign_group" && extra) {
    const newObj = extra.new_value as Record<string, unknown> | null;
    const budget = typeof newObj?.new_value === "number" ? Math.round(newObj.new_value / 100) : null;
    return { text: budget ? `حملة جديدة · ${budget.toLocaleString("ar-EG")} ج/يوم` : "حملة جديدة", direction: "neutral" };
  }

  // ── Create ad set ──────────────────────────────────────────
  if (t === "create_ad_set")
    return { text: "مجموعة إعلانية جديدة", direction: "neutral" };

  // ── Create ad ─────────────────────────────────────────────
  if (t === "create_ad")
    return { text: "إعلان جديد أُضيف للحملة", direction: "neutral" };

  // ── First delivery ─────────────────────────────────────────
  if (t === "first_delivery_event")
    return { text: "الحملة بدأت التوصيل لأول مرة ✓", direction: "up" };

  // ── Funding / billing ──────────────────────────────────────
  if (t === "funding_event_successful" && extra) {
    const amount  = typeof extra.amount === "number" ? Math.round(extra.amount / 100) : null;
    const network = extra.network_id ? String(extra.network_id).split("/")[0].trim() : null;
    return {
      text: `شحن رصيد ${amount?.toLocaleString("ar-EG") ?? ""} ج${network ? ` عبر ${network}` : ""}`,
      direction: "up",
    };
  }
  if ((t === "ad_account_billing_charge") && extra) {
    const amount = typeof extra.new_value === "number" ? Math.round(extra.new_value / 100) : null;
    return { text: `خصم ${amount?.toLocaleString("ar-EG") ?? ""} ج من الرصيد`, direction: "down" };
  }

  // ── Targeting change ───────────────────────────────────────
  if (t.includes("target_spec") && extra) {
    const arr = extra.new_value as Array<{ content: string; children: string[] }> | null;
    if (Array.isArray(arr)) {
      const loc = arr.find(x => x.content?.includes("Location:"));
      const age = arr.find(x => x.content?.startsWith("Age:"));
      const parts: string[] = [];
      if (loc?.children?.[0]) parts.push(loc.children[0].split(":")[0]);
      if (age?.children?.[0]) parts.push(age.children[0]);
      return { text: `استهداف جديد${parts.length ? ": " + parts.join(" · ") : ""}`, direction: "neutral" };
    }
  }

  // ── Creative change ────────────────────────────────────────
  if (t.includes("creative"))
    return { text: "تغيير الصورة أو نص الإعلان", direction: "neutral" };

  // ── Bid strategy ───────────────────────────────────────────
  if (t.includes("bid_strategy") && extra) {
    const STRAT: Record<string, string> = {
      LOWEST_COST_BID_STRATEGY: "أقل تكلفة",
      COST_CAP: "سقف التكلفة",
      BID_CAP: "سقف العطاء",
    };
    const nv = extra.new_value as string | null;
    return { text: `استراتيجية العطاء: ${nv ? (STRAT[nv] ?? nv) : ""}`, direction: "neutral" };
  }

  // ── Optimization goal ──────────────────────────────────────
  if (t.includes("optimization_goal") && extra) {
    return { text: `هدف التحسين: ${extra.new_value as string ?? ""}`, direction: "neutral" };
  }

  return null;
}

// ── Campaign ID extractor — regex on raw string to avoid JS 64-bit precision loss
function extractCampaignIdRaw(extraRaw?: string): string | null {
  if (!extraRaw) return null;
  // Pattern A: "campaign_id":123456789012345678 (direct number in JSON)
  let m = extraRaw.match(/"campaign_id"\s*:\s*(\d{10,})/);
  if (m) return m[1];
  // Pattern B: "campaign_id":{"new":123...} or {"mutation_input":123...}
  m = extraRaw.match(/"campaign_id"\s*:\s*\{[^}]*?"(?:new|mutation_input)"\s*:\s*(\d{10,})/);
  if (m) return m[1];
  return null;
}

// ── Is this action on ad or adset level? ─────────────────────
function isSubCampaignLevel(eventType?: string): boolean {
  const t = (eventType ?? "").toLowerCase();
  return (
    t.includes("_ad_") || t.startsWith("ad_") ||
    t === "create_ad" || t === "create_ad_set" ||
    t.includes("adset") || t.includes("ad_set") ||
    t.includes("creative")
  );
}

// ── Meta Activity Card ────────────────────────────────────────
function MetaActivityCard({
  act,
  campaignNameMap = {},
}: {
  act: MetaActivity;
  campaignNameMap?: Record<string, string>;
}) {
  const extra   = parseExtra(act.extra_data);
  const { label, icon: Icon, color } = translateEvent(act.event_type, extra);
  const level   = objectLevel(act.event_type);
  const hasTime = !!toDate(act.event_time);
  const summary = parseSummary(act);

  // Parent campaign lookup for ad & adset level actions
  // - Ad activities:   extra_data.campaign_id = adset_id → lookup adset → campaign_name
  // - Adset activities: object_id = adset_id → lookup directly → campaign_name
  const parentCampaignName = useMemo(() => {
    if (!isSubCampaignLevel(act.event_type)) return null;
    const t = (act.event_type ?? "").toLowerCase();
    const isAdSet = t.includes("adset") || t.includes("ad_set") || t === "create_ad_set";

    // For adset-level: the object_id IS the adset_id
    if (isAdSet && act.object_id) {
      const name = campaignNameMap[String(act.object_id)];
      return name ?? null;
    }

    // For ad-level: extra_data.campaign_id is actually the adset_id (Meta's old naming)
    const adsetId = extractCampaignIdRaw(act.extra_data);
    if (!adsetId) return null;
    return campaignNameMap[adsetId] ?? null;
  }, [act.event_type, act.object_id, act.extra_data, campaignNameMap]);

  const summaryColor =
    summary?.direction === "up"   ? "text-emerald-600 dark:text-emerald-400" :
    summary?.direction === "down" ? "text-rose-600 dark:text-rose-400"       :
    "text-foreground";

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${color}`}>
          <Icon className={`h-3 w-3 ${color}`} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Top row: label + level badge + object name */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-sm font-bold ${color}`}>{label}</span>
            {level && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{level}</span>
            )}
            {act.object_name && (
              <span className="text-xs font-semibold text-foreground/80 truncate max-w-[220px]">
                {act.object_name}
              </span>
            )}
          </div>

          {/* Parent campaign breadcrumb — for ad/adset level actions */}
          {parentCampaignName && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-muted-foreground">في حملة:</span>
              <span className="text-[11px] font-semibold text-primary/80 truncate max-w-[260px]">
                {parentCampaignName}
              </span>
            </div>
          )}

          {/* Human-readable summary — the main value */}
          {summary && (
            <p className={`text-sm font-bold mt-1 ${summaryColor}`}>
              {summary.text}
            </p>
          )}

          {/* Meta row: actor + time */}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
            {act.actor_name && (
              <span className="font-medium text-foreground/70">{act.actor_name}</span>
            )}
            {hasTime && (
              <>
                {act.actor_name && <span>·</span>}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(act.event_time)}
                </span>
                <span className="hidden sm:inline opacity-70">{formatDateShort(act.event_time)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Unresolved Alert ─────────────────────────────────────────
const ACTION_TYPES = [
  { value: "budget-change",  label: "تغيير الميزانية" },
  { value: "creative-change",label: "تغيير الكريتف" },
  { value: "pause",          label: "إيقاف" },
  { value: "targeting",      label: "تعديل الاستهداف" },
  { value: "bid-change",     label: "تعديل العطاء" },
  { value: "other",          label: "إجراء آخر" },
];

function ActionForm({ accountId, alertKey, snapshotId, metricBefore, onDone }: {
  accountId: string; alertKey: string; snapshotId?: number;
  metricBefore?: number; onDone: () => void;
}) {
  const qc = useQueryClient();
  const [actionType, setActionType] = useState("creative-change");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("الميدياباير");
  const mutation = useMutation({
    mutationFn: () => logAction({ accountId, alertKey, snapshotId, actionType, actionNote: note, metricBefore, actionedBy: by }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["activity", accountId] }); onDone(); },
  });
  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-bold text-muted-foreground">سجّل ملاحظة:</p>
      <div className="flex gap-2 flex-wrap">
        {ACTION_TYPES.map((t) => (
          <button key={t.value} onClick={() => setActionType(t.value)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${actionType === t.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="اسم المنفّذ"
        className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
        placeholder="ملاحظة — مثال: خفّضنا الميزانية وغيّرنا الكريتف"
        className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">إلغاء</button>
        <Button size="sm" disabled={!note.trim() || mutation.isPending} onClick={() => mutation.mutate()} className="text-xs">
          {mutation.isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </div>
    </div>
  );
}

function alertLabel(type: string): string {
  const map: Record<string, string> = {
    "ctr-low": "CTR منخفض", "cpc-high": "CPC مرتفع", "cpa-high": "CPA مرتفع",
    "high-frequency": "Frequency مرتفع", "no-conversions": "لا أوردرات", "cpM-high": "CPM مرتفع",
  };
  return map[type] ?? type;
}

function UnresolvedCard({ snap, accountId }: { snap: AlertSnapshot; accountId: string }) {
  const [showForm, setShowForm] = useState(false);
  const ageHrs   = Math.floor((Date.now() - new Date(snap.detected_at).getTime()) / 3600000);
  const isUrgent = ageHrs >= 24;
  const hasNote  = parseInt(String(snap.action_count ?? "0")) > 0;
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${snap.severity === "danger" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <div className="flex items-start gap-3">
        {snap.severity === "danger"
          ? <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold">{alertLabel(snap.alert_type)}</span>
            {snap.campaign_name && <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">— {snap.campaign_name}</span>}
            {snap.metric_label && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${snap.severity === "danger" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                {snap.metric_label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(snap.detected_at)}</span>
            {isUrgent && !hasNote && <span className="text-rose-600 dark:text-rose-400 font-bold">⚠ +24 ساعة</span>}
            {hasNote && <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> تم التسجيل</span>}
          </div>
        </div>
        {!hasNote && (
          <button onClick={() => setShowForm(!showForm)}
            className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            {showForm ? "إلغاء" : "✍ ملاحظة"}
          </button>
        )}
      </div>
      {showForm && <ActionForm accountId={accountId} alertKey={snap.alert_key} snapshotId={snap.id} metricBefore={snap.metric_value ?? undefined} onDone={() => setShowForm(false)} />}
    </div>
  );
}

// ── Date Range Picker (custom) ────────────────────────────────
function CustomRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <label className="text-xs text-muted-foreground">من:</label>
      <input type="date" value={value.since} max={value.until}
        onChange={(e) => onChange({ ...value, since: e.target.value })}
        className="text-xs rounded-lg border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary" dir="ltr" />
      <label className="text-xs text-muted-foreground">إلى:</label>
      <input type="date" value={value.until} min={value.since} max={cairoToday()}
        onChange={(e) => onChange({ ...value, until: e.target.value })}
        className="text-xs rounded-lg border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary" dir="ltr" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
const PRESETS: PresetKey[] = ["today", "yesterday", "7d", "custom"];

export default function ActivityPage() {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const [preset, setPreset]       = useState<PresetKey>("7d");
  const [custom, setCustom]       = useState<DateRange>({ since: cairoOffset(13), until: cairoToday() });

  const range = presetToRange(preset, custom);

  useEffect(() => {
    if (!accountId && accounts.data?.accounts?.length) {
      setAccountId(accounts.data.accounts[0]?.id ?? "");
    }
  }, [accounts.data, accountId]);

  // Meta real activity
  const metaActivity = useQuery({
    queryKey: ["meta-activities", accountId, range.since, range.until],
    queryFn: async (): Promise<ActivitiesResponse> => {
      const res = await fetch(`${BASE}/api/meta/activities?ad_account_id=${accountId}&since=${range.since}&until=${range.until}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ActivitiesResponse>;
    },
    enabled: !!accountId && !!range.since && !!range.until,
    staleTime: 5 * 60_000,
  });

  // Internal alerts
  const alertActivity = useQuery({
    queryKey: ["activity", accountId],
    queryFn: () => fetchActivity(accountId, 7),
    enabled: !!accountId,
    refetchInterval: 60_000,
  });

  // Campaigns list — for campaign-level activity name lookup
  const campaignsQuery = useQuery({
    queryKey: ["campaigns-all", accountId],
    queryFn: async (): Promise<{ campaigns: Array<{ id: string; name: string }> }> => {
      const res = await fetch(`${BASE}/api/meta/campaigns?ad_account_id=${accountId}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!accountId,
    staleTime: 30 * 60_000,
  });

  // Adsets list — extra_data.campaign_id in ad activities is actually the adset_id (Meta's old naming)
  // We need adset_id → parent campaign_name for correct breadcrumb display
  const adsetsQuery = useQuery({
    queryKey: ["adsets-refs", accountId],
    queryFn: async (): Promise<{ adsets: Array<{ id: string; name: string; campaign_id: string; campaign_name?: string }> }> => {
      const res = await fetch(`${BASE}/api/meta/adsets?ad_account_id=${accountId}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!accountId,
    staleTime: 30 * 60_000,
  });

  const metaList   = metaActivity.data?.activities ?? [];
  const unresolved = alertActivity.data?.unresolved ?? [];
  const urgentCount = unresolved.filter(
    (s) => Math.floor((Date.now() - new Date(s.detected_at).getTime()) / 3600000) >= 24
      && parseInt(String(s.action_count ?? "0")) === 0
  ).length;

  // Group by day (only entries with valid event_time)
  const byDay = metaList.reduce<Record<string, MetaActivity[]>>((acc, act) => {
    if (!toDate(act.event_time)) return acc;
    const label = dayLabel(act.event_time);
    if (!label) return acc;
    if (!acc[label]) acc[label] = [];
    acc[label].push(act);
    return acc;
  }, {});

  // Build unified lookup map used by MetaActivityCard for the breadcrumb:
  //
  // KEY INSIGHT: Meta's extra_data uses old naming — "campaign_id" in ad activities
  // is actually the ADSET ID. So we need adset_id → parent campaign_name.
  //
  // Map entries:
  //  campaign_id  → campaign_name   (for campaign-level events, keyed by object_id)
  //  adset_id     → campaign_name   (for ad-level events, keyed by extra_data.campaign_id)
  const campaignNameMap = useMemo(() => {
    const map: Record<string, string> = {};

    // 1. campaign_id → campaign_name (from campaigns API)
    (campaignsQuery.data?.campaigns ?? []).forEach((c) => {
      if (c.id && c.name) map[String(c.id)] = c.name;
    });

    // 2. adset_id → parent campaign_name (from adsets API — resolves the old naming)
    const adsetList = adsetsQuery.data?.adsets ?? [];
    adsetList.forEach((as) => {
      if (!as.id) return;
      const campaignName = as.campaign_name
        // If adsets endpoint returned campaign.name directly
        ?? (as.campaign_id ? campaignsQuery.data?.campaigns?.find((c) => c.id === as.campaign_id)?.name : undefined);
      if (campaignName) map[String(as.id)] = campaignName;
    });

    // 3. From campaign-level activities (catches very recent / just-created campaigns)
    metaList.forEach((act) => {
      const t = (act.event_type ?? "").toLowerCase();
      if (
        (t.includes("campaign") || t === "first_delivery_event") &&
        act.object_id && act.object_name
      ) {
        map[String(act.object_id)] = act.object_name;
      }
    });

    return map;
  }, [campaignsQuery.data, adsetsQuery.data, metaList]);

  const validCount = metaList.filter((a) => !!toDate(a.event_time)).length;

  return (
    <main className="mx-auto max-w-[900px] px-4 py-8 space-y-8" dir="rtl">
      {/* Header */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">سجل النشاط الحقيقي</div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <ActivityIcon className="h-7 w-7 text-primary" />
          نشاط الميدياباير
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          الإجراءات الفعلية على الحملات مباشرةً من Meta
        </p>
      </div>

      {/* Controls */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* Account tabs */}
          {accounts.data?.accounts && accounts.data.accounts.length > 1 && (
            <div className="flex gap-1.5">
              {accounts.data.accounts.map((a) => (
                <button key={a.id} onClick={() => setAccountId(a.id)}
                  className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${accountId === a.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                  {a.name ?? a.id}
                </button>
              ))}
            </div>
          )}

          {/* Date presets */}
          <div className="flex gap-1 mr-auto">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setPreset(p)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                  preset === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}>
                {p === "custom" && <CalendarRange className="h-3 w-3" />}
                {p === "7d"     && <CalendarDays  className="h-3 w-3" />}
                {PRESET_LABELS[p]}
              </button>
            ))}
            <button onClick={() => { void metaActivity.refetch(); void alertActivity.refetch(); }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 mr-1"
              title="تحديث">
              <RefreshCw className={`h-3.5 w-3.5 ${metaActivity.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Custom date picker */}
        {preset === "custom" && (
          <CustomRangePicker value={custom} onChange={setCustom} />
        )}

        {/* Active range display */}
        {range.since && range.until && (
          <p className="text-[11px] text-muted-foreground" dir="ltr">
            {range.since} → {range.until}
            {validCount > 0 && <span className="mr-2 text-primary font-bold">{validCount} إجراء</span>}
          </p>
        )}
      </div>

      {!accountId && (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>اختر حساباً لعرض النشاط</p>
        </div>
      )}

      {accountId && (
        <>
          {/* ── Unresolved Alerts ─── */}
          {unresolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Bell className="h-4 w-4 text-rose-500" />
                تنبيهات تحتاج انتباه
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${urgentCount > 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                  {unresolved.length}{urgentCount > 0 ? ` · ${urgentCount} عاجل` : ""}
                </span>
              </h2>
              <div className="space-y-2">
                {unresolved.map((s) => <UnresolvedCard key={s.id} snap={s} accountId={accountId} />)}
              </div>
            </section>
          )}

          {/* ── Meta Activity Feed ─── */}
          <section className="space-y-4">
            <h2 className="text-base font-bold flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-primary" />
              نشاط ميتا الحقيقي
              {validCount > 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {validCount} إجراء
                </span>
              )}
            </h2>

            {metaActivity.isLoading && (
              <div className="space-y-2">
                {[1,2,3,4,5].map((i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
              </div>
            )}

            {metaActivity.isError && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-4 text-sm text-rose-700 dark:text-rose-400">
                تعذّر تحميل نشاط ميتا: {(metaActivity.error as Error).message}
              </div>
            )}

            {!metaActivity.isLoading && !metaActivity.isError && validCount === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                <ActivityIcon className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">لا يوجد نشاط مسجّل في ميتا خلال هذه الفترة</p>
              </div>
            )}

            {Object.entries(byDay).map(([day, acts]) => (
              <div key={day} className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap px-1">{day}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-2">
                  {acts.map((act, i) => <MetaActivityCard key={act.id ?? i} act={act} campaignNameMap={campaignNameMap} />)}
                </div>
              </div>
            ))}
          </section>

          <Card className="border-primary/10 bg-primary/3">
            <CardContent className="pt-4 pb-4 px-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-bold text-foreground">البيانات من Meta مباشرة:</span>{" "}
                كل إيقاف، تعديل ميزانية، تغيير استهداف أو كريتف — بأسماء المنفّذين الحقيقيين.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
