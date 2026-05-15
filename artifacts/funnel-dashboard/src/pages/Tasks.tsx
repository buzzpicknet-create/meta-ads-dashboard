import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, CheckCircle2, Clock, AlertTriangle, Loader2, Trash2,
  RefreshCw, LogIn, Trophy, Flame, Star, User, Target,
  ChevronDown, ChevronUp, BarChart3, Calendar, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = "pending" | "in_progress" | "completed" | "expired";

interface Task {
  id: number;
  title: string;
  product_name: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  deadline: string;
  success_metric: string | null;
  status: TaskStatus;
  created_by_name: string | null;
  completed_at: string | null;
  checkin_count: number;
  last_checkin_at: string | null;
  notes: string | null;
  created_at: string;
  opus_score?: number;
}

interface BuyerStat {
  userId: number;
  name: string;
  total_tasks: number;
  completed_on_time: number;
  completed_late: number;
  in_progress: number;
  expired: number;
  total_checkins: number;
  avg_score: number;
}

interface Assignee {
  id: number;
  username: string;
  role: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcCountdown(deadline: string): { text: string; urgent: boolean; overdue: boolean } {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { text: "انتهى الوقت", urgent: true, overdue: true };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const urgent = diff < 2 * 3600000;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return { text: `${d} ${d === 1 ? "يوم" : "أيام"} متبقية`, urgent: false, overdue: false };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return { text: `${pad(h)}:${pad(m)}:${pad(s)} متبقي`, urgent, overdue: false };
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ar-EG", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function deadlinePreset(hours: number): string {
  return new Date(Date.now() + hours * 3600000).toISOString().slice(0, 16);
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending:     "معلّقة",
  in_progress: "جارية",
  completed:   "مكتملة",
  expired:     "منتهية",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending:     "bg-amber-500/20 text-amber-400 border-amber-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  expired:     "bg-red-500/20 text-red-400 border-red-500/30",
};

function scoreColor(s: number) {
  if (s >= 75) return "text-emerald-400";
  if (s >= 50) return "text-amber-400";
  return "text-red-400";
}

function scoreRing(score: number) {
  const r = 20, c = 2 * Math.PI * r;
  const filled = (score / 100) * c;
  const color = score >= 75 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="block -rotate-90">
      <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${filled} ${c - filled}`} strokeLinecap="round" />
    </svg>
  );
}

// ── Live countdown ticker ─────────────────────────────────────────────────────

function Countdown({ deadline, status }: { deadline: string; status: TaskStatus }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status === "completed" || status === "expired") return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [status]);
  if (status === "completed") return <span className="text-emerald-400 text-xs">مكتملة ✓</span>;
  const { text, urgent, overdue } = calcCountdown(deadline);
  return (
    <span className={`text-xs font-mono font-semibold flex items-center gap-1
      ${overdue ? "text-red-400" : urgent ? "text-orange-400 animate-pulse" : "text-slate-300"}`}>
      <Clock size={11} />
      {text}
    </span>
  );
}

// ── Opus Score ring (displayed on cards for completed tasks) ──────────────────

function ScoreBadge({ score }: { score: number }) {
  return (
    <div className="relative w-[52px] h-[52px] flex items-center justify-center flex-shrink-0">
      {scoreRing(score)}
      <span className={`absolute text-[10px] font-bold ${scoreColor(score)}`}>
        {score}%
      </span>
    </div>
  );
}

// ── Assignment Modal ──────────────────────────────────────────────────────────

interface ModalProps {
  assignees: Assignee[];
  onSave: (data: Partial<Task>) => Promise<void>;
  onClose: () => void;
}

function AssignModal({ assignees, onSave, onClose }: ModalProps) {
  const [title, setTitle] = useState("");
  const [product, setProduct] = useState("");
  const [metric, setMetric] = useState("");
  const [notes, setNotes] = useState("");
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [deadlineStr, setDeadlineStr] = useState(deadlinePreset(24));
  const [presetHours, setPresetHours] = useState<number | null>(24);
  const [saving, setSaving] = useState(false);

  const selectedAssignee = assignees.find(a => a.id === assigneeId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !deadlineStr) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        product_name: product.trim() || null,
        success_metric: metric.trim() || null,
        notes: notes.trim() || null,
        assigned_to_id: assigneeId || null,
        assigned_to_name: selectedAssignee?.username || null,
        deadline: new Date(deadlineStr).toISOString(),
      } as Partial<Task>);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const presets = [
    { h: 12,  label: "١٢ ساعة" },
    { h: 24,  label: "٢٤ ساعة" },
    { h: 48,  label: "٤٨ ساعة" },
    { h: 72,  label: "٣ أيام" },
    { h: 168, label: "أسبوع" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <Target size={18} className="text-blue-400" />
            مهمة جديدة
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">عنوان المهمة *</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="مثال: اختبار منتج Magic Mop"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">اسم المنتج</label>
              <input
                value={product} onChange={e => setProduct(e.target.value)}
                placeholder="اختياري"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">تعيين لـ</label>
              <select
                value={assigneeId} onChange={e => setAssigneeId(e.target.value ? Number(e.target.value) : "")}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">— بدون تعيين —</option>
                {assignees.map(a => (
                  <option key={a.id} value={a.id}>{a.username}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">مقياس النجاح</label>
            <input
              value={metric} onChange={e => setMetric(e.target.value)}
              placeholder="مثال: CPA < 100 EGP"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-2">الموعد النهائي</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {presets.map(p => (
                <button key={p.h} type="button"
                  onClick={() => { setDeadlineStr(deadlinePreset(p.h)); setPresetHours(p.h); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                    ${presetHours === p.h
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-800 border-slate-600 text-slate-300 hover:border-blue-500"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local" value={deadlineStr}
              onChange={e => { setDeadlineStr(e.target.value); setPresetHours(null); }}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">ملاحظات</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="تعليمات إضافية..."
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
              إلغاء
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              إنشاء المهمة
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Check-in Modal ────────────────────────────────────────────────────────────

function CheckinModal({ task, onSave, onClose }: { task: Task; onSave: (notes: string) => Promise<void>; onClose: () => void }) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try { await onSave(notes); onClose(); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-white font-bold text-base flex items-center gap-2">
            <LogIn size={16} className="text-blue-400" />
            تسجيل متابعة
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-slate-300 text-sm">{task.title}</p>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            rows={3} placeholder="ملاحظة المتابعة (اختياري)..."
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
              إلغاء
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              تسجيل
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task, isAdmin, onCheckin, onComplete, onDelete, onReopen,
}: {
  task: Task;
  isAdmin: boolean;
  onCheckin: (task: Task) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onReopen: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const score = task.opus_score ?? 0;
  const isActive = task.status === "pending" || task.status === "in_progress";

  return (
    <div className={`bg-slate-800/60 backdrop-blur-sm border rounded-xl overflow-hidden transition-all duration-300
      ${task.status === "expired" ? "border-red-500/30 opacity-70"
      : task.status === "completed" ? "border-emerald-500/30"
      : task.status === "in_progress" ? "border-blue-500/40"
      : "border-slate-700"}`}>
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[task.status]}`}>
                {STATUS_LABEL[task.status]}
              </span>
              {task.product_name && (
                <span className="text-[11px] text-slate-400 bg-slate-700/60 px-2 py-0.5 rounded-full">
                  {task.product_name}
                </span>
              )}
            </div>
            <h3 className="text-white font-semibold text-sm leading-snug mb-1.5 truncate" title={task.title}>
              {task.title}
            </h3>
            <div className="flex items-center gap-3 flex-wrap">
              {task.assigned_to_name && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <User size={10} />
                  {task.assigned_to_name}
                </span>
              )}
              <Countdown deadline={task.deadline} status={task.status} />
            </div>
          </div>

          {task.status === "completed" && score > 0 && (
            <ScoreBadge score={score} />
          )}
          {task.status === "in_progress" && (
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
              <Flame size={14} className="text-blue-400" />
            </div>
          )}
        </div>

        {task.success_metric && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Target size={10} className="text-purple-400 flex-shrink-0" />
            <span>هدف: <span className="text-purple-300">{task.success_metric}</span></span>
          </div>
        )}

        {/* Checkin indicator */}
        {task.checkin_count > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex gap-1">
              {Array.from({ length: Math.min(task.checkin_count, 8) }).map((_, i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400/60" />
              ))}
              {task.checkin_count > 8 && <span className="text-[10px] text-slate-500">+{task.checkin_count - 8}</span>}
            </div>
            <span className="text-[10px] text-slate-500">{task.checkin_count} متابعة</span>
          </div>
        )}
      </div>

      {/* Expand section */}
      {(task.notes || task.created_by_name) && (
        <div className="border-t border-slate-700/50">
          <button onClick={() => setExpanded(v => !v)}
            className="w-full px-4 py-2 flex items-center justify-between text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
            <span>{expanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {expanded && (
            <div className="px-4 pb-3 space-y-1.5 text-[11px] text-slate-400">
              {task.notes && <p className="leading-relaxed">{task.notes}</p>}
              {task.created_by_name && <p>أُنشئت بواسطة: <span className="text-slate-300">{task.created_by_name}</span></p>}
              <p>الموعد النهائي: <span className="text-slate-300">{formatDate(task.deadline)}</span></p>
              {task.completed_at && <p>اكتملت: <span className="text-emerald-300">{formatDate(task.completed_at)}</span></p>}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-slate-700/50 px-4 py-2.5 flex items-center gap-2">
        {isActive && (
          <>
            <button onClick={() => onCheckin(task)}
              className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1.5 rounded-lg transition-all">
              <LogIn size={11} />
              متابعة
            </button>
            <button onClick={() => onComplete(task.id)}
              className="flex items-center gap-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg transition-all">
              <CheckCircle2 size={11} />
              إتمام
            </button>
          </>
        )}
        {task.status === "completed" && isAdmin && (
          <button onClick={() => onReopen(task.id)}
            className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 rounded-lg transition-all">
            <RefreshCw size={11} />
            إعادة فتح
          </button>
        )}
        {isAdmin && (
          <button onClick={() => onDelete(task.id)}
            className="mr-auto flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-lg transition-all">
            <Trash2 size={11} />
            حذف
          </button>
        )}
      </div>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function Leaderboard({ stats }: { stats: BuyerStat[] }) {
  if (!stats.length) return (
    <div className="text-center py-12 text-slate-500">
      <Trophy size={32} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">لا توجد إحصائيات بعد</p>
    </div>
  );

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-3">
      {stats.map((s, i) => (
        <div key={s.userId}
          className={`bg-slate-800/60 border rounded-xl p-4 flex items-center gap-4
            ${i === 0 ? "border-yellow-500/40" : i === 1 ? "border-slate-500/40" : "border-slate-700/40"}`}>
          {/* Rank */}
          <div className="w-8 text-center flex-shrink-0">
            {i < 3
              ? <span className="text-xl">{medals[i]}</span>
              : <span className="text-slate-500 font-bold text-sm">#{i + 1}</span>}
          </div>

          {/* Score ring */}
          <div className="relative w-[52px] h-[52px] flex items-center justify-center flex-shrink-0">
            {scoreRing(s.avg_score)}
            <span className={`absolute text-[10px] font-bold ${scoreColor(s.avg_score)}`}>
              {s.avg_score}%
            </span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white font-semibold text-sm truncate">{s.name}</span>
              {s.in_progress > 0 && (
                <span className="text-[10px] text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded-full animate-pulse">
                  {s.in_progress} جارية
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <CheckCircle2 size={10} className="text-emerald-400" />
                {s.completed_on_time} في الوقت
              </span>
              <span className="flex items-center gap-1">
                <Clock size={10} className="text-amber-400" />
                {s.completed_late} متأخرة
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle size={10} className="text-red-400" />
                {s.expired} منتهية
              </span>
              <span className="flex items-center gap-1">
                <Flame size={10} className="text-blue-400" />
                {s.total_checkins} متابعة
              </span>
            </div>
          </div>

          {/* Stars */}
          <div className="flex-shrink-0 flex gap-0.5">
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} size={12}
                className={n <= Math.ceil(s.avg_score / 20) ? "text-yellow-400 fill-yellow-400" : "text-slate-600"} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [tasks, setTasks]   = useState<Task[]>([]);
  const [stats, setStats]   = useState<BuyerStat[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"tasks" | "leaderboard">("tasks");
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const [showModal, setShowModal] = useState(false);
  const [checkinTask, setCheckinTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [tRes, sRes, aRes] = await Promise.all([
        fetch(`${BASE}/tasks`, { credentials: "include" }),
        fetch(`${BASE}/tasks/stats`, { credentials: "include" }),
        isAdmin ? fetch(`${BASE}/tasks/assignees`, { credentials: "include" }) : Promise.resolve(null),
      ]);
      if (!tRes.ok) throw new Error((await tRes.json()).error ?? "خطأ في جلب المهام");
      const [tasksData, statsData] = await Promise.all([tRes.json(), sRes.json()]);
      setTasks(tasksData);
      setStats(statsData);
      if (aRes?.ok) setAssignees(await aRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchAll();
    pollingRef.current = setInterval(() => fetchAll(true), 30_000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchAll]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function createTask(data: Partial<Task>) {
    const res = await fetch(`${BASE}/tasks`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "فشل الإنشاء");
    await fetchAll(true);
  }

  async function patchTask(id: number, body: Record<string, unknown>) {
    const res = await fetch(`${BASE}/tasks/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "فشل التحديث");
    await fetchAll(true);
  }

  async function deleteTask(id: number) {
    if (!confirm("حذف هذه المهمة؟")) return;
    await fetch(`${BASE}/tasks/${id}`, { method: "DELETE", credentials: "include" });
    await fetchAll(true);
  }

  // ── Filtered tasks ──────────────────────────────────────────────────────────

  const filtered = filter === "all" ? tasks : tasks.filter(t => t.status === filter);

  const counts: Record<string, number> = { all: tasks.length };
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;

  const filterTabs: { key: "all" | TaskStatus; label: string }[] = [
    { key: "all",        label: `الكل (${counts.all ?? 0})` },
    { key: "in_progress",label: `جارية (${counts.in_progress ?? 0})` },
    { key: "pending",    label: `معلّقة (${counts.pending ?? 0})` },
    { key: "expired",    label: `منتهية (${counts.expired ?? 0})` },
    { key: "completed",  label: `مكتملة (${counts.completed ?? 0})` },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="text-blue-400" size={22} />
            المهام اليومية
          </h1>
          <p className="text-slate-400 text-sm mt-1">مركز إدارة مهام مشتري الميديا</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchAll(true)}
            className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-all">
            <RefreshCw size={16} />
          </button>
          {isAdmin && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all">
              <Plus size={16} />
              مهمة جديدة
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "جارية",   value: counts.in_progress ?? 0, color: "text-blue-400",    icon: <Flame size={16} className="text-blue-400" /> },
            { label: "معلّقة",  value: counts.pending ?? 0,     color: "text-amber-400",   icon: <Clock size={16} className="text-amber-400" /> },
            { label: "مكتملة",  value: counts.completed ?? 0,   color: "text-emerald-400", icon: <CheckCircle2 size={16} className="text-emerald-400" /> },
            { label: "منتهية",  value: counts.expired ?? 0,     color: "text-red-400",     icon: <AlertTriangle size={16} className="text-red-400" /> },
          ].map(s => (
            <div key={s.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-3 flex items-center gap-3">
              {s.icon}
              <div>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-400">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-800">
        {[
          { key: "tasks",       label: "مركز المهام",   icon: <Target size={14} /> },
          { key: "leaderboard", label: "لوحة الإنجاز",  icon: <BarChart3 size={14} /> },
        ].map(t => (
          <button key={t.key}
            onClick={() => setTab(t.key as "tasks" | "leaderboard")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px
              ${tab === t.key
                ? "text-blue-400 border-blue-400"
                : "text-slate-400 border-transparent hover:text-slate-200"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 size={28} className="animate-spin mr-3" />
          <span>جاري التحميل...</span>
        </div>
      )}

      {/* Tasks tab */}
      {!loading && tab === "tasks" && (
        <>
          {/* Filter tabs */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {filterTabs.map(f => (
              <button key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                  ${filter === f.key
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Task grid */}
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <Target size={40} className="mx-auto mb-4 opacity-20" />
              <p className="text-base font-medium">لا توجد مهام</p>
              {isAdmin && (
                <button onClick={() => setShowModal(true)}
                  className="mt-4 px-4 py-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 text-sm hover:bg-blue-600/30 transition-all">
                  + إضافة أول مهمة
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  isAdmin={isAdmin}
                  onCheckin={setCheckinTask}
                  onComplete={id => patchTask(id, { action: "complete" })}
                  onDelete={deleteTask}
                  onReopen={id => patchTask(id, { action: "reopen" })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Leaderboard tab */}
      {!loading && tab === "leaderboard" && (
        <div className="max-w-2xl mx-auto">
          <Leaderboard stats={stats} />
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <AssignModal
          assignees={assignees}
          onSave={createTask}
          onClose={() => setShowModal(false)}
        />
      )}
      {checkinTask && (
        <CheckinModal
          task={checkinTask}
          onSave={notes => patchTask(checkinTask.id, { action: "checkin", notes })}
          onClose={() => setCheckinTask(null)}
        />
      )}
    </div>
  );
}
