import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, CheckCircle2, Clock, AlertTriangle, Loader2, Trash2,
  RefreshCw, LogIn, Trophy, Flame, Star, User, Target,
  ChevronDown, ChevronUp, BarChart3, Calendar, X, Upload,
  Image as ImageIcon, Video, Filter, ShieldAlert, Download,
  FileText, Eye,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const _BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
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
}

interface BuyerStat {
  userId: number; name: string; total_tasks: number;
  completed_on_time: number; completed_late: number;
  in_progress: number; expired: number; total_checkins: number; avg_score: number;
}

interface Assignee { id: number; username: string; role: string; }

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

// "now + N hours" as datetime-local string (Cairo local time, no UTC offset)
function nowPlusHours(h: number): string {
  const d = new Date(Date.now() + h * 3600000);
  return d.toLocaleString("sv-SE", { timeZone: "Africa/Cairo" }).slice(0, 16).replace(" ", "T");
}

function mediaUrl(m: TaskMedia): string {
  return `${BASE}/task-uploads/${m.file_path}`;
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
            <LogIn size={16} className="text-blue-400" /> تسجيل متابعة
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-slate-300 text-sm">{task.title}</p>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="ملاحظة المتابعة (اختياري)..."
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none" />
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-all">
              إلغاء
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />} تسجيل
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

// ── Task Detail Modal ──────────────────────────────────────────────────────────

function TaskDetailModal({ task, isAdmin, onClose, onCheckin, onComplete, onDelete, onReopen }: {
  task: Task; isAdmin: boolean;
  onClose: () => void;
  onCheckin: (task: Task) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onReopen: (id: number) => void;
}) {
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const isActive = task.status === "pending" || task.status === "in_progress";
  const score = task.opus_score ?? 0;

  const isImage = (m: TaskMedia) => m.mime_type.startsWith("image/");
  const isVideo = (m: TaskMedia) => m.mime_type.startsWith("video/");

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
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLOR[task.status]}`}>
                {STATUS_LABEL[task.status]}
              </span>
              {task.product_name && (
                <span className="text-xs text-slate-400 bg-slate-700/60 px-2.5 py-1 rounded-full">
                  {task.product_name}
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
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 p-4 border-t border-slate-700/60 bg-slate-900/80">
          {isActive && (
            <>
              <button onClick={() => { onCheckin(task); onClose(); }}
                className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-2 rounded-xl transition-all">
                <LogIn size={13} /> متابعة
              </button>
              <button onClick={() => setShowCompleteConfirm(true)}
                className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 rounded-xl transition-all">
                <CheckCircle2 size={13} /> إتمام
              </button>
            </>
          )}
          {task.status === "completed" && isAdmin && (
            <button onClick={() => { onReopen(task.id); onClose(); }}
              className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-2 rounded-xl transition-all">
              <RefreshCw size={13} /> إعادة فتح
            </button>
          )}
          {isAdmin && (
            <button onClick={() => { onDelete(task.id); onClose(); }}
              className="mr-auto flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-2 rounded-xl transition-all">
              <Trash2 size={13} /> حذف
            </button>
          )}
          <button onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700/80 px-3 py-2 rounded-xl transition-all">
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
  const [expanded,        setExpanded]        = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const score    = task.opus_score ?? 0;
  const isActive = task.status === "pending" || task.status === "in_progress";

  return (
    <div className={`bg-slate-800/60 backdrop-blur-sm border rounded-xl overflow-hidden transition-all duration-300 cursor-pointer group
      ${task.status === "expired" ? "border-red-500/30 opacity-70 hover:opacity-90"
      : task.status === "completed" ? "border-emerald-500/30 hover:border-emerald-400/50"
      : task.status === "in_progress" ? "border-blue-500/40 hover:border-blue-400/60"
      : "border-slate-700 hover:border-slate-500"}`}
      onClick={() => onOpen(task)}>

      {/* Primary media banner */}
      {task.media?.length > 0 && (
        <div className="w-full">
          <MediaPreview media={task.media} />
        </div>
      )}

      {/* Card body */}
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
            <h3 className="text-white font-semibold text-sm leading-snug mb-1.5" title={task.title}>
              {task.title}
            </h3>
            <div className="flex items-center gap-3 flex-wrap">
              {task.assigned_to_name && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                  <User size={10} className="text-blue-400" />{task.assigned_to_name}
                </span>
              )}
              <Countdown deadline={task.deadline} status={task.status} />
            </div>
          </div>

          {task.status === "completed" && score > 0 && <ScoreBadge score={score} />}
          {task.status === "in_progress" && (
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
              <Flame size={14} className="text-blue-400" />
            </div>
          )}
        </div>

        {task.success_metric && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Target size={10} className="text-purple-400 flex-shrink-0" />
            هدف: <span className="text-purple-300">{task.success_metric}</span>
          </div>
        )}

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

        {/* Created-by — always visible */}
        {task.created_by_name && (
          <div className="mt-2.5 pt-2.5 border-t border-slate-700/40 flex items-center gap-1.5 text-[11px] text-slate-500">
            <User size={10} className="flex-shrink-0" />
            أُضيفت بواسطة:&nbsp;<span className="text-slate-300 font-medium">{task.created_by_name}</span>
          </div>
        )}
      </div>

      {/* Expand / details (notes + deadline only) */}
      {task.notes && (
        <div className="border-t border-slate-700/50">
          <button onClick={() => setExpanded(v => !v)}
            className="w-full px-4 py-2 flex items-center justify-between text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
            <span>{expanded ? "إخفاء الملاحظات" : "عرض الملاحظات"}</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {expanded && (
            <div className="px-4 pb-3 space-y-1.5 text-[11px] text-slate-400">
              <p className="leading-relaxed">{task.notes}</p>
              <p>الموعد النهائي: <span className="text-slate-300">{formatDate(task.deadline)}</span></p>
              {task.completed_at && <p>اكتملت: <span className="text-emerald-300">{formatDate(task.completed_at)}</span></p>}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-slate-700/50 px-4 py-2.5 flex items-center gap-2"
        onClick={e => e.stopPropagation()}>
        {isActive && (
          <>
            <button onClick={e => { e.stopPropagation(); onCheckin(task); }}
              className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1.5 rounded-lg transition-all">
              <LogIn size={11} /> متابعة
            </button>
            <button onClick={e => { e.stopPropagation(); setShowCompleteConfirm(true); }}
              className="flex items-center gap-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg transition-all">
              <CheckCircle2 size={11} /> إتمام
            </button>
          </>
        )}
        {task.status === "completed" && isAdmin && (
          <button onClick={e => { e.stopPropagation(); onReopen(task.id); }}
            className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 rounded-lg transition-all">
            <RefreshCw size={11} /> إعادة فتح
          </button>
        )}
        {isAdmin && (
          <button onClick={e => { e.stopPropagation(); onDelete(task.id); }}
            className="mr-auto flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-lg transition-all">
            <Trash2 size={11} /> حذف
          </button>
        )}
        {/* Open detail hint */}
        <span className="mr-auto flex items-center gap-1 text-[10px] text-slate-600 group-hover:text-slate-400 transition-colors pointer-events-none select-none">
          <Eye size={10} /> تفاصيل
        </span>
      </div>

      {/* Complete confirm modal — rendered inside card to keep state local */}
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
          <div className="w-8 text-center flex-shrink-0">
            {i < 3 ? <span className="text-xl">{medals[i]}</span>
                    : <span className="text-slate-500 font-bold text-sm">#{i + 1}</span>}
          </div>
          <div className="relative w-[52px] h-[52px] flex items-center justify-center flex-shrink-0">
            {scoreRing(s.avg_score)}
            <span className={`absolute text-[10px] font-bold ${scoreColor(s.avg_score)}`}>{s.avg_score}%</span>
          </div>
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
              <span className="flex items-center gap-1"><CheckCircle2 size={10} className="text-emerald-400" />{s.completed_on_time} في الوقت</span>
              <span className="flex items-center gap-1"><Clock size={10} className="text-amber-400" />{s.completed_late} متأخرة</span>
              <span className="flex items-center gap-1"><AlertTriangle size={10} className="text-red-400" />{s.expired} منتهية</span>
              <span className="flex items-center gap-1"><Flame size={10} className="text-blue-400" />{s.total_checkins} متابعة</span>
            </div>
          </div>
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
  const [buyerFilter,  setBuyerFilter]  = useState<string>("all");
  const [showModal,    setShowModal]    = useState(false);
  const [checkinTask,  setCheckinTask]  = useState<Task | null>(null);
  const [detailTask,   setDetailTask]   = useState<Task | null>(null);
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

  // ── Actions ────────────────────────────────────────────────────────────────

  async function createTask(data: Partial<Task>, files: File[]) {
    const res = await fetch(`${BASE}/tasks`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "فشل الإنشاء");
    const created: Task = await res.json();

    // Upload files sequentially
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      await fetch(`${BASE}/tasks/${created.id}/media`, {
        method: "POST", credentials: "include", body: fd,
      });
    }
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

  // ── Filtered tasks ─────────────────────────────────────────────────────────

  const filtered = tasks
    .filter(t => statusFilter === "all" || t.status === statusFilter)
    .filter(t => buyerFilter  === "all" || t.assigned_to_name === buyerFilter);

  const counts: Record<string, number> = { all: tasks.length };
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;

  // Unique buyer names from tasks (for filter dropdown)
  const buyerNames = Array.from(
    new Set(tasks.map(t => t.assigned_to_name).filter((n): n is string => Boolean(n)))
  ).sort();

  const filterTabs: { key: "all" | TaskStatus; label: string }[] = [
    { key: "all",         label: `الكل (${counts.all ?? 0})` },
    { key: "in_progress", label: `جارية (${counts.in_progress ?? 0})` },
    { key: "pending",     label: `معلّقة (${counts.pending ?? 0})` },
    { key: "expired",     label: `منتهية (${counts.expired ?? 0})` },
    { key: "completed",   label: `مكتملة (${counts.completed ?? 0})` },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "جارية",  value: counts.in_progress ?? 0, color: "text-blue-400",    icon: <Flame size={16} className="text-blue-400" /> },
            { label: "معلّقة", value: counts.pending ?? 0,     color: "text-amber-400",   icon: <Clock size={16} className="text-amber-400" /> },
            { label: "مكتملة", value: counts.completed ?? 0,   color: "text-emerald-400", icon: <CheckCircle2 size={16} className="text-emerald-400" /> },
            { label: "منتهية", value: counts.expired ?? 0,     color: "text-red-400",     icon: <AlertTriangle size={16} className="text-red-400" /> },
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
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            {/* Status filter */}
            <div className="flex gap-1.5 flex-wrap">
              {filterTabs.map(f => (
                <button key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                    ${statusFilter === f.key
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}>
                  {f.label}
                </button>
              ))}
            </div>

            {/* Buyer filter */}
            {buyerNames.length > 0 && (
              <div className="flex items-center gap-2 mr-auto">
                <Filter size={12} className="text-slate-500" />
                <select value={buyerFilter} onChange={e => setBuyerFilter(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500">
                  <option value="all">كل المشترين</option>
                  {buyerNames.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            )}
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map(t => (
                <TaskCard key={t.id} task={t} isAdmin={isAdmin}
                  onOpen={setDetailTask}
                  onCheckin={setCheckinTask}
                  onComplete={id => patchTask(id, { action: "complete" })}
                  onDelete={deleteTask}
                  onReopen={id => patchTask(id, { action: "reopen" })} />
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
        />
      )}
    </div>
  );
}
