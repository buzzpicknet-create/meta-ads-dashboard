import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, Trash2, X, MessageSquare, User, Paperclip,
  History, Plus, ChevronRight, ChevronDown, Minimize2, Maximize2,
  Loader2, CheckCircle2, Brain, Search, Clock, BarChart2,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface UserLtmData {
  target_kpis: Record<string, number | null>;
  strategic_rules: string[];
  historical_insights: string;
  updated_at?: string | null;
}

const LTM_KPI_DEFS = [
  { key: "target_cpc",   label: "CPC المستهدف",            unit: "$",  placeholder: "1.50" },
  { key: "target_ctr",   label: "CTR المستهدف",             unit: "%",  placeholder: "5.0"  },
  { key: "target_cpa",   label: "CPA المستهدف",             unit: "$",  placeholder: "30"   },
  { key: "target_roas",  label: "ROAS المستهدف",            unit: "×",  placeholder: "4.0"  },
  { key: "target_qs",    label: "Quality Score المستهدف",   unit: "/10",placeholder: "7"    },
] as const;

const QUICK_ACTIONS = [
  { label: "☕ التقرير الصباحي",   prompt: "أعطني ملخصاً سريعاً لأداء حملات Google Ads اليوم: الإنفاق، النقرات، CPC، CTR، ROAS، وأي حملات تحتاج انتباهاً فورياً." },
  { label: "📈 فرص الـ Scale",     prompt: "حلل الحملات ذات الـ ROAS العالي وQuality Score الجيد. ما هي الـ Ad Groups التي يمكن رفع ميزانيتها لزيادة الأرباح؟" },
  { label: "🔬 تشخيص Quality Score", prompt: "افحص Quality Score لكل الكلمات المفتاحية النشطة. حدد الكلمات ذات الـ QS المنخفض وأسبابها (Ad Relevance / Landing Page / Expected CTR)." },
  { label: "📉 تقليل الـ CPC",     prompt: "ما هي أفضل استراتيجيات تقليل تكلفة النقرة (CPC) مع الحفاظ على جودة الحركة؟ حلل بنية الـ Ad Groups والـ Match Types." },
  { label: "🕵️ تقييم Impression Share", prompt: "ما هو Impression Share لكل حملة؟ حدد الحملات التي تفقد حصة الظهور بسبب الميزانية مقابل الجودة." },
] as const;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imagePreviewUrl?: string;
  tool_calls?: string[];
}
interface ConvSummary {
  id: number;
  title: string;
  snippet?: string | null;
  created_at: string;
  updated_at: string;
}

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
    اليوم: [], أمس: [], "آخر 7 أيام": [], "آخر 30 يوم": [], أقدم: [],
  };
  for (const c of convs) {
    const t = new Date(c.updated_at).getTime();
    if (t >= today) groups["اليوم"]!.push(c);
    else if (t >= yesterday) groups["أمس"]!.push(c);
    else if (t >= week) groups["آخر 7 أيام"]!.push(c);
    else if (t >= month) groups["آخر 30 يوم"]!.push(c);
    else groups["أقدم"]!.push(c);
  }
  return Object.entries(groups).filter(([, items]) => items.length > 0).map(([label, items]) => ({ label, items }));
}

const CHART_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899"];

interface ChartSpec {
  type: "bar" | "line" | "multibar";
  title?: string;
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  data: Record<string, string | number>[];
  unit?: string;
}

function ChartBlock({ spec }: { spec: ChartSpec }) {
  const fmt = (v: unknown) => typeof v === "number" ? v.toLocaleString("ar-EG") : String(v ?? "");
  const unit = spec.unit ?? "";
  return (
    <div className="my-3 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
      {spec.title && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/30">
          <BarChart2 className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-[13px] font-semibold text-foreground">{spec.title}</span>
        </div>
      )}
      <div className="px-2 py-3" dir="ltr">
        <ResponsiveContainer width="100%" height={220}>
          {spec.type === "line" ? (
            <LineChart data={spec.data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}${unit}`} width={48} />
              <Tooltip formatter={(v: unknown) => [`${fmt(v)}${unit}`, ""]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {spec.series.map((s, idx) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color ?? CHART_COLORS[idx % CHART_COLORS.length]}
                  strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={spec.data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}${unit}`} width={48} />
              <Tooltip formatter={(v: unknown) => [`${fmt(v)}${unit}`, ""]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {spec.series.map((s, idx) =>
                spec.series.length === 1 ? (
                  <Bar key={s.key} dataKey={s.key} name={s.label} radius={[4, 4, 0, 0]} maxBarSize={48}>
                    {spec.data.map((_, di) => (
                      <Cell key={di} fill={CHART_COLORS[di % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                ) : (
                  <Bar key={s.key} dataKey={s.key} name={s.label}
                    fill={s.color ?? CHART_COLORS[idx % CHART_COLORS.length]}
                    radius={[4, 4, 0, 0]} maxBarSize={32} />
                )
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i} className="italic text-foreground/80">{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="font-mono text-[12px] bg-muted/70 text-primary px-1.5 py-0.5 rounded-md border border-border/50">{part.slice(1, -1)}</code>;
    return part;
  });
}

function parseTableRow(line: string): string[] {
  return line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") { i++; continue; }
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim().toLowerCase();
      const isChart = lang === "json chart" || lang === "chart" || lang === "json-chart";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) { codeLines.push(lines[i]!); i++; }
      i++;
      const raw = codeLines.join("\n");
      if (isChart) {
        try {
          const spec = JSON.parse(raw) as ChartSpec;
          elements.push(<ChartBlock key={`chart-${i}`} spec={spec} />);
        } catch {
          elements.push(<div key={`code-${i}`} className="my-3 rounded-xl overflow-hidden border border-border/60 bg-muted/40"><pre className="p-3 overflow-x-auto text-[12px] font-mono text-foreground/85 leading-relaxed whitespace-pre" dir="ltr">{raw}</pre></div>);
        }
      } else {
        elements.push(
          <div key={`code-${i}`} className="my-3 rounded-xl overflow-hidden border border-border/60 bg-muted/40">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border-b border-border/40">
              <div className="flex gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400/60" /><span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" /><span className="w-2.5 h-2.5 rounded-full bg-green-400/60" /></div>
              <span className="text-[10px] text-muted-foreground/60 font-mono">{lang || "code"}</span>
            </div>
            <pre className="p-3 overflow-x-auto text-[12px] font-mono text-foreground/85 leading-relaxed whitespace-pre" dir="ltr">{raw}</pre>
          </div>
        );
      }
      continue;
    }
    if (/^---+$/.test(line.trim())) { elements.push(<hr key={i} className="my-3 border-border/40" />); i++; continue; }
    if (/^#{1,3}\s/.test(line)) {
      const level = (line.match(/^(#{1,3})/)?.[1].length ?? 1);
      const content = line.replace(/^#{1,3}\s/, "");
      const sizeClass = level === 1 ? "text-base" : level === 2 ? "text-[14px]" : "text-[13px]";
      elements.push(<p key={i} className={`font-bold ${sizeClass} text-foreground mt-4 mb-1.5 leading-snug border-b border-border/40 pb-1.5`}>{renderInline(content)}</p>);
      i++; continue;
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[-| :]+\|/.test(lines[i + 1]!)) {
      const headers = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) { rows.push(parseTableRow(lines[i]!)); i++; }
      elements.push(
        <div key={`tbl-${i}`} className="my-3 overflow-x-auto rounded-xl border border-border/60 shadow-sm">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-muted/50">
              <tr>{headers.map((h, hi) => <th key={hi} className="px-3 py-2 text-right font-semibold text-foreground/80 border-b border-border/40 whitespace-nowrap">{renderInline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  {row.map((cell, ci) => <td key={ci} className="px-3 py-2 text-right text-foreground/80 border-b border-border/20 whitespace-nowrap">{renderInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^[-*]\s/, "")); i++; }
      elements.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1.5 pe-4">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start gap-2 text-[13.5px] leading-relaxed text-foreground/85">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\d+\.\s/, "")); i++; num++; }
      elements.push(
        <ol key={`ol-${i}`} className="my-2 space-y-1.5 pe-4">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start gap-2 text-[13.5px] leading-relaxed text-foreground/85">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center mt-0.5">{ii + 1}</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }
    if (line.startsWith(">")) {
      elements.push(
        <div key={i} className="my-2 border-r-4 border-primary/40 bg-primary/5 rounded-lg px-4 py-2.5">
          <p className="text-[13.5px] text-foreground/85 leading-relaxed">{renderInline(line.replace(/^>\s?/, ""))}</p>
        </div>
      );
      i++; continue;
    }
    elements.push(<p key={i} className="text-[13.5px] leading-relaxed text-foreground/90 my-1">{renderInline(line)}</p>);
    i++;
  }
  return <div className="space-y-0.5">{elements}</div>;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">{part}</mark>
      : part
  );
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "application/pdf", "text/plain", "text/csv"];

interface Attachment {
  name: string;
  mimeType: string;
  base64: string;
  previewUrl?: string;
}

async function readFileAsAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_SIZE) throw new Error("حجم الملف يتجاوز 10MB");
  const allowed = ALLOWED_TYPES.some(t => t === file.type || (t.endsWith("/*") && file.type.startsWith(t.split("/")[0]!)));
  if (!allowed) throw new Error("نوع الملف غير مدعوم");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      resolve({ name: file.name, mimeType: file.type, base64, previewUrl: file.type.startsWith("image/") ? dataUrl : undefined });
    };
    reader.onerror = () => reject(new Error("فشل قراءة الملف"));
    reader.readAsDataURL(file);
  });
}

interface Props {
  onRegisterOpenFn?: (fn: () => void) => void;
}

export default function GoogleAdsAiChat({ onRegisterOpenFn }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<"chat" | "history" | "memory">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [searching, setSearching] = useState(false);
  const [toolCallLabels, setToolCallLabels] = useState<string[]>([]);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});

  const [convId, setConvId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historySearchResults, setHistorySearchResults] = useState<ConvSummary[] | null>(null);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);

  const [ltmData, setLtmData] = useState<UserLtmData | null>(null);
  const [ltmLoading, setLtmLoading] = useState(false);
  const [ltmSaving, setLtmSaving] = useState(false);
  const [ltmDirty, setLtmDirty] = useState(false);
  const [ltmEditKpis, setLtmEditKpis] = useState<Record<string, string>>({});
  const [ltmEditRules, setLtmEditRules] = useState<string[]>([]);
  const [ltmEditInsights, setLtmEditInsights] = useState("");
  const [ltmNewRule, setLtmNewRule] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const convIdRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { convIdRef.current = convId; }, [convId]);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (view === "history" && open) void loadConversations();
  }, [view, open]);

  useEffect(() => {
    if (!historySearch.trim()) { setHistorySearchResults(null); return; }
    const tid = setTimeout(async () => {
      setHistorySearchLoading(true);
      try {
        const r = await fetch(`${API}/chat/conversations/search?q=${encodeURIComponent(historySearch)}&app=google_ads`, { credentials: "include" });
        if (!r.ok) return;
        const data = await r.json() as { conversations: ConvSummary[] };
        setHistorySearchResults(data.conversations ?? []);
      } catch {} finally { setHistorySearchLoading(false); }
    }, 350);
    return () => clearTimeout(tid);
  }, [historySearch]);

  const openToConversation = useCallback(() => {
    setOpen(true);
    setCollapsed(false);
    setView("chat");
  }, []);

  useEffect(() => { onRegisterOpenFn?.(openToConversation); }, [onRegisterOpenFn, openToConversation]);

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    try {
      const r = await fetch(`${API}/chat/conversations?app=google_ads`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json() as { conversations: ConvSummary[] };
      setConversations(data.conversations ?? []);
    } catch {} finally { setConvLoading(false); }
  }, []);

  const ensureConversation = useCallback(async (firstUserMsg: string): Promise<number> => {
    if (convIdRef.current !== null) return convIdRef.current;
    const title = firstUserMsg.slice(0, 60);
    const r = await fetch(`${API}/chat/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title, app: "google_ads" }),
    });
    if (!r.ok) throw new Error("Failed to create conversation");
    const data = await r.json() as { id: number };
    setConvId(data.id);
    return data.id;
  }, []);

  const saveToDB = useCallback(async (cid: number, userText: string, assistantText: string, toolCalls?: string[]) => {
    try {
      await fetch(`${API}/chat/conversations/${cid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userMessage: userText, assistantMessage: assistantText, toolCalls }),
      });
    } catch {}
  }, []);

  const send = useCallback(async (overrideInput?: string) => {
    const userText = (overrideInput ?? input).trim();
    if (!userText && !attachment) return;
    if (streaming) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: userText,
      ...(attachment?.previewUrl ? { imagePreviewUrl: attachment.previewUrl } : {}),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    setSearching(false);
    setToolCallLabels([]);
    setExpandedSources({});

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timeoutId = setTimeout(() => { ctrl.abort(); abortRef.current = null; }, 90000);

    const contextMessages = newMessages.map((m) => ({ role: m.role, content: m.content }));
    let activeCid: number;
    try {
      activeCid = await ensureConversation(userText || attachment?.name || "مرفق");
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "❌ حصل خطأ في إنشاء المحادثة." }]);
      setStreaming(false);
      clearTimeout(timeoutId);
      return;
    }

    try {
      const body: Record<string, unknown> = { messages: contextMessages };
      if (attachment) body.attachment = { name: attachment.name, mimeType: attachment.mimeType, base64: attachment.base64 };
      setAttachment(null);

      const resp = await fetch(`${API}/google-ads-ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({})) as { error?: string };
        setMessages(prev => [...prev, { role: "assistant", content: `❌ ${errData.error ?? "خطأ من السيرفر"}` }]);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      const capturedLabels: string[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as { type?: string; text?: string; label?: string };
            if (parsed.type === "tool_call" && parsed.label) {
              capturedLabels.push(parsed.label);
              setToolCallLabels([...capturedLabels]);
              setSearching(true);
            } else if (parsed.type === "text" && parsed.text) {
              setSearching(false);
              accumulated += parsed.text;
              setStreamingText(accumulated);
            }
          } catch {}
        }
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: accumulated || "تم.",
        ...(capturedLabels.length > 0 ? { tool_calls: capturedLabels } : {}),
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (accumulated.trim().length > 3) {
        void saveToDB(activeCid, userText, accumulated, capturedLabels.length > 0 ? capturedLabels : undefined);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setMessages(prev => [...prev, { role: "assistant", content: "❌ حصل خطأ في الاتصال. حاول تاني." }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setStreaming(false);
      setStreamingText("");
      setSearching(false);
      setToolCallLabels([]);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, messages, streaming, ensureConversation, saveToDB, attachment]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setAttachment(await readFileAsAttachment(file)); } catch (err) { alert(err instanceof Error ? err.message : "خطأ"); }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    try { setAttachment(await readFileAsAttachment(file)); } catch {}
  }, []);

  const loadLtm = useCallback(async () => {
    setLtmLoading(true);
    try {
      const r = await fetch(`${API}/ai/memory`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json() as UserLtmData;
      setLtmData(data);
      setLtmEditKpis(Object.fromEntries(Object.entries(data.target_kpis ?? {}).map(([k, v]) => [k, v != null ? String(v) : ""])));
      setLtmEditRules([...(data.strategic_rules ?? [])]);
      setLtmEditInsights(data.historical_insights ?? "");
      setLtmDirty(false);
    } catch {} finally { setLtmLoading(false); }
  }, []);

  useEffect(() => {
    if (view === "memory" && open && ltmData === null && !ltmLoading) void loadLtm();
  }, [view, open, ltmData, ltmLoading, loadLtm]);

  const saveLtm = useCallback(async () => {
    setLtmSaving(true);
    try {
      const target_kpis: Record<string, number> = {};
      for (const [k, v] of Object.entries(ltmEditKpis)) {
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0) target_kpis[k] = n;
      }
      const body = { target_kpis, strategic_rules: ltmEditRules.filter(Boolean), historical_insights: ltmEditInsights };
      const r = await fetch(`${API}/ai/memory`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      if (r.ok) { setLtmData({ ...body, updated_at: new Date().toISOString() }); setLtmDirty(false); }
    } finally { setLtmSaving(false); }
  }, [ltmEditKpis, ltmEditRules, ltmEditInsights]);

  const resetLtm = useCallback(async () => {
    if (!confirm("مسح كل الذاكرة المحفوظة؟")) return;
    setLtmSaving(true);
    try {
      await fetch(`${API}/ai/memory`, { method: "DELETE", credentials: "include" });
      const empty: UserLtmData = { target_kpis: {}, strategic_rules: [], historical_insights: "", updated_at: new Date().toISOString() };
      setLtmData(empty); setLtmEditKpis({}); setLtmEditRules([]); setLtmEditInsights(""); setLtmDirty(false);
    } finally { setLtmSaving(false); }
  }, []);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]); setStreamingText(""); setStreaming(false); setAttachment(null); setConvId(null); setExpandedSources({}); setView("chat");
  }, []);

  const clearCurrentChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]); setStreamingText(""); setStreaming(false); setAttachment(null); setConvId(null); setExpandedSources({});
  }, []);

  const loadConversation = useCallback(async (conv: ConvSummary) => {
    setConvLoading(true);
    try {
      const resp = await fetch(`${API}/chat/conversations/${conv.id}/messages`, { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json() as { messages: { role: string; content: string; tool_calls?: string[] | null }[] };
      const loaded: ChatMessage[] = (data.messages ?? []).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        ...(m.tool_calls && m.tool_calls.length > 0 ? { tool_calls: m.tool_calls } : {}),
      }));
      setMessages(loaded); setConvId(conv.id); setExpandedSources({}); setView("chat");
    } catch {} finally { setConvLoading(false); }
  }, []);

  const deleteConversation = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await fetch(`${API}/chat/conversations/${id}`, { method: "DELETE", credentials: "include" });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (convId === id) { setMessages([]); setConvId(null); }
    } catch {} finally { setDeletingId(null); }
  }, [convId]);

  if (!user) return null;

  const hasUnread = messages.length > 0;
  const grouped = groupConversations(conversations);

  return (
    <>
      {!open && (
        <button
          onClick={() => { setOpen(true); setCollapsed(false); }}
          className="fixed bottom-6 left-6 z-50 rounded-2xl bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 hover:scale-105 transition-all flex items-center justify-center"
          title="مساعد Google Ads"
          style={{ height: 52, width: 52 }}
        >
          <MessageSquare className="h-5 w-5" />
          {hasUnread && <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background" />}
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border/60 shadow-2xl flex flex-col overflow-hidden"
          style={{ height: collapsed ? "56px" : "90vh", transition: "height 0.3s cubic-bezier(0.4,0,0.2,1)" }}
          dir="rtl"
        >
          {/* Header */}
          <div className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-border/60 bg-background">
            <div className="flex items-center gap-2.5">
              {view === "history" ? (
                <button onClick={() => setView("chat")} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="رجوع">
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
              )}
              <div>
                <p className="text-sm font-semibold leading-tight text-foreground">
                  {view === "history" ? "المحادثات السابقة" : view === "memory" ? "ذاكرة المساعد" : "مساعد Google Ads"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {view === "history" ? `${conversations.length} محادثة محفوظة` : view === "memory" ? "تفضيلاتك وقواعدك المحفوظة" : "اسألني عن حملاتك على Google Ads"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {view === "chat" && !collapsed && (
                <button onClick={startNewChat} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all" title="محادثة جديدة">
                  <Plus className="h-4 w-4" />
                </button>
              )}
              {!collapsed && (
                <button
                  onClick={() => setView(v => v === "history" ? "chat" : "history")}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all ${view === "history" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                  title="المحادثات السابقة"
                >
                  <History className="h-4 w-4" />
                </button>
              )}
              {!collapsed && (
                <button
                  onClick={() => setView(v => v === "memory" ? "chat" : "memory")}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all ${view === "memory" ? "text-purple-600 bg-purple-500/10" : "text-muted-foreground hover:text-purple-600 hover:bg-purple-500/10"}`}
                  title="ذاكرة المساعد"
                >
                  <Brain className="h-4 w-4" />
                </button>
              )}
              {view === "chat" && messages.length > 0 && !collapsed && (
                <button onClick={clearCurrentChat} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all" title="مسح المحادثة">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setCollapsed(c => !c)} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all" title={collapsed ? "توسيع" : "طي"}>
                {collapsed ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </button>
              <button onClick={() => setOpen(false)} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="إغلاق">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Memory View */}
          {view === "memory" ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {ltmLoading ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 min-h-0" dir="rtl">
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">📊 أهداف KPI المستهدفة</p>
                    <div className="grid grid-cols-2 gap-2">
                      {LTM_KPI_DEFS.map(({ key, label, unit, placeholder }) => (
                        <div key={key} className="bg-muted/40 rounded-xl p-2.5 border border-border">
                          <p className="text-[10px] text-muted-foreground mb-1 leading-tight">{label}</p>
                          <div className="flex items-center gap-1">
                            <input type="number" value={ltmEditKpis[key] ?? ""} onChange={e => { setLtmEditKpis(p => ({ ...p, [key]: e.target.value })); setLtmDirty(true); }} placeholder={placeholder} dir="ltr" className="w-full bg-transparent text-[13px] font-semibold focus:outline-none placeholder:text-muted-foreground/40 text-right" />
                            <span className="text-[11px] text-muted-foreground shrink-0">{unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">📋 القواعد الاستراتيجية</p>
                    <div className="space-y-1.5">
                      {ltmEditRules.map((rule, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 bg-muted/40 rounded-xl px-3 py-2 border border-border group">
                          <span className="text-[12.5px] flex-1 leading-snug">{rule}</span>
                          <button onClick={() => { setLtmEditRules(r => r.filter((_, i) => i !== idx)); setLtmDirty(true); }} className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all mt-0.5" title="حذف القاعدة">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {ltmEditRules.length === 0 && <p className="text-[12px] text-muted-foreground/60 text-center py-2">لا توجد قواعد محفوظة بعد</p>}
                      <div className="flex items-center gap-1.5 border border-dashed border-border rounded-xl px-3 py-2 focus-within:border-primary/50 transition-colors">
                        <input type="text" value={ltmNewRule} onChange={e => setLtmNewRule(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && ltmNewRule.trim()) { setLtmEditRules(r => [...r, ltmNewRule.trim()]); setLtmNewRule(""); setLtmDirty(true); } }} placeholder="أضف قاعدة… (Enter للإضافة)" dir="rtl" className="flex-1 bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground/40" />
                        <button onClick={() => { if (ltmNewRule.trim()) { setLtmEditRules(r => [...r, ltmNewRule.trim()]); setLtmNewRule(""); setLtmDirty(true); } }} className="shrink-0 text-muted-foreground hover:text-primary transition-colors"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">💡 رؤى تاريخية</p>
                    <textarea value={ltmEditInsights} onChange={e => { setLtmEditInsights(e.target.value); setLtmDirty(true); }} placeholder="ملاحظات وأنماط مستخلصة من المحادثات…" dir="rtl" rows={3} className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40 resize-none" />
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 text-center pb-1">يتم تحديث الذاكرة تلقائياً من محادثاتك</p>
                </div>
              )}
              {!ltmLoading && (
                <div className="shrink-0 px-3 py-2.5 border-t border-border flex items-center gap-2">
                  <button onClick={() => void saveLtm()} disabled={!ltmDirty || ltmSaving} className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5">
                    {ltmSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    حفظ التغييرات
                  </button>
                  <button onClick={() => void resetLtm()} disabled={ltmSaving} className="px-3 py-2 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors disabled:opacity-40" title="مسح كل الذاكرة">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ) : view === "history" ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-muted/40 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input type="text" value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="بحث في كل المحادثات…" dir="rtl" className="flex-1 bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground/60" />
                  {historySearch && <button onClick={() => setHistorySearch("")} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                {historySearch.trim() ? (
                  <div className="px-3 pb-4">
                    {historySearchLoading ? (
                      <div className="flex items-center justify-center py-8"><div className="flex gap-1.5">{[0,1,2].map(k => <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k*140}ms` }} />)}</div></div>
                    ) : historySearchResults === null ? null : historySearchResults.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-10 text-center"><Search className="h-8 w-8 text-muted-foreground/30" /><p className="text-sm text-muted-foreground">لا توجد نتائج</p></div>
                    ) : (
                      <>
                        <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-2 pb-1.5">{historySearchResults.length} نتيجة</p>
                        <div className="space-y-0.5">
                          {historySearchResults.map(conv => (
                            <div key={conv.id} onClick={() => loadConversation(conv)} className="group flex items-start gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-muted/60">
                              <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] truncate leading-tight font-medium">{highlightText(conv.title, historySearch)}</p>
                                {conv.snippet && <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-2 leading-snug">{highlightText(conv.snippet.slice(0, 120), historySearch)}</p>}
                                <p className="text-[10px] text-muted-foreground/50 mt-0.5">{formatRelative(conv.updated_at)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="px-3 pt-1 pb-1">
                      <button onClick={startNewChat} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 transition-colors text-sm font-medium">
                        <Plus className="h-4 w-4 shrink-0" /><span>محادثة جديدة</span>
                      </button>
                    </div>
                    {convLoading ? (
                      <div className="flex items-center justify-center py-12"><div className="flex gap-1.5">{[0,1,2].map(k => <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k*140}ms` }} />)}</div></div>
                    ) : conversations.length === 0 ? (
                      <div className="flex flex-col items-center gap-3 py-16 px-6 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center"><Clock className="h-6 w-6 text-muted-foreground" /></div>
                        <p className="text-sm text-muted-foreground">لا توجد محادثات محفوظة بعد</p>
                        <p className="text-xs text-muted-foreground/60">ابدأ محادثة جديدة وسيتم حفظها تلقائياً</p>
                      </div>
                    ) : (
                      <div className="px-3 pb-4">
                        {grouped.map(({ label, items }) => (
                          <div key={label}>
                            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-4 pb-1.5">{label}</p>
                            <div className="space-y-0.5">
                              {items.map(conv => (
                                <div key={conv.id} onClick={() => loadConversation(conv)} className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${convId === conv.id ? "bg-primary/10 text-primary" : "hover:bg-muted/60"}`}>
                                  <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${convId === conv.id ? "text-primary" : "text-muted-foreground"}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] truncate leading-tight">{conv.title}</p>
                                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{formatRelative(conv.updated_at)}</p>
                                  </div>
                                  <button onClick={e => deleteConversation(conv.id, e)} disabled={deletingId === conv.id} className="shrink-0 opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-30" title="حذف المحادثة">
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Chat View */}
              <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                <div className="flex flex-col gap-3 py-4 px-4">
                  {/* Empty state */}
                  {messages.length === 0 && !streaming && (
                    <div className="flex flex-col items-center gap-4 py-6">
                      <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[260px]">
                        اسألني أي سؤال عن Google Ads وهجاوبك
                      </p>
                      <div className="grid grid-cols-2 gap-2 w-full">
                        {["ما هو Quality Score المثالي؟", "كيف أحسّن الـ CPC؟", "متى أوقف الحملة؟", "كيف أزيد نسبة ظهور إعلاني؟"].map(q => (
                          <button key={q} onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }} className="text-xs text-end px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-muted/60 hover:border-primary/30 transition-all leading-snug text-foreground/80">
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Messages */}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"} items-start`}>
                      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${msg.role === "user" ? "bg-primary/90 text-primary-foreground ring-2 ring-primary/20" : "bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20"}`}>
                        {msg.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-primary" />}
                      </div>
                      <div className="min-w-0 flex flex-col gap-1.5" style={{ maxWidth: "84%" }}>
                        <div className={`min-w-0 rounded-2xl break-words overflow-hidden ${msg.role === "user" ? "bg-primary/90 text-primary-foreground rounded-tr-sm px-4 py-2.5 text-[13.5px] leading-relaxed shadow-sm" : "bg-background border border-border/70 rounded-tl-sm px-4 py-3 shadow-sm"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }} dir="rtl">
                          {msg.imagePreviewUrl && <img src={msg.imagePreviewUrl} alt="مرفق" className="max-w-full rounded-xl mb-2 cursor-zoom-in border border-white/20" style={{ maxHeight: 220 }} onClick={() => window.open(msg.imagePreviewUrl, "_blank")} />}
                          {msg.role === "user" ? msg.content && <span className="whitespace-pre-wrap">{msg.content}</span> : <RenderMarkdown text={msg.content} />}
                        </div>
                        {msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0 && (
                          <div dir="rtl">
                            <button onClick={() => setExpandedSources(prev => ({ ...prev, [i]: !prev[i] }))} className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors">
                              <Search className="h-2.5 w-2.5 shrink-0" />
                              <span>مصادر البيانات ({msg.tool_calls.length})</span>
                              <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform ${expandedSources[i] ? "rotate-180" : ""}`} />
                            </button>
                            {expandedSources[i] && (
                              <div className="mt-1 flex flex-col gap-0.5 ps-1">
                                {msg.tool_calls.map((label, j) => (
                                  <span key={j} className="flex items-center gap-1.5 text-[11px] text-muted-foreground/45">
                                    <span className="w-1 h-1 rounded-full bg-primary/30 shrink-0" />{label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Streaming text */}
                  {streaming && streamingText && (
                    <div className="flex gap-2.5 flex-row items-start">
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="min-w-0 rounded-2xl rounded-tl-sm bg-background border border-border/70 shadow-sm px-4 py-3 break-words overflow-hidden" style={{ maxWidth: "84%", wordBreak: "break-word", overflowWrap: "anywhere" }} dir="rtl">
                        <RenderMarkdown text={streamingText} />
                        <span className="inline-block w-[2px] h-[14px] bg-primary/60 animate-pulse rounded-full align-middle ms-0.5 mb-0.5" />
                      </div>
                    </div>
                  )}

                  {/* Thinking indicator */}
                  {streaming && !streamingText && (
                    <div className="flex gap-2.5 flex-row items-start">
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      {searching ? (
                        <div className="flex flex-col gap-1.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-primary/5 border border-primary/15 shadow-sm min-w-[220px]" dir="rtl">
                          {toolCallLabels.slice(0, -1).map((label, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-[11px] text-emerald-700/80"><CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" /><span className="line-through decoration-emerald-400/50">{label}</span></div>
                          ))}
                          <div className="flex items-center gap-2 text-[12px] text-primary/90 font-medium"><Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /><span>{toolCallLabels.length > 0 ? toolCallLabels[toolCallLabels.length - 1] : "جاري التحليل…"}</span></div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-4 py-3.5 rounded-2xl rounded-tl-sm bg-background border border-border/70 shadow-sm">
                          <span className="text-[12px] text-muted-foreground/60">يفكر</span>
                          {[0,1,2].map(k => <span key={k} className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${k*150}ms` }} />)}
                        </div>
                      )}
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-border/60 px-4 pt-3 pb-4">
                <div dir="rtl" className="flex gap-2 overflow-x-auto pb-2.5 mb-2.5" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                  {QUICK_ACTIONS.map(action => (
                    <button key={action.label} disabled={streaming} onClick={() => void send(action.prompt)} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap border border-border/70 bg-muted/40 text-foreground/75 hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                      {action.label}
                    </button>
                  ))}
                </div>

                {attachment && (
                  <div className="mb-2 flex items-center gap-2 bg-muted/60 rounded-xl px-3 py-2 border border-border" dir="rtl">
                    {attachment.previewUrl ? <img src={attachment.previewUrl} alt="preview" className="h-8 w-8 rounded-lg object-cover border border-border shrink-0" /> : <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="text-[12px] text-foreground/80 truncate flex-1">{attachment.name}</span>
                    <button onClick={() => setAttachment(null)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                  </div>
                )}

                <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-3 py-2.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all shadow-sm" dir="rtl">
                  <input ref={fileInputRef} type="file" className="hidden" accept={ALLOWED_TYPES.join(",")} onChange={handleFileChange} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={streaming} className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-40" title="إرفاق ملف">
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="اسألني عن Google Ads…"
                    dir="rtl"
                    rows={1}
                    disabled={streaming}
                    className="flex-1 bg-transparent text-[13.5px] resize-none focus:outline-none placeholder:text-muted-foreground/50 leading-relaxed disabled:opacity-60 max-h-32 overflow-y-auto"
                    style={{ minHeight: "28px" }}
                    onInput={e => {
                      const el = e.currentTarget;
                      el.style.height = "28px";
                      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                    }}
                  />
                  {streaming ? (
                    <button onClick={() => { abortRef.current?.abort(); abortRef.current = null; setStreaming(false); setStreamingText(""); }} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-all" title="إيقاف">
                      <div className="w-3 h-3 rounded-sm bg-destructive" />
                    </button>
                  ) : (
                    <button onClick={() => void send()} disabled={!input.trim() && !attachment} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm" title="إرسال">
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/40 text-center mt-1.5">Enter للإرسال • Shift+Enter لسطر جديد</p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
