import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronUp, Clock3,
  Film, Loader2, Package, Play, RefreshCw, Sparkles, Target, Users,
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

type QueueItem = Product & {
  stock: number;
  dailyRate7: number;
  sold30: number;
  priorityScore: number;
  angle: string;
  hook: string;
  visual: string;
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(8);
  const [storeFilter, setStoreFilter] = useState<"all" | "dealme" | "buzzpick">("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [taskState, setTaskState] = useState<Record<number, TaskState>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch("/api/inventory/products", { credentials: "include" }),
        fetch("/api/inventory/sales-rate", { credentials: "include" }),
      ]);
      if (!pRes.ok) throw new Error("تعذر تحميل المخزون");
      const p = await pRes.json() as Product[];
      setProducts(Array.isArray(p) ? p : []);
      if (rRes.ok) {
        const r = await rRes.json() as { rates?: Record<number, SalesRate> };
        setRates(r.rates ?? {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const eligible = useMemo(() => {
    return products
      .map((p) => ({ ...p, stock: p.availableStock ?? p.currentStock ?? 0 }))
      .filter((p) => p.stock > 0)
      .filter((p) => storeFilter === "all" || p.sourceStore === storeFilter);
  }, [products, storeFilter]);

  const queue = useMemo<QueueItem[]>(() => {
    return eligible
      .map((p) => {
        const rate = rates[p.id];
        const dailyRate7 = Number(rate?.dailyRate7 || 0);
        const sold30 = Number(rate?.sold30 || 0);
        const h = hashNumber(`${p.id}-${new Date().toISOString().slice(0, 10)}`);
        const fairnessSeed = 40 + (h % 55);
        const stockBoost = Math.min(30, Math.round(Math.log10(Math.max(1, p.stock)) * 12));
        const activityBoost = Math.min(25, Math.round(dailyRate7 * 4));
        const priorityScore = fairnessSeed + stockBoost + activityBoost;
        const angle = ANGLES[h % ANGLES.length];
        const hook = HOOKS[(h + 2) % HOOKS.length];
        const visual = dailyRate7 > 2
          ? "ابدأ بلقطة استخدام سريعة جدًا ثم اقفل على النتيجة قبل شرح التفاصيل."
          : "ابدأ بالمشكلة بصريًا ثم دخّل المنتج كحل في لقطة واحدة واضحة.";
        return { ...p, dailyRate7, sold30, priorityScore, angle, hook, visual };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, dailyLimit);
  }, [eligible, rates, dailyLimit]);

  const inProgress = Object.values(taskState).filter((s) => s === "in_progress").length;
  const review = Object.values(taskState).filter((s) => s === "review").length;
  const done = Object.values(taskState).filter((s) => s === "done").length;

  function nextState(id: number) {
    setTaskState((prev) => {
      const current = prev[id] ?? "queued";
      const next: TaskState = current === "queued" ? "in_progress" : current === "in_progress" ? "review" : current === "review" ? "done" : "queued";
      return { ...prev, [id]: next };
    });
  }

  const stateLabel = (s: TaskState) => s === "queued" ? "ابدأ المهمة" : s === "in_progress" ? "إرسال للمراجعة" : s === "review" ? "اعتماد وإنهاء" : "مكتمل ✓";

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground pb-16">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1450px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 font-black">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Meta Ads
            <span className="text-muted-foreground">/</span>
            <span>روتين الكريتف</span>
          </div>
          <a href="/overview" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted">
            رجوع للداشبورد <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1450px] space-y-5 px-4 py-6 sm:px-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold text-primary">
              <Sparkles className="h-4 w-4" /> Creative Operations Queue
            </div>
            <h1 className="text-3xl font-black">مهام الكريتف اليومية</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              المنتجات اللي عليها مخزون تدخل طابور واحد. النظام يرتبها بدون تكرار عشوائي، ثم يجهز لكل منتج زاوية وهوك وبريف تنفيذ قبل ما يبدأ المونتير.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value as typeof storeFilter)} className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold">
              <option value="all">كل المتاجر</option>
              <option value="dealme">Dealme</option>
              <option value="buzzpick">Buzzpick</option>
            </select>
            <select value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold">
              {[4, 6, 8, 10, 12, 16].map((n) => <option key={n} value={n}>{n} مهام / يوم</option>)}
            </select>
            <button onClick={load} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
              <RefreshCw className="h-4 w-4" /> تحديث الطابور
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {kpi("منتجات مؤهلة", eligible.length, "عليها مخزون حاليًا")}
          {kpi("مهام اليوم", queue.length, `من أصل ${eligible.length} منتج مؤهل`)}
          {kpi("جاري التنفيذ", inProgress, "المونتير بدأ فيها")}
          {kpi("تحت المراجعة", review, "مستنية اعتماد")}
          {kpi("مكتمل", done, "تم إغلاقها اليوم")}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Package className="h-4 w-4 text-primary" /> مخزون حقيقي</span>
            <span>→</span>
            <span className="inline-flex items-center gap-1.5"><Target className="h-4 w-4 text-primary" /> ترتيب عادل</span>
            <span>→</span>
            <span className="inline-flex items-center gap-1.5"><Bot className="h-4 w-4 text-primary" /> AI Brief</span>
            <span>→</span>
            <span className="inline-flex items-center gap-1.5"><Film className="h-4 w-4 text-primary" /> مونتاج</span>
            <span>→</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> مراجعة واعتماد</span>
          </div>
        </section>

        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-border bg-card">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm font-bold text-red-500">{error}</div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {queue.map((item, index) => {
              const state = taskState[item.id] ?? "queued";
              const isOpen = expanded === item.id;
              return (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-black text-primary">الدور #{index + 1}</span>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold">{item.storeName}</span>
                          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-500">ستوك {item.stock}</span>
                        </div>
                        <h2 className="truncate text-lg font-black" title={item.name}>{item.name}</h2>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>مبيعات 30 يوم: <b className="text-foreground">{item.sold30}</b></span>
                          <span>معدل 7 أيام: <b className="text-foreground">{item.dailyRate7.toFixed(1)}/يوم</b></span>
                          <span>Priority: <b className="text-foreground">{item.priorityScore}</b></span>
                        </div>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Film className="h-6 w-6" />
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
                      <div className="mt-4 space-y-3 rounded-2xl bg-muted/35 p-4 text-sm">
                        <div><span className="font-black">Visual Hook:</span><p className="mt-1 leading-6 text-muted-foreground">{item.visual}</p></div>
                        <div className="grid gap-2 sm:grid-cols-4">
                          {["0–3ث: هوك", "3–7ث: المنتج", "7–14ث: Demo", "14–18ث: CTA"].map((x) => <div key={x} className="rounded-xl border border-border bg-background p-2.5 text-center text-xs font-bold">{x}</div>)}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-bold">
                          <span className="rounded-lg bg-background px-2.5 py-1.5">9:16</span>
                          <span className="rounded-lg bg-background px-2.5 py-1.5">15–20 ثانية</span>
                          <span className="rounded-lg bg-background px-2.5 py-1.5">3 Hooks</span>
                          <span className="rounded-lg bg-background px-2.5 py-1.5">نسخة نص + بدون نص</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex items-center gap-2">
                      <button onClick={() => nextState(item.id)} disabled={state === "done"}
                        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition-colors ${state === "done" ? "bg-emerald-500/15 text-emerald-500" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
                        {state === "queued" && <Play className="h-4 w-4" />}
                        {state === "in_progress" && <Clock3 className="h-4 w-4" />}
                        {state === "review" && <CheckCircle2 className="h-4 w-4" />}
                        {stateLabel(state)}
                      </button>
                      <button onClick={() => setExpanded(isOpen ? null : item.id)} className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2.5 text-xs font-bold hover:bg-muted">
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        التفاصيل
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <h3 className="font-black">دي نسخة المعاينة قبل التشغيل التلقائي</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">الصفحة حاليًا تقرأ المخزون ومعدل البيع الحقيقيين وتكوّن طابور يومي للعرض. بعد اعتماد الشكل، الخطوة التالية هي حفظ الـCreative History في قاعدة البيانات، توزيع التاسكات على فريق المونتاج، وتشغيل AI Brief فعلي وجدولة يومية على السيرفر.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
