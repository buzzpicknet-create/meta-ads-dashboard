import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API, useAuth } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { PAGE_SLUGS, ALL_PAGES } from "@/lib/pages";
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
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface UserRow {
  id: number;
  username: string;
  role: string;
  created_at: string;
  allowed_pages: string[] | null;
}

const ROLES = [
  { value: "admin", label: "مدير النظام" },
  { value: "media_buyer", label: "ميدياباير" },
  { value: "media_manager", label: "مدير وسائط" },
];

const PAGE_GROUPS_CONFIG = [
  { group: "Meta Ads", color: "text-blue-400" },
  { group: "Google / DemandGen", color: "text-emerald-400" },
  { group: "عام", color: "text-slate-400" },
];

const ALL_PAGES_WITH_GROUP = [
  ...ALL_PAGES.filter(p => ["campaigns","creative","video-studio","audience"].includes(p.slug)).map(p => ({ ...p, group: "Meta Ads" })),
  ...ALL_PAGES.filter(p => ["landing-page","shopify","winning-products"].includes(p.slug)).map(p => ({ ...p, group: "Google / DemandGen" })),
  ...ALL_PAGES.filter(p => ["settings"].includes(p.slug)).map(p => ({ ...p, group: "عام" })),
];

function roleLabel(r: string) {
  return ROLES.find((x) => x.value === r)?.label ?? r;
}

function roleColor(r: string) {
  if (r === "admin") return "text-amber-400 bg-amber-900/30 border-amber-700/40";
  if (r === "media_buyer") return "text-blue-400 bg-blue-900/30 border-blue-700/40";
  return "text-slate-300 bg-slate-700/60 border-slate-600";
}

const GROUP_COLOR: Record<string, string> = {
  "Meta Ads": "text-blue-400",
  "Google / DemandGen": "text-emerald-400",
  "عام": "text-slate-400",
};

export default function AdminPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();

  // Create/edit user form
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "media_buyer" });
  const [formMsg, setFormMsg] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Page permissions panel
  const [permUserId, setPermUserId] = useState<number | null>(null);
  const [permPages, setPermPages] = useState<string[] | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permMsg, setPermMsg] = useState("");

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
    setPermUserId(null);
  }

  async function submitForm() {
    if (!form.username.trim()) { setFormMsg("اسم المستخدم مطلوب"); return; }
    if (!editingId && !form.password.trim()) { setFormMsg("كلمة المرور مطلوبة للمستخدم الجديد"); return; }
    setFormMsg("");
    setFormLoading(true);
    try {
      const url = editingId ? `${API}/admin/users/${editingId}` : `${API}/admin/users`;
      const method = editingId ? "PUT" : "POST";
      const body: Record<string, string> = { username: form.username, role: form.role };
      if (form.password) body["password"] = form.password;
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) {
        setFormMsg(editingId ? "✅ تم التحديث" : "✅ تم الإنشاء");
        refetch();
        setTimeout(resetForm, 1000);
      } else {
        setFormMsg(d.error ?? "فشل العملية");
      }
    } catch { setFormMsg("خطأ في الاتصال"); }
    finally { setFormLoading(false); }
  }

  async function deleteUser(id: number) {
    await fetch(`${API}/admin/users/${id}`, { method: "DELETE", credentials: "include" });
    refetch();
    setDeleteId(null);
    if (permUserId === id) setPermUserId(null);
  }

  // Open page permissions for a user
  async function openPerms(u: UserRow) {
    if (permUserId === u.id) { setPermUserId(null); return; }
    setPermUserId(u.id);
    setPermPages(u.allowed_pages);
    setPermMsg("");
    setShowCreate(false);
  }

  function togglePage(slug: string) {
    if (permPages === null) {
      // Was "all" — now restrict to all except this one
      setPermPages(PAGE_SLUGS.filter((s) => s !== slug));
    } else {
      if (permPages.includes(slug)) {
        setPermPages(permPages.filter((s) => s !== slug));
      } else {
        const next = [...permPages, slug];
        // If all pages selected, set to null (all)
        if (next.length === PAGE_SLUGS.length) setPermPages(null);
        else setPermPages(next);
      }
    }
  }

  function isPageAllowed(slug: string) {
    if (permPages === null) return true;
    return permPages.includes(slug);
  }

  async function savePerms() {
    if (permUserId === null) return;
    setPermLoading(true);
    setPermMsg("");
    try {
      const r = await fetch(`${API}/admin/users/${permUserId}/pages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ allowed_pages: permPages }),
      });
      const d = await r.json();
      if (r.ok) {
        setPermMsg("✅ تم حفظ الصلاحيات");
        refetch();
        setTimeout(() => setPermMsg(""), 2000);
      } else {
        setPermMsg(d.error ?? "فشل الحفظ");
      }
    } catch { setPermMsg("خطأ في الاتصال"); }
    finally { setPermLoading(false); }
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
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" />
            إدارة المستخدمين والصلاحيات
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            تحكم في من يشوف إيه من الصفحات
          </p>
        </div>
        <Button
          onClick={() => { setShowCreate(true); setEditingId(null); setForm({ username: "", password: "", role: "media_buyer" }); setFormMsg(""); setPermUserId(null); }}
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
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          {formMsg && (
            <p className={cn("text-xs rounded-lg px-3 py-2",
              formMsg.startsWith("✅") ? "text-emerald-400 bg-emerald-950/30 border border-emerald-800/40"
                : "text-red-400 bg-red-950/30 border border-red-800/40"
            )}>{formMsg}</p>
          )}
          <div className="flex gap-2">
            <Button onClick={submitForm} disabled={formLoading} className="bg-blue-600 hover:bg-blue-500 gap-2">
              {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {formLoading ? "جارٍ الحفظ..." : editingId ? "تحديث" : "إنشاء"}
            </Button>
            <Button variant="ghost" onClick={resetForm} className="text-slate-400">إلغاء</Button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h2 className="text-sm font-bold text-white">المستخدمون ({users.length})</h2>
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
                <th className="px-4 py-2.5 text-right font-medium">الصفحات المتاحة</th>
                <th className="px-4 py-2.5 text-right font-medium">تاريخ الإنشاء</th>
                <th className="px-4 py-2.5 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-700/50">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))}
              {users.map((u) => (
                <>
                  <tr
                    key={u.id}
                    className={cn(
                      "border-b border-slate-700/50 transition-colors",
                      permUserId === u.id ? "bg-slate-700/30" : "hover:bg-slate-700/20"
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                        <span className="text-white font-medium">{u.username}</span>
                        {u.id === me?.id && (
                          <span className="text-[10px] text-blue-400 bg-blue-900/30 border border-blue-700/40 px-1.5 py-0.5 rounded">أنت</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", roleColor(u.role))}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.role === "admin" ? (
                        <span className="text-xs text-amber-400">كل الصفحات</span>
                      ) : u.allowed_pages === null ? (
                        <span className="text-xs text-emerald-400">كل الصفحات</span>
                      ) : u.allowed_pages.length === 0 ? (
                        <span className="text-xs text-red-400">لا توجد صلاحيات</span>
                      ) : (
                        <span className="text-xs text-slate-400">{u.allowed_pages.length} صفحة</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {new Date(u.created_at).toLocaleDateString("ar-EG")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openPerms(u)}
                          title="تعديل الصلاحيات"
                          className={cn(
                            "transition-colors text-xs flex items-center gap-1",
                            permUserId === u.id ? "text-blue-400" : "text-slate-400 hover:text-blue-400"
                          )}
                        >
                          <Shield className="w-3.5 h-3.5" />
                          {permUserId === u.id
                            ? <ChevronUp className="w-3 h-3" />
                            : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <button onClick={() => startEdit(u)} className="text-slate-400 hover:text-white transition-colors" title="تعديل">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {u.id !== me?.id && (
                          deleteId === u.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => deleteUser(u.id)} className="text-red-400 text-xs font-medium">تأكيد</button>
                              <button onClick={() => setDeleteId(null)} className="text-slate-500 text-xs">إلغاء</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteId(u.id)} className="text-slate-400 hover:text-red-400 transition-colors" title="حذف">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Page Permissions Panel */}
                  {permUserId === u.id && (
                    <tr key={`${u.id}-perms`} className="border-b border-slate-700/50 bg-slate-900/60">
                      <td colSpan={5} className="px-6 py-4">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                              <Shield className="w-4 h-4 text-blue-400" />
                              صلاحيات الصفحات — {u.username}
                            </h3>
                            <div className="flex items-center gap-2">
                              {/* Select All / None */}
                              <button
                                onClick={() => setPermPages(null)}
                                className={cn(
                                  "text-xs px-2.5 py-1 rounded-lg border transition-colors",
                                  permPages === null
                                    ? "bg-emerald-600 text-white border-emerald-500"
                                    : "text-slate-400 border-slate-600 hover:text-white hover:border-slate-500"
                                )}
                              >
                                الكل
                              </button>
                              <button
                                onClick={() => setPermPages([])}
                                className={cn(
                                  "text-xs px-2.5 py-1 rounded-lg border transition-colors",
                                  permPages !== null && permPages.length === 0
                                    ? "bg-red-600 text-white border-red-500"
                                    : "text-slate-400 border-slate-600 hover:text-white hover:border-slate-500"
                                )}
                              >
                                لا شيء
                              </button>
                            </div>
                          </div>

                          {/* Pages by group */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {PAGE_GROUPS_CONFIG.map(({ group, color }) => {
                              const pages = ALL_PAGES_WITH_GROUP.filter(p => p.group === group);
                              return (
                              <div key={group} className="space-y-2">
                                <p className={cn("text-[11px] font-bold uppercase tracking-wider", color)}>
                                  {group}
                                </p>
                                <div className="space-y-1">
                                  {pages.map((page) => {
                                    const allowed = isPageAllowed(page.slug);
                                    return (
                                      <button
                                        key={page.slug}
                                        onClick={() => togglePage(page.slug)}
                                        className={cn(
                                          "w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm transition-all",
                                          allowed
                                            ? "bg-emerald-900/30 border-emerald-700/50 text-emerald-300"
                                            : "bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600"
                                        )}
                                      >
                                        <div className={cn(
                                          "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                                          allowed ? "bg-emerald-500 border-emerald-400" : "border-slate-600"
                                        )}>
                                          {allowed && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        <page.icon className="w-3.5 h-3.5 shrink-0" />
                                        <span className="flex-1 text-right">{page.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                            })}
                          </div>

                          {permMsg && (
                            <p className={cn("text-xs rounded-lg px-3 py-2",
                              permMsg.startsWith("✅") ? "text-emerald-400 bg-emerald-950/30 border border-emerald-800/40"
                                : "text-red-400 bg-red-950/30 border border-red-800/40"
                            )}>{permMsg}</p>
                          )}

                          <div className="flex gap-2">
                            <Button
                              onClick={savePerms}
                              disabled={permLoading}
                              className="bg-blue-600 hover:bg-blue-500 gap-2 text-sm"
                            >
                              {permLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              حفظ الصلاحيات
                            </Button>
                            <Button variant="ghost" onClick={() => setPermUserId(null)} className="text-slate-400 text-sm">
                              إغلاق
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AIChatWidget />
    </div>
  );
}
