import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, Star, ExternalLink, RefreshCw, PackageSearch, Heart, Clock3, CheckCircle2, XCircle, FlaskConical, Download, Trash2 } from "lucide-react";

interface ProductItem {
  id: number;
  source_url: string;
  normalized_url: string;
  source_type: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  channel_name: string | null;
  status: string;
  is_favorite: boolean;
  category: string | null;
  notes: string | null;
  added_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total?: number;
  favorites?: number;
  new?: number;
  reviewing?: number;
  interested?: number;
  sample?: number;
  imported?: number;
  rejected?: number;
}

const statusMeta: Record<string, { label: string; className: string }> = {
  new: { label: "جديد", className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900" },
  reviewing: { label: "تحت المراجعة", className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900" },
  interested: { label: "مهتم", className: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900" },
  sample: { label: "طلب عينة", className: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-900" },
  imported: { label: "تم الاستيراد", className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900" },
  rejected: { label: "مرفوض", className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900" },
};

function domainLabel(type: string) {
  if (type === "telegram") return "Telegram";
  if (type === "tiktok") return "TikTok";
  if (type === "aliexpress") return "AliExpress";
  return "رابط خارجي";
}

export default function ProductHuntingPage() {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [queryText, setQueryText] = useState("");
  const [status, setStatus] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (queryText.trim()) params.set("q", queryText.trim());
      if (status) params.set("status", status);
      if (favoriteOnly) params.set("favorite", "true");
      const r = await fetch(`/api/product-hunting?${params.toString()}`, { credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "تعذر تحميل المنتجات");
      setItems(data.items || []);
      setStats(data.stats || {});
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر تحميل المنتجات");
    } finally {
      setLoading(false);
    }
  }, [queryText, status, favoriteOnly]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const addProduct = useCallback(async () => {
    const source_url = link.trim();
    if (!source_url) return;
    setAdding(true);
    try {
      const r = await fetch("/api/product-hunting", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_url }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "تعذر إضافة المنتج");
      setLink("");
      setMessage(data.scraped ? "تمت الإضافة واستيراد بيانات Telegram تلقائياً" : "تمت إضافة الرابط — لم تتوفر معاينة عامة للصورة");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر إضافة المنتج");
    } finally {
      setAdding(false);
    }
  }, [link, load]);

  const patchItem = useCallback(async (id: number, patch: Record<string, unknown>) => {
    try {
      const r = await fetch(`/api/product-hunting/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "تعذر التحديث");
      setItems(prev => prev.map(item => item.id === id ? data.item : item));
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر التحديث");
    }
  }, [load]);

  const removeItem = useCallback(async (id: number) => {
    if (!confirm("حذف المنتج من قائمة البحث؟")) return;
    try {
      const r = await fetch(`/api/product-hunting/${id}`, { method: "DELETE", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "تعذر الحذف");
      setItems(prev => prev.filter(item => item.id !== id));
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر الحذف");
    }
  }, [load]);

  const statCards = useMemo(() => [
    { label: "كل المنتجات", value: stats.total ?? 0, Icon: PackageSearch },
    { label: "المفضلة", value: stats.favorites ?? 0, Icon: Heart },
    { label: "تحت المراجعة", value: stats.reviewing ?? 0, Icon: Clock3 },
    { label: "طلب عينة", value: stats.sample ?? 0, Icon: FlaskConical },
    { label: "تم الاستيراد", value: stats.imported ?? 0, Icon: CheckCircle2 },
  ], [stats]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-8" dir="rtl">
      {message && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[100] rounded-xl bg-foreground text-background px-4 py-2.5 text-sm shadow-xl">
          {message}
        </div>
      )}

      <div className="flex flex-col gap-1 mb-5">
        <div className="flex items-center gap-2">
          <PackageSearch className="h-5 w-5 text-emerald-500" />
          <h1 className="text-2xl font-bold tracking-tight">Product Hunting</h1>
        </div>
        <p className="text-sm text-muted-foreground">الفريق يضيف الرابط فقط، والنظام يحاول استيراد بيانات وصورة البوست العام من Telegram تلقائياً.</p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm mb-5">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          <div className="flex-1 relative">
            <ExternalLink className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={link}
              onChange={e => setLink(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addProduct(); }}
              placeholder="الصق رابط Telegram أو رابط المنتج هنا..."
              className="w-full h-11 rounded-xl border border-input bg-background pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={addProduct}
            disabled={adding || !link.trim()}
            className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {adding ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            إضافة المنتج
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {statCards.map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-2">{value}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-col lg:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={queryText}
            onChange={e => setQueryText(e.target.value)}
            placeholder="ابحث بالاسم، القناة أو الرابط..."
            className="w-full h-10 rounded-xl border border-input bg-background pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="">كل الحالات</option>
          {Object.entries(statusMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
        <button
          onClick={() => setFavoriteOnly(v => !v)}
          className={`h-10 rounded-xl border px-3 text-sm inline-flex items-center gap-2 justify-center ${favoriteOnly ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300" : "border-input bg-background"}`}
        >
          <Star className={`h-4 w-4 ${favoriteOnly ? "fill-current" : ""}`} />
          المفضلة فقط
        </button>
        <button onClick={load} className="h-10 w-10 rounded-xl border border-input bg-background inline-flex items-center justify-center" title="تحديث">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </section>

      {loading ? (
        <div className="py-20 flex justify-center"><RefreshCw className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <PackageSearch className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">مفيش منتجات في الفلتر الحالي</p>
          <p className="text-sm mt-1">الصق أول رابط فوق وابدأ التجميع.</p>
        </div>
      ) : (
        <section className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(item => {
            const smeta = statusMeta[item.status] ?? statusMeta.new;
            return (
              <article key={item.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm flex flex-col min-h-[420px]">
                <div className="relative aspect-[4/3] bg-muted overflow-hidden">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.title || "product"} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                      <PackageSearch className="h-10 w-10 opacity-40" />
                      <span className="text-xs">لا توجد صورة متاحة تلقائياً</span>
                    </div>
                  )}
                  <button
                    onClick={() => patchItem(item.id, { is_favorite: !item.is_favorite })}
                    className="absolute top-3 left-3 h-9 w-9 rounded-full bg-background/90 backdrop-blur border border-border inline-flex items-center justify-center shadow-sm"
                    title="مفضلة"
                  >
                    <Star className={`h-4 w-4 ${item.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                  </button>
                  <span className="absolute top-3 right-3 text-[11px] px-2 py-1 rounded-full bg-background/90 backdrop-blur border border-border font-medium">{domainLabel(item.source_type)}</span>
                </div>

                <div className="p-4 flex flex-col gap-3 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-bold leading-snug line-clamp-2">{item.title || "منتج بدون عنوان"}</h2>
                      <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        {item.channel_name && <span>@{item.channel_name}</span>}
                        {item.added_by_name && <span>• أضافه {item.added_by_name}</span>}
                      </div>
                    </div>
                    <span className={`shrink-0 text-[11px] border rounded-full px-2 py-1 font-medium ${smeta.className}`}>{smeta.label}</span>
                  </div>

                  {item.description && <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{item.description}</p>}

                  <div className="mt-auto flex flex-col gap-3">
                    <select
                      value={item.status}
                      onChange={e => patchItem(item.id, { status: e.target.value })}
                      className="w-full h-9 rounded-lg border border-input bg-background px-2 text-sm"
                    >
                      {Object.entries(statusMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                    </select>

                    <div className="flex items-center gap-2">
                      <a href={item.source_url} target="_blank" rel="noreferrer" className="flex-1 h-9 rounded-lg border border-input inline-flex items-center justify-center gap-2 text-sm font-medium hover:bg-muted transition-colors">
                        <ExternalLink className="h-4 w-4" /> فتح المصدر
                      </a>
                      <button onClick={() => removeItem(item.id)} className="h-9 w-9 rounded-lg border border-red-200 text-red-500 inline-flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-950/20" title="حذف">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
