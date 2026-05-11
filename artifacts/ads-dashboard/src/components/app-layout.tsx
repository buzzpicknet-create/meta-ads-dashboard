import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { useDashboard } from "@/context/dashboard-context";
import { useQuery } from "@tanstack/react-query";
import { API } from "@/context/auth-context";
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
  LayoutDashboard,
  Video,
  Scissors,
  FileText,
  ShoppingBag,
  Users,
  Trophy,
  Settings,
  Shield,
  LogOut,
  ChevronDown,
  Calendar,
  Menu,
  X,
  User,
} from "lucide-react";

interface AdAccount {
  id: string;
  name: string;
  account_status?: number;
}

const NAV_ITEMS = [
  { path: "/", label: "القرارات", icon: LayoutDashboard, exact: true },
  { path: "/creative", label: "مركز الكريتف", icon: Video },
  { path: "/video-studio", label: "استوديو الفيديو", icon: Scissors },
  { path: "/landing-page", label: "صفحات البيع", icon: FileText },
  { path: "/shopify", label: "Shopify", icon: ShoppingBag },
  { path: "/audience", label: "الجمهور والمنصات", icon: Users },
  { path: "/winning-products", label: "منتجات رابحة", icon: Trophy },
  { path: "/settings", label: "الإعدادات", icon: Settings },
  { path: "/admin", label: "الإدارة", icon: Shield, adminOnly: true },
];

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
  const since = new Date(today);
  if (days === 0) {
    return { since: fmtDate(today), until: fmtDate(today) };
  }
  if (days === 1) {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return { since: fmtDate(yesterday), until: fmtDate(yesterday) };
  }
  since.setDate(today.getDate() - days + 1);
  return { since: fmtDate(since), until: fmtDate(today) };
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { dateRange, setDateRange, selectedAccount, setSelectedAccount } =
    useDashboard();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: accounts = [] } = useQuery<AdAccount[]>({
    queryKey: ["meta-accounts"],
    queryFn: () =>
      fetch(`${API}/meta/accounts`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.accounts ?? []),
    staleTime: 5 * 60_000,
  });

  const currentAccount =
    accounts.find((a) => a.id === selectedAccount) ?? accounts[0];

  function isActive(path: string, exact?: boolean) {
    if (exact) return location === "/" || location === "";
    return location.startsWith(path) && path !== "/";
  }

  const visibleNav = NAV_ITEMS.filter(
    (n) => !n.adminOnly || user?.role === "admin"
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white" dir="rtl">
      {/* ── Top Header ── */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 shadow-sm">
        <div className="flex items-center gap-3 px-4 h-14">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm text-white hidden sm:block">
              DemandGen Ops
            </span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-0.5 mr-4 flex-1 overflow-x-auto">
            {visibleNav.map((item) => {
              const active = isActive(item.path, item.exact);
              return (
                <Link key={item.path} href={item.path}>
                  <button
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all",
                      active
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                    )}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.label}
                  </button>
                </Link>
              );
            })}
          </nav>

          {/* Right side controls */}
          <div className="flex items-center gap-2 mr-auto">
            {/* Account Selector */}
            {accounts.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs h-8 gap-1 max-w-[160px]"
                  >
                    <span className="truncate">
                      {currentAccount?.name ?? "اختر حساباً"}
                    </span>
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-slate-800 border-slate-700 text-white"
                >
                  {accounts.map((acc) => (
                    <DropdownMenuItem
                      key={acc.id}
                      onClick={() => setSelectedAccount(acc.id)}
                      className={cn(
                        "text-slate-200 hover:bg-slate-700 cursor-pointer",
                        acc.id === (selectedAccount || accounts[0]?.id) &&
                          "bg-blue-700/40"
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
                  <Calendar className="w-3 h-3" />
                  <span className="hidden sm:inline">
                    {dateRange.since === dateRange.until
                      ? dateRange.since
                      : `${dateRange.since} → ${dateRange.until}`}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-slate-800 border-slate-700 text-white"
              >
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
                      onChange={(e) =>
                        setDateRange({ ...dateRange, since: e.target.value })
                      }
                      className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>إلى:</span>
                    <input
                      type="date"
                      value={dateRange.until}
                      onChange={(e) =>
                        setDateRange({ ...dateRange, until: e.target.value })
                      }
                      className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs"
                    />
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:text-white h-8 w-8 p-0"
                >
                  <User className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-slate-800 border-slate-700 text-white"
              >
                <div className="px-3 py-2 text-xs text-slate-400">
                  <p className="font-medium text-white">{user?.username}</p>
                  <p>{user?.role}</p>
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

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden text-slate-400 hover:text-white h-8 w-8 p-0"
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? (
                <X className="w-4 h-4" />
              ) : (
                <Menu className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <nav className="lg:hidden border-t border-slate-800 bg-slate-900 px-3 py-2 flex flex-wrap gap-1">
            {visibleNav.map((item) => {
              const active = isActive(item.path, item.exact);
              return (
                <Link key={item.path} href={item.path}>
                  <button
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                      active
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                    )}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.label}
                  </button>
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {/* ── Main Content ── */}
      <main className="min-h-[calc(100vh-56px)]">{children}</main>
    </div>
  );
}
