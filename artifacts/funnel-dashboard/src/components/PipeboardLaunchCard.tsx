import { Rocket, DollarSign, FileText, Link2, CheckCircle2, ExternalLink } from "lucide-react";

export interface PipeboardLaunchData {
  campaign_name: string;
  daily_budget: number;
  primary_text: string;
  headline: string;
  status: "PAUSED" | "ACTIVE";
  landing_page_url?: string;
  campaign_id?: string;
  adset_id?: string;
}

interface Props {
  data: PipeboardLaunchData;
}

export default function PipeboardLaunchCard({ data }: Props) {
  return (
    <div
      dir="rtl"
      className="my-3 rounded-2xl overflow-hidden border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-slate-900/60 shadow-lg"
    >
      <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-500/10 border-b border-emerald-500/20">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/20">
          <Rocket className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-emerald-300">تم إنشاء الحملة بنجاح</p>
          <p className="text-[11px] text-emerald-500/70">عبر Pipeboard CMP — موقوفة للمراجعة</p>
        </div>
        <div className="mr-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-amber-300">PAUSED</span>
        </div>
      </div>

      <div className="p-4 space-y-3">
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

        {(data.campaign_id || data.adset_id) && (
          <div className="flex gap-2 flex-wrap">
            {data.campaign_id && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 font-mono">
                Campaign: {data.campaign_id}
              </span>
            )}
            {data.adset_id && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 font-mono">
                Adset: {data.adset_id}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 text-[11px] text-emerald-500/80">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>راجع الحملة في Pipeboard قبل تشغيلها</span>
        </div>
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
