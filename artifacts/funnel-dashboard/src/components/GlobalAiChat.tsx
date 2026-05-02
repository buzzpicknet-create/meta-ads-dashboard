import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, Trash2, X, MessageSquare, User } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface ChatMessage { role: "user" | "assistant"; content: string }

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

const GENERAL_CONTEXT = `أنت مساعد Meta Ads عام. المستخدم لم يختر حملة محددة.
أجب على أسئلته العامة عن استراتيجيات Meta Ads، تحسين الأداء، قراءة المؤشرات، وأفضل الممارسات.
إذا سأل عن أرقام محددة لحملة، اطلب منه فتح التشخيص من صفحة "تحليل الحملة" أو "تشخيص الحملات".`;

const SUGGESTED_GENERAL = [
  "ما هو Hook Rate المثالي؟",
  "كيف أحسّن الـ CPA؟",
  "متى أوقف الحملة؟",
  "كيف أتعامل مع Frequency عالية؟",
];

const SUGGESTED_ADMIN = [
  "من أكثر شخص نشط في الفريق؟",
  "من فتح أكثر تشخيصات هذا الأسبوع؟",
  "هل الفريق شغال بانتظام؟",
  "من آخر شخص سجّل دخول؟",
];

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
      while (i < lines.length && /^[-•*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-•*]\s/, ""));
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
      while (i < lines.length && /^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/, ""));
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

export function GlobalAiChat() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const [activityUsers, setActivityUsers] = useState<ActivityUser[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Fetch activity data when admin opens the chat (once per session)
  useEffect(() => {
    if (!open || !isAdmin || activityUsers !== null) return;
    setActivityLoading(true);
    fetch(`${API}/admin/user-activity`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.users) setActivityUsers(data.users as ActivityUser[]);
      })
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, [open, isAdmin, activityUsers]);

  const buildContext = useCallback((): string => {
    if (isAdmin && activityUsers && activityUsers.length > 0) {
      return buildActivityContext(activityUsers);
    }
    return GENERAL_CONTEXT;
  }, [isAdmin, activityUsers]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setStreaming(true);
    setStreamingText("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${API}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignContext: buildContext(), messages: newMessages }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

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
  }, [input, messages, streaming, buildContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setStreaming(false);
  };

  const hasUnread = messages.length > 0;
  const suggested = SUGGESTED_GENERAL;
  const hasActivityData = isAdmin && activityUsers && activityUsers.length > 0;

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
          {/* Header */}
          <SheetHeader className="shrink-0 px-4 py-3 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <SheetTitle className="text-sm font-semibold leading-tight">مساعد الإعلانات</SheetTitle>
                  <p className="text-[10px] text-muted-foreground">أسئلة عامة عن Meta Ads</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
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

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
            <div className="flex flex-col gap-4 py-4 px-4">

              {/* Empty state */}
              {messages.length === 0 && !streaming && (
                <div className="flex flex-col items-center gap-4 py-6">
                    <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[260px]">
                    اسألني أي سؤال عن Meta Ads وهجاوبك. لتحليل حملة معينة، افتح التشخيص من صفحة "تحليل الحملة"
                  </p>
                  <div className="grid grid-cols-2 gap-2 w-full">
                    {suggested.map((q) => (
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
                    {msg.role === "user" ? msg.content : <RenderMarkdown text={msg.content} />}
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

          {/* Input */}
          <div className="shrink-0 border-t border-border/60 px-4 pt-3 pb-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1 flex items-end gap-2 rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all px-3 py-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  dir="rtl"
                  rows={1}
                  placeholder={hasActivityData ? "اسأل عن نشاط الفريق… (Enter للإرسال)" : "اسأل عن Meta Ads… (Enter للإرسال)"}
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
                  disabled={!input.trim() || streaming}
                  className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed mb-0.5"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">Shift+Enter لسطر جديد</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
