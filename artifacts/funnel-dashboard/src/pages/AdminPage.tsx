import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Trash2, KeyRound, Shield, Clapperboard, Activity,
  Loader2, X, ChevronDown, LogIn, Stethoscope, Film, LayoutDashboard,
  Clock, WifiOff, Bell, BellOff, ChevronUp, Save, CheckSquare, Square,
  MousePointerClick, Eye, EyeOff, Send, SlidersHorizontal, Mail, Bot,
  DatabaseZap, RefreshCw, CheckCircle2, AlertCircle, AlertTriangle,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, ReferenceDot } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility, useUpdatePageVisibility } from "@/hooks/use-page-visibility";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface User {
  id: number;
  username: string;
  role: "admin" | "media_buyer" | "media_manager";
  created_at: string;
}

interface ActivityEntry {
  action: string;
  action_label: string;
  page: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

interface UserWithActivity extends User {
  last_seen_at: string | null;
  push_sub_count: number;
  recent_activity: ActivityEntry[];
  ad_account_id: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "أدمن",
  media_buyer: "ميدياباير",
  media_manager: "مسئول ميديا",
};

const ROLE_ICONS: Record<string, typeof Shield> = {
  admin: Shield,
  media_buyer: Activity,
  media_manager: Clapperboard,
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-violet-500/10 text-violet-600",
  media_buyer: "bg-blue-500/10 text-blue-600",
  media_manager: "bg-emerald-500/10 text-emerald-600",
};

const ACTION_ICONS: Record<string, typeof LogIn> = {
  login: LogIn,
  page_visit: LayoutDashboard,
  diagnosis_run: Stethoscope,
  media_request_created: Film,
};

function RoleBadge({ role }: { role: string }) {
  const Icon = ROLE_ICONS[role] ?? Shield;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[role] ?? "bg-muted text-muted-foreground"}`}>
      <Icon className="h-3 w-3" />
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function OnlineIndicator({ lastSeen }: { lastSeen: string | null }) {
  if (!lastSeen) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <WifiOff className="h-3 w-3" />
        لم يدخل بعد
      </span>
    );
  }
  const diffMs = Date.now() - new Date(lastSeen).getTime();
  const diffMins = diffMs / 60000;

  if (diffMins < 5) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        متصل الآن
      </span>
    );
  }
  if (diffMins < 30) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-600">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        {Math.round(diffMins)} دقيقة مضت
      </span>
    );
  }

  const diffHours = diffMs / 3600000;
  const diffDays = diffMs / 86400000;

  let label: string;
  if (diffDays >= 1) label = `${Math.floor(diffDays)} يوم مضى`;
  else if (diffHours >= 1) label = `${Math.floor(diffHours)} ساعة مضت`;
  else label = `${Math.round(diffMins)} دقيقة مضت`;

  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <WifiOff className="h-3 w-3" />
      {label}
    </span>
  );
}

function ActivityTimeline({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-3">لا يوجد نشاط مسجّل بعد</p>;
  }

  return (
    <div className="space-y-1 py-2">
      {entries.map((entry, i) => {
        const Icon = ACTION_ICONS[entry.action] ?? Clock;
        const isLast = i === entries.length - 1;
        const time = new Date(entry.created_at);
        const timeStr = time.toLocaleString("ar-EG", {
          day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit",
        });

        let description = entry.action_label;
        if (entry.page) description += ` — ${entry.page}`;
        if (entry.meta?.campaign) description += ` — ${entry.meta.campaign}`;

        const colorMap: Record<string, string> = {
          login: "text-violet-600 bg-violet-500/10",
          diagnosis_run: "text-blue-600 bg-blue-500/10",
          media_request_created: "text-emerald-600 bg-emerald-500/10",
          page_visit: "text-muted-foreground bg-muted/40",
        };
        const iconColor = colorMap[entry.action] ?? "text-muted-foreground bg-muted/40";

        return (
          <div key={i} className="flex items-start gap-2.5 px-3">
            <div className="flex flex-col items-center gap-0 shrink-0">
              <div className={`h-6 w-6 rounded-full flex items-center justify-center ${iconColor}`}>
                <Icon className="h-3 w-3" />
              </div>
              {!isLast && <div className="w-px h-4 bg-border mt-0.5" />}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground leading-tight">{description}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 font-mono" dir="ltr">{timeStr}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "media_buyer" | "media_manager">("media_manager");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, role }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "فشل إنشاء المستخدم");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-user-activity"] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "فشل إنشاء المستخدم");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">إضافة مستخدم جديد</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form className="flex flex-col gap-4 p-5" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">اسم المستخدم</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="user123"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="6 أحرف على الأقل"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">الصلاحية</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "media_buyer" | "media_manager")}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="admin">أدمن — يرى كل شيء + إدارة المستخدمين</option>
              <option value="media_buyer">ميدياباير — يرى كل شيء ماعدا إدارة المستخدمين</option>
              <option value="media_manager">مسئول ميديا — طلبات الميديا فقط</option>
            </select>
          </div>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="h-9 px-4 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              إضافة
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/admin/users/${user.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "فشل تغيير كلمة المرور");
    },
    onSuccess: () => setDone(true),
    onError: (err) => setError(err instanceof Error ? err.message : "خطأ"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">تغيير كلمة المرور — {user.username}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {done ? (
          <div className="p-5 text-center">
            <p className="text-emerald-500 font-medium">تم تغيير كلمة المرور بنجاح</p>
            <button onClick={onClose} className="mt-4 h-9 px-4 rounded-lg bg-emerald-500 text-white text-sm">إغلاق</button>
          </div>
        ) : (
          <form className="flex flex-col gap-4 p-5" onSubmit={(e) => { e.preventDefault(); reset.mutate(); }}>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">كلمة المرور الجديدة</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="6 أحرف على الأقل"
              />
            </div>
            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted">إلغاء</button>
              <button
                type="submit"
                disabled={reset.isPending}
                className="h-9 px-4 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
              >
                {reset.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                حفظ
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function UserActivityCard({
  u,
  me,
  onReset,
  onDelete,
}: {
  u: UserWithActivity;
  me: { id: number } | null | undefined;
  onReset: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingAccount, setEditingAccount] = useState(false);
  const [accountInput, setAccountInput] = useState(u.ad_account_id ?? "");
  const qc = useQueryClient();

  const saveAccount = useMutation({
    mutationFn: async (val: string) => {
      const r = await fetch(`${API}/admin/users/${u.id}/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ad_account_id: val.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "فشل التحديث");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-activity"] });
      setEditingAccount(false);
    },
    onError: (err) => alert(err instanceof Error ? err.message : "فشل التحديث"),
  });

  const statsMap = u.recent_activity.reduce<Record<string, number>>((acc, e) => {
    acc[e.action] = (acc[e.action] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-sm font-bold uppercase">{u.username[0]}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{u.username}</p>
              <RoleBadge role={u.role} />
            </div>
            <OnlineIndicator lastSeen={u.last_seen_at} />
            {/* Ad account assignment */}
            {editingAccount ? (
              <div className="flex items-center gap-1.5 mt-1.5" dir="ltr">
                <input
                  autoFocus
                  value={accountInput}
                  onChange={(e) => setAccountInput(e.target.value)}
                  placeholder="رقم الحساب الإعلاني"
                  dir="ltr"
                  className="h-7 px-2 text-xs rounded-md border border-border bg-background font-mono w-44 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={() => saveAccount.mutate(accountInput)}
                  disabled={saveAccount.isPending}
                  className="h-7 px-2 rounded-md text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {saveAccount.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                </button>
                <button
                  onClick={() => { setEditingAccount(false); setAccountInput(u.ad_account_id ?? ""); }}
                  className="h-7 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAccountInput(u.ad_account_id ?? ""); setEditingAccount(true); }}
                className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors group"
              >
                {u.ad_account_id ? (
                  <span className="font-mono bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded text-[10px]">
                    {u.ad_account_id}
                  </span>
                ) : (
                  <span className="text-muted-foreground/60">بدون حساب إعلاني محدد</span>
                )}
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Push notification status */}
          {u.push_sub_count > 0 ? (
            <span title={`الإشعارات مفعّلة (${u.push_sub_count} جهاز)`} className="hidden sm:flex items-center gap-1 text-[10px] text-amber-600 bg-amber-500/10 rounded-full px-2 py-0.5">
              <Bell className="h-2.5 w-2.5" />
              {u.push_sub_count > 1 ? `${u.push_sub_count} أجهزة` : "إشعارات"}
            </span>
          ) : (
            <span title="الإشعارات غير مفعّلة" className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              <BellOff className="h-2.5 w-2.5" />
              بدون إشعارات
            </span>
          )}
          {/* Quick stats */}
          {(statsMap["diagnosis_run"] ?? 0) > 0 && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-blue-600 bg-blue-500/10 rounded-full px-2 py-0.5">
              <Stethoscope className="h-2.5 w-2.5" />
              {statsMap["diagnosis_run"]} تشخيص
            </span>
          )}
          {(statsMap["media_request_created"] ?? 0) > 0 && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-500/10 rounded-full px-2 py-0.5">
              <Film className="h-2.5 w-2.5" />
              {statsMap["media_request_created"]} طلب
            </span>
          )}

          <button
            onClick={onReset}
            title="تغيير كلمة المرور"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <KeyRound className="h-4 w-4" />
          </button>
          {u.id !== me?.id && (
            <button
              onClick={onDelete}
              title="حذف المستخدم"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            title="عرض النشاط"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Activity panel */}
      {expanded && (
        <div className="border-t border-border bg-muted/5">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              آخر النشاطات
            </span>
            <span className="text-[10px] text-muted-foreground">
              {u.recent_activity.length > 0 ? `آخر ${u.recent_activity.length} نشاط` : ""}
            </span>
          </div>
          <ActivityTimeline entries={u.recent_activity} />
        </div>
      )}
    </div>
  );
}

interface NotifSetting {
  event_type: string;
  enabled: boolean;
  recipient_roles: string[];
}

const EVENT_META: Record<string, { label: string; icon: string; desc: string }> = {
  manual_request_created: {
    label: "طلب ميديا يدوي جديد",
    icon: "🆕",
    desc: "عندما يُضيف أحدهم طلب ميديا يدوياً من الصفحة",
  },
  new_scan_request: {
    label: "طلب جديد (سكان تلقائي)",
    icon: "📋",
    desc: "عندما يكتشف السكان التلقائي حملة تحتاج ميديا جديدة",
  },
  request_completed: {
    label: "طلب مكتمل",
    icon: "✅",
    desc: "عندما يُكتمل طلب ميديا ويُسلَّم",
  },
  request_rejected: {
    label: "طلب مرفوض",
    icon: "🔴",
    desc: "عندما يُحذف/يُرفض طلب ميديا",
  },
};

const ALL_ROLES = [
  { key: "admin", label: "أدمن" },
  { key: "media_buyer", label: "ميدياباير" },
  { key: "media_manager", label: "مسئول ميديا" },
];

function NotificationSettingsSection() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NotifSetting[] | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["push-settings"],
    queryFn: () =>
      fetch(`${API}/push/settings`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.settings as NotifSetting[]),
    enabled: open,
  });

  const settings = draft ?? data ?? [];

  function toggleEvent(eventType: string) {
    const base = draft ?? data ?? [];
    setDraft(
      base.map((s) =>
        s.event_type === eventType ? { ...s, enabled: !s.enabled } : s
      )
    );
  }

  function toggleRole(eventType: string, role: string) {
    const base = draft ?? data ?? [];
    setDraft(
      base.map((s) => {
        if (s.event_type !== eventType) return s;
        const has = s.recipient_roles.includes(role);
        return {
          ...s,
          recipient_roles: has
            ? s.recipient_roles.filter((r) => r !== role)
            : [...s.recipient_roles, role],
        };
      })
    );
  }

  const qcInner = useQueryClient();
  const save = useMutation({
    mutationFn: (toSave: NotifSetting[]) =>
      fetch(`${API}/push/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ settings: toSave }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setSaved(true);
      setDraft(null);
      qcInner.invalidateQueries({ queryKey: ["push-settings"] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const isDirty = draft !== null;

  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sendTest = useMutation({
    mutationFn: () =>
      fetch(`${API}/push/test`, { method: "POST", credentials: "include" }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.ok) {
        setTestMsg({ ok: true, text: "✓ الإشعار اتبعت — شوف هاتفك" });
      } else {
        setTestMsg({ ok: false, text: d.error ?? "فشل الإرسال" });
      }
      setTimeout(() => setTestMsg(null), 4000);
    },
    onError: () => {
      setTestMsg({ ok: false, text: "فشل الإرسال — تأكد من تفعيل الإشعارات أولاً" });
      setTimeout(() => setTestMsg(null), 4000);
    },
  });

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-500" />
          إعدادات الإشعارات
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          {isLoading && !data ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {settings.map((s) => {
                const meta = EVENT_META[s.event_type];
                if (!meta) return null;
                return (
                  <div
                    key={s.event_type}
                    className={`rounded-xl border p-4 transition-colors ${
                      s.enabled
                        ? "border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-900/10"
                        : "border-border bg-muted/10"
                    }`}
                  >
                    {/* Event header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium flex items-center gap-1.5">
                          <span>{meta.icon}</span>
                          {meta.label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{meta.desc}</p>
                      </div>
                      {/* Toggle */}
                      <button
                        onClick={() => toggleEvent(s.event_type)}
                        className={`relative shrink-0 h-6 w-11 rounded-full transition-colors ${
                          s.enabled ? "bg-amber-500" : "bg-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            s.enabled ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Role checkboxes */}
                    {s.enabled && (
                      <div>
                        <p className="text-[11px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                          يُرسَل لـ
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {ALL_ROLES.map((r) => {
                            const checked = s.recipient_roles.includes(r.key);
                            return (
                              <button
                                key={r.key}
                                onClick={() => toggleRole(s.event_type, r.key)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                                  checked
                                    ? "bg-amber-500 text-white border-amber-500"
                                    : "border-border text-muted-foreground hover:border-amber-400 hover:text-amber-600"
                                }`}
                              >
                                {checked ? (
                                  <CheckSquare className="h-3 w-3" />
                                ) : (
                                  <Square className="h-3 w-3" />
                                )}
                                {r.label}
                              </button>
                            );
                          })}
                        </div>
                        {s.recipient_roles.length === 0 && (
                          <p className="text-[11px] text-red-500 mt-1.5">
                            ⚠️ لم يُحدد أحد — لن يُرسَل إشعار
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Test + Save row */}
              <div className="flex flex-col gap-2 pt-1">
                {/* Feedback messages */}
                {(saved || testMsg) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {saved && (
                      <span className="text-xs text-emerald-600 font-medium">✓ تم حفظ الإعدادات</span>
                    )}
                    {testMsg && (
                      <span className={`text-xs font-medium ${testMsg.ok ? "text-emerald-600" : "text-red-500"}`}>
                        {testMsg.text}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Test button */}
                  <button
                    onClick={() => sendTest.mutate()}
                    disabled={sendTest.isPending}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-900/20 text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40 transition-colors"
                  >
                    {sendTest.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Bell className="h-3.5 w-3.5" />
                    )}
                    إرسال إشعار تجريبي
                  </button>

                  <div className="flex-1" />

                  {/* Save button */}
                  <button
                    onClick={() => save.mutate(settings)}
                    disabled={!isDirty || save.isPending}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40 transition-colors"
                  >
                    {save.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    حفظ الإعدادات
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BroadcastSection() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [roles, setRoles] = useState<string[]>(["admin", "media_buyer", "media_manager"]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  const send = useMutation({
    mutationFn: () =>
      fetch(`${API}/push/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title, body, url: url.trim() || undefined, roles }),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.ok) {
        setResult({ ok: true, text: "✓ تم الإرسال بنجاح" });
        setTitle("");
        setBody("");
        setUrl("");
      } else {
        setResult({ ok: false, text: d.error ?? "فشل الإرسال" });
      }
      setTimeout(() => setResult(null), 4000);
    },
    onError: () => {
      setResult({ ok: false, text: "فشل الإرسال — تحقق من الاتصال" });
      setTimeout(() => setResult(null), 4000);
    },
  });

  return (
    <div className="border border-amber-200 dark:border-amber-900/40 rounded-xl bg-amber-50/40 dark:bg-amber-900/10 p-4 space-y-4">
      {/* Header */}
      <div>
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Bell className="h-4 w-4 text-amber-500" />
          إشعار مخصص
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">اكتب إشعاراً واختار مين يوصله — يُرسَل مرة واحدة فقط</p>
      </div>

      {/* Title input */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          عنوان الإشعار
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          placeholder="مثال: تنبيه مهم"
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      {/* Body textarea */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          نص الإشعار
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="اكتب تفاصيل الإشعار هنا..."
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 resize-none"
        />
        <p className="text-[10px] text-muted-foreground text-left" dir="ltr">
          {body.length}/200
        </p>
      </div>

      {/* Click URL */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          رابط عند الضغط <span className="normal-case text-[10px]">(اختياري)</span>
        </label>
        <div className="relative">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://... أو اتركه فارغاً للصفحة الرئيسية"
            dir="ltr"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-right placeholder:dir-rtl"
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          لو فارغ، الضغط على الإشعار يفتح الصفحة الرئيسية
        </p>
      </div>

      {/* Recipients */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          يُرسَل إلى
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_ROLES.map((r) => {
            const checked = roles.includes(r.key);
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => toggleRole(r.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  checked
                    ? "bg-amber-500 text-white border-amber-500"
                    : "border-border text-muted-foreground hover:border-amber-400 hover:text-amber-600"
                }`}
              >
                {checked ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                {r.label}
              </button>
            );
          })}
        </div>
        {roles.length === 0 && (
          <p className="text-[11px] text-red-500">⚠️ اختر مستقبلاً واحداً على الأقل</p>
        )}
      </div>

      {/* Send row */}
      <div className="flex items-center gap-3 pt-1">
        {result && (
          <span className={`text-xs font-medium ${result.ok ? "text-emerald-600" : "text-red-500"}`}>
            {result.text}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => send.mutate()}
          disabled={!title.trim() || !body.trim() || roles.length === 0 || send.isPending}
          className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-40 transition-colors"
        >
          {send.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Bell className="h-3.5 w-3.5" />
          )}
          إرسال الإشعار
        </button>
      </div>
    </div>
  );
}

// ── Page Visibility Section ────────────────────────────────────────────────────
const CONTROLLABLE_PAGES = [
  { path: "/overview",  label: "نظرة عامة" },
  { path: "/",          label: "تحليل الحملة" },
  { path: "/creative",  label: "مركز الكريتف" },
  { path: "/activity",  label: "نشاط الفريق" },
  { path: "/media",     label: "طلبات الميديا" },
  { path: "/decisions", label: "تشخيص الحملات" },
] as const;

const VISIBILITY_ROLES: { role: string; label: string }[] = [
  { role: "admin",         label: "الأدمن" },
  { role: "media_buyer",   label: "الميديا باير" },
  { role: "media_manager", label: "مسئول الميديا" },
];

function VisToggle({
  checked,
  disabled,
  onChange,
  loading,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  loading?: boolean;
}) {
  return (
    <button
      disabled={disabled || loading}
      onClick={() => !disabled && onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none",
        disabled
          ? "cursor-not-allowed opacity-40 border-emerald-500 bg-emerald-500"
          : checked
          ? "cursor-pointer border-emerald-500 bg-emerald-500"
          : "cursor-pointer border-muted bg-muted",
      ].join(" ")}
    >
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-3 w-3 animate-spin text-white" />
        </span>
      ) : (
        <span
          className={[
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 mt-0.5",
            checked ? "translate-x-[-1.25rem]" : "translate-x-[-0.125rem]",
          ].join(" ")}
        />
      )}
    </button>
  );
}

function PageVisibilitySection() {
  const { data: visMap, isLoading } = usePageVisibility();
  const update = useUpdatePageVisibility();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  function toggle(path: string, role: string, current: boolean) {
    const key = `${path}|${role}`;
    setPendingKey(key);
    update.mutate(
      { page_path: path, role, visible: !current },
      {
        onSettled: () => setPendingKey(null),
        onError: (err) => alert(err instanceof Error ? err.message : "فشل التحديث"),
      }
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <p className="text-xs text-muted-foreground">
          تحكم في الصفحات التي تظهر لكل دور — التغييرات تُطبّق فوراً
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" dir="rtl">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-right py-2.5 px-4 text-xs font-semibold text-muted-foreground">
                  الصفحة
                </th>
                {VISIBILITY_ROLES.map((r) => (
                  <th
                    key={r.role}
                    className="text-center py-2.5 px-4 text-xs font-semibold text-muted-foreground whitespace-nowrap"
                  >
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {CONTROLLABLE_PAGES.map((page) => (
                <tr key={page.path} className="hover:bg-muted/10 transition-colors">
                  <td className="py-3 px-4 font-medium text-foreground">
                    {page.label}
                  </td>
                  {VISIBILITY_ROLES.map((r) => {
                    const visible = visMap?.[page.path]?.[r.role] ?? true;
                    const isAdmin = r.role === "admin";
                    const key = `${page.path}|${r.role}`;
                    return (
                      <td key={r.role} className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center">
                          <VisToggle
                            checked={visible}
                            disabled={isAdmin}
                            loading={pendingKey === key}
                            onChange={(v) => toggle(page.path, r.role, !v)}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-activity"],
    queryFn: () =>
      fetch(`${API}/admin/user-activity`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.users as UserWithActivity[]),
    refetchInterval: 30 * 1000,
  });

  const [trendDays, setTrendDays] = useState<7 | 14 | 30>(14);

  const noOpCountQuery = useQuery({
    queryKey: ["pipeboard-no-op-count", trendDays],
    queryFn: async () => {
      const r = await fetch(`${API}/pipeboard/no-op-count?days=${trendDays}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as { count: number };
      return d.count;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const noOpCount = noOpCountQuery.data ?? 0;

  const noOpTrendQuery = useQuery({
    queryKey: ["pipeboard-no-op-trend", trendDays],
    queryFn: async () => {
      const r = await fetch(`${API}/pipeboard/no-op-trend?days=${trendDays}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as { trend: { day: string; count: number }[] };
      return d.trend;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const noOpTrend = noOpTrendQuery.data ?? [];

  const deleteUser = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API}/admin/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "فشل الحذف");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-activity"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => alert(err instanceof Error ? err.message : "فشل الحذف"),
  });

  if (me?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
      </div>
    );
  }

  const onlineCount = data?.filter((u) => {
    if (!u.last_seen_at) return false;
    return Date.now() - new Date(u.last_seen_at).getTime() < 5 * 60000;
  }).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">إدارة المستخدمين</h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
            أضف مستخدمين وراقب نشاطهم
            {onlineCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {onlineCount} متصل الآن
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          مستخدم جديد
        </button>
      </div>

      {/* ── Redundant AI actions KPI card ── */}
      <a
        href={`${BASE}/activity?noOp=1`}
        className={`mb-6 block rounded-xl border px-5 pt-4 pb-3 transition-colors hover:bg-muted/40 ${
          noOpCount > 0
            ? "border-amber-400/50 bg-amber-500/5"
            : "border-border bg-card"
        }`}
      >
        <div className="flex items-center gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${noOpCount > 0 ? "bg-amber-500/15" : "bg-muted"}`}>
            {noOpCount > 0 ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : (
              <Bot className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-2xl font-bold leading-none ${noOpCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
              {noOpCountQuery.isLoading ? (
                <span className="inline-block h-6 w-8 rounded bg-muted animate-pulse" />
              ) : (
                noOpCount
              )}
            </p>
            <p className="text-sm text-muted-foreground mt-1">إجراء مكرر خلال آخر {trendDays} يوم</p>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">عرض التفاصيل ←</span>
        </div>

        {/* Days toggle + Sparkline */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex gap-1 shrink-0" onClick={(e) => e.preventDefault()}>
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={(e) => { e.preventDefault(); setTrendDays(d); }}
                className={`h-5 px-1.5 rounded text-[10px] font-medium transition-colors ${
                  trendDays === d
                    ? "bg-amber-500 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {d}ي
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1.5 h-14">
          {noOpTrendQuery.isLoading ? (
            <div className="h-full w-full rounded bg-muted animate-pulse" />
          ) : (() => {
            const avgCount = noOpTrend.length > 0
              ? noOpTrend.reduce((s, d) => s + d.count, 0) / noOpTrend.length
              : 0;
            const outlierDays = noOpTrend.filter(
              (d) => avgCount > 0 && d.count >= 2 * avgCount
            );
            return (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={noOpTrend} margin={{ top: 6, right: 2, left: 2, bottom: 0 }}>
                  <defs>
                    <linearGradient id="noOpGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={noOpCount > 0 ? "#f59e0b" : "#6b7280"}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={noOpCount > 0 ? "#f59e0b" : "#6b7280"}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    hide={false}
                    tick={{ fontSize: 9, fill: "currentColor", opacity: 0.45 }}
                    tickLine={false}
                    axisLine={false}
                    interval={3}
                    tickFormatter={(v: string) => {
                      const d = new Date(v);
                      return `${d.getDate()}/${d.getMonth() + 1}`;
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      direction: "rtl",
                      borderRadius: 8,
                      padding: "4px 10px",
                    }}
                    labelFormatter={(v: string) => {
                      const d = new Date(v);
                      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
                    }}
                    formatter={(v: number, _name: string, entry: { payload?: { count: number; day: string } }) => {
                      const day = entry?.payload?.day ?? "";
                      const isOutlier = outlierDays.some((o) => o.day === day);
                      return [
                        `${v} إجراء مكرر${isOutlier ? " ⚠️ يوم شاذ" : ""}`,
                        "",
                      ];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke={noOpCount > 0 ? "#f59e0b" : "#9ca3af"}
                    strokeWidth={1.5}
                    fill="url(#noOpGradient)"
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                  {outlierDays.map((d) => (
                    <ReferenceDot
                      key={d.day}
                      x={d.day}
                      y={d.count}
                      r={5}
                      fill="#ef4444"
                      stroke="#fff"
                      strokeWidth={1.5}
                      ifOverflow="visible"
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      </a>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {!data?.length && (
            <p className="text-center text-sm text-muted-foreground py-8">لا يوجد مستخدمون</p>
          )}
          {data?.map((u) => (
            <UserActivityCard
              key={u.id}
              u={u}
              me={me}
              onReset={() => setResetTarget(u)}
              onDelete={() => {
                if (confirm(`هل تريد حذف المستخدم "${u.username}"؟`))
                  deleteUser.mutate(u.id);
              }}
            />
          ))}
        </div>
      )}

      {/* Page visibility section */}
      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          إعدادات الظهور
        </h2>
        <PageVisibilitySection />
      </div>

      {/* Scheduled Reports section */}
      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <Mail className="h-4 w-4" />
          التقارير المجدولة
        </h2>
        <ScheduledReportsSection />
      </div>

      {/* Cache warm-up diagnostics section */}
      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <DatabaseZap className="h-4 w-4" />
          تشخيص الكاش
        </h2>
        <CacheWarmupSection />
      </div>

      {/* Notification settings section */}
      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <Bell className="h-4 w-4" />
          الإشعارات
        </h2>

        {/* Broadcast */}
        <BroadcastSection />

        {/* Settings */}
        <NotificationSettingsSection />

        {/* Log */}
        <NotificationLogSection />
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  );
}

// ── Scheduled Reports Section ──────────────────────────────────────────────────
interface ScheduledReport {
  id: number;
  email: string;
  frequency: "daily" | "weekly";
  created_by: string;
  created_at: string;
  last_sent_at: string | null;
  next_send_at: string;
  is_active: boolean;
}

function ScheduledReportsSection() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["scheduled-reports"],
    queryFn: () =>
      fetch(`${API}/reports/schedules`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d as { schedules: ScheduledReport[]; smtp_configured: boolean }),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  const schedules = data?.schedules ?? [];
  const smtpOk = data?.smtp_configured ?? false;

  const cancel = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/reports/schedules/${id}`, {
        method: "DELETE",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-reports"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "فشل الإلغاء"),
  });

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("ar-EG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleString("ar-EG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-blue-500" />
          تقارير الإجراءات المكررة المجدولة
          {schedules.length > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
              {schedules.length} نشط
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          {!smtpOk && !isLoading && (
            <div className="m-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 dark:text-amber-400">
                <p className="font-medium">SMTP غير مضبوط — التقارير لن تُرسَل</p>
                <p className="mt-0.5 text-amber-600/80 dark:text-amber-500/80">
                  أضف <span className="font-mono bg-amber-500/10 px-1 rounded">SMTP_HOST</span>،{" "}
                  <span className="font-mono bg-amber-500/10 px-1 rounded">SMTP_USER</span>،{" "}
                  <span className="font-mono bg-amber-500/10 px-1 rounded">SMTP_PASS</span> للمتغيرات البيئية لتفعيل الإرسال.
                </p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : schedules.length === 0 ? (
            <div className="p-6 text-center">
              <Mail className="h-7 w-7 mx-auto mb-2 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">لا توجد جداول نشطة</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                افتح صفحة نشاط الميدياباير، فعّل فلتر الإجراءات المكررة، ثم اضغط "جدولة التقرير"
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {schedules.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Mail className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" dir="ltr">{s.email}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">
                        {s.frequency === "daily" ? "يومي" : "أسبوعي"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        بواسطة {s.created_by} · {fmtDate(s.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                      {s.last_sent_at ? (
                        <span>آخر إرسال: {fmtDateTime(s.last_sent_at)}</span>
                      ) : (
                        <span>لم يُرسَل بعد</span>
                      )}
                      <span>·</span>
                      <span>الإرسال القادم: {fmtDateTime(s.next_send_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`إلغاء الجدول لـ ${s.email}؟`)) cancel.mutate(s.id);
                    }}
                    disabled={cancel.isPending}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    title="إلغاء الجدول"
                  >
                    {cancel.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cache Warm-up Status Section ──────────────────────────────────────────────
interface WarmupStats {
  id?: number;
  insights: number;
  campaigns: number;
  overview: number;
  campaign_details: number;
  adset_details: number;
  skipped: number;
  ran_at: string;
  duration_ms: number;
}

interface WarmupStatusResponse {
  stats: WarmupStats | null;
  inProgress: boolean;
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-lg ${color}`}>
      <span className="text-lg font-bold leading-none">{value}</span>
      <span className="text-[10px] mt-0.5 opacity-70">{label}</span>
    </div>
  );
}

function CacheWarmupSection() {
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["cache-warmup-status"],
    queryFn: () =>
      fetch(`${API}/meta/cache-warmup-status`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d as WarmupStatusResponse),
    refetchInterval: 15_000,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["cache-warmup-history"],
    queryFn: () =>
      fetch(`${API}/meta/cache-warmup-history`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d as { history: WarmupStats[] }),
    enabled: showHistory,
    refetchInterval: showHistory ? 30_000 : false,
  });

  const trigger = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/meta/cache-warmup-trigger`, {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "فشل التشغيل");
      return d;
    },
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["cache-warmup-status"] });
        qc.invalidateQueries({ queryKey: ["cache-warmup-history"] });
      }, 1000);
    },
    onError: (err) => alert(err instanceof Error ? err.message : "فشل التشغيل"),
  });

  const stats = data?.stats;
  const inProgress = data?.inProgress ?? false;
  const historyRows = historyData?.history ?? [];

  const avgSkipped = historyRows.length > 0
    ? historyRows.reduce((sum, r) => sum + r.skipped, 0) / historyRows.length
    : 0;
  const ABSOLUTE_WARN_THRESHOLD = 3;
  function skipSeverity(skipped: number): "critical" | "warn" | "none" {
    if (skipped <= 0) return "none";
    if (skipped >= Math.max(avgSkipped * 2, ABSOLUTE_WARN_THRESHOLD * 2)) return "critical";
    if (skipped > avgSkipped || skipped >= ABSOLUTE_WARN_THRESHOLD) return "warn";
    return "none";
  }

  function formatDuration(ms: number) {
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatRelTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "منذ أقل من دقيقة";
    if (diff < 3600_000) return `منذ ${Math.round(diff / 60_000)} دقيقة`;
    if (diff < 86400_000) return `منذ ${Math.round(diff / 3600_000)} ساعة`;
    return `منذ ${Math.round(diff / 86400_000)} يوم`;
  }

  function formatAbsTime(iso: string) {
    return new Date(iso).toLocaleString("ar-EG", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const totalWarmed = stats
    ? stats.insights + stats.campaigns + stats.overview + stats.campaign_details + stats.adset_details
    : 0;

  function rowTotal(r: WarmupStats) {
    return r.insights + r.campaigns + r.overview + r.campaign_details + r.adset_details;
  }

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-900/20 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <DatabaseZap className="h-4 w-4 text-slate-500" />
          حالة تسخين الكاش
        </p>
        <div className="flex items-center gap-2">
          {stats && !inProgress && (
            <span className="text-[10px] text-muted-foreground">
              آخر تشغيل {formatRelTime(stats.ran_at)}
            </span>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Clock className="h-3 w-3" />
            السجل
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button
            onClick={() => trigger.mutate()}
            disabled={trigger.isPending || inProgress}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${inProgress || trigger.isPending ? "animate-spin" : ""}`} />
            {inProgress ? "جارٍ التسخين..." : "تشغيل الآن"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-16 rounded-lg bg-muted animate-pulse" />
      ) : !stats ? (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-3 text-xs text-amber-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          لم يتم تشغيل تسخين الكاش بعد منذ آخر إعادة تشغيل للسيرفر. سيبدأ تلقائياً بعد 3 دقائق من الآن، أو اضغط "تشغيل الآن".
        </div>
      ) : (
        <div className="space-y-3">
          {/* Status bar */}
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${totalWarmed > 0 || stats.skipped > 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-blue-500/10 text-blue-700 dark:text-blue-400"}`}>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              {totalWarmed > 0
                ? `تم تسخين ${totalWarmed} إدخال في الكاش`
                : "الكاش محدّث بالكامل — لم تكن هناك إدخالات متأخرة"}
            </span>
            <span className="mr-auto text-muted-foreground font-mono" dir="ltr">
              {formatDuration(stats.duration_ms)}
            </span>
          </div>

          {/* Stat badges */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <StatBadge label="إحصاءات" value={stats.insights} color="bg-violet-500/10 text-violet-700 dark:text-violet-400" />
            <StatBadge label="حملات" value={stats.campaigns} color="bg-blue-500/10 text-blue-700 dark:text-blue-400" />
            <StatBadge label="نظرة عامة" value={stats.overview} color="bg-cyan-500/10 text-cyan-700 dark:text-cyan-400" />
            <StatBadge label="تفاصيل حملة" value={stats.campaign_details} color="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" />
            <StatBadge label="تفاصيل أدسيت" value={stats.adset_details} color="bg-amber-500/10 text-amber-700 dark:text-amber-400" />
            <StatBadge label="تخطّى" value={stats.skipped} color={stats.skipped > 0 ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-muted/40 text-muted-foreground"} />
          </div>

          <p className="text-[10px] text-muted-foreground" dir="ltr">
            Last run: {new Date(stats.ran_at).toLocaleString("ar-EG")} — auto-refreshes every 30 min
          </p>
        </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              آخر 20 تشغيل
            </p>
            {avgSkipped > 0 && (
              <span className="text-[10px] text-muted-foreground">
                متوسط التخطّي: <span className="font-mono font-medium">{avgSkipped.toFixed(1)}</span>
              </span>
            )}
          </div>
          {historyLoading ? (
            <div className="h-24 rounded-lg bg-muted animate-pulse" />
          ) : historyRows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">لا يوجد سجل حتى الآن</p>
          ) : (
            <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-[11px] border-collapse" dir="ltr">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">وقت التشغيل</th>
                    <th className="px-2 py-1.5 text-right font-medium">المدة</th>
                    <th className="px-2 py-1.5 text-right font-medium">إحصاءات</th>
                    <th className="px-2 py-1.5 text-right font-medium">حملات</th>
                    <th className="px-2 py-1.5 text-right font-medium">نظرة عامة</th>
                    <th className="px-2 py-1.5 text-right font-medium">تف.حملة</th>
                    <th className="px-2 py-1.5 text-right font-medium">تف.أدسيت</th>
                    <th className="px-2 py-1.5 text-right font-medium">إجمالي</th>
                    <th className="px-2 py-1.5 text-right font-medium">تخطّى</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row, i) => {
                    const total = rowTotal(row);
                    const gapMinutes = i < historyRows.length - 1
                      ? Math.round((new Date(row.ran_at).getTime() - new Date(historyRows[i + 1].ran_at).getTime()) / 60_000)
                      : null;
                    const hasGap = gapMinutes !== null && gapMinutes > 45;
                    const severity = skipSeverity(row.skipped);
                    const rowBg =
                      severity === "critical"
                        ? "bg-red-500/10 dark:bg-red-500/15"
                        : severity === "warn"
                        ? "bg-amber-500/8 dark:bg-amber-500/12"
                        : "";
                    return (
                      <>
                        <tr
                          key={row.id ?? i}
                          className={`border-t border-slate-100 dark:border-slate-800 ${rowBg || (i === 0 ? "bg-emerald-500/5" : "")} hover:brightness-95 transition-colors`}
                        >
                          <td className="px-2 py-1.5 text-left font-mono whitespace-nowrap text-muted-foreground">
                            {formatAbsTime(row.ran_at)}
                            {i === 0 && <span className="mr-1 text-[9px] text-emerald-600 font-semibold">آخر</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatDuration(row.duration_ms)}</td>
                          <td className="px-2 py-1.5 text-right">{row.insights}</td>
                          <td className="px-2 py-1.5 text-right">{row.campaigns}</td>
                          <td className="px-2 py-1.5 text-right">{row.overview}</td>
                          <td className="px-2 py-1.5 text-right">{row.campaign_details}</td>
                          <td className="px-2 py-1.5 text-right">{row.adset_details}</td>
                          <td className={`px-2 py-1.5 text-right font-semibold ${total > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{total}</td>
                          <td className="px-2 py-1.5 text-right font-medium">
                            {row.skipped > 0 ? (
                              <span className={`inline-flex items-center gap-1 ${severity === "critical" ? "text-red-600 dark:text-red-400" : severity === "warn" ? "text-amber-600 dark:text-amber-400" : "text-red-500"}`}>
                                {severity === "critical" && <AlertCircle className="h-3 w-3 shrink-0" />}
                                {severity === "warn" && <AlertTriangle className="h-3 w-3 shrink-0" />}
                                {row.skipped}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{row.skipped}</span>
                            )}
                          </td>
                        </tr>
                        {hasGap && (
                          <tr key={`gap-${i}`} className="bg-amber-500/5">
                            <td colSpan={9} className="px-2 py-1 text-center text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                              ⚠ فجوة {gapMinutes} دقيقة
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {historyRows.some(r => skipSeverity(r.skipped) !== "none") && (
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-0.5">
                <span className="flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" /> فوق المتوسط</span>
                <span className="flex items-center gap-1"><AlertCircle className="h-2.5 w-2.5 text-red-500" /> مرتفع جداً</span>
              </div>
            )}
            </>
          )}
        </div>
      )}

      {/* Live refresh indicator */}
      {dataUpdatedAt > 0 && (
        <p className="text-[9px] text-muted-foreground/50 text-left" dir="ltr">
          Polled {new Date(dataUpdatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

// ── Notification Log Section ───────────────────────────────────────────────────
interface NotifLogRow {
  notification_id: string;
  username: string | null;
  title: string;
  body: string;
  url: string | null;
  sent_at: string;
  shown_at: string | null;
  clicked_at: string | null;
  dismissed_at: string | null;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "الآن";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} د`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} س`;
  return `${Math.floor(diff / 86400_000)} ي`;
}

function NotificationLogSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["push-log"],
    queryFn: () =>
      fetch(`${API}/push/log?limit=60`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.log as NotifLogRow[]),
    refetchInterval: 30_000,
  });

  const rows = data ?? [];

  // Compute stats
  const total = rows.length;
  const shown = rows.filter((r) => r.shown_at).length;
  const clicked = rows.filter((r) => r.clicked_at).length;
  const dismissed = rows.filter((r) => r.dismissed_at && !r.clicked_at).length;

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-900/20 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Eye className="h-4 w-4 text-slate-500" />
          سجل الإشعارات
        </p>
        {total > 0 && (
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-slate-500">
              <Send className="h-3 w-3" /> {total} مُرسَل
            </span>
            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <Eye className="h-3 w-3" /> {shown} ظهر ({total > 0 ? Math.round(shown / total * 100) : 0}%)
            </span>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <MousePointerClick className="h-3 w-3" /> {clicked} ضُغط ({total > 0 ? Math.round(clicked / total * 100) : 0}%)
            </span>
            <span className="flex items-center gap-1 text-rose-500 dark:text-rose-400">
              <EyeOff className="h-3 w-3" /> {dismissed} أُغلق
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          لا توجد إشعارات مسجّلة بعد
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs border-collapse min-w-[500px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-right py-1.5 px-2 font-medium">المستخدم</th>
                <th className="text-right py-1.5 px-2 font-medium">الإشعار</th>
                <th className="text-right py-1.5 px-2 font-medium">أُرسل</th>
                <th className="text-center py-1.5 px-2 font-medium">ظهر</th>
                <th className="text-center py-1.5 px-2 font-medium">ضُغط</th>
                <th className="text-center py-1.5 px-2 font-medium">أُغلق</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.notification_id}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-1.5 px-2 font-medium">{r.username ?? "—"}</td>
                  <td className="py-1.5 px-2 max-w-[160px]">
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="text-muted-foreground truncate">{r.body}</p>
                  </td>
                  <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">
                    {relTime(r.sent_at)}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {r.shown_at ? (
                      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600">
                        <Eye className="h-3 w-3" />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {r.clicked_at ? (
                      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600">
                        <MousePointerClick className="h-3 w-3" />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {r.dismissed_at && !r.clicked_at ? (
                      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-500">
                        <EyeOff className="h-3 w-3" />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
