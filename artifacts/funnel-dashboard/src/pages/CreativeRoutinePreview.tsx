import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronUp, Clock3, ExternalLink,
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

type QueueItem = Product & {
  stock: number;
  dailyRate7: number;
  sold30: number;
  priorityScore: number;
  angle: string;
  hook: string;
  visual: string;
};

const LANDING_LIBRARY_URL = "https://google.ecom-egypt.com/api/integrations/meta/landing-pages?latestPerProduct=true&limit=200";

const ANGLES = [
  "المشكلة → الحل",
  "إظهار الواو فاكتور",
  "استخدام يومي واقعي",
  "اعتراض شائع ثم الرد عليه",
  "قبل / بعد بشكل بصري",
  "UGC وتجربة أول مرة",
  "3 أسباب تخليك تستخدمه",
];

const HOOKS = [
  "المشكلة دي بتحصل كل يوم من غير ما تاخد بالك…",
  "أول 3 ثواني هنا هي كل الفرق.",
  "لو المنتج بيتشرح في لقطة واحدة، فهي دي.",
  "بدل ما نشرح كتير… خلّي النتيجة تتكلم.",
  "مش إعلان تقليدي: ورّي الاستخدام الحقيقي فورًا.",
  "ابدأ بالمشهد اللي يخلي المشاهد يقول: إيه ده؟",
];

function hashNumber(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = Math.imul(31, h) + input.charCodeAt(i) | 0;
  return Math.abs(h);
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(8);
  const [storeFilter, setStoreFilter] = useState<"all" | "dealme" | "buzzpick">("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { landing: string; materials: string; output: string }>>({});
  const [libraryImported, setLibraryImported] = useState(0);

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
      const dailyRate7 = Number(rate?.dailyRate7 || 0);
      const sold30 = Number(rate?.sold30 || 0);
      const h = hashNumber(`${p.id}-${new Date().toISOString().slice(0, 10)}`);
      const priorityScore = 40 + (h % 55) + Math.min(30, Math.round(Math.log10(Math.max(1, p.stock)) * 12)) + Math.min(25, Math.round(dailyRate7 * 4));
      return {
        ...p,
        dailyRate7,
        sold30,
        priorityScore,
        angle: ANGLES[h % ANGLES.length],
        hook: HOOKS[(h + 2) % HOOKS.length],
        visual: dailyRate7 > 2
          ? "ابدأ بلقطة استخدام سريعة جدًا ثم اقفل على النتيجة قبل شرح التفاصيل."
          : "ابدأ بالمشكلة بصريًا ثم دخّل المنتج كحل في لقطة واحدة واضحة.",
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, dailyLimit), [eligible, rates, dailyLimit]);

  const states = queue.map((item) => records[item.id]?.status ?? "queued");
  const inProgress = states.filter((s) => s === "in_progress").length;
  const review = states.filter((s) => s === "review").length;
  const done = states.filter((s) => s === "done").length;

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
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">اللاندينج بيدج يتم استيرادها تلقائيًا من مكتبة Google Dashboard ومطابقتها مع المنتج حسب Shopify Product ID والمتجر.</p>
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
          {kpi("منتجات مؤهلة", eligible.length, "عليها مخزون حاليًا")}
          {kpi("مهام اليوم", queue.length, `من أصل ${eligible.length} منتج مؤهل`)}
          {kpi("جاري التنفيذ", inProgress, "المونتير بدأ فيها")}
          {kpi("تحت المراجعة", review, "مستنية اعتماد")}
          {kpi("مكتمل", done, "تم إغلاقها")}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Package className="h-4 w-4 text-primary" /> مخزون</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><Link2 className="h-4 w-4 text-primary" /> لاندينج + ماتريال</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><Bot className="h-4 w-4 text-primary" /> AI Brief</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><Film className="h-4 w-4 text-primary" /> مونتاج</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><FolderOpen className="h-4 w-4 text-primary" /> Drive</span><span>→</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> مراجعة</span>
          </div>
        </section>

        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-border bg-card"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {queue.map((item, index) => {
              const record = records[item.id];
              const state = record?.status ?? "queued";
              const isOpen = expanded === item.id;
              const d = getDraft(item.id);
              const materialLinks = splitLinks(d.materials);
              return (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-black text-primary">الدور #{index + 1}</span>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold">{item.storeName}</span>
                          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-500">ستوك {item.stock}</span>
                          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-bold">{stateLabel(state)}</span>
                        </div>
                        <h2 className="truncate text-lg font-black" title={item.name}>{item.name}</h2>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>مبيعات 30 يوم: <b className="text-foreground">{item.sold30}</b></span>
                          <span>معدل 7 أيام: <b className="text-foreground">{item.dailyRate7.toFixed(1)}/يوم</b></span>
                        </div>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Film className="h-6 w-6" /></div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-border p-3">
                        <div className="mb-1 text-[11px] font-black text-muted-foreground">صفحة المنتج</div>
                        {d.landing && looksLikeUrl(d.landing) ? (
                          <a href={d.landing} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-bold text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" /> فتح اللاندينج بيدج</a>
                        ) : <div className="text-sm text-amber-500">لم يتم ربط اللاندينج بعد</div>}
                      </div>
                      <div className="rounded-xl border border-border p-3">
                        <div className="mb-1 text-[11px] font-black text-muted-foreground">ماتريال الشغل</div>
                        {materialLinks.length ? <div className="text-sm font-bold">{materialLinks.length} لينك جاهز</div> : <div className="text-sm text-amber-500">لا يوجد ماتريال مربوط</div>}
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-black text-primary"><Bot className="h-4 w-4" /> البريف المقترح</div>
                      <div className="space-y-2 text-sm">
                        <p><span className="font-bold text-muted-foreground">الزاوية:</span> <b>{item.angle}</b></p>
                        <p className="leading-6"><span className="font-bold text-muted-foreground">الهوك:</span> {item.hook}</p>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-4 space-y-4 rounded-2xl bg-muted/35 p-4">
                        <div>
                          <div className="mb-1.5 flex items-center gap-2 text-sm font-black"><Link2 className="h-4 w-4 text-primary" /> لينك اللاندينج بيدج</div>
                          <input value={d.landing} onChange={(e) => updateDraft(item.id, { landing: e.target.value })} dir="ltr" placeholder="https://dealme-eg.com/pages/..." className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
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
                        <div><span className="font-black text-sm">Visual Hook</span><p className="mt-1 text-sm leading-6 text-muted-foreground">{item.visual}</p></div>
                        <div className="grid gap-2 sm:grid-cols-4">
                          {["0–3ث: هوك", "3–7ث: المنتج", "7–14ث: Demo", "14–18ث: CTA"].map((x) => <div key={x} className="rounded-xl border border-border bg-background p-2.5 text-center text-xs font-bold">{x}</div>)}
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

        <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
          <div className="flex items-start gap-3"><Users className="mt-0.5 h-5 w-5 text-primary" /><div><h3 className="font-black">طريقة الشغل</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">اللاندينج تتسحب تلقائيًا من مكتبة Google Dashboard. المونتير يضغط ابدأ، يفتح اللاندينج والماتريال، ينفذ، يحط لينك Drive، ثم يرسل للمراجعة.</p></div></div>
        </section>
      </main>
    </div>
  );
}
