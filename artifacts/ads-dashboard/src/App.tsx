import { Router, Route, Switch } from "wouter";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import GoogleAdsAiChat from "@/components/GoogleAdsAiChat";
import { BarChart3, LogOut, User } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function NavBar() {
  const { user, logout } = useAuth();
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/95 backdrop-blur-sm flex items-center px-4 gap-3" dir="rtl">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <BarChart3 className="h-4 w-4 text-blue-500" />
        </div>
        Google Ads Dashboard
      </div>
      <div className="flex-1" />
      {user && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="h-3.5 w-3.5" />
            {user.username}
          </div>
          <button
            onClick={() => void logout()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded-lg hover:bg-destructive/5"
            title="تسجيل الخروج"
          >
            <LogOut className="h-3.5 w-3.5" />
            خروج
          </button>
        </div>
      )}
    </header>
  );
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex gap-1.5">
          {[0, 1, 2].map(k => (
            <span key={k} className="w-2.5 h-2.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${k * 150}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <>
      <NavBar />
      <Router base={BASE}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/:rest*" component={Dashboard} />
        </Switch>
      </Router>
      <GoogleAdsAiChat />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
