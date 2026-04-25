import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ShoppingCart,
  Target,
  MousePointerClick,
  Eye,
  CircleDollarSign,
  Activity,
  Rocket,
  XCircle,
  Menu,
  Loader2,
  RefreshCw,
} from "lucide-react";

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  spend: number;
  purchases: number;
  cpa: number;
  impressions: number;
  link_clicks: number;
  ctr: number;
}

interface AccountInfo {
  id: string;
  name: string;
  currency: string;
  account_status: number;
}

interface KPIs {
  spend: number;
  purchases: number;
  cpa: number;
  ctr: number;
  cpm: number;
  convRate: number;
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString("ar-EG", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function nDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}

function computeKPIs(campaigns: CampaignSummary[]): KPIs {
  const spend = campaigns.reduce((s, c) => s + c.spend, 0);
  const purchases = campaigns.reduce((s, c) => s + c.purchases, 0);
  const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const link_clicks = campaigns.reduce((s, c) => s + c.link_clicks, 0);
  const cpa = purchases > 0 ? spend / purchases : 0;
  const ctr = impressions > 0 ? (link_clicks / impressions) * 100 : 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const convRate = link_clicks > 0 ? (purchases / link_clicks) * 100 : 0;
  return { spend, purchases, cpa, ctr, cpm, convRate };
}

function CampaignCard({
  campaign,
  isBest,
  isWorst,
  avgCpa,
}: {
  campaign: CampaignSummary;
  isBest: boolean;
  isWorst: boolean;
  avgCpa: number;
}) {
  const cpc = campaign.link_clicks > 0 ? campaign.spend / campaign.link_clicks : 0;
  const ringClass = isBest
    ? "bg-emerald-50 ring-1 ring-emerald-200"
    : isWorst
    ? "bg-rose-50 ring-1 ring-rose-200"
    : "bg-white ring-1 ring-gray-200";

  return (
    <div className={`rounded-xl p-4 ${ringClass}`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0 ml-2">
          <div
            className="font-bold text-gray-900 text-sm truncate"
            title={campaign.name}
          >
            {campaign.name}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            إنفاق: {fmt(campaign.spend)} EGP
          </div>
        </div>
        {isBest && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
            الأفضل ✓
          </span>
        )}
        {isWorst && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 shrink-0">
            الأضعف ✗
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="text-[10px] text-gray-500 mb-1">CPA</div>
          <div
            className={`font-bold text-sm ${
              campaign.cpa > 0 && campaign.cpa < avgCpa
                ? "text-emerald-700"
                : campaign.cpa > avgCpa * 1.5
                ? "text-rose-700"
                : "text-gray-900"
            }`}
          >
            {campaign.cpa > 0 ? fmt(campaign.cpa) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 mb-1">CTR</div>
          <div className="font-bold text-gray-900 text-sm">
            {campaign.ctr > 0 ? `${fmt(campaign.ctr, 2)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 mb-1">CPC</div>
          <div className="font-bold text-gray-900 text-sm">
            {cpc > 0 ? fmt(cpc, 1) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 mb-1">أوردر</div>
          <div className="font-bold text-gray-900 text-sm">
            {fmt(campaign.purchases)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CleanLight() {
  const [tab, setTab] = useState<"campaigns" | "ads">("campaigns");
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const since = nDaysAgo(7);
  const until = nDaysAgo(1);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [accRes, campRes] = await Promise.all([
        fetch("/api/meta/account"),
        fetch(`/api/meta/campaigns?since=${since}&until=${until}`),
      ]);
      if (!accRes.ok || !campRes.ok) throw new Error("فشل تحميل البيانات");
      const accData = await accRes.json();
      const campData = await campRes.json();
      setAccount(accData);
      setCampaigns(campData.campaigns ?? []);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const kpis = computeKPIs(campaigns);
  const TARGET_CPA = 200;

  const activeCampaigns = campaigns
    .filter((c) => c.spend > 0)
    .sort((a, b) => a.cpa - b.cpa);
  const bestCampaign = activeCampaigns[0];
  const worstCampaign = activeCampaigns[activeCampaigns.length - 1];

  const cpaHigh = kpis.cpa > TARGET_CPA && kpis.purchases > 0;
  const cpaOverPct =
    kpis.cpa > 0
      ? Math.round(((kpis.cpa - TARGET_CPA) / TARGET_CPA) * 100)
      : 0;

  const stopCandidates = activeCampaigns
    .filter((c) => c.cpa > TARGET_CPA * 2 && c.purchases < 10)
    .slice(0, 1);
  const scaleCandidates = activeCampaigns
    .filter((c) => c.cpa > 0 && c.cpa < TARGET_CPA)
    .slice(0, 1);
  const reviewCandidates = activeCampaigns
    .filter(
      (c) =>
        c.cpa >= TARGET_CPA &&
        c.cpa <= TARGET_CPA * 2 &&
        c !== stopCandidates[0]
    )
    .slice(0, 1);

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="font-bold text-lg tracking-tight flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs">M</span>
            </div>
            Meta Ads
          </div>
          <div className="hidden md:flex items-center gap-1">
            <button className="px-3 py-1.5 text-sm font-medium bg-indigo-50 text-indigo-700 rounded-lg">
              لوحة القيادة
            </button>
            <button className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg">
              التقارير
            </button>
            <button className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg">
              الإعدادات
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="تحديث"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="md:hidden p-2 text-gray-600">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-[800px] px-4 py-6 space-y-5">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              نظام القرارات التفاعلي
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              نظرة عامة على أداء الحساب ومؤشرات التحسين
            </p>
          </div>
          {account && (
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-medium text-gray-700">
                {account.name}
              </span>
            </div>
          )}
        </header>

        {loading && (
          <div className="flex items-center justify-center gap-3 py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">جاري تحميل البيانات…</span>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border-r-4 border-rose-500 rounded-lg px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-rose-800">خطأ في التحميل</h3>
              <p className="text-xs text-rose-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <>
            {cpaHigh && (
              <div className="bg-rose-50 border-r-4 border-rose-500 rounded-lg px-4 py-3 flex items-start gap-3 shadow-sm">
                <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-rose-800">
                    CPA مرتفع عن الهدف
                  </h3>
                  <p className="text-xs text-rose-600 mt-0.5">
                    تكلفة الاستحواذ الحالية {fmt(kpis.cpa)} EGP تتجاوز الهدف
                    المحدد ({TARGET_CPA} EGP) بنسبة {cpaOverPct}٪. يرجى مراجعة
                    الحملات النشطة.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-blue-500 flex flex-col justify-between">
                <div className="flex items-center gap-2">
                  <CircleDollarSign className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    إجمالي الإنفاق
                  </span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-bold text-gray-900 tabular-nums">
                    {fmt(kpis.spend)}{" "}
                    <span className="text-lg font-medium text-gray-500">
                      EGP
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  {since} → {until}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-emerald-500 flex flex-col justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    الأوردرات
                  </span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-bold text-gray-900 tabular-nums">
                    {fmt(kpis.purchases)}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-0.5 rounded-full">
                  <ShoppingCart className="w-3 h-3" />
                  <span>
                    {activeCampaigns.length} حملات نشطة
                  </span>
                </div>
              </div>

              <div
                className={`bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 flex flex-col justify-between ${
                  kpis.cpa > TARGET_CPA ? "border-rose-500" : "border-emerald-500"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Target
                    className={`w-4 h-4 ${
                      kpis.cpa > TARGET_CPA ? "text-rose-500" : "text-emerald-500"
                    }`}
                  />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    CPA
                  </span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-bold text-gray-900 tabular-nums">
                    {kpis.purchases > 0 ? fmt(kpis.cpa) : "—"}{" "}
                    <span className="text-lg font-medium text-gray-500">
                      EGP
                    </span>
                  </div>
                </div>
                {kpis.cpa > TARGET_CPA && kpis.purchases > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-xs font-medium text-rose-600 bg-rose-50 w-fit px-2 py-0.5 rounded-full">
                    <TrendingDown className="w-3 h-3" />
                    <span>مرتفع (بدل {TARGET_CPA})</span>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-emerald-500 flex flex-col justify-between">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    CTR
                  </span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-bold text-gray-900 tabular-nums">
                    {fmt(kpis.ctr, 2)}
                    <span className="text-lg font-medium text-gray-500">%</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-0.5 rounded-full">
                  <TrendingUp className="w-3 h-3" />
                  <span>نسبة النقر</span>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-amber-500 flex flex-col justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    CPM
                  </span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-bold text-gray-900 tabular-nums">
                    {fmt(kpis.cpm)}{" "}
                    <span className="text-lg font-medium text-gray-500">
                      EGP
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs font-medium text-amber-600 bg-amber-50 w-fit px-2 py-0.5 rounded-full">
                  تكلفة الألف ظهور
                </div>
              </div>

              <div
                className={`bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 flex flex-col justify-between ${
                  kpis.convRate < 1 ? "border-rose-500" : "border-emerald-500"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Activity
                    className={`w-4 h-4 ${
                      kpis.convRate < 1 ? "text-rose-500" : "text-emerald-500"
                    }`}
                  />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Conv. Rate
                  </span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-bold text-gray-900 tabular-nums">
                    {fmt(kpis.convRate, 2)}
                    <span className="text-lg font-medium text-gray-500">%</span>
                  </div>
                </div>
                {kpis.convRate < 1 && (
                  <div className="mt-2 flex items-center gap-1 text-xs font-medium text-rose-600 bg-rose-50 w-fit px-2 py-0.5 rounded-full">
                    <TrendingDown className="w-3 h-3" />
                    <span>ضعيف</span>
                  </div>
                )}
              </div>
            </div>

            {activeCampaigns.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900">
                    مقارنة الأداء
                  </h2>
                  <div className="flex bg-gray-100 p-0.5 rounded-lg">
                    <button
                      onClick={() => setTab("campaigns")}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        tab === "campaigns"
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      حملات ({activeCampaigns.length})
                    </button>
                    <button
                      onClick={() => setTab("ads")}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        tab === "ads"
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      إعلانات
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {activeCampaigns.map((c) => (
                    <CampaignCard
                      key={c.id}
                      campaign={c}
                      isBest={bestCampaign?.id === c.id && activeCampaigns.length > 1}
                      isWorst={worstCampaign?.id === c.id && activeCampaigns.length > 1}
                      avgCpa={kpis.cpa}
                    />
                  ))}
                </div>
              </div>
            )}

            {(stopCandidates.length > 0 ||
              scaleCandidates.length > 0 ||
              reviewCandidates.length > 0) && (
              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5">
                <h2 className="text-lg font-bold text-gray-900 mb-4">
                  محرك الأولويات
                </h2>
                <div className="space-y-4">
                  {stopCandidates.map((c) => (
                    <div
                      key={c.id}
                      className="flex gap-3 pb-4 border-b border-gray-100 last:border-0 last:pb-0"
                    >
                      <div className="mt-0.5">
                        <XCircle className="w-5 h-5 text-rose-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-900 text-sm truncate">
                          أوقف: {c.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {fmt(c.spend)} EGP · {c.purchases} طلبات فقط · CPA{" "}
                          {fmt(c.cpa)}
                        </div>
                      </div>
                      <div>
                        <button className="px-3 py-1.5 text-xs font-medium bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100">
                          تنفيذ
                        </button>
                      </div>
                    </div>
                  ))}

                  {scaleCandidates.map((c) => (
                    <div
                      key={c.id}
                      className="flex gap-3 pb-4 border-b border-gray-100 last:border-0 last:pb-0"
                    >
                      <div className="mt-0.5">
                        <Rocket className="w-5 h-5 text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-900 text-sm truncate">
                          ضاعف: {c.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          CPA {fmt(c.cpa)} EGP ← رابح
                        </div>
                      </div>
                      <div>
                        <button className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">
                          تنفيذ
                        </button>
                      </div>
                    </div>
                  ))}

                  {reviewCandidates.map((c) => (
                    <div
                      key={c.id}
                      className="flex gap-3"
                    >
                      <div className="mt-0.5">
                        <Target className="w-5 h-5 text-amber-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-900 text-sm truncate">
                          راجع: {c.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          CPA مرتفع {fmt(c.cpa)} EGP
                        </div>
                      </div>
                      <div>
                        <button className="px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100">
                          تنفيذ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mt-8 border-t border-gray-200 bg-white py-6 px-4 text-center">
        <p className="text-xs text-gray-500">
          {lastUpdated
            ? `آخر تحديث: ${lastUpdated.toLocaleTimeString("ar-EG")} · `
            : ""}
          البيانات من Meta Marketing API · كل الأرقام بالـ EGP
        </p>
      </footer>
    </div>
  );
}
