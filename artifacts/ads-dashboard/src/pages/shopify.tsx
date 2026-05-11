import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API } from "@/context/auth-context";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ShoppingBag,
  Package,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Settings,
  CheckCircle,
} from "lucide-react";

interface ShopifyConfig {
  connected: boolean;
  shop_domain?: string;
  shop_name?: string;
}

interface ShopifyProduct {
  id: string;
  title: string;
  vendor: string;
  product_type: string;
  status: string;
  variants_count: number;
  inventory_quantity: number;
  image_url?: string;
}

interface ShopifyStats {
  total_orders: number;
  total_revenue: number;
  average_order_value: number;
  top_products: { title: string; quantity: number; revenue: number }[];
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString("ar-EG", { maximumFractionDigits: dec });
}

export default function Shopify() {
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "products">("overview");

  const { data: config, refetch: refetchConfig } = useQuery<ShopifyConfig>({
    queryKey: ["shopify-config"],
    queryFn: () =>
      fetch(`${API}/shopify/config`, { credentials: "include" })
        .then((r) => r.json())
        .catch(() => ({ connected: false })),
    staleTime: 60_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ShopifyStats>({
    queryKey: ["shopify-stats"],
    queryFn: () =>
      fetch(`${API}/shopify/stats`, { credentials: "include" }).then((r) => r.json()),
    enabled: config?.connected === true,
    staleTime: 5 * 60_000,
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<ShopifyProduct[]>({
    queryKey: ["shopify-products"],
    queryFn: () =>
      fetch(`${API}/shopify/products`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => d.products ?? []),
    enabled: config?.connected === true,
    staleTime: 5 * 60_000,
  });

  async function saveConfig() {
    if (!shopDomain.trim() || !accessToken.trim()) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetch(`${API}/shopify/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ shop_domain: shopDomain, access_token: accessToken }),
      });
      if (r.ok) {
        setSaveMsg("تم الحفظ بنجاح!");
        refetchConfig();
      } else {
        const d = await r.json();
        setSaveMsg(d.error ?? "فشل الحفظ");
      }
    } catch {
      setSaveMsg("خطأ في الاتصال");
    } finally {
      setSaving(false);
    }
  }

  if (!config?.connected) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6" dir="rtl">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-emerald-400" />
            ربط Shopify
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            اربط متجرك على Shopify لتتبع المبيعات والمنتجات
          </p>
        </div>

        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-3 p-4 bg-amber-950/30 border border-amber-700/40 rounded-xl">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-300">Shopify غير مرتبط</p>
              <p className="text-xs text-amber-500 mt-0.5">
                أدخل بيانات متجرك للاتصال وعرض بيانات المبيعات
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">نطاق المتجر (Shop Domain)</label>
            <input
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              placeholder="your-store.myshopify.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              dir="ltr"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Access Token</label>
            <input
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="shpat_xxxxxxxxxxxx"
              type="password"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              dir="ltr"
            />
            <p className="text-[10px] text-slate-500">
              من Shopify Admin → Apps → Develop Apps → API credentials
            </p>
          </div>

          {saveMsg && (
            <p className={cn("text-xs rounded-lg px-3 py-2",
              saveMsg.includes("نجاح") || saveMsg.includes("تم")
                ? "text-emerald-400 bg-emerald-950/30 border border-emerald-800/40"
                : "text-red-400 bg-red-950/30 border border-red-800/40"
            )}>
              {saveMsg}
            </p>
          )}

          <Button
            onClick={saveConfig}
            disabled={saving || !shopDomain.trim() || !accessToken.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 gap-2"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
            {saving ? "جارٍ الربط..." : "ربط المتجر"}
          </Button>
        </div>
        <AIChatWidget />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-screen-2xl mx-auto space-y-5" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-emerald-400" />
            Shopify
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <p className="text-xs text-emerald-400">{config.shop_name ?? config.shop_domain}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
            <Settings className="w-3.5 h-3.5" /> إعدادات
          </button>
          {config.shop_domain && (
            <a
              href={`https://${config.shop_domain}/admin`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" /> فتح Shopify
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 w-fit">
        {(["overview", "products"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              activeTab === tab ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            )}
          >
            {tab === "overview" ? "📊 نظرة عامة" : "📦 المنتجات"}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-5">
          {/* Stats */}
          {statsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-24 animate-pulse" />
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                  <ShoppingCart className="w-3.5 h-3.5" /> إجمالي الطلبات
                </div>
                <p className="text-2xl font-bold text-white">{fmt(stats.total_orders)}</p>
              </div>
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                  <DollarSign className="w-3.5 h-3.5" /> إجمالي الإيرادات
                </div>
                <p className="text-2xl font-bold text-emerald-400">{fmt(stats.total_revenue, 0)} EGP</p>
              </div>
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                  <TrendingUp className="w-3.5 h-3.5" /> متوسط الطلب
                </div>
                <p className="text-2xl font-bold text-blue-400">{fmt(stats.average_order_value, 0)} EGP</p>
              </div>
            </div>
          ) : null}

          {/* Top Products */}
          {stats?.top_products && stats.top_products.length > 0 && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
              <h2 className="text-sm font-bold text-white mb-4">أفضل المنتجات مبيعاً</h2>
              <div className="space-y-3">
                {stats.top_products.map((p, i) => {
                  const maxRev = stats.top_products[0]?.revenue ?? 1;
                  const pct = (p.revenue / maxRev) * 100;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-500 w-4">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-white font-medium truncate">{p.title}</p>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-slate-400">{p.quantity} قطعة</span>
                            <span className="text-xs font-bold text-emerald-400">{fmt(p.revenue, 0)} EGP</span>
                          </div>
                        </div>
                        <div className="bg-slate-700 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "products" && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">المنتجات ({products.length})</h2>
            {productsLoading && <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="px-4 py-2.5 text-right font-medium">المنتج</th>
                  <th className="px-4 py-2.5 text-right font-medium">العلامة</th>
                  <th className="px-4 py-2.5 text-right font-medium">النوع</th>
                  <th className="px-4 py-2.5 text-right font-medium">المتغيرات</th>
                  <th className="px-4 py-2.5 text-right font-medium">المخزون</th>
                  <th className="px-4 py-2.5 text-right font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {productsLoading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-700/50">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-slate-700 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))}
                {!productsLoading && products.map((p) => (
                  <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.title} className="w-8 h-8 rounded object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center">
                            <Package className="w-4 h-4 text-slate-500" />
                          </div>
                        )}
                        <p className="font-medium text-white truncate max-w-[200px]">{p.title}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{p.vendor || "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{p.product_type || "—"}</td>
                    <td className="px-4 py-3 text-slate-300 text-center">{p.variants_count}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn("font-medium", p.inventory_quantity > 10 ? "text-emerald-400" : p.inventory_quantity > 0 ? "text-amber-400" : "text-red-400")}>
                        {p.inventory_quantity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold",
                        p.status === "active" ? "bg-emerald-900/60 text-emerald-400" : "bg-slate-700 text-slate-400"
                      )}>
                        {p.status === "active" ? "نشط" : p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AIChatWidget />
    </div>
  );
}
