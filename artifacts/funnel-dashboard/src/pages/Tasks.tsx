import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, CheckCircle2, Clock, AlertTriangle, Loader2, Trash2,
  RefreshCw, LogIn, Trophy, Flame, Star, User, Target,
  ChevronDown, ChevronUp, BarChart3, Calendar, X, Upload,
  Image as ImageIcon, Video, Filter, ShieldAlert, Download,
  FileText, Eye, Pencil, MessageSquare, Send, Search, MinusCircle, History, RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const _BASE = "";
const BASE  = `${_BASE}/api`;

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = "pending" | "in_progress" | "completed" | "expired";

interface TaskMedia {
  id: number;
  task_id: number;
  original_name: string;
  file_path: string;
  mime_type: string;
  is_primary: boolean;
}

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
  media: TaskMedia[];
  inventory_product_id?: number | null;
  task_kind?: string;
  platform?: "meta" | "google" | "tiktok" | null;
  daily_followup_date?: string | null;
  admin_highlighted?: boolean;
  admin_highlight_note_id?: number | null;
  admin_highlighted_at?: string | null;
  admin_highlighted_by?: string | null;
  inventory_snapshot?: {
    stock: number;
    unit: string;
    capturedAt: string;
    sourceStore?: "dealme" | "buzzpick";
    storeName?: string;
  } | null;
  inventory_result?: {
    snapshotStock: number | null;
    currentStock: number | null;
    reservedQty?: number;
    sold3days: number;
    sold7days: number;
    daysElapsed: number;
    success: boolean;
  } | null;
}

function getTaskStoreName(task: Task): string | null {
  const explicitName = task.inventory_snapshot?.storeName?.trim();
  if (explicitName) return explicitName;

  if (task.inventory_snapshot?.sourceStore === "buzzpick") return "Buzzpick";
  if (task.inventory_snapshot?.sourceStore === "dealme") return "Dealme";

  return null;
}

interface BuyerStat {
  userId: number; name: string; total_tasks: number;
  completed_on_time: number; completed_late: number;
  in_progress: number; expired: number; total_checkins: number; avg_score: number;
  deduction_points?: number;
  score_before_deductions?: number;
}

interface ScoreDeduction {
  id: number;
  media_buyer_id: number;
  media_buyer_name: string;
  points: number;
  reason: string;
  task_id: number | null;
  created_by_name: string;
  created_at: string;
  reversed_at: string | null;
  reversed_by_name: string | null;
}

interface Assignee { id: number; username: string; role: string; }

interface TaskNote {
  id: number;
  task_id: number;
  user_id: number;
  username: string;
  note_text: string;
  is_important?: boolean;
  created_at: string;
}

interface TaskView {
  id: number;
  task_id: number;
  user_id: number;
  username: string;
  viewed_at: string;
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
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function cairoDateKeyFromIso(iso: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function taskOperationalDateKey(task: Task): string {
  if (task.task_kind === "daily_product_followup" && task.daily_followup_date) {
    return task.daily_followup_date.slice(0, 10);
  }
  return cairoDateKeyFromIso(task.deadline);
}

function formatTaskDay(task: Task): string {
  const key = taskOperationalDateKey(task);
  try {
    const d = new Date(`${key}T12:00:00+03:00`);
    return new Intl.DateTimeFormat("ar-EG", {
      timeZone: "Africa/Cairo",
      day: "numeric",
      month: "short",
    }).format(d);
  } catch {
    return key;
  }
}

// "now + N hours" as datetime-local string (Cairo local time, no UTC offset)
function nowPlusHours(h: number): string {
  const d = new Date(Date.now() + h * 3600000);
  return d.toLocaleString("sv-SE", { timeZone: "Africa/Cairo" }).slice(0, 16).replace(" ", "T");
}

function mediaUrl(m: TaskMedia): string {
  // file_path is objectPath from GCS e.g. "/objects/uploads/uuid"
  // serving route: GET /api/storage/objects/*path → prepends /objects/
  const stripped = m.file_path.replace(/^\/objects\//, "");
  return `${BASE}/storage/objects/${stripped}`;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "معلّقة", in_progress: "جارية", completed: "مكتملة", expired: "منتهية",
};
const STATUS_COLOR: Record<TaskStatus, string> = {
  pending:     "bg-amber-500/20 text-amber-400 border-amber-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  expired:     "bg-red-500/20 text-red-400 border-red-500/30",
};

function scoreColor(s: number) {
  return s >= 75 ? "text-emerald-400" : s >= 50 ? "text-amber-400" : "text-red-400";
}

function isLateCompleted(task: Task): boolean {
  if (task.status !== "completed" || !task.completed_at) return false;
  return new Date(task.completed_at).getTime() > new Date(task.deadline).getTime();
}

function scoreRing(score: number) {
  const r = 20, c = 2 * Math.PI * r, filled = (score / 100) * c;
  const color = score >= 75 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="block -rotate-90">
      <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${filled} ${c - filled}`} strokeLinecap="round" />
    </svg>
  );
}

// ── Live Countdown ────────────────────────────────────────────────────────────

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
      <Clock size={11} />{text}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <div className="relative w-[52px] h-[52px] flex items-center justify-center flex-shrink-0">
      {scoreRing(score)}
      <span className={`absolute text-[10px] font-bold ${scoreColor(score)}`}>{score}%</span>
    </div>
  );
}

// ── Media Preview ─────────────────────────────────────────────────────────────

function MediaPreview({ media }: { media: TaskMedia[] }) {
  if (!media.length) return null;
  const primary = media.find(m => m.is_primary) ?? media[0];
  const rest    = media.filter(m => m.id !== primary.id);
  const isVideo = (m: TaskMedia) => m.mime_type.startsWith("video/");

  return (
    <div className="w-full">
      {/* Primary */}
      <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
        {isVideo(primary) ? (
          <video src={mediaUrl(primary)} className="w-full h-full object-cover" controls={false}
            playsInline muted preload="metadata"
            onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play()}
            onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }} />
        ) : (
          <img src={mediaUrl(primary)} alt={primary.original_name}
            className="w-full h-full object-cover" loading="lazy" />
        )}
      </div>
      {/* Thumbnails */}
      {rest.length > 0 && (
        <div className="flex gap-1.5 mt-1.5 overflow-x-auto pb-1">
          {rest.map(m => (
            <div key={m.id} className="w-14 h-14 flex-shrink-0 rounded-md overflow-hidden bg-black border border-slate-700">
              {isVideo(m) ? (
                <video src={mediaUrl(m)} className="w-full h-full object-cover" muted preload="metadata" />
              ) : (
                <img src={mediaUrl(m)} alt={m.original_name} className="w-full h-full object-cover" loading="lazy" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── File Upload Area ──────────────────────────────────────────────────────────

function FileUploadArea({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => /^(image|video)\//.test(f.type));
    onChange([...files, ...dropped]);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    onChange([...files, ...selected]);
    e.target.value = "";
  }

  function remove(i: number) {
    onChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={e => e.preventDefault()} onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-slate-600 rounded-xl p-4 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-500/5 transition-all">
        <Upload size={20} className="mx-auto mb-1 text-slate-500" />
        <p className="text-xs text-slate-400">اسحب وأفلت أو اضغط لرفع صور/فيديوهات</p>
        <p className="text-[10px] text-slate-600 mt-0.5">حتى 100 ميجا لكل ملف</p>
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={handleInput} />
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative group">
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-700 border border-slate-600 flex items-center justify-center">
                {f.type.startsWith("image/")
                  ? <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                  : <Video size={24} className="text-slate-400" />
                }
                {i === 0 && <span className="absolute bottom-0 left-0 right-0 bg-blue-600/80 text-[9px] text-white text-center py-0.5">رئيسية</span>}
              </div>
              <button type="button" onClick={() => remove(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <X size={8} className="text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Assignment Modal ──────────────────────────────────────────────────────────

interface AssignModalProps {
  assignees: Assignee[];
  onSave: (data: Partial<Task>, files: File[]) => Promise<void>;
  onClose: () => void;
}

function AssignModal({ assignees, onSave, onClose }: AssignModalProps) {
  const [title,      setTitle]      = useState("");
  const [product,    setProduct]    = useState("");
  const [metric,     setMetric]     = useState("");
  const [notes,      setNotes]      = useState("");
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [deadlineStr, setDeadlineStr] = useState(nowPlusHours(24));
  const [presetHours, setPresetHours] = useState<number | null>(24);
  const [files,      setFiles]      = useState<File[]>([]);
  const [saving,     setSaving]     = useState(false);
  const [progress,   setProgress]   = useState("");

  const selectedAssignee = assignees.find(a => a.id === assigneeId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !deadlineStr) return;
    setSaving(true);
    try {
      setProgress("جاري إنشاء المهمة...");
      await onSave({
        title: title.trim(),
        product_name: product.trim() || null,
        success_metric: metric.trim() || null,
        notes: notes.trim() || null,
        assigned_to_id: assigneeId || null,
        assigned_to_name: selectedAssignee?.username || null,
        deadline: new Date(deadlineStr).toISOString(),
      } as Partial<Task>, files);
      onClose();
    } catch {
      setProgress("");
    } finally {
      setSaving(false);
    }
  }

  const presets = [
    { h: 1,   label: "ساعة" },
    { h: 3,   label: "٣ ساعات" },
    { h: 12,  label: "١٢ ساعة" },
    { h: 24,  label: "يوم" },
    { h: 48,  label: "يومان" },
    { h: 72,  label: "٣ أيام" },
    { h: 168, label: "أسبوع" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-700 sticky top-0 bg-slate-900 z-10">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <Target size={18} className="text-blue-400" /> مهمة جديدة
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">عنوان المهمة *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required
              placeholder="مثال: اختبار منتج Magic Mop"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Product + Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">اسم المنتج</label>
              <input value={product} onChange={e => setProduct(e.target.value)}
                placeholder="اختياري"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">تعيين لـ</label>
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value ? Number(e.target.value) : "")}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">— بدون تعيين —</option>
                {assignees.map(a => (
                  <option key={a.id} value={a.id}>{a.username}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Metric */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">مقياس النجاح</label>
            <input value={metric} onChange={e => setMetric(e.target.value)}
              placeholder="مثال: CPA < 100 EGP"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Deadline */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">الموعد النهائي</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {presets.map(p => (
                <button key={p.h} type="button"
                  onClick={() => { setDeadlineStr(nowPlusHours(p.h)); setPresetHours(p.h); }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border
                    ${presetHours === p.h
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-800 border-slate-600 text-slate-300 hover:border-blue-500"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <input type="datetime-local" value={deadlineStr}
              onChange={e => { setDeadlineStr(e.target.value); setPresetHours(null); }}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 [color-scheme:dark]"
              required />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">ملاحظات</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="تعليمات إضافية..."
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none" />
          </div>

          {/* Media Upload */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
              <ImageIcon size={11} /> ميديا المنتج (صور + فيديوهات)
            </label>
            <FileUploadArea files={files} onChange={setFiles} />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
              إلغاء
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <><Loader2 size={14} className="animate-spin" />{progress || "جاري الحفظ..."}</> : <><Plus size={14} />إنشاء المهمة</>}
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
  const requiresComment = task.task_kind === "daily_product_followup";
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (requiresComment && !notes.trim()) return;
    setSaving(true);
    try { await onSave(notes); onClose(); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-white font-bold text-base flex items-center gap-2">
            <LogIn size={16} className="text-blue-400" /> تسجيل متابعة
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-slate-300 text-sm">{task.title}</p>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            required={requiresComment}
            placeholder={requiresComment ? "اكتب حالة المنتج والقرار اليومي — التعليق مطلوب" : "ملاحظة المتابعة (اختياري)..."}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none" />
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
              إلغاء
            </button>
            <button type="submit" disabled={saving || (requiresComment && !notes.trim())}
              className="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />} تسجيل
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Task Modal ───────────────────────────────────────────────────────────

function EditTaskModal({ task, assignees, onSave, onClose }: {
  task: Task; assignees: Assignee[];
  onSave: (id: number, data: Partial<Task>) => Promise<void>;
  onClose: () => void;
}) {
  const [title,       setTitle]       = useState(task.title);
  const [product,     setProduct]     = useState(task.product_name ?? "");
  const [metric,      setMetric]      = useState(task.success_metric ?? "");
  const [notes,       setNotes]       = useState(task.notes ?? "");
  const [assigneeId,  setAssigneeId]  = useState<number | "">(task.assigned_to_id ?? "");
  const [deadlineStr, setDeadlineStr] = useState(() => {
    // Convert stored ISO to Cairo local for datetime-local input
    const d = new Date(task.deadline);
    return d.toLocaleString("sv-SE", { timeZone: "Africa/Cairo" }).slice(0, 16).replace(" ", "T");
  });
  const [saving, setSaving] = useState(false);

  const selectedAssignee = assignees.find(a => a.id === assigneeId);

  const presets = [
    { h: 1, label: "ساعة" }, { h: 3, label: "٣ ساعات" }, { h: 12, label: "١٢ ساعة" },
    { h: 24, label: "يوم" }, { h: 48, label: "يومان" }, { h: 72, label: "٣ أيام" }, { h: 168, label: "أسبوع" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !deadlineStr) return;
    setSaving(true);
    try {
      await onSave(task.id, {
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-700 sticky top-0 bg-slate-900 z-10">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <Pencil size={16} className="text-amber-400" /> تعديل المهمة
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4" dir="rtl">
          {/* Title */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">عنوان المهمة *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>

          {/* Product + Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">اسم المنتج</label>
              <input value={product} onChange={e => setProduct(e.target.value)}
                placeholder="اختياري"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">تعيين لـ</label>
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value ? Number(e.target.value) : "")}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">— بدون تعيين —</option>
                {assignees.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
              </select>
            </div>
          </div>

          {/* Metric */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">مقياس النجاح</label>
            <input value={metric} onChange={e => setMetric(e.target.value)}
              placeholder="مثال: CPA < 100 EGP"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Deadline presets + picker */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">الموعد النهائي</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {presets.map(p => (
                <button key={p.h} type="button"
                  onClick={() => setDeadlineStr(nowPlusHours(p.h))}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border bg-slate-800 border-slate-600 text-slate-300 hover:border-amber-500 hover:text-amber-300">
                  +{p.label}
                </button>
              ))}
            </div>
            <input type="datetime-local" value={deadlineStr}
              onChange={e => setDeadlineStr(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 [color-scheme:dark]"
              required />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">ملاحظات</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="تعليمات إضافية..."
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
              إلغاء
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <><Loader2 size={14} className="animate-spin" />جاري الحفظ...</> : <><Pencil size={14} />حفظ التعديلات</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Complete Confirm Modal ────────────────────────────────────────────────────

function CompleteConfirmModal({ task, isAdmin, onConfirm, onClose }: {
  task: Task; isAdmin: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-amber-500/40 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-slate-700">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <ShieldAlert size={20} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-white font-bold text-base">تأكيد إتمام المهمة</h2>
            <p className="text-slate-400 text-xs mt-0.5 line-clamp-1">{task.title}</p>
          </div>
        </div>

        {/* Warning body */}
        <div className="p-5 space-y-4">
          {!isAdmin && (
            <div className="bg-red-900/30 border border-red-500/40 rounded-xl p-3.5 flex gap-3">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="text-red-300 font-semibold">إجراء لا يمكن التراجع عنه</p>
                <p className="text-red-400/80 text-xs leading-relaxed">
                  بمجرد تأكيد الإتمام <span className="text-red-300 font-medium">لن تستطيع تغيير حالة المهمة</span> مرة أخرى.
                  التراجع عن هذا القرار متاح للمشرف فقط.
                </p>
              </div>
            </div>
          )}
          <p className="text-slate-300 text-sm">
            هل أنت متأكد من إتمام هذه المهمة وتسجيلها كمكتملة؟
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
            إلغاء
          </button>
          <button onClick={() => { onConfirm(); onClose(); }}
            className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2">
            <CheckCircle2 size={15} /> تأكيد الإتمام
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────


// ── Inventory Result Section ──────────────────────────────────────────────────

function InventoryResultSection({ taskId, existingResult }: {
  taskId: number;
  existingResult: {
    snapshotStock: number | null;
    currentStock: number | null;
    reservedQty?: number;
    sold3days: number;
    sold7days: number;
    daysElapsed: number;
    success: boolean;
  } | null;
}) {
  const [result, setResult] = useState(existingResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchResult() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/tasks/${taskId}/inventory-result`, { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "فشل"); }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/40">
        <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
          📦 نتيجة المخزون بعد التاسك
        </span>
        <button onClick={fetchResult} disabled={loading}
          className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-50">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {result ? "تحديث" : "احسب النتيجة"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {!result && !loading && !error && (
        <div className="px-3 py-3 text-xs text-slate-500">اضغط "احسب النتيجة" لمعرفة تأثير التاسك على المبيعات</div>
      )}

      {result && (
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
              <div className="text-xs text-slate-500 mb-1">كمية قبل التاسك</div>
              <div className="text-lg font-bold text-slate-300">{result.snapshotStock ?? "—"}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
              <div className="text-xs text-slate-500 mb-1">كمية الآن (متاح للإعلانات)</div>
              <div className={`text-lg font-bold ${(result.currentStock ?? 0) < 0 ? "text-red-400" : "text-slate-300"}`}>{result.currentStock ?? "—"}</div>
              {(result.reservedQty ?? 0) > 0 && (
                <div className="text-[10px] text-amber-400/80 mt-0.5">محجوز {result.reservedQty}</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded-lg p-2.5 text-center ${result.sold3days > 0 ? "bg-emerald-900/30 border border-emerald-500/30" : "bg-slate-900/50"}`}>
              <div className="text-xs text-slate-500 mb-1">مبيعات أول 3 أيام</div>
              <div className={`text-lg font-bold ${result.sold3days > 0 ? "text-emerald-400" : "text-slate-500"}`}>{result.sold3days} وحدة</div>
            </div>
            <div className={`rounded-lg p-2.5 text-center ${result.sold7days > 0 ? "bg-emerald-900/30 border border-emerald-500/30" : "bg-slate-900/50"}`}>
              <div className="text-xs text-slate-500 mb-1">مبيعات أول 7 أيام</div>
              <div className={`text-lg font-bold ${result.sold7days > 0 ? "text-emerald-400" : "text-slate-500"}`}>{result.sold7days} وحدة</div>
            </div>
          </div>
          <div className={`rounded-lg px-3 py-2 text-xs font-semibold text-center ${result.success ? "bg-emerald-900/30 text-emerald-400 border border-emerald-500/30" : "bg-red-900/20 text-red-400 border border-red-500/20"}`}>
            {result.success ? "✅ الصنف تحرك بعد التاسك" : "❌ الصنف لم يتحرك بعد التاسك"}
          </div>
          <div className="text-[11px] text-slate-600 text-center">{result.daysElapsed} يوم منذ الإتمام</div>
        </div>
      )}
    </div>
  );
}

// ── Task Detail Modal ──────────────────────────────────────────────────────────

function TaskDetailModal({ task, isAdmin, onClose, onCheckin, onComplete, onDelete, onReopen, onEdit, onClearHighlight, onChanged }: {
  task: Task; isAdmin: boolean;
  onClose: () => void;
  onCheckin: (task: Task) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onReopen: (id: number) => void;
  onEdit: (task: Task) => void;
  onClearHighlight: (id: number) => void;
  onChanged: () => Promise<void>;
}) {
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [notes,      setNotes]      = useState<TaskNote[]>([]);
  const [views,      setViews]      = useState<TaskView[]>([]);
  const [noteText,   setNoteText]   = useState("");
  const [importantNote, setImportantNote] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [showViews,  setShowViews]  = useState(false);
  const isActive = task.status === "pending" || task.status === "in_progress";
  const canFinish = isActive || task.status === "expired";
  const score = task.opus_score ?? 0;
  const completedLate = isLateCompleted(task);

  const isImage = (m: TaskMedia) => m.mime_type.startsWith("image/");
  const isVideo = (m: TaskMedia) => m.mime_type.startsWith("video/");

  // Record view + fetch notes/views on mount
  useEffect(() => {
    fetch(`${BASE}/tasks/${task.id}/view`, { method: "POST", credentials: "include" }).catch(() => {});
    fetch(`${BASE}/tasks/${task.id}/notes`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setNotes).catch(() => {});
    if (isAdmin) {
      fetch(`${BASE}/tasks/${task.id}/views`, { credentials: "include" })
        .then(r => r.ok ? r.json() : [])
        .then(setViews).catch(() => {});
    }
  }, [task.id, isAdmin]);

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`${BASE}/tasks/${task.id}/notes`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_text: noteText.trim(), important: isAdmin && importantNote }),
      });
      if (res.ok) {
        const row: TaskNote = await res.json();
        setNotes(prev => [...prev, row]);
        setNoteText("");
        setImportantNote(false);
        await onChanged();
      }
    } finally {
      setAddingNote(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className={`flex items-start justify-between gap-3 p-5 border-b border-slate-700/60
          ${task.status === "completed" ? "bg-emerald-950/40"
          : task.status === "in_progress" ? "bg-blue-950/40"
          : task.status === "expired" ? "bg-red-950/30"
          : "bg-slate-800/60"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                task.task_kind === "daily_product_followup"
                  ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                  : "bg-slate-700/80 text-slate-200 border-slate-600"
              }`}>
                {task.task_kind === "daily_product_followup" ? "متابعة يومية" : "مهمة عادية"}
              </span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLOR[task.status]}`}>
                {STATUS_LABEL[task.status]}
              </span>
              {completedLate && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-orange-500/15 text-orange-300 border-orange-500/30">
                  مكتملة متأخر
                </span>
              )}
              {task.product_name && (
                <span className="text-xs text-slate-400 bg-slate-700/60 px-2.5 py-1 rounded-full">
                  {task.product_name}
                </span>
              )}
              {task.platform && (
                <span className="text-xs font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full">
                  {task.platform === "meta" ? "Meta" : task.platform === "google" ? "Google" : "TikTok"}
                </span>
              )}
              {getTaskStoreName(task) && (
                <span className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full">
                  المتجر: {getTaskStoreName(task)}
                </span>
              )}
              {task.status === "completed" && score > 0 && <ScoreBadge score={score} />}
            </div>
            <h2 className="text-white font-bold text-lg leading-snug">{task.title}</h2>
          </div>
          <button onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Media gallery */}
          {task.media?.length > 0 && (
            <div className="p-5 border-b border-slate-700/50">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <ImageIcon size={12} /> الملفات المرفقة ({task.media.length})
              </h3>
              <div className="space-y-3">
                {task.media.map(m => (
                  <div key={m.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
                    {/* Preview */}
                    {isImage(m) && (
                      <img src={mediaUrl(m)} alt={m.original_name}
                        className="w-full max-h-80 object-contain bg-slate-950" />
                    )}
                    {isVideo(m) && (
                      <video src={mediaUrl(m)} controls
                        className="w-full max-h-80 bg-slate-950" />
                    )}
                    {!isImage(m) && !isVideo(m) && (
                      <div className="flex items-center justify-center h-20 bg-slate-800">
                        <FileText size={28} className="text-slate-500" />
                      </div>
                    )}
                    {/* File info + download */}
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="text-xs text-slate-400 truncate" title={m.original_name}>
                        {m.original_name}
                        {m.is_primary && (
                          <span className="mr-2 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">رئيسي</span>
                        )}
                      </span>
                      <a href={mediaUrl(m)} download={m.original_name}
                        className="flex-shrink-0 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg transition-all"
                        onClick={e => e.stopPropagation()}>
                        <Download size={11} /> تحميل
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Task details */}
          <div className="p-5 space-y-3">
            {/* Assignee + deadline row */}
            <div className="grid grid-cols-2 gap-3">
              {task.assigned_to_name && (
                <div className="bg-slate-800/50 rounded-xl p-3">
                  <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><User size={10} /> المسؤول</p>
                  <p className="text-sm font-semibold text-blue-300">{task.assigned_to_name}</p>
                </div>
              )}
              <div className="bg-slate-800/50 rounded-xl p-3">
                <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><Clock size={10} /> الموعد النهائي</p>
                <p className="text-sm font-semibold text-white">{formatDate(task.deadline)}</p>
              </div>
            </div>

            {/* Countdown */}
            <div className="flex justify-center">
              <Countdown deadline={task.deadline} status={task.status} />
            </div>

            {/* Success metric */}
            {task.success_metric && (
              <div className="bg-purple-900/20 border border-purple-500/20 rounded-xl p-3">
                <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><Target size={10} /> معيار النجاح</p>
                <p className="text-sm text-purple-300">{task.success_metric}</p>
              </div>
            )}

            {/* Notes */}
            {task.notes && (
              <div className="bg-slate-800/50 rounded-xl p-3">
                <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><Eye size={10} /> ملاحظات</p>
                <p className="text-sm text-slate-300 leading-relaxed">{task.notes}</p>
              </div>
            )}

            {/* Check-ins */}
            {task.checkin_count > 0 && (
              <div className="bg-slate-800/50 rounded-xl p-3">
                <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1"><LogIn size={10} /> المتابعات</p>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(task.checkin_count, 12) }).map((_, i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-blue-400/60" />
                    ))}
                    {task.checkin_count > 12 && (
                      <span className="text-[10px] text-slate-500">+{task.checkin_count - 12}</span>
                    )}
                  </div>
                  <span className="text-sm text-blue-300 font-medium">{task.checkin_count} متابعة</span>
                </div>
                {task.last_checkin_at && (
                  <p className="text-[11px] text-slate-500 mt-1">آخر متابعة: {formatDate(task.last_checkin_at)}</p>
                )}
              </div>
            )}

            {/* Created by + completed at */}
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              {task.created_by_name && (
                <div className="bg-slate-800/50 rounded-xl p-3">
                  <p className="text-slate-500 mb-1">أُضيفت بواسطة</p>
                  <p className="text-slate-300 font-medium">{task.created_by_name}</p>
                </div>
              )}
              {task.completed_at && (
                <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-xl p-3">
                  <p className="text-slate-500 mb-1">اكتملت في</p>
                  <p className="text-emerald-300 font-medium">{formatDate(task.completed_at)}</p>
                </div>
              )}
            </div>

            {/* ── Inventory Result ─────────────────────────────────────── */}
            {task.inventory_product_id && task.status === "completed" && (
              <InventoryResultSection taskId={task.id} existingResult={task.inventory_result ?? null} />
            )}

            {/* ── Notes section ─────────────────────────────────────────────── */}
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-700/40">
                <MessageSquare size={13} className="text-blue-400" />
                <span className="text-xs font-semibold text-slate-300">ملاحظات الفريق</span>
                {notes.length > 0 && (
                  <span className="text-[10px] text-slate-500 bg-slate-700/60 px-1.5 py-0.5 rounded-full">{notes.length}</span>
                )}
              </div>
              {notes.length === 0 ? (
                <p className="text-xs text-slate-600 px-3 py-3">لا توجد ملاحظات بعد</p>
              ) : (
                <div className="divide-y divide-slate-700/30 max-h-48 overflow-y-auto">
                  {notes.map(n => (
                    <div key={n.id} className={`px-3 py-2.5 ${n.is_important ? "bg-amber-500/10 border-r-2 border-amber-400" : ""}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-semibold text-blue-300 flex items-center gap-1.5">
                          {n.username}
                          {n.is_important && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                              <ShieldAlert size={9} /> مهم من الإدارة
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-600">{formatDate(n.created_at)}</span>
                      </div>
                      <p className={`text-xs leading-relaxed ${n.is_important ? "text-amber-100" : "text-slate-300"}`}>{n.note_text}</p>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={handleAddNote} className="p-2.5 border-t border-slate-700/40 space-y-2">
                {isAdmin && (
                  <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${importantNote ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-slate-700/60 text-slate-400 hover:border-amber-500/30"}`}>
                    <input
                      type="checkbox"
                      checked={importantNote}
                      onChange={e => setImportantNote(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <ShieldAlert size={13} />
                    <span className="text-[11px] font-semibold">تعليق مهم — اعمل Highlight للتاسك وابعت تنبيه للميديا باير</span>
                  </label>
                )}
                <div className="flex gap-2">
                  <input
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder={importantNote ? "اكتب التعليق المهم..." : "أضف ملاحظة..."}
                    className={`flex-1 bg-slate-900/60 border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none ${importantNote ? "border-amber-500/40 focus:border-amber-400" : "border-slate-600/50 focus:border-blue-500/60"}`}
                  />
                  <button type="submit" disabled={addingNote || !noteText.trim()}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white text-xs disabled:opacity-40 transition-all ${importantNote ? "bg-amber-600 hover:bg-amber-500" : "bg-blue-600/80 hover:bg-blue-600"}`}>
                    {addingNote ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  </button>
                </div>
              </form>
            </div>

            {/* ── View log (admin only) ──────────────────────────────────────── */}
            {isAdmin && views.length > 0 && (
              <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowViews(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                  <span className="flex items-center gap-2">
                    <Eye size={12} className="text-slate-500" />
                    سجل المشاهدات ({views.length})
                  </span>
                  {showViews ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showViews && (
                  <div className="divide-y divide-slate-700/30 max-h-40 overflow-y-auto border-t border-slate-700/40">
                    {views.map(v => (
                      <div key={v.id} className="flex items-center justify-between px-3 py-2 text-[11px]">
                        <span className="text-slate-300 font-medium">{v.username}</span>
                        <span className="text-slate-600">{formatDate(v.viewed_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {task.status === "expired" && (
          <div className="mx-4 mb-3 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-200 flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>الموعد انتهى، لكن تقدر تكمل المهمة. هيتحسب لك Score أقل، وحاول ما تتأخرش في المهمة الجاية.</span>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 p-4 border-t border-slate-700/60 bg-slate-900/80 flex-wrap">
          {canFinish && (
            <>
              {task.task_kind === "daily_product_followup" && (
                <button onClick={() => { onCheckin(task); onClose(); }}
                  className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-2 rounded-xl transition-all">
                  <LogIn size={13} /> {task.status === "expired" ? "إكمال متأخر" : "متابعة"}
                </button>
              )}
              {task.task_kind !== "daily_product_followup" && (
                <button onClick={() => setShowCompleteConfirm(true)}
                  className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 rounded-xl transition-all">
                  <CheckCircle2 size={13} /> {task.status === "expired" ? "إكمال متأخر" : "إتمام"}
                </button>
              )}
            </>
          )}
          {task.status === "completed" && isAdmin && (
            <button onClick={() => { onReopen(task.id); onClose(); }}
              className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-2 rounded-xl transition-all">
              <RefreshCw size={13} /> إعادة فتح
            </button>
          )}
          {/* Edit button — admin only */}
          {isAdmin && task.admin_highlighted && (
            <button onClick={() => { onClearHighlight(task.id); onClose(); }}
              className="flex items-center gap-1.5 text-sm text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 px-3 py-2 rounded-xl transition-all border border-amber-500/30">
              <ShieldAlert size={13} /> إزالة الـ Highlight
            </button>
          )}
          {isAdmin && (
            <button onClick={() => onEdit(task)}
              className="flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-2 rounded-xl transition-all border border-amber-500/20">
              <Pencil size={13} /> تعديل
            </button>
          )}
          {isAdmin && (
            <button onClick={() => { onDelete(task.id); onClose(); }}
              className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-2 rounded-xl transition-all">
              <Trash2 size={13} /> حذف
            </button>
          )}
          <button onClick={onClose}
            className="mr-auto flex items-center gap-1.5 text-sm text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700/80 px-3 py-2 rounded-xl transition-all">
            إغلاق
          </button>
        </div>
      </div>

      {showCompleteConfirm && (
        <CompleteConfirmModal task={task} isAdmin={isAdmin}
          onConfirm={() => { onComplete(task.id); onClose(); }}
          onClose={() => setShowCompleteConfirm(false)} />
      )}
    </div>
  );
}

function TaskCard({ task, isAdmin, onCheckin, onComplete, onDelete, onReopen, onOpen }: {
  task: Task; isAdmin: boolean;
  onCheckin: (task: Task) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onReopen: (id: number) => void;
  onOpen: (task: Task) => void;
}) {
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const score = task.opus_score ?? 0;
  const isActive = task.status === "pending" || task.status === "in_progress";
  const canFinish = isActive || task.status === "expired";
  const completedLate = isLateCompleted(task);
  const storeName = getTaskStoreName(task);

  return (
    <div
      className={`border rounded-xl overflow-hidden cursor-pointer group transition-all
        ${task.task_kind === "daily_product_followup" ? "bg-violet-950/15 ring-1 ring-inset ring-violet-500/10" : "bg-slate-800/55"}
        ${isAdmin && task.admin_highlighted
          ? "border-amber-400/80 ring-2 ring-amber-400/25 shadow-[0_0_24px_rgba(251,191,36,0.10)]"
          : task.status === "expired" ? "border-red-500/30 hover:border-red-400/50"
          : task.status === "completed" ? "border-emerald-500/25 hover:border-emerald-400/45"
          : task.status === "in_progress" ? "border-blue-500/35 hover:border-blue-400/60"
          : "border-slate-700 hover:border-amber-400/40"}`}
      onClick={() => onOpen(task)}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {isAdmin && task.admin_highlighted && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-amber-500/15 text-amber-200 border-amber-500/40 flex items-center gap-1">
                  <ShieldAlert size={9} /> تعليق إداري مهم
                </span>
              )}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                task.task_kind === "daily_product_followup"
                  ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                  : "bg-slate-700/80 text-slate-200 border-slate-600"
              }`}>
                {task.task_kind === "daily_product_followup" ? "متابعة يومية" : "مهمة عادية"}
              </span>

              <span className="text-[10px] font-semibold text-slate-300 bg-slate-900/80 border border-slate-700 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Calendar size={9} />
                {task.task_kind === "daily_product_followup" ? "يوم" : "تسليم"} {formatTaskDay(task)}
              </span>

              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_COLOR[task.status]}`}>
                {STATUS_LABEL[task.status]}
              </span>
              {completedLate && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-orange-500/15 text-orange-300 border-orange-500/30">
                  متأخرة
                </span>
              )}

              {task.platform && (
                <span className="text-[10px] font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-full">
                  {task.platform === "meta" ? "Meta" : task.platform === "google" ? "Google" : "TikTok"}
                </span>
              )}

              {storeName && (
                <span className="text-[10px] text-cyan-300/90 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">
                  {storeName}
                </span>
              )}

              {task.media?.length > 0 && (
                <span className="text-[10px] text-slate-400 bg-slate-700/70 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                  <ImageIcon size={9} /> {task.media.length}
                </span>
              )}

              {task.checkin_count > 0 && (
                <span className="text-[10px] text-blue-300/80 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                  {task.checkin_count} متابعة
                </span>
              )}
            </div>

            <h3 className="text-white font-semibold text-[13px] leading-5 line-clamp-2" title={task.title}>
              {task.title}
            </h3>

            {task.product_name && (
              <p className="text-[11px] text-slate-400 mt-1 truncate" title={task.product_name}>
                {task.product_name}
              </p>
            )}
          </div>

          {task.status === "completed" && score > 0 && (
            <span className={`shrink-0 text-[10px] font-bold px-1.5 py-1 rounded-md bg-slate-900/70 ${scoreColor(score)}`}>
              {score}%
            </span>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            {task.assigned_to_name ? (
              <span className="flex items-center gap-1 text-[11px] text-slate-300 truncate">
                <User size={10} className="text-blue-400 shrink-0" />
                {task.assigned_to_name}
              </span>
            ) : (
              <span className="text-[10px] text-slate-600">بدون مسؤول</span>
            )}
          </div>
          <Countdown deadline={task.deadline} status={task.status} />
        </div>
      </div>

      <div
        className="border-t border-slate-700/50 px-3 py-2 flex items-center gap-1.5 min-h-[38px]"
        onClick={e => e.stopPropagation()}
      >
        {canFinish && task.task_kind === "daily_product_followup" && (
          <button
            onClick={e => { e.stopPropagation(); onCheckin(task); }}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-all ${
              task.status === "expired"
                ? "text-orange-300 bg-orange-500/10 hover:bg-orange-500/20"
                : "text-blue-300 bg-blue-500/10 hover:bg-blue-500/20"
            }`}
          >
            <LogIn size={10} /> {task.status === "expired" ? "إكمال متأخر" : "متابعة"}
          </button>
        )}

        {canFinish && task.task_kind !== "daily_product_followup" && (
          <button
            onClick={e => { e.stopPropagation(); setShowCompleteConfirm(true); }}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-all ${
              task.status === "expired"
                ? "text-orange-300 bg-orange-500/10 hover:bg-orange-500/20"
                : "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20"
            }`}
          >
            <CheckCircle2 size={10} /> {task.status === "expired" ? "إكمال متأخر" : "إتمام"}
          </button>
        )}

        {task.status === "completed" && isAdmin && (
          <button
            onClick={e => { e.stopPropagation(); onReopen(task.id); }}
            className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded-md transition-all"
          >
            <RefreshCw size={10} /> إعادة فتح
          </button>
        )}

        <button
          onClick={e => { e.stopPropagation(); onOpen(task); }}
          className="mr-auto flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-1 rounded-md hover:bg-slate-700/60 transition-all"
        >
          <Eye size={10} /> تفاصيل
        </button>

        {isAdmin && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(task.id); }}
            className="flex items-center justify-center text-red-400/80 hover:text-red-300 hover:bg-red-500/10 w-6 h-6 rounded-md transition-all"
            title="حذف"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {showCompleteConfirm && (
        <CompleteConfirmModal
          task={task}
          isAdmin={isAdmin}
          onConfirm={() => onComplete(task.id)}
          onClose={() => setShowCompleteConfirm(false)}
        />
      )}
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function ScoreDeductionModal({
  buyer,
  onClose,
  onChanged,
}: {
  buyer: BuyerStat;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [points, setPoints] = useState(5);
  const [reason, setReason] = useState("");
  const [taskId, setTaskId] = useState("");
  const [history, setHistory] = useState<ScoreDeduction[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${BASE}/tasks/score-deductions?buyerId=${buyer.userId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("فشل تحميل سجل الخصومات");
      setHistory(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل تحميل سجل الخصومات");
    } finally {
      setLoadingHistory(false);
    }
  }, [buyer.userId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/tasks/score-deductions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_buyer_id: buyer.userId,
          points,
          reason: reason.trim(),
          task_id: taskId.trim() ? Number(taskId) : null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "فشل تسجيل الخصم");
      setReason("");
      setTaskId("");
      await Promise.all([loadHistory(), onChanged()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل تسجيل الخصم");
    } finally {
      setSaving(false);
    }
  }

  async function reverseDeduction(id: number) {
    setError(null);
    try {
      const res = await fetch(`${BASE}/tasks/score-deductions/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "فشل إلغاء الخصم");
      await Promise.all([loadHistory(), onChanged()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل إلغاء الخصم");
    }
  }

  const activeTotal = history
    .filter((row) => !row.reversed_at)
    .reduce((sum, row) => sum + row.points, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-red-500/30 bg-slate-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 p-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <MinusCircle size={17} className="text-red-400" /> خصم من اسكور {buyer.name}
            </h2>
            <p className="text-[11px] text-slate-500 mt-1">
              الاسكور الحالي {buyer.avg_score}% · إجمالي الخصومات النشطة {activeTotal} نقطة
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={17} /></button>
        </div>

        <form onSubmit={submit} className="p-4 space-y-3 border-b border-slate-700/60">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">قيمة الخصم</label>
            <div className="flex gap-1.5 flex-wrap">
              {[5, 10, 15, 20].map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPoints(value)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                    points === value
                      ? "bg-red-600 border-red-500 text-white"
                      : "border-slate-700 text-slate-400 hover:border-red-500/40"
                  }`}
                >
                  -{value}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">سبب الخصم *</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="مثال: تجاهل تعليق الإدارة وعدم متابعة المنتج في الموعد"
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-red-500/50"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">رقم التاسك المرتبط — اختياري</label>
            <input
              value={taskId}
              onChange={e => setTaskId(e.target.value.replace(/\D/g, ""))}
              placeholder="مثال: 527"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-red-500/50"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !reason.trim()}
            className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <MinusCircle size={14} />}
            خصم {points} نقطة وإرسال تنبيه
          </button>
        </form>

        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <History size={14} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-300">سجل الخصومات</h3>
          </div>

          {loadingHistory ? (
            <div className="text-xs text-slate-500 py-4 text-center">جاري التحميل...</div>
          ) : history.length === 0 ? (
            <div className="text-xs text-slate-600 py-4 text-center">لا توجد خصومات سابقة</div>
          ) : (
            <div className="space-y-2">
              {history.map(row => (
                <div key={row.id} className={`rounded-lg border p-3 ${row.reversed_at ? "border-slate-800 bg-slate-800/30 opacity-60" : "border-red-500/20 bg-red-500/5"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-red-300">-{row.points} نقطة</span>
                        {row.reversed_at && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">ملغي</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">{row.reason}</p>
                      <div className="text-[10px] text-slate-600 mt-1.5">
                        بواسطة {row.created_by_name} · {formatDate(row.created_at)}
                        {row.task_id ? ` · تاسك #${row.task_id}` : ""}
                      </div>
                    </div>
                    {!row.reversed_at && (
                      <button
                        onClick={() => reverseDeduction(row.id)}
                        className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-slate-400 hover:text-white hover:border-slate-500"
                      >
                        <RotateCcw size={10} /> إلغاء الخصم
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Leaderboard({
  stats,
  isAdmin,
  onChanged,
}: {
  stats: BuyerStat[];
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [penaltyBuyer, setPenaltyBuyer] = useState<BuyerStat | null>(null);

  if (!stats.length) return (
    <div className="text-center py-12 text-slate-500">
      <Trophy size={32} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">لا توجد إحصائيات بعد</p>
    </div>
  );
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <>
      <div className="space-y-3">
        {stats.map((s, i) => (
          <div key={s.userId}
            className={`bg-slate-800/60 border rounded-xl p-4 flex items-center gap-4
              ${i === 0 ? "border-yellow-500/40" : i === 1 ? "border-slate-500/40" : "border-slate-700/40"}`}>
            <div className="w-8 text-center flex-shrink-0">
              {i < 3 ? <span className="text-xl">{medals[i]}</span>
                      : <span className="text-slate-500 font-bold text-sm">#{i + 1}</span>}
            </div>
            <div className="relative w-[52px] h-[52px] flex items-center justify-center flex-shrink-0">
              {scoreRing(s.avg_score)}
              <span className={`absolute text-[10px] font-bold ${scoreColor(s.avg_score)}`}>{s.avg_score}%</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-white font-semibold text-sm truncate">{s.name}</span>
                {s.in_progress > 0 && (
                  <span className="text-[10px] text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded-full animate-pulse">
                    {s.in_progress} جارية
                  </span>
                )}
                {(s.deduction_points ?? 0) > 0 && (
                  <span className="text-[10px] font-bold text-red-300 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-full">
                    -{s.deduction_points} خصومات
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><CheckCircle2 size={10} className="text-emerald-400" />{s.completed_on_time} في الوقت</span>
                <span className="flex items-center gap-1"><Clock size={10} className="text-amber-400" />{s.completed_late} متأخرة</span>
                <span className="flex items-center gap-1"><AlertTriangle size={10} className="text-red-400" />{s.expired} منتهية</span>
                <span className="flex items-center gap-1"><Flame size={10} className="text-blue-400" />{s.total_checkins} متابعة</span>
                {(s.deduction_points ?? 0) > 0 && s.score_before_deductions !== undefined && (
                  <span className="text-red-300">قبل الخصم: {s.score_before_deductions}%</span>
                )}
              </div>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <Star key={n} size={12}
                    className={n <= Math.ceil(s.avg_score / 20) ? "text-yellow-400 fill-yellow-400" : "text-slate-600"} />
                ))}
              </div>
              {isAdmin && (
                <button
                  onClick={() => setPenaltyBuyer(s)}
                  className="flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 py-1.5 text-[10px] font-semibold text-red-300 hover:bg-red-500/20"
                >
                  <MinusCircle size={11} /> خصم
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {penaltyBuyer && (
        <ScoreDeductionModal
          buyer={penaltyBuyer}
          onClose={() => setPenaltyBuyer(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}


function MissedFollowupsPanel({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const [expandedBuyer, setExpandedBuyer] = useState<string | null>(null);

  const grouped = tasks.reduce<Record<string, Task[]>>((acc, task) => {
    const name = task.assigned_to_name || "غير معيّن";
    (acc[name] ||= []).push(task);
    return acc;
  }, {});

  const buyers = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className={`mb-4 rounded-xl border ${tasks.length > 0 ? "border-red-500/35 bg-red-950/20" : "border-emerald-500/20 bg-emerald-950/10"}`}>
      <div className="px-3 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tasks.length > 0 ? "bg-red-500/15" : "bg-emerald-500/10"}`}>
            {tasks.length > 0
              ? <ShieldAlert size={15} className="text-red-400" />
              : <CheckCircle2 size={15} className="text-emerald-400" />
            }
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">لم تتم المتابعة اليوم</h2>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tasks.length > 0 ? "bg-red-500/15 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>
                {tasks.length}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              تُحتسب فقط المتابعات اليومية التي انتهى موعدها الساعة 9:00 مساءً بدون تعليق.
            </p>
          </div>
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="border-t border-red-500/15 p-2 grid gap-2 md:grid-cols-2">
          {buyers.map(([buyer, buyerTasks]) => {
            const open = expandedBuyer === buyer;
            return (
              <div key={buyer} className="rounded-lg border border-slate-700/70 bg-slate-900/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedBuyer(open ? null : buyer)}
                  className="w-full px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/60 transition-colors text-right"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <User size={12} className="text-red-300 shrink-0" />
                    <span className="text-xs font-semibold text-slate-200 truncate">{buyer}</span>
                    <span className="text-[10px] font-bold text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                      {buyerTasks.length} ناقصة
                    </span>
                  </div>
                  {open ? <ChevronUp size={13} className="text-slate-500" /> : <ChevronDown size={13} className="text-slate-500" />}
                </button>

                {open && (
                  <div className="border-t border-slate-700/60 divide-y divide-slate-800">
                    {buyerTasks.map(task => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpen(task)}
                        className="w-full px-3 py-2 flex items-center justify-between gap-3 text-right hover:bg-red-500/5 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-slate-200 truncate">
                            {task.product_name || task.title}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {task.platform && (
                              <span className="text-[10px] text-blue-300">
                                {task.platform === "meta" ? "Meta" : task.platform === "google" ? "Google" : "TikTok"}
                              </span>
                            )}
                            {getTaskStoreName(task) && (
                              <>
                                <span className="text-slate-700">•</span>
                                <span className="text-[10px] text-slate-500">{getTaskStoreName(task)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <Eye size={11} className="text-slate-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { user } = useAuth();
  const isAdmin  = user?.role === "admin";

  const [tasks,     setTasks]     = useState<Task[]>([]);
  const [stats,     setStats]     = useState<BuyerStat[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState<"tasks" | "leaderboard">("tasks");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState<"all" | "followup" | "manual">("all");
  const [dateFilter, setDateFilter] = useState<"today" | "yesterday" | "all" | "custom">("today");
  const [customDate, setCustomDate] = useState("");
  const [buyerFilter,  setBuyerFilter]  = useState<string>("all");
  const [searchQuery,  setSearchQuery]  = useState("");
  const [showModal,    setShowModal]    = useState(false);
  const [checkinTask,  setCheckinTask]  = useState<Task | null>(null);
  const [detailTask,   setDetailTask]   = useState<Task | null>(null);
  const [editTask,     setEditTask]     = useState<Task | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [tRes, sRes, aRes] = await Promise.all([
        fetch(`${BASE}/tasks`,           { credentials: "include" }),
        fetch(`${BASE}/tasks/stats`,     { credentials: "include" }),
        fetch(`${BASE}/tasks/assignees`, { credentials: "include" }),
      ]);

      // Tasks: hard failure — show error if this fails
      if (!tRes.ok) {
        const err = await tRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "خطأ في جلب المهام");
      }
      const tasksData: Task[] = await tRes.json();
      setTasks(tasksData);

      // Stats: soft failure — empty array on error, don't crash the page
      const statsData: BuyerStat[] = sRes.ok
        ? await sRes.json().catch(() => [])
        : [];
      setStats(statsData);

      // Assignees: soft failure — empty array on error
      const assigneesData: Assignee[] = aRes.ok
        ? await aRes.json().catch(() => [])
        : [];
      setAssignees(assigneesData);

    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    pollingRef.current = setInterval(() => fetchAll(true), 30_000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchAll]);

  // فتح تاسك معين من الـ URL — مثلاً /tasks?taskId=123
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId");
    if (!taskId || tasks.length === 0) return;
    const found = tasks.find(t => t.id === Number(taskId));
    if (found) {
      setDetailTask(found);
      // امسح الـ query param من الـ URL بدون reload
      window.history.replaceState({}, "", "/tasks");
    }
  }, [tasks]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function createTask(data: Partial<Task>, files: File[]) {
    const res = await fetch(`${BASE}/tasks`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "فشل الإنشاء");
    const created: Task = await res.json();

    // Upload files, then register every successful upload on the created task.
    // Render returns a same-origin relative upload URL, while object storage may
    // return an absolute URL. Resolve both forms and never hide upload failures.
    const failedUploads: string[] = [];

    for (const file of files) {
      try {
        const contentType = file.type || "application/octet-stream";

        const urlRes = await fetch(`${BASE}/storage/uploads/request-url`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            size: file.size,
            contentType,
          }),
        });

        if (!urlRes.ok) {
          throw new Error(`request-url failed: ${urlRes.status}`);
        }

        const { uploadURL, objectPath } = await urlRes.json() as {
          uploadURL: string;
          objectPath: string;
        };

        const resolvedUploadURL = new URL(uploadURL, window.location.origin).toString();
        const putRes = await fetch(resolvedUploadURL, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": contentType },
          body: file,
        });

        if (!putRes.ok) {
          throw new Error(`upload failed: ${putRes.status}`);
        }

        const registerRes = await fetch(`${BASE}/tasks/${created.id}/media`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectPath,
            originalName: file.name,
            mimeType: contentType,
          }),
        });

        if (!registerRes.ok) {
          throw new Error(`media registration failed: ${registerRes.status}`);
        }
      } catch (uploadError) {
        console.error("Task media upload failed", {
          taskId: created.id,
          fileName: file.name,
          error: uploadError,
        });
        failedUploads.push(file.name);
      }
    }

    await fetchAll(true);

    if (failedUploads.length > 0) {
      setError(
        `تم إنشاء المهمة، لكن فشل إرفاق ${failedUploads.length} ملف: ${failedUploads.join("، ")}`,
      );
    }
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
    setDeleteConfirmId(id);
  }

  async function confirmDelete(id: number) {
    await fetch(`${BASE}/tasks/${id}`, { method: "DELETE", credentials: "include" });
    setDeleteConfirmId(null);
    await fetchAll(true);
  }

  async function updateTask(id: number, data: Partial<Task>) {
    await patchTask(id, data as Record<string, unknown>);
    setEditTask(null);
  }

  // ── Filtered tasks ─────────────────────────────────────────────────────────

  const cairoToday = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const cairoYesterday = (() => {
    const d = new Date(`${cairoToday}T12:00:00+03:00`);
    d.setDate(d.getDate() - 1);
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  })();

  const selectedDateKey =
    dateFilter === "today" ? cairoToday
    : dateFilter === "yesterday" ? cairoYesterday
    : dateFilter === "custom" ? customDate
    : null;

  const dateScopedTasks = tasks.filter(task => {
    if (!selectedDateKey) return true;
    return taskOperationalDateKey(task) === selectedDateKey;
  });

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filtered = dateScopedTasks
    .filter(t => statusFilter === "all" || t.status === statusFilter)
    .filter(t => taskTypeFilter === "all"
      || (taskTypeFilter === "followup" && t.task_kind === "daily_product_followup")
      || (taskTypeFilter === "manual" && t.task_kind !== "daily_product_followup"))
    .filter(t => buyerFilter === "all" || t.assigned_to_name === buyerFilter)
    .filter(t => {
      if (!normalizedSearch) return true;
      return [
        t.title,
        t.product_name,
        t.assigned_to_name,
        t.platform,
        getTaskStoreName(t),
      ].some(value => value?.toLowerCase().includes(normalizedSearch));
    })
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  const counts: Record<string, number> = { all: dateScopedTasks.length };
  for (const t of dateScopedTasks) counts[t.status] = (counts[t.status] ?? 0) + 1;

  const taskTypeCounts = {
    all: dateScopedTasks.length,
    followup: dateScopedTasks.filter(t => t.task_kind === "daily_product_followup").length,
    manual: dateScopedTasks.filter(t => t.task_kind !== "daily_product_followup").length,
  };

  // Unique buyer names from tasks (for filter dropdown)
  const buyerNames = Array.from(
    new Set(dateScopedTasks.map(t => t.assigned_to_name).filter((n): n is string => Boolean(n)))
  ).sort();

  const filterTabs: { key: "all" | TaskStatus; label: string }[] = [
    { key: "all",         label: `الكل (${counts.all ?? 0})` },
    { key: "in_progress", label: `جارية (${counts.in_progress ?? 0})` },
    { key: "pending",     label: `معلّقة (${counts.pending ?? 0})` },
    { key: "expired",     label: `منتهية (${counts.expired ?? 0})` },
    { key: "completed",   label: `مكتملة (${counts.completed ?? 0})` },
  ];

  const missedToday = tasks.filter(task => {
    if (task.task_kind !== "daily_product_followup") return false;
    if (task.status !== "expired") return false;
    if (!task.daily_followup_date) return false;
    return task.daily_followup_date.slice(0, 10) === cairoToday;
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white p-3 md:p-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Calendar className="text-blue-400" size={22} /> المهام اليومية
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
              <Plus size={16} /> مهمة جديدة
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {[
            { label: "جارية",  value: counts.in_progress ?? 0, color: "text-blue-400",    icon: <Flame size={13} className="text-blue-400" /> },
            { label: "معلّقة", value: counts.pending ?? 0,     color: "text-amber-400",   icon: <Clock size={13} className="text-amber-400" /> },
            { label: "منتهية", value: counts.expired ?? 0,     color: "text-red-400",     icon: <AlertTriangle size={13} className="text-red-400" /> },
            { label: "مكتملة", value: counts.completed ?? 0,   color: "text-emerald-400", icon: <CheckCircle2 size={13} className="text-emerald-400" /> },
          ].map(s => (
            <div key={s.label} className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 flex items-center gap-2 min-w-[112px]">
              {s.icon}
              <span className={`text-base font-bold ${s.color}`}>{s.value}</span>
              <span className="text-[11px] text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {!loading && isAdmin && (
        <MissedFollowupsPanel tasks={missedToday} onOpen={setDetailTask} />
      )}

      {/* Main tabs */}
      <div className="flex gap-2 mb-5 border-b border-slate-800">
        {[
          { key: "tasks",       label: "مركز المهام",  icon: <Target size={14} /> },
          { key: "leaderboard", label: "لوحة الإنجاز", icon: <BarChart3 size={14} /> },
        ].map(t => (
          <button key={t.key}
            onClick={() => setTab(t.key as "tasks" | "leaderboard")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px
              ${tab === t.key ? "text-blue-400 border-blue-400" : "text-slate-400 border-transparent hover:text-slate-200"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle size={14} />{error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 size={28} className="animate-spin mr-3" /><span>جاري التحميل...</span>
        </div>
      )}

      {/* Tasks tab */}
      {!loading && tab === "tasks" && (
        <>
          {/* Filters row */}
          <div className="sticky top-0 z-20 -mx-1 px-1 py-2 mb-3 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800/70">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative min-w-[220px] flex-1 max-w-md">
                <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="ابحث باسم المنتج أو المهمة..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-700 p-1">
                {([
                  { key: "today", label: "اليوم" },
                  { key: "yesterday", label: "أمس" },
                  { key: "all", label: "كل التواريخ" },
                ] as const).map(day => (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => setDateFilter(day.key)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                      dateFilter === day.key
                        ? "bg-cyan-600 text-white"
                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
                <input
                  type="date"
                  value={customDate}
                  onChange={e => {
                    setCustomDate(e.target.value);
                    if (e.target.value) setDateFilter("custom");
                  }}
                  className={`bg-transparent border-r border-slate-700 pr-2 text-[11px] outline-none ${
                    dateFilter === "custom" ? "text-cyan-300" : "text-slate-500"
                  }`}
                  aria-label="اختيار تاريخ المهام"
                />
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-700 p-1">
                {([
                  { key: "all", label: `النوع: الكل (${taskTypeCounts.all})` },
                  { key: "followup", label: `متابعة يومية (${taskTypeCounts.followup})` },
                  { key: "manual", label: `مهام عادية (${taskTypeCounts.manual})` },
                ] as const).map(type => (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() => setTaskTypeFilter(type.key)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                      taskTypeFilter === type.key
                        ? type.key === "followup"
                          ? "bg-violet-600 text-white"
                          : type.key === "manual"
                            ? "bg-slate-600 text-white"
                            : "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-1 flex-wrap">
                {filterTabs.map(f => (
                  <button key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border
                      ${statusFilter === f.key
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}>
                    {f.label}
                  </button>
                ))}
              </div>

              {buyerNames.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Filter size={11} className="text-slate-500" />
                  <select value={buyerFilter} onChange={e => setBuyerFilter(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-blue-500">
                    <option value="all">كل المشترين</option>
                    {buyerNames.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Grid */}
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
            <div className="space-y-5">
              {([
                { status: "in_progress" as TaskStatus, label: "جارية الآن", dot: "bg-blue-400", text: "text-blue-300" },
                { status: "pending" as TaskStatus, label: "معلّقة", dot: "bg-amber-400", text: "text-amber-300" },
                { status: "expired" as TaskStatus, label: "منتهية / تحتاج مراجعة", dot: "bg-red-400", text: "text-red-300" },
                { status: "completed" as TaskStatus, label: "مكتملة", dot: "bg-emerald-400", text: "text-emerald-300" },
              ]).map(section => {
                const sectionTasks = filtered.filter(t => t.status === section.status);
                if (sectionTasks.length === 0) return null;

                return (
                  <section key={section.status}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full ${section.dot}`} />
                      <h2 className={`text-xs font-semibold ${section.text}`}>{section.label}</h2>
                      <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">
                        {sectionTasks.length}
                      </span>
                      <div className="h-px bg-slate-800 flex-1" />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {sectionTasks.map(t => (
                        <TaskCard key={t.id} task={t} isAdmin={isAdmin}
                          onOpen={setDetailTask}
                          onCheckin={setCheckinTask}
                          onComplete={id => patchTask(id, { action: "complete" })}
                          onDelete={deleteTask}
                          onReopen={id => patchTask(id, { action: "reopen" })} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Leaderboard tab */}
      {!loading && tab === "leaderboard" && (
        <div className="max-w-2xl mx-auto">
          <Leaderboard stats={stats} isAdmin={isAdmin} onChanged={() => fetchAll(true)} />
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <AssignModal assignees={assignees} onSave={createTask} onClose={() => setShowModal(false)} />
      )}
      {checkinTask && (
        <CheckinModal task={checkinTask}
          onSave={notes => patchTask(checkinTask.id, { action: "checkin", notes })}
          onClose={() => setCheckinTask(null)} />
      )}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          isAdmin={isAdmin}
          onClose={() => setDetailTask(null)}
          onCheckin={t => { setDetailTask(null); setCheckinTask(t); }}
          onComplete={id => { patchTask(id, { action: "complete" }); setDetailTask(null); }}
          onDelete={id => { deleteTask(id); setDetailTask(null); }}
          onReopen={id => { patchTask(id, { action: "reopen" }); setDetailTask(null); }}
          onEdit={t => { setDetailTask(null); setEditTask(t); }}
          onClearHighlight={id => patchTask(id, { action: "clear_highlight" })}
          onChanged={() => fetchAll(true)}
        />
      )}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-slate-900 border border-red-500/40 rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 size={18} className="text-red-400" />
              </div>
              <div>
                <h2 className="text-white font-bold text-base">حذف المهمة</h2>
                <p className="text-slate-400 text-xs mt-0.5">هذا الإجراء لا يمكن التراجع عنه</p>
              </div>
            </div>
            <p className="text-slate-300 text-sm">هل أنت متأكد من حذف هذه المهمة نهائياً؟</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
                إلغاء
              </button>
              <button onClick={() => confirmDelete(deleteConfirmId)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2">
                <Trash2 size={14} /> حذف نهائياً
              </button>
            </div>
          </div>
        </div>
      )}

      {editTask && (
        <EditTaskModal
          task={editTask}
          assignees={assignees}
          onSave={updateTask}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  );
}
