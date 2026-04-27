import { Switch, Route, Router as WouterRouter, Link, useRoute, useLocation } from "wouter";
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
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Activity, LayoutDashboard, ClipboardList, Clapperboard, Sparkles, Settings, LogOut, Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const ALL_NAV_ITEMS = [
  { href: "/overview",  label: "نظرة عامة",    Icon: LayoutDashboard, useRoute: "/overview",  roles: ["admin", "media_buyer"] },
  { href: "/",          label: "تحليل الحملة", Icon: Activity,         useRoute: "/",          roles: ["admin", "media_buyer"] },
  { href: "/creative",  label: "مركز الكريتف", Icon: Sparkles,        useRoute: "/creative",  roles: ["admin", "media_buyer"] },
  { href: "/activity",  label: "نشاط الفريق",  Icon: ClipboardList,   useRoute: "/activity",  roles: ["admin", "media_buyer"] },
  { href: "/media",     label: "طلبات الميديا", Icon: Clapperboard,   useRoute: "/media",     roles: ["admin", "media_buyer", "media_manager"] },
  { href: "/admin",     label: "المستخدمون",   Icon: Settings,        useRoute: "/admin",      roles: ["admin"] },
];

function NavBar() {
  const { user, logout } = useAuth();
  const role = user?.role ?? "media_manager";

  const navItems = ALL_NAV_ITEMS.filter((item) => item.roles.includes(role));

  const routes = ALL_NAV_ITEMS.map((item) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [active] = useRoute(item.useRoute);
    return active;
  });

  function activeFor(href: string) {
    const idx = ALL_NAV_ITEMS.findIndex((i) => i.href === href);
    return idx >= 0 ? routes[idx] : false;
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

            {/* User + Logout */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground hidden md:block">
                {user?.username}
              </span>
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

      {/* Spacer so content doesn't hide behind bottom bar on mobile */}
      <div className="sm:hidden h-16" />
    </>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const role = user.role;

  return (
    <>
      <NavBar />
      <Switch>
        {role === "media_manager" ? (
          <>
            <Route path="/media" component={MediaRequestsPage} />
            <Route>
              {() => {
                navigate("/media");
                return null;
              }}
            </Route>
          </>
        ) : (
          <>
            <Route path="/" component={Dashboard} />
            <Route path="/overview" component={Overview} />
            <Route path="/creative" component={CreativePage} />
            <Route path="/activity" component={ActivityPage} />
            <Route path="/media" component={MediaRequestsPage} />
            {role === "admin" && <Route path="/admin" component={AdminPage} />}
            <Route component={NotFound} />
          </>
        )}
      </Switch>
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
