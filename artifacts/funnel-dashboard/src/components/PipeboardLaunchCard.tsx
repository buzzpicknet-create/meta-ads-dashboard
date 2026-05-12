import {
  Rocket, DollarSign, Link2, CheckCircle2, ExternalLink,
  AlertTriangle, Users, Image, XCircle, BarChart2,
} from "lucide-react";

export interface AdResult {
  adset_name: string;
  creative_index: number;
  adset_id?: string;
  creative_id?: string;
  ad_id?: string;
  error?: string;
}

export interface PipeboardLaunchData {
  campaign_name: string;
  daily_budget: number;
  primary_text?: string;
  headline?: string;
  status: "PAUSED" | "ACTIVE";
  landing_page_url?: string;
  campaign_id?: string;
  objective?: string;
  has_pixel?: boolean;
  // multi-adset response
  ads_created?: number;
  ads_failed?: number;
  adsets_count?: number;
  creatives_count?: number;
  ad_results?: AdResult[];
  // legacy single-adset (kept for backward compat)
  adset_id?: string;
  adset_error?: string;
  creative_id?: string;
  creative_error?: string;
  ad_id?: string;
  ad_error?: string;
}

interface Props { data: PipeboardLaunchData }

export default function PipeboardLaunchCard({ data }: Props) {
  const isSales = data.objective === "OUTCOME_SALES";

  // Prefer new ad_results, fall back to legacy single-adset
  const adResults: AdResult[] = data.ad_results ?? (
    data.adset_id ? [{
      adset_name: data.campaign_name,
      creative_index: 0,
      adset_id: data.adset_id,
      creative_id: data.creative_id,
      ad_id: data.ad_id,
      error: data.adset_error ?? data.creative_error ?? data.ad_error,
    }] : []
  );

  const adsCreated = data.ads_created ?? adResults.filter(r => r.ad_id).length;
  const adsTotal   = data.adsets_count != null && data.creatives_count != null
    ? data.adsets_count * data.creatives_count
    : adResults.length;
  const adsFailed  = data.ads_failed ?? (adsTotal - adsCreated);
  const campaignOk = !!data.campaign_id;
  const allOk      = campaignOk && adsCreated > 0 && adsFailed === 0;
  const partial    = campaignOk && adsCreated > 0 && adsFailed > 0;

  const statusColor = allOk ? "emerald" : partial ? "amber" : "red";
  const statusBg    = allOk ? "bg-emerald-500/10 border-emerald-500/25" : partial ? "bg-amber-500/10 border-amber-500/25" : "bg-red-500/10 border-red-500/25";
  const statusText  = allOk ? "text-emerald-400" : partial ? "text-amber-400" : "text-red-400";

  const headerTitle = allOk
    ? "✅ تم إنشاء الحملة بنجاح"
    : partial
      ? "⚠️ الحملة أُنشئت — بعض الإعلانات فشلت"
      : campaignOk
        ? "⚠️ الحملة أُنشئت — الإعلانات تحتاج مراجعة"
        : "❌ فشل إنشاء الحملة";

  return (
    <div dir="rtl" className="my-3 rounded-2xl overflow-hidden border border-slate-700/60 bg-slate-900/80 shadow-xl">

      {/* ── Header ── */}
      <div className={`flex items-start gap-3 px-4 py-3.5 border-b border-slate-700/50 ${statusBg}`}>
        <div className={`mt-0.5 flex items-center justify-center w-8 h-8 rounded-full bg-slate-800/60 shrink-0`}>
          <Rocket className={`w-4 h-4 ${statusText}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-bold ${statusText}`}>{headerTitle}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Pipeboard CMP — الحالة: موقوف للمراجعة</p>
        </div>
        <span className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/50 text-[10px] font-semibold text-slate-300">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          PAUSED
        </span>
      </div>

      <div className="p-4 space-y-3.5">

        {/* ── Objective badge ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
            isSales
              ? "bg-violet-500/15 border-violet-500/30 text-violet-300"
              : "bg-sky-500/15 border-sky-500/30 text-sky-300"
          }`}>
            {isSales ? "🛒 مبيعات (OUTCOME_SALES)" : "🔗 ترافيك (OUTCOME_TRAFFIC)"}
          </span>
          {!isSales && (
            <span className="text-[10px] text-amber-400/70">بدون بيكسل</span>
          )}
        </div>

        {/* ── Main info grid ── */}
        <div className="grid grid-cols-1 gap-2">
          <InfoRow icon={<Rocket className="w-3.5 h-3.5 text-slate-400" />} label="اسم الحملة">
            <span className="font-semibold text-white text-[13px]">{data.campaign_name}</span>
          </InfoRow>

          <InfoRow icon={<DollarSign className="w-3.5 h-3.5 text-slate-400" />} label="الميزانية اليومية">
            <span className="font-bold text-emerald-400 text-[14px]">{data.daily_budget}</span>
            <span className="text-[11px] text-slate-400 mr-1">EGP / يوم</span>
          </InfoRow>

          {data.landing_page_url && (
            <InfoRow icon={<Link2 className="w-3.5 h-3.5 text-slate-400" />} label="الصفحة المقصودة">
              <a
                href={data.landing_page_url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:text-sky-300 flex items-center gap-1 text-[11px] max-w-[200px] truncate transition-colors"
              >
                {data.landing_page_url.replace(/^https?:\/\//, "").slice(0, 38)}
                {data.landing_page_url.replace(/^https?:\/\//, "").length > 38 && "…"}
                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
              </a>
            </InfoRow>
          )}
        </div>

        {/* ── Creative preview (only if data present) ── */}
        {(data.headline || data.primary_text) && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
            {data.headline && (
              <div className="px-3 py-2.5 border-b border-slate-700/40">
                <p className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">العنوان</p>
                <p className="text-[13px] font-bold text-white leading-snug">{data.headline}</p>
              </div>
            )}
            {data.primary_text && (
              <div className="px-3 py-2.5">
                <p className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">النص الإعلاني</p>
                <p className="text-[12px] text-slate-200 leading-relaxed whitespace-pre-wrap line-clamp-4">{data.primary_text}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Ads summary counter ── */}
        {adsTotal > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700/40 flex-1">
              <BarChart2 className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-400">إجمالي الإعلانات</span>
              <span className="mr-auto font-bold text-white text-[13px]">{adsCreated}/{adsTotal}</span>
            </div>
            {adsCreated > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-[11px] text-emerald-400 font-semibold">{adsCreated} نجح</span>
              </div>
            )}
            {adsFailed > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/25">
                <XCircle className="w-3 h-3 text-red-400" />
                <span className="text-[11px] text-red-400 font-semibold">{adsFailed} فشل</span>
              </div>
            )}
          </div>
        )}

        {/* ── Campaign step status ── */}
        <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/30">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">حالة الإنشاء</p>
          </div>
          <div className="p-3 space-y-2">
            <StepRow ok={campaignOk} label="الحملة" detail={data.campaign_id} />

            {/* Per-adset rows (new format) */}
            {adResults.length > 0 ? adResults.map((r, i) => (
              <div key={i} className="mr-3 border-r border-slate-700/40 pr-3 space-y-1.5">
                <StepRow
                  ok={!!r.adset_id && !r.error}
                  warn={!!r.adset_id && !!r.error}
                  label={`مجموعة: ${r.adset_name}${adResults.filter(x => x.adset_name === r.adset_name).length > 1 ? ` — إعلان ${r.creative_index + 1}` : ""}`}
                  detail={r.adset_id}
                />
                {r.adset_id && (
                  <>
                    <StepRow ok={!!r.creative_id} warn={!r.creative_id && !!r.adset_id} label="المحتوى الإبداعي" detail={r.creative_id} />
                    <StepRow ok={!!r.ad_id} warn={!r.ad_id && !!r.creative_id} label="الإعلان (Ad)" detail={r.ad_id} error={!r.ad_id ? r.error : undefined} />
                  </>
                )}
                {!r.adset_id && r.error && (
                  <p className="text-[10px] text-red-400/80 leading-relaxed pr-5">{r.error}</p>
                )}
              </div>
            )) : (
              // Legacy single-adset fallback
              <>
                <StepRow ok={!!data.adset_id} warn={!data.adset_id} label="المجموعة الإعلانية" detail={data.adset_id} error={data.adset_error} />
                <StepRow ok={!!data.creative_id} warn={!data.creative_id} label="المحتوى الإبداعي" detail={data.creative_id} error={data.creative_error} />
                <StepRow ok={!!data.ad_id} warn={!data.ad_id} label="الإعلان (Ad)" detail={data.ad_id} error={data.ad_error} />
              </>
            )}
          </div>
        </div>

        {/* ── Targeting note ── */}
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Users className="w-3 h-3 shrink-0" />
          <span>استهداف: مصر — Advantage+ Audience — Broad</span>
        </div>

        {/* ── No pixel warning ── */}
        {!isSales && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/8 border border-amber-500/20 p-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-300/80 leading-relaxed">
              أضف <strong>pixel_id</strong> لتحويل الهدف إلى مبيعات وتفعيل تتبع التحويلات.
            </p>
          </div>
        )}

        {/* ── Failed creative tip ── */}
        {adsFailed > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-slate-700/20 border border-slate-700/40 p-3">
            <Image className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400/90 leading-relaxed">
              تأكد أن روابط الصور/الفيديوهات مباشرة ومتاحة للعموم، أو استخدم Google Drive بصلاحية "أي شخص لديه الرابط".
            </p>
          </div>
        )}

        {/* ── Footer CTA ── */}
        <div className={`flex items-center gap-2 pt-1 text-[11px] ${allOk ? "text-emerald-500/80" : "text-amber-500/80"}`}>
          {allOk ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>الحملة جاهزة — راجعها في Pipeboard أو Ads Manager وفعّلها عند الاستعداد</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>أكمل الخطوات الناقصة من Ads Manager أو Pipeboard</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ ok, warn, label, detail, error }: {
  ok: boolean; warn?: boolean; label: string; detail?: string; error?: string;
}) {
  const icon = ok ? "✅" : warn ? "⚠️" : "⭕";
  const labelClass = ok ? "text-slate-200" : warn ? "text-amber-300/80" : "text-slate-500";
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-[12px] shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-medium ${labelClass}`}>{label}</span>
          {detail && (
            <span className="text-[9px] font-mono text-slate-600 bg-slate-800/60 px-1.5 py-0.5 rounded">{detail}</span>
          )}
        </div>
        {error && !ok && (
          <p className="text-[10px] text-red-400/70 mt-0.5 leading-relaxed line-clamp-2">{error}</p>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="shrink-0">{icon}</div>
      <span className="text-[11px] text-slate-500 w-28 shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}
