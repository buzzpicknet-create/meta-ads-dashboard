import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Lock } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold">Meta Ads Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">سجّل الدخول للمتابعة</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="username">
                اسم المستخدم
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                placeholder="admin"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="password">
                كلمة المرور
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500 text-center">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="h-10 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "جاري الدخول..." : "دخول"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
