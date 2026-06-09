import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Search, Package, AlertTriangle, CheckCircle, Warehouse, Clock, X, TrendingDown, Bell, Plus, Target, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const INVENTORY_BASE = "https://inventory-flow-seomasr.replit.app";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LOW_STOCK_THRESHOLD = 10;
const ALERT_WAREHOUSE = "مخزن السوق";
const API = "/api";


interface Product {
  id: number;
  name: string;
  sku: string;
  unit: string;
  currentStock: number;
  minStock: number;
  sellingPrice: number | null;
  costPrice: number | null;
  warehouseLocation: string;
  isBundle: boolean;
  updatedAt: string;
}

interface ProductTask {
  id: number;
  title: string;
  assigned_to_name: string | null;
  assigned_to_id: number | null;
  status: "pending" | "in_progress" | "completed" | "expired";
  deadline: string;
  created_at: string;
  completed_at: string | null;
  notes: string | null;
  success_metric: string | null;
  created_by_name: string | null;
  checkin_count: number;
  inventory_snapshot: { stock: number; unit: string } | null;
}

interface SalesRate {
  dailyRate1: number;
  dailyRate7: number;
  dailyRate14: number;
  sold7: number;
  sold14: number;
  sold30: number;
}

interface Stats {
  totalProducts: number;
  lowStockCount: number;
  totalMovementsToday: number;
  totalSalesToday: number;
  totalInToday: number;
}

type StockFilter = "all" | "available" | "zero" | "no_movement";
type SortKey = "name" | "stock_asc" | "stock_desc" | "updated";

function useCountdown(targetMs: number) {
  const [remaining, setRemaining] = useState(targetMs - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(targetMs - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  const secs = Math.max(0, Math.floor(remaining / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className={`rounded-xl border bg-card p-4 flex flex-col gap-1 ${color}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}



// ── Product Tasks Badge ───────────────────────────────────────────────────────

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "معلّقة", in_progress: "جارية", completed: "مكتملة", expired: "منتهية"
};
const TASK_STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  expired: "bg-red-500/20 text-red-400 border-red-500/30",
};

function ProductTasksBadge({ product, tasks, isAdmin, onCreateTask, onShowHistory, onFetch }: {
  product: Product;
  tasks: ProductTask[] | undefined;
  isAdmin: boolean;
  onCreateTask: () => void;
  onShowHistory: () => void;
  onFetch: () => void;
}) {
  useEffect(() => { if (!tasks) onFetch(); }, []);

  const activeTasks = tasks?.filter(t => t.status === "pending" || t.status === "in_progress") ?? [];
  const hasActive = activeTasks.length > 0;
  const latest = tasks?.[0] ?? null;

  if (!tasks) return <span className="text-[10px] text-muted-foreground animate-pulse">...</span>;

  return (
    <div className="flex flex-col items-center gap-1">
      {hasActive ? (
        <button onClick={onShowHistory}
          className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
          <span className="text-[10px] font-semibold text-blue-400">
            🔵 مهمة {TASK_STATUS_LABEL[activeTasks[0].status]}
          </span>
          <span className="text-[10px] text-slate-400">{activeTasks[0].assigned_to_name ?? "غير معين"}</span>
        </button>
      ) : latest ? (
        <button onClick={onShowHistory}
          className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg border border-border hover:bg-muted transition-colors">
          <span className="text-[10px] text-muted-foreground">آخر مهمة</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${TASK_STATUS_COLOR[latest.status]}`}>
            {TASK_STATUS_LABEL[latest.status]}
          </span>
        </button>
      ) : null}
      {isAdmin && !hasActive && (
        <button onClick={onCreateTask}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors">
          <Plus className="h-3 w-3" /> مهمة
        </button>
      )}
    </div>
  );
}

// ── Product Tasks History Modal ───────────────────────────────────────────────

function ProductTasksModal({ product, tasks, onClose, onOpenTask }: {
  product: Product;
  tasks: ProductTask[];
  onClose: () => void;
  onOpenTask: (t: ProductTask) => void;
}) {
  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("ar-EG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="font-bold text-sm">سجل مهام المنتج</h2>
            <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{product.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-border">
          {tasks.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">لا توجد مهام لهذا المنتج</div>
          ) : tasks.map(t => (
            <button key={t.id} onClick={() => onOpenTask(t)}
              className="w-full text-right p-3 flex items-start gap-3 hover:bg-muted/40 transition-colors cursor-pointer">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${TASK_STATUS_COLOR[t.status]}`}>
                {TASK_STATUS_LABEL[t.status]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{t.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {t.assigned_to_name && (
                    <span className="text-[10px] text-blue-400">{t.assigned_to_name}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">{formatDate(t.created_at)}</span>
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">←</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sales Rate Badge ──────────────────────────────────────────────────────────

function SalesRateBadge({ rate, loading, stock }: { rate: SalesRate | null; loading: boolean; stock: number }) {
  if (loading) return <span className="text-xs text-muted-foreground animate-pulse">...</span>;
  if (!rate) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-muted-foreground">🔴 راكد</span>
        <span className="text-[10px] text-muted-foreground">0/يوم</span>
      </div>
    );
  }

  const r7  = rate.dailyRate7;
  const r14 = rate.dailyRate14;

  const coverage = r7 > 0 ? Math.round(stock / r7) : null;

  const color = r7 === 0 ? "text-red-400" : r7 < 2 ? "text-amber-400" : "text-emerald-400";
  const label = r7 === 0 ? "🔴 راكد" : r7 < 2 ? "🟡 بطيء" : "🟢 نشط";

  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[80px]">
      <span className="text-[10px] font-medium">{label}</span>
      <div className="flex gap-1.5 text-[10px]">
        <span className={`font-mono font-semibold ${color}`}>{r7}/يوم</span>
        <span className="text-muted-foreground">|</span>
        <span className="font-mono text-muted-foreground">{r14}/يوم</span>
      </div>
      {coverage !== null && (
        <span className={`text-[10px] ${coverage < 14 ? "text-amber-400" : coverage > 90 ? "text-red-400" : "text-muted-foreground"}`}>
          تغطية {coverage} يوم
        </span>
      )}
    </div>
  );
}

function StockBadge({ stock, minStock }: { stock: number; minStock: number }) {
  if (stock === 0) {
    return <Badge variant="destructive" className="text-xs">نفذ</Badge>;
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return <Badge className="text-xs bg-amber-500 hover:bg-amber-500">{stock} ⚠️</Badge>;
  }
  if (minStock > 0 && stock <= minStock) {
    return <Badge className="text-xs bg-amber-500 hover:bg-amber-500">منخفض</Badge>;
  }
  return <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">{stock}</Badge>;
}


// ── Create Task Modal (from Inventory) ───────────────────────────────────────

interface Assignee { id: number; username: string; role: string; }

function nowPlusHours(h: number): string {
  const d = new Date(Date.now() + h * 3600000);
  return d.toLocaleString("sv-SE", { timeZone: "Africa/Cairo" }).slice(0, 16).replace(" ", "T");
}

function CreateTaskFromInventory({ product, onClose }: { product: Product; onClose: () => void }) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [taskType, setTaskType] = useState<string[]>([]);
  const [deadlineStr, setDeadlineStr] = useState(nowPlusHours(24));
  const [presetHours, setPresetHours] = useState<number | null>(24);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/tasks/assignees`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Assignee[]) => setAssignees(rows.filter((a: Assignee) => a.role === "media_buyer")))
      .catch(() => {});
  }, []);

  const taskTypes = [
    { key: "campaign", label: "🎯 حملة إعلانية" },
    { key: "analysis", label: "📊 تحليل المنتج" },
    { key: "creative", label: "🎨 تحسين الكريتيف" },
  ];

  const presets = [
    { h: 24, label: "يوم" },
    { h: 48, label: "يومان" },
    { h: 72, label: "٣ أيام" },
    { h: 168, label: "أسبوع" },
  ];

  function toggleType(key: string) {
    setTaskType(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  async function handleSubmit() {
    if (!assigneeId) { setError("يجب تعيين ميديا باير"); return; }
    if (!taskType.length) { setError("يجب اختيار نوع المهمة"); return; }
    setSaving(true);
    setError(null);
    const selectedAssignee = assignees.find(a => a.id === assigneeId);
    const typeLabel = taskType.map(k => taskTypes.find(t => t.key === k)?.label ?? k).join(" + ");
    const title = `${typeLabel} — ${product.name}`;
    try {
      const res = await fetch(`${API}/tasks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          product_name: product.name,
          assigned_to_id: assigneeId,
          assigned_to_name: selectedAssignee?.username ?? null,
          deadline: new Date(deadlineStr).toISOString(),
          notes: notes.trim() || `كمية المخزون الحالية: ${product.currentStock} ${product.unit}`,
          success_metric: null,
          inventory_product_id: product.id,
          inventory_snapshot: { stock: product.currentStock, unit: product.unit, capturedAt: new Date().toISOString() },
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? e.error ?? "فشل الإنشاء"); }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-bold text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> إنشاء مهمة
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{product.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-2">نوع المهمة (اختر واحدة أو أكتر)</label>
            <div className="flex flex-wrap gap-2">
              {taskTypes.map(t => (
                <button key={t.key} type="button" onClick={() => toggleType(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${taskType.includes(t.key) ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">تعيين لـ (ميديا باير)</label>
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value ? Number(e.target.value) : "")}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary">
              <option value="">— اختر ميديا باير —</option>
              {assignees.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-2">الموعد النهائي</label>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {presets.map(p => (
                <button key={p.h} type="button"
                  onClick={() => { setDeadlineStr(nowPlusHours(p.h)); setPresetHours(p.h); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${presetHours === p.h ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <input type="datetime-local" value={deadlineStr}
              onChange={e => { setDeadlineStr(e.target.value); setPresetHours(null); }}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary [color-scheme:dark]" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">ملاحظات إضافية</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder={`كمية المخزون الحالية: ${product.currentStock} ${product.unit}`}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:border-primary resize-none" />
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm hover:bg-muted transition-colors">
              إلغاء
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />جاري الإنشاء...</> : <><Plus className="h-4 w-4" />إنشاء المهمة</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Task Detail Popup (inline في صفحة المخزون) ───────────────────────────────

const TASK_STATUS_LABEL2: Record<string, string> = {
  pending: "معلّقة", in_progress: "جارية", completed: "مكتملة", expired: "منتهية"
};
const TASK_STATUS_COLOR2: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  expired: "bg-red-500/20 text-red-400 border-red-500/30",
};

function TaskDetailPopup({ task, onClose }: { task: ProductTask; onClose: () => void }) {
  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("ar-EG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const diff = new Date(task.deadline).getTime() - Date.now();
  const isOverdue = diff <= 0;
  const hours = Math.floor(Math.abs(diff) / 3600000);
  const mins = Math.floor((Math.abs(diff) % 3600000) / 60000);
  const countdownText = task.status === "completed"
    ? "مكتملة ✓"
    : isOverdue
    ? `تأخر ${hours}س ${mins}د`
    : hours >= 24
    ? `${Math.floor(hours/24)} يوم متبقي`
    : `${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")} متبقي`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${TASK_STATUS_COLOR2[task.status]}`}>
                {TASK_STATUS_LABEL2[task.status]}
              </span>
            </div>
            <h2 className="font-bold text-sm leading-snug">{task.title}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* المسؤول والديدلاين */}
          <div className="grid grid-cols-2 gap-3">
            {task.assigned_to_name && (
              <div className="bg-muted/40 rounded-xl p-3">
                <p className="text-[11px] text-muted-foreground mb-1">المسؤول</p>
                <p className="text-sm font-semibold text-blue-400">{task.assigned_to_name}</p>
              </div>
            )}
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground mb-1">الموعد النهائي</p>
              <p className="text-sm font-semibold">{formatDate(task.deadline)}</p>
            </div>
          </div>

          {/* العداد */}
          <div className={`text-center text-sm font-mono font-semibold py-2 rounded-xl ${
            task.status === "completed" ? "text-emerald-400 bg-emerald-500/10"
            : isOverdue ? "text-red-400 bg-red-500/10"
            : diff < 2 * 3600000 ? "text-orange-400 bg-orange-500/10 animate-pulse"
            : "text-muted-foreground bg-muted/30"
          }`}>
            {countdownText}
          </div>

          {/* كمية المخزون */}
          {task.inventory_snapshot && (
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground mb-1">كمية المخزون عند إنشاء التاسك</p>
              <p className="text-sm font-semibold">{task.inventory_snapshot.stock} {task.inventory_snapshot.unit}</p>
            </div>
          )}

          {/* مقياس النجاح */}
          {task.success_metric && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground mb-1">مقياس النجاح</p>
              <p className="text-sm text-purple-300">{task.success_metric}</p>
            </div>
          )}

          {/* الملاحظات */}
          {task.notes && (
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground mb-1">ملاحظات</p>
              <p className="text-sm leading-relaxed">{task.notes}</p>
            </div>
          )}

          {/* المتابعات */}
          {task.checkin_count > 0 && (
            <div className="bg-muted/40 rounded-xl p-3 flex items-center gap-2">
              <div className="flex gap-1">
                {Array.from({ length: Math.min(task.checkin_count, 10) }).map((_, i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-blue-400/60" />
                ))}
              </div>
              <span className="text-sm text-blue-300">{task.checkin_count} متابعة</span>
            </div>
          )}

          {/* أُضيفت بواسطة */}
          {task.created_by_name && (
            <p className="text-[11px] text-muted-foreground">أُضيفت بواسطة: <span className="text-foreground">{task.created_by_name}</span> · {formatDate(task.created_at)}</p>
          )}

          {/* اكتملت */}
          {task.completed_at && (
            <p className="text-[11px] text-emerald-400">اكتملت في: {formatDate(task.completed_at)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [taskProduct, setTaskProduct] = useState<Product | null>(null);

  const [products, setProducts]       = useState<Product[]>([]);
  const [stats, setStats]             = useState<Stats | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nextRefresh, setNextRefresh] = useState<number>(Date.now() + REFRESH_INTERVAL_MS);

  const [search, setSearch]               = useState("");
  const [warehouse, setWarehouse]         = useState<string>("all");
  const [stockFilter, setStockFilter]     = useState<StockFilter>("all");
  const [sort, setSort]                   = useState<SortKey>("stock_desc");

  // "دون حركة مبيعات" filter data
  const [noMovementIds, setNoMovementIds]     = useState<Set<number> | null>(null);
  const [productTasks, setProductTasks]       = useState<Record<number, ProductTask[]>>({});
  const [taskHistoryProduct, setTaskHistoryProduct] = useState<Product | null>(null);
  const [openTask, setOpenTask] = useState<ProductTask | null>(null);
  const [salesRates, setSalesRates]           = useState<Record<number, SalesRate> | null>(null);
  const [loadingRates, setLoadingRates]       = useState(false);
  const [loadingMovement, setLoadingMovement] = useState(false);
  const [movementSince, setMovementSince]     = useState<string | null>(null);

  const countdown = useCountdown(nextRefresh);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, statsRes] = await Promise.all([
        fetch(`${INVENTORY_BASE}/api/products`),
        fetch(`${INVENTORY_BASE}/api/products/stats`),
      ]);
      if (!prodRes.ok)  throw new Error(`Products API: ${prodRes.status}`);
      if (!statsRes.ok) throw new Error(`Stats API: ${statsRes.status}`);
      const [prod, st] = await Promise.all([prodRes.json(), statsRes.json()]);
      setProducts(prod);
      setStats(st);
      setLastUpdated(new Date());
      setNextRefresh(Date.now() + REFRESH_INTERVAL_MS);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchNoMovement = useCallback(async () => {
    setLoadingMovement(true);
    try {
      const res = await fetch(`/api/inventory/no-movement`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: { sinceDate: string; activeProductIds: number[] } = await res.json();
      setNoMovementIds(new Set(data.activeProductIds));
      setMovementSince(data.sinceDate);
    } catch {
      setNoMovementIds(new Set()); // empty set = show all as "no movement" on error
    } finally {
      setLoadingMovement(false);
    }
  }, []);

  const fetchProductTasks = useCallback(async (productId: number) => {
    try {
      const res = await fetch(`/api/tasks/by-product/${productId}`, { credentials: "include" });
      if (!res.ok) return;
      const tasks: ProductTask[] = await res.json();
      setProductTasks(prev => ({ ...prev, [productId]: tasks }));
    } catch {}
  }, []);

  const fetchSalesRates = useCallback(async () => {
    if (salesRates) return;
    setLoadingRates(true);
    try {
      const res = await fetch("/api/inventory/sales-rate", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSalesRates(data.rates);
    } catch {
      setSalesRates({});
    } finally {
      setLoadingRates(false);
    }
  }, [salesRates]);

  // Load movement data when filter is activated + auto-select مخزن السوق
  useEffect(() => {
    if (stockFilter === "no_movement") {
      if (noMovementIds === null) fetchNoMovement();
      // Auto-scope to the alert warehouse
      setWarehouse(ALERT_WAREHOUSE);
    }
  }, [stockFilter, noMovementIds, fetchNoMovement]);

  // Initial load
  useEffect(() => { fetchData(); fetchSalesRates(); }, [fetchData, fetchSalesRates]);

  // Auto-refresh every 30 minutes
  useEffect(() => {
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // Derived warehouse list
  const warehouses = useMemo(() => {
    const locs = Array.from(new Set(products.map(p => p.warehouseLocation).filter(Boolean)));
    return locs.sort();
  }, [products]);

  // Filtered + sorted products
  const filtered = useMemo(() => {
    let list = products;

    if (warehouse !== "all") list = list.filter(p => p.warehouseLocation === warehouse);

    if (stockFilter === "available")    list = list.filter(p => p.currentStock > 0);
    else if (stockFilter === "zero")    list = list.filter(p => p.currentStock === 0);
    else if (stockFilter === "no_movement" && noMovementIds !== null) {
      list = list.filter(p => !noMovementIds.has(p.id));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      if (sort === "stock_asc")  return a.currentStock - b.currentStock;
      if (sort === "stock_desc") return b.currentStock - a.currentStock;
      if (sort === "name")       return a.name.localeCompare(b.name, "ar");
      if (sort === "updated")    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return 0;
    });

    return list;
  }, [products, warehouse, stockFilter, search, sort, noMovementIds]);

  // KPIs
  const availableCount = products.filter(p => p.currentStock > 0).length;
  const zeroCount      = products.filter(p => p.currentStock === 0).length;
  const totalUnits     = products.reduce((s, p) => s + p.currentStock, 0);
  // Low-stock banner only for مخزن السوق
  const lowStockList   = products.filter(
    p => p.warehouseLocation === ALERT_WAREHOUSE && p.currentStock > 0 && p.currentStock <= LOW_STOCK_THRESHOLD
  );

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">المخزون</h1>
            <p className="text-sm text-muted-foreground">
              {lastUpdated
                ? `آخر تحديث: ${lastUpdated.toLocaleTimeString("ar-EG")} — التحديث القادم بعد ${countdown}`
                : "جاري التحميل..."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "يتحدث..." : "تحديث الآن"}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Low-stock alert banner */}
        {!loading && lowStockList.length > 0 && (
          <div className="rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Bell className="h-4 w-4 shrink-0" />
              <span className="font-semibold text-sm">
                {lowStockList.length} صنف وصلت كميته لأقل من {LOW_STOCK_THRESHOLD} قطع — يلزم إعادة تعبئة
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lowStockList.slice(0, 8).map(p => (
                <span
                  key={p.id}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 font-medium"
                >
                  {p.name} — {p.currentStock}
                </span>
              ))}
              {lowStockList.length > 8 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200">
                  +{lowStockList.length - 8} أصناف أخرى
                </span>
              )}
            </div>
          </div>
        )}

        {/* KPI Cards */}
        {!loading && products.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="إجمالي الأصناف"
              value={stats?.totalProducts ?? products.length}
              color="border-border"
            />
            <KpiCard
              label="متاح في المخزن"
              value={availableCount}
              sub={`${totalUnits.toLocaleString("ar-EG")} وحدة إجمالاً`}
              color="border-emerald-200 dark:border-emerald-900"
            />
            <KpiCard
              label="نفذ من المخزن"
              value={zeroCount}
              color={zeroCount > 0 ? "border-red-200 dark:border-red-900" : "border-border"}
            />
            <KpiCard
              label="حركات اليوم"
              value={stats?.totalMovementsToday ?? 0}
              sub={stats ? `مبيعات: ${stats.totalSalesToday} · وارد: ${stats.totalInToday}` : undefined}
              color="border-border"
            />
          </div>
        )}

        {/* Skeleton KPIs while loading */}
        {loading && products.length === 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => (
              <div key={i} className="rounded-xl border bg-card p-4 h-20 animate-pulse bg-muted/40" />
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="ابحث بالاسم أو الكود..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-8 h-8 text-sm"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Warehouse filter */}
          <div className="flex items-center gap-1">
            <Warehouse className="h-4 w-4 text-muted-foreground" />
            {["all", ...warehouses].map(loc => (
              <button
                key={loc}
                onClick={() => setWarehouse(loc)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  warehouse === loc
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:border-primary/50"
                }`}
              >
                {loc === "all" ? "الكل" : loc}
              </button>
            ))}
          </div>

          {/* Stock filter */}
          <div className="flex items-center gap-1">
            {([
              ["all",         "الكل",              ""],
              ["available",   "متاح",              ""],
              ["zero",        "نفذ",               ""],
              ["no_movement", "دون حركة مبيعات",   ""],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setStockFilter(val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 ${
                  stockFilter === val
                    ? val === "zero"        ? "bg-red-600 text-white border-red-600"
                    : val === "available"   ? "bg-emerald-600 text-white border-emerald-600"
                    : val === "no_movement" ? "bg-orange-500 text-white border-orange-500"
                    : "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:border-primary/50"
                }`}
              >
                {val === "no_movement" && <TrendingDown className="h-3 w-3" />}
                {label}
                {val === "no_movement" && loadingMovement && (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                )}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="h-8 text-xs rounded-lg border border-border bg-background px-2 pr-2 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="stock_desc">الأعلى كمية أولاً</option>
            <option value="stock_asc">الأقل كمية أولاً</option>
            <option value="name">الاسم أبجدياً</option>
            <option value="updated">آخر تحديث</option>
          </select>

          {/* Result count */}
          <span className="text-xs text-muted-foreground mr-auto">
            {filtered.length.toLocaleString("ar-EG")} صنف
            {stockFilter === "no_movement" && movementSince && (
              <span className="mr-1 text-orange-500">· لا حركة منذ {movementSince}</span>
            )}
          </span>
        </div>

        {/* no_movement loading state */}
        {stockFilter === "no_movement" && loadingMovement && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            جاري تحليل حركات المخزون خلال آخر 10 أيام...
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground w-12">#</th>
                  <th className="text-right px-4 py-3 font-semibold">الصنف</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted-foreground">الكود</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted-foreground">المخزن</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted-foreground">الوحدة</th>
                  <th className="text-center px-4 py-3 font-semibold">الكمية</th>
                  <th className="text-center px-3 py-3 font-semibold text-muted-foreground">معدل البيع</th>
                  <th className="text-center px-3 py-3 font-semibold text-muted-foreground">المهام</th>
                </tr>
              </thead>
              <tbody>
                {loading && products.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[1,2,3,4,5,6].map(j => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 rounded bg-muted/60 animate-pulse" style={{ width: j === 2 ? "80%" : j === 1 ? "40px" : "60%" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-muted-foreground">
                      {stockFilter === "no_movement" && loadingMovement
                        ? "جاري تحميل بيانات الحركة..."
                        : "لا توجد أصناف مطابقة للبحث"}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p, idx) => (
                    <tr
                      key={p.id}
                      className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                        p.currentStock === 0
                          ? "bg-red-50/30 dark:bg-red-950/10"
                          : p.currentStock <= LOW_STOCK_THRESHOLD
                          ? "bg-amber-50/30 dark:bg-amber-950/10"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {p.currentStock === 0
                            ? <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                            : p.currentStock <= LOW_STOCK_THRESHOLD
                            ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            : <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          }
                          <span className={p.currentStock === 0 ? "text-muted-foreground" : ""}>{p.name}</span>
                          {p.isBundle && <Badge variant="outline" className="text-[10px] h-4 px-1">مجموعة</Badge>}

                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground font-mono text-xs">{p.sku || "—"}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs bg-muted px-2 py-0.5 rounded-md">{p.warehouseLocation || "—"}</span>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-xs">{p.unit}</td>
                      <td className="px-4 py-3 text-center">
                        <StockBadge stock={p.currentStock} minStock={p.minStock} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <SalesRateBadge rate={salesRates?.[p.id] ?? null} loading={loadingRates} stock={p.currentStock} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ProductTasksBadge
                          product={p}
                          tasks={productTasks[p.id]}
                          isAdmin={isAdmin}
                          onFetch={() => fetchProductTasks(p.id)}
                          onCreateTask={() => setTaskProduct(p)}
                          onShowHistory={() => setTaskHistoryProduct(p)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer note */}
        {lastUpdated && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pb-4">
            <Clock className="h-3.5 w-3.5" />
            <span>البيانات من نظام InventoryFlow — تتحدث تلقائياً كل 30 دقيقة · تنبيهات المخزون تُرسل كل 30 دقيقة</span>
          </div>
        )}
      </div>

      {taskProduct && (
        <CreateTaskFromInventory product={taskProduct} onClose={() => { setTaskProduct(null); fetchProductTasks(taskProduct.id); }} />
      )}
      {openTask && (
        <TaskDetailPopup task={openTask} onClose={() => setOpenTask(null)} />
      )}

      {taskHistoryProduct && (
        <ProductTasksModal
          product={taskHistoryProduct}
          tasks={productTasks[taskHistoryProduct.id] ?? []}
          onClose={() => setTaskHistoryProduct(null)}
          onOpenTask={t => { window.location.href = `/tasks?taskId=${t.id}`; }}
        />
      )}
    </div>
  );
}
