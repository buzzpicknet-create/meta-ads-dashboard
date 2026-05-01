import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, Trash2, X, MessageSquare, User } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface ChatMessage { role: "user" | "assistant"; content: string }

const GENERAL_CONTEXT = `أنت مساعد Meta Ads عام. المستخدم لم يختر حملة محددة.
أجب على أسئلته العامة عن استراتيجيات Meta Ads، تحسين الأداء، قراءة المؤشرات، وأفضل الممارسات.
إذا سأل عن أرقام محددة لحملة، اطلب منه فتح التشخيص من صفحة "تحليل الحملة" أو "تشخيص الحملات".`;

const SUGGESTED = [
  "ما هو Hook Rate المثالي؟",
  "كيف أحسّن الـ CPA؟",
  "متى أوقف الحملة؟",
  "كيف أتعامل مع Frequency عالية؟",
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
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

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
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignContext: GENERAL_CONTEXT, messages: newMessages }),
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
  }, [input, messages, streaming]);

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
                <div className="flex flex-col items-center gap-4 py-8">
                  <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[260px]">
                    اسألني أي سؤال عام عن Meta Ads وهجاوبك. لتحليل حملة معينة، افتح التشخيص من صفحة "تحليل الحملة"
                  </p>
                  <div className="grid grid-cols-2 gap-2 w-full">
                    {SUGGESTED.map((q) => (
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
