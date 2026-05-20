import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Overview from "@/pages/Overview";
import ActivityPage from "@/pages/Activity";
import MediaRequestsPage from "@/pages/MediaRequests";
import CreativePage from "@/pages/Creative";
import LoginPage from "@/pages/Login";
import AdminPage from "@/pages/AdminPage";
import DecisionsPage from "@/pages/Decisions";
import LandingPageGenerator from "@/pages/LandingPage";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useActivityLogger } from "@/hooks/use-activity-logger";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Activity, LayoutDashboard, ClipboardList, Clapperboard, Sparkles, Settings, LogOut, Loader2, Bell, BellOff, Target, Search, Bot, Library, Package, ShieldAlert, AlertTriangle, Pause, X, CalendarDays, Globe, KeyRound } from "lucide-react";
import { useTokenHealth } from "@/hooks/use-meta";
import { useMyPageVisibility } from "@/hooks/use-page-visibility";
import { GlobalAiChat } from "@/components/GlobalAiChat";
import { NavConversationSearchModal, NavSearchButton } from "@/components/NavConversationSearch";
import { GlobalAiChatContext } from "@/contexts/GlobalAiChatContext";
import AiChatPage from "@/pages/AiChatPage";
import AssetLibrary from "@/pages/AssetLibrary";
import InventoryPage from "@/pages/Inventory";
import TasksPage from "@/pages/Tasks";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime:               2 * 60 * 60 * 1000, // keep data in memory for 2 hours
      refetchOnWindowFocus: false,               // don't refetch when user alt-tabs back
      refetchOnReconnect:   false,               // don't blast Meta on reconnect
    },
  },
});

const ALL_NAV_ITEMS = [
  { href: "/chat",       label: "المساعد",          Icon: Bot,             useRoute: "/chat",       roles: ["admin", "media_buyer"] },
  { href: "/overview",   label: "نظرة عامة",        Icon: LayoutDashboard, useRoute: "/overview",   roles: ["admin", "media_buyer"] },
  { href: "/decisions",  label: "تشخيص الحملات",   Icon: Target,          useRoute: "/decisions",  roles: ["admin"] },
  { href: "/media",      label: "طلبات الميديا",    Icon: Clapperboard,    useRoute: "/media",      roles: ["admin", "media_buyer", "media_manager"] },
  { href: "/activity",   label: "نشاط الفريق",      Icon: ClipboardList,   useRoute: "/activity",   roles: ["admin", "media_buyer"] },
  { href: "/creative",   label: "مركز الكريتف",     Icon: Sparkles,        useRoute: "/creative",   roles: ["admin", "media_buyer"] },
  { href: "/library",    label: "مركز العمليات",    Icon: Library,         useRoute: "/library",    roles: ["admin", "media_buyer"] },
  { href: "/inventory",  label: "المخزون",           Icon: Package,         useRoute: "/inventory",  roles: ["admin", "media_buyer"] },
  { href: "/tasks",      label: "المهام اليومية",   Icon: CalendarDays,    useRoute: "/tasks",      roles: ["admin", "media_buyer"] },
  { href: "/landing-page", label: "صفحات البيع",    Icon: Globe,           useRoute: "/landing-page", roles: ["admin", "media_buyer"] },
  { href: "/admin",      label: "المستخدمون",       Icon: Settings,        useRoute: "/admin",       roles: ["admin"] },
];

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AiNotification {
  id: number;
  campaign_id: string | null;
  campaign_name: string | null;
  severity: string;
  message: string;
  recommended_action: { type: string; campaign_id?: string } | null;
  is_read: boolean;
  is_executed: boolean;
  created_at: string;
}

function AiWatchdogBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AiNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [executing, setExecuting] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isAllowed = !!user && user.role !== "media_manager";

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/ai/notifications`, { credentials: "include" });
      if (r.ok) {
        const d = await r.json() as { notifications: AiNotification[] };
        setNotifications(d.notifications ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!isAllowed) return;
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load, isAllowed]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const unread = notifications.filter((n) => !n.is_read).length;

  const markAllRead = useCallback(() => {
    notifications
      .filter((n) => !n.is_read)
      .forEach((n) => {
        fetch(`${API_BASE}/api/ai/notifications/${n.id}/read`, { method: "POST", credentials: "include" }).catch(() => {});
      });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, [notifications]);

  const execute = useCallback(async (id: number) => {
    setExecuting(id);
    try {
      const r = await fetch(`${API_BASE}/api/ai/notifications/${id}/execute`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json() as { ok?: boolean; message?: string; error?: string };
      if (d.ok) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        setToast(d.message ?? "تم تنفيذ الإجراء بنجاح ✓");
        setOpen(false);
      } else {
        setToast(d.error ?? "فشل تنفيذ الإجراء");
      }
    } catch {
      setToast("تعذّر الاتصال بالسيرفر");
    }
    setExecuting(null);
  }, []);

  const dismiss = useCallback(async (id: number) => {
    try {
      await fetch(`${API_BASE}/api/ai/notifications/${id}/dismiss`, {
        method: "POST", credentials: "include",
      });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch { /* silent */ }
  }, []);

  // All hooks defined above — safe to return early now
  if (!isAllowed || (notifications.length === 0 && !open)) return null;

  return (
    <div className="relative">
      {/* Toast feedback */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-4 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium shadow-lg border border-border/20 whitespace-nowrap"
          dir="rtl"
        >
          {toast}
        </div>
      )}

      {/* Bell button */}
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markAllRead();
        }}
        title="تنبيهات المراقب الذكي"
        className="relative inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
      >
        <ShieldAlert className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none animate-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full mt-2 z-50 w-80 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
            dir="rtl"
            style={{ minWidth: "320px" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-red-50 dark:bg-red-950/20">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-500" />
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                  المراقب الذكي
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Notifications list */}
            <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  لا توجد تنبيهات حالياً
                </div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className="px-4 py-3.5 flex flex-col gap-2.5">
                    {/* Alert message */}
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm leading-relaxed text-foreground">{n.message}</p>
                    </div>

                    {/* Campaign name badge */}
                    {n.campaign_name && (
                      <span className="self-start text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                        {n.campaign_name}
                      </span>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                      {n.recommended_action?.type === "pause" && (
                        <button
                          onClick={() => execute(n.id)}
                          disabled={executing === n.id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                          {executing === n.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Pause className="h-3 w-3 fill-white" />
                          )}
                          إيقاف الحملة الآن
                        </button>
                      )}
                      <button
                        onClick={() => dismiss(n.id)}
                        className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors border border-border"
                      >
                        تجاهل
                      </button>
                    </div>

                    {/* Timestamp */}
                    <span className="text-[10px] text-muted-foreground/50">
                      {new Date(n.created_at).toLocaleString("ar-EG")}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationBell() {
  const { state, subscribe, unsubscribe } = usePushNotifications();

  if (state === "unsupported") return null;
  if (state === "loading") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;

  // Blocked by browser (quiet UI / previously dismissed too many times)
  if (state === "blocked") {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 text-[11px] text-amber-700 dark:text-amber-400 max-w-[200px]" dir="rtl">
        <BellOff className="h-3.5 w-3.5 shrink-0" />
        <span>فعّل الإشعارات يدوياً من إعدادات المتصفح</span>
      </div>
    );
  }

  // Denied permanently in browser settings
  if (state === "denied") {
    return (
      <div
        title="الإشعارات محجوبة — افتح إعدادات المتصفح وأعطِ الإذن يدوياً"
        className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground opacity-50 cursor-default"
      >
        <BellOff className="h-4 w-4" />
      </div>
    );
  }

  const isOn = state === "subscribed";
  return isOn ? (
    <button
      onClick={unsubscribe}
      title="إيقاف الإشعارات"
      className="inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors relative text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
    >
      <Bell className="h-4 w-4 fill-amber-500" />
      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
    </button>
  ) : (
    <button
      onClick={subscribe}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors shrink-0"
    >
      <Bell className="h-3.5 w-3.5" />
      تفعيل الإشعارات
    </button>
  );
}

function TokenStatusBadge() {
  const { data, isLoading } = useTokenHealth();
  if (isLoading || !data) return null;
  const t = data.token;
  const isExpired = !t.fb_valid || t.days_left <= 0;
  const isWarning = !isExpired && t.days_left <= 14;
  if (!isExpired && !isWarning) return null;
  return (
    <a
      href="/admin"
      title={
        isExpired
          ? `Token منتهي: ${t.fb_error ?? "غير صالح"}`
          : `Token ينتهي خلال ${t.days_left} يوم — اضغط للتجديد`
      }
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        isExpired
          ? "bg-red-500/15 text-red-600 hover:bg-red-500/25"
          : "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25"
      }`}
    >
      <KeyRound className="h-3 w-3" />
      {isExpired ? "Token منتهي" : `${t.days_left}ي`}
    </a>
  );
}

function NavBar() {
  const { user, logout } = useAuth();
  const role = user?.role ?? "media_manager";
  const visibilityMap = useMyPageVisibility();
  const [searchOpen, setSearchOpen] = useState(false);
  // Only roles that have GlobalAiChat mounted can use conversation search
  const hasConversationUI = role !== "media_manager";

  const openSearch = useCallback(() => {
    if (hasConversationUI) setSearchOpen(true);
  }, [hasConversationUI]);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Global keyboard shortcut: Ctrl+K / Cmd+K — only for roles with AI chat
  useEffect(() => {
    if (!hasConversationUI) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [hasConversationUI]);

  const navItems = ALL_NAV_ITEMS.filter((item) => {
    // If the dynamic visibility map has a setting for this page, it overrides the hardcoded roles
    if (visibilityMap && Object.prototype.hasOwnProperty.call(visibilityMap, item.href)) {
      return visibilityMap[item.href] === true;
    }
    // Fall back to hardcoded roles if no DB setting exists yet
    return item.roles.includes(role);
  });

  const [location] = useLocation();

  function activeFor(href: string) {
    return location === href || location.startsWith(href + "/");
  }

  return (
    <>
      {/* ── Top bar (desktop) ── */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-1.5 text-sm font-bold shrink-0">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Meta Ads
            </div>

            {/* Search + Bell on mobile (top bar) */}
            <div className="sm:hidden flex items-center gap-1">
              {hasConversationUI && (
                <button
                  onClick={openSearch}
                  title="بحث في المحادثات"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
              <AiWatchdogBell />
              <NotificationBell />
            </div>

            {/* Desktop nav — hidden on mobile */}
            <div className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => {
                const active = activeFor(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <item.Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {/* User + Notifications + Logout */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              {role === "admin" && <TokenStatusBadge />}
              {hasConversationUI && <NavSearchButton onOpen={openSearch} />}
              <span className="text-xs text-muted-foreground hidden md:block">
                {user?.username}
              </span>
              <AiWatchdogBell />
              <NotificationBell />
              <button
                onClick={logout}
                title="تسجيل الخروج"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                خروج
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Bottom tab bar (mobile only) ── */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        dir="rtl"
      >
        <div className="flex items-center justify-around h-16 px-1">
          {navItems.map((item) => {
            const active = activeFor(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-xl transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <item.Icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : ""}`} />
                <span className="text-[10px] font-medium leading-tight text-center">
                  {item.label}
                </span>
              </Link>
            );
          })}
          {/* Logout on mobile */}
          <button
            onClick={logout}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-xl transition-colors text-muted-foreground"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-tight">خروج</span>
          </button>
        </div>
      </nav>

      {/* Global conversation search modal — only for roles that have AI chat */}
      {hasConversationUI && (
        <NavConversationSearchModal open={searchOpen} onClose={closeSearch} />
      )}
    </>
  );
}

function ChatRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/chat"); }, [navigate]);
  return null;
}

function MediaManagerRouter() {
  const [, navigate] = useLocation();
  return (
    <>
      <NavBar />
      <Switch>
        <Route path="/media" component={MediaRequestsPage} />
        <Route>
          {() => {
            navigate("/media");
            return null;
          }}
        </Route>
      </Switch>
      <div className="sm:hidden h-16" />
    </>
  );
}

function FullRouter({ isAdmin, role }: { isAdmin: boolean; role: string }) {
  const visibilityMap = useMyPageVisibility();

  // Stable ref so NavBar siblings can call openToConversation via context without stale closures
  const openToConversationRef = useRef<(convId: number, campaignId?: string | null) => void>(() => {});
  const openToConversation = useCallback((convId: number, campaignId?: string | null) => {
    openToConversationRef.current(convId, campaignId);
  }, []);

  // In-memory pending campaign: set by GlobalAiChat when a campaign-linked conversation is opened,
  // consumed (and cleared) by Dashboard so it works even when already on the Dashboard route.
  const [pendingCampaignId, setPendingCampaignId] = useState<string | null>(null);
  const clearPendingCampaignId = useCallback(() => setPendingCampaignId(null), []);

  // Selected ad account — shared with GlobalAiChat via context + persisted in localStorage
  // so it survives page navigation and browser refresh.
  const [selectedAccountId, setSelectedAccountIdRaw] = useState<string | null>(
    () => localStorage.getItem("selected_account_id")
  );
  const setSelectedAccountId = useCallback((id: string | null) => {
    setSelectedAccountIdRaw(id);
    if (id) localStorage.setItem("selected_account_id", id);
    else localStorage.removeItem("selected_account_id");
  }, []);

  // A page is accessible based on the visibility map (applies to all roles including admin).
  // Falls back to hardcoded roles if no DB setting exists yet.
  // /admin is always accessible to admin regardless of visibility settings.
  // /dashboard maps to the old "/" key in the DB visibility map.
  function canAccess(path: string) {
    const dbKey = path === "/dashboard" ? "/" : path;
    if (visibilityMap && Object.prototype.hasOwnProperty.call(visibilityMap, dbKey)) {
      return visibilityMap[dbKey] === true;
    }
    // Fallback: allow if role was originally allowed in ALL_NAV_ITEMS
    const item = ALL_NAV_ITEMS.find((i) => i.href === path);
    return item ? item.roles.includes(role) : false;
  }

  const ctxValue = useMemo(
    () => ({ openToConversation, pendingCampaignId, clearPendingCampaignId, selectedAccountId, setSelectedAccountId }),
    [openToConversation, pendingCampaignId, clearPendingCampaignId, selectedAccountId]
  );

  return (
    <GlobalAiChatContext.Provider value={ctxValue}>
      <NavBar />
      <Switch>
        <Route path="/chat"       component={canAccess("/chat")       ? AiChatPage         : NotFound} />
        <Route path="/dashboard"  component={canAccess("/dashboard")  ? Dashboard          : NotFound} />
        <Route path="/overview"   component={canAccess("/overview")   ? Overview          : NotFound} />
        <Route path="/creative"   component={canAccess("/creative")   ? CreativePage       : NotFound} />
        <Route path="/activity"   component={canAccess("/activity")   ? ActivityPage       : NotFound} />
        <Route path="/media"      component={canAccess("/media")      ? MediaRequestsPage  : NotFound} />
        <Route path="/decisions"  component={canAccess("/decisions")  ? DecisionsPage      : NotFound} />
        <Route path="/library"    component={canAccess("/library")    ? AssetLibrary       : NotFound} />
        <Route path="/inventory"  component={canAccess("/inventory")  ? InventoryPage      : NotFound} />
        <Route path="/tasks"      component={canAccess("/tasks")      ? TasksPage          : NotFound} />
        <Route path="/landing-page" component={canAccess("/landing-page") ? LandingPageGenerator : NotFound} />
        <Route path="/admin"      component={isAdmin                  ? AdminPage          : NotFound} />
        <Route path="/"           component={ChatRedirect} />
        <Route component={NotFound} />
      </Switch>
      {/* Spacer so page content doesn't hide behind fixed bottom nav on mobile */}
      <div className="sm:hidden h-16" />
      <GlobalAiChat
        onRegisterOpenFn={(fn) => { openToConversationRef.current = fn; }}
        onCampaignSelected={(id) => setPendingCampaignId(id)}
      />
    </GlobalAiChatContext.Provider>
  );
}

function ActivityTracker() {
  useActivityLogger();
  return null;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <>
      <ActivityTracker />
      {user.role === "media_manager"
        ? <MediaManagerRouter />
        : <FullRouter isAdmin={user.role === "admin"} role={user.role} />}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
