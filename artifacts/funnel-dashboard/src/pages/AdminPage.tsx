import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Trash2, KeyRound, Shield, Clapperboard, Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface User {
  id: number;
  username: string;
  role: "admin" | "media_manager";
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "أدمن",
  media_manager: "مسئول ميديا",
};

const ROLE_ICONS: Record<string, typeof Shield> = {
  admin: Shield,
  media_manager: Clapperboard,
};

function RoleBadge({ role }: { role: string }) {
  const Icon = ROLE_ICONS[role] ?? Shield;
  const isAdmin = role === "admin";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isAdmin
          ? "bg-violet-500/10 text-violet-600"
          : "bg-emerald-500/10 text-emerald-600"
      }`}
    >
      <Icon className="h-3 w-3" />
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "media_manager">("media_manager");
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
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        >
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
              onChange={(e) => setRole(e.target.value as "admin" | "media_manager")}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="admin">أدمن — يرى كل شيء</option>
              <option value="media_manager">مسئول ميديا — طلبات الميديا فقط</option>
            </select>
          </div>
          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted"
            >
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
            <button onClick={onClose} className="mt-4 h-9 px-4 rounded-lg bg-emerald-500 text-white text-sm">
              إغلاق
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => { e.preventDefault(); reset.mutate(); }}
          >
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
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted">
                إلغاء
              </button>
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

export default function AdminPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () =>
      fetch(`${API}/admin/users`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.users as User[]),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "فشل الحذف"),
  });

  if (me?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">إدارة المستخدمين</h1>
          <p className="text-sm text-muted-foreground mt-0.5">أضف مستخدمين وحدد صلاحياتهم</p>
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
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {!data?.length && (
            <p className="text-center text-sm text-muted-foreground py-8">لا يوجد مستخدمون</p>
          )}
          {data?.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-5 py-4 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold uppercase">{u.username[0]}</span>
                </div>
                <div>
                  <p className="text-sm font-medium">{u.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("ar-EG")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <RoleBadge role={u.role} />
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setResetTarget(u)}
                    title="تغيير كلمة المرور"
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                  {u.id !== me?.id && (
                    <button
                      onClick={() => {
                        if (confirm(`هل تريد حذف المستخدم "${u.username}"؟`))
                          deleteUser.mutate(u.id);
                      }}
                      title="حذف المستخدم"
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  );
}
