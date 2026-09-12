import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, Star, ExternalLink, RefreshCw, PackageSearch, Heart, Clock3, CheckCircle2, FlaskConical, Trash2, Pencil, X, Save, Tag, Banknote, Link2, Images, Video, ChevronLeft, ChevronRight } from "lucide-react";

interface ProductMedia {
  type: "image" | "video";
  url: string;
  thumbnail_url?: string | null;
}

interface ProductItem {
  id: number;
  source_url: string;
  normalized_url: string;
  source_type: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  media?: ProductMedia[] | null;
  channel_name: string | null;
  status: string;
  is_favorite: boolean;
  category: string | null;
  notes: string | null;
  supplier_url: string | null;
  target_price_egp: string | number | null;
  cost_price: string | number | null;
  cost_currency: string | null;
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

interface EditForm {
  title: string;
  description: string;
  image_url: string;
  category: string;
  notes: string;
  supplier_url: string;
  target_price_egp: string;
  cost_price: string;
  cost_currency: string;
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

function asText(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function priceText(value: string | number | null | undefined, suffix: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ${suffix}`;
}

export default function ProductHuntingPage() {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [link, setLink] = useState("");
  const [queryText, setQueryText] = useState("");
  const [status, setStatus] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewer, setViewer] = useState<{ media: ProductMedia[]; index: number } | null>(null);

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
    const t = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (!viewer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      if (e.key === "ArrowLeft" && viewer.media.length > 1) setViewer(v => v ? ({ ...v, index: (v.index + 1) % v.media.length }) : v);
      if (e.key === "ArrowRight" && viewer.media.length > 1) setViewer(v => v ? ({ ...v, index: (v.index - 1 + v.media.length) % v.media.length }) : v);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewer]);

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
      const count = Number(data.media_count || 0);
      if (data.media_from_post_id) {
        setMessage(`تمت الإضافة: البوست نص فقط، فتم سحب ${count} صورة/فيديو من البوست السابق #${data.media_from_post_id}`);
      } else {
        setMessage(count > 0 ? `تمت الإضافة واستيراد ${count} صورة/فيديو من Telegram` : data.scraped ? "تمت الإضافة واستيراد البيانات المتاحة تلقائياً" : "تمت إضافة الرابط — افتح تعديل المنتج لإكمال البيانات الناقصة");
      }
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر إضافة المنتج");
    } finally {
      setAdding(false);
    }
  }, [link, load]);

  const patchItem = useCallback(async (id: number, patch: Record<string, unknown>, reload = true) => {
    const r = await fetch(`/api/product-hunting/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "تعذر التحديث");
    setItems(prev => prev.map(item => item.id === id ? data.item : item));
    if (reload) await load();
    return data.item as ProductItem;
  }, [load]);

  const safePatch = useCallback(async (id: number, patch: Record<string, unknown>) => {
    try {
      await patchItem(id, patch);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر التحديث");
    }
  }, [patchItem]);

  const refreshMedia = useCallback(async (id: number) => {
    setRefreshingId(id);
    try {
      const r = await fetch(`/api/product-hunting/${id}/refresh`, { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "تعذر تحديث الوسائط");
      setItems(prev => prev.map(item => item.id === id ? data.item : item));
      if (data.media_from_post_id) {
        setMessage(`البوست الحالي نص فقط — تم أخذ الوسائط من البوست السابق #${data.media_from_post_id}`);
      } else {
        setMessage(`تم تحديث الوسائط: ${Number(data.media_count || 0)} صورة/فيديو`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر تحديث الوسائط");
    } finally {
      setRefreshingId(null);
    }
  }, []);

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

  const openEdit = useCallback((item: ProductItem) => {
    setEditing(item);
    setEditForm({
      title: item.title ?? "",
      description: item.description ?? "",
      image_url: item.image_url ?? "",
      category: item.category ?? "",
      notes: item.notes ?? "",
      supplier_url: item.supplier_url ?? "",
      target_price_egp: asText(item.target_price_egp),
      cost_price: asText(item.cost_price),
      cost_currency: item.cost_currency || "CNY",
    });
  }, []);

  const closeEdit = useCallback(() => {
    if (saving) return;
    setEditing(null);
    setEditForm(null);
  }, [saving]);

  const saveEdit = useCallback(async () => {
    if (!editing || !editForm) return;
    setSaving(true);
    try {
      const toNumberOrNull = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const n = Number(trimmed.replace(/,/g, ""));
        return Number.isFinite(n) ? n : null;
      };
      await patchItem(editing.id, {
        title: editForm.title,
        description: editForm.description,
        image_url: editForm.image_url,
        category: editForm.category,
        notes: editForm.notes,
        supplier_url: editForm.supplier_url,
        target_price_egp: toNumberOrNull(editForm.target_price_egp),
        cost_price: toNumberOrNull(editForm.cost_price),
        cost_currency: editForm.cost_currency || "CNY",
      });
      setMessage("تم حفظ تفاصيل المنتج");
      setEditing(null);
      setEditForm(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر حفظ التفاصيل");
    } finally {
      setSaving(false);
    }
  }, [editing, editForm, patchItem]);

  const statCards = useMemo(() => [
    { label: "كل المنتجات", value: stats.total ?? 0, Icon: PackageSearch },
    { label: "المفضلة", value: stats.favorites ?? 0, Icon: Heart },
    { label: "تحت المراجعة", value: stats.reviewing ?? 0, Icon: Clock3 },
    { label: "طلب عينة", value: stats.sample ?? 0, Icon: FlaskConical },
    { label: "تم الاستيراد", value: stats.imported ?? 0, Icon: CheckCircle2 },
  ], [stats]);

  const viewerItem = viewer ? viewer.media[viewer.index] : null;

  return (
    <main className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-8" dir="rtl">
      {message && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[100] rounded-xl bg-foreground text-background px-4 py-2.5 text-sm shadow-xl">
          {message}
        </div>
      )}

      {viewer && viewerItem && (
        <div className="fixed inset-0 z-[150] bg-black/90 flex items-center justify-center p-3 sm:p-6" onMouseDown={e => { if (e.currentTarget === e.target) setViewer(null); }}>
          <button onClick={() => setViewer(null)} className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center" title="إغلاق"><X className="h-6 w-6" /></button>
          {viewer.media.length > 1 && (
            <>
              <button onClick={() => setViewer(v => v ? ({ ...v, index: (v.index + 1) % v.media.length }) : v)} className="absolute left-3 sm:left-6 h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center" title="التالي"><ChevronLeft className="h-7 w-7" /></button>
              <button onClick={() => setViewer(v => v ? ({ ...v, index: (v.index - 1 + v.media.length) % v.media.length }) : v)} className="absolute right-3 sm:right-6 h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center" title="السابق"><ChevronRight className="h-7 w-7" /></button>
            </>
          )}
          <div className="max-w-[92vw] max-h-[88vh] flex flex-col items-center gap-3">
            {viewerItem.type === "image" ? (
              <img src={viewerItem.url} alt="product media" className="max-w-full max-h-[82vh] object-contain rounded-xl" />
            ) : (
              <video src={viewerItem.url} poster={viewerItem.thumbnail_url || undefined} controls autoPlay playsInline className="max-w-full max-h-[82vh] rounded-xl bg-black" />
            )}
            <div className="text-white/80 text-xs">{viewer.index + 1} / {viewer.media.length}</div>
          </div>
        </div>
      )}

      {editing && editForm && (
        <div className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={e => { if (e.currentTarget === e.target) closeEdit(); }}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl" dir="rtl">
            <div className="sticky top-0 z-10 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">تعديل تفاصيل المنتج</h2>
                <p className="text-xs text-muted-foreground mt-1">كمّل أي بيانات لم يقدر النظام يستخرجها من الرابط.</p>
              </div>
              <button onClick={closeEdit} className="h-9 w-9 rounded-lg hover:bg-muted inline-flex items-center justify-center"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-5 grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">اسم المنتج</span>
                <input value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm" placeholder="مثال: منظم توابل مغناطيسي" />
              </label>

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">سعر البيع المتوقع في مصر</span>
                  <div className="relative">
                    <input inputMode="decimal" value={editForm.target_price_egp} onChange={e => setEditForm({ ...editForm, target_price_egp: e.target.value })} className="w-full h-10 rounded-xl border border-input bg-background px-3 pl-14 text-sm" placeholder="299" />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ج.م</span>
                  </div>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">سعر الشراء / المورد</span>
                  <div className="flex gap-2">
                    <input inputMode="decimal" value={editForm.cost_price} onChange={e => setEditForm({ ...editForm, cost_price: e.target.value })} className="min-w-0 flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm" placeholder="18.5" />
                    <select value={editForm.cost_currency} onChange={e => setEditForm({ ...editForm, cost_currency: e.target.value })} className="h-10 rounded-xl border border-input bg-background px-2 text-sm">
                      <option value="CNY">CNY</option>
                      <option value="USD">USD</option>
                      <option value="EGP">EGP</option>
                    </select>
                  </div>
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">التصنيف</span>
                  <input value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm" placeholder="منزل ومطبخ، إلكترونيات..." />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">رابط المورد</span>
                  <input value={editForm.supplier_url} onChange={e => setEditForm({ ...editForm, supplier_url: e.target.value })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm" placeholder="1688 / AliExpress / المورد" dir="ltr" />
                </label>
              </div>

              <label className="grid gap-1.5">
                <span className="text-sm font-medium">رابط صورة الغلاف</span>
                <input value={editForm.image_url} onChange={e => setEditForm({ ...editForm, image_url: e.target.value })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm" placeholder="https://..." dir="ltr" />
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm font-medium">تفاصيل المنتج</span>
                <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className="min-h-28 rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-y" placeholder="وظيفة المنتج، المقاسات، المميزات، ما يميزه..." />
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm font-medium">ملاحظات الفريق</span>
                <textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} className="min-h-24 rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-y" placeholder="ملاحظات الاستيراد، MOQ، مورد أفضل، فكرة إعلان..." />
              </label>
            </div>

            <div className="sticky bottom-0 bg-background border-t border-border p-4 flex items-center gap-2 justify-end">
              <button onClick={closeEdit} disabled={saving} className="h-10 px-4 rounded-xl border border-input text-sm font-medium disabled:opacity-50">إلغاء</button>
              <button onClick={saveEdit} disabled={saving} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ التفاصيل
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 mb-5">
        <div className="flex items-center gap-2">
          <PackageSearch className="h-5 w-5 text-emerald-500" />
          <h1 className="text-2xl font-bold tracking-tight">Product Hunting</h1>
        </div>
        <p className="text-sm text-muted-foreground">الفريق يضيف الرابط فقط، والنظام يحاول استيراد تفاصيل وصور وفيديوهات بوست Telegram العام تلقائيًا.</p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm mb-5">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          <div className="flex-1 relative">
            <ExternalLink className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addProduct(); }} placeholder="الصق رابط Telegram أو رابط المنتج هنا..." className="w-full h-11 rounded-xl border border-input bg-background pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button onClick={addProduct} disabled={adding || !link.trim()} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {adding ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} إضافة المنتج
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {statCards.map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{label}</span><Icon className="h-4 w-4 text-muted-foreground" /></div>
            <div className="text-2xl font-bold mt-2">{value}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-col lg:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={queryText} onChange={e => setQueryText(e.target.value)} placeholder="ابحث بالاسم، القناة، التصنيف أو الرابط..." className="w-full h-10 rounded-xl border border-input bg-background pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="">كل الحالات</option>
          {Object.entries(statusMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
        <button onClick={() => setFavoriteOnly(v => !v)} className={`h-10 rounded-xl border px-3 text-sm inline-flex items-center gap-2 justify-center ${favoriteOnly ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300" : "border-input bg-background"}`}>
          <Star className={`h-4 w-4 ${favoriteOnly ? "fill-current" : ""}`} /> المفضلة فقط
        </button>
        <button onClick={load} className="h-10 w-10 rounded-xl border border-input bg-background inline-flex items-center justify-center" title="تحديث"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
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
            const sellPrice = priceText(item.target_price_egp, "ج.م");
            const buyPrice = priceText(item.cost_price, item.cost_currency || "CNY");
            const media: ProductMedia[] = Array.isArray(item.media) && item.media.length > 0
              ? item.media
              : item.image_url ? [{ type: "image", url: item.image_url }] : [];
            const imageCount = media.filter(m => m.type === "image").length;
            const videoCount = media.filter(m => m.type === "video").length;
            const cover = item.image_url || media.find(m => m.type === "image")?.url || media[0]?.thumbnail_url || null;
            const coverIndex = Math.max(0, media.findIndex(m => m.url === cover || m.thumbnail_url === cover));
            return (
              <article key={item.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm flex flex-col min-h-[440px]">
                <div className="relative aspect-[4/3] bg-muted overflow-hidden">
                  {cover ? (
                    <button onClick={() => media.length > 0 && setViewer({ media, index: coverIndex })} className="block w-full h-full cursor-zoom-in" title="عرض الوسائط داخل الداشبورد">
                      <img src={cover} alt={item.title || "product"} className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-2"><PackageSearch className="h-10 w-10 opacity-40" /><span className="text-xs">لا توجد صورة — أضفها من تعديل المنتج</span></div>
                  )}
                  <button onClick={() => safePatch(item.id, { is_favorite: !item.is_favorite })} className="absolute top-3 left-3 h-9 w-9 rounded-full bg-background/90 backdrop-blur border border-border inline-flex items-center justify-center shadow-sm" title="مفضلة"><Star className={`h-4 w-4 ${item.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} /></button>
                  <span className="absolute top-3 right-3 text-[11px] px-2 py-1 rounded-full bg-background/90 backdrop-blur border border-border font-medium">{domainLabel(item.source_type)}</span>
                  {media.length > 0 && (
                    <div className="absolute bottom-3 right-3 flex gap-1.5 pointer-events-none">
                      {imageCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-2 py-1 text-[11px]"><Images className="h-3 w-3" /> {imageCount}</span>}
                      {videoCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-2 py-1 text-[11px]"><Video className="h-3 w-3" /> {videoCount}</span>}
                    </div>
                  )}
                </div>

                {media.length > 1 || videoCount > 0 ? (
                  <div className="border-b border-border bg-muted/30 p-2 flex gap-2 overflow-x-auto" dir="ltr">
                    {media.slice(0, 8).map((m, index) => (
                      <button key={`${m.type}-${m.url}-${index}`} onClick={() => setViewer({ media, index })} className="relative shrink-0 h-14 w-16 rounded-lg overflow-hidden border border-border bg-muted cursor-pointer hover:ring-2 hover:ring-primary/40" title={m.type === "video" ? "تشغيل الفيديو داخل الداشبورد" : "عرض الصورة داخل الداشبورد"}>
                        {m.type === "image" ? (
                          <img src={m.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : m.thumbnail_url || cover ? (
                          <><img src={m.thumbnail_url || cover || ""} alt="" className="h-full w-full object-cover opacity-80" loading="lazy" /><span className="absolute inset-0 flex items-center justify-center"><Video className="h-5 w-5 text-white drop-shadow" /></span></>
                        ) : (
                          <span className="h-full w-full flex items-center justify-center"><Video className="h-5 w-5 text-muted-foreground" /></span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}

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

                  <div className="flex items-center gap-2 flex-wrap">
                    {sellPrice && <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 text-xs font-semibold"><Banknote className="h-3.5 w-3.5" /> بيع: {sellPrice}</span>}
                    {buyPrice && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 px-2.5 py-1 text-xs font-semibold">شراء: {buyPrice}</span>}
                    {item.category && <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs"><Tag className="h-3.5 w-3.5" /> {item.category}</span>}
                  </div>

                  {item.description ? <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{item.description}</p> : <p className="text-sm text-muted-foreground/70 italic">لا توجد تفاصيل بعد — اضغط تعديل وأضفها يدويًا.</p>}
                  {item.notes && <div className="rounded-xl bg-muted/60 px-3 py-2 text-xs leading-relaxed line-clamp-2"><span className="font-semibold">ملاحظات:</span> {item.notes}</div>}

                  <div className="mt-auto flex flex-col gap-3">
                    <select value={item.status} onChange={e => safePatch(item.id, { status: e.target.value })} className="w-full h-9 rounded-lg border border-input bg-background px-2 text-sm">
                      {Object.entries(statusMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                    </select>

                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(item)} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center gap-2 text-sm font-medium"><Pencil className="h-4 w-4" /> تعديل التفاصيل</button>
                      {item.source_type === "telegram" && <button onClick={() => refreshMedia(item.id)} disabled={refreshingId === item.id} className="h-9 px-3 rounded-lg border border-input inline-flex items-center justify-center hover:bg-muted disabled:opacity-50" title="إعادة جلب الصور والفيديوهات من Telegram"><RefreshCw className={`h-4 w-4 ${refreshingId === item.id ? "animate-spin" : ""}`} /></button>}
                      <a href={item.source_url} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg border border-input inline-flex items-center justify-center gap-1.5 text-sm font-medium hover:bg-muted transition-colors" title="فتح المصدر"><ExternalLink className="h-4 w-4" /></a>
                      {item.supplier_url && <a href={item.supplier_url} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg border border-input inline-flex items-center justify-center gap-1.5 text-sm font-medium hover:bg-muted transition-colors" title="فتح المورد"><Link2 className="h-4 w-4" /></a>}
                      <button onClick={() => removeItem(item.id)} className="h-9 w-9 rounded-lg border border-red-200 text-red-500 inline-flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-950/20" title="حذف"><Trash2 className="h-4 w-4" /></button>
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
