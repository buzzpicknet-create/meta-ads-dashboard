import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clapperboard, Plus, ExternalLink, ChevronDown, Check, Loader2, AlertCircle,
  ScanSearch, RefreshCw, Clock, ThumbsUp, ThumbsDown, ChevronDown as ChevDown,
  Trash2, History,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface MediaRequest {
  id: number;
  campaign_id: string | null;
  campaign_name: string;
  landing_url: string | null;
  status: string;
  priority: string;
  notes: string | null;
  created_at: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
}

interface ScanStatus {
  scanned_at: string;
  campaigns_checked: number;
  requests_created: number;
}

interface ScanResult {
  campaigns_checked: number;
  requests_created: number;
  scanned_at: string;
  triggered: Array<{ campaign_name: string; reasons: string[]; priority: string }>;
}

interface DeleteLogEntry {
  id: number;
  request_id: number;
  campaign_name: string;
  status_at_deletion: string;
  priority_at_deletion: string;
  notes: string | null;
  deleted_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; next?: string; nextLabel?: string }> = {
  needs_review: { label: "قيد المراجعة", color: "bg-purple-100 text-purple-800 border-purple-200" },
  pending:      { label: "يحتاج ميديا", color: "bg-amber-100 text-amber-800 border-amber-200", next: "in_progress", nextLabel: "بدء التنفيذ" },
  in_progress:  { label: "جاري التنفيذ", color: "bg-blue-100 text-blue-800 border-blue-200", next: "done", nextLabel: "تم الإنجاز" },
  done:         { label: "مكتمل", color: "bg-emerald-100 text-emerald-800 border-emerald-200", next: "pending", nextLabel: "إعادة تفعيل" },
};

const PRIORITY_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  high:   { label: "عالية",   dot: "bg-red-500",    badge: "bg-red-500 text-white" },
  medium: { label: "متوسطة", dot: "bg-amber-500",  badge: "bg-amber-500 text-white" },
  normal: { label: "عادية",   dot: "bg-slate-400",  badge: "bg-slate-400 text-white" },
};

function useMediaRequests() {
  return useQuery<{ requests: MediaRequest[] }>({
    queryKey: ["media-requests"],
    queryFn: () => fetch(`${API}/media-requests`).then((r) => r.json()),
  });
}

function useScanStatus() {
  return useQuery<{ last_scan: ScanStatus | null }>({
    queryKey: ["media-scan-status"],
    queryFn: () => fetch(`${API}/media-requests/scan-status`).then((r) => r.json()),
    refetchInterval: 60_000,
  });
}

function useDeleteLog() {
  return useQuery<{ log: DeleteLogEntry[] }>({
    queryKey: ["media-delete-log"],
    queryFn: () => fetch(`${API}/media-requests/delete-log`).then((r) => r.json()),
  });
}

function useCampaigns() {
  return useQuery<{ campaigns: Campaign[] }>({
    queryKey: ["campaigns-list"],
    queryFn: () =>
      fetch(`${API}/meta/campaigns?ad_account_id=act_1714386865726065`).then((r) => r.json()),
  });
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "منذ لحظات";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(isoString));
}

// ─── Add Request Modal ────────────────────────────────────────────────────────
function AddRequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: campData } = useCampaigns();
  const campaigns = (campData?.campaigns ?? []).filter(
    (c) => c.effective_status === "ACTIVE" || c.effective_status === "PAUSED"
  );

  const [campaignId, setCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [landingUrl, setLandingUrl] = useState("");
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: object) =>
      fetch(`${API}/media-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-requests"] });
      onClose();
    },
  });

  const handleCampaignSelect = (id: string) => {
    setCampaignId(id);
    const camp = campaigns.find((c) => c.id === id);
    if (camp) setCampaignName(camp.name);
  };

  const handleSubmit = () => {
    const name = useCustom ? campaignName : campaigns.find((c) => c.id === campaignId)?.name ?? campaignName;
    if (!name) return;
    mutation.mutate({ campaign_id: useCustom ? null : campaignId || null, campaign_name: name, landing_url: landingUrl || null, priority, notes: notes || null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-background border border-border shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">طلب ميديا جديدة</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setUseCustom(false)} className={`px-3 py-1.5 rounded-lg transition-colors ${!useCustom ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>من الحملات النشطة</button>
            <button onClick={() => setUseCustom(true)} className={`px-3 py-1.5 rounded-lg transition-colors ${useCustom ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>إدخال يدوي</button>
          </div>

          {!useCustom ? (
            <div>
              <label className="block text-sm font-medium mb-1.5">اختر الحملة</label>
              <div className="relative">
                <select value={campaignId} onChange={(e) => handleCampaignSelect(e.target.value)} className="w-full appearance-none rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-sm pr-10">
                  <option value="">-- اختر حملة --</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1.5">اسم الحملة</label>
              <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="اكتب اسم الحملة..." className="w-full rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-sm" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">لينك اللاندينج بيدج</label>
            <input type="url" value={landingUrl} onChange={(e) => setLandingUrl(e.target.value)} placeholder="https://..." className="w-full rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-sm" dir="ltr" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">الأولوية</label>
            <div className="flex gap-2">
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                <button key={key} onClick={() => setPriority(key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${priority === key ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">ملاحظات للفريق</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي تعليمات أو ملاحظات مهمة للفريق..." rows={3} className="w-full rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-sm resize-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted">إلغاء</button>
          <button onClick={handleSubmit} disabled={mutation.isPending || (!campaignId && !campaignName)} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            إضافة الطلب
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Scan Toast ────────────────────────────────────────────────────────────────
function ScanResultToast({ result, onClose }: { result: ScanResult; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-6 z-50 w-80 rounded-2xl border border-border bg-card shadow-2xl p-4" dir="rtl">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <ScanSearch className="h-5 w-5 text-primary shrink-0" />
          <span className="font-semibold text-sm">نتيجة الفحص التلقائي</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
      </div>
      <div className="text-xs text-muted-foreground mb-3">
        تم فحص <span className="font-medium text-foreground">{result.campaigns_checked}</span> حملة
        {result.requests_created > 0
          ? <> — أُضيف <span className="font-medium text-primary">{result.requests_created}</span> للمراجعة</>
          : <> — لا توجد حملات جديدة تحتاج ميديا</>}
      </div>
      {result.triggered.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {result.triggered.map((t, i) => (
            <div key={i} className="rounded-lg bg-amber-50 border border-amber-200 p-2">
              <div className="text-xs font-medium text-amber-800 truncate">{t.campaign_name}</div>
              <div className="text-xs text-amber-600 mt-0.5">{t.reasons[0]}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Review Card ──────────────────────────────────────────────────────────────
function ReviewCard({ req }: { req: MediaRequest }) {
  const qc = useQueryClient();
  const priorityCfg = PRIORITY_CONFIG[req.priority] ?? PRIORITY_CONFIG["normal"]!;

  const approveMutation = useMutation({
    mutationFn: () => fetch(`${API}/media-requests/${req.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "pending" }) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media-requests"] }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => fetch(`${API}/media-requests/${req.id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["media-requests"] }); qc.invalidateQueries({ queryKey: ["media-delete-log"] }); },
  });

  const [expanded, setExpanded] = useState(false);
  const lines = (req.notes ?? "").split("\n");
  const reasons = lines.filter((l) => l.startsWith("•"));

  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${priorityCfg.badge}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              {priorityCfg.label}
            </span>
          </div>
          <h3 className="font-semibold text-sm leading-snug">{req.campaign_name}</h3>
          {req.landing_url && (
            <a href={req.landing_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5" dir="ltr">
              <ExternalLink className="h-3 w-3" />
              {(() => { try { return new URL(req.landing_url).hostname; } catch { return req.landing_url; } })()}
            </a>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(req.created_at)}</span>
      </div>

      {reasons.length > 0 && (
        <div>
          <button onClick={() => setExpanded((p) => !p)} className="flex items-center gap-1 text-xs text-purple-700 hover:text-purple-900 font-medium">
            <ChevDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "إخفاء الأسباب" : `${reasons.length} سبب للتشغيل`}
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1">
              {reasons.map((r, i) => (
                <li key={i} className="text-xs text-purple-800 bg-purple-100 rounded-lg px-3 py-1">{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-purple-200">
        <button
          onClick={() => approveMutation.mutate()}
          disabled={approveMutation.isPending || rejectMutation.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
          موافقة
        </button>
        <button
          onClick={() => rejectMutation.mutate()}
          disabled={approveMutation.isPending || rejectMutation.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50 transition-colors"
        >
          {rejectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}
          رفض
        </button>
      </div>
    </div>
  );
}

// ─── Kanban Card ──────────────────────────────────────────────────────────────
function MediaCard({ req }: { req: MediaRequest }) {
  const qc = useQueryClient();
  const statusCfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG["pending"]!;
  const priorityCfg = PRIORITY_CONFIG[req.priority] ?? PRIORITY_CONFIG["normal"]!;

  const updateMutation = useMutation({
    mutationFn: (body: object) =>
      fetch(`${API}/media-requests/${req.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media-requests"] }),
  });

  const advanceStatus = () => {
    if (statusCfg.next) updateMutation.mutate({ status: statusCfg.next });
  };

  return (
    <div className={`rounded-2xl border bg-card p-5 shadow-sm transition-all hover:shadow-md ${req.status === "done" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${priorityCfg.badge}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              {priorityCfg.label}
            </span>
            <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${statusCfg.color}`}>
              {statusCfg.label}
            </span>
          </div>
          <h3 className="font-semibold text-base leading-snug">{req.campaign_name}</h3>
          {req.landing_url && (
            <a href={req.landing_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1" dir="ltr">
              <ExternalLink className="h-3 w-3" />
              {(() => { try { return new URL(req.landing_url).hostname; } catch { return req.landing_url; } })()}
            </a>
          )}
          {req.notes && (
            <p className="text-xs text-muted-foreground mt-2 bg-muted/50 rounded-lg px-3 py-1.5 leading-relaxed line-clamp-3">
              {req.notes.split("\n")[0]}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(req.created_at))}
        </span>
        {statusCfg.next ? (
          <button
            onClick={advanceStatus}
            disabled={updateMutation.isPending}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {statusCfg.nextLabel}
          </button>
        ) : (
          <button onClick={advanceStatus} className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1">
            إعادة تفعيل
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Delete Log Section ───────────────────────────────────────────────────────
function DeleteLogSection() {
  const [open, setOpen] = useState(false);
  const { data } = useDeleteLog();
  const log = data?.log ?? [];

  if (log.length === 0) return null;

  return (
    <div className="mt-10 border-t border-border pt-8">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
      >
        <History className="h-4 w-4" />
        سجل الطلبات المرفوضة ({log.length})
        <ChevDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm" dir="rtl">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-right px-4 py-3 font-medium">الحملة</th>
                <th className="text-right px-4 py-3 font-medium">الحالة عند الرفض</th>
                <th className="text-right px-4 py-3 font-medium">الأولوية</th>
                <th className="text-right px-4 py-3 font-medium">وقت الرفض</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {log.map((entry) => {
                const prCfg = PRIORITY_CONFIG[entry.priority_at_deletion] ?? PRIORITY_CONFIG["normal"]!;
                const stCfg = STATUS_CONFIG[entry.status_at_deletion] ?? STATUS_CONFIG["pending"]!;
                return (
                  <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium max-w-xs truncate">{entry.campaign_name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${stCfg.color}`}>{stCfg.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${prCfg.badge}`}>{prCfg.label}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(entry.deleted_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Collapsible Section (for قيد المراجعة) ──────────────────────────────────
function CollapsibleSection({
  dot, label, count, hint, defaultOpen = true, children,
}: {
  dot: string; label: string; count: number; hint?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-10">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 mb-4 w-full text-right group"
      >
        <div className={`h-3 w-3 rounded-full ${dot} shrink-0`} />
        <h2 className="font-bold text-base">{label}</h2>
        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">{count}</span>
        {hint && <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">— {hint}</span>}
        <ChevDown className={`h-4 w-4 text-muted-foreground mr-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && children}
    </div>
  );
}

// ─── Collapsible Column (for Kanban columns) ──────────────────────────────────
function CollapsibleColumn({
  label, count, dot, badge, children,
}: {
  label: string; count: number; dot: string; badge: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 mb-4 w-full text-right group"
      >
        <div className={`h-3 w-3 rounded-full ${dot} shrink-0`} />
        <h2 className="font-semibold">{label}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>{count}</span>
        <ChevDown className={`h-4 w-4 text-muted-foreground mr-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MediaRequestsPage() {
  const [showModal, setShowModal] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const { data, isLoading, isError } = useMediaRequests();
  const { data: scanStatusData } = useScanStatus();
  const qc = useQueryClient();

  const scanMutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/media-requests/scan`, { method: "POST" }).then((r) => r.json()) as Promise<ScanResult>,
    onSuccess: (result) => {
      setScanResult(result);
      qc.invalidateQueries({ queryKey: ["media-requests"] });
      qc.invalidateQueries({ queryKey: ["media-scan-status"] });
    },
  });

  const lastScan = scanStatusData?.last_scan ?? null;
  const requests = data?.requests ?? [];

  const needsReview = requests.filter((r) => r.status === "needs_review");
  const pending     = requests.filter((r) => r.status === "pending");
  const inProgress  = requests.filter((r) => r.status === "in_progress");
  const done        = requests.filter((r) => r.status === "done");

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {showModal && <AddRequestModal onClose={() => setShowModal(false)} />}
      {scanResult && <ScanResultToast result={scanResult} onClose={() => setScanResult(null)} />}

      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">إدارة الإنتاج الإعلاني</div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Clapperboard className="h-8 w-8 text-primary" />
              طلبات الميديا
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">الحملات المحتاجة ميديا جديدة مع لينكات اللاندينج بيدج</p>
            {lastScan && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                آخر فحص: {formatRelativeTime(lastScan.scanned_at)}
                <span className="text-border">·</span>
                {lastScan.campaigns_checked} حملة فُحصت
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card text-sm font-medium hover:bg-muted transition-colors shadow-sm disabled:opacity-60"
            >
              {scanMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {scanMutation.isPending ? "جاري الفحص..." : "فحص تلقائي"}
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              طلب جديد
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "قيد المراجعة", count: needsReview.length, color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
            { label: "يحتاج ميديا",  count: pending.length,     color: "text-amber-600",  bg: "bg-amber-50 border-amber-200" },
            { label: "جاري التنفيذ", count: inProgress.length,  color: "text-blue-600",   bg: "bg-blue-50 border-blue-200" },
            { label: "مكتمل",        count: done.length,        color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
          ].map((s) => (
            <div key={s.label} className={`rounded-2xl border p-5 ${s.bg}`}>
              <div className={`text-3xl font-bold ${s.color}`}>{s.count}</div>
              <div className="text-sm text-muted-foreground mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin ml-2" />جاري التحميل...
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-xl p-4">
            <AlertCircle className="h-5 w-5" />فيه مشكلة في تحميل البيانات
          </div>
        )}

        {/* ── قيد المراجعة section ── */}
        {needsReview.length > 0 && (
          <CollapsibleSection
            dot="bg-purple-500"
            label="قيد المراجعة"
            count={needsReview.length}
            hint="طلبات كشفها الفحص التلقائي، وافق عليها لتنتقل للكانبان"
            defaultOpen
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {needsReview.map((r) => <ReviewCard key={r.id} req={r} />)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Kanban ── */}
        {(pending.length > 0 || inProgress.length > 0 || done.length > 0) ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: "يحتاج ميديا", items: pending,    dot: "bg-amber-500",   badge: "bg-amber-100 text-amber-700" },
              { label: "جاري التنفيذ", items: inProgress, dot: "bg-blue-500",    badge: "bg-blue-100 text-blue-700" },
              { label: "مكتمل",        items: done,       dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700" },
            ].map((col) => (
              <CollapsibleColumn key={col.label} label={col.label} count={col.items.length} dot={col.dot} badge={col.badge}>
                {col.items.map((r) => <MediaCard key={r.id} req={r} />)}
                {col.items.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-2xl">لا يوجد طلبات</div>
                )}
              </CollapsibleColumn>
            ))}
          </div>
        ) : !isLoading && needsReview.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Clapperboard className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">ما فيش طلبات ميديا دلوقتي</p>
            <p className="text-sm mt-1">اضغط "فحص تلقائي" أو "طلب جديد"</p>
          </div>
        )}

        {/* ── Delete Log ── */}
        <DeleteLogSection />

      </div>
    </div>
  );
}
