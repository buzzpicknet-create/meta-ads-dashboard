import React, { useState } from "react";
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
  CheckCircle2,
  Menu
} from "lucide-react";

export function CleanLight() {
  const [tab, setTab] = useState<"campaigns" | "ads">("campaigns");

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Sticky NavBar */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="font-bold text-lg tracking-tight flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs">M</span>
            </div>
            Meta Ads
          </div>
          <div className="hidden md:flex items-center gap-1">
            <button className="px-3 py-1.5 text-sm font-medium bg-indigo-50 text-indigo-700 rounded-lg">لوحة القيادة</button>
            <button className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg">التقارير</button>
            <button className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg">الإعدادات</button>
          </div>
        </div>
        <div>
          <button className="md:hidden p-2 text-gray-600">
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden md:flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-200 rounded-full border border-gray-300"></div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="mx-auto max-w-[800px] px-4 py-6 space-y-5">
        {/* Page header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">نظام القرارات التفاعلي</h1>
            <p className="text-sm text-gray-500 mt-1">نظرة عامة على أداء الحساب ومؤشرات التحسين</p>
          </div>
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-medium text-gray-700">TechStore MENA</span>
          </div>
        </header>

        {/* Alert banner */}
        <div className="bg-rose-50 border-r-4 border-rose-500 rounded-lg px-4 py-3 flex items-start gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-rose-800">CPA مرتفع عن الهدف</h3>
            <p className="text-xs text-rose-600 mt-0.5">تكلفة الاستحواذ الحالية 337 EGP تتجاوز الهدف المحدد (200 EGP) بنسبة 68%. يرجى مراجعة الحملات النشطة.</p>
          </div>
        </div>

        {/* 6 KPI cards */}
        <div className="grid grid-cols-2 gap-4">
          {/* Card 1: Spend */}
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-blue-500 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">إجمالي الإنفاق</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">19,577 <span className="text-lg font-medium text-gray-500">EGP</span></div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-gray-500">
              <span>اليوم</span>
            </div>
          </div>

          {/* Card 2: Orders */}
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-emerald-500 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">الأوردرات</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">58</div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-0.5 rounded-full">
              <TrendingUp className="w-3 h-3" />
              <span>+12% vs الأسبوع الماضي</span>
            </div>
          </div>

          {/* Card 3: CPA */}
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-rose-500 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-rose-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">CPA</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">337 <span className="text-lg font-medium text-gray-500">EGP</span></div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-rose-600 bg-rose-50 w-fit px-2 py-0.5 rounded-full">
              <TrendingDown className="w-3 h-3 rotate-180" />
              <span>مرتفع (بدل 200)</span>
            </div>
          </div>

          {/* Card 4: CTR */}
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-emerald-500 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">CTR</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">2.39<span className="text-lg font-medium text-gray-500">%</span></div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-0.5 rounded-full">
              <TrendingUp className="w-3 h-3" />
              <span>+0.4%</span>
            </div>
          </div>

          {/* Card 5: CPM */}
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-amber-500 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">CPM</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">52 <span className="text-lg font-medium text-gray-500">EGP</span></div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 w-fit px-2 py-0.5 rounded-full">
              <span>مستقر</span>
            </div>
          </div>

          {/* Card 6: Conv Rate */}
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 border-l-4 border-rose-500 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Conversion Rate</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">1.2<span className="text-lg font-medium text-gray-500">%</span></div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-rose-600 bg-rose-50 w-fit px-2 py-0.5 rounded-full">
              <TrendingDown className="w-3 h-3" />
              <span>-0.3%</span>
            </div>
          </div>
        </div>

        {/* Performance comparison card */}
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">مقارنة الأداء</h2>
            <div className="flex bg-gray-100 p-0.5 rounded-lg">
              <button 
                onClick={() => setTab("campaigns")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${tab === "campaigns" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                مجموعات
              </button>
              <button 
                onClick={() => setTab("ads")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${tab === "ads" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                إعلانات
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {/* Best Campaign */}
            <div className="bg-emerald-50 rounded-xl ring-1 ring-emerald-200 p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-gray-900 text-sm">حملة المنتج الرئيسي - عرض خاص</div>
                  <div className="text-xs text-gray-500 mt-0.5">إنفاق: 8,450 EGP</div>
                </div>
                <div className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Freq: 1.2</div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center divide-x divide-x-reverse divide-emerald-200/50">
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CPA</div>
                  <div className="font-bold text-gray-900 text-sm">215</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CTR</div>
                  <div className="font-bold text-gray-900 text-sm">3.4%</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CPC</div>
                  <div className="font-bold text-gray-900 text-sm">2.1</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">أوردر</div>
                  <div className="font-bold text-gray-900 text-sm">39</div>
                </div>
              </div>
            </div>

            {/* Average Campaign */}
            <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-gray-900 text-sm">ريتارجتينج - زوار الموقع</div>
                  <div className="text-xs text-gray-500 mt-0.5">إنفاق: 4,100 EGP</div>
                </div>
                <div className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Freq: 2.8</div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center divide-x divide-x-reverse divide-gray-100">
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CPA</div>
                  <div className="font-bold text-gray-900 text-sm">389</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CTR</div>
                  <div className="font-bold text-gray-900 text-sm">2.1%</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CPC</div>
                  <div className="font-bold text-gray-900 text-sm">3.5</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">أوردر</div>
                  <div className="font-bold text-gray-900 text-sm">10</div>
                </div>
              </div>
            </div>

            {/* Worst Campaign */}
            <div className="bg-rose-50 rounded-xl ring-1 ring-rose-200 p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-gray-900 text-sm">TOF | Awareness Broad</div>
                  <div className="text-xs text-gray-500 mt-0.5">إنفاق: 2,927 EGP</div>
                </div>
                <div className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">Freq: 4.1</div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center divide-x divide-x-reverse divide-rose-200/50">
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CPA</div>
                  <div className="font-bold text-gray-900 text-sm">731</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CTR</div>
                  <div className="font-bold text-gray-900 text-sm">0.8%</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">CPC</div>
                  <div className="font-bold text-gray-900 text-sm">8.4</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">أوردر</div>
                  <div className="font-bold text-gray-900 text-sm">4</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Priority Engine */}
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-4">محرك الأولويات</h2>
          <div className="space-y-4">
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="mt-0.5">
                <XCircle className="w-5 h-5 text-rose-500" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-900 text-sm">أوقف: TOF | awareness</div>
                <div className="text-xs text-gray-500 mt-1">2,927 EGP · 4 طلبات فقط</div>
              </div>
              <div>
                <button className="px-3 py-1.5 text-xs font-medium bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100">تنفيذ</button>
              </div>
            </div>

            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="mt-0.5">
                <Rocket className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-900 text-sm">ضاعف: حملة المنتج الرئيسي</div>
                <div className="text-xs text-gray-500 mt-1">CPA 215 EGP ← رابح</div>
              </div>
              <div>
                <button className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">تنفيذ</button>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="mt-0.5">
                <Target className="w-5 h-5 text-amber-500" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-900 text-sm">راجع: ريتارجتينج شباط</div>
                <div className="text-xs text-gray-500 mt-1">CPA مرتفع 389 EGP</div>
              </div>
              <div>
                <button className="px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100">تنفيذ</button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-gray-200 bg-white py-6 px-4 text-center">
        <p className="text-xs text-gray-500">تم التحديث منذ دقيقتين • البيانات بتوقيت القاهرة</p>
      </footer>
    </div>
  );
}
