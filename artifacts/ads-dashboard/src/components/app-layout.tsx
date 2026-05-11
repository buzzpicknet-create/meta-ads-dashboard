import { useState, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { useDashboard } from "@/context/dashboard-context";
import { useQuery } from "@tanstack/react-query";
import { API } from "@/context/auth-context";
import { META_PAGES, GOOGLE_PAGES, GENERAL_PAGES, type PageSlug } from "@/lib/pages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Zap,
  Shield,
  LogOut,
  ChevronDown,
  Calendar,
  Menu,
  X,
  User,
  ChevronLeft,
  MessageSquare,
} from "lucide-react";

interface AdAccount {
  id: string;
  name: string;
}

const DATE_PRESETS = [
  { label: "اليوم", days: 0 },
  { label: "أمس", days: 1 },
  { label: "آخر 3 أيام", days: 3 },
  { label: "آخر 7 أيام", days: 7 },
  { label: "آخر 14 يوم", days: 14 },
  { label: "آخر 30 يوم", days: 30 },
];

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function applyPreset(days: number): { since: string; until: string } {
  const today = new Date();
  if (days === 0) return { since: fmtDate(today), until: fmtDate(today) };
  if (days === 1) {
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    return { since: fmtDate(y), until: fmtDate(y) };
  }
  const since = new Date(today);
  since.setDate(today.getDate() - days + 1);
  return { since: fmtDate(since), until: fmtDate(today) };
}

function canSee(slug: PageSlug, allowed: string[] | null): boolean {
  if (allowed === null) return true;
  return allowed.includes(slug);
}

interface NavItemProps {
  path: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}

function NavItem({ path, label, icon: Icon, active, onClick }: NavItemProps) {
  return (
    <Link href={path}>
      <button
        onClick={onClick}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
          active
            ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30"
            : "text-slate-400 hover:text-white hover:bg-slate-800"
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-right">{label}</span>
        {active && <ChevronLeft className="w-3.5 h-3.5 text-blue-300" />}
      </button>
    </Link>
  );
}

function GroupHeader({ label, color }: { label: string; color: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-4 pt-2 pb-1")}>
      <div className={cn("w-1.5 h-1.5 rounded-full", color)} />
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { dateRange, setDateRange, selectedAccount, setSelectedAccount } = useDashboard();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  const { data: accounts = [] } = useQuery<AdAccount[]>({
    queryKey: ["meta-accounts"],
    queryFn: () =>
      fetch(`${API}/meta/accounts`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.accounts ?? []),
    staleTime: 5 * 60_000,
  });

  const currentAccount = accounts.find((a) => a.id === selectedAccount) ?? accounts[0];
  const allowed = user?.allowed_pages ?? null;

  function isActive(path: string) {
    if (path === "/campaigns") return location === "/" || location === "/campaigns" || location === "";
    return location.startsWith(path) && path !== "/";
  }

  const visibleMeta = META_PAGES.filter((p) => canSee(p.slug, allowed));
  const visibleGoogle = GOOGLE_PAGES.filter((p) => canSee(p.slug, allowed));
  const visibleGeneral = GENERAL_PAGES.filter((p) => canSee(p.slug, allowed));
  const showAdmin = user?.role === "admin";

  return (
    <div className="min-h-screen bg-slate-950 text-white" dir="rtl">
      {/* ── Top Header ── */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800 shadow-sm">
        <div className="flex items-center gap-3 px-4 h-14">
          {/* Hamburger — right side in RTL */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(true)}
            className="text-slate-300 hover:text-white hover:bg-slate-700 h-9 w-9 p-0 rounded-lg"
            aria-label="القائمة"
          >
            <Menu className="w-5 h-5" />
          </Button>

          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm text-white hidden sm:block">DemandGen Ops</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Account Selector */}
          {accounts.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs h-8 gap-1 max-w-[150px]"
                >
                  <span className="truncate">{currentAccount?.name ?? "اختر حساباً"}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-white">
                {accounts.map((acc) => (
                  <DropdownMenuItem
                    key={acc.id}
                    onClick={() => setSelectedAccount(acc.id)}
                    className={cn(
                      "text-slate-200 hover:bg-slate-700 cursor-pointer",
                      acc.id === (selectedAccount || accounts[0]?.id) && "bg-blue-700/40"
                    )}
                  >
                    {acc.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Date Preset */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs h-8 gap-1"
              >
                <Calendar className="w-3 h-3 shrink-0" />
                <span className="hidden sm:inline">
                  {dateRange.since === dateRange.until
                    ? dateRange.since
                    : `${dateRange.since} ← ${dateRange.until}`}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-white min-w-[200px]">
              {DATE_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p.label}
                  onClick={() => setDateRange(applyPreset(p.days))}
                  className="text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  {p.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-slate-700" />
              <div className="px-2 py-2 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>من:</span>
                  <input
                    type="date"
                    value={dateRange.since}
                    onChange={(e) => setDateRange({ ...dateRange, since: e.target.value })}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs flex-1"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>إلى:</span>
                  <input
                    type="date"
                    value={dateRange.until}
                    onChange={(e) => setDateRange({ ...dateRange, until: e.target.value })}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs flex-1"
                  />
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-8 w-8 p-0">
                <User className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-white">
              <div className="px-3 py-2 text-xs text-slate-400">
                <p className="font-medium text-white">{user?.username}</p>
                <p className="text-slate-500 mt-0.5">
                  {user?.role === "admin" ? "مدير النظام" : user?.role === "media_buyer" ? "ميدياباير" : "مدير وسائط"}
                </p>
              </div>
              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuItem
                onClick={logout}
                className="text-red-400 hover:bg-red-950/40 cursor-pointer gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

        </div>
      </header>

      {/* ── Sidebar Overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar Drawer (slides from right) ── */}
      <aside
        className={cn(
          "fixed top-0 right-0 h-full z-50 w-72 bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "translate-x-full"
        )}
        dir="rtl"
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm text-white">DemandGen Ops</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav Groups */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-1">

          {/* AI Chat — Home */}
          <div className="px-2 mb-1">
            <NavItem
              path="/"
              label="مساعد الإعلانات"
              icon={MessageSquare}
              active={isActive("/") || isActive("/chat")}
              onClick={() => setSidebarOpen(false)}
            />
          </div>
          <div className="border-t border-slate-800 mx-4 mb-2" />

          {/* META Group */}
          {visibleMeta.length > 0 && (
            <div>
              <GroupHeader label="Meta Ads" color="bg-blue-500" />
              <div className="space-y-0.5 px-2 mt-1">
                {visibleMeta.map((item) => (
                  <NavItem
                    key={item.slug}
                    path={item.path}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.path)}
                    onClick={() => setSidebarOpen(false)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* GOOGLE Group */}
          {visibleGoogle.length > 0 && (
            <div className="mt-2">
              <GroupHeader label="Google / DemandGen" color="bg-emerald-500" />
              <div className="space-y-0.5 px-2 mt-1">
                {visibleGoogle.map((item) => (
                  <NavItem
                    key={item.slug}
                    path={item.path}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.path)}
                    onClick={() => setSidebarOpen(false)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* GENERAL */}
          {visibleGeneral.length > 0 && (
            <div className="mt-2">
              <div className="border-t border-slate-800 mx-4 my-2" />
              <div className="space-y-0.5 px-2">
                {visibleGeneral.map((item) => (
                  <NavItem
                    key={item.slug}
                    path={item.path}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.path)}
                    onClick={() => setSidebarOpen(false)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ADMIN (admin only) */}
          {showAdmin && (
            <div className="px-2">
              <NavItem
                path="/admin"
                label="إدارة المستخدمين"
                icon={Shield}
                active={isActive("/admin")}
                onClick={() => setSidebarOpen(false)}
              />
            </div>
          )}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
              <User className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.username}</p>
              <p className="text-xs text-slate-500">
                {user?.role === "admin" ? "مدير النظام" : user?.role === "media_buyer" ? "ميدياباير" : "مدير وسائط"}
              </p>
            </div>
            <button
              onClick={logout}
              className="text-slate-500 hover:text-red-400 transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main>{children}</main>
    </div>
  );
}
