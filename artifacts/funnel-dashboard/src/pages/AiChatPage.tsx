import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, Trash2, User, Plus, Loader2, CheckCircle2,
  Brain, Paperclip, X, SquarePen, MessageSquare, Clock,
  BarChart2, Zap, AlertTriangle, Square, CheckSquare, Menu,
} from "lucide-react";
import BulkActionPanel, { type BulkActionPayload } from "@/components/BulkActionPanel";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatMsg  { role: "user" | "assistant"; content: string; tool_calls?: string[]; imagePreviewUrl?: string }
interface ConvRow  { id: number; title: string; campaign_id?: string|null; snippet?: string|null; created_at: string; updated_at: string }
interface DailyPt  { day: string; spend: number; purchases: number; cpa: number; link_clicks: number; impressions: number }
interface CampData { id: string; name: string; effective_status: string; objective: string; spend: number; purchases: number; cpa: number; ctr: number }
interface PendingAction { tool: string; args: Record<string,unknown>; summary: string; currentValue?: string; proposedValue?: string; detailsLoading?: boolean }
interface AccountMention { id: string; name: string; type: "meta" | "google"; currency?: string }

// ─── Quick actions ─────────────────────────────────────────────────────────────
// Day-focused (intra-day) — shown prominently at top
const QA_DAY = [
  {
    label: "⚡ فرص Scale اليوم (Bulk)",
    prompt: `قم بتحليل أداء حملات اليوم (Today) وقارنها بتاريخها في آخر 3 أيام. ابحث عن الحملات التي تحقق CPA أقل من المستهدف اليوم.
القواعد الصارمة:
- إذا كانت مبيعات اليوم أقل من 3 (حتى لو الـ CPA ممتاز)، اقترح زيادة ميزانية طفيفة جداً (10-15% كحد أقصى) لتجنب التذبذب.
- إذا كانت مبيعات اليوم 3 أو أكثر والـ CPA ممتاز والتاريخ جيد، اقترح زيادة (20-30%).
لكل حملة تستحق Scale: أخرج تحليل موجز (سطرين) ثم أخرج bulk_action فوري بإجراء واحد لتلك الحملة. في النهاية أخرج جدول ملخص + bulk_action جماعي لكل الإجراءات.`,
  },
  {
    label: "🛡️ صيانة خسائر اليوم",
    prompt: `استخرج الحملات التي تتخطى الـ Target CPA اليوم.
القواعد الصارمة:
- انظر إلى تاريخ الحملة وأرقام المسار (CTR, Hook Rate). إذا كان التاريخ جيداً والأرقام مستقرة ولكن اليوم سيء، اقترح 'تقليل الميزانية' (Scale Down) بنسبة 20-30% ولا تقترح الإيقاف.
- إذا كان أداء اليوم سيئاً والتاريخ سيء وأرقام النقر تتدهور، اقترح 'إيقاف' (Pause).
لكل حملة تستحق تدخل: أخرج تحليل موجز ثم bulk_action فوري بإجراء واحد. في النهاية أخرج جدول ملخص (القرار | السبب التاريخي) + bulk_action جماعي.`,
  },
  {
    label: "🔍 فحص منتصف اليوم",
    prompt: `نحن في منتصف اليوم. استخرج الحملات التي صرفت أكثر من 40% من ميزانيتها اليومية ولكنها لم تحقق أي مبيعات (0 Conversions) حتى الآن. هل أرقام النقرات (CTR) ومعدل التحويل (CVR) تشير إلى أنها ستتعافى أم يجب تقليل ميزانيتها فوراً؟ لكل حملة تستحق تدخل أخرج bulk_action فوري.`,
  },
];

// Classic Meta actions — shown in second row
const QA = [
  { label: "☕ التقرير الصباحي",   prompt: "اسحب داتا كل الحملات النشطة لليوم وقارنها بمتوسط بيانات آخر 7 أيام. أعطني ملخصاً سريعاً: ما هي الحملات الرابحة وما هي الحملات التي تتخطى الـ CPA المستهدف وتحتاج تدخل فوري؟ ارسم لي جدول مقارنة يعتمد على الـ CPA كأساس للتقييم." },
  { label: "🚀 فرص الـ Scale",     prompt: "حلل الحملات النشطة بناءً على أداء آخر 7 أيام، وحدد الـ Adsets التي تحقق CPA أقل من المستهدف ومستقرة. جهّز مقترحات لزيادة ميزانيتها 20% مع أزرار التنفيذ المباشر عبر الـ MCP." },
  { label: "🔬 تشخيص الـ Funnel",  prompt: "افحص مسار المبيعات لكل الإعلانات النشطة. استخرج الإعلانات التي تمتلك Hook Rate ممتاز لكن CVR أو CTR ضعيفة. حدد أين الخلل بالضبط." },
  { label: "📉 تقليل الميزانية",   prompt: "استخرج أي إعلان أو Adset تخطى CPA المستهدف بشكل ملحوظ في آخر 7 أيام. حلل أسباب التراجع واعرضهم في جدول مع bulk_action لتقليل الميزانية 30%." },
  { label: "🕵️ تقييم التعديلات",  prompt: "ابحث عن الحملات التي أجرينا عليها تعديلات مؤخراً. قارن أداءها قبل وبعد التعديل. هل نجح الإجراء؟" },
];

// Google Ads quick actions
const QA_GOOGLE = [
  { label: "🔍 حملات Google Ads",      prompt: "جيب قائمة كل حملات Google Ads عبر كل الحسابات مع حالتها وميزانياتها. ثم اجلب أداءها في آخر 7 أيام (Clicks، CTR، CPC، Conversions، Cost) ورتّبها من الأفضل للأضعف في جدول. حدد أيها يستحق تحسين الميزانية أو الإيقاف." },
  { label: "🎯 تحليل الكلمات المفتاحية", prompt: "جيب الكلمات المفتاحية لكل حسابات Google Ads مع Quality Score وCPC الفعلي وأداءها في آخر 7 أيام. رتّبها في جدول وحدد: أي الكلمات تستنزف الميزانية (Quality Score منخفض + تكلفة عالية)؟ وأيها ذهبية تستحق زيادة الـ bid؟" },
  { label: "🔎 تقرير البحث (Search Terms)", prompt: "جيب تقرير مصطلحات البحث الفعلية من Google Ads لآخر 30 يوم. رتّبها حسب التكلفة. حدد المصطلحات التي لا تحوّل وتستهلك الميزانية وتستحق إضافتها ككلمات سلبية. واذكر أيها يستحق إضافته ككلمة مفتاحية إيجابية." },
];

// All for the bottom strip
const QA_ALL = [...QA_DAY, ...QA, ...QA_GOOGLE];

// ─── Chart block ──────────────────────────────────────────────────────────────
const C = ["#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#ec4899"];
interface ChartSpec { type:"bar"|"line"|"multibar"; title?:string; xKey:string; series:{key:string;label:string;color?:string}[]; data:Record<string,string|number>[]; unit?:string }

function ChartBlock({ spec }: { spec: ChartSpec }) {
  const unit = spec.unit ?? "";
  const fmt  = (v:unknown) => typeof v==="number" ? v.toLocaleString("ar-EG") : String(v??"");
  return (
    <div className="my-3 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
      {spec.title && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/30">
          <BarChart2 className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-[13px] font-semibold">{spec.title}</span>
        </div>
      )}
      <div className="px-2 py-3" dir="ltr">
        <ResponsiveContainer width="100%" height={200}>
          {spec.type === "line" ? (
            <LineChart data={spec.data} margin={{top:4,right:16,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.15)" />
              <XAxis dataKey={spec.xKey} tick={{fontSize:11}} tickLine={false} axisLine={false} />
              <YAxis tick={{fontSize:11}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}${unit}`} width={44} />
              <Tooltip formatter={(v:unknown)=>[`${fmt(v)}${unit}`,""]} contentStyle={{fontSize:12,borderRadius:8}} />
              {spec.series.length>1 && <Legend wrapperStyle={{fontSize:12}} />}
              {spec.series.map((s,i)=>(
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color??C[i%C.length]} strokeWidth={2.5} dot={{r:3}} activeDot={{r:5}} />
              ))}
            </LineChart>
          ):(
            <BarChart data={spec.data} margin={{top:4,right:16,left:0,bottom:0}} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.15)" vertical={false} />
              <XAxis dataKey={spec.xKey} tick={{fontSize:11}} tickLine={false} axisLine={false} />
              <YAxis tick={{fontSize:11}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}${unit}`} width={44} />
              <Tooltip formatter={(v:unknown)=>[`${fmt(v)}${unit}`,""]} contentStyle={{fontSize:12,borderRadius:8}} />
              {spec.series.length>1 && <Legend wrapperStyle={{fontSize:12}} />}
              {spec.series.map((s,i)=>
                spec.series.length===1 ? (
                  <Bar key={s.key} dataKey={s.key} name={s.label} radius={[4,4,0,0]} maxBarSize={48}>
                    {spec.data.map((_,di)=><Cell key={di} fill={C[di%C.length]!} />)}
                  </Bar>
                ):(
                  <Bar key={s.key} dataKey={s.key} name={s.label}
                    fill={s.color??C[i%C.length]} radius={[4,4,0,0]} maxBarSize={32} />
                )
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Markdown renderer ─────────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p,i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-semibold">{p.slice(2,-2)}</strong>;
    if (p.startsWith("*")  && p.endsWith("*"))  return <em key={i} className="italic">{p.slice(1,-1)}</em>;
    if (p.startsWith("`")  && p.endsWith("`"))  return <code key={i} className="font-mono text-[12px] bg-muted/70 text-primary px-1.5 py-0.5 rounded border border-border/50">{p.slice(1,-1)}</code>;
    return p;
  });
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elems: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") { i++; continue; }

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim().toLowerCase();
      const isChart = lang === "json chart" || lang === "chart" || lang === "json-chart";
      const isBulk  = lang === "bulk_action" || lang === "json bulk_action" || lang === "bulk-action"
                   || lang === "bulk action"  || lang === "json_bulk_action";
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) { code.push(lines[i]!); i++; }
      i++;
      const raw = code.join("\n");
      if (isBulk) {
        let bulkPayload: BulkActionPayload | null = null;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            bulkPayload = { actions: parsed as BulkActionPayload["actions"] };
          } else if (parsed && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;
            if (Array.isArray(obj.actions)) bulkPayload = parsed as BulkActionPayload;
            else if (typeof obj.type === "string") bulkPayload = { actions: [parsed as BulkActionPayload["actions"][0]] };
          }
        } catch {}
        if (bulkPayload) {
          elems.push(<BulkActionPanel key={`b${i}`} payload={bulkPayload} />);
        } else {
          elems.push(<pre key={`p${i}`} className="my-2 rounded-lg bg-muted/40 p-3 text-xs overflow-x-auto" dir="ltr">{raw}</pre>);
        }
      } else if (isChart) {
        try { elems.push(<ChartBlock key={`c${i}`} spec={JSON.parse(raw) as ChartSpec} />); }
        catch { elems.push(<pre key={`p${i}`} className="my-2 rounded-lg bg-muted/40 p-3 text-xs overflow-x-auto" dir="ltr">{raw}</pre>); }
      } else {
        // Structural fallback: if JSON has "actions" array or is array of items
        // (model sometimes outputs ```json instead of ```bulk_action)
        let renderedAsBulk = false;
        if (lang === "json" || lang === "") {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              const arr = parsed as Record<string, unknown>[];
              if (arr.length > 0 && typeof arr[0]?.type === "string") {
                elems.push(<BulkActionPanel key={`b${i}`} payload={{ actions: parsed as BulkActionPayload["actions"] }} />);
                renderedAsBulk = true;
              }
            } else if (parsed && typeof parsed === "object") {
              const obj = parsed as Record<string, unknown>;
              if (Array.isArray(obj.actions)) {
                elems.push(<BulkActionPanel key={`b${i}`} payload={parsed as unknown as BulkActionPayload} />);
                renderedAsBulk = true;
              }
            }
          } catch { /* fall through to generic */ }
        }
        if (!renderedAsBulk) {
          elems.push(
            <div key={`c${i}`} className="my-3 rounded-xl overflow-hidden border border-border/60 bg-muted/40">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border-b border-border/40">
                <div className="flex gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400/60"/><span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60"/><span className="w-2.5 h-2.5 rounded-full bg-green-400/60"/></div>
                <span className="text-[10px] text-muted-foreground/60 font-mono">{lang||"code"}</span>
              </div>
              <pre className="p-3 overflow-x-auto text-[12px] font-mono leading-relaxed whitespace-pre" dir="ltr">{raw}</pre>
            </div>
          );
        }
      }
      continue;
    }

    if (/^---+$/.test(line.trim())) { elems.push(<hr key={i} className="my-3 border-border/40" />); i++; continue; }

    if (/^#{1,3}\s/.test(line)) {
      const lvl = (line.match(/^(#{1,3})/)?.[1].length ?? 1);
      const content = line.replace(/^#{1,3}\s/,"");
      const sz = lvl===1?"text-base":lvl===2?"text-[14px]":"text-[13px]";
      elems.push(<p key={i} className={`font-bold ${sz} mt-4 mb-1.5 leading-snug border-b border-border/40 pb-1.5`}>{renderInline(content)}</p>);
      i++; continue;
    }

    if (/^\|/.test(line) && i+1 < lines.length && /^\|[-| :]+\|/.test(lines[i+1]!)) {
      const hdrs = line.split("|").map(c=>c.trim()).filter((_,j,a)=>j>0&&j<a.length-1);
      i+=2;
      const rows: string[][] = [];
      while (i<lines.length && /^\|/.test(lines[i]!)) { rows.push(lines[i]!.split("|").map(c=>c.trim()).filter((_,j,a)=>j>0&&j<a.length-1)); i++; }
      elems.push(
        <div key={`t${i}`} className="my-3 overflow-x-auto rounded-xl border border-border/60 shadow-sm">
          <table className="w-full text-[13px] border-collapse">
            <thead><tr className="border-b border-border/60 bg-muted/40">{hdrs.map((h,hi)=><th key={hi} className="px-3 py-2 text-right font-semibold text-foreground/80 whitespace-nowrap">{renderInline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((row,ri)=>(
              <tr key={ri} className={ri%2===0?"bg-background":"bg-muted/20"}>
                {row.map((cell,ci)=><td key={ci} className="px-3 py-2 text-right border-b border-border/30 last:border-b-0 whitespace-nowrap">{renderInline(cell)}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i<lines.length && /^[-*]\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^[-*]\s/,"")); i++; }
      elems.push(<ul key={`ul${i}`} className="my-2 space-y-1">{items.map((it,ii)=>(
        <li key={ii} className="flex gap-2 text-[13.5px] leading-relaxed">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0"/>
          <span>{renderInline(it)}</span>
        </li>
      ))}</ul>);
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      let n=1;
      while (i<lines.length && /^\d+\.\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\d+\.\s/,"")); i++; n++; }
      elems.push(<ol key={`ol${i}`} className="my-2 space-y-1">{items.map((it,ii)=>(
        <li key={ii} className="flex gap-2 text-[13.5px] leading-relaxed">
          <span className="shrink-0 text-primary/60 font-mono text-[12px] mt-0.5">{ii+1}.</span>
          <span>{renderInline(it)}</span>
        </li>
      ))}</ol>);
      continue;
    }

    elems.push(<p key={i} className="text-[13.5px] leading-relaxed">{renderInline(line)}</p>);
    i++;
  }
  return <div className="space-y-0.5">{elems}</div>;
}

// ─── Conversation grouping ─────────────────────────────────────────────────────
function groupConvs(convs: ConvRow[]): { label: string; items: ConvRow[] }[] {
  const now = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const t0 = today.getTime();
  const g: Record<string,ConvRow[]> = { "اليوم":[], "أمس":[], "آخر 7 أيام":[], "آخر 30 يوم":[], "أقدم":[] };
  for (const c of convs) {
    const t = new Date(c.updated_at).getTime();
    if (t>=t0) g["اليوم"]!.push(c);
    else if (t>=t0-86400000) g["أمس"]!.push(c);
    else if (t>=t0-6*86400000) g["آخر 7 أيام"]!.push(c);
    else if (t>=t0-29*86400000) g["آخر 30 يوم"]!.push(c);
    else g["أقدم"]!.push(c);
  }
  return Object.entries(g).filter(([,v])=>v.length>0).map(([label,items])=>({label,items}));
}

// ─── Campaigns context builder ─────────────────────────────────────────────────
const GEN_CTX = "أنت مساعد Meta Ads عام. أجب على أسئلة المستخدم عن استراتيجيات Meta Ads، تحسين الأداء، وقراءة المؤشرات.";

function buildCtx(c30: CampData[], c7: CampData[], daily: DailyPt[]): string {
  if (!c30.length && !c7.length) return GEN_CTX;
  const fmt = (n:number) => n.toLocaleString("ar-EG", {maximumFractionDigits:0});
  const fmtPct = (n:number) => `${n.toFixed(2)}%`;
  const map7 = new Map(c7.map(c=>[c.id,c]));
  const base = [...c30].sort((a,b)=>b.spend-a.spend).slice(0,15);
  const tot30s = c30.reduce((s,c)=>s+c.spend,0);
  const tot30p = c30.reduce((s,c)=>s+c.purchases,0);
  const cpa30  = tot30p>0 ? tot30s/tot30p : 0;
  const tot7s  = c7.reduce((s,c)=>s+c.spend,0);
  const tot7p  = c7.reduce((s,c)=>s+c.purchases,0);
  const cpa7   = tot7p>0 ? tot7s/tot7p : 0;
  const lines = [
    "أنت مساعد Meta Ads متخصص ولديك بيانات الحملات لفترتين: آخر 7 أيام وآخر 30 يوم.",
    "قاعدة مهمة: لو السؤال عن حملة بعينها — استخدم الأدوات المتاحة (get_campaign_daily أو get_adsets).",
    "","## ملخص الأداء:","",
    `| المؤشر | آخر 7 أيام | آخر 30 يوم |`,
    `|--------|-----------|------------|`,
    `| الإنفاق | ${fmt(tot7s)} EGP | ${fmt(tot30s)} EGP |`,
    `| الطلبات | ${fmt(tot7p)} | ${fmt(tot30p)} |`,
    `| CPA | ${cpa7>0?fmt(cpa7)+" EGP":"—"} | ${cpa30>0?fmt(cpa30)+" EGP":"—"} |`,
    "","## تفاصيل الحملات:","",
  ];
  const sm: Record<string,string> = { ACTIVE:"نشطة ✅", PAUSED:"موقوفة ⏸", CAMPAIGN_PAUSED:"موقوفة ⏸" };
  for (const c of base) {
    const c7d = map7.get(c.id);
    lines.push(`### ${c.name} (id: ${c.id})`);
    lines.push(`- الحالة: ${sm[c.effective_status]??c.effective_status}`);
    if (c7d) {
      lines.push(`- الإنفاق: ${fmt(c7d.spend)} (7ي) | ${fmt(c.spend)} (30ي)`);
      lines.push(`- الطلبات: ${fmt(c7d.purchases)} (7ي) | ${fmt(c.purchases)} (30ي)`);
      lines.push(`- CPA: ${c7d.cpa>0?fmt(c7d.cpa)+" EGP":"—"} (7ي) | ${c.cpa>0?fmt(c.cpa)+" EGP":"—"} (30ي)`);
      lines.push(`- CTR: ${fmtPct(c7d.ctr)} (7ي) | ${fmtPct(c.ctr)} (30ي)`);
    } else {
      lines.push(`- الإنفاق: ${fmt(c.spend)} | الطلبات: ${fmt(c.purchases)} | CPA: ${c.cpa>0?fmt(c.cpa)+" EGP":"—"}`);
    }
    lines.push("");
  }
  if (daily.length>=6) {
    const s = [...daily].sort((a,b)=>a.day.localeCompare(b.day));
    const l3 = s.slice(-3); const p3 = s.slice(-6,-3);
    const cpaL = l3.reduce((x,d)=>x+d.cpa,0)/3;
    const cpaP = p3.reduce((x,d)=>x+d.cpa,0)/3;
    const ch = cpaP>0?((cpaL-cpaP)/cpaP)*100:0;
    lines.push("### اتجاه آخر 3 أيام:");
    lines.push(`- CPA: ${fmt(cpaL)} EGP → ${ch>2?`↑${ch.toFixed(0)}%`:ch<-2?`↓${Math.abs(ch).toFixed(0)}%`:"ثابت"}`);
    lines.push("_(للأداء اليومي التفصيلي استخدم get_account_daily)_");
  }
  return lines.join("\n");
}

// ─── File attachment helper ────────────────────────────────────────────────────
interface Attachment { base64?: string; text?: string; mimeType?: string; previewUrl?: string; name: string; isImage: boolean }
function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    if (file.type.startsWith("image/")) {
      r.onload = e => { const d = e.target?.result as string; resolve({ base64: d.split(",")[1]??"", mimeType: file.type, previewUrl: d, name: file.name, isImage: true }); };
      r.readAsDataURL(file);
    } else {
      r.onload = e => resolve({ text: e.target?.result as string, name: file.name, isImage: false });
      r.readAsText(file);
    }
    r.onerror = () => reject(new Error("فشل قراءة الملف"));
  });
}

// ─── Relative time ─────────────────────────────────────────────────────────────
function rel(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff/60000);
  if (m<1) return "الآن";
  if (m<60) return `منذ ${m} د`;
  const h = Math.floor(m/60);
  if (h<24) return `منذ ${h} س`;
  const d = Math.floor(h/24);
  if (d===1) return "أمس";
  if (d<7) return `منذ ${d} أيام`;
  return new Date(dateStr).toLocaleDateString("ar-EG",{day:"numeric",month:"short"});
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function AiChatPage() {
  const { user, logout } = useAuth();

  // ── Conversations ──
  const [convs, setConvs]       = useState<ConvRow[]>([]);
  const [convId, setConvId]     = useState<number|null>(null);
  const [convLoad, setConvLoad] = useState(false);
  const [delId, setDelId]       = useState<number|null>(null);
  const convIdRef = useRef<number|null>(null);
  useEffect(() => { convIdRef.current = convId; }, [convId]);

  // ── Messages ──
  const [msgs, setMsgs]       = useState<ChatMsg[]>([]);
  const [streaming, setStr]   = useState(false);
  const [streamTxt, setStTxt] = useState("");
  const [toolLabels, setTL]   = useState<string[]>([]);
  const [input, setInput]     = useState("");
  const [attachment, setAtt]  = useState<Attachment|null>(null);
  const [pending, setPending] = useState<PendingAction|null>(null);
  const [executing, setExec]  = useState(false);

  // ── Context ──
  const [campCtx, setCampCtx] = useState<string|null>(null);
  const [campLoad, setCL]     = useState(false);

  // ── Account selector ──
  const [allAccounts, setAllAccounts]   = useState<AccountMention[]>([]);
  const [selectedAccIds, setSelAccIds]  = useState<Set<string>>(new Set());

  // ── Refs ──
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const fileRef     = useRef<HTMLInputElement>(null);
  const abortRef    = useRef<AbortController|null>(null);
  const stoppedRef  = useRef(false);

  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, [msgs, streamTxt]);
  useEffect(() => { setTimeout(()=>inputRef.current?.focus(), 100); }, [convId]);

  // ── Load conversations on mount ──────────────────────────────────────────────
  const loadConvs = useCallback(async (autoLoad=false) => {
    setConvLoad(true);
    try {
      const r = await fetch(`${API}/chat/conversations`, {credentials:"include"});
      if (!r.ok) return;
      const d = await r.json() as {conversations: ConvRow[]};
      const list = d.conversations ?? [];
      setConvs(list);
      if (autoLoad && convIdRef.current===null && list.length>0) {
        const latest = list[0]!;
        const mr = await fetch(`${API}/chat/conversations/${latest.id}/messages`, {credentials:"include"});
        if (mr.ok) {
          const md = await mr.json() as {messages:{role:string;content:string;tool_calls?:string[]|null}[]};
          const loaded: ChatMsg[] = (md.messages??[]).map(m=>({role:m.role as "user"|"assistant", content:m.content, ...(m.tool_calls?.length?{tool_calls:m.tool_calls}:{})}));
          if (loaded.length>0) { setMsgs(loaded); setConvId(latest.id); }
        }
      }
    } catch {}
    finally { setConvLoad(false); }
  }, []);

  useEffect(() => { void loadConvs(true); }, [loadConvs]);

  // ── Load campaign context once ───────────────────────────────────────────────
  useEffect(() => {
    if (campCtx!==null || campLoad) return;
    setCL(true);
    const until = new Date(); const s30 = new Date(until); s30.setDate(s30.getDate()-30); const s7 = new Date(until); s7.setDate(s7.getDate()-7);
    const fd = (d:Date) => d.toISOString().split("T")[0]!;
    fetch(`${API}/meta/accounts`, {credentials:"include"}).then(r=>r.ok?r.json():null).then(async data => {
      const accs: {id:string}[] = data?.accounts??[];
      if (!accs.length) { setCampCtx(GEN_CTX); return; }
      const all30: CampData[] = [], all7: CampData[] = [], allD: DailyPt[] = [];
      let ok = false;
      await Promise.all(accs.map(async a => {
        try {
          const [r30,r7,rd] = await Promise.all([
            fetch(`${API}/meta/campaigns?ad_account_id=${a.id}&since=${fd(s30)}&until=${fd(until)}`,{credentials:"include"}),
            fetch(`${API}/meta/campaigns?ad_account_id=${a.id}&since=${fd(s7)}&until=${fd(until)}`,{credentials:"include"}),
            fetch(`${API}/meta/account-overview?ad_account_id=${a.id}&since=${fd(s30)}&until=${fd(until)}`,{credentials:"include"}),
          ]);
          if (r30.ok) { ok=true; const d=await r30.json() as {campaigns?:CampData[]}; d.campaigns&&all30.push(...d.campaigns); }
          if (r7.ok)  { ok=true; const d=await r7.json()  as {campaigns?:CampData[]}; d.campaigns&&all7.push(...d.campaigns); }
          if (rd.ok)  { const d=await rd.json() as {daily?:DailyPt[]}; d.daily&&allD.push(...d.daily); }
        } catch {}
      }));
      setCampCtx(ok ? buildCtx(all30,all7,allD) : GEN_CTX);
    }).catch(()=>setCampCtx(GEN_CTX)).finally(()=>setCL(false));
  }, [campCtx, campLoad]);

  // ── Load accounts for selector ───────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/ai/accounts`, {credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then((d:{accounts?:AccountMention[]})=>{
        if (d?.accounts?.length) {
          setAllAccounts(d.accounts);
          // Restore from localStorage, or auto-select if single account
          const stored = localStorage.getItem("chat_selected_accounts");
          if (stored) {
            try { setSelAccIds(new Set(JSON.parse(stored) as string[])); } catch {}
          } else if (d.accounts.length === 1) {
            setSelAccIds(new Set([d.accounts[0]!.id]));
          }
        }
      })
      .catch(()=>{});
  }, []);

  // ── Account selector helpers ──────────────────────────────────────────────────
  const toggleAccId = useCallback((id: string) => {
    setSelAccIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("chat_selected_accounts", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const selectAllAccounts = useCallback(() => {
    const ids = allAccounts.map(a => a.id);
    setSelAccIds(new Set(ids));
    localStorage.setItem("chat_selected_accounts", JSON.stringify(ids));
  }, [allAccounts]);

  const clearAllAccounts = useCallback(() => {
    setSelAccIds(new Set());
    localStorage.setItem("chat_selected_accounts", JSON.stringify([]));
  }, []);

  // ── Conversation helpers ─────────────────────────────────────────────────────
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMsgs([]); setStr(false); setStTxt(""); setAtt(null); setConvId(null); setPending(null);
    setTimeout(()=>inputRef.current?.focus(), 50);
  }, []);

  const loadConv = useCallback(async (conv: ConvRow) => {
    setConvLoad(true);
    try {
      const r = await fetch(`${API}/chat/conversations/${conv.id}/messages`, {credentials:"include"});
      if (!r.ok) return;
      const d = await r.json() as {messages:{role:string;content:string;tool_calls?:string[]|null}[]};
      setMsgs((d.messages??[]).map(m=>({role:m.role as "user"|"assistant", content:m.content, ...(m.tool_calls?.length?{tool_calls:m.tool_calls}:{})})));
      setConvId(conv.id); setPending(null);
    } catch {}
    finally { setConvLoad(false); }
  }, []);

  const deleteConv = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); setDelId(id);
    try {
      await fetch(`${API}/chat/conversations/${id}`, {method:"DELETE",credentials:"include"});
      setConvs(p=>p.filter(c=>c.id!==id));
      if (convIdRef.current===id) { setMsgs([]); setConvId(null); }
    } catch {}
    finally { setDelId(null); }
  }, []);

  const ensureConv = useCallback(async (firstMsg: string): Promise<number> => {
    if (convIdRef.current!==null) return convIdRef.current;
    const r = await fetch(`${API}/chat/conversations`, {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({title:firstMsg.slice(0,80)||"محادثة جديدة"})});
    const c = await r.json() as ConvRow;
    setConvId(c.id); setConvs(p=>[c,...p]);
    return c.id;
  }, []);

  const saveToDB = useCallback(async (cid:number, userTxt:string, asstTxt:string, tc?:string[]) => {
    try {
      const aMsg: {role:string;content:string;tool_calls?:string[]} = {role:"assistant",content:asstTxt};
      if (tc?.length) aMsg.tool_calls=tc;
      await fetch(`${API}/chat/conversations/${cid}/messages`, {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({messages:[{role:"user",content:userTxt},aMsg]})});
      setConvs(p=>{ const i=p.findIndex(c=>c.id===cid); if(i<0) return p; const u={...p[i]!,updated_at:new Date().toISOString()}; return [u,...p.filter((_,j)=>j!==i)]; });
    } catch {}
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────────
  const send = useCallback(async (qa?: string) => {
    const text = (qa!==undefined ? qa : input).trim();
    if ((!text && !attachment) || streaming) return;
    const userText = text || (attachment?.isImage ? "[صورة مرفقة]" : `📎 ${attachment?.name}`);
    setInput(""); if (inputRef.current) inputRef.current.style.height="auto";
    const att = attachment; setAtt(null);
    const newMsg: ChatMsg = {role:"user", content:userText};
    if (att?.isImage && att.previewUrl) newMsg.imagePreviewUrl=att.previewUrl;
    const history = [...msgs, newMsg];
    setMsgs(history); setStr(true); setStTxt(""); setTL([]); setPending(null);
    const ctrl = new AbortController(); abortRef.current=ctrl;
    const tid = setTimeout(()=>ctrl.abort(), 180000);
    let acc = "";
    try {
      const cid = await ensureConv(userText);
      const junk = /^[?؟!.\s]*$|^❌|^عذراً، لم أتمكن/;
      const clean = history.filter(m=>m.role!=="assistant"||(m.content.trim().length>5&&!junk.test(m.content.trim())));
      // Inject selected accounts — AI must focus only on these
      let ctx = campCtx ?? GEN_CTX;
      const selAccList = allAccounts.filter(a => selectedAccIds.has(a.id));
      if (selAccList.length > 0) {
        const names = selAccList.map(a=>`${a.name} (${a.type==="meta"?"Meta Ads":"Google Ads"} — ID: ${a.id})`).join("، ");
        ctx = `⚠️ تعليمات المستخدم: ركّز حصرياً على الحسابات التالية في هذه المحادثة:\n${names}\n\nأي سؤال عن حسابات أخرى غير المذكورة → اعتذر بأدب وأخبر المستخدم أن صلاحياته مقصورة على الحسابات المحددة.\n\n` + ctx;
      }
      const body: Record<string,unknown> = {campaignContext:ctx, messages:clean, conversation_id:cid};
      if (att?.isImage) { body.imageBase64=att.base64; body.imageMimeType=att.mimeType; }
      if (att?.text)   { body.fileText=att.text; body.fileName=att.name; }
      const resp = await fetch(`${API}/ai/chat`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:ctrl.signal, credentials:"include"});
      if (!resp.ok||!resp.body) throw new Error(`HTTP ${resp.status}`);
      const reader=resp.body.getReader(), dec=new TextDecoder();
      const localLabels: string[] = [];
      let done=false;
      outer: while(true) {
        const {done:d,value}=await reader.read();
        if (d||done) break;
        const chunk=dec.decode(value,{stream:true});
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let data: Record<string,unknown>;
          try { data=JSON.parse(line.slice(6)) as Record<string,unknown>; } catch { continue; }
          if (data.error) throw new Error(String(data.error));
          if (data.done) { done=true; break outer; }
          if (data.tool_call_label) { localLabels.push(data.tool_call_label as string); setTL(p=>[...p, data.tool_call_label as string]); }
          if (data.pending_action) setPending(data.pending_action as PendingAction);
          if (data.pending_action_resolved) setPending(p=>p?{...p,...(data.pending_action_resolved as Partial<PendingAction>),detailsLoading:false}:p);
          if (data.content) { setTL([]); acc+=String(data.content); setStTxt(acc); }
        }
      }
      const final = acc.trim().length>3 ? acc : "عذراً، لم أتمكن من الإجابة. حاول مرة أخرى.";
      const aMsg: ChatMsg = {role:"assistant", content:final};
      if (localLabels.length) aMsg.tool_calls=localLabels;
      setMsgs(p=>[...p,aMsg]);
      if (acc.trim().length>3) void saveToDB(cid, userText, acc, localLabels.length?localLabels:undefined);
    } catch(err) {
      if (err instanceof Error) {
        if (err.name==="AbortError") {
          if (stoppedRef.current && acc.trim().length>3) {
            setMsgs(p=>[...p,{role:"assistant",content:acc.trim()}]);
          } else if (!stoppedRef.current) {
            setMsgs(p=>[...p,{role:"assistant",content:"⚠️ انتهى وقت الانتظار. حاول مرة أخرى."}]);
          }
        } else {
          setMsgs(p=>[...p,{role:"assistant",content:"❌ حصل خطأ في الاتصال. حاول تاني."}]);
        }
      }
    } finally {
      stoppedRef.current=false;
      clearTimeout(tid); setStr(false); setStTxt(""); setTL([]); abortRef.current=null;
      setTimeout(()=>inputRef.current?.focus(),50);
    }
  }, [input, msgs, streaming, attachment, campCtx, ensureConv, saveToDB]);

  const execAction = useCallback(async () => {
    if (!pending||executing) return;
    setExec(true);
    try {
      const isNoOp = pending.currentValue!=null && pending.proposedValue!=null && pending.currentValue===pending.proposedValue;
      const r = await fetch(`${API}/pipeboard/action`, {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({tool:pending.tool,args:pending.args,isNoOp})});
      const d = await r.json() as {success?:boolean;message?:string;error?:string};
      const extra = d.message&&!d.message.trim().startsWith("{") ? ` — ${d.message.trim()}` : "";
      const res = r.ok&&d.success ? `✅ تم بنجاح: ${pending.summary}${extra}` : `❌ فشل التنفيذ: ${d.error||"خطأ"}`;
      setMsgs(p=>[...p,{role:"assistant",content:res}]);
      const cid=convIdRef.current; if(cid!==null) void saveToDB(cid,pending.summary,res);
    } catch { setMsgs(p=>[...p,{role:"assistant",content:"❌ خطأ في الاتصال."}]); }
    finally { setExec(false); setPending(null); }
  }, [pending, executing, saveToDB]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const grouped = groupConvs(convs);
  const isEmpty = msgs.length===0 && !streamTxt;

  return (
    <div className="flex h-[calc(100dvh-184px)] sm:h-[calc(100dvh-56px)] overflow-hidden bg-background" dir="rtl">

      {/* ── Mobile backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={()=>setSidebarOpen(false)}
        />
      )}

      {/* ══════════════════════════════════════════════════════ SIDEBAR */}
      <aside className={`
        fixed top-14 bottom-16 right-0 z-50 w-72 flex flex-col bg-background border-l border-border/60 transition-transform duration-300
        sm:top-14 sm:bottom-0
        md:relative md:top-auto md:bottom-auto md:w-64 md:z-auto md:translate-x-0 md:bg-muted/20
        ${sidebarOpen ? "translate-x-0" : "translate-x-full"}
      `}>

        {/* Sidebar header */}
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={()=>{ newChat(); setSidebarOpen(false); }}
            className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium border border-border/60 bg-background hover:bg-muted/60 transition-colors text-foreground"
          >
            <SquarePen className="h-4 w-4 text-muted-foreground shrink-0" />
            محادثة جديدة
          </button>
          <button
            onClick={()=>setSidebarOpen(false)}
            className="md:hidden h-9 w-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-4">
          {convLoad && convs.length===0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : convs.length===0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">لا توجد محادثات بعد</p>
            </div>
          ) : grouped.map(g=>(
            <div key={g.label}>
              <p className="px-2 pb-1 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wide flex items-center gap-1.5">
                <Clock className="h-3 w-3" />{g.label}
              </p>
              <div className="space-y-0.5">
                {g.items.map(c=>(
                  <div
                    key={c.id}
                    onClick={()=>{ void loadConv(c); setSidebarOpen(false); }}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-right ${convId===c.id ? "bg-primary/10 text-primary" : "hover:bg-muted/60 text-foreground/80"}`}
                  >
                    <span className="flex-1 text-[13px] truncate leading-snug">{c.title}</span>
                    <button
                      onClick={e=>void deleteConv(c.id,e)}
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                    >
                      {delId===c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* User footer */}
        <div className="border-t border-border/60 p-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="text-[11px] text-muted-foreground">{user?.role==="admin"?"أدمن":user?.role==="media_buyer"?"ميدياباير":"مدير وسائط"}</p>
            </div>
            <button onClick={logout} className="text-muted-foreground hover:text-destructive transition-colors text-xs" title="خروج">
              خروج
            </button>
          </div>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════ MAIN */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* ── Mobile header ── */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-background shrink-0">
          <button
            onClick={()=>setSidebarOpen(true)}
            className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1 flex items-center justify-center gap-1.5">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">مساعد الإعلانات</span>
          </div>
          <button
            onClick={()=>{ newChat(); setSidebarOpen(false); }}
            className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-muted text-muted-foreground"
          >
            <SquarePen className="h-4 w-4" />
          </button>
        </div>

        {/* ── Account selector bar (mandatory, always visible) ── */}
        {allAccounts.length > 0 && (
          <div className="border-b border-border/40 bg-muted/20 px-3 py-2 shrink-0" dir="rtl">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-nowrap">
              <span className="text-[11px] font-medium text-muted-foreground shrink-0">تحليل:</span>
              {allAccounts.length > 1 && (
                <button
                  onClick={selectedAccIds.size === allAccounts.length ? clearAllAccounts : selectAllAccounts}
                  className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border transition-all ${
                    selectedAccIds.size === allAccounts.length
                      ? "bg-primary/15 border-primary/40 text-primary font-medium"
                      : "bg-card border-border/60 text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {selectedAccIds.size === allAccounts.length
                    ? <CheckSquare className="h-3 w-3" />
                    : <Square className="h-3 w-3 opacity-50" />}
                  الكل
                </button>
              )}
              {allAccounts.map(acc => {
                const sel = selectedAccIds.has(acc.id);
                return (
                  <button
                    key={acc.id}
                    onClick={() => toggleAccId(acc.id)}
                    title={acc.id}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all ${
                      sel
                        ? acc.type === "meta"
                          ? "bg-blue-100 dark:bg-blue-950/40 border-blue-400/60 text-blue-700 dark:text-blue-300 font-medium"
                          : "bg-emerald-100 dark:bg-emerald-950/40 border-emerald-400/60 text-emerald-700 dark:text-emerald-300 font-medium"
                        : "bg-card border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    {sel
                      ? <CheckSquare className="h-3 w-3 shrink-0" />
                      : <Square className="h-3 w-3 shrink-0 opacity-30" />}
                    <span className="max-w-[110px] truncate">{acc.name}</span>
                    <span className="text-[10px] opacity-50 font-mono shrink-0">{acc.type === "meta" ? "M" : "G"}</span>
                  </button>
                );
              })}
            </div>
            {selectedAccIds.size === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                اختر حساباً إعلانياً واحداً على الأقل للبدء
              </p>
            )}
          </div>
        )}

        {/* Messages or Welcome */}
        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (

            /* ── Welcome screen ── */
            <div className="flex flex-col items-center justify-center h-full px-4 sm:px-6 pb-6 sm:pb-16 gap-5 sm:gap-8">
              <div className="flex flex-col items-center gap-3 sm:gap-4 text-center">
                <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-2xl bg-primary/10 flex items-center justify-center shadow-sm">
                  <Bot className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold">مرحباً{user?.username ? ` ${user.username}` : ""}!</h1>
                  <p className="text-muted-foreground mt-1.5 text-sm max-w-sm">
                    أنا مساعدك الذكي لإعلانات Meta &amp; Google Ads. اسألني عن حملاتك أو استخدم الأزرار السريعة أدناه.
                  </p>
                </div>
                {campLoad && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    جاري تحميل بيانات الحملات...
                  </div>
                )}
              </div>

              {/* Day-focused quick actions — prominent top row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 w-full max-w-3xl">
                {QA_DAY.map(q=>(
                  <button
                    key={q.label}
                    onClick={()=>{ setInput(q.prompt); setTimeout(()=>inputRef.current?.focus(),50); }}
                    className="group text-right px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-xl border border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/10 transition-all text-sm shadow-sm"
                  >
                    <span className="block font-semibold text-foreground text-xs sm:text-sm">{q.label}</span>
                    <span className="hidden sm:block text-xs text-muted-foreground mt-1 line-clamp-2 group-hover:text-foreground/70">
                      {q.prompt.slice(0,65)}...
                    </span>
                  </button>
                ))}
              </div>

              {/* Classic Meta quick actions — second row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 w-full max-w-3xl">
                {QA.map(q=>(
                  <button
                    key={q.label}
                    onClick={()=>{ setInput(q.prompt); setTimeout(()=>inputRef.current?.focus(),50); }}
                    className="group text-right px-3 py-2.5 rounded-xl border border-border/60 bg-card hover:border-primary/40 hover:bg-primary/5 transition-all text-sm"
                  >
                    <span className="block font-medium text-foreground text-xs">{q.label}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5 line-clamp-2 group-hover:text-foreground/70">
                      {q.prompt.slice(0,45)}...
                    </span>
                  </button>
                ))}
              </div>

              {/* Google Ads quick actions — third row */}
              <div className="w-full max-w-3xl">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Google Ads</span>
                  <div className="flex-1 h-px bg-emerald-200 dark:bg-emerald-900/40" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {QA_GOOGLE.map(q=>(
                    <button
                      key={q.label}
                      onClick={()=>{ setInput(q.prompt); setTimeout(()=>inputRef.current?.focus(),50); }}
                      className="group text-right px-3 py-2.5 rounded-xl border border-emerald-500/25 bg-emerald-50/50 dark:bg-emerald-950/20 hover:border-emerald-500/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all text-sm"
                    >
                      <span className="block font-medium text-foreground text-xs">{q.label}</span>
                      <span className="block text-[11px] text-muted-foreground mt-0.5 line-clamp-2 group-hover:text-foreground/70">
                        {q.prompt.slice(0,55)}...
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

          ) : (

            /* ── Chat messages ── */
            <div className="max-w-3xl mx-auto w-full px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
              {msgs.map((m,i)=>(
                <div key={i} className={`flex gap-3 ${m.role==="user"?"flex-row-reverse":""}`}>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${m.role==="user"?"bg-primary text-primary-foreground":"bg-muted"}`}>
                    {m.role==="user" ? <User className="h-4 w-4"/> : <Bot className="h-4 w-4 text-primary"/>}
                  </div>
                  <div className={`flex-1 min-w-0 ${m.role==="user"?"flex flex-col items-end":""}`}>
                    {m.role==="user" ? (
                      <>
                        {m.imagePreviewUrl && <img src={m.imagePreviewUrl} alt="" className="mb-2 max-h-48 rounded-lg border border-border" />}
                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 sm:px-4 py-2.5 text-sm max-w-[90%] sm:max-w-[80%] whitespace-pre-wrap">
                          {m.content}
                        </div>
                      </>
                    ) : (
                      <div className="text-foreground">
                        <RenderMarkdown text={m.content} />
                        {m.tool_calls && m.tool_calls.length>0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.tool_calls.map((tc,ti)=>(
                              <span key={ti} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[11px] text-muted-foreground border border-border/60">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />{tc}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Streaming assistant message */}
              {streamTxt && (
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0 text-foreground">
                    <RenderMarkdown text={streamTxt} />
                  </div>
                </div>
              )}

              {/* Tool call labels (in progress) */}
              {toolLabels.length>0 && !streamTxt && (
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-3 space-y-1.5">
                    {toolLabels.map((l,i)=>(
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin shrink-0 text-primary" />{l}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Typing indicator */}
              {streaming && !streamTxt && toolLabels.length===0 && (
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1 items-center h-4">
                      <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" />
                      <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{animationDelay:".15s"}} />
                      <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{animationDelay:".3s"}} />
                    </div>
                  </div>
                </div>
              )}

              {/* Pending action card */}
              {pending && (
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  </div>
                  <div className="flex-1 border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 rounded-2xl rounded-tl-sm p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">إجراء يحتاج موافقتك</p>
                      <p className="text-sm text-foreground mt-1">{pending.summary}</p>
                      {pending.currentValue&&pending.proposedValue&&(
                        <p className="text-xs text-muted-foreground mt-1">
                          من <span className="font-mono text-red-500">{pending.currentValue}</span> → إلى <span className="font-mono text-emerald-500">{pending.proposedValue}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={()=>void execAction()} disabled={executing||pending.detailsLoading}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                        {executing&&<Loader2 className="h-3.5 w-3.5 animate-spin"/>}
                        تنفيذ ✅
                      </button>
                      <button onClick={()=>{setPending(null);setMsgs(p=>[...p,{role:"assistant",content:"تم إلغاء الإجراء."}]);}}
                        className="px-4 py-1.5 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors">
                        إلغاء
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Bottom input area ── */}
        <div className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur px-3 sm:px-4 pt-2 sm:pt-3 pb-3 sm:pb-4">
          {/* Attachment preview */}
          {attachment && (
            <div className="mb-2 max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted border border-border text-sm">
                {attachment.isImage && attachment.previewUrl
                  ? <img src={attachment.previewUrl} alt="" className="h-6 w-6 rounded object-cover"/>
                  : <Paperclip className="h-4 w-4 text-muted-foreground"/>}
                <span className="max-w-[200px] truncate">{attachment.name}</span>
                <button onClick={()=>setAtt(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5"/>
                </button>
              </div>
            </div>
          )}

          {/* Quick actions strip (when chat has messages) — hidden on mobile to save space */}
          {!isEmpty && (
            <div className="hidden sm:flex gap-2 overflow-x-auto pb-2 mb-2 max-w-3xl mx-auto scrollbar-hide">
              {QA_ALL.map((q,idx)=>(
                <button key={q.label} onClick={()=>{ setInput(q.prompt); setTimeout(()=>inputRef.current?.focus(),50); }} disabled={streaming}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all disabled:opacity-50 whitespace-nowrap ${
                    idx < QA_DAY.length
                      ? "border-primary/35 bg-primary/8 text-foreground hover:bg-primary/15 hover:border-primary/60"
                      : idx < QA_DAY.length + QA.length
                        ? "border-border/60 bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                        : "border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:border-emerald-500/60"
                  }`}>
                  {q.label}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="relative flex gap-2 items-end max-w-3xl mx-auto">
            <input ref={fileRef} type="file" accept="image/*,.txt,.csv,.json,.md" className="hidden" onChange={async e=>{const f=e.target.files?.[0];e.target.value="";if(!f)return;try{setAtt(await readFile(f));}catch(err){alert(err instanceof Error?err.message:"خطأ");}}} />

            <button onClick={()=>fileRef.current?.click()} title="إرفاق ملف أو صورة"
              className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground hover:text-primary hover:border-primary/40 transition-all">
              <Paperclip className="h-4.5 w-4.5" />
            </button>

            <textarea
              ref={inputRef}
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={async e=>{
                const img=Array.from(e.clipboardData.items).find(it=>it.type.startsWith("image/"));
                if(!img)return; e.preventDefault();
                const f=img.getAsFile(); if(!f)return;
                try{setAtt(await readFile(f));}catch{}
              }}
              onInput={e=>{const t=e.currentTarget;t.style.height="auto";t.style.height=Math.min(t.scrollHeight,128)+"px";}}
              placeholder="اكتب رسالتك..."
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none bg-card border border-border/60 rounded-2xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 min-h-[44px] max-h-32 leading-relaxed disabled:opacity-50 transition-all"
              style={{height:"auto"}}
            />

            {streaming ? (
              <button
                onClick={()=>{ stoppedRef.current=true; abortRef.current?.abort(); }}
                className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border-2 border-foreground/30 bg-card text-foreground hover:border-foreground/60 hover:bg-muted transition-all shadow-sm"
                title="إيقاف الرد"
              >
                <Square className="h-4 w-4 fill-current"/>
              </button>
            ) : (
              <button
                onClick={()=>void send()}
                disabled={(!input.trim()&&!attachment)||(allAccounts.length>0&&selectedAccIds.size===0)}
                className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-all shadow-sm"
              >
                <Send className="h-5 w-5"/>
              </button>
            )}
          </div>

          <p className="hidden sm:block text-center text-[11px] text-muted-foreground/50 mt-2 max-w-3xl mx-auto">
            المساعد يمكنه الوصول لبيانات Meta Ads مباشرة وتنفيذ إجراءات على الحملات
          </p>
        </div>
      </main>
    </div>
  );
}
