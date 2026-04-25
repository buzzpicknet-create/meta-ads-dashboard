import { Switch, Route, Router as WouterRouter, Link, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Overview from "@/pages/Overview";
import HowTo from "@/pages/HowTo";
import ActivityPage from "@/pages/Activity";
import { Activity, BookOpen, LayoutDashboard, ClipboardList } from "lucide-react";

const queryClient = new QueryClient();

function NavBar() {
  const [isOverview]  = useRoute("/overview");
  const [isDashboard] = useRoute("/");
  const [isHowTo]     = useRoute("/how-to");
  const [isActivity]  = useRoute("/activity");

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-sm font-bold">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Meta Ads
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/overview"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isOverview
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              نظرة عامة
            </Link>
            <Link
              href="/"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isDashboard
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Activity className="h-4 w-4" />
              تحليل الحملة
            </Link>
            <Link
              href="/activity"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActivity
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              نشاط الفريق
            </Link>
            <Link
              href="/how-to"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isHowTo
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              دليل الحلول
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

function Router() {
  return (
    <>
      <NavBar />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/overview" component={Overview} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/how-to" component={HowTo} />
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
