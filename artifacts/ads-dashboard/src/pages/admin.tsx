import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API, useAuth } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  User,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";

interface UserRow {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

const ROLES = [
  { value: "admin", label: "مدير النظام" },
  { value: "media_buyer", label: "ميدياباير" },
  { value: "media_manager", label: "مدير وسائط" },
];

function roleLabel(r: string) {
  return ROLES.find((x) => x.value === r)?.label ?? r;
}

function roleColor(r: string) {
  if (r === "admin") return "text-amber-400 bg-amber-900/30 border-amber-700/40";
  if (r === "media_buyer") return "text-blue-400 bg-blue-900/30 border-blue-700/40";
  return "text-slate-300 bg-slate-700 border-slate-600";
}

export default function AdminPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "media_buyer" });
  const [formMsg, setFormMsg] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: users = [], isLoading, refetch } = useQuery<UserRow[]>({
    queryKey: ["admin-users"],
    queryFn: () =>
      fetch(`${API}/admin/users`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.users ?? []),
    staleTime: 30_000,
  });

  function resetForm() {
    setForm({ username: "", password: "", role: "media_buyer" });
    setFormMsg("");
    setEditingId(null);
    setShowCreate(false);
  }

  function startEdit(u: UserRow) {
    setEditingId(u.id);
    setForm({ username: u.username, password: "", role: u.role });
    setFormMsg("");
    setShowCreate(true);
  }

  async function submitForm() {
    if (!form.username.trim()) {
      setFormMsg("اسم المستخدم مطلوب");
      return;
    }
    if (!editingId && !form.password.trim()) {
      setFormMsg("كلمة المرور مطلوبة للمستخدم الجديد");
      return;
    }
    setFormMsg("");
    setFormLoading(true);

    try {
      const url = editingId
        ? `${API}/admin/users/${editingId}`
        : `${API}/admin/users`;
      const method = editingId ? "PUT" : "POST";
      const body: Record<string, string> = {
        username: form.username,
        role: form.role,
      };
      if (form.password) body.password = form.password;

      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) {
        setFormMsg(editingId ? "✅ تم تحديث المستخدم" : "✅ تم إنشاء المستخدم");
        refetch();
        setTimeout(resetForm, 1200);
      } else {
        setFormMsg(d.error ?? "فشل العملية");
      }
    } catch {
      setFormMsg("خطأ في الاتصال");
    } finally {
      setFormLoading(false);
    }
  }

  async function deleteUser(id: number) {
    try {
      const r = await fetch(`${API}/admin/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        refetch();
        setDeleteId(null);
      }
    } catch {
      // ignore
    }
  }

  if (me?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3" dir="rtl">
        <Shield className="w-14 h-14 text-slate-700" />
        <p className="text-slate-400 text-sm">هذه الصفحة للمديرين فقط</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" />
            إدارة المستخدمين
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            إضافة وتعديل وحذف مستخدمي النظام
          </p>
        </div>
        <Button
          onClick={() => { setShowCreate(true); setEditingId(null); setForm({ username: "", password: "", role: "media_buyer" }); setFormMsg(""); }}
          className="bg-blue-600 hover:bg-blue-500 gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          مستخدم جديد
        </Button>
      </div>

      {/* Create/Edit Form */}
      {showCreate && (
        <div className="bg-slate-800/80 border border-blue-600/40 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">
              {editingId ? "تعديل المستخدم" : "إضافة مستخدم جديد"}
            </h2>
            <button onClick={resetForm} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">اسم المستخدم *</label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="username"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">
                كلمة المرور {editingId ? "(اتركها فارغة للإبقاء)" : "*"}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">الصلاحية</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {formMsg && (
            <p className={cn("text-xs rounded-lg px-3 py-2",
              formMsg.startsWith("✅")
                ? "text-emerald-400 bg-emerald-950/30 border border-emerald-800/40"
                : "text-red-400 bg-red-950/30 border border-red-800/40"
            )}>
              {formMsg}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={submitForm}
              disabled={formLoading}
              className="bg-blue-600 hover:bg-blue-500 gap-2"
            >
              {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {formLoading ? "جارٍ الحفظ..." : editingId ? "تحديث" : "إنشاء"}
            </Button>
            <Button variant="ghost" onClick={resetForm} className="text-slate-400">
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h2 className="text-sm font-bold text-white">
            المستخدمون ({users.length})
          </h2>
          <button onClick={() => refetch()} className="text-slate-400 hover:text-white">
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-xs">
                <th className="px-4 py-2.5 text-right font-medium">المستخدم</th>
                <th className="px-4 py-2.5 text-right font-medium">الصلاحية</th>
                <th className="px-4 py-2.5 text-right font-medium">تاريخ الإنشاء</th>
                <th className="px-4 py-2.5 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-700/50">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <span className="text-white font-medium">{u.username}</span>
                      {u.id === me?.id && (
                        <span className="text-[10px] text-blue-400 bg-blue-900/30 border border-blue-700/40 px-1.5 py-0.5 rounded">
                          أنت
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", roleColor(u.role))}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(u.created_at).toLocaleDateString("ar-EG")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(u)}
                        className="text-slate-400 hover:text-blue-400 transition-colors"
                        title="تعديل"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {u.id !== me?.id && (
                        deleteId === u.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteUser(u.id)}
                              className="text-red-400 hover:text-red-300 text-xs font-medium"
                            >
                              تأكيد
                            </button>
                            <button
                              onClick={() => setDeleteId(null)}
                              className="text-slate-500 hover:text-white text-xs"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteId(u.id)}
                            className="text-slate-400 hover:text-red-400 transition-colors"
                            title="حذف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AIChatWidget />
    </div>
  );
}
