import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

const BASE = "";
const API = `${BASE}/api`;

const PAGE_NAMES: Record<string, string> = {
  "/":          "تحليل الحملة",
  "/overview":  "نظرة عامة",
  "/creative":  "مركز الكريتف",
  "/activity":  "نشاط الفريق",
  "/media":     "طلبات الميديا",
  "/admin":     "إدارة المستخدمين",
};

async function logActivity(action: string, page?: string, meta?: Record<string, unknown>) {
  try {
    await fetch(`${API}/activity/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action, page, meta }),
    });
  } catch { /* non-blocking */ }
}

export function useActivityLogger() {
  const [location] = useLocation();
  const { user } = useAuth();
  const lastLocation = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (location === lastLocation.current) return;
    lastLocation.current = location;
    logActivity("page_visit", location);
  }, [location, user]);

  // Heartbeat every 2 minutes to keep last_seen fresh
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      logActivity("heartbeat");
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);
}

export function logDiagnosisRun(campaignName: string) {
  logActivity("diagnosis_run", undefined, { campaign: campaignName });
}

export function logMediaRequestCreated(campaignName: string) {
  logActivity("media_request_created", undefined, { campaign: campaignName });
}

export { PAGE_NAMES };
