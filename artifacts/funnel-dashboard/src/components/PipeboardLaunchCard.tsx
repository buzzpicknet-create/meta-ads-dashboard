import { Rocket, DollarSign, Link2, CheckCircle2, ExternalLink, AlertTriangle, Users, Image } from "lucide-react";

export interface PipeboardLaunchData {
  campaign_name: string;
  daily_budget: number;
  primary_text: string;
  headline: string;
  status: "PAUSED" | "ACTIVE";
  landing_page_url?: string;
  campaign_id?: string;
  adset_id?: string;
  adset_error?: string;
  creative_id?: string;
  creative_error?: string;
  ad_id?: string;
  ad_error?: string;
  objective?: string;
  has_pixel?: boolean;
}

interface Props {
  data: PipeboardLaunchData;
}

export default function PipeboardLaunchCard({ data }: Props) {
  const isSales = data.objective === "OUTCOME_SALES";
  const adsetOk = !!data.adset_id;
  const creativeOk = !!data.creative_id;
  const adOk = !!data.ad_id;
  const allOk = adsetOk && creativeOk && adOk;

  return (
    <div
      dir="rtl"
      className="my-3 rounded-2xl overflow-hidden border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-slate-900/60 shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-500/10 border-b border-emerald-500/20">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/20">
          <Rocket className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-emerald-300">
            {allOk ? "تم إنشاء الحملة الكاملة بنجاح ✅" : "تم إنشاء الحملة — بعض الخطوات تحتاج مراجعة"}
          </p>
          <p className="text-[11px] text-emerald-500/70">عبر Pipeboard CMP — موقوفة للمراجعة</p>
        </div>
        <div className="mr-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-amber-300">PAUSED</span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Objective badge */}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            isSales
              ? "bg-violet-500/15 border-violet-500/30 text-violet-300"
              : "bg-blue-500/15 border-blue-500/30 text-blue-300"
          }`}>
            {isSales ? "🛒 OUTCOME_SALES" : "🔗 OUTCOME_TRAFFIC"}
          </span>
          {!isSales && (
            <span className="text-[10px] text-amber-400/80">— بدون بيكسل</span>
          )}
        </div>

        <Row icon={<Rocket className="w-3.5 h-3.5 text-slate-400" />} label="اسم الحملة">
          <span className="font-semibold text-white">{data.campaign_name}</span>
        </Row>

        <Row icon={<DollarSign className="w-3.5 h-3.5 text-slate-400" />} label="الميزانية اليومية">
          <span className="font-bold text-emerald-400">{data.daily_budget} EGP</span>
          <span className="text-[11px] text-slate-500 mr-1">/ يوم</span>
        </Row>

        {data.landing_page_url && (
          <Row icon={<Link2 className="w-3.5 h-3.5 text-slate-400" />} label="الصفحة الهبوطية">
            <a
              href={data.landing_page_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[12px] max-w-[220px] truncate"
            >
              {data.landing_page_url.replace(/^https?:\/\//, "").slice(0, 40)}
              {data.landing_page_url.length > 40 && "…"}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </Row>
        )}

        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-3 space-y-1">
          <p className="text-[10px] text-slate-500 font-medium">📣 العنوان</p>
          <p className="text-[13px] font-bold text-white leading-snug">{data.headline}</p>
        </div>

        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-3 space-y-1">
          <p className="text-[10px] text-slate-500 font-medium">✍️ النص الإعلاني</p>
          <p className="text-[12px] text-slate-200 leading-relaxed whitespace-pre-wrap line-clamp-4">{data.primary_text}</p>
        </div>

        {/* Steps status — 4 steps */}
        <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-slate-400 mb-1">حالة الإنشاء</p>

          <StepRow ok={!!data.campaign_id} label="الحملة" detail={data.campaign_id} />
          <StepRow
            ok={adsetOk}
            warn={!adsetOk}
            label="المجموعة الإعلانية"
            detail={data.adset_id}
            error={data.adset_error}
          />
          <StepRow
            ok={creativeOk}
            warn={!creativeOk}
            label="المحتوى الإبداعي (Creative)"
            detail={data.creative_id}
            error={data.creative_error}
          />
          <StepRow
            ok={adOk}
            warn={!adOk}
            label="الإعلان (Ad)"
            detail={data.ad_id}
            error={data.ad_error}
          />
        </div>

        {/* No pixel warning */}
        {!isSales && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/25 p-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-300/90 leading-relaxed">
              لتحويل الحملة لـ <strong>مبيعات</strong>، أضف بيكسل Meta وحدد الهدف من Ads Manager أو اطلب من الـ AI إضافة pixel_id.
            </p>
          </div>
        )}

        {/* Media note */}
        {!creativeOk && data.creative_error && (
          <div className="flex items-start gap-2 rounded-xl bg-slate-700/30 border border-slate-600/30 p-3">
            <Image className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400/90 leading-relaxed">
              تأكد من أن رابط الصورة/الفيديو مباشر ومتاح للعموم (ليس Google Drive Private).
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Users className="w-3 h-3 shrink-0" />
          <span>استهداف: مصر — 18 إلى 65 سنة — Broad</span>
        </div>

        {allOk ? (
          <div className="flex items-center gap-2 pt-1 text-[11px] text-emerald-500/80">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>الحملة جاهزة — راجعها في Pipeboard وفعّلها عند الاستعداد</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1 text-[11px] text-amber-500/80">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>أكمل الخطوات الناقصة من Ads Manager أو Pipeboard</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StepRow({
  ok, warn, label, detail, error,
}: {
  ok: boolean; warn?: boolean; label: string; detail?: string; error?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 text-[13px] shrink-0 ${ok ? "text-emerald-400" : warn ? "text-amber-400" : "text-slate-600"}`}>
        {ok ? "✅" : warn ? "⚠️" : "⭕"}
      </span>
      <div className="min-w-0">
        <span className={`text-[11px] font-medium ${ok ? "text-slate-200" : warn ? "text-amber-300/80" : "text-slate-500"}`}>
          {label}
        </span>
        {detail && (
          <span className="mr-2 text-[10px] font-mono text-slate-500">{detail}</span>
        )}
        {error && !ok && (
          <p className="text-[10px] text-amber-500/70 mt-0.5 leading-relaxed line-clamp-2">{error}</p>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="shrink-0">{icon}</div>
      <span className="text-[11px] text-slate-500 w-24 shrink-0">{label}</span>
      <div className="flex items-center gap-1 text-[12px]">{children}</div>
    </div>
  );
}
