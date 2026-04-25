import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, ClipboardList,
  ChevronDown, ChevronUp, Bell, XCircle, RefreshCw,
  Activity as ActivityIcon, Pause, Play, Plus, Edit3, Trash2,
  DollarSign, Target, Eye, Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchActivity,
  logAction,
  type AlertSnapshot,
  type AlertAction,
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
  event_time?: number;
  extra_data?: string;
}

interface ActivitiesResponse {
  account_id: string;
  period: { since: string; until: string };
  fetched_at: string;
  activities: MetaActivity[];
}

// ── Helpers ────────────────────────────────────────────────────
function timeAgo(dateStr: string | number): string {
  const ts = typeof dateStr === "number" ? dateStr * 1000 : new Date(dateStr).getTime();
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `منذ ${days} ${days === 1 ? "يوم" : "أيام"}`;
  if (hrs > 0) return `منذ ${hrs} ${hrs === 1 ? "ساعة" : "ساعات"}`;
  if (mins > 0) return `منذ ${mins} ${mins === 1 ? "دقيقة" : "دقائق"}`;
  return "الآن";
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("ar-EG", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Translate Meta event types to Arabic
function translateEvent(eventType?: string, translated?: string): { label: string; icon: React.ElementType; color: string } {
  const t = eventType?.toLowerCase() ?? "";

  if (t.includes("pause")) return { label: "إيقاف", icon: Pause, color: "text-rose-500" };
  if (t.includes("resume") || t.includes("reactivat")) return { label: "تفعيل / استكمال", icon: Play, color: "text-emerald-500" };
  if (t.includes("create")) return { label: "إنشاء", icon: Plus, color: "text-blue-500" };
  if (t.includes("delete") || t.includes("archive")) return { label: "حذف / أرشفة", icon: Trash2, color: "text-rose-600" };
  if (t.includes("budget")) return { label: "تغيير الميزانية", icon: DollarSign, color: "text-amber-500" };
  if (t.includes("bid")) return { label: "تعديل العطاء", icon: Target, color: "text-purple-500" };
  if (t.includes("audience") || t.includes("target")) return { label: "تعديل الجمهور", icon: Eye, color: "text-cyan-500" };
  if (t.includes("creative") || t.includes("ad_creative")) return { label: "تغيير الكريتف", icon: Zap, color: "text-orange-500" };
  if (t.includes("edit") || t.includes("update")) return { label: "تعديل", icon: Edit3, color: "text-primary" };

  // Fallback: use Meta's translated text if available
  return { label: translated ?? eventType ?? "إجراء", icon: Edit3, color: "text-muted-foreground" };
}

// Which level: campaign / adset / ad / account
function objectLevel(eventType?: string): string {
  const t = eventType?.toLowerCase() ?? "";
  if (t.includes("campaign")) return "حملة";
  if (t.includes("adset") || t.includes("ad_set")) return "مجموعة إعلانية";
  if (t.includes("ad_creative") || t.includes("creative")) return "كريتف";
  if (t.includes("_ad") || t.startsWith("ad_")) return "إعلان";
  return "";
}

// Parse extra_data JSON safely
function parseExtra(extra?: string): Record<string, unknown> | null {
  if (!extra) return null;
  try { return JSON.parse(extra) as Record<string, unknown>; } catch { return null; }
}

// ── Meta Activity Card ────────────────────────────────────────
function MetaActivityCard({ act }: { act: MetaActivity }) {
  const [open, setOpen] = useState(false);
  const { label, icon: Icon, color } = translateEvent(act.event_type, act.translated_event_type);
  const level = objectLevel(act.event_type);
  const extra = parseExtra(act.extra_data);

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-full bg-current/10 flex items-center justify-center shrink-0 ${color}`}
             style={{ background: "currentColor", opacity: 0.1 }}>
          <Icon className={`h-3.5 w-3.5 ${color} opacity-100`} style={{ opacity: 1 }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold ${color}`}>{label}</span>
            {level && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{level}</span>
            )}
            {act.object_name && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[260px]" dir="ltr">{act.object_name}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
            {act.actor_name && (
              <span className="font-medium text-foreground">{act.actor_name}</span>
            )}
            {act.actor_name && <span>·</span>}
            {act.event_time && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo(act.event_time)}
              </span>
            )}
            {act.event_time && (
              <span className="hidden sm:inline">{formatDate(act.event_time)}</span>
            )}
          </div>

          {/* Extra data preview */}
          {extra && Object.keys(extra).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(extra).slice(0, 4).map(([k, v]) => (
                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground" dir="ltr">
                  {k}: <span className="font-medium text-foreground">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {extra && Object.keys(extra).length > 0 && (
          <button onClick={() => setOpen(!open)} className="shrink-0 text-muted-foreground hover:text-foreground">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {open && extra && (
        <div className="mt-2 mr-11 text-[11px] bg-muted/40 rounded-lg p-3 border border-border font-mono" dir="ltr">
          {Object.entries(extra).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-muted-foreground min-w-[140px]">{k}:</span>
              <span className="text-foreground">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Alert action form ─────────────────────────────────────────
const ACTION_TYPES = [
  { value: "budget-change", label: "تغيير الميزانية" },
  { value: "creative-change", label: "تغيير الكريتف" },
  { value: "pause", label: "إيقاف" },
  { value: "targeting", label: "تعديل الاستهداف" },
  { value: "bid-change", label: "تعديل العطاء" },
  { value: "other", label: "إجراء آخر" },
];

function ActionForm({
  accountId, alertKey, snapshotId, metricBefore, onDone,
}: {
  accountId: string; alertKey: string; snapshotId?: number;
  metricBefore?: number; onDone: () => void;
}) {
  const qc = useQueryClient();
  const [actionType, setActionType] = useState("creative-change");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("الميدياباير");

  const mutation = useMutation({
    mutationFn: () =>
      logAction({ accountId, alertKey, snapshotId, actionType, actionNote: note, metricBefore, actionedBy: by }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["activity", accountId] }); onDone(); },
  });

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-bold text-muted-foreground">سجّل ملاحظة إضافية على هذا التنبيه:</p>
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
        placeholder="ملاحظة — مثال: خفّضنا الميزانية 50% وغيّرنا الكريتف"
        className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">إلغاء</button>
        <Button size="sm" disabled={!note.trim() || mutation.isPending} onClick={() => mutation.mutate()} className="text-xs">
          {mutation.isPending ? "جارٍ الحفظ..." : "حفظ الملاحظة"}
        </Button>
      </div>
    </div>
  );
}

// ── Unresolved Alert card ─────────────────────────────────────
function UnresolvedCard({ snap, accountId }: { snap: AlertSnapshot; accountId: string }) {
  const [showForm, setShowForm] = useState(false);
  const ageHrs = Math.floor((Date.now() - new Date(snap.detected_at).getTime()) / 3600000);
  const isUrgent = ageHrs >= 24;
  const hasNote = parseInt(String(snap.action_count ?? "0")) > 0;

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
            {isUrgent && !hasNote && <span className="text-rose-600 dark:text-rose-400 font-bold">⚠ أكثر من 24 ساعة</span>}
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
      {showForm && (
        <ActionForm accountId={accountId} alertKey={snap.alert_key} snapshotId={snap.id}
          metricBefore={snap.metric_value ?? undefined} onDone={() => setShowForm(false)} />
      )}
    </div>
  );
}

function alertLabel(type: string): string {
  const map: Record<string, string> = {
    "ctr-low": "CTR منخفض", "cpc-high": "CPC مرتفع", "cpa-high": "CPA مرتفع",
    "high-frequency": "Frequency مرتفع", "low-cr": "CR منخفض",
    "no-conversions": "لا أوردرات", "cpM-high": "CPM مرتفع",
  };
  return map[type] ?? type;
}

// ── Date Presets ──────────────────────────────────────────────
const PRESETS = [
  { label: "٧ أيام", days: 7 },
  { label: "١٤ يوم", days: 14 },
  { label: "٣٠ يوم", days: 30 },
];

// ── Main Page ─────────────────────────────────────────────────
export default function ActivityPage() {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const [days, setDays] = useState(14);

  useEffect(() => {
    if (!accountId && accounts.data?.accounts?.length) {
      setAccountId(accounts.data.accounts[0]?.id ?? "");
    }
  }, [accounts.data, accountId]);

  // Meta real activity
  const metaActivity = useQuery({
    queryKey: ["meta-activities", accountId, days],
    queryFn: async (): Promise<ActivitiesResponse> => {
      const res = await fetch(`${BASE}/api/meta/activities?ad_account_id=${accountId}&days=${days}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ActivitiesResponse>;
    },
    enabled: !!accountId,
    staleTime: 5 * 60_000,
  });

  // Our internal alert system
  const alertActivity = useQuery({
    queryKey: ["activity", accountId],
    queryFn: () => fetchActivity(accountId, days),
    enabled: !!accountId,
    refetchInterval: 60_000,
  });

  const metaList = metaActivity.data?.activities ?? [];
  const unresolved = alertActivity.data?.unresolved ?? [];
  const urgentCount = unresolved.filter(
    (s) => Math.floor((Date.now() - new Date(s.detected_at).getTime()) / 3600000) >= 24
      && parseInt(String(s.action_count ?? "0")) === 0
  ).length;

  // Group meta activities by day
  const byDay = metaList.reduce<Record<string, MetaActivity[]>>((acc, act) => {
    if (!act.event_time) return acc;
    const day = new Date(act.event_time * 1000).toLocaleDateString("ar-EG", { weekday: "long", day: "2-digit", month: "long" });
    if (!acc[day]) acc[day] = [];
    acc[day].push(act);
    return acc;
  }, {});

  return (
    <main className="mx-auto max-w-[900px] px-4 py-8 space-y-8" dir="rtl">
      {/* Header */}
      <div className="text-right">
        <div className="text-xs text-muted-foreground mb-1">سجل النشاط الحقيقي</div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <ActivityIcon className="h-7 w-7 text-primary" />
          نشاط الميدياباير
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          الإجراءات الفعلية على الحملات مباشرةً من Meta — إيقاف، تعديل ميزانية، تغيير استهداف، إلخ
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Account tabs */}
        {accounts.data?.accounts && accounts.data.accounts.length > 1 && (
          <div className="flex gap-2">
            {accounts.data.accounts.map((a) => (
              <button key={a.id} onClick={() => setAccountId(a.id)}
                className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${accountId === a.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {a.name ?? a.id}
              </button>
            ))}
          </div>
        )}

        {/* Day preset */}
        <div className="flex gap-1.5 mr-auto">
          {PRESETS.map((p) => (
            <button key={p.days} onClick={() => setDays(p.days)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${days === p.days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => { void metaActivity.refetch(); void alertActivity.refetch(); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!accountId && (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>اختر حساباً لعرض النشاط</p>
        </div>
      )}

      {accountId && (
        <>
          {/* ── Unresolved Alerts ─────────────────── */}
          {unresolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Bell className="h-4 w-4 text-rose-500" />
                تنبيهات تحتاج انتباه
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${urgentCount > 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                  {unresolved.length} {urgentCount > 0 ? `· ${urgentCount} عاجل` : ""}
                </span>
              </h2>
              <div className="space-y-3">
                {unresolved.map((s) => <UnresolvedCard key={s.id} snap={s} accountId={accountId} />)}
              </div>
            </section>
          )}

          {/* ── Meta Activity Feed ────────────────── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold flex items-center gap-2">
                <ActivityIcon className="h-4 w-4 text-primary" />
                نشاط ميتا الحقيقي
                {metaList.length > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {metaList.length} إجراء
                  </span>
                )}
              </h2>
              {metaActivity.data && (
                <span className="text-[11px] text-muted-foreground mr-auto">
                  {metaActivity.data.period.since} → {metaActivity.data.period.until}
                </span>
              )}
            </div>

            {metaActivity.isLoading && (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            )}

            {metaActivity.isError && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-4 text-sm text-rose-700 dark:text-rose-400">
                تعذّر تحميل نشاط ميتا: {(metaActivity.error as Error).message}
              </div>
            )}

            {!metaActivity.isLoading && !metaActivity.isError && metaList.length === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                <ActivityIcon className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">لا يوجد نشاط مسجّل في ميتا خلال هذه الفترة</p>
              </div>
            )}

            {Object.entries(byDay).map(([day, acts]) => (
              <div key={day} className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap">{day}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-2">
                  {acts.map((act, i) => <MetaActivityCard key={act.id ?? i} act={act} />)}
                </div>
              </div>
            ))}
          </section>

          {/* ── Info box ─────────────────────────── */}
          <Card className="border-primary/10 bg-primary/3">
            <CardContent className="pt-4 pb-4 px-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-bold text-foreground">البيانات من Meta مباشرة:</span>{" "}
                النشاط المعروض هنا مسحوب فعلياً من سجلات ميتا — كل إيقاف، تعديل ميزانية، تغيير استهداف أو كريتف. 
                يُحدَّث عند فتح الصفحة أو الضغط على زر التحديث.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
