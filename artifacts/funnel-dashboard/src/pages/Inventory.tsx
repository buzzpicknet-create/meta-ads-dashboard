import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Search, Package, AlertTriangle, CheckCircle, Warehouse, Clock, X, TrendingDown, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const INVENTORY_BASE = "https://inventory-flow-seomasr.replit.app";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LOW_STOCK_THRESHOLD = 10;
const ALERT_WAREHOUSE = "مخزن السوق";

const API = "https://dashboards-jt0h.onrender.com";

interface Product {
  id: number;
  name: string;
  sku: string;
  unit: string;
  currentStock: number;
  minStock: number;
  sellingPrice: number | null;
  costPrice: number | null;
  warehouseLocation: string;
  isBundle: boolean;
  updatedAt: string;
}

interface Stats {
  totalProducts: number;
  lowStockCount: number;
  totalMovementsToday: number;
  totalSalesToday: number;
  totalInToday: number;
}

type StockFilter = "all" | "available" | "zero" | "no_movement";
type SortKey = "name" | "stock_asc" | "stock_desc" | "updated";

function useCountdown(targetMs: number) {
  const [remaining, setRemaining] = useState(targetMs - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(targetMs - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  const secs = Math.max(0, Math.floor(remaining / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className={`rounded-xl border bg-card p-4 flex flex-col gap-1 ${color}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function StockBadge({ stock, minStock }: { stock: number; minStock: number }) {
  if (stock === 0) {
    return <Badge variant="destructive" className="text-xs">نفذ</Badge>;
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return <Badge className="text-xs bg-amber-500 hover:bg-amber-500">{stock} ⚠️</Badge>;
  }
  if (minStock > 0 && stock <= minStock) {
    return <Badge className="text-xs bg-amber-500 hover:bg-amber-500">منخفض</Badge>;
  }
  return <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">{stock}</Badge>;
}

export default function InventoryPage() {
  const [products, setProducts]       = useState<Product[]>([]);
  const [stats, setStats]             = useState<Stats | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nextRefresh, setNextRefresh] = useState<number>(Date.now() + REFRESH_INTERVAL_MS);

  const [search, setSearch]               = useState("");
  const [warehouse, setWarehouse]         = useState<string>("all");
  const [stockFilter, setStockFilter]     = useState<StockFilter>("all");
  const [sort, setSort]                   = useState<SortKey>("stock_desc");

  // "دون حركة مبيعات" filter data
  const [noMovementIds, setNoMovementIds]     = useState<Set<number> | null>(null);
  const [loadingMovement, setLoadingMovement] = useState(false);
  const [movementSince, setMovementSince]     = useState<string | null>(null);

  const countdown = useCountdown(nextRefresh);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, statsRes] = await Promise.all([
        fetch(`${INVENTORY_BASE}/api/products`),
        fetch(`${INVENTORY_BASE}/api/products/stats`),
      ]);
      if (!prodRes.ok)  throw new Error(`Products API: ${prodRes.status}`);
      if (!statsRes.ok) throw new Error(`Stats API: ${statsRes.status}`);
      const [prod, st] = await Promise.all([prodRes.json(), statsRes.json()]);
      setProducts(prod);
      setStats(st);
      setLastUpdated(new Date());
      setNextRefresh(Date.now() + REFRESH_INTERVAL_MS);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchNoMovement = useCallback(async () => {
    setLoadingMovement(true);
    try {
      const res = await fetch(`${API}/inventory/no-movement`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: { sinceDate: string; activeProductIds: number[] } = await res.json();
      setNoMovementIds(new Set(data.activeProductIds));
      setMovementSince(data.sinceDate);
    } catch {
      setNoMovementIds(new Set()); // empty set = show all as "no movement" on error
    } finally {
      setLoadingMovement(false);
    }
  }, []);

  // Load movement data when filter is activated + auto-select مخزن السوق
  useEffect(() => {
    if (stockFilter === "no_movement") {
      if (noMovementIds === null) fetchNoMovement();
      // Auto-scope to the alert warehouse
      setWarehouse(ALERT_WAREHOUSE);
    }
  }, [stockFilter, noMovementIds, fetchNoMovement]);

  // Initial load
  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30 minutes
  useEffect(() => {
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // Derived warehouse list
  const warehouses = useMemo(() => {
    const locs = Array.from(new Set(products.map(p => p.warehouseLocation).filter(Boolean)));
    return locs.sort();
  }, [products]);

  // Filtered + sorted products
  const filtered = useMemo(() => {
    let list = products;

    if (warehouse !== "all") list = list.filter(p => p.warehouseLocation === warehouse);

    if (stockFilter === "available")    list = list.filter(p => p.currentStock > 0);
    else if (stockFilter === "zero")    list = list.filter(p => p.currentStock === 0);
    else if (stockFilter === "no_movement" && noMovementIds !== null) {
      list = list.filter(p => !noMovementIds.has(p.id));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      if (sort === "stock_asc")  return a.currentStock - b.currentStock;
      if (sort === "stock_desc") return b.currentStock - a.currentStock;
      if (sort === "name")       return a.name.localeCompare(b.name, "ar");
      if (sort === "updated")    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return 0;
    });

    return list;
  }, [products, warehouse, stockFilter, search, sort, noMovementIds]);

  // KPIs
  const availableCount = products.filter(p => p.currentStock > 0).length;
  const zeroCount      = products.filter(p => p.currentStock === 0).length;
  const totalUnits     = products.reduce((s, p) => s + p.currentStock, 0);
  // Low-stock banner only for مخزن السوق
  const lowStockList   = products.filter(
    p => p.warehouseLocation === ALERT_WAREHOUSE && p.currentStock > 0 && p.currentStock <= LOW_STOCK_THRESHOLD
  );

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">المخزون</h1>
            <p className="text-sm text-muted-foreground">
              {lastUpdated
                ? `آخر تحديث: ${lastUpdated.toLocaleTimeString("ar-EG")} — التحديث القادم بعد ${countdown}`
                : "جاري التحميل..."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "يتحدث..." : "تحديث الآن"}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Low-stock alert banner */}
        {!loading && lowStockList.length > 0 && (
          <div className="rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Bell className="h-4 w-4 shrink-0" />
              <span className="font-semibold text-sm">
                {lowStockList.length} صنف وصلت كميته لأقل من {LOW_STOCK_THRESHOLD} قطع — يلزم إعادة تعبئة
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lowStockList.slice(0, 8).map(p => (
                <span
                  key={p.id}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 font-medium"
                >
                  {p.name} — {p.currentStock}
                </span>
              ))}
              {lowStockList.length > 8 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200">
                  +{lowStockList.length - 8} أصناف أخرى
                </span>
              )}
            </div>
          </div>
        )}

        {/* KPI Cards */}
        {!loading && products.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="إجمالي الأصناف"
              value={stats?.totalProducts ?? products.length}
              color="border-border"
            />
            <KpiCard
              label="متاح في المخزن"
              value={availableCount}
              sub={`${totalUnits.toLocaleString("ar-EG")} وحدة إجمالاً`}
              color="border-emerald-200 dark:border-emerald-900"
            />
            <KpiCard
              label="نفذ من المخزن"
              value={zeroCount}
              color={zeroCount > 0 ? "border-red-200 dark:border-red-900" : "border-border"}
            />
            <KpiCard
              label="حركات اليوم"
              value={stats?.totalMovementsToday ?? 0}
              sub={stats ? `مبيعات: ${stats.totalSalesToday} · وارد: ${stats.totalInToday}` : undefined}
              color="border-border"
            />
          </div>
        )}

        {/* Skeleton KPIs while loading */}
        {loading && products.length === 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => (
              <div key={i} className="rounded-xl border bg-card p-4 h-20 animate-pulse bg-muted/40" />
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="ابحث بالاسم أو الكود..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-8 h-8 text-sm"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Warehouse filter */}
          <div className="flex items-center gap-1">
            <Warehouse className="h-4 w-4 text-muted-foreground" />
            {["all", ...warehouses].map(loc => (
              <button
                key={loc}
                onClick={() => setWarehouse(loc)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  warehouse === loc
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:border-primary/50"
                }`}
              >
                {loc === "all" ? "الكل" : loc}
              </button>
            ))}
          </div>

          {/* Stock filter */}
          <div className="flex items-center gap-1">
            {([
              ["all",         "الكل",              ""],
              ["available",   "متاح",              ""],
              ["zero",        "نفذ",               ""],
              ["no_movement", "دون حركة مبيعات",   ""],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setStockFilter(val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 ${
                  stockFilter === val
                    ? val === "zero"        ? "bg-red-600 text-white border-red-600"
                    : val === "available"   ? "bg-emerald-600 text-white border-emerald-600"
                    : val === "no_movement" ? "bg-orange-500 text-white border-orange-500"
                    : "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:border-primary/50"
                }`}
              >
                {val === "no_movement" && <TrendingDown className="h-3 w-3" />}
                {label}
                {val === "no_movement" && loadingMovement && (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                )}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="h-8 text-xs rounded-lg border border-border bg-background px-2 pr-2 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="stock_desc">الأعلى كمية أولاً</option>
            <option value="stock_asc">الأقل كمية أولاً</option>
            <option value="name">الاسم أبجدياً</option>
            <option value="updated">آخر تحديث</option>
          </select>

          {/* Result count */}
          <span className="text-xs text-muted-foreground mr-auto">
            {filtered.length.toLocaleString("ar-EG")} صنف
            {stockFilter === "no_movement" && movementSince && (
              <span className="mr-1 text-orange-500">· لا حركة منذ {movementSince}</span>
            )}
          </span>
        </div>

        {/* no_movement loading state */}
        {stockFilter === "no_movement" && loadingMovement && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            جاري تحليل حركات المخزون خلال آخر 10 أيام...
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground w-12">#</th>
                  <th className="text-right px-4 py-3 font-semibold">الصنف</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted-foreground">الكود</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted-foreground">المخزن</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted-foreground">الوحدة</th>
                  <th className="text-center px-4 py-3 font-semibold">الكمية</th>
                </tr>
              </thead>
              <tbody>
                {loading && products.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[1,2,3,4,5,6].map(j => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 rounded bg-muted/60 animate-pulse" style={{ width: j === 2 ? "80%" : j === 1 ? "40px" : "60%" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-muted-foreground">
                      {stockFilter === "no_movement" && loadingMovement
                        ? "جاري تحميل بيانات الحركة..."
                        : "لا توجد أصناف مطابقة للبحث"}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p, idx) => (
                    <tr
                      key={p.id}
                      className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                        p.currentStock === 0
                          ? "bg-red-50/30 dark:bg-red-950/10"
                          : p.currentStock <= LOW_STOCK_THRESHOLD
                          ? "bg-amber-50/30 dark:bg-amber-950/10"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {p.currentStock === 0
                            ? <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                            : p.currentStock <= LOW_STOCK_THRESHOLD
                            ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            : <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          }
                          <span className={p.currentStock === 0 ? "text-muted-foreground" : ""}>{p.name}</span>
                          {p.isBundle && <Badge variant="outline" className="text-[10px] h-4 px-1">مجموعة</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground font-mono text-xs">{p.sku || "—"}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs bg-muted px-2 py-0.5 rounded-md">{p.warehouseLocation || "—"}</span>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-xs">{p.unit}</td>
                      <td className="px-4 py-3 text-center">
                        <StockBadge stock={p.currentStock} minStock={p.minStock} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer note */}
        {lastUpdated && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pb-4">
            <Clock className="h-3.5 w-3.5" />
            <span>البيانات من نظام InventoryFlow — تتحدث تلقائياً كل 30 دقيقة · تنبيهات المخزون تُرسل كل 30 دقيقة</span>
          </div>
        )}
      </div>
    </div>
  );
}
