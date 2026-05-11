import { BarChart3, TrendingUp, TrendingDown, DollarSign, MousePointerClick, Target, Eye, RefreshCw } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon: React.ReactNode;
  color: string;
}

function KpiCard({ label, value, sub, trend, trendValue, icon, color }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${color}`}>
          {icon}
        </div>
        {trend && trendValue && (
          <div className={`flex items-center gap-1 text-[12px] font-medium rounded-full px-2 py-0.5 ${
            trend === "up" ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400"
            : trend === "down" ? "text-red-500 bg-red-50 dark:bg-red-900/20 dark:text-red-400"
            : "text-muted-foreground bg-muted/60"
          }`}>
            {trend === "up" ? <TrendingUp className="h-3 w-3" /> : trend === "down" ? <TrendingDown className="h-3 w-3" /> : null}
            {trendValue}
          </div>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground num">{value}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const SAMPLE_CAMPAIGNS = [
  { name: "Brand Awareness - Q2", status: "ENABLED", impressions: 124500, clicks: 3210, ctr: 2.58, cpc: 1.42, conversions: 87, cpa: 52.45, spend: 4563, roas: 4.2 },
  { name: "Competitor Keywords", status: "ENABLED", impressions: 89200, clicks: 4105, ctr: 4.60, cpc: 2.10, conversions: 143, cpa: 60.28, spend: 8619, roas: 3.1 },
  { name: "Remarketing - Cart Abandoners", status: "ENABLED", impressions: 32100, clicks: 1890, ctr: 5.89, cpc: 0.95, conversions: 210, cpa: 8.55, spend: 1795, roas: 7.8 },
  { name: "Product Launch - Summer", status: "PAUSED", impressions: 67800, clicks: 2340, ctr: 3.45, cpc: 1.78, conversions: 65, cpa: 64.12, spend: 4168, roas: 2.4 },
  { name: "Local Services", status: "ENABLED", impressions: 21400, clicks: 890, ctr: 4.16, cpc: 3.20, conversions: 34, cpa: 83.82, spend: 2850, roas: 1.9 },
];

const totalSpend = SAMPLE_CAMPAIGNS.reduce((s, c) => s + c.spend, 0);
const totalClicks = SAMPLE_CAMPAIGNS.reduce((s, c) => s + c.clicks, 0);
const totalImpressions = SAMPLE_CAMPAIGNS.reduce((s, c) => s + c.impressions, 0);
const totalConversions = SAMPLE_CAMPAIGNS.reduce((s, c) => s + c.conversions, 0);
const avgCtr = (totalClicks / totalImpressions) * 100;
const avgCpc = totalSpend / totalClicks;
const avgCpa = totalSpend / totalConversions;

function fmt(n: number, dec = 0) { return n.toLocaleString("en-US", { maximumFractionDigits: dec }); }

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Page header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              لوحة تحكم Google Ads
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">بيانات تجريبية — ربط الـ API قريباً</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm text-muted-foreground hover:bg-muted/60 transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث البيانات
          </button>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="إجمالي الإنفاق" value={`$${fmt(totalSpend)}`} sub="آخر 30 يوم" trend="up" trendValue="+12%" icon={<DollarSign className="h-4 w-4 text-blue-600" />} color="bg-blue-500/10" />
          <KpiCard label="النقرات" value={fmt(totalClicks)} sub="إجمالي النقرات" trend="up" trendValue="+8%" icon={<MousePointerClick className="h-4 w-4 text-indigo-600" />} color="bg-indigo-500/10" />
          <KpiCard label="الظهور" value={fmt(totalImpressions)} sub="مرة" trend="neutral" trendValue="±2%" icon={<Eye className="h-4 w-4 text-purple-600" />} color="bg-purple-500/10" />
          <KpiCard label="متوسط CTR" value={`${avgCtr.toFixed(2)}%`} trend="up" trendValue="+0.3%" icon={<TrendingUp className="h-4 w-4 text-emerald-600" />} color="bg-emerald-500/10" />
          <KpiCard label="متوسط CPC" value={`$${avgCpc.toFixed(2)}`} trend="down" trendValue="-5%" icon={<DollarSign className="h-4 w-4 text-amber-600" />} color="bg-amber-500/10" />
          <KpiCard label="متوسط CPA" value={`$${avgCpa.toFixed(2)}`} sub={`${fmt(totalConversions)} تحويل`} trend="up" trendValue="+3%" icon={<Target className="h-4 w-4 text-red-500" />} color="bg-red-500/10" />
        </div>

        {/* Campaigns table */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">الحملات النشطة</h2>
            <span className="text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">{SAMPLE_CAMPAIGNS.length} حملة</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/30 border-b border-border">
                <tr>
                  {["الحملة", "الحالة", "الظهور", "النقرات", "CTR", "CPC", "التحويلات", "CPA", "ROAS", "الإنفاق"].map(h => (
                    <th key={h} className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SAMPLE_CAMPAIGNS.map((c, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground max-w-[200px] truncate" title={c.name}>{c.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${c.status === "ENABLED" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.status === "ENABLED" ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                        {c.status === "ENABLED" ? "نشطة" : "موقوفة"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground num">{fmt(c.impressions)}</td>
                    <td className="px-4 py-3 text-muted-foreground num">{fmt(c.clicks)}</td>
                    <td className="px-4 py-3 num">
                      <span className={c.ctr >= 4 ? "text-emerald-600 font-medium" : c.ctr < 2 ? "text-red-500" : "text-foreground/80"}>
                        {c.ctr.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground num">${c.cpc.toFixed(2)}</td>
                    <td className="px-4 py-3 text-muted-foreground num">{fmt(c.conversions)}</td>
                    <td className="px-4 py-3 num">
                      <span className={c.cpa <= 30 ? "text-emerald-600 font-medium" : c.cpa > 80 ? "text-red-500 font-medium" : "text-foreground/80"}>
                        ${c.cpa.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 num">
                      <span className={c.roas >= 4 ? "text-emerald-600 font-medium" : c.roas < 2 ? "text-red-500" : "text-foreground/80"}>
                        {c.roas.toFixed(1)}×
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground num">${fmt(c.spend)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/20 border-t border-border">
                <tr>
                  <td className="px-4 py-3 font-semibold text-foreground" colSpan={2}>الإجمالي</td>
                  <td className="px-4 py-3 font-semibold num">{fmt(totalImpressions)}</td>
                  <td className="px-4 py-3 font-semibold num">{fmt(totalClicks)}</td>
                  <td className="px-4 py-3 font-semibold num">{avgCtr.toFixed(2)}%</td>
                  <td className="px-4 py-3 font-semibold num">${avgCpc.toFixed(2)}</td>
                  <td className="px-4 py-3 font-semibold num">{fmt(totalConversions)}</td>
                  <td className="px-4 py-3 font-semibold num">${avgCpa.toFixed(2)}</td>
                  <td className="px-4 py-3 font-semibold num">—</td>
                  <td className="px-4 py-3 font-semibold num">${fmt(totalSpend)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Bottom note */}
        <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary/80 text-center">
          البيانات المعروضة تجريبية. استخدم مساعد الذكاء الاصطناعي (الزر الأزرق في الأسفل) لطرح أسئلتك عن Google Ads.
        </div>
      </div>
    </div>
  );
}
