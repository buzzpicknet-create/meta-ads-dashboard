import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleDollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Save,
  X,
  RefreshCw,
  Info,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/use-meta";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ──────────────────────────────────────────────────────────────────────
interface PacingItem {
  id: string;
  name: string;
  effective_status: string;
  spend_so_far: number;
  purchases: number;
  cpa: number;
  monthly_target: number | null;
  expected_spend: number | null;
  pacing_pct: number | null;
  projected_monthly: number | null;
  status: "on_track" | "overpacing" | "underpacing" | "no_target";
}

interface PacingResponse {
  period: { since: string; until: string };
  days_elapsed: number;
  days_in_month: number;
  month_fraction: number;
  account_id: string;
  items: PacingItem[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n: number, d = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtEGP(n: number): string {
  return `${fmt(n, 0)} ج.م`;
}

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_CFG = {
  on_track: {
    label: "في المسار",
    bg: "bg-emerald-500/10 ring-emerald-500/25",
    text: "text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
    icon: CheckCircle2,
  },
  overpacing: {
    label: "إنفاق زائد",
    bg: "bg-rose-500/10 ring-rose-500/25",
    text: "text-rose-700 dark:text-rose-400",
    bar: "bg-rose-500",
    icon: TrendingUp,
  },
  underpacing: {
    label: "إنفاق أقل من المتوقع",
    bg: "bg-amber-500/10 ring-amber-500/25",
    text: "text-amber-700 dark:text-amber-400",
    bar: "bg-amber-400",
    icon: TrendingDown,
  },
  no_target: {
    label: "لا يوجد هدف",
    bg: "bg-muted/30 ring-border",
    text: "text-muted-foreground",
    bar: "bg-muted-foreground/40",
    icon: Info,
  },
} as const;

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PacingItem["status"] }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${cfg.bg} ${cfg.text}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────
function PacingBar({
  pct,
  status,
  monthFraction,
}: {
  pct: number | null;
  status: PacingItem["status"];
  monthFraction: number;
}) {
  const cfg = STATUS_CFG[status];
  const fillPct = pct !== null ? Math.min(pct, 150) : 0;
  const expectedMarkerPct = Math.min(monthFraction * 100, 100);

  return (
    <div className="relative h-2.5 w-full rounded-full bg-muted overflow-visible">
      {/* Actual spend bar */}
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-all ${cfg.bar}`}
        style={{ width: `${Math.min(fillPct / 1.5, 100)}%` }}
      />
      {/* Expected spend marker (dashed line) */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-4 w-0.5 bg-foreground/40 rounded-full"
        style={{ left: `${expectedMarkerPct}%` }}
        title={`المتوقع حتى الآن`}
      />
    </div>
  );
}

// ── Inline budget editor ───────────────────────────────────────────────────────
function BudgetEditor({
  item,
  accountId,
  onSaved,
}: {
  item: PacingItem;
  accountId: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(item.monthly_target ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (budget: number) => {
      const res = await fetch(`${BASE}/api/budget/targets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          campaign_id: item.id,
          account_id: accountId,
          monthly_budget: budget,
        }),
      });
      if (!res.ok) throw new Error("فشل الحفظ");
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["budget-pacing"] });
      setEditing(false);
      onSaved();
    },
  });

  function startEdit() {
    setValue(String(item.monthly_target ?? ""));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function save() {
    const n = parseFloat(value);
    if (isNaN(n) || n < 0) return;
    mutation.mutate(n);
  }

  function cancel() {
    setEditing(false);
    setValue(String(item.monthly_target ?? ""));
  }

  if (!editing) {
    return (
      <button
        onClick={startEdit}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="font-medium">
          {item.monthly_target ? fmtEGP(item.monthly_target) : "حدّد الهدف"}
        </span>
        <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="number"
        min={0}
        step={100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        className="w-28 h-7 rounded-lg border border-border bg-background px-2 text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
        placeholder="ج.م"
        dir="ltr"
      />
      <button
        onClick={save}
        disabled={mutation.isPending}
        className="h-7 w-7 flex items-center justify-center rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <Save className="h-3 w-3" />
        )}
      </button>
      <button
        onClick={cancel}
        className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Campaign pacing card ───────────────────────────────────────────────────────
function CampaignPacingCard({
  item,
  accountId,
  monthFraction,
  daysElapsed,
  daysInMonth,
  onRefresh,
}: {
  item: PacingItem;
  accountId: string;
  monthFraction: number;
  daysElapsed: number;
  daysInMonth: number;
  onRefresh: () => void;
}) {
  const cfg = STATUS_CFG[item.status];
  const Icon = cfg.icon;

  const spendPctOfTarget =
    item.monthly_target && item.monthly_target > 0
      ? (item.spend_so_far / item.monthly_target) * 100
      : null;

  const remainingBudget =
    item.monthly_target !== null ? item.monthly_target - item.spend_so_far : null;

  const dailyBudgetNeeded =
    remainingBudget !== null && daysInMonth - daysElapsed > 0
      ? remainingBudget / (daysInMonth - daysElapsed)
      : null;

  return (
    <div className={`rounded-xl ring-1 p-4 space-y-3 ${cfg.bg}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge status={item.status} />
            {item.effective_status === "ACTIVE" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                نشطة
              </span>
            )}
            {item.effective_status === "PAUSED" && (
              <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-[10px] font-bold px-2 py-0.5">
                متوقفة
              </span>
            )}
          </div>
          <div className="text-sm font-semibold leading-snug line-clamp-2">{item.name}</div>
        </div>
        <div className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-xl ring-1 ${cfg.bg}`}>
          <Icon className={`h-4 w-4 ${cfg.text}`} />
        </div>
      </div>

      {/* Pacing bar */}
      <div className="space-y-1.5">
        <PacingBar
          pct={item.pacing_pct}
          status={item.status}
          monthFraction={monthFraction}
        />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>الإنفاق الفعلي: <span className="font-bold text-foreground" dir="ltr">{fmtEGP(item.spend_so_far)}</span></span>
          {spendPctOfTarget !== null && (
            <span dir="ltr" className="font-bold">{fmt(spendPctOfTarget, 0)}%</span>
          )}
          <span>الهدف الشهري: <span className="font-bold text-foreground">{item.monthly_target ? fmtEGP(item.monthly_target) : "—"}</span></span>
        </div>
      </div>

      {/* Metrics row */}
      {item.monthly_target !== null && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-background/50 px-2 py-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">متوقع حتى الآن</div>
            <div className="text-xs font-bold" dir="ltr">
              {item.expected_spend !== null ? fmtEGP(item.expected_spend) : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-background/50 px-2 py-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">المتبقي</div>
            <div className={`text-xs font-bold ${remainingBudget !== null && remainingBudget < 0 ? "text-rose-600 dark:text-rose-400" : ""}`} dir="ltr">
              {remainingBudget !== null ? fmtEGP(remainingBudget) : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-background/50 px-2 py-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">يومي مطلوب</div>
            <div className="text-xs font-bold" dir="ltr">
              {dailyBudgetNeeded !== null && dailyBudgetNeeded > 0 ? fmtEGP(dailyBudgetNeeded) : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Projected + purchases row */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40 pt-2.5">
        <div>
          {item.projected_monthly !== null && item.monthly_target !== null && (
            <span>
              توقع نهاية الشهر:{" "}
              <span className={`font-bold ${
                item.projected_monthly > item.monthly_target * 1.1
                  ? "text-rose-600 dark:text-rose-400"
                  : item.projected_monthly < item.monthly_target * 0.9
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground"
              }`} dir="ltr">
                {fmtEGP(item.projected_monthly)}
              </span>
            </span>
          )}
        </div>
        <div className="text-left">
          {item.purchases > 0 && (
            <span>
              {item.purchases} أوردر ·{" "}
              <span className="font-bold text-foreground" dir="ltr">CPA {fmt(item.cpa, 0)} ج.م</span>
            </span>
          )}
        </div>
      </div>

      {/* Budget target editor */}
      <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
        <span className="text-[10px] text-muted-foreground">الهدف الشهري:</span>
        <BudgetEditor item={item} accountId={accountId} onSaved={onRefresh} />
      </div>
    </div>
  );
}

// ── Summary KPIs ───────────────────────────────────────────────────────────────
function SummaryKpis({ data }: { data: PacingResponse }) {
  const withTarget = data.items.filter((i) => i.monthly_target !== null);
  const totalTarget = withTarget.reduce((s, i) => s + (i.monthly_target ?? 0), 0);
  const totalSpend = withTarget.reduce((s, i) => s + i.spend_so_far, 0);
  const totalExpected = totalTarget * data.month_fraction;
  const overallPacingPct = totalExpected > 0 ? (totalSpend / totalExpected) * 100 : null;

  const onTrack = data.items.filter((i) => i.status === "on_track").length;
  const overpacing = data.items.filter((i) => i.status === "overpacing").length;
  const underpacing = data.items.filter((i) => i.status === "underpacing").length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">إجمالي الإنفاق</div>
          <div className="text-xl font-bold" dir="ltr">{fmtEGP(totalSpend)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            من {fmtEGP(totalTarget)} هدف شهري
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">تقدم الشهر</div>
          <div className="text-xl font-bold" dir="ltr">
            {fmt(data.month_fraction * 100, 0)}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            يوم {data.days_elapsed} من {data.days_in_month}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">نسبة الصرف الكلي</div>
          <div className={`text-xl font-bold ${overallPacingPct === null ? "" : overallPacingPct > 115 ? "text-rose-600" : overallPacingPct < 85 ? "text-amber-600" : "text-emerald-600"}`} dir="ltr">
            {overallPacingPct !== null ? `${fmt(overallPacingPct, 0)}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            متوقع: {fmtEGP(totalExpected)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-2">حالة الحملات</div>
          <div className="space-y-1">
            {onTrack > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-3 w-3" />
                {onTrack} في المسار
              </div>
            )}
            {overpacing > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-rose-700 dark:text-rose-400 font-medium">
                <TrendingUp className="h-3 w-3" />
                {overpacing} إنفاق زائد
              </div>
            )}
            {underpacing > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                <TrendingDown className="h-3 w-3" />
                {underpacing} إنفاق أقل
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function BudgetPacingPage() {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const qc = useQueryClient();

  const resolvedAccountId =
    accountId ||
    (accounts.data && accounts.data.accounts.length > 0 ? accounts.data.accounts[0]!.id : "");

  const { data, isLoading, error, isFetching } = useQuery<PacingResponse>({
    queryKey: ["budget-pacing", resolvedAccountId],
    queryFn: async () => {
      const url = `${BASE}/api/budget/pacing${resolvedAccountId ? `?ad_account_id=${resolvedAccountId}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("فشل تحميل البيانات");
      return res.json() as Promise<PacingResponse>;
    },
    enabled: !!resolvedAccountId,
    staleTime: 5 * 60 * 1000,
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["budget-pacing", resolvedAccountId] });
  }

  const withTarget = data?.items.filter((i) => i.monthly_target !== null) ?? [];
  const withoutTarget = data?.items.filter((i) => i.monthly_target === null) ?? [];

  const fmtPeriod = (d: string) => {
    const [, m, day] = d.split("-");
    return `${Number(day)}/${Number(m)}`;
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 space-y-6" dir="rtl">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            توزيع الميزانية
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            تتبع مدى توافق الإنفاق الفعلي مع أهداف الميزانية الشهرية لكل حملة
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Account selector */}
          {accounts.data && accounts.data.accounts.length > 1 && (
            <Select value={resolvedAccountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-9 w-52 text-xs">
                <SelectValue placeholder="اختر الحساب" />
              </SelectTrigger>
              <SelectContent>
                {accounts.data.accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <button
            onClick={refresh}
            disabled={isFetching}
            className="h-9 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            تحديث
          </button>
        </div>
      </div>

      {/* Period info */}
      {data && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          <span>
            بيانات الشهر الحالي:{" "}
            <span className="font-medium text-foreground" dir="ltr">
              {fmtPeriod(data.period.since)} → {fmtPeriod(data.period.until)}
            </span>
            {" — "}الخط المنقط على البار يمثّل مستوى الإنفاق المتوقع حتى اليوم
          </span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 w-full rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-5 flex items-center gap-3 text-rose-700 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold text-sm">فشل تحميل البيانات</div>
              <div className="text-xs mt-0.5 text-muted-foreground">تحقق من الاتصال وأعد المحاولة</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data loaded */}
      {data && !isLoading && (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <SummaryKpis data={data} />

          {/* Campaigns with targets */}
          {withTarget.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CircleDollarSign className="h-4 w-4 text-primary" />
                  الحملات مع أهداف شهرية ({withTarget.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {withTarget.map((item) => (
                    <CampaignPacingCard
                      key={item.id}
                      item={item}
                      accountId={resolvedAccountId}
                      monthFraction={data.month_fraction}
                      daysElapsed={data.days_elapsed}
                      daysInMonth={data.days_in_month}
                      onRefresh={refresh}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Campaigns without targets */}
          {withoutTarget.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4" />
                  حملات بدون هدف شهري ({withoutTarget.length})
                  <span className="text-xs font-normal">— اضغط على "حدّد الهدف" لإضافة هدف</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {withoutTarget.map((item) => (
                    <CampaignPacingCard
                      key={item.id}
                      item={item}
                      accountId={resolvedAccountId}
                      monthFraction={data.month_fraction}
                      daysElapsed={data.days_elapsed}
                      daysInMonth={data.days_in_month}
                      onRefresh={refresh}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {data.items.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <div className="font-medium">لا توجد حملات لهذا الشهر</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
