import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Globe, MessageSquare, Loader2, Pin } from "lucide-react";
import { useGlobalAiChat } from "@/contexts/GlobalAiChatContext";

const BASE = "https://dashboards-jt0h.onrender.com";
const API = `${BASE}/api`;

interface ConvSummary {
  id: number;
  title: string;
  campaign_id?: string | null;
  snippet?: string | null;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
}

const NEW_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function isNew(conv: ConvSummary): boolean {
  return Date.now() - new Date(conv.created_at).getTime() < NEW_THRESHOLD_MS;
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

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-amber-200 dark:bg-amber-700 text-foreground rounded-sm px-0.5">{part}</mark>
      : part
  );
}

interface NavConversationSearchProps {
  open: boolean;
  onClose: () => void;
}

function ConvRow({
  conv,
  query,
  onOpen,
  onTogglePin,
}: {
  conv: ConvSummary;
  query?: string;
  onOpen: (conv: ConvSummary) => void;
  onTogglePin: (conv: ConvSummary) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isCampaign = !!conv.campaign_id;
  const isNewConv = isNew(conv);

  return (
    <div
      className={`relative group${isNewConv ? " new-row-highlight" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={() => onOpen(conv)}
        className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-muted/60 text-start pr-9"
      >
        {isCampaign
          ? <Globe className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
          : <MessageSquare className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm truncate leading-tight font-medium">
              {query ? highlightText(conv.title, query) : conv.title}
            </p>
            {isNewConv && (
              <span className="new-badge inline-flex items-center shrink-0 text-[9px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-full px-1.5 py-0.5">
                جديد
              </span>
            )}
          </div>
          {isCampaign && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-full px-1.5 py-0.5 mt-0.5">
              <Globe className="h-2.5 w-2.5" />
              حملة
            </span>
          )}
          {query && conv.snippet && (
            <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 leading-snug">
              {highlightText(conv.snippet.slice(0, 140), query)}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            {formatRelative(conv.updated_at)}
          </p>
        </div>
      </button>

      {/* Pin toggle button — visible on hover or when already pinned */}
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(conv); }}
        title={conv.is_pinned ? "إلغاء التثبيت" : "تثبيت المحادثة"}
        className={[
          "absolute top-1/2 -translate-y-1/2 left-2 p-1.5 rounded-lg transition-all",
          conv.is_pinned
            ? "text-primary opacity-100"
            : hovered
              ? "text-muted-foreground opacity-100 hover:text-foreground hover:bg-muted"
              : "opacity-0 pointer-events-none",
        ].join(" ")}
      >
        <Pin className={`h-3.5 w-3.5 ${conv.is_pinned ? "fill-primary" : ""}`} />
      </button>
    </div>
  );
}

export function NavConversationSearchModal({ open, onClose }: NavConversationSearchProps) {
  const { openToConversation } = useGlobalAiChat();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConvSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [recentConvs, setRecentConvs] = useState<ConvSummary[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRecent = useCallback(() => {
    if (fetchTimerRef.current !== null) clearTimeout(fetchTimerRef.current);
    setRecentLoading(true);
    fetchTimerRef.current = setTimeout(() => {
      fetchTimerRef.current = null;
      fetch(`${API}/chat/conversations?global=true`, {
        credentials: "include",
        cache: "no-store",
      })
        .then((r) => r.ok ? r.json() as Promise<{ conversations: ConvSummary[] }> : Promise.reject())
        .then((d) => setRecentConvs(d.conversations))
        .catch(() => setRecentConvs([]))
        .finally(() => setRecentLoading(false));
    }, 100);
  }, []);

  // Focus input and fetch recent conversations when modal opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setTimeout(() => inputRef.current?.focus(), 50);
      fetchRecent();
    }
  }, [open, fetchRecent]);

  // Re-fetch when the window regains focus while the palette is open
  useEffect(() => {
    if (!open) return;
    const handleVisible = () => {
      if (document.visibilityState === "visible") fetchRecent();
    };
    const handleFocus = () => fetchRecent();
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleFocus);
    };
  }, [open, fetchRecent]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Debounced search
  useEffect(() => {
    setResults(null);
    if (!query.trim()) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ global: "true", q: query.trim() });
        const r = await fetch(`${API}/chat/conversations?${params}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (r.ok) {
          const d = await r.json() as { conversations: ConvSummary[] };
          setResults(d.conversations);
        }
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const openConversation = useCallback((conv: ConvSummary) => {
    onClose();
    openToConversation(conv.id, conv.campaign_id ?? null);
  }, [onClose, openToConversation]);

  const togglePin = useCallback(async (conv: ConvSummary) => {
    const newPinned = !conv.is_pinned;
    // Optimistic update
    const update = (list: ConvSummary[] | null) =>
      list ? list.map((c) => c.id === conv.id ? { ...c, is_pinned: newPinned } : c) : null;
    setRecentConvs(update);
    setResults(update);

    try {
      const res = await fetch(`${API}/chat/conversations/${conv.id}/pin`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: newPinned }),
      });
      if (!res.ok) throw new Error("pin failed");
    } catch {
      // Revert on error or non-OK response
      const revert = (list: ConvSummary[] | null) =>
        list ? list.map((c) => c.id === conv.id ? { ...c, is_pinned: conv.is_pinned } : c) : null;
      setRecentConvs(revert);
      setResults(revert);
    }
  }, []);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (!open) return null;

  const pinnedConvs = recentConvs?.filter((c) => c.is_pinned) ?? [];
  const unpinnedConvs = recentConvs?.filter((c) => !c.is_pinned) ?? [];

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[10vh]"
    >
      <style>{`
        @keyframes newBadgeFade {
          0%, 70% { opacity: 1; }
          100% { opacity: 0; }
        }
        .new-badge {
          animation: newBadgeFade 20s ease-in forwards;
        }
        @keyframes newRowPulse {
          0%, 100% { background-color: transparent; }
          30% { background-color: rgba(16, 185, 129, 0.1); }
        }
        .new-row-highlight {
          animation: newRowPulse 3s ease-in-out forwards;
          border-radius: 0.75rem;
        }
      `}</style>
      <div
        className="w-full max-w-xl mx-4 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        dir="rtl"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            dir="rtl"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في المحادثات السابقة…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60"
          />
          {query ? (
            <button
              onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground border border-border bg-muted/50">
              Esc
            </kbd>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {!query.trim() ? (
            recentConvs === null && recentLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((k) => (
                    <span
                      key={k}
                      className="w-2 h-2 rounded-full bg-primary/40 animate-bounce"
                      style={{ animationDelay: `${k * 140}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : recentConvs && recentConvs.length > 0 ? (
              <div className={`py-2 transition-opacity duration-300 ${recentLoading ? "opacity-60" : "opacity-100"}`}>
                {/* Pinned section */}
                {pinnedConvs.length > 0 && (
                  <>
                    <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-4 pt-1 pb-2 flex items-center gap-1.5">
                      <Pin className="h-2.5 w-2.5 fill-muted-foreground/60" />
                      محادثات مثبتة
                    </p>
                    <div className="space-y-0.5 px-2">
                      {pinnedConvs.map((conv) => (
                        <ConvRow
                          key={conv.id}
                          conv={conv}
                          onOpen={openConversation}
                          onTogglePin={togglePin}
                        />
                      ))}
                    </div>
                    {unpinnedConvs.length > 0 && (
                      <div className="my-1.5 mx-4 border-t border-border" />
                    )}
                  </>
                )}

                {/* Recent section */}
                {unpinnedConvs.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-4 pt-1 pb-2">
                      <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider flex-1">
                        المحادثات الأخيرة
                      </p>
                      {recentLoading && (
                        <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
                      )}
                    </div>
                    <div className="space-y-0.5 px-2">
                      {unpinnedConvs.map((conv) => (
                        <ConvRow
                          key={conv.id}
                          conv={conv}
                          onOpen={openConversation}
                          onTogglePin={togglePin}
                        />
                      ))}
                    </div>
                  </>
                )}


                <p className="text-[10px] text-muted-foreground/40 text-center py-2 border-t border-border mt-1">
                  ابدأ الكتابة للبحث في جميع المحادثات
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground/60">
                <MessageSquare className="h-8 w-8" />
                <p className="text-sm">لا توجد محادثات سابقة</p>
              </div>
            )
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((k) => (
                  <span
                    key={k}
                    className="w-2 h-2 rounded-full bg-primary/40 animate-bounce"
                    style={{ animationDelay: `${k * 140}ms` }}
                  />
                ))}
              </div>
            </div>
          ) : results === null ? null : results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground/60">
              <Search className="h-8 w-8" />
              <p className="text-sm">لا توجد نتائج لـ «{query}»</p>
            </div>
          ) : (
            <div className="py-2">
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-4 pt-1 pb-2">
                {results.length} نتيجة
              </p>
              <div className="space-y-0.5 px-2">
                {results.map((conv) => (
                  <ConvRow
                    key={conv.id}
                    conv={conv}
                    query={query}
                    onOpen={openConversation}
                    onTogglePin={togglePin}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface NavSearchButtonProps {
  onOpen: () => void;
}

export function NavSearchButton({ onOpen }: NavSearchButtonProps) {
  return (
    <button
      onClick={onOpen}
      title="بحث في المحادثات (Ctrl+K)"
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      <Search className="h-4 w-4" />
      <kbd className="hidden md:inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono text-muted-foreground/70 border border-border bg-muted/50">
        ⌘K
      </kbd>
    </button>
  );
}
