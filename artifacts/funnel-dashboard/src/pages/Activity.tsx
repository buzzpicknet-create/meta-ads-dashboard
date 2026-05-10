import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, Bell, XCircle, RefreshCw,
  Activity as ActivityIcon, Pause, Play, Plus, Edit3, Trash2,
  DollarSign, Target, Eye, Zap, ChevronDown, ChevronUp,
  CalendarRange, CalendarDays, Bot,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchActivity,
  logAction,
  type AlertSnapshot,
} from "@/lib/alerts-api";
import { useAccounts } from "@/hooks/use-meta";
import { CampaignLink } from "@/components/CampaignLink";
import { UtmBuilder } from "@/components/UtmBuilder";

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

type ActionCat = "create" | "activate" | "pause" | "budget" | "delete" | "edit";

function actionCat(eventType?: string, extraData?: string): ActionCat {
  const t = (eventType ?? "").toLowerCase();
  if (t.includes("create")) return "create";
  if (t.includes("delete") || t.includes("archive")) return "delete";
  if (t.includes("budget") || t.includes("group_budget")) return "budget";
  if (t.includes("run_status")) {
    try {
      const extra = extraData ? (JSON.parse(extraData) as Record<string, unknown>) : null;
      const nv = extra?.new_value;
      if (nv === "Active") return "activate";
      if (nv === "Inactive" || nv === "Paused") return "pause";
    } catch { /* ignore */ }
    return "edit";
  }
  if (t.includes("pause")) return "pause";
  if (t.includes("resume") || t.includes("reactivat") || t.includes("first_delivery")) return "activate";
  return "edit";
}

const ACTION_CAT_LABELS: Record<ActionCat | "all", string> = {
  all:      "الكل",
  create:   "إنشاء",
  activate: "تفعيل",
  pause:    "إيقاف",
  budget:   "ميزانية",
  delete:   "حذف",
  edit:     "تعديل",
};
const ACTION_CAT_COLORS: Record<ActionCat | "all", string> = {
  all:      "bg-primary text-primary-foreground",
  create:   "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  activate: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pause:    "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  budget:   "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  delete:   "bg-rose-700/15 text-rose-800 dark:text-rose-300",
  edit:     "bg-muted text-muted-foreground",
};

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

// ── Pipeboard (AI assistant) action log ──────────────────────
interface PipeboardAction {
  id: number;
  executed_at: string;
  executed_by: string;
  tool_name: string;
  args: Record<string, unknown>;
  success: boolean;
  result_message: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  is_no_op: boolean;
}

const TOOL_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  pause_campaign:        { label: "إيقاف حملة",         icon: Pause,      color: "text-rose-500" },
  enable_campaign:       { label: "تفعيل حملة",         icon: Play,       color: "text-emerald-500" },
  update_campaign_budget:{ label: "تعديل ميزانية حملة", icon: DollarSign, color: "text-amber-500" },
  pause_adset:           { label: "إيقاف مجموعة",       icon: Pause,      color: "text-rose-400" },
  enable_adset:          { label: "تفعيل مجموعة",       icon: Play,       color: "text-emerald-400" },
  update_adset_budget:   { label: "تعديل ميزانية مجموعة", icon: DollarSign, color: "text-amber-400" },
  duplicate_adset:       { label: "نسخ مجموعة",         icon: Plus,       color: "text-blue-500" },
};

function PipeboardActionCard({ action }: { action: PipeboardAction }) {
  const meta = TOOL_LABELS[action.tool_name] ?? { label: action.tool_name, icon: Zap, color: "text-muted-foreground" };
  const Icon = meta.icon;
  const budgetArg = typeof action.args.daily_budget === "number"
    ? action.args.daily_budget
    : typeof action.args.budget === "number"
    ? action.args.budget
    : null;

  const borderClass = action.is_no_op
    ? "border-slate-400/30 bg-slate-500/5"
    : action.success
    ? "border-border bg-card"
    : "border-rose-500/30 bg-rose-500/5";

  return (
    <div className={`rounded-xl border px-4 py-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${action.is_no_op ? "text-slate-400" : meta.color}`}>
          <Icon className={`h-3 w-3 ${action.is_no_op ? "text-slate-400" : meta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-sm font-bold ${action.is_no_op ? "text-slate-500 dark:text-slate-400" : meta.color}`}>{meta.label}</span>
            {action.is_no_op && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-600 dark:text-slate-400 font-bold flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5" />
                تحذير: إجراء مكرر
              </span>
            )}
            {!action.is_no_op && !action.success && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400 font-bold">فشل</span>
            )}
            {action.campaign_name && (
              <span className="text-xs font-semibold text-foreground/80 truncate max-w-[220px]">
                {action.campaign_name}
              </span>
            )}
            {action.adset_name && (
              <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                ← {action.adset_name}
              </span>
            )}
          </div>
          {action.is_no_op && (
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
              الحملة كانت بالفعل في الحالة المطلوبة — نُفّذ الإجراء رغم ذلك
            </p>
          )}
          {budgetArg !== null && (
            <p className="text-sm font-bold text-amber-600 dark:text-amber-400 mt-0.5">
              ميزانية جديدة: {Number(budgetArg).toLocaleString("ar-EG")} ج.م/يوم
            </p>
          )}
          {action.result_message && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[400px]">
              {action.result_message}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
            <span className="font-medium text-foreground/70 flex items-center gap-1">
              <Bot className="h-3 w-3" /> {action.executed_by}
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(action.executed_at)}
            </span>
            <span className="hidden sm:inline opacity-70">{formatDateShort(action.executed_at)}</span>
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
            {snap.campaign_name && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">—&nbsp;
                <CampaignLink
                  campaignId={snap.campaign_id ?? undefined}
                  campaignName={snap.campaign_name}
                  accountId={accountId}
                  className="text-[11px]"
                />
              </span>
            )}
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

// ── Campaign Attention ────────────────────────────────────────
const CAMP_T = {
  cpa:  { warn: 50, danger: 55 },
  minSpend: 50,
};

interface CampMetric {
  id: string; name: string; spend: number; purchases: number;
  cpa: number; cpm: number; frequency: number; ctr: number;
  impressions: number; effective_status: string;
}
interface CampIssue { type: string; severity: "warn" | "danger"; label: string; }

function detectIssues(c: CampMetric): CampIssue[] {
  if (c.spend < CAMP_T.minSpend) return [];
  const issues: CampIssue[] = [];
  if (c.purchases === 0 && c.spend >= 200) {
    issues.push({ type: "no-orders", severity: "danger", label: "لا أوردرات" });
  } else if (c.cpa > CAMP_T.cpa.danger) {
    issues.push({ type: "cpa-high", severity: "danger", label: `CPA ${c.cpa.toFixed(0)} ج.م` });
  } else if (c.cpa > CAMP_T.cpa.warn) {
    issues.push({ type: "cpa-high", severity: "warn", label: `CPA ${c.cpa.toFixed(0)} ج.م` });
  }
  return issues;
}

interface DrillSeg {
  id: string; label: string; spend: number; purchases: number;
  cpa: number; cpm: number; frequency: number; impressions: number;
}

function segStatus(s: DrillSeg): "danger" | "warn" | "ok" {
  if (s.purchases === 0 && s.spend >= 100) return "danger";
  if (s.cpa > CAMP_T.cpa.danger) return "danger";
  if (s.cpa > CAMP_T.cpa.warn)   return "warn";
  return "ok";
}

function DrillRow({ seg }: { seg: DrillSeg }) {
  const st = segStatus(seg);
  return (
    <div className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg ${
      st === "danger" ? "bg-rose-500/8 text-rose-700 dark:text-rose-300" :
      st === "warn"   ? "bg-amber-500/8 text-amber-700 dark:text-amber-300" :
      "bg-muted/50 text-muted-foreground"
    }`}>
      {st === "danger" && <XCircle      className="h-3 w-3 shrink-0 text-rose-500" />}
      {st === "warn"   && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />}
      {st === "ok"     && <CheckCircle2  className="h-3 w-3 shrink-0 text-emerald-500" />}
      <span className="truncate flex-1">{seg.label}</span>
      <span className="shrink-0 tabular-nums ltr text-[11px]">
        {seg.purchases > 0
          ? `CPA ${(seg.cpa ?? 0).toFixed(0)} · CPM ${(seg.cpm ?? 0).toFixed(0)}`
          : <span className="text-rose-500 font-bold">لا أوردرات</span>}
      </span>
    </div>
  );
}

interface DrillTotals {
  ctr: number; cpm: number; cpc: number; cpa: number; frequency: number;
  spend: number; purchases: number; impressions: number; link_clicks: number;
}
interface DrillDaily {
  day: string; spend: number; impressions: number;
  link_clicks: number; purchases: number; cpa: number;
}
interface DrillData {
  totals: DrillTotals;
  daily: DrillDaily[];
  by_adset: DrillSeg[];
  by_ad: DrillSeg[];
}

function buildDiagnosis(daily: DrillDaily[]): string[] {
  if (daily.length < 4) return [];
  const sorted = [...daily].sort((a, b) => a.day.localeCompare(b.day));
  const half = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, half);
  const second = sorted.slice(sorted.length - half);

  function wavg(days: DrillDaily[], fn: (d: DrillDaily) => number, wfn: (d: DrillDaily) => number) {
    const tw = days.reduce((s, d) => s + wfn(d), 0);
    return tw > 0 ? days.reduce((s, d) => s + fn(d) * wfn(d), 0) / tw : 0;
  }

  const cpa1 = wavg(first,  d => (d.purchases > 0 ? d.spend / d.purchases : 0), d => d.purchases);
  const cpa2 = wavg(second, d => (d.purchases > 0 ? d.spend / d.purchases : 0), d => d.purchases);
  const cpm1 = wavg(first,  d => (d.impressions > 0 ? d.spend / d.impressions * 1000 : 0), d => d.impressions);
  const cpm2 = wavg(second, d => (d.impressions > 0 ? d.spend / d.impressions * 1000 : 0), d => d.impressions);
  const ctr1 = wavg(first,  d => (d.impressions > 0 ? d.link_clicks / d.impressions * 100 : 0), d => d.impressions);
  const ctr2 = wavg(second, d => (d.impressions > 0 ? d.link_clicks / d.impressions * 100 : 0), d => d.impressions);

  const msgs: string[] = [];
  if (cpa1 > 0 && cpa2 > 0 && cpa2 / cpa1 > 1.15)
    msgs.push(`CPA ارتفع من ${cpa1.toFixed(0)} إلى ${cpa2.toFixed(0)} ج.م في النصف الأخير من الفترة`);
  if (cpm1 > 0 && cpm2 > 0 && cpm2 / cpm1 > 1.15 && (cpa2 === 0 || cpa2 > 55))
    msgs.push(`تكلفة الألف ظهور (CPM) ترتفع تدريجياً — الأيام الأخيرة ${cpm2.toFixed(0)} مقابل ${cpm1.toFixed(0)} ج.م`);
  if (ctr1 > 0 && ctr2 > 0 && ctr2 / ctr1 < 0.85)
    msgs.push(`معدل النقر (CTR) يتراجع — انخفض من ${ctr1.toFixed(2)}% إلى ${ctr2.toFixed(2)}%`);
  return msgs;
}

function DrillDown({ campaignId, accountId, since, until }: {
  campaignId: string; accountId: string; since: string; until: string;
}) {
  const { data, isLoading, isError, error, failureCount } = useQuery({
    queryKey: ["camp-drill", campaignId, since, until],
    queryFn: async (): Promise<DrillData> => {
      const r = await fetch(
        `${BASE}/api/meta/insights?campaign_id=${campaignId}&since=${since}&until=${until}&ad_account_id=${accountId}`
      );
      if (r.status === 429) { const e = new Error("rate_limited"); (e as Error & { isRateLimited: boolean }).isRateLimited = true; throw e; }
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<DrillData>;
    },
    staleTime: 10 * 60_000,
    retry: (count, err) => ((err as Error & { isRateLimited?: boolean }).isRateLimited ? count < 4 : count < 1),
    retryDelay: (count, err) => ((err as Error & { isRateLimited?: boolean }).isRateLimited ? (count + 1) * 30_000 : 3_000),
  });

  const isRateLimited = (error as Error & { isRateLimited?: boolean })?.isRateLimited;

  if (isLoading || (isRateLimited && !data)) return (
    <div className="mt-3 pt-3 border-t border-border">
      {isRateLimited ? (
        <div className="flex items-center gap-2 py-2 text-xs text-amber-600 dark:text-amber-400">
          <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent flex-shrink-0" />
          Meta وضعت قيوداً مؤقتة — إعادة المحاولة خلال {Math.min(failureCount * 30, 120)} ث
        </div>
      ) : (
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => <div key={i} className="h-8 rounded-lg bg-muted animate-pulse" />)}
        </div>
      )}
    </div>
  );
  if (isError || !data) return (
    <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground text-center py-2">
      تعذّر تحميل التفاصيل
    </div>
  );

  const t = data.totals ?? {} as DrillTotals;
  const diagnosis = buildDiagnosis(data.daily ?? []);

  type MSev = "great" | "ok" | "neutral" | "warn" | "danger";
  function ctrSev(v: number): MSev {
    if (v >= 4)   return "great";
    if (v >= 3)   return "ok";
    if (v >= 2)   return "neutral";
    return "danger";
  }
  function ctrNote(v: number) {
    if (v >= 4)   return "ممتاز";
    if (v >= 3)   return "جيد";
    if (v >= 2)   return "طبيعي";
    if (v >= 1.5) return "منخفض";
    return "خطر";
  }
  function cpcSev(v: number): MSev {
    if (v < 1)  return "great";
    if (v < 2)  return "ok";
    if (v <= 3) return "neutral";
    if (v <= 4) return "warn";
    return "danger";
  }
  function cpcNote(v: number) {
    if (v < 1)  return "ممتاز";
    if (v < 2)  return "جيد";
    if (v <= 3) return "مقبول";
    if (v <= 4) return "يحتاج تحسين";
    return "يحتاج تحسين للميديا";
  }
  function cpmSev(v: number): MSev {
    return (v > 70 && (t.cpa ?? 0) > 55) ? "warn" : "ok";
  }
  function cpmNote(v: number) {
    return (v > 70 && (t.cpa ?? 0) > 55) ? "يحتاج تحسين" : "طبيعي";
  }

  const ctr = t.ctr ?? 0;
  const cpm = t.cpm ?? 0;
  const cpc = t.cpc ?? 0;

  const metrics: { label: string; value: string; note: string; sev: MSev }[] = [
    { label: "CTR", value: `${ctr.toFixed(2)}%`,  note: ctrNote(ctr), sev: ctrSev(ctr) },
    { label: "CPM", value: `${cpm.toFixed(0)} ج.م`, note: cpmNote(cpm), sev: cpmSev(cpm) },
    { label: "CPC", value: `${cpc.toFixed(1)} ج.م`, note: cpcNote(cpc), sev: cpcSev(cpc) },
  ];

  const sevCls: Record<MSev, { bg: string; text: string; note: string }> = {
    great:   { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", note: "text-emerald-600 dark:text-emerald-400" },
    ok:      { bg: "bg-emerald-500/6",  text: "text-emerald-700 dark:text-emerald-300", note: "text-emerald-600 dark:text-emerald-400" },
    neutral: { bg: "bg-muted/60",       text: "",                                        note: "text-muted-foreground" },
    warn:    { bg: "bg-amber-500/8",    text: "text-amber-700 dark:text-amber-400",      note: "text-amber-600 dark:text-amber-400" },
    danger:  { bg: "bg-rose-500/8",     text: "text-rose-600 dark:text-rose-400",        note: "text-rose-500" },
  };

  const allAdsets = (data.by_adset ?? []).filter(s => s.spend > 20);
  const allAds    = (data.by_ad    ?? []).filter(s => s.spend > 10);
  const badAdsets = allAdsets.filter(s => segStatus(s) !== "ok");
  const badAds    = allAds.filter(s => segStatus(s) !== "ok");

  function scopeLabel(bad: number, total: number) {
    if (total === 0) return "";
    if (bad === total) return "كلها متأثرة ⛔";
    return `${bad} من ${total} متأثرة`;
  }

  const hasAffected = badAdsets.length > 0 || badAds.length > 0;

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-3">
      {/* Metrics panel */}
      <div className="grid grid-cols-3 gap-2">
        {metrics.map(m => {
          const cls = sevCls[m.sev];
          return (
            <div key={m.label} className={`rounded-lg px-3 py-2 text-center ${cls.bg}`}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{m.label}</p>
              <p className={`text-sm font-bold tabular-nums ltr mt-0.5 ${cls.text}`}>{m.value}</p>
              <p className={`text-[10px] mt-0.5 ${cls.note}`}>{m.note}</p>
            </div>
          );
        })}
      </div>

      {/* Trend diagnosis */}
      {diagnosis.length > 0 && (
        <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2 space-y-1">
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">تشخيص — تدهور تدريجي</p>
          {diagnosis.map((msg, i) => (
            <p key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">•</span>{msg}
            </p>
          ))}
        </div>
      )}

      {/* Affected adsets */}
      {badAdsets.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
            مجموعات إعلانية متأثرة
            <span className="mr-1.5 normal-case font-normal">{scopeLabel(badAdsets.length, allAdsets.length)}</span>
          </p>
          <div className="space-y-1">
            {badAdsets.map(s => <DrillRow key={s.id} seg={s} />)}
          </div>
        </div>
      )}

      {/* Affected ads */}
      {badAds.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
            إعلانات متأثرة
            <span className="mr-1.5 normal-case font-normal">{scopeLabel(badAds.length, allAds.length)}</span>
          </p>
          <div className="space-y-1">
            {badAds.map(s => <DrillRow key={s.id} seg={s} />)}
          </div>
        </div>
      )}
      {!hasAffected && (
        <p className="text-xs text-muted-foreground text-center py-2">لا توجد إعلانات أو مجموعات متأثرة</p>
      )}
    </div>
  );
}

// ── Campaign note types ──────────────────────────────────────
interface CampaignNote {
  id: number;
  note: string;
  action_type: string | null;
  noted_by: string | null;
  created_at: string;
}

const CAMPAIGN_NOTE_TYPES = [
  { value: "creative-change",  label: "تغيير كريتف" },
  { value: "budget-change",    label: "تعديل ميزانية" },
  { value: "audience-change",  label: "تعديل أوديانس" },
  { value: "pause",            label: "إيقاف الحملة" },
  { value: "other",            label: "إجراء آخر" },
];

function CampaignNoteForm({
  campaignId, campaignName, accountId, onDone,
}: { campaignId: string; campaignName: string; accountId: string; onDone: () => void }) {
  const [actionType, setActionType] = useState("creative-change");
  const [note, setNote]             = useState("");
  const [by, setBy]                 = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, campaignName, accountId, note, actionType, notedBy: by }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["camp-meta", campaignId, accountId] });
      onDone();
    },
  });

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2.5">
      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">تسجيل إجراء</p>
      <div className="flex flex-wrap gap-1.5">
        {CAMPAIGN_NOTE_TYPES.map(t => (
          <button key={t.value} onClick={() => setActionType(t.value)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              actionType === t.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        value={note} onChange={e => setNote(e.target.value)} rows={2}
        placeholder="مثال: تم تغيير الكريتف من فيديو إلى صورة وتعديل الهيدلاين"
        className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <input value={by} onChange={e => setBy(e.target.value)} placeholder="اسم المنفّذ (اختياري)"
        className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">إلغاء</button>
        <Button size="sm" disabled={!note.trim() || mutation.isPending} onClick={() => mutation.mutate()} className="text-xs">
          {mutation.isPending ? "جارٍ الحفظ..." : "حفظ الملاحظة"}
        </Button>
      </div>
    </div>
  );
}

function CampaignAttentionCard({ campaign, accountId, since, until }: {
  campaign: CampMetric & { issues: CampIssue[] };
  accountId: string; since: string; until: string;
}) {
  const [expanded,  setExpanded]  = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const isDanger = campaign.issues.some(i => i.severity === "danger");

  const campMeta = useQuery({
    queryKey: ["camp-meta", campaign.id, accountId],
    queryFn: async (): Promise<{ first_seen_at: string | null; notes: CampaignNote[] }> => {
      const r = await fetch(`${BASE}/api/campaigns/meta?campaign_id=${campaign.id}&account_id=${accountId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ first_seen_at: string | null; notes: CampaignNote[] }>;
    },
    enabled: !!accountId,
    staleTime: 2 * 60_000,
  });

  const firstSeen  = campMeta.data?.first_seen_at ?? null;
  const notes      = campMeta.data?.notes ?? [];
  const hasNotes   = notes.length > 0;

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  }
  function actionLabel(type: string | null) {
    return CAMPAIGN_NOTE_TYPES.find(t => t.value === type)?.label ?? type ?? "إجراء";
  }

  return (
    <div className={`rounded-xl border p-4 ${isDanger
      ? "border-rose-500/30 bg-rose-500/5"
      : "border-amber-500/30 bg-amber-500/5"}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {isDanger
            ? <XCircle className="h-4 w-4 text-rose-500" />
            : <AlertTriangle className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-sm font-bold leading-snug">{campaign.name}</span>
            {campaign.effective_status !== "ACTIVE" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">موقوف</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {campaign.issues.map(issue => (
              <span key={issue.type} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                issue.severity === "danger"
                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              }`}>
                {issue.label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
            <span>
              إنفاق {campaign.spend.toLocaleString("en", { maximumFractionDigits: 0 })} EGP
              {campaign.purchases > 0 && <span className="mx-1.5">· {campaign.purchases} طلب</span>}
            </span>
            {firstSeen && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                رُصد {fmtDate(firstSeen)}
              </span>
            )}
            {hasNotes && (
              <button onClick={() => setShowNotes(p => !p)}
                className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline">
                <CheckCircle2 className="h-3 w-3" />
                {notes.length} ملاحظة{notes.length > 1 ? "ات" : ""}
              </button>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => { setShowForm(p => !p); setShowNotes(false); }}
            className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
              showForm
                ? "bg-primary/10 text-primary border border-primary/30"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
            title="تسجيل ملاحظة">
            ✍ ملاحظة
          </button>
          <button
            onClick={() => setExpanded(p => !p)}
            className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "إخفاء" : "تفاصيل"}
          </button>
        </div>
      </div>

      {/* Existing notes */}
      {showNotes && hasNotes && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          {notes.map(n => (
            <div key={n.id} className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                {n.action_type && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    {actionLabel(n.action_type)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {n.noted_by ?? "الميدياباير"} · {fmtDate(n.created_at)} {fmtTime(n.created_at)}
                </span>
              </div>
              <p className="text-xs text-foreground">{n.note}</p>
            </div>
          ))}
        </div>
      )}

      {/* Note form */}
      {showForm && (
        <CampaignNoteForm
          campaignId={campaign.id}
          campaignName={campaign.name}
          accountId={accountId}
          onDone={() => setShowForm(false)}
        />
      )}

      {/* Drill-down details */}
      {expanded && (
        <DrillDown campaignId={campaign.id} accountId={accountId} since={since} until={until} />
      )}
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
  const [filterActor, setFilterActor] = useState<string | null>(null);
  const [filterCat,   setFilterCat]   = useState<ActionCat | "all">("all");
  const [filterNoOp,  setFilterNoOp]  = useState(false);

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

  // AI assistant action history
  const pipeboardHistory = useQuery({
    queryKey: ["pipeboard-history"],
    queryFn: async (): Promise<{ actions: PipeboardAction[] }> => {
      const res = await fetch(`${BASE}/api/pipeboard/history?days=14`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ actions: PipeboardAction[] }>;
    },
    staleTime: 2 * 60_000,
  });

  // 7-day window for campaign health scan
  const until7d = cairoToday();
  const since7d  = cairoOffset(6);

  // Campaigns list — full metrics for health scan + activity name lookup
  const campaignsQuery = useQuery({
    queryKey: ["campaigns-all", accountId, since7d, until7d],
    queryFn: async (): Promise<{ campaigns: CampMetric[] }> => {
      const res = await fetch(
        `${BASE}/api/meta/campaigns?ad_account_id=${accountId}&since=${since7d}&until=${until7d}`
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ campaigns: CampMetric[] }>;
    },
    enabled: !!accountId,
    staleTime: 10 * 60_000,
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

  // Actor summaries — aggregate by actor + action category
  const actorSummaries = useMemo(() => {
    const map: Record<string, { name: string; counts: Partial<Record<ActionCat, number>>; total: number }> = {};
    metaList.filter(a => !!toDate(a.event_time)).forEach(act => {
      const name = act.actor_name || "Meta";
      if (!map[name]) map[name] = { name, counts: {}, total: 0 };
      const cat = actionCat(act.event_type, act.extra_data);
      map[name].counts[cat] = (map[name].counts[cat] ?? 0) + 1;
      map[name].total++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [metaList]);

  // Category counts (respects actor filter)
  const catCounts = useMemo(() => {
    const src = filterActor ? metaList.filter(a => (a.actor_name || "Meta") === filterActor) : metaList;
    const counts: Partial<Record<ActionCat | "all", number>> = { all: 0 };
    src.filter(a => !!toDate(a.event_time)).forEach(act => {
      counts.all = (counts.all ?? 0) + 1;
      const cat = actionCat(act.event_type, act.extra_data);
      counts[cat] = (counts[cat] ?? 0) + 1;
    });
    return counts;
  }, [metaList, filterActor]);

  // Filtered list
  const filteredList = useMemo(() => {
    return metaList.filter(act => {
      if (!toDate(act.event_time)) return false;
      if (filterActor && (act.actor_name || "Meta") !== filterActor) return false;
      if (filterCat !== "all" && actionCat(act.event_type, act.extra_data) !== filterCat) return false;
      return true;
    });
  }, [metaList, filterActor, filterCat]);

  // Pagination — 10 items per page, reset when filters change
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filterActor, filterCat, preset, custom, accountId]);

  const visibleList = filteredList.slice(0, visibleCount);
  const hasMore = visibleCount < filteredList.length;

  // Group by day (paginated)
  const byDay = visibleList.reduce<Record<string, MetaActivity[]>>((acc, act) => {
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

    // NOTE: We intentionally do NOT use activities as a source here.
    // Some adset events (e.g. update_campaign_budget_scheduling_state) contain
    // "campaign" in their event_type but carry the adset name (like "Broad"),
    // which would overwrite the correct campaign name in the map.

    return map;
  }, [campaignsQuery.data, adsetsQuery.data]);

  const validCount = filteredList.length;

  // Campaigns with health issues (last 7 days)
  const campaignsWithIssues = useMemo(() => {
    const all = campaignsQuery.data?.campaigns ?? [];
    return all
      .map(c => ({ ...c, issues: detectIssues(c) }))
      .filter(c => c.issues.length > 0)
      .sort((a, b) => {
        const aDanger = a.issues.some(i => i.severity === "danger") ? 1 : 0;
        const bDanger = b.issues.some(i => i.severity === "danger") ? 1 : 0;
        return bDanger - aDanger || b.spend - a.spend;
      });
  }, [campaignsQuery.data]);

  // Auto-register campaigns to record first_seen_at (fire & forget)
  useEffect(() => {
    if (!accountId || campaignsWithIssues.length === 0) return;
    void fetch(`${BASE}/api/campaigns/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        campaigns: campaignsWithIssues.map(c => ({
          id: c.id,
          name: c.name,
          issueTypes: c.issues.map(i => i.type),
        })),
      }),
    });
  }, [accountId, campaignsWithIssues]);

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

      {/* ── UTM Builder ─── */}
      <UtmBuilder />

      {accountId && (
        <>
          {/* ── Campaigns Needing Attention ─── */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              حملات تحتاج تدخل
              <span className="text-[11px] text-muted-foreground font-normal">آخر 7 أيام</span>
              {campaignsQuery.isLoading
                ? <span className="text-[11px] text-muted-foreground">جاري التحليل...</span>
                : campaignsWithIssues.length > 0
                  ? <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      campaignsWithIssues.some(c => c.issues.some(i => i.severity === "danger"))
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    }`}>
                      {campaignsWithIssues.length} حملة
                    </span>
                  : null}
            </h2>

            {campaignsQuery.isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
              </div>
            )}

            {!campaignsQuery.isLoading && campaignsWithIssues.length === 0 && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">كل الحملات بخير</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">لا توجد حملات تتجاوز العتبات في آخر 7 أيام</p>
                </div>
              </div>
            )}

            {campaignsWithIssues.length > 0 && (
              <div className="space-y-2">
                {campaignsWithIssues.map(c => (
                  <CampaignAttentionCard
                    key={c.id}
                    campaign={c}
                    accountId={accountId}
                    since={since7d}
                    until={until7d}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── AI Assistant Campaign Changes ─── */}
          {(pipeboardHistory.data?.actions?.length ?? 0) > 0 && (() => {
            const allActions = pipeboardHistory.data!.actions;
            const noOpCount  = allActions.filter(a => a.is_no_op).length;
            const visibleActions = filterNoOp ? allActions.filter(a => a.is_no_op) : allActions;
            return (
              <section className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    تغييرات الحملات
                    <span className="text-[11px] text-muted-foreground font-normal">عبر المساعد الذكي — آخر 14 يوم</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {visibleActions.length} إجراء
                    </span>
                  </h2>
                  <button
                    onClick={() => setFilterNoOp(p => !p)}
                    disabled={noOpCount === 0 && !filterNoOp}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
                      filterNoOp
                        ? "bg-slate-500/20 text-slate-700 dark:text-slate-300"
                        : noOpCount === 0
                        ? "bg-muted/40 text-muted-foreground/40 cursor-default"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    إجراء مكرر فقط
                    <span className="text-[10px] opacity-70">{noOpCount}</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {visibleActions.length === 0 ? (
                    <div className="rounded-xl border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                      لا توجد إجراءات مكررة في آخر 14 يوم
                    </div>
                  ) : (
                    visibleActions.map((action) => (
                      <PipeboardActionCard key={action.id} action={action} />
                    ))
                  )}
                </div>
              </section>
            );
          })()}

          {/* ── Meta Activity Feed ─── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold flex items-center gap-2">
                <ActivityIcon className="h-4 w-4 text-primary" />
                نشاط ميتا الحقيقي
              </h2>
              {validCount > 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {validCount} إجراء
                </span>
              )}
              {(filterActor || filterCat !== "all") && (
                <button
                  onClick={() => { setFilterActor(null); setFilterCat("all"); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-0.5 rounded bg-muted ml-auto"
                >
                  <XCircle className="h-3 w-3" /> إلغاء الفلتر
                </button>
              )}
            </div>

            {/* Actor summary cards */}
            {actorSummaries.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1 snap-x">
                {actorSummaries.map(actor => {
                  const isSelected = filterActor === actor.name;
                  const cats: ActionCat[] = ["create","activate","pause","budget","delete","edit"];
                  const catColors: Record<ActionCat, string> = {
                    create:   "text-blue-500",
                    activate: "text-emerald-500",
                    pause:    "text-rose-500",
                    budget:   "text-amber-500",
                    delete:   "text-rose-700",
                    edit:     "text-muted-foreground",
                  };
                  return (
                    <button
                      key={actor.name}
                      onClick={() => setFilterActor(isSelected ? null : actor.name)}
                      className={`snap-start shrink-0 text-right rounded-xl border px-4 py-3 transition-all min-w-[160px] ${
                        isSelected
                          ? "border-primary bg-primary/8 shadow-sm"
                          : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                      }`}
                    >
                      <p className="text-sm font-bold leading-tight truncate max-w-[140px]">{actor.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{actor.total} إجراء</p>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-2">
                        {cats.filter(c => actor.counts[c]).map(c => (
                          <span key={c} className={`text-[10px] ${catColors[c]}`}>
                            {ACTION_CAT_LABELS[c]} {actor.counts[c]}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Action category chips */}
            {metaList.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(["all", "create", "activate", "pause", "budget", "delete", "edit"] as (ActionCat | "all")[]).map(cat => {
                  const count = catCounts[cat] ?? 0;
                  if (cat !== "all" && count === 0) return null;
                  const isActive = filterCat === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setFilterCat(cat)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
                        isActive
                          ? ACTION_CAT_COLORS[cat]
                          : "bg-muted/60 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {ACTION_CAT_LABELS[cat]}
                      <span className={`text-[10px] ${isActive ? "opacity-80" : "opacity-60"}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

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

            {hasMore && (
              <div className="flex flex-col items-center gap-1.5 py-2">
                <button
                  onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                  className="flex items-center gap-2 text-sm font-bold px-6 py-2.5 rounded-xl bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  <ChevronDown className="h-4 w-4" />
                  المزيد
                </button>
                <span className="text-[11px] text-muted-foreground">
                  {visibleCount} من {filteredList.length} إجراء
                </span>
              </div>
            )}

            {!hasMore && validCount > PAGE_SIZE && (
              <p className="text-center text-[11px] text-muted-foreground py-1">
                تم عرض كل {validCount} إجراء
              </p>
            )}
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
