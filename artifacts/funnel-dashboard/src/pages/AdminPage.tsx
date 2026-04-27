import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Trash2, KeyRound, Shield, Clapperboard, Activity,
  Loader2, X, ChevronDown, LogIn, Stethoscope, Film, LayoutDashboard,
  Clock, Wifi, WifiOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
  recent_activity: ActivityEntry[];
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
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{u.username}</p>
              <RoleBadge role={u.role} />
            </div>
            <OnlineIndicator lastSeen={u.last_seen_at} />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  );
}
