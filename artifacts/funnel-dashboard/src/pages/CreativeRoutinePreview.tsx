import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Clock3, ExternalLink,
  Film, FolderOpen, Link2, Loader2, Package, Play, RefreshCw, Save,
  Sparkles, Users,
} from "lucide-react";

type Product = {
  id: number;
  sourceProductId: string;
  sourceStore: "dealme" | "buzzpick";
  storeName: string;
  name: string;
  sku: string;
  currentStock: number;
  availableStock?: number;
};

type SalesRate = {
  sold7: number;
  sold14: number;
  sold30: number;
  dailyRate7: number;
  dailyRate14: number;
  dailyRate30: number;
  lastSaleAt: string | null;
};

type TaskState = "queued" | "in_progress" | "review" | "done";

type RoutineRecord = {
  inventory_product_id: number;
  landing_url: string | null;
  material_links: string[] | null;
  output_drive_url: string | null;
  status: TaskState;
  started_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
};

type LandingLibraryItem = {
  landingPageId: number;
  shopifyProductId: string | null;
  productName: string | null;
  productHandle: string | null;
  storeDomain: string | null;
  landingPageUrl: string;
  publishedAt: string | null;
};

type ShopifyStore = {
  id: number;
  domain?: string;
  shopName?: string;
};

type ShopifySimpleProduct = {
  id: string;
  title: string;
  handle: string;
};

type QueueItem = Product & {
  stock: number;
  sold7: number;
  dailyRate7: number;
  sold30: number;
  priorityScore: number;
};

const LANDING_LIBRARY_URL = "https://google.ecom-egypt.com/api/integrations/meta/landing-pages?latestPerProduct=true&limit=200";

function splitLinks(value: string) {
  return value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeName(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

function storeMatches(product: Product, domain: string | null) {
  const d = String(domain || "").toLowerCase().replace(/^www\./, "");
  if (product.sourceStore === "dealme") return d.includes("dealme-eg.com");
  if (product.sourceStore === "buzzpick") return d.includes("buzzpick.net");
  return false;
}

function findLanding(product: Product, items: LandingLibraryItem[]) {
  const exact = items.find((x) =>
    storeMatches(product, x.storeDomain) &&
    String(x.shopifyProductId || "").trim() === String(product.sourceProductId || "").trim()
  );
  if (exact?.landingPageUrl) return exact.landingPageUrl;

  const name = normalizeName(product.name);
  if (!name) return "";
  const byName = items.find((x) =>
    storeMatches(product, x.storeDomain) && normalizeName(x.productName) === name
  );
  return byName?.landingPageUrl || "";
}

function publicProductBase(store: Product["sourceStore"]) {
  return store === "dealme" ? "https://www.dealme-eg.com/products/" : "https://buzzpick.net/products/";
}

function kpi(label: string, value: string | number, sub: string) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="mt-1 text-sm font-bold">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export default function CreativeRoutinePreview() {
  const [products, setProducts] = useState<Product[]>([]);
  const [rates, setRates] = useState<Record<number, SalesRate>>({});
  const [records, setRecords] = useState<Record<number, RoutineRecord>>({});
  const [productUrls, setProductUrls] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(8);
  const [storeFilter, setStoreFilter] = useState<"all" | "dealme" | "buzzpick">("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { landing: string; materials: string; output: string }>>({});
  const [libraryImported, setLibraryImported] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);

  async function persistImportedLanding(productId: number, landingUrl: string) {
    try {
      const res = await fetch(`/api/creative-routine/items/${productId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ landing_url: landingUrl }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { item?: RoutineRecord };
      return data.item ?? null;
    } catch {
      return null;
    }
  }

  async function loadShopifyProductUrls(productList: Product[]) {
    try {
      const storesRes = await fetch("/api/shopify/stores", { credentials: "include" });
      if (!storesRes.ok) return;
      const storesData = await storesRes.json() as { stores?: ShopifyStore[] };
      const stores = Array.isArray(storesData.stores) ? storesData.stores : [];
      if (!stores.length) return;

      const lists = await Promise.allSettled(stores.map(async (store) => {
        const res = await fetch(`/api/shopify/products-simple?storeId=${store.id}`, { credentials: "include" });
        if (!res.ok) return [] as ShopifySimpleProduct[];
        const data = await res.json() as { products?: ShopifySimpleProduct[] };
        return Array.isArray(data.products) ? data.products : [];
      }));

      const handleById = new Map<string, string>();
      for (const result of lists) {
        if (result.status !== "fulfilled") continue;
        for (const p of result.value) {
          if (p.id && p.handle && !handleById.has(String(p.id))) {
            handleById.set(String(p.id), p.handle);
          }
        }
      }

      const nextUrls: Record<number, string> = {};
      for (const product of productList) {
        const handle = handleById.get(String(product.sourceProductId));
        if (!handle) continue;
        nextUrls[product.id] = `${publicProductBase(product.sourceStore)}${encodeURIComponent(handle)}`;
      }
      setProductUrls(nextUrls);
    } catch {
      // Shopify fallback is optional; landing links continue to work if unavailable.
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    setLibraryImported(0);
    try {
      const [pRes, rRes, cRes, libraryRes] = await Promise.all([
        fetch("/api/inventory/products", { credentials: "include" }),
        fetch("/api/inventory/sales-rate", { credentials: "include" }),
        fetch("/api/creative-routine/items", { credentials: "include" }),
        fetch(LANDING_LIBRARY_URL, { mode: "cors", cache: "no-store" }).catch(() => null),
      ]);

      if (!pRes.ok) throw new Error("تعذر تحميل المخزون");
      const p = await pRes.json() as Product[];
      const productList = Array.isArray(p) ? p : [];
      setProducts(productList);
      void loadShopifyProductUrls(productList);

      if (rRes.ok) {
        const r = await rRes.json() as { rates?: Record<number, SalesRate> };
        setRates(r.rates ?? {});
      }

      const next: Record<number, RoutineRecord> = {};
      if (cRes.ok) {
        const c = await cRes.json() as { items?: RoutineRecord[] };
        for (const item of c.items ?? []) next[item.inventory_product_id] = item;
      }

      let library: LandingLibraryItem[] = [];
      if (libraryRes?.ok) {
        const payload = await libraryRes.json() as { data?: LandingLibraryItem[] };
        library = Array.isArray(payload.data) ? payload.data : [];
      }

      const imported: Array<{ productId: number; landing: string }> = [];
      if (library.length) {
        for (const product of productList) {
          if (next[product.id]?.landing_url) continue;
          const landing = findLanding(product, library);
          if (!landing) continue;
          imported.push({ productId: product.id, landing });
          next[product.id] = {
            inventory_product_id: product.id,
            landing_url: landing,
            material_links: next[product.id]?.material_links ?? [],
            output_drive_url: next[product.id]?.output_drive_url ?? null,
            status: next[product.id]?.status ?? "queued",
          };
        }
      }

      setRecords(next);
      setDrafts((prev) => {
        const d = { ...prev };
        for (const product of productList) {
          const item = next[product.id];
          if (!item) continue;
          d[product.id] = {
            landing: item.landing_url ?? "",
            materials: (item.material_links ?? []).join("\n"),
            output: item.output_drive_url ?? "",
          };
        }
        return d;
      });

      if (imported.length) {
        setLibraryImported(imported.length);
        void Promise.allSettled(imported.map(async ({ productId, landing }) => {
          const saved = await persistImportedLanding(productId, landing);
          if (saved) setRecords((prev) => ({ ...prev, [productId]: saved }));
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const eligible = useMemo(() => products
    .map((p) => ({ ...p, stock: p.availableStock ?? p.currentStock ?? 0 }))
    .filter((p) => p.stock > 0)
    .filter((p) => storeFilter === "all" || p.sourceStore === storeFilter), [products, storeFilter]);

  const queue = useMemo<QueueItem[]>(() => eligible
    .map((p) => {
      const rate = rates[p.id];
      const sold7 = Number(rate?.sold7 || 0);
      const dailyRate7 = Number(rate?.dailyRate7 || 0);
      const sold30 = Number(rate?.sold30 || 0);
      const noSalesBoost = sold30 === 0 ? 100000 : 0;
      const lowSalesBoost = Math.max(0, 10000 - (sold30 * 100));
      const stockBoost = Math.min(5000, Math.max(0, p.stock));
      return {
        ...p,
        sold7,
        dailyRate7,
        sold30,
        priorityScore: noSalesBoost + lowSalesBoost + stockBoost,
      };
    })
    .sort((a, b) => {
      if (a.sold30 !== b.sold30) return a.sold30 - b.sold30;
      if (a.sold7 !== b.sold7) return a.sold7 - b.sold7;
      if (a.stock !== b.stock) return b.stock - a.stock;
      return a.name.localeCompare(b.name, "ar");
    })
    .slice(0, dailyLimit), [eligible, rates, dailyLimit]);

  const states = queue.map((item) => records[item.id]?.status ?? "queued");
  const inProgress = states.filter((s) => s === "in_progress").length;
  const review = states.filter((s) => s === "review").length;
  const done = states.filter((s) => s === "done").length;
  const activeQueue = useMemo(() => queue.filter((item) => records[item.id]?.status !== "done"), [queue, records]);
  const completedQueue = useMemo(() => queue.filter((item) => records[item.id]?.status === "done"), [queue, records]);

  function getDraft(id: number) {
    const record = records[id];
    return drafts[id] ?? {
      landing: record?.landing_url ?? "",
      materials: (record?.material_links ?? []).join("\n"),
      output: record?.output_drive_url ?? "",
    };
  }

  function updateDraft(id: number, patch: Partial<{ landing: string; materials: string; output: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...getDraft(id), ...patch } }));
  }

  async function saveRecord(id: number, patch: Partial<{ landing_url: string | null; material_links: string[]; output_drive_url: string | null; status: TaskState }>) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/creative-routine/items/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json() as { item?: RoutineRecord; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error || "تعذر الحفظ");
      setRecords((prev) => ({ ...prev, [id]: data.item! }));
      setDrafts((prev) => ({
        ...prev,
        [id]: {
          landing: data.item!.landing_url ?? "",
          materials: (data.item!.material_links ?? []).join("\n"),
          output: data.item!.output_drive_url ?? "",
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر حفظ المهمة");
    } finally {
      setSavingId(null);
    }
  }

  async function saveLinks(id: number) {
    const d = getDraft(id);
    await saveRecord(id, {
      landing_url: d.landing.trim() || null,
      material_links: splitLinks(d.materials),
      output_drive_url: d.output.trim() || null,
    });
  }

  async function nextState(id: number) {
    const current = records[id]?.status ?? "queued";
    const next: TaskState = current === "queued" ? "in_progress" : current === "in_progress" ? "review" : current === "review" ? "done" : "done";
    const d = getDraft(id);
    if (next === "review" && !d.output.trim()) {
      setError("لازم المونتير يحط لينك Google Drive للشغل النهائي قبل الإرسال للمراجعة");
      setExpanded(id);
      return;
    }
    await saveRecord(id, {
      status: next,
      landing_url: d.landing.trim() || null,
      material_links: splitLinks(d.materials),
      output_drive_url: d.output.trim() || null,
    });
    if (next === "in_progress") setExpanded(id);
    if (next === "done") setExpanded(null);
  }

  const stateLabel = (s: TaskState) => s === "queued" ? "ابدأ المهمة" : s === "in_progress" ? "إرسال للمراجعة" : s === "review" ? "اعتماد وإنهاء" : "مكتمل ✓";

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground pb-16">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1450px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 font-black"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Meta Ads <span className="text-muted-foreground">/</span> روتين الكريتف</div>
          <a href="/overview" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted">رجوع للداشبورد <ArrowRight className="h-3.5 w-3.5" /></a>
        </div>
      </header>

      <main className="mx-auto max-w-[1450px] space-y-5 px-4 py-6 sm:px-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold text-primary"><Sparkles className="h-4 w-4" /> Creative Operations Queue</div>
            <h1 className="text-3xl font-black">مهام الكريتف اليومية</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">الأولوية للمنتجات اللي عليها ستوك ومبيعاتها صفر أو قليلة. لو مفيش Landing Page، النظام يعرض صفحة المنتج الأصلية من Shopify تلقائيًا.</p>
            {libraryImported > 0 && <div className="mt-2 text-xs font-bold text-emerald-600">تم استيراد {libraryImported} رابط لاندينج تلقائيًا من المكتبة.</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value as typeof storeFilter)} className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold">
              <option value="all">كل المتاجر</option><option value="dealme">Dealme</option><option value="buzzpick">Buzzpick</option>
            </select>
            <select value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold">
              {[4, 6, 8, 10, 12, 16].map((n) => <option key={n} value={n}>{n} مهام / يوم</option>)}
            </select>
            <button onClick={load} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"><RefreshCw className="h-4 w-4" /> تحديث الطابور</button>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-500">{error}</div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {kpi("منتجات عليها ستوك", eligible.length, "المؤهلة لدخول الطابور")}
          {kpi("مهام اليوم", queue.length, "الأقل مبيعًا أولًا")}
          {kpi("جاري التنفيذ", inProgress, "المونتير بدأ فيها")}
          {kpi("تحت المراجعة", review, "مستنية اعتماد")}
          {kpi("مكتمل", done, "مخفي من الطابور الرئيسي")}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Package className="h-4 w-4 text-primary" /> ستوك متاح</span><span>→</span>
            <span>أقل مبيعات</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><Link2 className="h-4 w-4 text-primary" /> لاندينج أو صفحة المنتج</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><Film className="h-4 w-4 text-primary" /> مونتاج</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><FolderOpen className="h-4 w-4 text-primary" /> Drive</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> مراجعة</span>
          </div>
        </section>

        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-border bg-card"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {activeQueue.map((item, index) => {
              const record = records[item.id];
              const state = record?.status ?? "queued";
              const isOpen = expanded === item.id;
              const d = getDraft(item.id);
              const materialLinks = splitLinks(d.materials);
              const fallbackProductUrl = productUrls[item.id] || "";
              const primaryProductUrl = d.landing && looksLikeUrl(d.landing) ? d.landing : fallbackProductUrl;
              const hasLanding = !!(d.landing && looksLikeUrl(d.landing));

              return (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-black text-primary">الدور #{index + 1}</span>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold">{item.storeName}</span>
                          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-500">ستوك {item.stock}</span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${item.sold30 === 0 ? "bg-red-500/10 text-red-500" : item.sold30 <= 5 ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"}`}>
                            {item.sold30 === 0 ? "بدون مبيعات 30 يوم" : `مبيعات 30 يوم: ${item.sold30}`}
                          </span>
                          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-bold">{stateLabel(state)}</span>
                        </div>
                        <h2 className="truncate text-lg font-black" title={item.name}>{item.name}</h2>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>مبيعات 7 أيام: <b className="text-foreground">{item.sold7}</b></span>
                          <span>معدل 7 أيام: <b className="text-foreground">{item.dailyRate7.toFixed(1)}/يوم</b></span>
                        </div>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Film className="h-6 w-6" /></div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-border p-3">
                        <div className="mb-1 text-[11px] font-black text-muted-foreground">صفحة المنتج</div>
                        {primaryProductUrl ? (
                          <a href={primaryProductUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-bold text-primary hover:underline">
                            <ExternalLink className="h-3.5 w-3.5" /> {hasLanding ? "فتح اللاندينج بيدج" : "فتح صفحة المنتج على Shopify"}
                          </a>
                        ) : <div className="text-sm text-amber-500">لم يتم العثور على صفحة للمنتج</div>}
                        {!hasLanding && fallbackProductUrl && <div className="mt-1 text-[11px] text-muted-foreground">لا توجد Landing Page مرتبطة، تم استخدام صفحة المنتج الأصلية.</div>}
                      </div>
                      <div className="rounded-xl border border-border p-3">
                        <div className="mb-1 text-[11px] font-black text-muted-foreground">ماتريال الشغل</div>
                        {materialLinks.length ? <div className="text-sm font-bold">{materialLinks.length} لينك جاهز</div> : <div className="text-sm text-amber-500">لا يوجد ماتريال مربوط</div>}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-4 space-y-4 rounded-2xl bg-muted/35 p-4">
                        <div>
                          <div className="mb-1.5 flex items-center gap-2 text-sm font-black"><Link2 className="h-4 w-4 text-primary" /> لينك اللاندينج بيدج</div>
                          <input value={d.landing} onChange={(e) => updateDraft(item.id, { landing: e.target.value })} dir="ltr" placeholder="اختياري — لو مفيش لاندينج هنستخدم صفحة Shopify تلقائيًا" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
                          {!d.landing && fallbackProductUrl && <a href={fallbackProductUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"><ExternalLink className="h-3 w-3" /> فتح صفحة Shopify الحالية</a>}
                        </div>
                        <div>
                          <div className="mb-1.5 flex items-center gap-2 text-sm font-black"><Film className="h-4 w-4 text-primary" /> الماتريال المصدر</div>
                          <textarea value={d.materials} onChange={(e) => updateDraft(item.id, { materials: e.target.value })} dir="ltr" rows={4} placeholder={"كل لينك في سطر لوحده\nTelegram / Google Drive / فيديو مورد / صور المنتج"} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm resize-y" />
                          {materialLinks.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{materialLinks.map((link, i) => looksLikeUrl(link) ? <a key={i} href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-background px-2.5 py-1.5 text-xs font-bold text-primary border border-border"><ExternalLink className="h-3 w-3" /> ماتريال {i + 1}</a> : null)}</div>}
                        </div>
                        <div>
                          <div className="mb-1.5 flex items-center gap-2 text-sm font-black"><FolderOpen className="h-4 w-4 text-primary" /> تسليم الشغل — Google Drive</div>
                          <input value={d.output} onChange={(e) => updateDraft(item.id, { output: e.target.value })} dir="ltr" placeholder="https://drive.google.com/..." className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
                          <p className="mt-1.5 text-xs text-muted-foreground">بعد ما يبدأ المهمة، يحط هنا لينك فولدر أو ملف Drive النهائي. لن يقدر يرسل للمراجعة بدون اللينك.</p>
                        </div>
                        <button onClick={() => saveLinks(item.id)} disabled={savingId === item.id} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold hover:bg-muted disabled:opacity-50">
                          {savingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ اللينكات
                        </button>
                      </div>
                    )}

                    <div className="mt-4 flex items-center gap-2">
                      <button onClick={() => nextState(item.id)} disabled={state === "done" || savingId === item.id}
                        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black ${state === "done" ? "bg-emerald-500/15 text-emerald-500" : "bg-primary text-primary-foreground"}`}>
                        {savingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "queued" ? <Play className="h-4 w-4" /> : state === "in_progress" ? <Clock3 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        {stateLabel(state)}
                      </button>
                      <button onClick={() => setExpanded(isOpen ? null : item.id)} className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2.5 text-xs font-bold hover:bg-muted">
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} التفاصيل واللينكات
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {!loading && completedQueue.length > 0 && (
          <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <button onClick={() => setShowCompleted((value) => !value)} className="flex w-full items-center justify-between gap-3 text-right">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div>
                  <div className="font-black">المكتمل ({completedQueue.length})</div>
                  <div className="text-xs text-muted-foreground">مخفي افتراضيًا علشان الطابور يفضل نظيف</div>
                </div>
              </div>
              {showCompleted ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>

            {showCompleted && (
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {completedQueue.map((item) => {
                  const record = records[item.id];
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-background p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{item.name}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{item.storeName} · ستوك {item.stock}</div>
                      </div>
                      {record?.output_drive_url && (
                        <a href={record.output_drive_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary hover:underline">
                          <FolderOpen className="h-3.5 w-3.5" /> Drive
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
          <div className="flex items-start gap-3"><Users className="mt-0.5 h-5 w-5 text-primary" /><div><h3 className="font-black">منطق الاختيار</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">يدخل الطابور فقط المنتج اللي عليه ستوك. الترتيب: أقل مبيعات 30 يوم أولًا، ثم أقل مبيعات 7 أيام، ثم الستوك الأكبر. المهام المكتملة تختفي من الطابور الرئيسي وتفضل متاحة في قسم المكتمل عند الحاجة.</p></div></div>
        </section>
      </main>
    </div>
  );
}