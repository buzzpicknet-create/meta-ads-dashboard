import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, Trash2, User, Plus, Loader2, CheckCircle2,
  Brain, Paperclip, X, SquarePen, MessageSquare, Clock,
  BarChart2, Zap, AlertTriangle, Square, CheckSquare, Menu,
  Pencil, Check,
} from "lucide-react";
import BulkActionPanel, { type BulkActionPayload } from "@/components/BulkActionPanel";
import PipeboardLaunchCard, { type PipeboardLaunchData } from "@/components/PipeboardLaunchCard";
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
const QUICK_ACTIONS_META = [
  {
    label: "📊 افتتاحية اليوم",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

خطوات التنفيذ الإلزامية (بدون سؤال):
١. get_campaign_daily(days=2) → أخد أرقام أمس (آخر يوم كامل متاح) لكل حملة
٢. get_campaigns(days=7) → أخد CPA وPurchases متوسط آخر 7 أيام للمقارنة
٣. get_campaign_budget(campaign_id) للحملات اللي قرارها Scale أو Kill

أعرض جدول المقارنة:
| الحملة | الإنفاق أمس | CPA أمس | CPA 7 أيام | Purchases أمس | النوع | الميزانية الحالية | القرار |

القرارات:
✅ Scale — CPA أمس < 40 EGP + purchases > 3
⚠️ Monitor — CPA بين 40-50 EGP
❌ Kill — CPA > 80 EGP أو 0 purchases بعد 200 EGP إنفاق

للحملات اللي قرارها Scale — نفّذ تلقائياً بدون سؤال:
- لو CBO: ولّد update_campaign_budget بزيادة 20%
- لو ABO: استخدم get_adsets وولّد update_adset_budget لكل AdSet نشط على حدة بزيادة 20%
- لا تستخدم update_campaign_budget للـ ABO أبداً

للحملات اللي قرارها Kill:
- ولّد pause_campaign مباشرة

bulk_action واحد بكل الإجراءات دفعة واحدة بدون ما تسأل عن أي قيمة.
تنبيه: بيانات اليوم غير مكتملة — استخدم دايماً أرقام اليوم الأمس الكامل.`,
  },
  {
    label: "⚡ قرار التيست",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

خطوات التنفيذ الإلزامية (بدون سؤال):
١. search_campaigns(account_id, query="test") → جيب كل حملات test بدون فلتر إنفاق (حتى الجديدة)
   ثم فلتر النشطة منها (ACTIVE) فقط
٢. get_adsets(campaign_id) لكل حملة تيست → احصل على adset_ids
٣. get_ads_in_adset(adset_id) للمجموعة الأعلى إنفاقاً من كل حملة → CTR + Purchases + CPA على مستوى الإعلان
   — لو رجّعت [META_RATE_LIMIT] انتقل للتالية وأعد المحاولة في النهاية

بعد الجلب — اعرض جدول واحد:
| الحملة | الإنفاق | Purchases | CPA | CTR% أفضل إعلان | القرار |

الحكم بعد 24-36 ساعة:
✅ Scale — CPA < 50 EGP + purchases ≥ 2 + إنفاق > 150 EGP
⚠️ انتظر — إنفاق < 100 EGP (بيانات ناقصة)
❌ أوقف — CPA > 100 EGP + purchases = 0 بعد 200 EGP إنفاق
🔄 Refresh Creative — Hook Rate < 25% بعد 150 EGP إنفاق (video_view÷impressions ✅ متوفر — استخدم pause_ad للإعلانات الضعيفة)

للـ Scale — نفّذ تلقائياً:
- استخدم get_campaign_budget لتحديد النوع (CBO/ABO) والميزانية الحالية
- لو CBO: ولّد update_campaign_budget بـ +20%
- لو ABO: ولّد update_adset_budget لكل AdSet نشط بـ +20%

bulk_action واحد بكل الإجراءات دفعة واحدة بدون سؤال.

استخدم Opus format في الرد:
**1) TL;DR** — القرارات النهائية
**2) الجدول** — | الحملة | الإنفاق | Purchases | CPA | CTR% أفضل إعلان | Flags | القرار |
**3) Do this now** — الإجراءات مرتبة بأولوية
**4) bulk_action`,
  },
  {
    label: "🎯 قرارات الآن",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

جيب كل الحملات والمجموعات النشطة. رتبهم من الأسوأ للأفضل CPA.
أعرض جدولين:

جدول 1 — محتاجين إجراء فوري:
| الكيان | النوع | الإنفاق | CPA | المشكلة | الإجراء |

جدول 2 — الرابحين:
| الحملة | CPA | Purchases | النوع | الميزانية الحالية | الميزانية الجديدة |

الإجراءات:
🔴 أوقف AdSet — CPA > 100 EGP + إنفاق > 2× Target → pause_adset
🟡 قلل ميزانية 30% — CPA بين 60-100 EGP
🟢 زود ميزانية 20% — CPA < 40 EGP + مستقر 3 أيام

للإجراءات على الميزانية — نفّذ تلقائياً بدون سؤال:
- استخدم get_campaign_budget لتحديد النوع (CBO/ABO) والميزانية الحالية
- لو CBO: ولّد update_campaign_budget
- لو ABO: استخدم get_adsets وولّد update_adset_budget لكل AdSet نشط على حدة
- لا تستخدم update_campaign_budget للـ ABO أبداً
- للإيقاف: ولّد pause_adset أو pause_campaign مباشرة

bulk_action واحد بكل الإجراءات دفعة واحدة بدون ما تسأل عن أي قيمة.`,
  },
  {
    label: "🔬 فين المشكلة؟",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

خطوات التنفيذ الإلزامية (بدون سؤال):
١. get_campaigns(days=7) → احصل على campaign_ids النشطة (أكبر 5 حملات إنفاقاً)
٢. get_adsets(campaign_id) لكل حملة → احصل على adset_ids مرتّبة حسب الإنفاق
٣. get_ads_in_adset(adset_id) للمجموعات الـ 3 الأعلى إنفاقاً فقط من كل حملة (مش كل المجموعات)
   — لو رجّعت [META_RATE_LIMIT] انتقل للتالية وأعد المحاولة في النهاية

بعد جلب البيانات — صنّف كل إعلان:
🎬 Media Problem: Hook Rate < 25% → الفيديو مش بيوقف الناس (Hook Rate = video_p25 ÷ impressions ✅ متوفر)
📝 Funnel Leak: Hook جيد + CTR < 2% → النص أو CTA ضعيف
🌐 Landing Page: CTR > 2% + LPR < 70% → الصفحة بطيئة
💸 Conversion: CTR + LPR كويسين + CVR < 1.5% → السعر مش مقنع
💀 Dead: 0 Purchases بعد 3 أيام + 200 EGP إنفاق → أوقف فوراً

أعرض جدول واحد موحّد لكل الإعلانات:
| الإعلان | الحملة | Hook% | CTR% | LPR% | CVR% | Purchases | CPA | التشخيص | الإجراء |`,
  },
  {
    label: "📺 Saturation Check",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

خطوات التنفيذ:
١. get_campaigns(days=14) → احصل على الحملات النشطة
٢. get_adsets(campaign_id) لكل حملة → يُعيد Frequency + CPM لكل مجموعة

أعرض جدول المجموعات الإعلانية:
| المجموعة | الحملة | Frequency | CPM (EGP) | الإنفاق | الحالة |

تشخيص إشباع الجمهور (معايير مصر):
🔴 إشباع واضح — Frequency > 2.8
🟡 بدأ الإشباع — Frequency بين 2-2.8
🟢 لسه بخير — Frequency < 2

الحل:
- إشباع واضح → أوقف المجموعة وغيّر الكريتف فوراً (pause_adset)
- بدأ الإشباع → جهّز Creative جديد خلال 48 ساعة`,
  },
  {
    label: "🕵️ صياد الكريتف",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

خطوات التنفيذ الإلزامية (بدون سؤال):
١. get_campaigns(days=7) → احصل على campaign_ids النشطة (أكبر 5 حملات إنفاقاً)
٢. get_adsets(campaign_id) لكل حملة → احصل على adset_ids مرتّبة حسب الإنفاق
٣. get_ads_in_adset(adset_id) للمجموعات الـ 3 الأعلى إنفاقاً فقط من كل حملة
   — لو رجّعت [META_RATE_LIMIT] انتقل للتالية وأعد المحاولة في النهاية

بعد الجلب — فلتر الرابحين فقط:
- Hook Rate > 25% (video_p25 ÷ impressions ✅ متوفر)
- CTR > 2%
- CPA أقل من متوسط الحساب (أو < 50 EGP لو مفيش متوسط)
- Purchases ≥ 2
- إنفاق > 100 EGP

أعرض جدول الرابحين مرتب من أعلى Hook Rate:
| اسم الإعلان | الحملة | المجموعة | Hook% | CTR% | LPR% | CVR% | CPA (EGP) | Purchases | الإنفاق (EGP) |

هؤلاء مرشحون للـ Flex Scale — قولي لو تريد نقلهم.`,
  },
  {
    label: "💀 قبر الكريتف",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

خطوات التنفيذ الإلزامية (بدون سؤال):
١. get_campaigns(days=7) → احصل على campaign_ids النشطة (أكبر 5 حملات إنفاقاً)
٢. get_adsets(campaign_id) لكل حملة → احصل على adset_ids مرتّبة حسب الإنفاق
٣. get_ads_in_adset(adset_id) للمجموعات الـ 3 الأعلى إنفاقاً فقط من كل حملة
   — لو رجّعت [META_RATE_LIMIT] انتقل للتالية وأعد المحاولة في النهاية

بعد الجلب — فلتر الإعلانات الميتة:
- Hook Rate < 15% بعد 100 EGP إنفاق (video_p25 ÷ impressions ✅ متوفر)
- أو CTR < 0.8% بعد 200 EGP إنفاق
- أو 0 Purchases بعد 3 أيام + 150 EGP إنفاق
- أو CPA > 100 EGP بعد 200 EGP إنفاق

أعرض جدول مرتب من أعلى إنفاق للأقل:
| اسم الإعلان | الحملة | Hook% | CTR% | Purchases | CPA | الإنفاق (EGP) | سبب الموت |

ثم bulk_action بـ pause_ad لكل الميتين دفعة واحدة.`,
  },
  {
    label: "🔁 نبض منتصف اليوم",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

خطوات التنفيذ (بدون سؤال):
١. get_campaign_daily(days=1) لكل حملة نشطة → إنفاق اليوم الجزئي + CPA حتى الآن
٢. get_campaign_budget(campaign_id) لكل حملة → الميزانية اليومية للمقارنة

أعرض جدول:
| الحملة | إنفاق اليوم (EGP) | الميزانية اليومية | % المستهلك | CPA حتى الآن | التحذير |

تحذيرات فورية:
⚠️ استهلك > 70% من الميزانية قبل المساء → راجع الـ bid
⚠️ CPA اليوم > 80 EGP → قلل الميزانية 30% (update_campaign_budget أو update_adset_budget)
✅ CPA اليوم < 35 EGP + مستقر → اقترح رفع الميزانية 20%

ملاحظة: بيانات اليوم غير مكتملة (تأخر 15-30 دقيقة في Meta).`,
  },
  {
    label: "🚀 Scale الرابحين",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

جيب كل الحملات والمجموعات الإعلانية النشطة من آخر 7 أيام.
فلتر الرابحين:
- Purchases ≥ 5 في 7 أيام
- إنفاق > 100 EGP

أعرض جدول:
| الحملة/المجموعة | النوع | CPA | Purchases | الميزانية الحالية | الإجراء المقترح |

احسب نسبة الزيادة على حسب CPA:
- CPA < 20 EGP → Aggressive Scale: اعرض 3 خيارات (+1× / +2× / +3×) واسأل المستخدم يختار قبل الـ bulk_action
- CPA بين 20-30 EGP → +20%
- CPA بين 30-40 EGP → +10%
- CPA بين 40-50 EGP → WAIT

للحملات اللي مش Aggressive — نفّذ تلقائياً بدون سؤال:
- استخدم get_campaign_budget لتحديد النوع (CBO/ABO) والميزانية الحالية
- لو CBO: ولّد update_campaign_budget
- لو ABO: استخدم get_adsets وولّد update_adset_budget لكل AdSet نشط على حدة
- لا تستخدم update_campaign_budget للـ ABO أبداً

bulk_action واحد بكل الإجراءات (ما عدا Aggressive) دفعة واحدة بدون سؤال.`,
  },
  {
    label: "🔴 Punishment",
    prompt: `ركز فقط على الحملات والمجموعات الإعلانية النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

جيب كل الحملات والمجموعات الإعلانية النشطة من آخر 7 أيام.
فلتر الخاسرين:
- CPA > 50 EGP (أعلى من الـ Target)
- إنفاق > 100 EGP (بيانات كافية للحكم)

أعرض جدول:
| الحملة/المجموعة | النوع | CPA | إنفاق | الميزانية الحالية | الإجراء |

احسب الإجراء على حسب CPA:
- CPA بين 50-80 EGP → قلل الميزانية 20%
- CPA بين 80-100 EGP → قلل الميزانية 30%
- CPA > 100 EGP + إنفاق > 100 EGP → أوقف فوراً

نفّذ تلقائياً بدون سؤال:
- استخدم get_campaign_budget لتحديد النوع (CBO/ABO) والميزانية الحالية
- لو CBO: ولّد update_campaign_budget بالتخفيض المحدد
- لو ABO: استخدم get_adsets وولّد update_adset_budget لكل AdSet نشط على حدة
- لا تستخدم update_campaign_budget للـ ABO أبداً
- للإيقاف: ولّد pause_adset أو pause_campaign مباشرة (مش refresh_creative أو أي نوع تاني)

bulk_action واحد بكل الإجراءات دفعة واحدة بدون ما تسأل عن أي قيمة.`,
  },
];

const QUICK_ACTIONS_GOOGLE = [
  {
    label: "📹 Demand Gen اليوم",
    prompt: `ركز فقط على الحملات النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

جيب أداء حملات Google Demand Gen النشطة من آخر 7 أيام.
أعرض:
| الحملة | الإنفاق | Purchases | CPA | القرار |
معايير Demand Gen على YouTube Shorts:
✅ Scale — CPA < 50 EGP + Purchases > 3
⚠️ Monitor — CPA بين 50-80 EGP
❌ Kill — CPA > 100 EGP + Purchases = 0 بعد 200 EGP
قارن أداء Google vs Meta في نفس الفترة لو في بيانات.`,
  },
  {
    label: "🎬 Creative Google",
    prompt: `ركز فقط على الحملات النشطة (ACTIVE) — تجاهل المتوقفة تماماً. لو أردت رؤية المتوقفة اطلب ذلك صراحةً.

جيب أداء الفيديوهات في حملات Google Demand Gen النشطة.
لكل فيديو أعرض:
| اسم الفيديو | View Rate | CTR | Purchases | CPA | القرار |
تشخيص:
🎬 View Rate < 20% → الفيديو مش بيوقف الناس على YouTube
📝 View Rate كويس + CTR < 1.5% → الـ CTA ضعيف
💸 CTR كويس + Purchases قليلة → مشكلة في الصفحة أو العرض
الرابح: View Rate > 30% + CPA < 50 EGP → مرشح للـ Scale.`,
  },
];

const QA_ALL = [...QUICK_ACTIONS_META, ...QUICK_ACTIONS_GOOGLE];

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
// Regex to detect Latin (English) word sequences so we can wrap them in <bdi>
// for correct bidirectional rendering inside Arabic RTL paragraphs.
const LATIN_RUN_RE = /([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*)*)/g;

function wrapLatinRuns(text: string, keyPrefix: string): React.ReactNode[] {
  const chunks = text.split(LATIN_RUN_RE);
  return chunks.map((chunk, ci) =>
    /^[A-Za-z]/.test(chunk)
      ? <bdi key={`${keyPrefix}-l${ci}`}>{chunk}</bdi>
      : chunk
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\([+-][0-9]+(?:\.[0-9]+)?%\))/g);
  const result: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      result.push(<strong key={i} className="font-semibold">{p.slice(2,-2)}</strong>);
    } else if (p.startsWith("*") && p.endsWith("*")) {
      result.push(<em key={i} className="italic">{p.slice(1,-1)}</em>);
    } else if (p.startsWith("`") && p.endsWith("`")) {
      result.push(<code key={i} className="font-mono text-[13px] bg-muted/70 text-primary px-1.5 py-0.5 rounded border border-border/50">{p.slice(1,-1)}</code>);
    } else if (/^\(\+[0-9]/.test(p)) {
      result.push(<span key={i} className="ai-trend-up">{p}</span>);
    } else if (/^\(-[0-9]/.test(p)) {
      result.push(<span key={i} className="ai-trend-down">{p}</span>);
    } else {
      // Plain text — wrap any Latin runs in <bdi> for RTL isolation
      result.push(...wrapLatinRuns(p, String(i)));
    }
  });
  return result;
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elems: React.ReactNode[] = [];
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
      elems.push(
        <div key={`obs-${i}`} className={`ai-obs-card ${cssClass}`}>
          <span className="ai-obs-label">{label}</span>
          <div>{cardLines.map((cl,ci) => <div key={ci}>{renderInline(cl)}</div>)}</div>
        </div>
      );
      continue;
    }

    // Diagnosis cards :::تشخيص — per-ad structured diagnosis
    if (/^:::تشخيص\s*$/.test(line.trim())) {
      const cardLines: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== ":::") { cardLines.push(lines[i]!); i++; }
      i++;
      const content = cardLines.join(" ");
      let diagType = "";
      if (/media|hook|جذب|🎬/i.test(content))              diagType = "ai-diag-media";
      else if (/funnel|cta|copy|نقر|leak|📝/i.test(content)) diagType = "ai-diag-funnel";
      else if (/landing|page|صفحة|🌐/i.test(content))        diagType = "ai-diag-page";
      else if (/conversion|offer|سعر|عرض|💸/i.test(content)) diagType = "ai-diag-conversion";
      else if (/scale|رابح|winning|✅.*scale|scale.*✅/i.test(content)) diagType = "ai-diag-scale";
      elems.push(
        <div key={`diag-${i}`} className={`ai-diag-card ${diagType}`}>
          {cardLines.map((cl,ci) => <div key={ci}>{renderInline(cl)}</div>)}
        </div>
      );
      continue;
    }

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim().toLowerCase();
      const isChart = lang === "json chart" || lang === "chart" || lang === "json-chart";
      const isPipeboardLaunch = lang === "pipeboard_launch" || lang === "pipeboard-launch";
      const isBulkLang = lang === "bulk_action" || lang === "json bulk_action" || lang === "bulk-action"
                      || lang === "bulk action"  || lang === "json_bulk_action" || lang.includes("bulk");
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) { code.push(lines[i]!); i++; }
      i++;
      const raw = code.join("\n");

      // ── Helper: try to parse raw as a BulkActionPayload regardless of lang ──
      const tryParseBulk = (): BulkActionPayload | null => {
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
          elems.push(<PipeboardLaunchCard key={`launch-${i}`} data={launchData} />);
        } catch {
          elems.push(<pre key={`p${i}`} className="my-2 rounded-lg bg-muted/40 p-3 text-xs overflow-x-auto" dir="ltr">{raw}</pre>);
        }
      } else if (isBulkLang) {
        const bulkPayload = tryParseBulk();
        if (bulkPayload) {
          elems.push(<BulkActionPanel key={`b${i}`} payload={bulkPayload} />);
        } else {
          elems.push(<pre key={`p${i}`} className="my-2 rounded-lg bg-muted/40 p-3 text-xs overflow-x-auto" dir="ltr">{raw}</pre>);
        }
      } else if (isChart) {
        try { elems.push(<ChartBlock key={`c${i}`} spec={JSON.parse(raw) as ChartSpec} />); }
        catch { elems.push(<pre key={`p${i}`} className="my-2 rounded-lg bg-muted/40 p-3 text-xs overflow-x-auto" dir="ltr">{raw}</pre>); }
      } else {
        // Structural fallback: try to detect bulk_action JSON in ANY code block
        // (model sometimes uses ```json or other lang instead of ```bulk_action)
        const bulkPayload = tryParseBulk();
        if (bulkPayload) {
          elems.push(<BulkActionPanel key={`b${i}`} payload={bulkPayload} />);
        } else {
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
      if (lvl === 1) {
        elems.push(<p key={i} className="ai-h1-sovereign">{renderInline(content)}</p>);
      } else {
        const sz = lvl===2?"text-[17px]":"text-[15.5px]";
        elems.push(<p key={i} className={`font-bold ${sz} mt-4 mb-1.5 leading-snug border-b border-border/40 pb-1.5`}>{renderInline(content)}</p>);
      }
      i++; continue;
    }

    // Blockquote > — Opus Logic card if strategic, else standard
    // Decision Box — lines starting with "قرار" (Opus final verdict)
    if (/^(?:\*\*)?(?:#{1,3}\s*)?(?:[🟠🟡🟢🔴⚠️💡⚡🎯]\s*)?قرار\s+ال/u.test(line)) {
      const clean = line.replace(/^#{1,3}\s*/, "").replace(/^\*\*/, "").replace(/\*\*$/, "");
      elems.push(
        <div key={i} className="ai-decision-box">
          <span className="ai-decision-label">⚡ قرار نهائي</span>
          <div>{renderInline(clean)}</div>
        </div>
      );
      i++; continue;
    }

    if (/^>\s/.test(line)) {
      const bqLines: string[] = [];
      while (i < lines.length && /^>\s/.test(lines[i]!)) { bqLines.push(lines[i]!.replace(/^>\s/,"")); i++; }
      const bqText = bqLines.join("\n");
      const isOpus = /المنطق الاستراتيجي|Opus Logic/i.test(bqText);
      elems.push(isOpus
        ? <div key={i} className="ai-opus-logic">{renderInline(bqText)}</div>
        : <div key={i} className="my-2 border-r-4 border-primary/40 pr-3 py-1 bg-primary/5 rounded-sm text-[15px] text-foreground/80 leading-relaxed">{renderInline(bqText)}</div>
      );
      continue;
    }

    if (/^\|/.test(line) && i+1 < lines.length && /^\|[-| :]+\|/.test(lines[i+1]!)) {
      const hdrs = line.split("|").map(c=>c.trim()).filter((_,j,a)=>j>0&&j<a.length-1);
      i+=2;
      const rows: string[][] = [];
      while (i<lines.length && /^\|/.test(lines[i]!)) { rows.push(lines[i]!.split("|").map(c=>c.trim()).filter((_,j,a)=>j>0&&j<a.length-1)); i++; }
      const colTypes = hdrs.map(h=>{
        if (/جذب|hook\s*rate/i.test(h)) return "hook";
        if (/نقر|ctr/i.test(h) && !/outbound/i.test(h)) return "ctr";
        if (/hold\s*rate|مشاهدة كاملة|مشاهدة/i.test(h)) return "hold";
        if (/cpa|تكلفة التحويل|تكلفة\s*تحويل/i.test(h)) return "cpa";
        if (/إنفاق|spend/i.test(h)) return "spend";
        return "";
      });
      const renderNameCell = (raw: string) => {
        const m = raw.match(/^(.*?)\s*\(id:([^)]+)\)\s*$/);
        if (m) return (
          <span className="ai-tbl-name-wrap">
            <span className="ai-tbl-name-text" title={m[1]!}>{m[1]}</span>
            <span className="ai-tbl-name-id">{m[2]}</span>
          </span>
        );
        return <span className="ai-tbl-name-plain" title={raw}>{renderInline(raw)}</span>;
      };
      elems.push(
        <div key={`t${i}`} className="ai-tbl-wrap">
          <table className="ai-tbl">
            <thead>
              <tr>{hdrs.map((h,hi)=>(<th key={hi}>{renderInline(h)}</th>))}</tr>
            </thead>
            <tbody>
              {rows.map((row,ri)=>{
                const rowText = row.join(" ");
                const isWinner = /🟢\s*(Scale|توسيع|مقياس)|Winning Angle|✅\s*Scale/i.test(rowText);
                const isKill = /🔴\s*(Kill|أوقف|إيقاف)/i.test(rowText);
                const rowClass = isWinner?"ai-tbl-winner-row":isKill?"ai-tbl-kill-row":"";
                return (
                  <tr key={ri} className={rowClass||undefined}>
                    {row.map((cell,ci)=>{
                      if (ci===0) return <td key={ci}>{renderNameCell(cell)}</td>;
                      const colType = colTypes[ci] ?? "";
                      const isActive = /نشطة|ACTIVE|✅/.test(cell);
                      const isPaused = /متوقفة|PAUSED|⏸/.test(cell);
                      const isStatus = isActive || isPaused || /^[🔴🟡🟢]/.test(cell);
                      const numVal = parseFloat(cell.replace(/[^\d.,]/g,"").replace(",",""));
                      let extraClass = "";
                      if (colType==="hook" && !isNaN(numVal)) extraClass=numVal>=30?"ai-tbl-hook-good":numVal<20?"ai-tbl-hook-bad":"";
                      else if (colType==="ctr" && !isNaN(numVal)) extraClass=numVal>=1.5?"ai-tbl-ctr-good":numVal<0.8?"ai-tbl-ctr-bad":"";
                      else if (colType==="hold" && !isNaN(numVal)) extraClass=numVal>=20?"ai-tbl-hold-good":numVal<10?"ai-tbl-hold-bad":"";
                      else if (colType==="cpa" && !isNaN(numVal)) extraClass=numVal<=40?"ai-tbl-cpa-good":numVal>100?"ai-tbl-cpa-bad":"";
                      else if (colType==="spend") extraClass="ai-tbl-primary";
                      return (
                        <td key={ci} className={extraClass||undefined}>
                          {isStatus
                            ? <span className={isActive?"ai-tbl-pill-green":"ai-tbl-pill-amber"}>{renderInline(cell)}</span>
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

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i<lines.length && /^[-*]\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^[-*]\s/,"")); i++; }
      elems.push(<ul key={`ul${i}`} className="my-2 space-y-1">{items.map((it,ii)=>(
        <li key={ii} className="flex gap-2 text-[15.5px] leading-relaxed">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0"/>
          <span>{renderInline(it)}</span>
        </li>
      ))}</ul>);
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i<lines.length && /^\d+\.\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\d+\.\s/,"")); i++; }
      elems.push(<ol key={`ol${i}`} className="my-2 space-y-1">{items.map((it,ii)=>(
        <li key={ii} className="flex gap-2 text-[15.5px] leading-relaxed">
          <span className="shrink-0 text-primary/60 font-mono text-[13px] mt-0.5">{ii+1}.</span>
          <span>{renderInline(it)}</span>
        </li>
      ))}</ol>);
      continue;
    }

    elems.push(<p key={i} className="text-[15.5px] leading-relaxed">{renderInline(line)}</p>);
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
  const [showQAMenu, setShowQAMenu] = useState(false);
  const qaMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showQAMenu) return;
    const handler = (e: MouseEvent) => {
      if (qaMenuRef.current && !qaMenuRef.current.contains(e.target as Node)) {
        setShowQAMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showQAMenu]);
  const [convs, setConvs]           = useState<ConvRow[]>([]);
  const [convId, setConvId]         = useState<number|null>(null);
  const [convLoad, setConvLoad]     = useState(false);
  const [delId, setDelId]           = useState<number|null>(null);
  const [renamingId, setRenamingId] = useState<number|null>(null);
  const [renameValue, setRenameVal] = useState("");
  const convIdRef = useRef<number|null>(null);
  useEffect(() => { convIdRef.current = convId; }, [convId]);

  // ── Messages ──
  const [msgs, setMsgs]       = useState<ChatMsg[]>([]);
  const [flexState, setFlexState] = useState<{step:number;campaignId:string;adsetId:string;srcId:string;newName:string;budget:string}|null>(null);
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

  // ── Pick up command sent from مركز العمليات ──────────────────────────────────
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("quick_chat_command");
      if (pending) {
        sessionStorage.removeItem("quick_chat_command");
        // Load flex state if exists
        try {
          const fs = sessionStorage.getItem("flex_state");
          if (fs) setFlexState(JSON.parse(fs) as {step:number;campaignId:string;adsetId:string;srcId:string;newName:string;budget:string});
        } catch { /* ignore */ }
        setTimeout(() => void send(pending), 800);
      }
    } catch { /* ignore */ }
  }, []);

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

  const startRename = useCallback((c: ConvRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(c.id);
    setRenameVal(c.title);
  }, []);

  const commitRename = useCallback(async (id: number) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    try {
      const r = await fetch(`${API}/chat/conversations/${id}`, {
        method: "PATCH",
        headers: {"Content-Type":"application/json"},
        credentials: "include",
        body: JSON.stringify({title: trimmed}),
      });
      if (r.ok) setConvs(p => p.map(c => c.id===id ? {...c, title: trimmed} : c));
    } catch {}
    setRenamingId(null);
  }, [renameValue]);

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
    setInput(""); if (inputRef.current) inputRef.current.style.height="88px";
    const att = attachment; setAtt(null);
    const newMsg: ChatMsg = {role:"user", content:userText};
    if (att?.isImage && att.previewUrl) newMsg.imagePreviewUrl=att.previewUrl;
    const history = [...msgs, newMsg];
    setMsgs(history); setStr(true); setStTxt(""); setTL([]); setPending(null);
    const ctrl = new AbortController(); abortRef.current=ctrl;
    const tid = setTimeout(()=>ctrl.abort(), 360000);
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
      const body: Record<string,unknown> = {campaignContext:ctx, messages:clean, conversation_id:cid, selectedAccountIds:[...selectedAccIds]};
      if (att?.isImage) { body.imageBase64=att.base64; body.imageMimeType=att.mimeType; }
      if (att?.text)   { body.fileText=att.text; body.fileName=att.name; }
      const prepResp = await fetch(`${API}/ai/chat-prepare`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:ctrl.signal, credentials:"include"});
      if (prepResp.status === 401) { logout(); return; }
      if (!prepResp.ok) throw new Error(`prepare HTTP ${prepResp.status}`);
      const { sessionId } = await prepResp.json() as { sessionId: string };
      const resp = await fetch(`${API}/ai/chat-stream?sessionId=${encodeURIComponent(sessionId)}`, {method:"GET", signal:ctrl.signal, credentials:"include"});
      if (resp.status === 401) { logout(); return; }
      if (!resp.ok||!resp.body) throw new Error(`HTTP ${resp.status}`);
      const reader=resp.body.getReader(), dec=new TextDecoder();
      const localLabels: string[] = [];
      let done=false;
      let hadPendingAction = false;
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
          if (data.pending_action) { setPending(data.pending_action as PendingAction); hadPendingAction = true; }
          if (data.pending_action_resolved) setPending(p=>p?{...p,...(data.pending_action_resolved as Partial<PendingAction>),detailsLoading:false}:p);
          if (data.content) { setTL([]); acc+=String(data.content); setStTxt(acc); }
        }
      }
      // If a pending action card was shown, the card itself IS the response — skip "عذراً" fallback
      const final = acc.trim().length>3 ? acc : hadPendingAction ? null : "عذراً، لم أتمكن من الإجابة. حاول مرة أخرى.";
      if (final !== null) {
        const aMsg: ChatMsg = {role:"assistant", content:final};
        if (localLabels.length) aMsg.tool_calls=localLabels;
        setMsgs(p=>[...p,aMsg]);
        if (acc.trim().length>3) void saveToDB(cid, userText, acc, localLabels.length?localLabels:undefined);
      } else {
        if (localLabels.length) setMsgs(p=>{ const last=p[p.length-1]; return last?[...p.slice(0,-1),{...last,tool_calls:[...(last.tool_calls??[]),...localLabels]}]:p; });
      }
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
  }, [input, msgs, streaming, attachment, campCtx, ensureConv, saveToDB, logout]);

  const execAction = useCallback(async () => {
    if (!pending||executing) return;
    setExec(true);
    try {
      const isNoOp = pending.currentValue!=null && pending.proposedValue!=null && pending.currentValue===pending.proposedValue;
      const r = await fetch(`${API}/pipeboard/action`, {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({tool:pending.tool,args:pending.args,isNoOp})});
      const d = await r.json() as {success?:boolean;message?:string;error?:string;launchData?:Record<string,unknown>};
      let res: string;
      if (r.ok && d.success && pending.tool === "launch_pipeboard_campaign") {
        const ld = d.launchData ?? {};
        // Extract text/headline from creatives[] (new format) or top-level (legacy)
        const firstCreative = (Array.isArray(pending.args.creatives) && (pending.args.creatives as Array<Record<string,unknown>>).length > 0)
          ? (pending.args.creatives as Array<Record<string,unknown>>)[0]!
          : null;
        const primaryText = String(firstCreative?.primary_text ?? pending.args.primary_text ?? "");
        const headline    = String(firstCreative?.headline    ?? pending.args.headline    ?? "");
        // Budget: sum adsets[].budget or fall back to daily_budget arg
        const adsetArgs = Array.isArray(pending.args.adsets)
          ? (pending.args.adsets as Array<{ budget?: number }>)
          : [];
        const dailyBudget = adsetArgs.length > 0
          ? adsetArgs.reduce((s, a) => s + (Number(a.budget) || 0), 0)
          : Number(pending.args.daily_budget ?? 20);
        const cardData: PipeboardLaunchData = {
          campaign_name: String(pending.args.campaign_name ?? ""),
          daily_budget: dailyBudget,
          primary_text: primaryText || undefined,
          headline: headline || undefined,
          status: "PAUSED",
          landing_page_url: String(pending.args.landing_page_url ?? ""),
          campaign_id: ld.campaign_id ? String(ld.campaign_id) : undefined,
          objective: ld.objective ? String(ld.objective) : undefined,
          has_pixel: Boolean(ld.has_pixel),
          ads_created: ld.ads_created != null ? Number(ld.ads_created) : undefined,
          ads_failed:  ld.ads_failed  != null ? Number(ld.ads_failed)  : undefined,
          adsets_count:    ld.adsets_count    != null ? Number(ld.adsets_count)    : undefined,
          creatives_count: ld.creatives_count != null ? Number(ld.creatives_count) : undefined,
          ad_results: Array.isArray(ld.ad_results) ? (ld.ad_results as import("@/components/PipeboardLaunchCard").AdResult[]) : undefined,
        };
        res = `✅ تم إنشاء الحملة بنجاح!\n\`\`\`pipeboard_launch\n${JSON.stringify(cardData)}\n\`\`\``;
      } else {
        const extra = d.message&&!d.message.trim().startsWith("{") ? ` — ${d.message.trim()}` : "";
        res = r.ok&&d.success ? `✅ تم بنجاح: ${pending.summary}${extra}` : `❌ فشل التنفيذ: ${d.error||"خطأ"}`;
      }
      setMsgs(p=>[...p,{role:"assistant",content:res}]);
      const cid=convIdRef.current; if(cid!==null) void saveToDB(cid,pending.summary,res);
      // Auto-continue: send result back to AI so it proceeds to next step
      if (r.ok && d.success) {
        // Update flex state with new IDs
        setFlexState(prev => {
          if (!prev) return prev;
          const msg = d.message ?? "";
          const campaignMatch = msg.match(/campaign[_-]?id[^\d]*(\d{10,})/i);
          const adsetMatch = msg.match(/adset[_-]?id[^\d]*(\d{10,})/i);
          return {
            ...prev,
            campaignId: campaignMatch?.[1] ?? prev.campaignId,
            adsetId: adsetMatch?.[1] ?? prev.adsetId,
          };
        });
        // Include the backend result message (contains CAMPAIGN_ID / ADSET_ID) so AI uses the real ID
        const resultDetail = d.message && !d.message.trim().startsWith("{") ? `\nنتيجة التنفيذ:\n${d.message.trim()}` : "";
        setTimeout(() => void send(`✅ تم تنفيذ: ${pending.summary}.${resultDetail}\nالآن نفّذ الخطوة التالية فوراً — تذكر: create_adset يجب أن يكون tool call مباشر وليس داخل bulk_action.`), 500);
      }
    } catch { setMsgs(p=>[...p,{role:"assistant",content:"❌ خطأ في الاتصال."}]); }
    finally { setExec(false); setPending(null); }
  }, [pending, executing, saveToDB]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==="Enter" && !e.shiftKey) {
      e.preventDefault();
      const isDisabled = (!input.trim() && !attachment) || (allAccounts.length > 0 && selectedAccIds.size === 0);
      if (!isDisabled) void send();
    }
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
        md:relative md:top-auto md:bottom-auto md:w-[30%] md:min-w-[220px] md:max-w-[320px] md:z-auto md:translate-x-0 md:shrink-0 md:bg-muted/10
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
                    onClick={()=>{ if (renamingId!==c.id) { void loadConv(c); setSidebarOpen(false); } }}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-right ${convId===c.id ? "bg-primary/10 text-primary" : "hover:bg-muted/60 text-foreground/80"}`}
                  >
                    {renamingId===c.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e=>setRenameVal(e.target.value)}
                        onBlur={()=>void commitRename(c.id)}
                        onKeyDown={e=>{
                          if (e.key==="Enter") { e.preventDefault(); void commitRename(c.id); }
                          if (e.key==="Escape") setRenamingId(null);
                        }}
                        onClick={e=>e.stopPropagation()}
                        className="flex-1 text-[13px] bg-background border border-primary/50 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        dir="rtl"
                      />
                    ) : (
                      <span className="flex-1 text-[13px] truncate leading-snug">{c.title}</span>
                    )}
                    {renamingId===c.id ? (
                      <button
                        onClick={e=>{ e.stopPropagation(); void commitRename(c.id); }}
                        className="h-5 w-5 flex items-center justify-center rounded text-primary hover:bg-primary/10 transition-all shrink-0"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    ) : (
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-all">
                        <button
                          onClick={e=>startRename(c,e)}
                          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                          title="تعديل الاسم"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={e=>void deleteConv(c.id,e)}
                          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-all"
                        >
                          {delId===c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
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
        <div className="flex-1 overflow-y-auto flex flex-col">
          {isEmpty ? (

            /* ── Welcome screen ── */
            <div className="flex flex-col items-center px-4 sm:px-6 gap-3 py-8">
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
                    🔍 جاري سحب وتحليل كافة الحملات (النشطة والمتوقفة مؤخراً) لتقديم تحليل كامل...
                  </div>
                )}
              </div>

              {/* hint */}
              <p className="text-xs text-muted-foreground/60 text-center">استخدم زر ⚡ إجراء سريع أدناه للوصول للأوامر الجاهزة</p>
            </div>

          ) : (

            /* ── Chat messages ── */
            <div className="w-full px-3 sm:px-8 py-3 sm:py-6 space-y-4 sm:space-y-6">
              {msgs.map((m,i)=>(
                <div key={i} className={`flex gap-2 sm:gap-3 ${m.role==="user"?"flex-row-reverse":""}`}>
                  <div className={`h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${m.role==="user"?"bg-primary text-primary-foreground":"bg-muted"}`}>
                    {m.role==="user" ? <User className="h-3.5 w-3.5 sm:h-4 sm:w-4"/> : <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary"/>}
                  </div>
                  <div className={`flex-1 min-w-0 ${m.role==="user"?"flex flex-col items-end":""}`}>
                    {m.role==="user" ? (
                      <>
                        {m.imagePreviewUrl && <img src={m.imagePreviewUrl} alt="" className="mb-2 max-h-48 rounded-lg border border-border" />}
                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 sm:px-5 py-2.5 sm:py-3 text-[15px] sm:text-base max-w-[92%] sm:max-w-[85%] whitespace-pre-wrap leading-relaxed" dir="auto">
                          {m.content}
                        </div>
                      </>
                    ) : (
                      <div className="ai-msg-body text-foreground">
                        <RenderMarkdown text={m.content} />
                        {m.tool_calls && m.tool_calls.length>0 && (
                          <div className="mt-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-[11px] text-muted-foreground/60 border border-border/40">
                              <CheckCircle2 className="h-3 w-3 text-emerald-500/70" />
                              {m.tool_calls.length} {m.tool_calls.length === 1 ? "عملية" : "عمليات"}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Streaming assistant message */}
              {streamTxt && (
                <div className="flex gap-2 sm:gap-3">
                  <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0 ai-msg-body text-foreground">
                    <RenderMarkdown text={streamTxt} />
                  </div>
                </div>
              )}

              {/* Tool call labels (in progress) */}
              {toolLabels.length>0 && !streamTxt && (
                <div className="flex gap-2 sm:gap-3">
                  <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
                  </div>
                  <div className="flex-1 bg-muted/50 rounded-2xl rounded-tl-sm px-3 sm:px-4 py-2.5 sm:py-3 space-y-1.5">
                    {toolLabels.map((l,i)=>(
                      <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin shrink-0 text-primary" />{l}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Typing indicator */}
              {streaming && !streamTxt && toolLabels.length===0 && (
                <div className="flex gap-2 sm:gap-3">
                  <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
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
            <div className="mb-2">
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

          {/* Flex Scale wizard buttons */}
          {flexState && flexState.step > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-2 scrollbar-hide">
              {flexState.step === 1 && (
                <button onClick={() => {
                  void send(`استدعِ create_campaign: الاسم ${flexState.newName} - daily_budget ${flexState.budget} - objective OUTCOME_SALES - status PAUSED. لا تفعل أي شيء آخر.`);
                  setFlexState(p => p ? {...p, step: 2} : null);
                }} disabled={streaming}
                  className="shrink-0 text-xs px-4 py-2 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap font-medium">
                  ٢. أنشئ الحملة ↗
                </button>
              )}
              {flexState.step === 2 && (
                <button onClick={() => {
                  void send(`استدعِ create_adset tool call مباشر في حملة ${flexState.campaignId}: الاسم Flex Adset - بدون budget - targeting مصر residents. لا تفعل أي شيء آخر.`);
                  setFlexState(p => p ? {...p, step: 3} : null);
                }} disabled={streaming}
                  className="shrink-0 text-xs px-4 py-2 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap font-medium">
                  ٣. أنشئ الـ AdSet ↗
                </button>
              )}
              {flexState.step === 3 && (
                <button onClick={() => {
                  void send(`استخدم get_ads_in_adset لجلب ad_ids الرابحين من المجموعة المصدر، ثم استدعِ publish_winners_to_destination كـ tool call مباشر مع destination_adset_id: ${flexState.adsetId} و flex_mode: true. تأكد إن source_ad_ids فيها ad_ids حقيقية مش adset_ids.`);
                  setFlexState(null);
                }} disabled={streaming}
                  className="shrink-0 text-xs px-4 py-2 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap font-medium">
                  ٤. انشر الرابحين ↗
                </button>
              )}
              <button onClick={() => setFlexState(null)}
                className="shrink-0 text-xs px-3 py-2 rounded-full border border-border/60 text-muted-foreground hover:text-foreground whitespace-nowrap">
                إلغاء
              </button>
            </div>
          )}
          {/* Quick actions strip (when chat has messages) — hidden on mobile to save space */}
          <div className="relative mb-2" ref={qaMenuRef}>
              <button
                onClick={() => setShowQAMenu(v => !v)}
                disabled={streaming}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border/60 bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all disabled:opacity-50"
              >
                <span>⚡</span>
                <span>إجراء سريع</span>
                <span className="text-[10px]">{showQAMenu ? "▲" : "▼"}</span>
              </button>

              {showQAMenu && (
                <div className="absolute bottom-full mb-2 right-0 z-50 w-64 rounded-2xl border border-border/60 bg-card shadow-xl overflow-y-auto max-h-[70vh]">
                  {/* Meta Section */}
                  <div className="px-3 pt-3 pb-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">📘 Meta Ads</span>
                  </div>
                  {[
                    { group: "📊 التحليل اليومي", items: ["📊 افتتاحية اليوم", "🔁 نبض منتصف اليوم", "🎯 قرارات الآن"] },
                    { group: "🎯 التيست والقرار", items: ["⚡ قرار التيست", "🔬 فين المشكلة؟"] },
                    { group: "🚀 Scale & Kill", items: ["🚀 Scale الرابحين", "🔴 Punishment", "📺 Saturation Check"] },
                    { group: "🎬 الكريتف", items: ["🕵️ صياد الكريتف", "💀 قبر الكريتف"] },
                  ].map(group => (
                    <div key={group.group} className="px-2 pb-1">
                      <div className="text-[10px] text-muted-foreground px-2 py-1 font-semibold">{group.group}</div>
                      {group.items.map(label => {
                        const q = QUICK_ACTIONS_META.find(a => a.label === label);
                        if (!q) return null;
                        return (
                          <button key={label} onClick={() => { setInput(q.prompt); setShowQAMenu(false); setTimeout(() => inputRef.current?.focus(), 50); }}
                            className="w-full text-right text-sm px-3 py-2 rounded-xl hover:bg-primary/8 hover:text-foreground text-foreground/80 transition-all">
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {/* Google Section */}
                  <div className="border-t border-border/40 px-3 pt-2 pb-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">🟢 Google Ads</span>
                  </div>
                  <div className="px-2 pb-2">
                    {QUICK_ACTIONS_GOOGLE.map(q => (
                      <button key={q.label} onClick={() => { setInput(q.prompt); setShowQAMenu(false); setTimeout(() => inputRef.current?.focus(), 50); }}
                        className="w-full text-right text-sm px-3 py-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 transition-all">
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

          {/* Input row */}
          <div className="relative flex gap-2 items-end">
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
              onInput={e=>{const t=e.currentTarget;t.style.height="auto";t.style.height=Math.min(t.scrollHeight,200)+"px";}}
              placeholder="اكتب رسالتك..."
              rows={2}
              disabled={streaming}
              className="flex-1 resize-none bg-card border border-border/60 rounded-2xl px-4 py-3 text-[15px] sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 min-h-[60px] sm:min-h-[88px] max-h-[200px] sm:max-h-[240px] leading-relaxed disabled:opacity-50 transition-all"
              style={{height:"60px"}}
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
