import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route, Switch, Redirect } from "wouter";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { DashboardProvider } from "@/context/dashboard-context";
import { AppLayout } from "@/components/app-layout";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";
import Login from "@/pages/login";
import Campaigns from "@/pages/campaigns";
import Creative from "@/pages/creative";
import VideoStudio from "@/pages/video-studio";
import LandingPage from "@/pages/landing-page";
import Shopify from "@/pages/shopify";
import Audience from "@/pages/audience";
import WinningProducts from "@/pages/winning-products";
import Settings from "@/pages/settings";
import AdminPage from "@/pages/admin";

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") || "/ads";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  return (
    <Router base={BASE}>
      <Switch>
        <Route path="/login" component={Login} />

        <Route path="/">
          <RequireAuth>
            <Campaigns />
          </RequireAuth>
        </Route>

        <Route path="/campaigns">
          <RequireAuth>
            <Campaigns />
          </RequireAuth>
        </Route>

        <Route path="/creative">
          <RequireAuth>
            <Creative />
          </RequireAuth>
        </Route>

        <Route path="/video-studio">
          <RequireAuth>
            <VideoStudio />
          </RequireAuth>
        </Route>

        <Route path="/landing-page">
          <RequireAuth>
            <LandingPage />
          </RequireAuth>
        </Route>

        <Route path="/shopify">
          <RequireAuth>
            <Shopify />
          </RequireAuth>
        </Route>

        <Route path="/audience">
          <RequireAuth>
            <Audience />
          </RequireAuth>
        </Route>

        <Route path="/winning-products">
          <RequireAuth>
            <WinningProducts />
          </RequireAuth>
        </Route>

        <Route path="/settings">
          <RequireAuth>
            <Settings />
          </RequireAuth>
        </Route>

        <Route path="/admin">
          <RequireAuth>
            <AdminPage />
          </RequireAuth>
        </Route>

        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </Router>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <DashboardProvider>
          <AppRoutes />
          <Toaster position="top-center" dir="rtl" />
        </DashboardProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
