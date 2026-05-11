import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API } from "@/context/auth-context";
import { useAuth } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Settings,
  Key,
  CheckCircle,
  XCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  AlertTriangle,
  User,
  Lock,
} from "lucide-react";

interface TokenHealth {
  valid: boolean;
  expires_at?: string;
  scopes?: string[];
  error?: string;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const { data: tokenHealth, isLoading: tokenLoading, refetch: refetchToken } =
    useQuery<TokenHealth>({
      queryKey: ["token-health"],
      queryFn: () =>
        fetch(`${API}/meta/token-health`, { credentials: "include" }).then((r) =>
          r.json()
        ),
      staleTime: 60_000,
    });

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      setPwMsg("كلمة المرور الجديدة وتأكيدها غير متطابقتين");
      return;
    }
    if (newPassword.length < 6) {
      setPwMsg("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setPwMsg("");
    setPwLoading(true);
    try {
      const r = await fetch(`${API}/admin/users/${user?.id}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const d = await r.json();
      if (r.ok) {
        setPwMsg("✅ تم تغيير كلمة المرور بنجاح");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPwMsg(d.error ?? "فشل تغيير كلمة المرور");
      }
    } catch {
      setPwMsg("خطأ في الاتصال");
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-slate-400" />
          الإعدادات
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">إدارة الحساب والاتصالات</p>
      </div>

      {/* Token Health */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Key className="w-4 h-4 text-blue-400" />
            حالة Meta Access Token
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetchToken()}
            disabled={tokenLoading}
            className="h-7 text-xs text-slate-400 hover:text-white gap-1"
          >
            <RefreshCw className={cn("w-3 h-3", tokenLoading && "animate-spin")} />
            تحديث
          </Button>
        </div>

        {tokenLoading ? (
          <div className="h-16 bg-slate-700 rounded-lg animate-pulse" />
        ) : tokenHealth ? (
          <div
            className={cn(
              "flex items-start gap-3 p-4 rounded-xl border",
              tokenHealth.valid
                ? "bg-emerald-950/30 border-emerald-700/40"
                : "bg-red-950/30 border-red-700/40"
            )}
          >
            {tokenHealth.valid ? (
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 space-y-1">
              <p
                className={cn(
                  "text-sm font-semibold",
                  tokenHealth.valid ? "text-emerald-300" : "text-red-300"
                )}
              >
                {tokenHealth.valid ? "التوكن صالح ✓" : "التوكن غير صالح ✗"}
              </p>
              {tokenHealth.expires_at && (
                <p className="text-xs text-slate-400">
                  ينتهي في: {new Date(tokenHealth.expires_at).toLocaleDateString("ar-EG")}
                </p>
              )}
              {tokenHealth.scopes && tokenHealth.scopes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tokenHealth.scopes.map((s) => (
                    <span
                      key={s}
                      className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {tokenHealth.error && (
                <p className="text-xs text-red-400 mt-1">{tokenHealth.error}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 bg-slate-700/40 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <p className="text-xs text-slate-400">لا يمكن التحقق من حالة التوكن</p>
          </div>
        )}

        <p className="text-xs text-slate-500">
          التوكن مُعيّن عبر متغير البيئة <code className="text-slate-400">META_ACCESS_TOKEN</code>.
          لتحديثه، يجب تغييره في إعدادات المشروع.
        </p>
      </div>

      {/* Change Password */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-purple-400" />
          تغيير كلمة المرور
        </h2>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">كلمة المرور الحالية</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pl-10"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">كلمة المرور الجديدة</label>
            <input
              type={showPass ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">تأكيد كلمة المرور الجديدة</label>
            <input
              type={showPass ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {pwMsg && (
            <p
              className={cn(
                "text-xs rounded-lg px-3 py-2",
                pwMsg.startsWith("✅")
                  ? "text-emerald-400 bg-emerald-950/30 border border-emerald-800/40"
                  : "text-red-400 bg-red-950/30 border border-red-800/40"
              )}
            >
              {pwMsg}
            </p>
          )}

          <Button
            onClick={changePassword}
            disabled={pwLoading || !currentPassword || !newPassword || !confirmPassword}
            className="gap-2 bg-purple-600 hover:bg-purple-500"
          >
            {pwLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {pwLoading ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}
          </Button>
        </div>
      </div>

      {/* Account Info */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" />
          معلومات الحساب
        </h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-2 border-b border-slate-700">
            <span className="text-xs text-slate-400">اسم المستخدم</span>
            <span className="text-sm text-white font-medium">{user?.username}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-slate-700">
            <span className="text-xs text-slate-400">الصلاحية</span>
            <span className={cn("text-sm font-medium",
              user?.role === "admin" ? "text-amber-400" : "text-blue-400"
            )}>
              {user?.role === "admin" ? "مدير النظام" : user?.role === "media_buyer" ? "ميدياباير" : "مدير وسائط"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-slate-400">رقم التعريف</span>
            <span className="text-sm text-slate-500">#{user?.id}</span>
          </div>
        </div>
      </div>

      <AIChatWidget />
    </div>
  );
}
