import React from "react";
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
  Bell,
  Minus
} from "lucide-react";

export function ModernDark() {
  const getFreqColor = (freq: number) => {
    if (freq < 1.5) return "text-emerald-400 bg-emerald-400/10 ring-emerald-400/20";
    if (freq < 2.5) return "text-amber-400 bg-amber-400/10 ring-amber-400/20";
    if (freq < 3.5) return "text-orange-400 bg-orange-400/10 ring-orange-400/20";
    if (freq < 5) return "text-rose-400 bg-rose-400/10 ring-rose-400/20";
    return "text-red-500 bg-red-500/10 ring-red-500/20";
  };

  const campaigns = [
    { name: "حملة المنتج الرئيسي | كونفرجن", spend: 12450, cpa: 215, ctr: "3.10%", freq: 1.2, purchases: 42, isBest: true },
    { name: "ريتارجتينج شباط | Conversions", spend: 4200, cpa: 389, ctr: "1.80%", freq: 2.8, purchases: 11, isBest: false },
    { name: "TOF | awareness | broad", spend: 2927, cpa: 731, ctr: "1.10%", freq: 4.1, purchases: 4, isWorst: true }
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-violet-500/30">
      {/* Sticky NavBar */}
      <nav className="sticky top-0 z-50 bg-zinc-900/80 backdrop-blur-md border-b border-white/10">
        <div className="mx-auto max-w-[800px] px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-emerald-500 animate-pulse">●</span>
            <span className="font-bold tracking-tight">Meta Ads</span>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-zinc-400">
            <a href="#" className="text-white">الداشبورد</a>
            <a href="#" className="hover:text-white transition-colors">التقارير</a>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-[800px] px-4 py-6 space-y-6 pb-20">
        {/* Page header */}
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-1">
              نظام القرارات التفاعلي
            </h1>
            <p className="text-sm text-zinc-400">
              تحليل أداء الحملات الإعلانية لحظياً
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium">
            <Activity className="w-3.5 h-3.5" />
            <span>Live</span>
          </div>
        </header>

        {/* Alert card */}
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-4 flex gap-3 items-start">
          <div className="mt-0.5 p-1.5 bg-rose-500/20 rounded-lg text-rose-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-rose-400 font-semibold mb-1">
              ⚠ CPA مرتفع — 337 EGP بدل الهدف 200 EGP
            </h3>
            <p className="text-sm text-rose-400/80 leading-relaxed">
              الحملة الرئيسية تسجل تكلفة استحواذ أعلى من المعتاد مع تكرار (Frequency) يتجاوز 2.5، ينصح بتحديث الكرييتف.
            </p>
          </div>
        </div>

        {/* 6 KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {/* إجمالي الإنفاق */}
          <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 p-4 flex flex-col relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <CircleDollarSign className="w-4 h-4 text-zinc-400" />
              <span className="text-xs text-zinc-400 font-medium">إجمالي الإنفاق</span>
            </div>
            <div className="text-2xl font-bold tabular-nums">19,577 EGP</div>
          </div>

          {/* الأوردرات */}
          <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 p-4 flex flex-col relative overflow-hidden group">
            <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center gap-2 mb-3 relative">
              <ShoppingCart className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-zinc-400 font-medium">الأوردرات</span>
            </div>
            <div className="flex items-end justify-between relative">
              <div className="text-2xl font-bold tabular-nums text-white drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">58</div>
              <div className="flex items-center text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-inset ring-emerald-400/20">
                <TrendingUp className="w-3 h-3 mr-0.5" /> +12%
              </div>
            </div>
          </div>

          {/* CPA */}
          <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 p-4 flex flex-col relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-rose-400" />
              <span className="text-xs text-zinc-400 font-medium">CPA</span>
            </div>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold tabular-nums">337 EGP</div>
              <div className="flex items-center text-[10px] font-medium text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-inset ring-rose-400/20">
                <TrendingUp className="w-3 h-3 mr-0.5" /> بدل 200
              </div>
            </div>
          </div>

          {/* CTR */}
          <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 p-4 flex flex-col relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <MousePointerClick className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-zinc-400 font-medium">CTR</span>
            </div>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold tabular-nums">2.39%</div>
              <div className="flex items-center text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-inset ring-emerald-400/20">
                <TrendingUp className="w-3 h-3 mr-0.5" /> +0.4%
              </div>
            </div>
          </div>

          {/* CPM */}
          <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 p-4 flex flex-col relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-zinc-400 font-medium">CPM</span>
            </div>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold tabular-nums">52 EGP</div>
              <div className="flex items-center text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-inset ring-amber-400/20">
                <Minus className="w-3 h-3" />
              </div>
            </div>
          </div>

          {/* Conversion Rate */}
          <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 p-4 flex flex-col relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-rose-400" />
              <span className="text-xs text-zinc-400 font-medium">Conversion Rate</span>
            </div>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold tabular-nums">1.2%</div>
              <div className="flex items-center text-[10px] font-medium text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-inset ring-rose-400/20">
                <TrendingDown className="w-3 h-3 mr-0.5" /> ضعيف
              </div>
            </div>
          </div>
        </div>

        {/* Performance section */}
        <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-400" />
              مقارنة الأداء
            </h2>
          </div>
          <div className="p-4 space-y-3">
            {campaigns.map((camp, i) => (
              <div 
                key={i} 
                className={`p-4 rounded-xl border flex flex-col gap-4 transition-colors
                  ${camp.isBest ? 'bg-emerald-500/5 border-emerald-500/20 ring-1 ring-emerald-500/20' : 
                    camp.isWorst ? 'bg-rose-500/5 border-rose-500/20 ring-1 ring-rose-500/20' : 
                    'bg-zinc-900 border-white/5'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <h4 className="font-medium text-sm truncate" title={camp.name}>{camp.name}</h4>
                    <span className="text-xs text-zinc-500 tabular-nums">{camp.spend.toLocaleString()} EGP</span>
                  </div>
                  <div className={`px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ring-inset whitespace-nowrap ${getFreqColor(camp.freq)}`}>
                    Freq: {camp.freq}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 border-t border-white/5 pt-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-500 mb-0.5">CPA</span>
                    <span className={`text-sm font-semibold tabular-nums ${camp.cpa > 300 ? 'text-rose-400' : 'text-white'}`}>
                      {camp.cpa}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-500 mb-0.5">CTR</span>
                    <span className="text-sm font-semibold tabular-nums text-white">
                      {camp.ctr}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-500 mb-0.5">الأوردرات</span>
                    <span className="text-sm font-semibold tabular-nums text-white">
                      {camp.purchases}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-500 mb-0.5">Spend</span>
                    <span className="text-sm font-semibold tabular-nums text-white">
                      {(camp.spend/1000).toFixed(1)}k
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority actions */}
        <div className="rounded-2xl bg-zinc-900/50 backdrop-blur-sm border border-white/10 p-5">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Target className="w-4 h-4 text-zinc-400" />
            إجراءات مقترحة
          </h2>
          <ul className="space-y-4">
            <li className="flex gap-3 items-start">
              <div className="mt-0.5 p-1.5 rounded-full bg-rose-500/10 text-rose-400">
                <XCircle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white mb-0.5">إيقاف حملة TOF | awareness</p>
                <p className="text-xs text-zinc-400">تكلفة الاستحواذ (731 EGP) تتجاوز الحد الأقصى المقبول بثلاثة أضعاف.</p>
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <div className="mt-0.5 p-1.5 rounded-full bg-emerald-500/10 text-emerald-400">
                <Rocket className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white mb-0.5">زيادة ميزانية حملة المنتج الرئيسي 20%</p>
                <p className="text-xs text-zinc-400">أداء مستقر وعائد استثمار ممتاز، يجب استغلال الزخم.</p>
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <div className="mt-0.5 p-1.5 rounded-full bg-amber-500/10 text-amber-400">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white mb-0.5">تحديث الإعلانات في حملة الريتارجتينج</p>
                <p className="text-xs text-zinc-400">معدل التكرار (2.8) مرتفع، قد يؤدي إلى إرهاق الجمهور (Ad Fatigue).</p>
              </div>
            </li>
          </ul>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-zinc-950 pb-8 pt-6">
        <div className="mx-auto max-w-[800px] px-4 text-center">
          <p className="text-xs text-zinc-500">
            البيانات من Meta Marketing API · كل الأرقام بالـ EGP
          </p>
        </div>
      </footer>
    </div>
  );
}
