import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const API = "/api";

export type UserRole = "admin" | "media_buyer" | "media_manager";

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  allowed_pages: string[] | null; // null = all pages allowed
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthUser | null> {
  const r = await fetch(`${API}/auth/me`, { credentials: "include" });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.user ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then((u) => { if (u) setUser(u); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const r = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "فشل تسجيل الدخول");
    setUser(data.user as AuthUser);
  }

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    setUser(null);
  }

  async function refreshUser() {
    const u = await fetchMe();
    if (u) setUser(u);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
