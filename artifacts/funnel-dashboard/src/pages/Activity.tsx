import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, ClipboardList,
  ChevronDown, ChevronUp, TrendingDown, TrendingUp, Minus,
  Bell, XCircle, RefreshCw, Users
} from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchActivity,
  logAction,
  type AlertSnapshot,
  type AlertAction,
} from "@/lib/alerts-api";
import { useAccounts } from "@/hooks/use-meta";

// ── Helpers ────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `منذ ${days} ${days === 1 ? "يوم" : "أيام"}`;
  if (hrs > 0) return `منذ ${hrs} ${hrs === 1 ? "ساعة" : "ساعات"}`;
  return `منذ ${mins} دقيقة`;
}

function alertTypeLabel(type: string): string {
  const map: Record<string, string> = {
    "ctr-low": "CTR منخفض",
    "cpc-high": "CPC مرتفع",
    "cpa-high": "CPA مرتفع",
    "high-frequency": "Frequency مرتفع",
    "low-cr": "CR منخفض",
    "no-conversions": "لا أوردرات",
    "cpM-high": "CPM مرتفع",
  };
  return map[type] ?? type;
}

function actionTypeLabel(type: string): string {
  const map: Record<string, string> = {
    "budget-change": "تغيير الميزانية",
    "creative-change": "تغيير الكريتف",
    "pause": "إيقاف الإعلان",
    "targeting": "تعديل الاستهداف",
    "bid-change": "تعديل العطاء",
    "other": "إجراء آخر",
  };
  return map[type] ?? type;
}

function outcomeBadge(outcome: string | null) {
  if (!outcome) return null;
  if (outcome === "improved")
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">تحسّن ✓</span>;
  if (outcome === "worsened")
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400">تراجع ✗</span>;
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">لم يتغيّر</span>;
}

// ── Action Form ───────────────────────────────────────────────
const ACTION_TYPES = [
  { value: "budget-change", label: "تغيير الميزانية" },
  { value: "creative-change", label: "تغيير الكريتف" },
  { value: "pause", label: "إيقاف الإعلان / الحملة" },
  { value: "targeting", label: "تعديل الاستهداف" },
  { value: "bid-change", label: "تعديل العطاء / Bid" },
  { value: "other", label: "إجراء آخر" },
];

function ActionForm({
  accountId,
  alertKey,
  snapshotId,
  metricBefore,
  onDone,
}: {
  accountId: string;
  alertKey: string;
  snapshotId?: number;
  metricBefore?: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [actionType, setActionType] = useState("creative-change");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("الميدياباير");

  const mutation = useMutation({
    mutationFn: () =>
      logAction({ accountId, alertKey, snapshotId, actionType, actionNote: note, metricBefore, actionedBy: by }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activity", accountId] });
      onDone();
    },
  });

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-bold text-muted-foreground">سجّل الإجراء الذي تم اتخاذه:</p>

      <div className="flex gap-2 flex-wrap">
        {ACTION_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setActionType(t.value)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              actionType === t.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        value={by}
        onChange={(e) => setBy(e.target.value)}
        placeholder="اسم المنفّذ (اختياري)"
        className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="وصف الإجراء — مثال: خفّضت الميزانية من 300 لـ 150 EGP/يوم وغيّرت الكريتف لفيديو جديد"
        rows={3}
        className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="flex items-center gap-2 justify-end">
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">إلغاء</button>
        <Button
          size="sm"
          disabled={!note.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="text-xs"
        >
          {mutation.isPending ? "جارٍ الحفظ..." : "حفظ الإجراء"}
        </Button>
      </div>
    </div>
  );
}

// ── Unresolved Alert Card ─────────────────────────────────────
function UnresolvedCard({
  snap,
  accountId,
}: {
  snap: AlertSnapshot;
  accountId: string;
}) {
  const [showForm, setShowForm] = useState(false);
  const ageHrs = Math.floor((Date.now() - new Date(snap.detected_at).getTime()) / 3600000);
  const isUrgent = ageHrs >= 24;
  const hasAction = parseInt(String(snap.action_count ?? "0")) > 0;

  return (
    <div
      className={`rounded-xl border p-4 space-y-2 ${
        snap.severity === "danger"
          ? "border-rose-500/30 bg-rose-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <div className="flex items-start gap-3">
        {snap.severity === "danger" ? (
          <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold">{alertTypeLabel(snap.alert_type)}</span>
            {snap.campaign_name && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">— {snap.campaign_name}</span>
            )}
            {snap.metric_label && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${snap.severity === "danger" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                {snap.metric_label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(snap.detected_at)}
            </span>
            {isUrgent && !hasAction && (
              <span className="text-rose-600 dark:text-rose-400 font-bold">⚠ أكثر من 24 ساعة بدون إجراء</span>
            )}
            {hasAction && (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> تم اتخاذ إجراء — في انتظار قياس الأثر (48 ساعة)
              </span>
            )}
          </div>
        </div>
        {!hasAction && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {showForm ? "إلغاء" : "✍ سجّل إجراء"}
          </button>
        )}
      </div>

      {showForm && (
        <ActionForm
          accountId={accountId}
          alertKey={snap.alert_key}
          snapshotId={snap.id}
          metricBefore={snap.metric_value ?? undefined}
          onDone={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// ── Action History Card ───────────────────────────────────────
function ActionCard({ action }: { action: AlertAction }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Users className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold">{actionTypeLabel(action.action_type)}</span>
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {alertTypeLabel(action.snap_alert_type ?? action.alert_key.split(":")[0])}
            </span>
            {outcomeBadge(action.outcome)}
          </div>
          {action.snap_campaign_name && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{action.snap_campaign_name}</p>
          )}
          <p className="text-xs text-foreground mt-1 line-clamp-2">{action.action_note}</p>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
            <span>{action.actioned_by}</span>
            <span>·</span>
            <span>{timeAgo(action.actioned_at)}</span>
            {action.metric_before != null && (
              <>
                <span>·</span>
                <span>القيمة وقت الإجراء: <span className="num font-bold text-foreground">{action.metric_before}</span></span>
              </>
            )}
            {action.metric_after != null && action.metric_before != null && (
              <>
                <span>·</span>
                {action.metric_after < action.metric_before ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5"><TrendingDown className="h-3 w-3" /> تحسّن</span>
                ) : action.metric_after > action.metric_before ? (
                  <span className="text-rose-600 dark:text-rose-400 flex items-center gap-0.5"><TrendingUp className="h-3 w-3" /> تراجع</span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-0.5"><Minus className="h-3 w-3" /> لم يتغيّر</span>
                )}
              </>
            )}
          </div>
        </div>
        <button onClick={() => setOpen(!open)} className="shrink-0 text-muted-foreground hover:text-foreground">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {open && (
        <div className="mt-3 mr-11 text-xs text-foreground bg-muted/40 rounded-lg p-3 border border-border">
          {action.action_note}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ActivityPage() {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string>("");

  useEffect(() => {
    if (!accountId && accounts.data?.accounts?.length) {
      setAccountId(accounts.data.accounts[0]?.id ?? "");
    }
  }, [accounts.data, accountId]);

  const activity = useQuery({
    queryKey: ["activity", accountId],
    queryFn: () => fetchActivity(accountId, 14),
    enabled: !!accountId,
    refetchInterval: 60_000,
  });

  const unresolved = activity.data?.unresolved ?? [];
  const actions = activity.data?.actions ?? [];
  const urgentCount = unresolved.filter(
    (s) => Math.floor((Date.now() - new Date(s.detected_at).getTime()) / 3600000) >= 24
      && parseInt(String(s.action_count ?? "0")) === 0
  ).length;

  return (
    <main className="mx-auto max-w-[900px] px-4 py-8 space-y-8" dir="rtl">
      {/* Header */}
      <div className="text-right">
        <div className="text-xs text-muted-foreground mb-1">مراقبة الفريق</div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <ClipboardList className="h-7 w-7 text-primary" />
          نشاط الميدياباير
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          راقب التنبيهات المكتشفة، سجّل الإجراءات، وتابع تأثيرها على الأداء
        </p>
      </div>

      {/* Account Selector */}
      {accounts.data?.accounts && accounts.data.accounts.length > 1 && (
        <div className="flex gap-2">
          {accounts.data.accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccountId(a.id)}
              className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
                accountId === a.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {a.name ?? a.id}
            </button>
          ))}
        </div>
      )}

      {!accountId && (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>لا يوجد حساب محدد</p>
        </div>
      )}

      {accountId && activity.isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      )}

      {accountId && !activity.isLoading && (
        <>
          {/* Unresolved Alerts */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Bell className="h-4 w-4 text-rose-500" />
                تنبيهات تحتاج إجراء
                {unresolved.length > 0 && (
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    urgentCount > 0
                      ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  }`}>
                    {unresolved.length} تنبيه {urgentCount > 0 ? `· ${urgentCount} عاجل` : ""}
                  </span>
                )}
              </h2>
              <button
                onClick={() => activity.refetch()}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                تحديث
              </button>
            </div>

            {unresolved.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl bg-emerald-500/8 ring-1 ring-emerald-500/20 px-5 py-4 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <div>
                  <div className="text-sm font-bold">ممتاز — لا توجد تنبيهات معلّقة</div>
                  <div className="text-xs opacity-75 mt-0.5">جميع التنبيهات المكتشفة تمت معالجتها أو لا توجد مشاكل حالياً</div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {unresolved.map((s) => (
                  <UnresolvedCard key={s.id} snap={s} accountId={accountId} />
                ))}
              </div>
            )}
          </section>

          {/* Action History */}
          <section className="space-y-3">
            <h2 className="text-base font-bold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              سجل الإجراءات — آخر 14 يوم
              {actions.length > 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {actions.length} إجراء
                </span>
              )}
            </h2>

            {actions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <ClipboardList className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">لا توجد إجراءات مسجّلة حتى الآن</p>
                <p className="text-xs mt-1 opacity-75">عند ظهور تنبيه، اضغط "سجّل إجراء" لتوثيق ما تم اتخاذه</p>
              </div>
            ) : (
              <div className="space-y-3">
                {actions.map((a) => <ActionCard key={a.id} action={a} />)}
              </div>
            )}
          </section>

          {/* Info box */}
          <Card className="border-primary/10 bg-primary/3">
            <CardContent className="pt-4 pb-4 px-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-bold text-foreground">كيف يعمل النظام:</span>{" "}
                يتم اكتشاف التنبيهات تلقائياً عند تحميل صفحة النظرة العامة. لكل تنبيه، سجّل الإجراء الذي اتُّخذ.
                بعد 48 ساعة، يمكنك مقارنة قيمة المقياس قبل وبعد الإجراء لمعرفة إن كانت الخطوة نجحت.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
