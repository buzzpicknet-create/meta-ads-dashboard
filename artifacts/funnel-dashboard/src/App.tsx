import { Switch, Route, Router as WouterRouter, Link, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Overview from "@/pages/Overview";
import ActivityPage from "@/pages/Activity";
import MediaRequestsPage from "@/pages/MediaRequests";
import CreativePage from "@/pages/Creative";
import { Activity, LayoutDashboard, ClipboardList, Clapperboard, Sparkles } from "lucide-react";

const queryClient = new QueryClient();

const NAV_ITEMS = [
  { href: "/overview",  label: "نظرة عامة",    Icon: LayoutDashboard, useRoute: "/overview" },
  { href: "/",          label: "تحليل الحملة", Icon: Activity,         useRoute: "/" },
  { href: "/creative",  label: "مركز الكريتف", Icon: Sparkles,        useRoute: "/creative" },
  { href: "/activity",  label: "نشاط الفريق",  Icon: ClipboardList,   useRoute: "/activity" },
  { href: "/media",     label: "طلبات الميديا", Icon: Clapperboard,    useRoute: "/media" },
];

function NavBar() {
  const routes = NAV_ITEMS.map((item) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [active] = useRoute(item.useRoute);
    return active;
  });

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
              {NAV_ITEMS.map((item, i) => {
                const active = routes[i];
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
          </div>
        </div>
      </nav>

      {/* ── Bottom tab bar (mobile only) ── */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        dir="rtl"
      >
        <div className="flex items-center justify-around h-16 px-1">
          {NAV_ITEMS.map((item, i) => {
            const active = routes[i];
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
        </div>
      </nav>

      {/* Spacer so content doesn't hide behind bottom bar on mobile */}
      <div className="sm:hidden h-16" />
    </>
  );
}

function Router() {
  return (
    <>
      <NavBar />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/overview" component={Overview} />
        <Route path="/creative" component={CreativePage} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/media" component={MediaRequestsPage} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
