import { useState, useRef, useEffect, useCallback } from "react";
import { API } from "@/context/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Bot,
  User,
  Zap,
  ChevronDown,
  Trash2,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  actionCard?: ActionCard;
}

interface ToolCall {
  id: string;
  name: string;
  status: "running" | "done";
  label: string;
}

interface ActionCard {
  type: string;
  label: string;
  prompt: string;
  executed?: boolean;
  cancelled?: boolean;
}

const QUICK_ACTIONS = [
  {
    label: "☕ التقرير الصباحي",
    prompt:
      "اسحب داتا كل الحملات النشطة لليوم وقارنها بمتوسط بيانات آخر 7 أيام. أعطني ملخصاً سريعاً: ما هي الحملات الرابحة وما هي الحملات التي تتخطى الـ CPA المستهدف؟ ارسم جدول مقارنة يعتمد على الـ CPA.",
  },
  {
    label: "🚀 فرص الـ Scale",
    prompt:
      "حلل الحملات النشطة بناءً على أداء آخر 7 أيام، وحدد الـ Adsets التي تحقق CPA أقل من المستهدف ومستقرة. جهّز لي مقترحات لزيادة ميزانيتها 20%.",
  },
  {
    label: "🔬 تشخيص الـ Funnel",
    prompt:
      "افحص مسار المبيعات لكل الإعلانات النشطة. استخرج الإعلانات التي تمتلك Hook Rate ممتاز لكن CVR أو CTR ضعيفة. حدد أين الخلل بالضبط.",
  },
  {
    label: "📉 تشخيص الخسائر",
    prompt:
      "استخرج أي إعلان أو Adset تخطى تكلفة الشراء المستهدفة بشكل ملحوظ. حلل أسباب التراجع واعرضهم في جدول مع مقترحات تقليل الميزانية.",
  },
  {
    label: "🕵️ تقييم التعديلات",
    prompt:
      "ابحث عن الحملات التي أجرينا عليها تعديلات مؤخراً. قارن أداءها قبل وبعد التعديل. هل نجح الإجراء؟",
  },
];

const TOOL_LABELS: Record<string, string> = {
  get_campaigns: "جلب بيانات الحملات من Meta...",
  get_campaign_daily: "جلب الأداء اليومي للحملة...",
  get_account_daily: "جلب الأداء اليومي للحساب...",
  get_adsets: "جلب المجموعات الإعلانية...",
  get_ad_performance: "تحليل أداء الإعلان...",
  get_ads_in_adset: "جلب إعلانات المجموعة...",
  get_campaign_status: "جلب حالة الحملة...",
  get_adset_status: "جلب حالة المجموعة الإعلانية...",
  pause_campaign: "إيقاف الحملة...",
  pause_adset: "إيقاف المجموعة الإعلانية...",
  update_budget: "تحديث الميزانية...",
};

function detectActionCard(content: string): ActionCard | null {
  const patterns = [
    { regex: /إيقاف.*?(?:حملة|adset|مجموعة)[^\n]*/i, type: "pause" },
    { regex: /زيادة.*?ميزانية[^\n]*/i, type: "scale_up" },
    { regex: /تقليل.*?ميزانية[^\n]*/i, type: "scale_down" },
  ];
  for (const p of patterns) {
    const m = content.match(p.regex);
    if (m) {
      return { type: p.type, label: m[0], prompt: "" };
    }
  }
  return null;
}

export function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolCalls]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setStreaming(true);
      setToolCalls([]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let assistantContent = "";
      const activeTool: ToolCall[] = [];

      try {
        const res = await fetch(`${API}/ai/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: ctrl.signal,
          body: JSON.stringify({ messages: history }),
        });

        if (!res.body) throw new Error("No stream");

        const reader = res.body.getReader();
        const dec = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = dec.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;

            try {
              const evt = JSON.parse(raw);

              if (evt.type === "tool_call_start") {
                const tc: ToolCall = {
                  id: evt.id ?? Math.random().toString(),
                  name: evt.name,
                  status: "running",
                  label: TOOL_LABELS[evt.name] ?? `تنفيذ ${evt.name}...`,
                };
                activeTool.push(tc);
                setToolCalls([...activeTool]);
              } else if (evt.type === "tool_call_end") {
                const tc = activeTool.find((t) => t.id === evt.id || t.name === evt.name);
                if (tc) tc.status = "done";
                setToolCalls([...activeTool]);
              } else if (evt.type === "delta" && evt.content) {
                assistantContent += evt.content;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [
                      ...prev.slice(0, -1),
                      { ...last, content: assistantContent },
                    ];
                  }
                  return [
                    ...prev,
                    { role: "assistant", content: assistantContent },
                  ];
                });
              } else if (evt.content) {
                assistantContent += evt.content;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [
                      ...prev.slice(0, -1),
                      { ...last, content: assistantContent },
                    ];
                  }
                  return [
                    ...prev,
                    { role: "assistant", content: assistantContent },
                  ];
                });
              }
            } catch {
              // non-JSON line
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "حدث خطأ في الاتصال. حاول مرة أخرى." },
          ]);
        }
      } finally {
        setStreaming(false);
        setToolCalls([]);
        abortRef.current = null;
      }
    },
    [messages, streaming]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-900/40 flex items-center justify-center transition-all hover:scale-110",
          open && "hidden"
        )}
        title="مساعد الإعلانات"
      >
        <Zap className="w-6 h-6 text-white" />
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full text-[10px] flex items-center justify-center text-white font-bold">
            {messages.filter((m) => m.role === "assistant").length}
          </span>
        )}
      </button>

      {/* Chat Panel */}
      {open && (
        <div
          className="fixed bottom-4 left-4 z-50 w-[420px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-4rem)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-l from-blue-900/40 to-purple-900/40 border-b border-slate-700">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">مساعد الإعلانات</p>
              <p className="text-xs text-slate-400">Meta Ads AI Agent</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMessages([])}
                className="h-7 w-7 p-0 text-slate-500 hover:text-slate-300"
                title="مسح المحادثة"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                className="h-7 w-7 p-0 text-slate-500 hover:text-slate-300"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-3 py-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
                <Bot className="w-10 h-10 text-slate-600" />
                <div>
                  <p className="text-sm font-medium text-slate-300">
                    مرحباً! أنا مساعدك الذكي
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    اسألني عن أداء حملاتك أو اضغط على أحد الأزرار السريعة
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2 text-sm",
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      msg.role === "user"
                        ? "bg-blue-600"
                        : "bg-gradient-to-br from-blue-500 to-purple-600"
                    )}
                  >
                    {msg.role === "user" ? (
                      <User className="w-3.5 h-3.5 text-white" />
                    ) : (
                      <Bot className="w-3.5 h-3.5 text-white" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "rounded-xl px-3 py-2 max-w-[85%] whitespace-pre-wrap leading-relaxed",
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-100"
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Tool calls in progress */}
              {toolCalls.length > 0 && (
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-slate-800 rounded-xl px-3 py-2 space-y-1.5">
                    {toolCalls.map((tc) => (
                      <div key={tc.id} className="flex items-center gap-2 text-xs">
                        {tc.status === "running" ? (
                          <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
                        ) : (
                          <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                        )}
                        <span
                          className={cn(
                            tc.status === "running"
                              ? "text-blue-300"
                              : "text-slate-400"
                          )}
                        >
                          {tc.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {streaming && toolCalls.length === 0 && (
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-slate-800 rounded-xl px-3 py-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                      <span
                        className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.15s" }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.3s" }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div ref={bottomRef} />
          </ScrollArea>

          {/* Quick Actions */}
          <div className="px-3 py-2 border-t border-slate-800">
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.label}
                  onClick={() => sendMessage(a.prompt)}
                  disabled={streaming}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition-all disabled:opacity-50"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="px-3 pb-3 flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اكتب سؤالك..."
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[40px] max-h-24 leading-relaxed disabled:opacity-50"
              style={{ height: "auto" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 96) + "px";
              }}
            />
            <Button
              size="sm"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming}
              className="h-10 w-10 p-0 bg-blue-600 hover:bg-blue-500 shrink-0 rounded-xl"
            >
              {streaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
