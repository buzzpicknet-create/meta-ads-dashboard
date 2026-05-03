import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, Trash2, X, MessageSquare, User, Paperclip,
  History, Plus, ChevronRight, Clock,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface ChatMessage { role: "user" | "assistant"; content: string; imagePreviewUrl?: string }

interface ConvSummary { id: number; title: string; created_at: string; updated_at: string }

interface ActivityLog {
  action: string;
  action_label: string;
  page: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

interface ActivityUser {
  id: number;
  username: string;
  role: string;
  last_seen_at: string | null;
  ad_account_id: string | null;
  recent_activity: ActivityLog[];
}

const ROLE_LABELS: Record<string, string> = {
  admin: "أدمن",
  media_buyer: "ميدياباير",
  media_manager: "ميدياكيزتر",
};

function formatRelative(dateStr: string): string {
  const now = Date.now();
  const ts = new Date(dateStr).getTime();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "أمس";
  if (diffDay < 7) return `منذ ${diffDay} أيام`;
  return new Date(dateStr).toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

function groupConversations(convs: ConvSummary[]): { label: string; items: ConvSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const week = today - 6 * 86400000;
  const month = today - 29 * 86400000;

  const groups: Record<string, ConvSummary[]> = {
    اليوم: [],
    أمس: [],
    "آخر 7 أيام": [],
    "آخر 30 يوم": [],
    أقدم: [],
  };

  for (const c of convs) {
    const t = new Date(c.updated_at).getTime();
    if (t >= today) groups["اليوم"]!.push(c);
    else if (t >= yesterday) groups["أمس"]!.push(c);
    else if (t >= week) groups["آخر 7 أيام"]!.push(c);
    else if (t >= month) groups["آخر 30 يوم"]!.push(c);
    else groups["أقدم"]!.push(c);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function buildActivityContext(users: ActivityUser[]): string {
  const lines: string[] = [
    "أنت مساعد Meta Ads ولديك وصول كامل لبيانات نشاط الفريق التالية. أجب بناءً على هذه البيانات الحقيقية.",
    "",
    "## بيانات نشاط الفريق (حقيقية من النظام):",
    "",
  ];

  for (const u of users) {
    lines.push(`### ${u.username} — ${ROLE_LABELS[u.role] ?? u.role}`);
    lines.push(`- آخر ظهور: ${u.last_seen_at ? formatRelative(u.last_seen_at) : "لم يسجّل الدخول بعد"}`);
    if (u.recent_activity.length === 0) {
      lines.push("- لا يوجد نشاط مسجّل");
    } else {
      lines.push(`- إجمالي السجلات المتاحة: ${u.recent_activity.length}`);
      lines.push("- آخر الأنشطة:");
      for (const log of u.recent_activity.slice(0, 15)) {
        let entry = `  • ${log.action_label}`;
        if (log.page) entry += ` في "${log.page}"`;
        if (log.meta?.campaign) entry += ` (حملة: ${log.meta.campaign})`;
        entry += ` — ${formatRelative(log.created_at)}`;
        lines.push(entry);
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("بناءً على هذه البيانات الحقيقية، أجب على أسئلة المستخدم عن أداء الفريق، نشاطهم، وأي تحليلات مطلوبة.");
  return lines.join("\n");
}

const GENERAL_CONTEXT = `أنت مساعد Meta Ads عام. أجب على أسئلة المستخدم عن استراتيجيات Meta Ads، تحسين الأداء، قراءة المؤشرات، وأفضل الممارسات.`;

const SUGGESTED_GENERAL = [
  "ما هو Hook Rate المثالي؟",
  "كيف أحسّن الـ CPA؟",
  "متى أوقف الحملة؟",
  "كيف أتعامل مع Frequency عالية؟",
];

const SUGGESTED_WITH_DATA = [
  "ايه أعلى حملة في CPA؟",
  "قارنلي الحملات النشطة",
  "ايه أفضل حملة أداءً؟",
  "الحملات اللي محتاجة تدخل؟",
];

interface CampaignData {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  spend: number;
  purchases: number;
  cpa: number;
  impressions: number;
  link_clicks: number;
  ctr: number;
}

function buildCampaignsContext(campaigns: CampaignData[]): string {
  if (campaigns.length === 0) return GENERAL_CONTEXT;

  const fmt = (n: number, dec = 0) =>
    n.toLocaleString("ar-EG", { maximumFractionDigits: dec });
  const fmtPct = (n: number) => `${n.toFixed(2)}%`;

  const statusMap: Record<string, string> = {
    ACTIVE: "نشطة ✅",
    PAUSED: "موقوفة ⏸",
    ARCHIVED: "مؤرشفة",
    DELETED: "محذوفة",
    CAMPAIGN_PAUSED: "موقوفة ⏸",
  };

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);
  const avgCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
  const activeCampaigns = campaigns.filter(
    (c) => c.effective_status === "ACTIVE" || c.effective_status === "CAMPAIGN_PAUSED"
  );

  const lines: string[] = [
    "أنت مساعد Meta Ads متخصص ولديك وصول كامل لبيانات الحملات الإعلانية التالية (آخر 30 يوم). أجب بناءً على هذه البيانات الحقيقية وقدّم توصيات عملية.",
    "",
    `## ملخص إجمالي (آخر 30 يوم):`,
    `- إجمالي الإنفاق: ${fmt(totalSpend)} EGP`,
    `- إجمالي الطلبات: ${fmt(totalPurchases)}`,
    `- متوسط CPA: ${avgCpa > 0 ? fmt(avgCpa) + " EGP" : "—"}`,
    `- الحملات النشطة: ${activeCampaigns.length} من ${campaigns.length}`,
    "",
    `## تفاصيل الحملات (${campaigns.length} حملة):`,
    "",
  ];

  for (const c of campaigns) {
    lines.push(`### ${c.name}`);
    lines.push(`- الحالة: ${statusMap[c.effective_status] ?? c.effective_status}`);
    lines.push(`- الإنفاق: ${fmt(c.spend)} EGP`);
    lines.push(`- الطلبات: ${fmt(c.purchases)}`);
    lines.push(`- CPA: ${c.cpa > 0 ? fmt(c.cpa) + " EGP" : "—"}`);
    lines.push(`- الانطباعات: ${fmt(c.impressions)}`);
    lines.push(`- CTR: ${fmtPct(c.ctr)}`);
    lines.push(`- الهدف: ${c.objective}`);
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "بناءً على هذه البيانات الحقيقية، أجب على أسئلة المستخدم عن الحملات، قارن أداءها، حدّد المشاكل، واقترح توصيات عملية."
  );

  return lines.join("\n");
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i} className="not-italic text-muted-foreground">{part.slice(1, -1)}</em>;
    return part;
  });
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    if (/^#{1,3}\s/.test(line)) {
      const content = line.replace(/^#{1,3}\s/, "");
      elements.push(
        <p key={i} className="font-bold text-[13px] text-foreground mt-3 mb-1 leading-snug border-b border-border/40 pb-1">
          {renderInline(content)}
        </p>
      );
      i++; continue;
    }

    if (/^[-•*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-•*]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-2 my-2">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 items-start leading-relaxed">
              <span className="shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full bg-primary/70" />
              <span className="flex-1 text-[13px] text-foreground/90">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/.test(line)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && /^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-2 my-2">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 items-start leading-relaxed">
              <span className="shrink-0 min-w-[22px] h-[22px] rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center mt-[1px]">
                {j + num}
              </span>
              <span className="flex-1 text-[13px] text-foreground/90 pt-0.5">{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      num += items.length;
      continue;
    }

    elements.push(
      <p key={i} className="text-[13px] text-foreground/90 leading-[1.7]">{renderInline(line)}</p>
    );
    i++;
  }
  return <div className="space-y-1.5">{elements}</div>;
}

interface Attachment {
  base64?: string;
  mimeType?: string;
  previewUrl?: string;
  text?: string;
  name: string;
  isImage: boolean;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES  = ["text/plain", "text/csv", "application/json"];

function readFileAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const isImage = IMAGE_TYPES.includes(file.type);
    const isText  = TEXT_TYPES.includes(file.type) || file.name.endsWith(".txt") || file.name.endsWith(".csv");
    if (!isImage && !isText) { reject(new Error("نوع الملف غير مدعوم")); return; }
    const reader = new FileReader();
    if (isImage) {
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        resolve({ base64: dataUrl.split(",")[1] ?? "", mimeType: file.type, previewUrl: dataUrl, name: file.name, isImage: true });
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = (e) => { resolve({ text: e.target?.result as string, name: file.name, isImage: false }); };
      reader.readAsText(file);
    }
    reader.onerror = () => reject(new Error("فشل قراءة الملف"));
  });
}

type View = "chat" | "history";

export function GlobalAiChat() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [activityUsers, setActivityUsers] = useState<ActivityUser[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  const [campaignsCtx, setCampaignsCtx] = useState<string | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (open && view === "chat") setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, view]);

  // Fetch activity data when admin opens the chat (once per session)
  useEffect(() => {
    if (!open || !isAdmin || activityUsers !== null) return;
    setActivityLoading(true);
    fetch(`${API}/admin/user-activity`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.users) setActivityUsers(data.users as ActivityUser[]); })
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, [open, isAdmin, activityUsers]);

  // Fetch campaigns context when chat opens (once per session, for all users)
  useEffect(() => {
    if (!open || campaignsCtx !== null || campaignsLoading) return;
    setCampaignsLoading(true);

    const until = new Date();
    const since = new Date(until);
    since.setDate(since.getDate() - 30);
    const fmtDate = (d: Date) => d.toISOString().split("T")[0]!;

    fetch(`${API}/meta/accounts`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        const accounts: { id: string }[] = data?.accounts ?? [];
        if (accounts.length === 0) {
          setCampaignsCtx(GENERAL_CONTEXT);
          return;
        }
        const allCampaigns: CampaignData[] = [];
        for (const acc of accounts) {
          try {
            const r = await fetch(
              `${API}/meta/campaigns?ad_account_id=${acc.id}&since=${fmtDate(since)}&until=${fmtDate(until)}`,
              { credentials: "include" }
            );
            if (r.ok) {
              const d = await r.json() as { campaigns?: CampaignData[] };
              if (d.campaigns) allCampaigns.push(...d.campaigns);
            }
          } catch {}
        }
        setCampaignsCtx(buildCampaignsContext(allCampaigns));
      })
      .catch(() => { setCampaignsCtx(GENERAL_CONTEXT); })
      .finally(() => setCampaignsLoading(false));
  }, [open, campaignsCtx, campaignsLoading]);

  // Load conversation list when chat opens (or when switching to history view)
  const loadConversations = useCallback(() => {
    setConvLoading(true);
    fetch(`${API}/chat/conversations`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((data) => setConversations(data.conversations ?? []))
      .catch(() => {})
      .finally(() => setConvLoading(false));
  }, []);

  useEffect(() => {
    if (open) loadConversations();
  }, [open, loadConversations]);

  const buildContext = useCallback((): string => {
    if (isAdmin && activityUsers && activityUsers.length > 0) {
      return buildActivityContext(activityUsers);
    }
    return campaignsCtx ?? GENERAL_CONTEXT;
  }, [isAdmin, activityUsers, campaignsCtx]);

  // Ensure there is an active conversation, creating one if needed
  const ensureConversation = useCallback(async (firstMessage: string): Promise<number> => {
    if (convId !== null) return convId;
    const title = firstMessage.slice(0, 80) || "محادثة جديدة";
    const resp = await fetch(`${API}/chat/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title }),
    });
    const conv = await resp.json() as ConvSummary;
    setConvId(conv.id);
    setConversations((prev) => [conv, ...prev]);
    return conv.id;
  }, [convId]);

  // Save a pair of messages to DB
  const saveToDB = useCallback(async (cid: number, userContent: string, assistantContent: string) => {
    try {
      await fetch(`${API}/chat/conversations/${cid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: [
            { role: "user", content: userContent },
            { role: "assistant", content: assistantContent },
          ],
        }),
      });
      // Refresh conversation list order
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === cid);
        if (idx < 0) return prev;
        const updated = { ...prev[idx]!, updated_at: new Date().toISOString() };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    } catch {}
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !attachment) || streaming) return;
    const userText = text || (attachment?.isImage ? "[صورة مرفقة]" : `📎 ${attachment?.name}`);
    setInput("");
    const att = attachment;
    setAttachment(null);
    const newMsg: ChatMessage = { role: "user", content: userText };
    if (att?.isImage && att.previewUrl) newMsg.imagePreviewUrl = att.previewUrl;
    const newMessages: ChatMessage[] = [...messages, newMsg];
    setMessages(newMessages);
    setStreaming(true);
    setStreamingText("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let accumulated = "";

    try {
      const activeCid = await ensureConversation(userText);

      const body: Record<string, unknown> = { campaignContext: buildContext(), messages: newMessages };
      if (att?.isImage) { body.imageBase64 = att.base64; body.imageMimeType = att.mimeType; }
      if (att?.text)    { body.fileText = att.text; body.fileName = att.name; }

      const resp = await fetch(`${API}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        credentials: "include",
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.done) break;
            if (data.content) { accumulated += data.content; setStreamingText(accumulated); }
          } catch {}
        }
      }

      setMessages((prev) => [...prev, { role: "assistant", content: accumulated }]);

      // Save to DB in background
      void saveToDB(activeCid, userText, accumulated);

    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setMessages((prev) => [...prev, { role: "assistant", content: "❌ حصل خطأ. حاول تاني." }]);
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, messages, streaming, buildContext, ensureConversation, saveToDB, attachment]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setAttachment(await readFileAsAttachment(file)); } catch (err) { alert(err instanceof Error ? err.message : "خطأ"); }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    try { setAttachment(await readFileAsAttachment(file)); } catch {}
  }, []);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setStreaming(false);
    setAttachment(null);
    setConvId(null);
    setView("chat");
  }, []);

  const clearCurrentChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setStreaming(false);
    setAttachment(null);
    setConvId(null);
  }, []);

  const loadConversation = useCallback(async (conv: ConvSummary) => {
    setConvLoading(true);
    try {
      const resp = await fetch(`${API}/chat/conversations/${conv.id}/messages`, { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json() as { messages: { role: string; content: string }[] };
      const loaded: ChatMessage[] = (data.messages ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      setMessages(loaded);
      setConvId(conv.id);
      setView("chat");
    } catch {}
    finally { setConvLoading(false); }
  }, []);

  const deleteConversation = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await fetch(`${API}/chat/conversations/${id}`, { method: "DELETE", credentials: "include" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (convId === id) { setMessages([]); setConvId(null); }
    } catch {}
    finally { setDeletingId(null); }
  }, [convId]);

  const hasUnread = messages.length > 0;
  const grouped = groupConversations(conversations);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-50 h-13 w-13 rounded-2xl bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 hover:scale-105 transition-all flex items-center justify-center group"
        title="مساعد الإعلانات"
        style={{ height: 52, width: 52 }}
      >
        <MessageSquare className="h-5 w-5" />
        {hasUnread && (
          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background" />
        )}
      </button>

      {/* Chat Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-full sm:w-[420px] p-0 flex flex-col" dir="rtl">

          {/* ── Header ── */}
          <SheetHeader className="shrink-0 px-4 py-3 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {view === "history" ? (
                  <button
                    onClick={() => setView("chat")}
                    className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                    title="رجوع للمحادثة"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                )}
                <div>
                  <SheetTitle className="text-sm font-semibold leading-tight">
                    {view === "history" ? "المحادثات السابقة" : "مساعد الإعلانات"}
                  </SheetTitle>
                  <p className="text-[10px] text-muted-foreground">
                    {view === "history"
                      ? `${conversations.length} محادثة محفوظة`
                      : "أسئلة عامة عن Meta Ads"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* New chat */}
                {view === "chat" && (
                  <button
                    onClick={startNewChat}
                    className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                    title="محادثة جديدة"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
                {/* History toggle */}
                <button
                  onClick={() => setView((v) => v === "history" ? "chat" : "history")}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all ${
                    view === "history"
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                  }`}
                  title="المحادثات السابقة"
                >
                  <History className="h-4 w-4" />
                </button>
                {/* Clear current chat */}
                {view === "chat" && messages.length > 0 && (
                  <button
                    onClick={clearCurrentChat}
                    className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                    title="مسح المحادثة"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </SheetHeader>

          {/* ── History View ── */}
          {view === "history" ? (
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
              {/* New conversation shortcut */}
              <div className="px-3 pt-3 pb-1">
                <button
                  onClick={startNewChat}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 transition-colors text-sm font-medium"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>محادثة جديدة</span>
                </button>
              </div>

              {convLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((k) => (
                      <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k * 140}ms` }} />
                    ))}
                  </div>
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                    <Clock className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">لا توجد محادثات محفوظة بعد</p>
                  <p className="text-xs text-muted-foreground/60">ابدأ محادثة جديدة وسيتم حفظها تلقائياً</p>
                </div>
              ) : (
                <div className="px-3 pb-4">
                  {grouped.map(({ label, items }) => (
                    <div key={label}>
                      <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-4 pb-1.5">
                        {label}
                      </p>
                      <div className="space-y-0.5">
                        {items.map((conv) => (
                          <div
                            key={conv.id}
                            onClick={() => loadConversation(conv)}
                            className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                              convId === conv.id
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted/60"
                            }`}
                          >
                            <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${convId === conv.id ? "text-primary" : "text-muted-foreground"}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] truncate leading-tight">
                                {conv.title}
                              </p>
                              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                {formatRelative(conv.updated_at)}
                              </p>
                            </div>
                            <button
                              onClick={(e) => deleteConversation(conv.id, e)}
                              disabled={deletingId === conv.id}
                              className="shrink-0 opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-30"
                              title="حذف المحادثة"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* ── Chat View ── */}
              <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                <div className="flex flex-col gap-4 py-4 px-4">

                  {/* Empty state */}
                  {messages.length === 0 && !streaming && (
                    <div className="flex flex-col items-center gap-4 py-6">
                      {campaignsLoading ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1.5">
                            {[0, 1, 2].map((k) => (
                              <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k * 140}ms` }} />
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">جاري تحميل بيانات الحملات…</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[260px]">
                          {campaignsCtx && campaignsCtx !== GENERAL_CONTEXT
                            ? "عندي بيانات حملاتك — اسألني أي سؤال عنها"
                            : "اسألني أي سؤال عن Meta Ads وهجاوبك"}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2 w-full">
                        {(campaignsCtx && campaignsCtx !== GENERAL_CONTEXT
                          ? SUGGESTED_WITH_DATA
                          : SUGGESTED_GENERAL
                        ).map((q) => (
                          <button
                            key={q}
                            onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                            className="text-xs text-end px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-muted/60 hover:border-primary/30 transition-all leading-snug text-foreground/80"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Message bubbles */}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"} items-end`}>
                      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mb-0.5 ${
                        msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted border border-border/60"
                      }`}>
                        {msg.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-primary" />}
                      </div>
                      <div
                        className={`min-w-0 rounded-2xl break-words overflow-hidden ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-sm px-4 py-2.5 text-[13px] leading-relaxed"
                            : "bg-card border border-border/60 shadow-sm rounded-bl-sm px-4 py-3"
                        }`}
                        style={{ maxWidth: "85%", wordBreak: "break-word", overflowWrap: "anywhere" }}
                        dir="rtl"
                      >
                        {msg.imagePreviewUrl && (
                          <img
                            src={msg.imagePreviewUrl}
                            alt="مرفق"
                            className="max-w-full rounded-xl mb-2 cursor-zoom-in border border-white/20"
                            style={{ maxHeight: 220 }}
                            onClick={() => window.open(msg.imagePreviewUrl, "_blank")}
                          />
                        )}
                        {msg.role === "user"
                          ? msg.content && <span>{msg.content}</span>
                          : <RenderMarkdown text={msg.content} />}
                      </div>
                    </div>
                  ))}

                  {/* Streaming */}
                  {streaming && streamingText && (
                    <div className="flex gap-2.5 flex-row items-end">
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mb-0.5 bg-muted border border-border/60">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div
                        className="min-w-0 rounded-2xl rounded-bl-sm bg-card border border-border/60 shadow-sm px-4 py-3 break-words overflow-hidden"
                        style={{ maxWidth: "85%", wordBreak: "break-word", overflowWrap: "anywhere" }}
                        dir="rtl"
                      >
                        <RenderMarkdown text={streamingText} />
                        <span className="inline-block w-[3px] h-[14px] bg-primary/70 animate-pulse rounded-full align-middle ms-0.5" />
                      </div>
                    </div>
                  )}

                  {streaming && !streamingText && (
                    <div className="flex gap-2.5 flex-row items-end">
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mb-0.5 bg-muted border border-border/60">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex items-center gap-1.5 px-4 py-3.5 rounded-2xl rounded-bl-sm bg-card border border-border/60 shadow-sm">
                        {[0, 1, 2].map((k) => (
                          <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k * 140}ms` }} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>
              </div>

              {/* ── Input ── */}
              <div className="shrink-0 border-t border-border/60 px-4 pt-3 pb-4">
                {attachment && (
                  <div className="mb-2 flex items-center gap-2">
                    {attachment.isImage && attachment.previewUrl ? (
                      <div className="relative inline-flex">
                        <img src={attachment.previewUrl} alt={attachment.name} className="h-16 w-auto max-w-[120px] rounded-lg border border-border object-cover" />
                        <button onClick={() => setAttachment(null)} className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="max-w-[200px] truncate">{attachment.name}</span>
                        <button onClick={() => setAttachment(null)} className="text-muted-foreground hover:text-destructive mr-1">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 items-end">
                  <div className="flex-1 flex items-end gap-2 rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all px-3 py-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,text/plain,text/csv,application/json,.txt,.csv,.json"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={streaming}
                      className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 mb-0.5"
                      title="إرفاق صورة أو ملف"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </button>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      dir="rtl"
                      rows={1}
                      placeholder="اسأل عن Meta Ads… (Enter للإرسال)"
                      disabled={streaming}
                      className="flex-1 resize-none bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 leading-relaxed"
                      style={{ maxHeight: "100px", overflowY: "auto" }}
                      onInput={(e) => {
                        const t = e.currentTarget;
                        t.style.height = "auto";
                        t.style.height = Math.min(t.scrollHeight, 100) + "px";
                      }}
                    />
                    <button
                      onClick={send}
                      disabled={(!input.trim() && !attachment) || streaming}
                      className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed mb-0.5"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">Shift+Enter لسطر جديد</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
