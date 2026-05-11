import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, Rocket, ChevronDown, ChevronUp, TrendingUp, TrendingDown, PauseCircle, PlayCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

export interface BulkActionItem {
  type:
    | "update_campaign_budget"
    | "update_adset_budget"
    | "pause_campaign"
    | "enable_campaign"
    | "pause_adset"
    | "enable_adset"
    | "pause_ad"
    | "enable_ad";
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  name: string;
  campaignName?: string;
  label: string;
  currentBudget?: number;
  newBudget?: number;
  budgetType?: "daily" | "lifetime";
  reason?: string;
}

export interface BulkActionPayload {
  actions: BulkActionItem[];
  title?: string;
  compact?: boolean;
}

type ActionStatus = "idle" | "running" | "success" | "error";

const TYPE_META: Record<BulkActionItem["type"], { icon: React.ReactNode; color: string; badge: string }> = {
  update_campaign_budget: { icon: <TrendingUp className="h-3.5 w-3.5" />, color: "text-emerald-600 dark:text-emerald-400", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  update_adset_budget:    { icon: <TrendingUp className="h-3.5 w-3.5" />, color: "text-emerald-600 dark:text-emerald-400", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  pause_campaign:  { icon: <PauseCircle className="h-3.5 w-3.5" />, color: "text-amber-600 dark:text-amber-400",  badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  pause_adset:     { icon: <PauseCircle className="h-3.5 w-3.5" />, color: "text-amber-600 dark:text-amber-400",  badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  pause_ad:        { icon: <PauseCircle className="h-3.5 w-3.5" />, color: "text-amber-600 dark:text-amber-400",  badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  enable_campaign: { icon: <PlayCircle className="h-3.5 w-3.5" />,  color: "text-blue-600 dark:text-blue-400",    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  enable_adset:    { icon: <PlayCircle className="h-3.5 w-3.5" />,  color: "text-blue-600 dark:text-blue-400",    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  enable_ad:       { icon: <PlayCircle className="h-3.5 w-3.5" />,  color: "text-blue-600 dark:text-blue-400",    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
};

// Detect if budget is decreasing vs increasing
function getBudgetMeta(item: BulkActionItem): { icon: React.ReactNode; badge: string; color: string } {
  if ((item.type === "update_campaign_budget" || item.type === "update_adset_budget") &&
      item.currentBudget !== undefined && item.newBudget !== undefined) {
    const isDown = item.newBudget < item.currentBudget;
    if (isDown) return {
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      badge: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
      color: "text-red-600 dark:text-red-400",
    };
  }
  return TYPE_META[item.type];
}

function buildToolCall(item: BulkActionItem): { tool: string; args: Record<string, unknown> } {
  switch (item.type) {
    case "update_campaign_budget":
      return { tool: "update_campaign_budget", args: { campaign_id: item.campaignId, name: item.name, budget_amount: item.newBudget, budget_type: item.budgetType ?? "daily" } };
    case "update_adset_budget":
      return { tool: "update_adset_budget", args: { adset_id: item.adsetId, name: item.name, budget_amount: item.newBudget } };
    case "pause_campaign":
      return { tool: "pause_campaign", args: { campaign_id: item.campaignId, name: item.name } };
    case "enable_campaign":
      return { tool: "enable_campaign", args: { campaign_id: item.campaignId, name: item.name } };
    case "pause_adset":
      return { tool: "pause_adset", args: { adset_id: item.adsetId, name: item.name } };
    case "enable_adset":
      return { tool: "enable_adset", args: { adset_id: item.adsetId, name: item.name } };
    case "pause_ad":
      return { tool: "pause_ad", args: { ad_id: item.adId, name: item.name } };
    case "enable_ad":
      return { tool: "enable_ad", args: { ad_id: item.adId, name: item.name } };
  }
}

export default function BulkActionPanel({ payload }: { payload: BulkActionPayload }) {
  const actions  = payload.actions ?? [];
  const isCompact = payload.compact === true && actions.length === 1;

  const [checked, setChecked]   = useState<boolean[]>(() => actions.map(() => true));
  const [statuses, setStatuses] = useState<ActionStatus[]>(() => actions.map(() => "idle"));
  const [errors, setErrors]     = useState<string[]>(() => actions.map(() => ""));
  const [running, setRunning]   = useState(false);
  const [done, setDone]         = useState(false);
  const [expanded, setExpanded] = useState(true);

  const selected  = checked.filter(Boolean).length;
  const succeeded = statuses.filter(s => s === "success").length;
  const failed    = statuses.filter(s => s === "error").length;

  const fmt = (v: number) => v.toLocaleString("ar-EG", { maximumFractionDigits: 0 });

  async function executeAll() {
    if (running || done) return;
    setRunning(true);
    const toRun = actions
      .map((a, i) => ({ action: a, idx: i, selected: checked[i] }))
      .filter(x => x.selected);
    await Promise.all(toRun.map(async ({ action, idx }) => {
      setStatuses(prev => { const n = [...prev]; n[idx] = "running"; return n; });
      try {
        const call = buildToolCall(action);
        const r = await fetch(`${API}/pipeboard/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ tool: call.tool, args: call.args, isNoOp: false }),
        });
        const d = await r.json() as { success?: boolean; error?: string };
        if (r.ok && d.success) {
          setStatuses(prev => { const n = [...prev]; n[idx] = "success"; return n; });
        } else {
          throw new Error(d.error ?? "فشل التنفيذ");
        }
      } catch (err) {
        setStatuses(prev => { const n = [...prev]; n[idx] = "error"; return n; });
        setErrors(prev => { const n = [...prev]; n[idx] = err instanceof Error ? err.message : "خطأ"; return n; });
      }
    }));
    setRunning(false);
    setDone(true);
  }

  // ── Compact mode: single inline action button ──────────────────────────────
  if (isCompact) {
    const action = actions[0]!;
    const meta   = getBudgetMeta(action);
    const st     = statuses[0]!;
    const hasBudget = (action.type === "update_campaign_budget" || action.type === "update_adset_budget") &&
      action.currentBudget !== undefined && action.newBudget !== undefined;
    return (
      <span className="inline-flex items-center gap-2 my-1 flex-wrap">
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}>
          {meta.icon}{action.label}
        </span>
        <span className="text-[12.5px] font-medium text-foreground">{action.name}</span>
        {hasBudget && (
          <span className="text-[11.5px] text-muted-foreground font-mono flex items-center gap-1">
            <span className="text-red-400">{fmt(action.currentBudget!)} EGP</span>
            <span>→</span>
            <span className={action.newBudget! > action.currentBudget! ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>{fmt(action.newBudget!)} EGP</span>
          </span>
        )}
        {st === "idle" && (
          <button
            onClick={() => void executeAll()}
            disabled={running}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            <Rocket className="h-3 w-3" /> تنفيذ
          </button>
        )}
        {st === "running" && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
        {st === "success" && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />تم</span>}
        {st === "error"   && <span className="inline-flex items-center gap-1 text-[11px] text-red-500"><XCircle className="h-3.5 w-3.5" />{errors[0] || "فشل"}</span>}
      </span>
    );
  }

  // ── Full panel mode ────────────────────────────────────────────────────────
  return (
    <div className="my-3 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/5 to-background overflow-hidden shadow-sm">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none border-b border-primary/15 bg-primary/8 hover:bg-primary/12 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Rocket className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="text-[13.5px] font-bold text-foreground">
              {payload.title ?? "تنفيذ جماعي"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {done
                ? `${succeeded} ناجح · ${failed} فشل`
                : `${selected} إجراء${selected !== 1 ? "ات" : ""} محددة من ${actions.length}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {done && succeeded > 0 && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> {succeeded} تم
            </span>
          )}
          {done && failed > 0 && (
            <span className="text-[11px] text-red-500 font-medium flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> {failed} فشل
            </span>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <>
          {/* Action list */}
          <div className="divide-y divide-border/40">
            {actions.map((action, i) => {
              const meta      = getBudgetMeta(action);
              const st        = statuses[i]!;
              const isChecked = checked[i]!;
              return (
                <label
                  key={i}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                    isChecked && st === "idle" ? "hover:bg-muted/30" : ""
                  } ${st === "success" ? "bg-emerald-50 dark:bg-emerald-950/20" : ""} ${st === "error" ? "bg-red-50 dark:bg-red-950/20" : ""}`}
                >
                  <div className="pt-0.5 shrink-0">
                    {st === "running" ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : st === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : st === "error" ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={running || done}
                        onChange={e => setChecked(prev => { const n=[...prev]; n[i]=e.target.checked; return n; })}
                        className="h-4 w-4 accent-primary rounded cursor-pointer"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}>
                        {meta.icon}{action.label}
                      </span>
                      <span className="text-[13px] font-semibold text-foreground truncate">{action.name}</span>
                      {action.adsetId && action.campaignName && (
                        <span className="text-[11px] text-muted-foreground truncate">({action.campaignName})</span>
                      )}
                    </div>
                    {(action.type === "update_campaign_budget" || action.type === "update_adset_budget") &&
                      action.currentBudget !== undefined && action.newBudget !== undefined && (
                      <p className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-red-400">{fmt(action.currentBudget)} EGP</span>
                        <span>→</span>
                        <span className={`font-mono font-semibold ${action.newBudget > action.currentBudget ? "text-emerald-500" : "text-red-500"}`}>{fmt(action.newBudget)} EGP</span>
                        <span className="text-muted-foreground/60">({action.budgetType === "lifetime" ? "إجمالي" : "يومي"})</span>
                      </p>
                    )}
                    {action.reason && (
                      <p className="text-[11.5px] text-muted-foreground/70 mt-0.5 line-clamp-2">{action.reason}</p>
                    )}
                    {st === "error" && errors[i] && (
                      <p className="text-[11px] text-red-500 mt-0.5">{errors[i]}</p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          {/* Execute button */}
          {!done && (
            <div className="px-4 py-3 border-t border-primary/15 bg-background/50 flex items-center justify-between gap-3">
              <p className="text-[11.5px] text-muted-foreground">
                ستُنفَّذ الإجراءات المحددة مباشرةً على Meta Ads
              </p>
              <button
                onClick={() => void executeAll()}
                disabled={running || selected === 0}
                className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-40 transition-all shadow-sm"
              >
                {running ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التنفيذ...</>
                ) : (
                  <><Rocket className="h-4 w-4" /> تنفيذ {selected > 0 ? `(${selected})` : ""} على Meta</>
                )}
              </button>
            </div>
          )}
          {done && (
            <div className="px-4 py-3 border-t border-primary/15 bg-background/50 flex items-center gap-2">
              {failed === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
              <p className="text-[12.5px] text-muted-foreground">
                {failed === 0
                  ? `✅ تم تنفيذ جميع الإجراءات بنجاح (${succeeded}/${selected})`
                  : `تم ${succeeded} بنجاح · فشل ${failed} — راجع التفاصيل أعلاه`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
