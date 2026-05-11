import { useState, useRef, useEffect, useCallback } from "react";
import { API, useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Send,
  Loader2,
  Bot,
  User,
  Zap,
  Trash2,
  CheckCircle,
  Sparkles,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  name: string;
  status: "running" | "done";
  label: string;
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
  {
    label: "📊 مقارنة الحسابات",
    prompt:
      "قارن أداء جميع حسابات الإعلانات المتاحة من حيث CPA و ROAS و CTR خلال آخر 7 أيام. أي حساب يحتاج تدخل فوري؟",
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

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3 max-w-4xl mx-auto", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
          isUser
            ? "bg-blue-600"
            : "bg-gradient-to-br from-blue-500 to-purple-600"
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>
      <div
        className={cn(
          "rounded-2xl px-4 py-3 max-w-[80%] text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-blue-600 text-white rounded-tr-sm"
            : "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700/60"
        )}
      >
        {msg.content}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolCalls]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setStreaming(true);
      setToolCalls([]);

      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }

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
                    return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                  }
                  return [...prev, { role: "assistant", content: assistantContent }];
                });
              } else if (evt.content) {
                assistantContent += evt.content;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                  }
                  return [...prev, { role: "assistant", content: assistantContent }];
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

  const greeting = user?.username
    ? `مرحباً ${user.username}! 👋`
    : "مرحباً!";

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] bg-slate-950" dir="rtl">

      {/* ── Messages Area ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* ── Empty state / Welcome ── */
          <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-6 pb-8">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-blue-900/50">
                <Zap className="w-10 h-10 text-white" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-slate-950 flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white">{greeting}</h1>
              <p className="text-slate-400 text-sm max-w-sm">
                أنا مساعدك الذكي لإعلانات Meta. يمكنني جلب بيانات حملاتك، تحليل الأداء، وتنفيذ القرارات مباشرة.
              </p>
            </div>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-3xl">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.label}
                  onClick={() => sendMessage(a.prompt)}
                  className="group text-right px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:border-blue-500/60 hover:bg-slate-800 transition-all text-sm text-slate-300 hover:text-white"
                >
                  <span className="block font-medium">{a.label}</span>
                  <span className="block text-xs text-slate-500 mt-1 line-clamp-2 group-hover:text-slate-400">
                    {a.prompt.slice(0, 60)}...
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Chat Messages ── */
          <div className="px-4 py-6 space-y-5">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}

            {/* Tool calls in progress */}
            {toolCalls.length > 0 && (
              <div className="flex gap-3 max-w-4xl mx-auto">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-slate-800 border border-slate-700/60 rounded-2xl rounded-tl-sm px-4 py-3 space-y-2">
                  {toolCalls.map((tc) => (
                    <div key={tc.id} className="flex items-center gap-2 text-xs">
                      {tc.status === "running" ? (
                        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span className={tc.status === "running" ? "text-blue-300" : "text-slate-400"}>
                        {tc.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Typing indicator */}
            {streaming && toolCalls.length === 0 && (
              <div className="flex gap-3 max-w-4xl mx-auto">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-slate-800 border border-slate-700/60 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }} />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Bottom Bar ── */}
      <div className="border-t border-slate-800 bg-slate-900/80 backdrop-blur px-4 pt-3 pb-4 space-y-2">
        {/* Quick actions strip (only when there are messages) */}
        {messages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                onClick={() => sendMessage(a.prompt)}
                disabled={streaming}
                className="shrink-0 text-xs px-3 py-1.5 rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2 items-end max-w-4xl mx-auto w-full">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              title="مسح المحادثة"
              className="h-10 w-10 shrink-0 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="اكتب سؤالك أو اطلب تحليلاً..."
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 min-h-[44px] max-h-32 leading-relaxed disabled:opacity-50 transition-all"
            style={{ height: "auto" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 128) + "px";
            }}
          />

          <Button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            className="h-11 w-11 p-0 bg-blue-600 hover:bg-blue-500 shrink-0 rounded-2xl shadow-lg disabled:opacity-40"
          >
            {streaming ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>

        <p className="text-center text-[11px] text-slate-600 max-w-4xl mx-auto">
          المساعد يمكنه الوصول لبيانات Meta Ads مباشرة وتنفيذ إجراءات على الحملات
        </p>
      </div>
    </div>
  );
}
