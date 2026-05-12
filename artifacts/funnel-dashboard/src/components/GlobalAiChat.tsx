import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, Trash2, X, MessageSquare, User, Paperclip, Square,
  History, Plus, ChevronRight, ChevronDown, ChevronUp, Clock, Zap, AlertTriangle, Search,
  Globe, BarChart2, Minimize2, Maximize2, Loader2, CheckCircle2, Brain,
  Pencil, Check, Building2,
} from "lucide-react";
import BulkActionPanel, { type BulkActionPayload } from "@/components/BulkActionPanel";
import PipeboardLaunchCard, { type PipeboardLaunchData } from "@/components/PipeboardLaunchCard";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";

interface UserLtmData {
  target_kpis: Record<string, number | null>;
  strategic_rules: string[];
  historical_insights: string;
  updated_at?: string | null;
}

const LTM_KPI_DEFS = [
  { key: "target_cpa",       label: "CPA المستهدف",   unit: "ج.م", placeholder: "40" },
  { key: "target_roas",      label: "ROAS المستهدف",  unit: "×",   placeholder: "3.5" },
  { key: "target_ctr",       label: "CTR المستهدف",   unit: "%",   placeholder: "2.0" },
  { key: "target_hook_rate", label: "Hook Rate",       unit: "%",   placeholder: "30" },
  { key: "target_cpm",       label: "CPM المستهدف",   unit: "ج.م", placeholder: "150" },
] as const;

interface LastIntervention {
  toolName: string;
  executedBy: string;
  executedAt: string;
  hoursAgo: number;
}

interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  currentValue?: string;
  proposedValue?: string;
  detailsLoading?: boolean;
  lastIntervention?: LastIntervention;
}

const INTERVENTION_TOOL_LABELS: Record<string, string> = {
  pause_campaign: "إيقاف الحملة",
  enable_campaign: "تشغيل الحملة",
  update_campaign_budget: "تعديل الميزانية",
  rename_campaign: "تغيير اسم الحملة",
  pause_adset: "إيقاف المجموعة",
  enable_adset: "تشغيل المجموعة",
  update_adset_budget: "تعديل ميزانية المجموعة",
  rename_adset: "تغيير اسم المجموعة",
  duplicate_adset: "نسخ المجموعة",
  duplicate_campaign: "نسخ الحملة",
  pause_ad: "إيقاف الإعلان",
  enable_ad: "تشغيل الإعلان",
  rename_ad: "تغيير اسم الإعلان",
  duplicate_ad: "نسخ الإعلان",
  create_ad_from_post: "إنشاء إعلان من منشور",
};

function formatInterventionAge(hoursAgo: number): string {
  if (hoursAgo < 1) return "منذ أقل من ساعة";
  if (hoursAgo < 24) return `منذ ${hoursAgo} ساعة`;
  const days = Math.floor(hoursAgo / 24);
  if (days === 1) return "أمس";
  if (days < 7) return `منذ ${days} أيام`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "منذ أسبوع" : `منذ ${weeks} أسابيع`;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface ChatMessage { role: "user" | "assistant"; content: string; imagePreviewUrl?: string; tool_calls?: string[] }

interface ConvSummary { id: number; title: string; campaign_id?: string | null; campaign_name?: string | null; snippet?: string | null; created_at: string; updated_at: string }

interface ActivityLog {
  action: string;
  action_label: string;
  page: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

interface ActivityUser {
  id: number;
  username: string;
  role: string;
  last_seen_at: string | null;
  ad_account_id: string | null;
  recent_activity: ActivityLog[];
}

const ROLE_LABELS: Record<string, string> = {
  admin: "أدمن",
  media_buyer: "ميدياباير",
  media_manager: "ميدياكيزتر",
};

const QUICK_ACTIONS = [
  {
    label: "☕ التقرير الصباحي",
    prompt: "اسحب داتا كل الحملات النشطة لليوم وقارنها بمتوسط بيانات آخر 7 أيام. أعطني ملخصاً سريعاً: ما هي الحملات الرابحة وما هي الحملات التي تتخطى الـ CPA المستهدف وتحتاج تدخل فوري؟ ارسم لي جدول مقارنة يعتمد على الـ CPA كأساس للتقييم.",
  },
  {
    label: "🚀 فرص الـ Scale",
    prompt: "حلل الحملات النشطة بناءً على أداء آخر 7 أيام، وحدد الـ Adsets التي تحقق تكلفة شراء (CPA) أقل من المستهدف ومستقرة. جهّز لي مقترحات لزيادة ميزانيتها (Scale) بنسبة 20% مع أزرار التنفيذ المباشر (Approve & Execute) عبر الـ MCP.",
  },
  {
    label: "🔬 تشخيص الـ Funnel",
    prompt: "قم بفحص مسار المبيعات (Funnel) لكل الإعلانات النشطة بناءً على إسناد آخر 7 أيام. استخرج الإعلانات التي تمتلك Hook Rate ممتاز ولكن معدل التحويل (CVR) أو نسبة النقر (CTR) ضعيفة. حدد لي أين الخلل بالضبط (هل المشكلة في الإعلان أم صفحة الهبوط؟) بناءً على الأرقام.",
  },
  {
    label: "📉 تقليل الميزانية",
    prompt: "استخرج فوراً أي إعلان أو Adset تخطى تكلفة الشراء المستهدفة (Target CPA) بشكل ملحوظ في آخر 7 أيام. بدلاً من الإيقاف الفوري، قم بتحليل أسباب التراجع (هل هو تشبع الكرييتف، التكرار Frequency، أم انخفاض الـ CTR؟)، واعرضهم في جدول مع وضع أزرار لتقليل الميزانية (Decrease Budget) بنسبة 30%.",
  },
  {
    label: "🕵️ تقييم التعديلات",
    prompt: "ابحث عن الحملات أو الـ Adsets التي قمنا بإجراء تعديلات عليها مؤخراً (مثل تقليل الميزانية) خلال الـ 7 أيام الماضية. قارن أداءها (CPA, CVR) في الأيام التي سبقت التعديل بالأيام التي تلته. هل نجح الإجراء في تحسين الأداء ووقف النزيف؟ أم أن الحملة مستمرة في الخسارة وتحتاج إجراء أقوى؟",
  },
] as const;

function formatRelative(dateStr: string): string {
  const now = Date.now();
  const ts = new Date(dateStr).getTime();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "أمس";
  if (diffDay < 7) return `منذ ${diffDay} أيام`;
  return new Date(dateStr).toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

function groupConversations(convs: ConvSummary[]): { label: string; items: ConvSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const week = today - 6 * 86400000;
  const month = today - 29 * 86400000;

  const groups: Record<string, ConvSummary[]> = {
    اليوم: [],
    أمس: [],
    "آخر 7 أيام": [],
    "آخر 30 يوم": [],
    أقدم: [],
  };

  for (const c of convs) {
    const t = new Date(c.updated_at).getTime();
    if (t >= today) groups["اليوم"]!.push(c);
    else if (t >= yesterday) groups["أمس"]!.push(c);
    else if (t >= week) groups["آخر 7 أيام"]!.push(c);
    else if (t >= month) groups["آخر 30 يوم"]!.push(c);
    else groups["أقدم"]!.push(c);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function buildActivityContext(users: ActivityUser[]): string {
  const lines: string[] = [
    "أنت مساعد Meta Ads ولديك وصول كامل لبيانات نشاط الفريق التالية. أجب بناءً على هذه البيانات الحقيقية.",
    "",
    "## بيانات نشاط الفريق (حقيقية من النظام):",
    "",
  ];

  for (const u of users) {
    lines.push(`### ${u.username} — ${ROLE_LABELS[u.role] ?? u.role}`);
    lines.push(`- آخر ظهور: ${u.last_seen_at ? formatRelative(u.last_seen_at) : "لم يسجّل الدخول بعد"}`);
    if (u.recent_activity.length === 0) {
      lines.push("- لا يوجد نشاط مسجّل");
    } else {
      lines.push(`- إجمالي السجلات المتاحة: ${u.recent_activity.length}`);
      lines.push("- آخر الأنشطة:");
      for (const log of u.recent_activity.slice(0, 15)) {
        let entry = `  • ${log.action_label}`;
        if (log.page) entry += ` في "${log.page}"`;
        if (log.meta?.campaign) entry += ` (حملة: ${log.meta.campaign})`;
        entry += ` — ${formatRelative(log.created_at)}`;
        lines.push(entry);
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("بناءً على هذه البيانات الحقيقية، أجب على أسئلة المستخدم عن أداء الفريق، نشاطهم، وأي تحليلات مطلوبة.");
  return lines.join("\n");
}

const GENERAL_CONTEXT = `أنت مساعد Meta Ads عام. أجب على أسئلة المستخدم عن استراتيجيات Meta Ads، تحسين الأداء، قراءة المؤشرات، وأفضل الممارسات.`;

const SUGGESTED_GENERAL = [
  "ما هو Hook Rate المثالي؟",
  "كيف أحسّن الـ CPA؟",
  "متى أوقف الحملة؟",
  "كيف أتعامل مع Frequency عالية؟",
];

const SUGGESTED_WITH_DATA = [
  "⚡ فرص Scale اليوم",
  "🛡️ صيانة خسائر اليوم",
  "🔍 فحص منتصف اليوم",
  "الحملات اللي محتاجة تدخل؟",
];

interface CampaignData {
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

interface DailyPoint {
  day: string;
  spend: number;
  impressions: number;
  purchases: number;
  cpa: number;
  link_clicks: number;
}

function buildCampaignsContext(campaigns30d: CampaignData[], campaigns7d: CampaignData[], dailyRows: DailyPoint[]): string {
  if (campaigns30d.length === 0 && campaigns7d.length === 0) return GENERAL_CONTEXT;

  const fmt = (n: number, dec = 0) =>
    n.toLocaleString("ar-EG", { maximumFractionDigits: dec });
  const fmtPct = (n: number) => `${n.toFixed(2)}%`;
  const delta = (recent: number, older: number): string => {
    if (older === 0) return "";
    const pct = ((recent - older) / older) * 100;
    if (Math.abs(pct) < 2) return " (ثابت)";
    return pct > 0 ? ` (↑ ${pct.toFixed(0)}%)` : ` (↓ ${Math.abs(pct).toFixed(0)}%)`;
  };

  const statusMap: Record<string, string> = {
    ACTIVE: "نشطة ✅",
    PAUSED: "موقوفة ⏸",
    ARCHIVED: "مؤرشفة",
    DELETED: "محذوفة",
    CAMPAIGN_PAUSED: "موقوفة ⏸",
  };

  // Build lookup map for 7d by campaign id
  const map7d = new Map<string, CampaignData>(campaigns7d.map((c) => [c.id, c]));

  // Cap at top 15 campaigns by spend to keep context size manageable
  const allBase = campaigns30d.length > 0 ? campaigns30d : campaigns7d;
  const base = [...allBase].sort((a, b) => b.spend - a.spend).slice(0, 15);
  const totalSpend30 = campaigns30d.reduce((s, c) => s + c.spend, 0);
  const totalPurchases30 = campaigns30d.reduce((s, c) => s + c.purchases, 0);
  const avgCpa30 = totalPurchases30 > 0 ? totalSpend30 / totalPurchases30 : 0;

  const totalSpend7 = campaigns7d.reduce((s, c) => s + c.spend, 0);
  const totalPurchases7 = campaigns7d.reduce((s, c) => s + c.purchases, 0);
  const avgCpa7 = totalPurchases7 > 0 ? totalSpend7 / totalPurchases7 : 0;

  const activeCampaigns = base.filter(
    (c) => c.effective_status === "ACTIVE" || c.effective_status === "CAMPAIGN_PAUSED"
  );

  const lines: string[] = [
    "أنت مساعد Meta Ads متخصص ولديك بيانات الحملات لفترتين: آخر 7 أيام وآخر 30 يوم.",
    "قاعدة مهمة: لو السؤال عن حملة بعينها أو أداء يومي تفصيلي — استخدم الأدوات المتاحة (get_campaign_daily أو get_adsets) مباشرةً باستخدام الـ id الموجود في كل حملة أدناه. لا تستنتج من البيانات الإجمالية بدل الرجوع للأداة.",
    "",
    "## ملخص الأداء:",
    "",
    "| المؤشر | آخر 7 أيام | آخر 30 يوم | التغيير |",
    "|--------|-----------|------------|---------|",
    `| الإنفاق | ${fmt(totalSpend7)} EGP | ${fmt(totalSpend30)} EGP | ${delta(totalSpend7, totalSpend30 / 30 * 7)} |`,
    `| الطلبات | ${fmt(totalPurchases7)} | ${fmt(totalPurchases30)} | ${delta(totalPurchases7, totalPurchases30 / 30 * 7)} |`,
    `| متوسط CPA | ${avgCpa7 > 0 ? fmt(avgCpa7) + " EGP" : "—"} | ${avgCpa30 > 0 ? fmt(avgCpa30) + " EGP" : "—"} | ${avgCpa7 > 0 && avgCpa30 > 0 ? delta(avgCpa7, avgCpa30) : ""} |`,
    "",
    `الحملات النشطة: ${activeCampaigns.length} من ${base.length}`,
    "",
    `## تفاصيل كل حملة (7 أيام | 30 يوم):`,
    "",
  ];

  for (const c30 of base) {
    const c7 = map7d.get(c30.id);
    lines.push(`### ${c30.name} (id: ${c30.id})`);
    lines.push(`- الحالة: ${statusMap[c30.effective_status] ?? c30.effective_status}`);
    lines.push(`- الهدف: ${c30.objective}`);

    if (c7) {
      lines.push(`- الإنفاق: ${fmt(c7.spend)} EGP (7ي) | ${fmt(c30.spend)} EGP (30ي)${delta(c7.spend, c30.spend / 30 * 7)}`);
      lines.push(`- الطلبات: ${fmt(c7.purchases)} (7ي) | ${fmt(c30.purchases)} (30ي)${delta(c7.purchases, c30.purchases / 30 * 7)}`);
      lines.push(`- CPA: ${c7.cpa > 0 ? fmt(c7.cpa) + " EGP" : "—"} (7ي) | ${c30.cpa > 0 ? fmt(c30.cpa) + " EGP" : "—"} (30ي)${c7.cpa > 0 && c30.cpa > 0 ? delta(c7.cpa, c30.cpa) : ""}`);
      lines.push(`- CTR: ${fmtPct(c7.ctr)} (7ي) | ${fmtPct(c30.ctr)} (30ي)`);
    } else {
      lines.push(`- الإنفاق: ${fmt(c30.spend)} EGP`);
      lines.push(`- الطلبات: ${fmt(c30.purchases)}`);
      lines.push(`- CPA: ${c30.cpa > 0 ? fmt(c30.cpa) + " EGP" : "—"}`);
      lines.push(`- CTR: ${fmtPct(c30.ctr)}`);
    }
    lines.push("");
  }

  // Daily trend: summary only (last 3 days vs prev 3) — AI uses get_account_daily for full table
  if (dailyRows.length >= 6) {
    const sorted = [...dailyRows].sort((a, b) => a.day.localeCompare(b.day));
    const last3 = sorted.slice(-3);
    const prev3 = sorted.slice(-6, -3);
    const avgCpaLast = last3.reduce((s, d) => s + d.cpa, 0) / last3.length;
    const avgCpaPrev = prev3.reduce((s, d) => s + d.cpa, 0) / prev3.length;
    const cpaChange = avgCpaPrev > 0 ? ((avgCpaLast - avgCpaPrev) / avgCpaPrev) * 100 : 0;
    const avgSpendLast = last3.reduce((s, d) => s + d.spend, 0) / last3.length;
    const avgSpendPrev = prev3.reduce((s, d) => s + d.spend, 0) / prev3.length;
    const spendChange = avgSpendPrev > 0 ? ((avgSpendLast - avgSpendPrev) / avgSpendPrev) * 100 : 0;
    lines.push("### اتجاه آخر 3 أيام (مقارنة بالـ 3 أيام السابقة):");
    lines.push(`- متوسط CPA: ${fmt(avgCpaLast)} EGP → ${cpaChange > 2 ? `ارتفع ↑${cpaChange.toFixed(0)}%` : cpaChange < -2 ? `انخفض ↓${Math.abs(cpaChange).toFixed(0)}%` : "ثابت"}`);
    lines.push(`- متوسط الإنفاق اليومي: ${fmt(avgSpendLast)} EGP → ${spendChange > 2 ? `ارتفع ↑${spendChange.toFixed(0)}%` : spendChange < -2 ? `انخفض ↓${Math.abs(spendChange).toFixed(0)}%` : "ثابت"}`);
    lines.push("_(للأداء اليومي التفصيلي استخدم get_account_daily)_");
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "البيانات أعلاه هي ملخص 7/30 يوم لكل الحملات والأداء اليومي الإجمالي للحساب. لو سُئلت عن حملة محددة أو أداء يومي لحملة بعينها، استخدم الأدوات: get_campaign_daily(campaign_id) أو get_adsets(campaign_id) — الـ id لكل حملة موجود في العناوين أعلاه."
  );

  return lines.join("\n");
}

// ── Chart colors palette ─────────────────────────────────────────────────────
const CHART_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899"];

interface ChartSpec {
  type: "bar" | "line" | "multibar";
  title?: string;
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  data: Record<string, string | number>[];
  unit?: string;
}

function ChartBlock({ spec }: { spec: ChartSpec }) {
  const fmt = (v: unknown) => typeof v === "number" ? v.toLocaleString("ar-EG") : String(v ?? "");
  const unit = spec.unit ?? "";
  return (
    <div className="my-3 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
      {spec.title && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/30">
          <BarChart2 className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-[13px] font-semibold text-foreground">{spec.title}</span>
        </div>
      )}
      <div className="px-2 py-3" dir="ltr">
        <ResponsiveContainer width="100%" height={220}>
          {spec.type === "line" ? (
            <LineChart data={spec.data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}${unit}`} width={48} />
              <Tooltip formatter={(v: unknown) => [`${fmt(v)}${unit}`, ""]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {spec.series.map((s, idx) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color ?? CHART_COLORS[idx % CHART_COLORS.length]}
                  strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={spec.data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}${unit}`} width={48} />
              <Tooltip formatter={(v: unknown) => [`${fmt(v)}${unit}`, ""]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {spec.series.map((s, idx) =>
                spec.series.length === 1 ? (
                  <Bar key={s.key} dataKey={s.key} name={s.label} radius={[4, 4, 0, 0]} maxBarSize={48}>
                    {spec.data.map((_, di) => (
                      <Cell key={di} fill={CHART_COLORS[di % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                ) : (
                  <Bar key={s.key} dataKey={s.key} name={s.label}
                    fill={s.color ?? CHART_COLORS[idx % CHART_COLORS.length]}
                    radius={[4, 4, 0, 0]} maxBarSize={32} />
                )
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\([+-][0-9]+(?:\.[0-9]+)?%\))/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i} className="italic text-foreground/80">{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="font-mono text-[12px] bg-muted/70 text-primary px-1.5 py-0.5 rounded-md border border-border/50">{part.slice(1, -1)}</code>;
    if (/^\(\+[0-9]/.test(part)) return <span key={i} className="ai-trend-up">{part}</span>;
    if (/^\(-[0-9]/.test(part))  return <span key={i} className="ai-trend-down">{part}</span>;
    return part;
  });
}

function parseTableRow(line: string): string[] {
  return line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") { i++; continue; }

    // Observation cards :::إنجاز / :::تراجع / :::ملاحظة
    if (/^:::(إنجاز|تراجع|ملاحظة)\s*$/.test(line.trim())) {
      const typeAr = line.trim().replace(/^:::/, "").trim();
      const cssClass = typeAr === "إنجاز" ? "ai-obs-win" : typeAr === "تراجع" ? "ai-obs-loss" : "ai-obs-note";
      const label    = typeAr === "إنجاز" ? "إنجاز 🏆"  : typeAr === "تراجع" ? "تراجع 🔴"  : "ملاحظة 💡";
      const cardLines: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== ":::") { cardLines.push(lines[i]!); i++; }
      i++;
      elements.push(
        <div key={`obs-${i}`} className={`ai-obs-card ${cssClass}`}>
          <span className="ai-obs-label">{label}</span>
          <div>{cardLines.map((cl, ci) => <div key={ci}>{renderInline(cl)}</div>)}</div>
        </div>
      );
      continue;
    }

    // Fenced code block ``` — detect "json chart" / "bulk_action" for live rendering
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim().toLowerCase();
      const isChart = lang === "json chart" || lang === "chart" || lang === "json-chart";
      const isPipeboardLaunch = lang === "pipeboard_launch" || lang === "pipeboard-launch";
      const isBulkLang = lang === "bulk_action" || lang === "json bulk_action" || lang === "bulk-action"
                      || lang === "bulk action"  || lang === "json_bulk_action" || lang.includes("bulk");
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++;
      const raw = codeLines.join("\n");

      // ── Helper: try to parse raw as a BulkActionPayload regardless of lang ──
      const tryParseBulkG = (): BulkActionPayload | null => {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            const arr = parsed as Record<string, unknown>[];
            if (arr.length > 0 && typeof arr[0]?.type === "string")
              return { actions: parsed as BulkActionPayload["actions"] };
          } else if (parsed && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;
            if (Array.isArray(obj.actions)) return parsed as BulkActionPayload;
            if (typeof obj.type === "string") return { actions: [parsed as BulkActionPayload["actions"][0]] };
          }
        } catch { /* not JSON */ }
        return null;
      };

      if (isPipeboardLaunch) {
        try {
          const launchData = JSON.parse(raw) as PipeboardLaunchData;
          elements.push(<PipeboardLaunchCard key={`launch-${i}`} data={launchData} />);
        } catch {
          elements.push(<pre key={`code-${i}`} className="my-2 rounded-lg bg-muted/40 p-3 text-xs overflow-x-auto" dir="ltr">{raw}</pre>);
        }
      } else if (isBulkLang) {
        const bulkPayload = tryParseBulkG();
        if (bulkPayload) {
          elements.push(<BulkActionPanel key={`bulk-${i}`} payload={bulkPayload} />);
        } else {
          elements.push(<pre key={`code-${i}`} className="my-2 rounded-lg bg-muted/40 p-3 text-xs overflow-x-auto" dir="ltr">{raw}</pre>);
        }
      } else if (isChart) {
        try {
          const spec = JSON.parse(raw) as ChartSpec;
          elements.push(<ChartBlock key={`chart-${i}`} spec={spec} />);
        } catch {
          elements.push(
            <div key={`code-${i}`} className="my-3 rounded-xl overflow-hidden border border-border/60 bg-muted/40">
              <pre className="p-3 overflow-x-auto text-[12px] font-mono text-foreground/85 leading-relaxed whitespace-pre" dir="ltr">{raw}</pre>
            </div>
          );
        }
      } else {
        // Structural fallback: try to detect bulk_action JSON in ANY code block
        // (model sometimes uses ```json or other lang instead of ```bulk_action)
        const bulkPayload = tryParseBulkG();
        if (bulkPayload) {
          elements.push(<BulkActionPanel key={`bulk-${i}`} payload={bulkPayload} />);
        } else {
          elements.push(
            <div key={`code-${i}`} className="my-3 rounded-xl overflow-hidden border border-border/60 bg-muted/40">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border-b border-border/40">
                <div className="flex gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400/60" /><span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" /><span className="w-2.5 h-2.5 rounded-full bg-green-400/60" /></div>
                <span className="text-[10px] text-muted-foreground/60 font-mono">{lang || "code"}</span>
              </div>
              <pre className="p-3 overflow-x-auto text-[12px] font-mono text-foreground/85 leading-relaxed whitespace-pre" dir="ltr">{raw}</pre>
            </div>
          );
        }
      }
      continue;
    }

    // Horizontal rule ---
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="my-3 border-border/40" />);
      i++; continue;
    }

    // Headings # ## ###
    if (/^#{1,3}\s/.test(line)) {
      const level = (line.match(/^(#{1,3})/)?.[1].length ?? 1);
      const content = line.replace(/^#{1,3}\s/, "");
      if (level === 1) {
        elements.push(
          <p key={i} className="ai-h1-sovereign">{renderInline(content)}</p>
        );
      } else {
        const sizeClass = level === 2 ? "text-[14px]" : "text-[13px]";
        elements.push(
          <p key={i} className={`font-bold ${sizeClass} text-foreground mt-4 mb-1.5 leading-snug border-b border-border/40 pb-1.5`}>
            {renderInline(content)}
          </p>
        );
      }
      i++; continue;
    }

    // Blockquote > — Opus Logic card if contains strategic keywords, else standard
    if (/^>\s/.test(line)) {
      const bqLines: string[] = [];
      while (i < lines.length && /^>\s/.test(lines[i]!)) {
        bqLines.push(lines[i]!.replace(/^>\s/, ""));
        i++;
      }
      const bqText = bqLines.join("\n");
      const isOpus = /المنطق الاستراتيجي|Opus Logic/i.test(bqText);
      if (isOpus) {
        elements.push(
          <div key={i} className="ai-opus-logic">{renderInline(bqText)}</div>
        );
      } else {
        elements.push(
          <div key={i} className="my-2 border-r-4 border-primary/40 pr-3 py-1 bg-primary/5 rounded-sm text-[13px] text-foreground/80 leading-relaxed">
            {renderInline(bqText)}
          </div>
        );
      }
      continue;
    }

    // Markdown table  | col | col |
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[-| :]+\|/.test(lines[i + 1]!)) {
      const headers = parseTableRow(line);
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        rows.push(parseTableRow(lines[i]!));
        i++;
      }
      // Detect column type for heatmap + bold
      const colTypes = headers.map(h => {
        if (/جذب|hook\s*rate/i.test(h)) return "hook";
        if (/نقر|ctr/i.test(h) && !/outbound/i.test(h)) return "ctr";
        if (/hold\s*rate|مشاهدة كاملة|مشاهدة/i.test(h)) return "hold";
        if (/cpa|تكلفة التحويل|تكلفة\s*تحويل/i.test(h)) return "cpa";
        if (/إنفاق|spend/i.test(h)) return "spend";
        return "";
      });
      // Name cell renderer — splits "Name (id:xxx)" into name + id badge
      const renderNameCell = (raw: string) => {
        const m = raw.match(/^(.*?)\s*\(id:([^)]+)\)\s*$/);
        if (m) {
          return (
            <span className="ai-tbl-name-wrap">
              <span className="ai-tbl-name-text" title={m[1]!}>{m[1]}</span>
              <span className="ai-tbl-name-id">{m[2]}</span>
            </span>
          );
        }
        return <span className="ai-tbl-name-plain" title={raw}>{renderInline(raw)}</span>;
      };
      elements.push(
        <div key={`tbl-${i}`} className="ai-tbl-wrap">
          <table className="ai-tbl">
            <thead>
              <tr>
                {headers.map((h, j) => (
                  <th key={j}>{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const rowText = row.join(" ");
                const isWinner = /🟢\s*(Scale|توسيع|مقياس)|Winning Angle|✅\s*Scale/i.test(rowText);
                const isKill   = /🔴\s*(Kill|أوقف|إيقاف)/i.test(rowText);
                const rowClass = isWinner ? "ai-tbl-winner-row" : isKill ? "ai-tbl-kill-row" : "";
                return (
                  <tr key={ri} className={rowClass || undefined}>
                    {row.map((cell, ci) => {
                      if (ci === 0) return <td key={ci}>{renderNameCell(cell)}</td>;
                      const colType = colTypes[ci] ?? "";
                      const isActive = /نشطة|ACTIVE|✅/.test(cell);
                      const isPaused = /متوقفة|PAUSED|⏸/.test(cell);
                      const isStatus = isActive || isPaused || /^[🔴🟡🟢]/.test(cell);
                      const numVal = parseFloat(cell.replace(/[^\d.,]/g, "").replace(",", ""));
                      let extraClass = "";
                      if (colType === "hook" && !isNaN(numVal)) {
                        extraClass = numVal >= 30 ? "ai-tbl-hook-good" : numVal < 20 ? "ai-tbl-hook-bad" : "";
                      } else if (colType === "ctr" && !isNaN(numVal)) {
                        extraClass = numVal >= 1.5 ? "ai-tbl-ctr-good" : numVal < 0.8 ? "ai-tbl-ctr-bad" : "";
                      } else if (colType === "hold" && !isNaN(numVal)) {
                        extraClass = numVal >= 20 ? "ai-tbl-hold-good" : numVal < 10 ? "ai-tbl-hold-bad" : "";
                      } else if (colType === "cpa" && !isNaN(numVal)) {
                        extraClass = numVal <= 40 ? "ai-tbl-cpa-good" : numVal > 100 ? "ai-tbl-cpa-bad" : "";
                      } else if (colType === "spend") {
                        extraClass = "ai-tbl-primary";
                      }
                      return (
                        <td key={ci} className={extraClass || undefined}>
                          {isStatus
                            ? <span className={isActive ? "ai-tbl-pill-green" : "ai-tbl-pill-amber"}>{renderInline(cell)}</span>
                            : renderInline(cell)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      continue;
    }


    // Bullet list
    if (/^[-•*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-•*]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-2 my-2">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 items-start leading-relaxed">
              <span className="shrink-0 mt-[6px] w-1.5 h-1.5 rounded-full bg-primary/60" />
              <span className="flex-1 text-[13.5px] text-foreground/90 leading-relaxed">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/.test(line)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && /^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^(\d+|[١٢٣٤٥٦٧٨٩٠]+)[.)]\s/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-2.5 my-2">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 items-start leading-relaxed">
              <span className="shrink-0 min-w-[24px] h-[24px] rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center mt-[1px] border border-primary/20">
                {j + num}
              </span>
              <span className="flex-1 text-[13.5px] text-foreground/90 pt-0.5 leading-relaxed">{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      num += items.length;
      continue;
    }

    // Paragraph
    elements.push(
      <p key={i} className="text-[13.5px] text-foreground/90 leading-[1.75]">{renderInline(line)}</p>
    );
    i++;
  }
  return <div className="space-y-1.5">{elements}</div>;
}

interface Attachment {
  base64?: string;
  mimeType?: string;
  previewUrl?: string;
  text?: string;
  name: string;
  isImage: boolean;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES  = ["text/plain", "text/csv", "application/json"];

function readFileAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const isImage = IMAGE_TYPES.includes(file.type);
    const isText  = TEXT_TYPES.includes(file.type) || file.name.endsWith(".txt") || file.name.endsWith(".csv");
    if (!isImage && !isText) { reject(new Error("نوع الملف غير مدعوم")); return; }
    const reader = new FileReader();
    if (isImage) {
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        resolve({ base64: dataUrl.split(",")[1] ?? "", mimeType: file.type, previewUrl: dataUrl, name: file.name, isImage: true });
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = (e) => { resolve({ text: e.target?.result as string, name: file.name, isImage: false }); };
      reader.readAsText(file);
    }
    reader.onerror = () => reject(new Error("فشل قراءة الملف"));
  });
}

type View = "chat" | "history" | "memory";

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-amber-200 dark:bg-amber-700 text-foreground rounded-sm px-0.5">{part}</mark> : part
  );
}

interface GlobalAiChatProps {
  onRegisterOpenFn?: (fn: (convId: number, campaignId?: string | null) => void) => void;
  onCampaignSelected?: (campaignId: string) => void;
}

export function GlobalAiChat({ onRegisterOpenFn, onCampaignSelected }: GlobalAiChatProps) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loc, navigate] = useLocation();
  const isOnChatPage = loc === "/chat";

  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [searching, setSearching] = useState(false);
  const [toolCallLabels, setToolCallLabels] = useState<string[]>([]);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [executingAction, setExecutingAction] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});

  // Long-Term Memory
  const [ltmData, setLtmData]           = useState<UserLtmData | null>(null);
  const [ltmLoading, setLtmLoading]     = useState(false);
  const [ltmSaving, setLtmSaving]       = useState(false);
  const [ltmEditKpis, setLtmEditKpis]   = useState<Record<string, string>>({});
  const [ltmEditRules, setLtmEditRules] = useState<string[]>([]);
  const [ltmEditInsights, setLtmEditInsights] = useState("");
  const [ltmNewRule, setLtmNewRule]     = useState("");
  const [ltmDirty, setLtmDirty]         = useState(false);

  // Conversation rename
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Default account picker (persisted in localStorage)
  const [defaultAccountId, setDefaultAccountId] = useState<string>(() => localStorage.getItem("ai_default_account_id") ?? "");
  const [defaultAccountName, setDefaultAccountName] = useState<string>(() => localStorage.getItem("ai_default_account_name") ?? "");
  const [availableAccounts, setAvailableAccounts] = useState<{ id: string; name?: string }[]>([]);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  // Global history search
  const [historySearch, setHistorySearch] = useState("");
  const [historySearchResults, setHistorySearchResults] = useState<ConvSummary[] | null>(null);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);

  const [activityUsers, setActivityUsers] = useState<ActivityUser[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  const [campaignsCtx, setCampaignsCtx] = useState<string | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const convIdRef = useRef<number | null>(null);
  const accountPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { convIdRef.current = convId; }, [convId]);

  // Close account picker when clicking outside
  useEffect(() => {
    if (!showAccountPicker) return;
    const handler = (e: MouseEvent) => {
      if (accountPickerRef.current && !accountPickerRef.current.contains(e.target as Node)) {
        setShowAccountPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAccountPicker]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (open && view === "chat") setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, view]);

  // Fetch activity data when admin opens the chat (once per session)
  useEffect(() => {
    if (!open || !isAdmin || activityUsers !== null) return;
    setActivityLoading(true);
    fetch(`${API}/admin/user-activity`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.users) setActivityUsers(data.users as ActivityUser[]); })
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, [open, isAdmin, activityUsers]);

  // Fetch campaigns context (7d + 30d) when chat opens; retries each open if previous attempt failed
  useEffect(() => {
    if (!open || campaignsLoading) return;
    if (campaignsCtx !== null) return;
    setCampaignsLoading(true);

    const until = new Date();
    const since30 = new Date(until); since30.setDate(since30.getDate() - 30);
    const since7  = new Date(until); since7.setDate(since7.getDate() - 7);
    const fmtDate = (d: Date) => d.toISOString().split("T")[0]!;
    const u = fmtDate(until);
    const s30 = fmtDate(since30);
    const s7  = fmtDate(since7);

    fetch(`${API}/meta/accounts`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        const accounts: { id: string; name?: string }[] = data?.accounts ?? [];
        if (accounts.length > 0) setAvailableAccounts(accounts);
        if (accounts.length === 0) { setCampaignsCtx(GENERAL_CONTEXT); return; }

        const all30: CampaignData[] = [];
        const all7: CampaignData[] = [];
        const allDaily: DailyPoint[] = [];
        let anySuccess = false;

        // Fetch campaigns (7d + 30d) and daily overview in parallel for each account
        await Promise.all(accounts.map(async (acc) => {
          try {
            const [r30, r7, rDaily] = await Promise.all([
              fetch(`${API}/meta/campaigns?ad_account_id=${acc.id}&since=${s30}&until=${u}`, { credentials: "include" }),
              fetch(`${API}/meta/campaigns?ad_account_id=${acc.id}&since=${s7}&until=${u}`,  { credentials: "include" }),
              fetch(`${API}/meta/account-overview?ad_account_id=${acc.id}&since=${s30}&until=${u}`, { credentials: "include" }),
            ]);
            if (r30.ok) {
              anySuccess = true;
              const d = await r30.json() as { campaigns?: CampaignData[] };
              if (d.campaigns) all30.push(...d.campaigns);
            }
            if (r7.ok) {
              anySuccess = true;
              const d = await r7.json() as { campaigns?: CampaignData[] };
              if (d.campaigns) all7.push(...d.campaigns);
            }
            if (rDaily.ok) {
              const d = await rDaily.json() as { daily?: DailyPoint[] };
              if (d.daily) allDaily.push(...d.daily);
            }
          } catch {}
        }));

        if (anySuccess) {
          setCampaignsCtx(buildCampaignsContext(all30, all7, allDaily));
        } else {
          setCampaignsCtx(GENERAL_CONTEXT);
        }
      })
      .catch(() => { setCampaignsCtx(GENERAL_CONTEXT); })
      .finally(() => setCampaignsLoading(false));
  }, [open, campaignsCtx, campaignsLoading]);

  // Load conversation list; when autoLoadLatest=true, also restores the most recent conversation
  const loadConversations = useCallback((autoLoadLatest = false) => {
    setConvLoading(true);
    fetch(`${API}/chat/conversations`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then(async (data) => {
        const convs: ConvSummary[] = data.conversations ?? [];
        setConversations(convs);
        if (autoLoadLatest && convIdRef.current === null && convs.length > 0) {
          const latest = convs[0]!;
          try {
            const resp = await fetch(`${API}/chat/conversations/${latest.id}/messages`, { credentials: "include" });
            if (resp.ok) {
              const msgData = await resp.json() as { messages: { role: string; content: string; tool_calls?: string[] | null }[] };
              const loaded: ChatMessage[] = (msgData.messages ?? []).map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
                ...(m.tool_calls && m.tool_calls.length > 0 ? { tool_calls: m.tool_calls } : {}),
              }));
              if (loaded.length > 0) {
                setMessages(loaded);
                setConvId(latest.id);
              }
            }
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setConvLoading(false));
  }, []);

  useEffect(() => {
    if (open) loadConversations(true);
  }, [open, loadConversations]);

  // Debounced global search across all campaigns
  useEffect(() => {
    setHistorySearchResults(null);
    if (!historySearch.trim()) {
      setHistorySearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setHistorySearchLoading(true);
      try {
        const params = new URLSearchParams({ global: "true", q: historySearch.trim() });
        const r = await fetch(`${API}/chat/conversations?${params}`, { credentials: "include", signal: controller.signal });
        if (r.ok) {
          const d = await r.json() as { conversations: ConvSummary[] };
          setHistorySearchResults(d.conversations);
        }
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setHistorySearchResults([]);
      } finally {
        setHistorySearchLoading(false);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [historySearch]);

  // Clear search when closing history view
  useEffect(() => {
    if (view !== "history") {
      setHistorySearch("");
      setHistorySearchResults(null);
    }
  }, [view]);

  // Open a specific conversation by id from anywhere (e.g. NavConversationSearch)
  const openToConversation = useCallback(async (convId: number, campaignId?: string | null) => {
    // If campaign-linked, notify FullRouter via callback (in-memory, reactive) and navigate to dashboard
    if (campaignId) {
      onCampaignSelected?.(campaignId);
      navigate("/");
    }
    // Load messages and open the panel directly — works regardless of current page
    setConvLoading(true);
    try {
      const resp = await fetch(`${API}/chat/conversations/${convId}/messages`, { credentials: "include" });
      if (resp.ok) {
        const data = await resp.json() as { messages: { role: string; content: string; tool_calls?: string[] | null }[] };
        const loaded: ChatMessage[] = (data.messages ?? []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          ...(m.tool_calls && m.tool_calls.length > 0 ? { tool_calls: m.tool_calls } : {}),
        }));
        setMessages(loaded);
        setConvId(convId);
        setExpandedSources({});
        setView("chat");
      }
    } catch {}
    finally { setConvLoading(false); }
    setOpen(true);
  }, [navigate, onCampaignSelected]);

  const buildContext = useCallback((): string => {
    const parts: string[] = [];

    if (defaultAccountId) {
      const name = defaultAccountName || defaultAccountId;
      parts.push(
        `⭐ الحساب الإعلاني الافتراضي المختار: ${defaultAccountId}${name !== defaultAccountId ? ` (${name})` : ""}\n` +
        `استخدم هذا الـ account_id مباشرةً في جميع العمليات. لا تحتاج لاستدعاء get_campaigns للحصول على account_id إلا إذا طلب المستخدم صراحةً حساباً مختلفاً.`
      );
    }

    if (campaignsCtx && campaignsCtx !== GENERAL_CONTEXT) {
      parts.push(campaignsCtx);
    }

    if (isAdmin && activityUsers && activityUsers.length > 0) {
      parts.push(buildActivityContext(activityUsers));
    }

    if (parts.length > 0) return parts.join("\n\n===\n\n");
    return GENERAL_CONTEXT;
  }, [isAdmin, activityUsers, campaignsCtx, defaultAccountId, defaultAccountName]);

  // Ensure there is an active conversation, creating one if needed
  const ensureConversation = useCallback(async (firstMessage: string): Promise<number> => {
    if (convId !== null) return convId;
    const title = firstMessage.slice(0, 80) || "محادثة جديدة";
    const resp = await fetch(`${API}/chat/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title }),
    });
    const conv = await resp.json() as ConvSummary;
    setConvId(conv.id);
    setConversations((prev) => [conv, ...prev]);
    return conv.id;
  }, [convId]);

  // Save a pair of messages to DB
  const saveToDB = useCallback(async (cid: number, userContent: string, assistantContent: string, toolCalls?: string[]) => {
    try {
      const assistantMsg: { role: string; content: string; tool_calls?: string[] } = { role: "assistant", content: assistantContent };
      if (toolCalls && toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      await fetch(`${API}/chat/conversations/${cid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: [
            { role: "user", content: userContent },
            assistantMsg,
          ],
        }),
      });
      // Refresh conversation list order
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === cid);
        if (idx < 0) return prev;
        const updated = { ...prev[idx]!, updated_at: new Date().toISOString() };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    } catch {}
  }, []);

  const send = useCallback(async (quickActionText?: string) => {
    const text = (quickActionText !== undefined ? quickActionText : input).trim();
    if ((!text && !attachment) || streaming) return;
    const userText = text || (attachment?.isImage ? "[صورة مرفقة]" : `📎 ${attachment?.name}`);
    setInput("");
    // Reset textarea height immediately after clearing
    if (inputRef.current) { inputRef.current.style.height = "auto"; }
    const att = attachment;
    setAttachment(null);
    const newMsg: ChatMessage = { role: "user", content: userText };
    if (att?.isImage && att.previewUrl) newMsg.imagePreviewUrl = att.previewUrl;
    const newMessages: ChatMessage[] = [...messages, newMsg];
    setMessages(newMessages);
    setStreaming(true);
    setStreamingText("");
    setToolCallLabels([]);
    setPendingAction(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // 180-second hard timeout — write-tool flows + large context models need time
    const timeoutId = setTimeout(() => ctrl.abort(), 180000);
    let accumulated = "";

    try {
      const activeCid = await ensureConversation(userText);

      // Filter out junk assistant messages (empty, "?", error messages) before sending to API
      // so they don't confuse the model
      const JUNK_PATTERNS = /^[?؟!.\s]*$|^❌|^عذراً، لم أتمكن/;
      const cleanMessages = newMessages.filter((m) =>
        m.role !== "assistant" || (m.content.trim().length > 5 && !JUNK_PATTERNS.test(m.content.trim()))
      );
      const body: Record<string, unknown> = { campaignContext: buildContext(), messages: cleanMessages, conversation_id: activeCid };
      if (att?.isImage) { body.imageBase64 = att.base64; body.imageMimeType = att.mimeType; }
      if (att?.text)    { body.fileText = att.text; body.fileName = att.name; }

      const prepResp = await fetch(`${API}/ai/chat-prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        credentials: "include",
      });
      if (prepResp.status === 401) { logout(); return; }
      if (!prepResp.ok) throw new Error(`prepare HTTP ${prepResp.status}`);
      const { sessionId } = await prepResp.json() as { sessionId: string };

      const resp = await fetch(`${API}/ai/chat-stream?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "GET",
        signal: ctrl.signal,
        credentials: "include",
      });

      if (resp.status === 401) { logout(); return; }
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const localLabels: string[] = [];
      let doneReceived = false;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done || doneReceived) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(line.slice(6)) as Record<string, unknown>; } catch { continue; }
          if (data.error) throw new Error(String(data.error));
          if (data.done) { doneReceived = true; break outer; }
          if (data.searching === true) { setSearching(true); }
          if (data.searching === false) { setSearching(false); }
          if (data.tool_call_label) {
            localLabels.push(data.tool_call_label as string);
            setToolCallLabels((prev) => [...prev, data.tool_call_label as string]);
          }
          if (data.pending_action) { setPendingAction(data.pending_action as PendingAction); }
          if (data.pending_action_resolved) {
            setPendingAction((prev) => prev ? { ...prev, ...(data.pending_action_resolved as Partial<PendingAction>), detailsLoading: false } : prev);
          }
          if (data.content) { setToolCallLabels([]); accumulated += String(data.content); setStreamingText(accumulated); }
        }
      }

      const capturedLabels = localLabels.slice();
      // If accumulated is empty or junk (e.g. "?"), show a friendly fallback
      const finalContent = accumulated.trim().length > 3
        ? accumulated
        : "عذراً، لم أتمكن من الإجابة. حاول مرة أخرى.";
      const assistantMsg: ChatMessage = { role: "assistant", content: finalContent };
      if (capturedLabels.length > 0) assistantMsg.tool_calls = capturedLabels;
      setMessages((prev) => [...prev, assistantMsg]);

      // Save to DB in background — only save meaningful responses
      if (accumulated.trim().length > 3) {
        void saveToDB(activeCid, userText, accumulated, capturedLabels.length > 0 ? capturedLabels : undefined);
      }

    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          if (stoppedRef.current) {
            if (accumulated.trim().length > 3) {
              setMessages((prev) => [...prev, { role: "assistant", content: accumulated.trim() }]);
            }
          } else {
            setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ انتهى وقت الانتظار. حاول مرة أخرى." }]);
          }
        } else {
          setMessages((prev) => [...prev, { role: "assistant", content: "❌ حصل خطأ في الاتصال. حاول تاني." }]);
        }
      }
    } finally {
      stoppedRef.current = false;
      clearTimeout(timeoutId);
      setStreaming(false);
      setStreamingText("");
      setSearching(false);
      setToolCallLabels([]);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, messages, streaming, buildContext, ensureConversation, saveToDB, attachment, logout]);

  const executeAction = useCallback(async () => {
    if (!pendingAction || executingAction) return;
    setExecutingAction(true);
    const isNoOp =
      pendingAction.currentValue != null &&
      pendingAction.proposedValue != null &&
      pendingAction.currentValue === pendingAction.proposedValue;
    try {
      const resp = await fetch(`${API}/pipeboard/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tool: pendingAction.tool, args: pendingAction.args, isNoOp }),
      });
      const data = await resp.json() as { success?: boolean; message?: string; error?: string; launchData?: Record<string, unknown> };
      let resultText: string;
      if (resp.ok && data.success && pendingAction.tool === "launch_pipeboard_campaign") {
        const ld = data.launchData ?? {};
        // Extract text/headline from creatives[] (new format) or top-level (legacy)
        const firstCreative = (Array.isArray(pendingAction.args.creatives) && (pendingAction.args.creatives as Array<Record<string,unknown>>).length > 0)
          ? (pendingAction.args.creatives as Array<Record<string,unknown>>)[0]!
          : null;
        const primaryText = String(firstCreative?.primary_text ?? pendingAction.args.primary_text ?? "");
        const headline    = String(firstCreative?.headline    ?? pendingAction.args.headline    ?? "");
        // Budget: sum adsets[].budget or fall back to daily_budget arg
        const adsetArgs = Array.isArray(pendingAction.args.adsets)
          ? (pendingAction.args.adsets as Array<{ budget?: number }>)
          : [];
        const dailyBudget = adsetArgs.length > 0
          ? adsetArgs.reduce((s, a) => s + (Number(a.budget) || 0), 0)
          : Number(pendingAction.args.daily_budget ?? 20);
        const cardData: PipeboardLaunchData = {
          campaign_name: String(pendingAction.args.campaign_name ?? ""),
          daily_budget: dailyBudget,
          primary_text: primaryText || undefined,
          headline: headline || undefined,
          status: "PAUSED",
          landing_page_url: String(pendingAction.args.landing_page_url ?? ""),
          campaign_id: ld.campaign_id ? String(ld.campaign_id) : undefined,
          objective: ld.objective ? String(ld.objective) : undefined,
          has_pixel: Boolean(ld.has_pixel),
          ads_created: ld.ads_created != null ? Number(ld.ads_created) : undefined,
          ads_failed:  ld.ads_failed  != null ? Number(ld.ads_failed)  : undefined,
          adsets_count:    ld.adsets_count    != null ? Number(ld.adsets_count)    : undefined,
          creatives_count: ld.creatives_count != null ? Number(ld.creatives_count) : undefined,
          ad_results: Array.isArray(ld.ad_results) ? (ld.ad_results as import("@/components/PipeboardLaunchCard").AdResult[]) : undefined,
        };
        resultText = `✅ تم إنشاء الحملة بنجاح!\n\`\`\`pipeboard_launch\n${JSON.stringify(cardData)}\n\`\`\``;
      } else {
        // Always prefer pendingAction.summary for the success label (Arabic, human-readable).
        // data.message from Pipeboard may be raw JSON or English text — only append if clean text.
        const extraMsg = data.message && data.message.trim() && !data.message.trimStart().startsWith("{")
          ? ` — ${data.message.trim()}`
          : "";
        resultText = resp.ok && data.success
          ? `✅ تم بنجاح: ${pendingAction.summary}${extraMsg}`
          : `❌ فشل التنفيذ: ${data.error || "خطأ غير معروف"}`;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: resultText }]);
      const cid = convIdRef.current;
      if (cid !== null) {
        void saveToDB(cid, pendingAction.summary, resultText);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "❌ حصل خطأ في الاتصال." }]);
    } finally {
      setExecutingAction(false);
      setPendingAction(null);
    }
  }, [pendingAction, executingAction, saveToDB]);

  const cancelAction = useCallback(() => {
    setPendingAction(null);
    setMessages((prev) => [...prev, { role: "assistant", content: "تم إلغاء الإجراء." }]);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setAttachment(await readFileAsAttachment(file)); } catch (err) { alert(err instanceof Error ? err.message : "خطأ"); }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    try { setAttachment(await readFileAsAttachment(file)); } catch {}
  }, []);

  // ── LTM callbacks ─────────────────────────────────────────────────────────
  const loadLtm = useCallback(async () => {
    setLtmLoading(true);
    try {
      const r = await fetch(`${API}/ai/memory`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json() as UserLtmData;
      setLtmData(data);
      setLtmEditKpis(Object.fromEntries(
        Object.entries(data.target_kpis ?? {}).map(([k, v]) => [k, v != null ? String(v) : ""])
      ));
      setLtmEditRules([...(data.strategic_rules ?? [])]);
      setLtmEditInsights(data.historical_insights ?? "");
      setLtmDirty(false);
    } catch { /* silent */ }
    finally { setLtmLoading(false); }
  }, []);

  useEffect(() => {
    if (view === "memory" && open && ltmData === null && !ltmLoading) void loadLtm();
  }, [view, open, ltmData, ltmLoading, loadLtm]);

  const saveLtm = useCallback(async () => {
    setLtmSaving(true);
    try {
      const target_kpis: Record<string, number> = {};
      for (const [k, v] of Object.entries(ltmEditKpis)) {
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0) target_kpis[k] = n;
      }
      const body = { target_kpis, strategic_rules: ltmEditRules.filter(Boolean), historical_insights: ltmEditInsights };
      const r = await fetch(`${API}/ai/memory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setLtmData({ ...body, updated_at: new Date().toISOString() });
        setLtmDirty(false);
      }
    } finally { setLtmSaving(false); }
  }, [ltmEditKpis, ltmEditRules, ltmEditInsights]);

  const resetLtm = useCallback(async () => {
    if (!confirm("مسح كل الذاكرة المحفوظة؟")) return;
    setLtmSaving(true);
    try {
      await fetch(`${API}/ai/memory`, { method: "DELETE", credentials: "include" });
      const empty: UserLtmData = { target_kpis: {}, strategic_rules: [], historical_insights: "", updated_at: new Date().toISOString() };
      setLtmData(empty);
      setLtmEditKpis({});
      setLtmEditRules([]);
      setLtmEditInsights("");
      setLtmDirty(false);
    } finally { setLtmSaving(false); }
  }, []);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setStreaming(false);
    setAttachment(null);
    setConvId(null);
    setExpandedSources({});
    setView("chat");
  }, []);

  const clearCurrentChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setStreaming(false);
    setAttachment(null);
    setConvId(null);
    setExpandedSources({});
  }, []);

  const loadConversation = useCallback(async (conv: ConvSummary) => {
    setConvLoading(true);
    try {
      const resp = await fetch(`${API}/chat/conversations/${conv.id}/messages`, { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json() as { messages: { role: string; content: string; tool_calls?: string[] | null }[] };
      const loaded: ChatMessage[] = (data.messages ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        ...(m.tool_calls && m.tool_calls.length > 0 ? { tool_calls: m.tool_calls } : {}),
      }));
      setMessages(loaded);
      setConvId(conv.id);
      setExpandedSources({});
      setView("chat");
    } catch {}
    finally { setConvLoading(false); }
  }, []);

  // Navigate to a campaign conversation from the history panel: load inline and optionally select campaign on dashboard
  const openCampaignConversation = useCallback(async (conv: ConvSummary) => {
    await loadConversation(conv);
    if (conv.campaign_id) {
      try {
        sessionStorage.setItem("global_selected_campaign", JSON.stringify({ campaignId: conv.campaign_id }));
      } catch {}
      navigate("/");
    }
  }, [loadConversation, navigate]);

  const deleteConversation = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await fetch(`${API}/chat/conversations/${id}`, { method: "DELETE", credentials: "include" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (convId === id) { setMessages([]); setConvId(null); }
    } catch {}
    finally { setDeletingId(null); }
  }, [convId]);

  const startRename = useCallback((conv: ConvSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  }, []);

  const commitRename = useCallback(async (id: number) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    try {
      const r = await fetch(`${API}/chat/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: trimmed }),
      });
      if (r.ok) {
        setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title: trimmed } : c));
      }
    } catch {}
    setRenamingId(null);
  }, [renameValue]);

  const selectDefaultAccount = useCallback((acc: { id: string; name?: string } | null) => {
    if (acc) {
      setDefaultAccountId(acc.id);
      setDefaultAccountName(acc.name ?? acc.id);
      localStorage.setItem("ai_default_account_id", acc.id);
      localStorage.setItem("ai_default_account_name", acc.name ?? acc.id);
    } else {
      setDefaultAccountId("");
      setDefaultAccountName("");
      localStorage.removeItem("ai_default_account_id");
      localStorage.removeItem("ai_default_account_name");
    }
    setShowAccountPicker(false);
  }, []);

  // Register openToConversation with the parent (FullRouter) so siblings can call it via context
  useEffect(() => {
    onRegisterOpenFn?.(openToConversation);
  }, [onRegisterOpenFn, openToConversation]);

  const hasUnread = messages.length > 0;
  const grouped = groupConversations(conversations);

  return (
    <>
      {/* Floating button — hidden when panel is open OR when on /chat page */}
      {!open && !isOnChatPage && (
        <button
          onClick={() => { setOpen(true); setCollapsed(false); }}
          className="fixed bottom-20 sm:bottom-6 left-6 z-[60] rounded-2xl bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 hover:scale-105 transition-all flex items-center justify-center"
          title="مساعد الإعلانات"
          style={{ height: 52, width: 52 }}
        >
          <MessageSquare className="h-5 w-5" />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background" />
          )}
        </button>
      )}

      {/* Chat Panel — fixed bottom, full width, collapsible — hidden on /chat page */}
      {open && !isOnChatPage && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[60] bg-background border-t border-border/60 shadow-2xl flex flex-col overflow-hidden"
          style={{
            height: collapsed ? "56px" : "min(90vh, calc(100dvh - 120px))",
            transition: "height 0.3s cubic-bezier(0.4,0,0.2,1)",
          }}
          dir="rtl"
        >

          {/* ── Header ── */}
          <div className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-border/60 bg-background">
            <div className="flex items-center gap-2.5">
              {view === "history" ? (
                <button
                  onClick={() => setView("chat")}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  title="رجوع للمحادثة"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
              )}
              <div>
                <p className="text-sm font-semibold leading-tight text-foreground">
                  {view === "history" ? "المحادثات السابقة" : view === "memory" ? "ذاكرة المساعد" : "مساعد الإعلانات"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {view === "history"
                    ? `${conversations.length} محادثة محفوظة`
                    : view === "memory"
                    ? "تفضيلاتك وقواعدك المحفوظة"
                    : "أسئلة عامة عن Meta Ads"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* New chat */}
              {view === "chat" && !collapsed && (
                <button
                  onClick={startNewChat}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                  title="محادثة جديدة"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
              {/* History toggle */}
              {!collapsed && (
                <button
                  onClick={() => setView((v) => v === "history" ? "chat" : "history")}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all ${
                    view === "history"
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                  }`}
                  title="المحادثات السابقة"
                >
                  <History className="h-4 w-4" />
                </button>
              )}
              {/* Memory Manager */}
              {!collapsed && (
                <button
                  onClick={() => { setView((v) => v === "memory" ? "chat" : "memory"); }}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all ${
                    view === "memory"
                      ? "text-purple-600 bg-purple-500/10"
                      : "text-muted-foreground hover:text-purple-600 hover:bg-purple-500/10"
                  }`}
                  title="ذاكرة المساعد"
                >
                  <Brain className="h-4 w-4" />
                </button>
              )}
              {/* Clear current chat */}
              {view === "chat" && messages.length > 0 && !collapsed && (
                <button
                  onClick={clearCurrentChat}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                  title="مسح المحادثة"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {/* Collapse / Expand */}
              <button
                onClick={() => setCollapsed(c => !c)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                title={collapsed ? "توسيع" : "طي"}
              >
                {collapsed ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </button>
              {/* Close */}
              <button
                onClick={() => setOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                title="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Memory Manager View ── */}
          {view === "memory" ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {ltmLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 min-h-0" dir="rtl">

                  {/* KPI Targets */}
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">📊 أهداف KPI المستهدفة</p>
                    <div className="grid grid-cols-2 gap-2">
                      {LTM_KPI_DEFS.map(({ key, label, unit, placeholder }) => (
                        <div key={key} className="bg-muted/40 rounded-xl p-2.5 border border-border">
                          <p className="text-[10px] text-muted-foreground mb-1 leading-tight">{label}</p>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={ltmEditKpis[key] ?? ""}
                              onChange={(e) => { setLtmEditKpis(p => ({ ...p, [key]: e.target.value })); setLtmDirty(true); }}
                              placeholder={placeholder}
                              dir="ltr"
                              className="w-full bg-transparent text-[13px] font-semibold focus:outline-none placeholder:text-muted-foreground/40 text-right"
                            />
                            <span className="text-[11px] text-muted-foreground shrink-0">{unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Strategic Rules */}
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">📋 القواعد الاستراتيجية</p>
                    <div className="space-y-1.5">
                      {ltmEditRules.map((rule, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 bg-muted/40 rounded-xl px-3 py-2 border border-border group">
                          <span className="text-[12.5px] flex-1 leading-snug">{rule}</span>
                          <button
                            onClick={() => { setLtmEditRules(r => r.filter((_, i) => i !== idx)); setLtmDirty(true); }}
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all mt-0.5"
                            title="حذف القاعدة"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {ltmEditRules.length === 0 && (
                        <p className="text-[12px] text-muted-foreground/60 text-center py-2">لا توجد قواعد محفوظة بعد</p>
                      )}
                      {/* Add new rule */}
                      <div className="flex items-center gap-1.5 border border-dashed border-border rounded-xl px-3 py-2 focus-within:border-primary/50 transition-colors">
                        <input
                          type="text"
                          value={ltmNewRule}
                          onChange={(e) => setLtmNewRule(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && ltmNewRule.trim()) {
                              setLtmEditRules(r => [...r, ltmNewRule.trim()]);
                              setLtmNewRule("");
                              setLtmDirty(true);
                            }
                          }}
                          placeholder="أضف قاعدة… (Enter للإضافة)"
                          dir="rtl"
                          className="flex-1 bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground/40"
                        />
                        <button
                          onClick={() => { if (ltmNewRule.trim()) { setLtmEditRules(r => [...r, ltmNewRule.trim()]); setLtmNewRule(""); setLtmDirty(true); } }}
                          className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Historical Insights */}
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">💡 رؤى تاريخية</p>
                    <textarea
                      value={ltmEditInsights}
                      onChange={(e) => { setLtmEditInsights(e.target.value); setLtmDirty(true); }}
                      placeholder="ملاحظات وأنماط مستخلصة من المحادثات…"
                      dir="rtl"
                      rows={3}
                      className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40 resize-none"
                    />
                  </div>

                  <p className="text-[10px] text-muted-foreground/50 text-center pb-1">
                    يتم تحديث الذاكرة تلقائياً كل 8 رسائل من محادثاتك
                  </p>
                </div>
              )}
              {!ltmLoading && (
                <div className="shrink-0 px-3 py-2.5 border-t border-border flex items-center gap-2">
                  <button
                    onClick={() => void saveLtm()}
                    disabled={!ltmDirty || ltmSaving}
                    className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {ltmSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    حفظ التغييرات
                  </button>
                  <button
                    onClick={() => void resetLtm()}
                    disabled={ltmSaving}
                    className="px-3 py-2 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors disabled:opacity-40"
                    title="مسح كل الذاكرة"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ) : view === "history" ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Search bar */}
              <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-muted/40 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="بحث في كل المحادثات…"
                    dir="rtl"
                    className="flex-1 bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground/60"
                  />
                  {historySearch && (
                    <button onClick={() => setHistorySearch("")} className="text-muted-foreground hover:text-foreground transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                {/* Search results */}
                {historySearch.trim() ? (
                  <div className="px-3 pb-4">
                    {historySearchLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="flex gap-1.5">
                          {[0, 1, 2].map((k) => (
                            <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k * 140}ms` }} />
                          ))}
                        </div>
                      </div>
                    ) : historySearchResults === null ? null : historySearchResults.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <Search className="h-8 w-8 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">لا توجد نتائج</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-2 pb-1.5">
                          {historySearchResults.length} نتيجة
                        </p>
                        <div className="space-y-0.5">
                          {historySearchResults.map((conv) => {
                            const isCampaign = !!conv.campaign_id;
                            return (
                              <div
                                key={conv.id}
                                onClick={() => isCampaign ? openCampaignConversation(conv) : loadConversation(conv)}
                                className="group flex items-start gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-muted/60"
                              >
                                {isCampaign
                                  ? <Globe className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                                  : <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                                }
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] truncate leading-tight font-medium">
                                    {highlightText(conv.title, historySearch)}
                                  </p>
                                  {isCampaign && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-full px-1.5 py-0.5 mt-0.5 max-w-[180px]">
                                      <Globe className="h-2.5 w-2.5 shrink-0" />
                                      <span className="truncate">{conv.campaign_name ? `حملة: ${conv.campaign_name}` : "حملة"}</span>
                                    </span>
                                  )}
                                  {conv.snippet && (
                                    <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-2 leading-snug">
                                      {highlightText(conv.snippet.slice(0, 120), historySearch)}
                                    </p>
                                  )}
                                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                                    {formatRelative(conv.updated_at)}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* New conversation shortcut */}
                    <div className="px-3 pt-1 pb-1">
                      <button
                        onClick={startNewChat}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 transition-colors text-sm font-medium"
                      >
                        <Plus className="h-4 w-4 shrink-0" />
                        <span>محادثة جديدة</span>
                      </button>
                    </div>

                    {convLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="flex gap-1.5">
                          {[0, 1, 2].map((k) => (
                            <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k * 140}ms` }} />
                          ))}
                        </div>
                      </div>
                    ) : conversations.length === 0 ? (
                      <div className="flex flex-col items-center gap-3 py-16 px-6 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                          <Clock className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">لا توجد محادثات محفوظة بعد</p>
                        <p className="text-xs text-muted-foreground/60">ابدأ محادثة جديدة وسيتم حفظها تلقائياً</p>
                      </div>
                    ) : (
                      <div className="px-3 pb-4">
                        {grouped.map(({ label, items }) => (
                          <div key={label}>
                            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-4 pb-1.5">
                              {label}
                            </p>
                            <div className="space-y-0.5">
                              {items.map((conv) => (
                                <div
                                  key={conv.id}
                                  onClick={() => renamingId !== conv.id && loadConversation(conv)}
                                  className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                                    convId === conv.id
                                      ? "bg-primary/10 text-primary"
                                      : "hover:bg-muted/60"
                                  }`}
                                >
                                  <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${convId === conv.id ? "text-primary" : "text-muted-foreground"}`} />
                                  <div className="flex-1 min-w-0">
                                    {renamingId === conv.id ? (
                                      <input
                                        autoFocus
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onBlur={() => void commitRename(conv.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") { e.preventDefault(); void commitRename(conv.id); }
                                          if (e.key === "Escape") { setRenamingId(null); }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full text-[13px] bg-background border border-primary/50 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                        dir="rtl"
                                      />
                                    ) : (
                                      <>
                                        <p className="text-[13px] truncate leading-tight">
                                          {conv.title}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                          {formatRelative(conv.updated_at)}
                                        </p>
                                      </>
                                    )}
                                  </div>
                                  {renamingId === conv.id ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); void commitRename(conv.id); }}
                                      className="shrink-0 h-6 w-6 flex items-center justify-center rounded-lg text-primary hover:bg-primary/10 transition-all"
                                      title="حفظ"
                                    >
                                      <Check className="h-3 w-3" />
                                    </button>
                                  ) : (
                                    <div className="shrink-0 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all">
                                      <button
                                        onClick={(e) => startRename(conv, e)}
                                        className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                                        title="تعديل الاسم"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={(e) => deleteConversation(conv.id, e)}
                                        disabled={deletingId === conv.id}
                                        className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-30"
                                        title="حذف المحادثة"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* ── Chat View ── */}
              <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                <div className="flex flex-col gap-3 py-4 px-4">

                  {/* Empty state */}
                  {messages.length === 0 && !streaming && (
                    <div className="flex flex-col items-center gap-4 py-6">
                      {campaignsLoading ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1.5">
                            {[0, 1, 2].map((k) => (
                              <span key={k} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k * 140}ms` }} />
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">🔍 جاري سحب وتحليل كافة الحملات (النشطة والمتوقفة مؤخراً)…</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[260px]">
                          {campaignsCtx && campaignsCtx !== GENERAL_CONTEXT
                            ? "عندي بيانات حملاتك — اسألني أي سؤال عنها"
                            : "اسألني أي سؤال عن Meta Ads وهجاوبك"}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2 w-full">
                        {(campaignsCtx && campaignsCtx !== GENERAL_CONTEXT
                          ? SUGGESTED_WITH_DATA
                          : SUGGESTED_GENERAL
                        ).map((q) => (
                          <button
                            key={q}
                            onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                            className="text-xs text-end px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-muted/60 hover:border-primary/30 transition-all leading-snug text-foreground/80"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Message bubbles */}
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"} items-start`}
                    >
                      {/* Avatar */}
                      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
                        msg.role === "user"
                          ? "bg-primary/90 text-primary-foreground ring-2 ring-primary/20"
                          : "bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20"
                      }`}>
                        {msg.role === "user"
                          ? <User className="h-3.5 w-3.5" />
                          : <Bot className="h-3.5 w-3.5 text-primary" />}
                      </div>

                      <div className="min-w-0 flex flex-col gap-1.5" style={{ maxWidth: "84%" }}>
                        {/* Bubble */}
                        <div
                          className={`min-w-0 rounded-2xl break-words overflow-hidden ${
                            msg.role === "user"
                              ? "bg-primary/90 text-primary-foreground rounded-tr-sm px-4 py-2.5 text-[13.5px] leading-relaxed shadow-sm"
                              : "bg-background border border-border/70 rounded-tl-sm px-4 py-3 shadow-sm"
                          }`}
                          style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                          dir="rtl"
                        >
                          {msg.imagePreviewUrl && (
                            <img
                              src={msg.imagePreviewUrl}
                              alt="مرفق"
                              className="max-w-full rounded-xl mb-2 cursor-zoom-in border border-white/20"
                              style={{ maxHeight: 220 }}
                              onClick={() => window.open(msg.imagePreviewUrl, "_blank")}
                            />
                          )}
                          {msg.role === "user"
                            ? msg.content && <span className="whitespace-pre-wrap">{msg.content}</span>
                            : <RenderMarkdown text={msg.content} />}
                        </div>

                        {/* Sources toggle */}
                        {msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0 && (
                          <div dir="rtl">
                            <button
                              onClick={() => setExpandedSources((prev) => ({ ...prev, [i]: !prev[i] }))}
                              className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                            >
                              <Search className="h-2.5 w-2.5 shrink-0" />
                              <span>مصادر البيانات ({msg.tool_calls.length})</span>
                              <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform ${expandedSources[i] ? "rotate-180" : ""}`} />
                            </button>
                            {expandedSources[i] && (
                              <div className="mt-1 flex flex-col gap-0.5 ps-1">
                                {msg.tool_calls.map((label, j) => (
                                  <span key={j} className="flex items-center gap-1.5 text-[11px] text-muted-foreground/45">
                                    <span className="w-1 h-1 rounded-full bg-primary/30 shrink-0" />
                                    {label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Pending action confirmation card — shown immediately (optimistic) */}
                  {pendingAction && (user?.role === "admin" || user?.role === "media_buyer") && (() => {
                    const isSameState = !!(pendingAction.currentValue && pendingAction.proposedValue && pendingAction.currentValue === pendingAction.proposedValue);
                    return (
                      <div className="flex gap-2.5 flex-row items-start" dir="rtl">
                        <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mb-0.5 ${isSameState ? "bg-slate-100 border border-slate-300" : "bg-amber-100 border border-amber-300"}`}>
                          <AlertTriangle className={`h-3.5 w-3.5 ${isSameState ? "text-slate-500" : "text-amber-600"}`} />
                        </div>
                        <div
                          className={`min-w-0 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3 ${isSameState ? "bg-slate-50 border border-slate-200" : "bg-amber-50 border border-amber-200"}`}
                          style={{ maxWidth: "85%" }}
                        >
                          <p className={`text-[12px] font-semibold mb-1 ${isSameState ? "text-slate-600" : "text-amber-700"}`}>⚡ تأكيد الإجراء</p>
                          {/* Previous intervention warning */}
                          {pendingAction.lastIntervention && (
                            <div className="mb-2 flex items-start gap-1.5 text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5" dir="rtl">
                              <Clock className="h-3 w-3 shrink-0 mt-px text-orange-500" />
                              <span>
                                آخر تدخل:{" "}
                                <span className="font-semibold">
                                  {INTERVENTION_TOOL_LABELS[pendingAction.lastIntervention.toolName] ?? pendingAction.lastIntervention.toolName}
                                </span>
                                {" — "}
                                {formatInterventionAge(pendingAction.lastIntervention.hoursAgo)}
                                {" (بواسطة "}
                                {pendingAction.lastIntervention.executedBy}
                                {")"}
                              </span>
                            </div>
                          )}
                          <p className={`text-[13px] leading-relaxed ${isSameState ? "text-slate-700" : "text-amber-900"}`}>{pendingAction.summary}</p>
                          {/* Current → Proposed value row — shows skeleton while details load */}
                          {pendingAction.proposedValue && (
                            <div className="mt-2 mb-1 flex items-center gap-2 text-[12px]" dir="ltr">
                              {pendingAction.detailsLoading ? (
                                <span className="h-5 w-20 rounded-md bg-amber-200/60 animate-pulse inline-block" />
                              ) : pendingAction.currentValue ? (
                                <span className={`px-2 py-0.5 rounded-md font-medium ${isSameState ? "bg-slate-100 text-slate-600" : "bg-red-100 text-red-700"}`}>{pendingAction.currentValue}</span>
                              ) : null}
                              {(pendingAction.detailsLoading || pendingAction.currentValue) && (
                                <span className={`font-bold ${isSameState ? "text-slate-400" : "text-amber-600"}`}>→</span>
                              )}
                              <span className={`px-2 py-0.5 rounded-md font-medium ${isSameState ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>{pendingAction.proposedValue}</span>
                            </div>
                          )}
                          {isSameState && (
                            <p className="text-[12px] text-slate-500 mt-1.5 mb-0.5 font-medium">⚠ هذه الحملة بالفعل في هذه الحالة</p>
                          )}
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={executeAction}
                              disabled={executingAction || !!pendingAction.detailsLoading}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isSameState ? "bg-slate-500 hover:bg-slate-600" : "bg-emerald-600 hover:bg-emerald-700"}`}
                            >
                              <Zap className="h-3 w-3" />
                              {executingAction ? "جاري التنفيذ…" : "نفّذ"}
                            </button>
                            <button
                              onClick={cancelAction}
                              disabled={executingAction}
                              className="px-3 py-1.5 rounded-lg border border-border text-[12px] text-muted-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Streaming text bubble */}
                  {streaming && streamingText && (
                    <div className="flex gap-2.5 flex-row items-start">
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div
                        className="min-w-0 rounded-2xl rounded-tl-sm bg-background border border-border/70 shadow-sm px-4 py-3 break-words overflow-hidden"
                        style={{ maxWidth: "84%", wordBreak: "break-word", overflowWrap: "anywhere" }}
                        dir="rtl"
                      >
                        <RenderMarkdown text={streamingText} />
                        <span className="inline-block w-[2px] h-[14px] bg-primary/60 animate-pulse rounded-full align-middle ms-0.5 mb-0.5" />
                      </div>
                    </div>
                  )}

                  {/* Thinking / searching indicator */}
                  {streaming && !streamingText && (
                    <div className="flex gap-2.5 flex-row items-start">
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      {searching ? (
                        <div className="flex flex-col gap-1.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-primary/5 border border-primary/15 shadow-sm min-w-[220px]" dir="rtl">
                          {toolCallLabels.slice(0, -1).map((label, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-[11px] text-emerald-700/80">
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                              <span className="line-through decoration-emerald-400/50">{label}</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-2 text-[12px] text-primary/90 font-medium">
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                            <span>
                              {toolCallLabels.length > 0
                                ? toolCallLabels[toolCallLabels.length - 1]
                                : "جاري البحث في البيانات…"}
                            </span>
                          </div>
                        </div>
                      ) : toolCallLabels.length > 0 ? (
                        <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl rounded-tl-sm bg-background border border-border/70 shadow-sm" dir="rtl">
                          {toolCallLabels.map((label, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-[11px] text-emerald-700/70">
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                              <span>{label}</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40 mt-0.5">
                            {[0, 1, 2].map((k) => (
                              <span key={k} className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${k * 150}ms` }} />
                            ))}
                            <span className="text-[11px] text-muted-foreground/60 mr-1">جاري التحليل…</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-4 py-3.5 rounded-2xl rounded-tl-sm bg-background border border-border/70 shadow-sm">
                          <span className="text-[12px] text-muted-foreground/60">يفكر</span>
                          {[0, 1, 2].map((k) => (
                            <span key={k} className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${k * 150}ms` }} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>
              </div>

              {/* ── Input ── */}
              <div className="shrink-0 border-t border-border/60 px-4 pt-3 pb-4">

                {/* Account Picker Strip */}
                {availableAccounts.length > 0 && (
                  <div ref={accountPickerRef} className="relative mb-2.5" dir="rtl">
                    <button
                      onClick={() => setShowAccountPicker((v) => !v)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${
                        defaultAccountId
                          ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                          : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      }`}
                    >
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="max-w-[180px] truncate">
                        {defaultAccountId ? (defaultAccountName || defaultAccountId) : "اختر الحساب الافتراضي"}
                      </span>
                      <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                    </button>
                    {showAccountPicker && (
                      <div className="absolute bottom-full mb-1 right-0 z-50 min-w-[220px] rounded-xl border border-border bg-background shadow-lg py-1">
                        {defaultAccountId && (
                          <button
                            onClick={() => selectDefaultAccount(null)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-destructive hover:bg-destructive/5 transition-colors"
                          >
                            <X className="h-3 w-3 shrink-0" />
                            إلغاء الحساب الافتراضي
                          </button>
                        )}
                        {availableAccounts.map((acc) => (
                          <button
                            key={acc.id}
                            onClick={() => selectDefaultAccount(acc)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-muted/60 ${
                              defaultAccountId === acc.id ? "text-primary font-medium" : "text-foreground"
                            }`}
                          >
                            {defaultAccountId === acc.id && <Check className="h-3 w-3 shrink-0 text-primary" />}
                            {defaultAccountId !== acc.id && <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />}
                            <span className="flex-1 text-right truncate">{acc.name ?? acc.id}</span>
                            <span className="text-[10px] text-muted-foreground/60 shrink-0 font-mono">{acc.id.replace("act_", "")}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Quick Action Chips */}
                <div
                  dir="rtl"
                  className="flex gap-2 overflow-x-auto pb-2.5 mb-2.5"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      disabled={streaming}
                      onClick={() => send(action.prompt)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap border border-border/70 bg-muted/40 text-foreground/75 hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                {attachment && (
                  <div className="mb-2 flex items-center gap-2">
                    {attachment.isImage && attachment.previewUrl ? (
                      <div className="relative inline-flex">
                        <img src={attachment.previewUrl} alt={attachment.name} className="h-16 w-auto max-w-[120px] rounded-lg border border-border object-cover" />
                        <button onClick={() => setAttachment(null)} className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="max-w-[200px] truncate">{attachment.name}</span>
                        <button onClick={() => setAttachment(null)} className="text-muted-foreground hover:text-destructive mr-1">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 items-end">
                  <div className="flex-1 flex items-end gap-2 rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all px-3 py-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,text/plain,text/csv,application/json,.txt,.csv,.json"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={streaming}
                      className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 mb-0.5"
                      title="إرفاق صورة أو ملف"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </button>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      dir="rtl"
                      rows={1}
                      placeholder="اسأل عن Meta Ads… (Enter للإرسال)"
                      disabled={streaming}
                      className="flex-1 resize-none bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 leading-relaxed"
                      style={{ maxHeight: "100px", overflowY: "auto" }}
                      onInput={(e) => {
                        const t = e.currentTarget;
                        t.style.height = "auto";
                        t.style.height = Math.min(t.scrollHeight, 100) + "px";
                      }}
                    />
                    {streaming ? (
                      <button
                        onClick={() => { stoppedRef.current = true; abortRef.current?.abort(); }}
                        className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg border border-foreground/30 bg-card text-foreground hover:border-foreground/60 hover:bg-muted transition-colors mb-0.5"
                        title="إيقاف الرد"
                      >
                        <Square className="h-3 w-3 fill-current" />
                      </button>
                    ) : (
                      <button
                        onClick={() => void send()}
                        disabled={!input.trim() && !attachment}
                        className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed mb-0.5"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">Shift+Enter لسطر جديد</p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
