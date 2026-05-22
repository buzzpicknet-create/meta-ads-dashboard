import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
const BASE = "";
const API = `${BASE}/api`;

export type UserRole = "admin" | "media_buyer" | "media_manager";

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function safeJson(r: Response): Promise<Record<string, unknown>> {
  try {
    const text = await r.text();
    if (!text || !text.trim()) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? safeJson(r) : null))
      .then((data) => {
        if (data?.user) setUser(data.user as AuthUser);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    let r: Response;
    try {
      r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error("لا يمكن الوصول للخادم. تحقق من الاتصال وحاول مرة أخرى.");
    }
    const data = await safeJson(r);
    if (!r.ok) throw new Error((data.error as string | undefined) ?? "فشل تسجيل الدخول");
    if (!data.user) throw new Error("لم يستجب الخادم. حاول مرة أخرى.");
    setUser(data.user as AuthUser);
  }

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
