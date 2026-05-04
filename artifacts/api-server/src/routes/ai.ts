import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  listAdAccounts,
  listCampaigns,
  getCampaignInsights,
  getAccountOverview,
  isRateLimitActive,
} from "../lib/meta-api.js";
import { query } from "../lib/db.js";

const router = Router();

const SYSTEM_PROMPT = `أنت Media Buyer خبير متخصص في Meta Ads (Facebook/Instagram) بخبرة 10+ سنوات.
مهمتك: تشخيص الحملات بمنهجية علمية تربط المقاييس ببعضها — مش مجرد قراءة أرقام منفصلة.

══════════════════════════════════════
الجزء 1 — فهم الـ Funnel بالكامل
══════════════════════════════════════

⚠️ تنبيه مهم جداً عن البيانات:
كل الـ rates في بيانات الحملة تُرسَل كأرقام مئوية جاهزة.
مثال: نسبة الجذب = 45.3 يعني 45.3% — مش 4530%.
مثال: نسبة النقر = 2.1 يعني 2.1% — مش 210%.
مثال: نسبة الوصول للصفحة = 78.5 يعني 78.5% — مش 7850%.
مثال: معدل التحويل = 3.2 يعني 3.2% — مش 320%.
استخدم الأرقام كما هي — لا تضربها في أي شيء.

📊 بيانات المقارنة بالفترة السابقة:
البيانات بتيجيلك بالتغيير مباشرة — مثلاً:
  نسبة النقر: 2.1% (▲+15% عن الفترة السابقة)
يعني النسبة اتحسنت 15% مقارنة بنفس الفترة اللي قبلها.
وممكن تلاقي ملخص الفترة السابقة في آخر البيانات.
لو في بيانات مقارنة، استخدمها في التشخيص — "اتحسن"، "اتراجع"، "ثابت".

📅 البيانات اليومية (يوم بيوم):
بيانات الحملة بتيجيلك مكسّرة يوم بيوم في جدول.
كل صف فيه: التاريخ | الإنفاق | الأوردرات | CPA | نسبة النقر | الظهورات | نسبة الوصول للصفحة.
ممكن تحسب أي فترة فرعية بنفسك من الجدول ده:
  - "آخر يومين" = آخر صفّين في الجدول
  - "آخر 3 أيام" = آخر 3 صفوف
  - "الأسبوع الأول" = أول 7 صفوف
لو الجدول عنده بيانات للفترة السابقة كمان، تقدر تقارن يوم بيوم أو تجمع فترات.
لما حد يسألك عن "آخر 48 ساعة"، اجمع آخر يومين من الجدول وقارنهم بالأيام اللي قبلهم.

🔧 أدوات متاحة لك:
لما تحتاج بيانات مش موجودة في الـ context، استخدم الأدوات المتاحة:
- get_campaigns: قائمة الحملات مع أداءها لأي فترة
- get_campaign_daily: الأداء اليومي لحملة معينة
- get_account_daily: الأداء اليومي للحساب كله
- get_adsets: المجموعات الإعلانية لحملة معينة

كل حملة بتمر بمراحل متسلسلة. المشكلة في أي مرحلة بتأثر على كل اللي بعدها:

Impressions → [Hook Rate] → Video Views 3s → [ThruPlay] → Video Completion
→ [CTR] → Clicks → [LPR] → Landing Page Views → [CR] → Purchases

الـ CPM هو تكلفة الدخول — بيتأثر بالجمهور والمنافسة والـ Relevance Score.
الـ CPA = (CPM ÷ 1000) ÷ (CTR/100) ÷ (LPR/100) ÷ (CR/100) — ده المعادلة الجوهرية.
يعني: CPA مرتفع معناه إن في مرحلة واحدة أو أكتر في الـ funnel بتهدر.

══════════════════════════════════════
الجزء 2 — منهجية التشخيص (اتبع الترتيب ده دايماً)
══════════════════════════════════════

الخطوة 1 — هل في إنفاق كافي؟
- أقل من 5 × CPA المستهدف: البيانات مش كافية للحكم. قول كده صراحةً.
- أقل من 50 ظهور لكل إعلان: مفيش بيانات إعلان كافية.

الخطوة 2 — اشخص مرحلة الـ Attention (الوعي والانتباه)
CPM:
  - طبيعي (100–400 EGP): الجمهور مش متشبّع، المنافسة معقولة
  - مرتفع (400–700 EGP): راجع حجم الجمهور أو تداخل الـ Ad Sets
  - عالي جداً (>700 EGP): Audience Fatigue أو منافسة شرسة — وسّع الجمهور

Hook Rate (نسبة من شاف أول 3 ثواني):
  - ≥35%: الـ Hook ممتاز — المشكلة مش هنا
  - 25–35%: مقبول لكن في مجال تحسين
  - 15–25%: الـ Hook ضعيف — أول 3 ثواني مش جذّابة
  - <15%: كارثة في الـ Hook — الإعلان بيتجاهله الناس فوراً

الخطوة 3 — اشخص مرحلة الـ Engagement (التفاعل مع المحتوى)
ThruPlay Rate (نسبة من كمّل الفيديو أو 15 ثانية):
  - ≥20%: المحتوى ممتاز
  - 12–20%: مقبول
  - 6–12%: ممكن يكون Body ضعيف، لكن أول اتحقق من الـ CTR (انظر ملاحظة أسفل)
  - <6%: ممكن Body ضعيف أو الناس بتكبس بسرعة قبل ما الفيديو يخلص

**⚠️ ملاحظة حرجة جداً عن ThruPlay:**
ThruPlay منخفض مش بيعني دايماً إن الـ Body ضعيف!
لازم تربط ThruPlay بالـ CTR الأول:
  - لو ThruPlay منخفض + CTR عالي (>2%) → الناس بتكبس على الإعلان قبل ما الفيديو يخلص. ده سلوك إيجابي مش مشكلة في الفيديو. المشكلة مش في الـ Creative.
  - لو ThruPlay منخفض + CTR منخفض (<1%) → هنا فعلاً المشكلة في الـ Body، الناس بتسيب الفيديو من غير ما تكبس.
  - لو ThruPlay منخفض + CTR ممتاز + LPR ممتاز + CR متوسط → الـ Funnel شغال من ناحية الإعلان، المشكلة في الـ Landing Page أو التسعير أو الـ Offer.

**⚡ تشخيص مركّب:**
  Hook عالي + ThruPlay منخفض + CTR عالي → الإعلان ممتاز، الناس مقتنعة وبتكبس بسرعة. راقب CR.
  Hook عالي + ThruPlay منخفض + CTR منخفض → المشكلة في الـ Body فعلاً. حسّن المحتوى بعد أول 3 ثواني.
  Hook منخفض + ThruPlay منخفض + CTR منخفض → غيّر الـ Creative بالكامل.
  Hook عالي + ThruPlay عالي + CTR منخفض → الناس بتشوف الفيديو لكن مش بتكبس. الـ CTA ضعيف أو الـ Offer مش مقنعة.

الخطوة 4 — اشخص مرحلة الـ Click (النقر)
CTR (Link Click Rate):
  - ≥2.5%: ممتاز، الـ CTA قوي
  - 1.5–2.5%: كويس
  - 0.8–1.5%: الـ CTA ضعيف أو الـ Copy مش مقنع
  - <0.8%: مشكلة كبيرة في الـ Ad Copy أو الـ CTA

الخطوة 5 — اشخص مرحلة الـ Landing Page
Landing Page Rate (نسبة من وصل للصفحة من اللي نقر):
  - ≥80%: مفيش مشكلة تقنية
  - 60–80%: ممكن يكون في مشكلة في تحميل الصفحة
  - <60%: مشكلة تقنية خطيرة — الناس بتنقر بس الصفحة مش بتتحمل أو بيرجعوا فوراً

**⚡ تشخيص مركّب:**
  CTR عالي + LPR منخفض → الـ Ad كويس بس في مشكلة تقنية في الـ Landing Page. اختبر سرعة التحميل.

الخطوة 6 — اشخص مرحلة الـ Conversion (الأهم — هنا فين الفلوس بتضيع)
CR (Conversion Rate من Landing Page):
  - ≥5%: ممتاز
  - 3–5%: مقبول لكن في مجال تحسين
  - 1.5–3%: مشكلة في الـ Landing Page أو الـ Offer أو التسعير
  - <1.5%: مشكلة كبيرة — الناس بتيجي وبتمشي من غير شراء

**⚡ تشخيصات مركّبة — اقرأها بعناية:**
  CTR عالي + LPR عالي + CR منخفض → الإعلان ممتاز والصفحة بتتحمّل، لكن في مشكلة في الـ Offer نفسها (سعر، ثقة، UX). المشكلة مش في الإعلان.
  CTR عالي + LPR عالي + CR متوسط (3–4%) → الـ Funnel شغال معقول، لكن لو الـ CPA أعلى من الهدف، الـ Bottleneck الأساسي في الـ CR — حسّن الصفحة مش الإعلان.
  CTR عالي + LPR عالي + ThruPlay منخفض + CR متوسط → الإعلان بيجيب نتيجة كويسة رغم التسرّب في الفيديو. المشكلة مش في الـ Creative، المشكلة في تحسين التحويل على الصفحة.

أسباب انخفاض الـ CR في الـ Landing Page:
  1. السعر مرتفع مقارنة بالمنافسين أو مقارنة بتوقعات الجمهور
  2. الـ Landing Page مش بيبني Trust كفاية (مفيش reviews، مفيش ضمانات)
  3. UX مزعج — الصفحة معقدة أو بطيئة
  4. الـ Offer في الإعلان مش نفسها على الصفحة (Mismatch)
  5. الـ CTA على الصفحة مش واضح أو مش جذّاب

الخطوة 7 — اشخص الـ Audience Fatigue
Frequency (في 7 أيام):
  - ≤2: آمن
  - 2–3: تابع — ممكن يبدأ يتأثر
  - 3–4: تحذير — بدأ الـ Fatigue
  - >4: خطر — الجمهور شاف الإعلان أكتر من اللازم، CPM هيرتفع وـ CTR هينزل

**⚡ تشخيص مركّب:**
  Frequency عالية + CPM مرتفع + CTR نازل = Audience Fatigue كلاسيكي. الحل: توسيع الجمهور أو تغيير الـ Creative أو إيقاف مؤقت.

الخطوة 8 — الحكم النهائي على الـ CPA
- CPA ≤ الهدف: ✅ الحملة ناجحة — Scale بحذر (ارفع الـ Budget 20% كل 3 أيام)
- CPA أعلى بـ 10–30%: ⚠️ محتاج تحسين — حدد أين الخسارة في الـ Funnel
- CPA أعلى بأكتر من 30%: ❌ مشكلة كبيرة — روح للـ Funnel وحدد الـ Bottleneck
- مفيش تحويلات: راجع التقنيات (Pixel، Event، Attribution)

══════════════════════════════════════
الجزء 3 — تشخيص مستوى الـ Ad Sets والإعلانات
══════════════════════════════════════

لما بتشوف Ad Sets متعددة:
- قارن الـ CPA بين Ad Sets — الأعلى كفاءة يستحق أكبر Budget
- Ad Set بـ Frequency >4 مع CPA مرتفع: أوقفه أو بدّل Creative
- Ad Set بـ CTR عالي لكن CR منخفض: الجمهور مش الـ Target الصح

لما بتشوف إعلانات متعددة:
- الإعلان بأعلى Hook Rate + CTR: الـ Winner — Scale عليه
- الإعلان بـ Hook عالي + CTR منخفض: الـ Creative كويس بس الـ CTA ضعيف
- الإعلان بأعلى إنفاق + أعلى CPA: Drain — وقفه وحوّل Budget للـ Winner

══════════════════════════════════════
الجزء 4 — قواعد اتخاذ القرار
══════════════════════════════════════

متى توقف:
- CPA أعلى من 2× الهدف + مرت 7 أيام + الـ Learning Phase خلصت
- Frequency >5 مع CPA متزايد
- CTR نازل يومياً لمدة 5 أيام متتالية

متى تستمر وتتحمّل:
- أقل من 7 أيام (لسه في Learning Phase)
- الإنفاق أقل من 5 × CPA مستهدف (بيانات ناقصة)
- CPA مرتفع لكن في اتجاه تحسّن (نازل يومياً)

متى تزيد الـ Budget:
- CPA أقل من الهدف + مرت 7 أيام + Frequency ≤3
- زيد 20% كل 3 أيام — لا تزيد أكتر من كده دفعة واحدة

متى تجرب Creative جديد:
- Hook Rate <20% بعد 3 أيام وإنفاق كافي
- CTR نازل أكتر من 30% عن اليوم الأول
- Frequency >3.5 مع CPA متزايد

══════════════════════════════════════
الجزء 5 — أسلوب الرد وقواعد الكتابة
══════════════════════════════════════

**قواعد الأرقام — أهم حاجة:**
اكتب كل الأرقام بالعربي دايماً:
- بدل 3.2% → اكتب ٣٫٢٪
- بدل 92 → اكتب ٩٢
- بدل 1,500 → اكتب ١٬٥٠٠
- الفرق: بدل +15% → اكتب +١٥٪
لماذا: الأرقام الإنجليزية في النص العربي بتشوه الاتجاه وبتصعّب القراءة.

**قواعد المصطلحات:**
اكتب المصطلحات بالعربي دايماً — فقط لو اضطريت تذكر الإنجليزي، حطه في نهاية الجملة بين قوسين:
- نسبة الجذب (بدل Hook Rate)
- نسبة المشاهدة الكاملة (بدل ThruPlay)
- نسبة النقر (بدل CTR)
- نسبة الوصول للصفحة (بدل LPR)
- معدل التحويل (بدل CR)
- تكلفة التحويل (بدل CPA)
- تكلفة الألف ظهور (بدل CPM)
- صفحة الهبوط (بدل Landing Page)
- المحتوى الإعلاني / الفيديو (بدل Creative)
- الميزانية (بدل Budget)
- المجموعة الإعلانية (بدل Ad Set)
- الجمهور (بدل Audience)
- تشبّع الجمهور (بدل Ad Fatigue)
- التكرار (بدل Frequency)

**قواعد الإيجاز — صارمة:**
- الرد المثالي: ٤ إلى ٦ نقاط بس — مش أكتر
- كل نقطة: جملة واحدة أو اتنين على الأكتر
- ممنوع تكرار نفس المعلومة أو الرقم مرتين
- ممنوع مقدمات — ادخل مباشرة في التشخيص
- ممنوع خاتمات وتلخيصات في آخر الرد
- لو المشكلة واضحة في سطر واحد، قولها في سطر واحد
- المشتري المحترف محتاج قرار مش محاضرة

**قاعدة الأسلوب:**
- كلام مباشر زي ما تكلم زميل — مش تقرير رسمي
- ممنوع "الـ" قبل أي كلمة إنجليزي — صح: "صفحة الهبوط فيها مشكلة" — غلط: "الـ Landing Page فيها مشكلة"

**ترتيب التشخيص:**
١. المشكلة فين بالظبط
٢. ليه — ربط الأرقام ببعضها
٣. إيه اللي المفروض يتعمل`;

// ── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_campaigns",
      description: "جيب قائمة كل الحملات الإعلانية مع أداءها (إنفاق، طلبات، CPA، CTR، الحالة) لفترة زمنية محددة. استخدم لما تحتاج مقارنة الحملات أو معرفة الأرقام الإجمالية.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "عدد الأيام للرجوع للخلف. افتراضي: 30" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_campaign_daily",
      description: "جيب الأداء اليومي لحملة معينة يوم بيوم (إنفاق، طلبات، CPA، نسبة النقر، ظهورات، نسبة الجذب). استخدم لما تحتاج تحليل تريند حملة معينة أو مقارنة أيام.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
          days: { type: "number", description: "عدد الأيام للرجوع للخلف. افتراضي: 14" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_account_daily",
      description: "جيب الأداء اليومي للحساب كله مجتمعاً يوم بيوم (إنفاق، طلبات، CPA). استخدم لمقارنة أيام أو تحليل اتجاه الأداء العام.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "عدد الأيام للرجوع للخلف. افتراضي: 14" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_adsets",
      description: "جيب المجموعات الإعلانية (Ad Sets) لحملة معينة مع أداء كل مجموعة. استخدم لمقارنة الجماهير أو اكتشاف أي مجموعة بتهدر الميزانية.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
          days: { type: "number", description: "عدد الأيام للرجوع للخلف. افتراضي: 7" },
        },
        required: ["campaign_id"],
      },
    },
  },
] as const;

// ── Rate-limit error detection (mirrors meta.ts) ─────────────────────────────
function isRateLimitErr(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("80004") ||
    msg.includes("(17)") ||
    msg.toLowerCase().includes("too many calls") ||
    msg.toLowerCase().includes("user request limit") ||
    msg.toLowerCase().includes("rate limit")
  );
}

// 30 min — same freshness window as the dashboard routes
const TOOL_CACHE_FRESH_MS = 30 * 60 * 1000;

// ── Tool executor (cache-first: DB → Meta API → stale fallback) ───────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const days = Number(args.days ?? (name === "get_campaigns" ? 30 : 14));
  // Use Cairo time (GMT+2) so "today" matches the dashboard's date logic
  const untilD = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const sinceD = new Date(untilD);
  sinceD.setUTCDate(sinceD.getUTCDate() - days);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const u = fmtDate(untilD);
  const s = fmtDate(sinceD);

  const fmt = (n: number, dec = 0) => n.toFixed(dec);

  // ── Cache-aware getCampaignInsights ─────────────────────────────────────────
  async function fetchInsightsCached(campaign_id: string): Promise<Awaited<ReturnType<typeof getCampaignInsights>>> {
    const cached = await query<{ data: unknown; fetched_at: string }>(
      `SELECT data, fetched_at FROM meta_insights_cache
       WHERE campaign_id=$1 AND period_since=$2 AND period_until=$3`,
      [campaign_id, s, u]
    ).catch(() => [] as { data: unknown; fetched_at: string }[]);
    const hit = cached[0];

    // Fresh cache → serve immediately, no Meta call
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < TOOL_CACHE_FRESH_MS) {
      return hit.data as Awaited<ReturnType<typeof getCampaignInsights>>;
    }
    // Rate-limit is active → serve stale cache rather than blocking 90s
    if (isRateLimitActive() && hit) {
      return hit.data as Awaited<ReturnType<typeof getCampaignInsights>>;
    }
    // Fetch from Meta
    try {
      const data = await getCampaignInsights({ campaign_id, since: s, until: u });
      await query(
        `INSERT INTO meta_insights_cache (campaign_id, period_since, period_until, data, fetched_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (campaign_id, period_since, period_until)
         DO UPDATE SET data=$4, fetched_at=NOW()`,
        [campaign_id, s, u, JSON.stringify(data)]
      ).catch(() => null);
      return data;
    } catch (err) {
      // Rate-limited mid-request → return stale cache if available
      if (isRateLimitErr(err) && hit) return hit.data as Awaited<ReturnType<typeof getCampaignInsights>>;
      throw err;
    }
  }

  // ── Cache-aware listCampaigns ───────────────────────────────────────────────
  async function fetchCampaignsCached(adAccountId: string): Promise<Awaited<ReturnType<typeof listCampaigns>>> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;
    const cached = await query<{ campaigns: unknown; fetched_at: string }>(
      `SELECT campaigns, fetched_at FROM meta_campaigns_cache
       WHERE account_id=$1 AND period_since=$2 AND period_until=$3`,
      [accountId, s, u]
    ).catch(() => [] as { campaigns: unknown; fetched_at: string }[]);
    const hit = cached[0];

    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < TOOL_CACHE_FRESH_MS) {
      return hit.campaigns as Awaited<ReturnType<typeof listCampaigns>>;
    }
    if (isRateLimitActive() && hit) return hit.campaigns as Awaited<ReturnType<typeof listCampaigns>>;
    try {
      const campaigns = await listCampaigns({ since: s, until: u, adAccountId });
      await query(
        `INSERT INTO meta_campaigns_cache (account_id, period_since, period_until, campaigns, fetched_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (account_id, period_since, period_until)
         DO UPDATE SET campaigns=$4, fetched_at=NOW()`,
        [accountId, s, u, JSON.stringify(campaigns)]
      ).catch(() => null);
      return campaigns;
    } catch (err) {
      if (isRateLimitErr(err) && hit) return hit.campaigns as Awaited<ReturnType<typeof listCampaigns>>;
      throw err;
    }
  }

  // ── Cache-aware getAccountOverview ──────────────────────────────────────────
  async function fetchOverviewCached(adAccountId: string): Promise<Awaited<ReturnType<typeof getAccountOverview>>> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;
    const cached = await query<{ data: unknown; fetched_at: string }>(
      `SELECT data, fetched_at FROM meta_overview_cache
       WHERE account_id=$1 AND period_since=$2 AND period_until=$3`,
      [accountId, s, u]
    ).catch(() => [] as { data: unknown; fetched_at: string }[]);
    const hit = cached[0];

    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < TOOL_CACHE_FRESH_MS) {
      return hit.data as Awaited<ReturnType<typeof getAccountOverview>>;
    }
    if (isRateLimitActive() && hit) return hit.data as Awaited<ReturnType<typeof getAccountOverview>>;
    try {
      const data = await getAccountOverview({ adAccountId, since: s, until: u });
      await query(
        `INSERT INTO meta_overview_cache (account_id, period_since, period_until, data, fetched_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (account_id, period_since, period_until)
         DO UPDATE SET data=$4, fetched_at=NOW()`,
        [accountId, s, u, JSON.stringify(data)]
      ).catch(() => null);
      return data;
    } catch (err) {
      if (isRateLimitErr(err) && hit) return hit.data as Awaited<ReturnType<typeof getAccountOverview>>;
      throw err;
    }
  }

  // ── Tool dispatch ───────────────────────────────────────────────────────────
  try {
    const accounts = await listAdAccounts();
    if (accounts.length === 0) return "لا توجد حسابات إعلانية مرتبطة.";

    if (name === "get_campaigns") {
      const rows: string[] = [`## الحملات (آخر ${days} يوم):\n`];
      rows.push("| الحملة | الحالة | الإنفاق (EGP) | الطلبات | CPA (EGP) | CTR% |");
      rows.push("|--------|--------|--------------|---------|-----------|------|");
      for (const acc of accounts) {
        const campaigns = await fetchCampaignsCached(acc.id);
        for (const c of campaigns) {
          rows.push(`| ${c.name} (id:${c.id}) | ${c.effective_status} | ${fmt(c.spend)} | ${c.purchases} | ${c.cpa > 0 ? fmt(c.cpa) : "—"} | ${fmt(c.ctr, 2)} |`);
        }
      }
      return rows.join("\n");
    }

    if (name === "get_campaign_daily") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return "campaign_id مطلوب.";
      const insights = await fetchInsightsCached(campaign_id);
      if (!insights.daily || insights.daily.length === 0) return "لا توجد بيانات يومية لهذه الحملة في الفترة المحددة.";

      const rows: string[] = [`## الأداء اليومي للحملة (آخر ${days} يوم):\n`];
      rows.push("| التاريخ | الإنفاق (EGP) | الطلبات | CPA (EGP) | نسبة النقر% | الظهورات |");
      rows.push("|---------|--------------|---------|-----------|-------------|----------|");
      for (const d of insights.daily) {
        const dayCtr = d.impressions > 0 ? fmt((d.link_clicks / d.impressions) * 100, 2) : "—";
        rows.push(`| ${d.day} | ${fmt(d.spend)} | ${d.purchases} | ${d.cpa > 0 ? fmt(d.cpa) : "—"} | ${dayCtr} | ${d.impressions.toLocaleString()} |`);
      }
      const t = insights.totals;
      rows.push(`\n### ملخص الحملة (${days} يوم):`);
      rows.push(`- إجمالي الإنفاق: ${fmt(t.spend)} EGP`);
      rows.push(`- إجمالي الطلبات: ${t.purchases}`);
      rows.push(`- متوسط CPA: ${t.cpa > 0 ? fmt(t.cpa) + " EGP" : "—"}`);
      rows.push(`- نسبة النقر: ${fmt(t.ctr, 2)}%`);
      rows.push(`- نسبة الجذب: ${fmt(t.hookRate, 2)}%`);
      rows.push(`- نسبة الوصول للصفحة: ${fmt(t.lpvRate, 2)}%`);
      rows.push(`- معدل التحويل: ${fmt(t.crLpv, 2)}%`);
      rows.push(`- التكرار: ${fmt(t.frequency, 2)}`);
      return rows.join("\n");
    }

    if (name === "get_account_daily") {
      const rows: string[] = [`## الأداء اليومي للحساب كله (آخر ${days} يوم):\n`];
      rows.push("| التاريخ | الإنفاق (EGP) | الطلبات | CPA (EGP) | النقرات |");
      rows.push("|---------|--------------|---------|-----------|---------|");
      const allDaily: { day: string; spend: number; purchases: number; cpa: number; link_clicks: number }[] = [];
      for (const acc of accounts) {
        const overview = await fetchOverviewCached(acc.id);
        allDaily.push(...overview.daily);
      }
      const byDay = new Map<string, { spend: number; purchases: number; link_clicks: number }>();
      for (const d of allDaily) {
        const cur = byDay.get(d.day) ?? { spend: 0, purchases: 0, link_clicks: 0 };
        cur.spend += d.spend;
        cur.purchases += d.purchases;
        cur.link_clicks += d.link_clicks ?? 0;
        byDay.set(d.day, cur);
      }
      const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [day, d] of sorted) {
        const cpa = d.purchases > 0 ? d.spend / d.purchases : 0;
        rows.push(`| ${day} | ${fmt(d.spend)} | ${d.purchases} | ${cpa > 0 ? fmt(cpa) : "—"} | ${d.link_clicks} |`);
      }
      if (sorted.length >= 4) {
        const half = Math.floor(sorted.length / 2);
        const recent = sorted.slice(-half);
        const older = sorted.slice(0, half);
        const recentSpend = recent.reduce((s, [, d]) => s + d.spend, 0) / recent.length;
        const olderSpend = older.reduce((s, [, d]) => s + d.spend, 0) / older.length;
        const recentCpa = recent.reduce((s, [, d]) => s + (d.purchases > 0 ? d.spend / d.purchases : 0), 0) / recent.filter(([, d]) => d.purchases > 0).length;
        const olderCpa = older.reduce((s, [, d]) => s + (d.purchases > 0 ? d.spend / d.purchases : 0), 0) / older.filter(([, d]) => d.purchases > 0).length;
        rows.push(`\n### تحليل الاتجاه (النصف الأخير مقابل الأول):`);
        rows.push(`- متوسط الإنفاق اليومي: ${fmt(recentSpend)} → ${recentSpend > olderSpend ? "↑ ارتفع" : "↓ انخفض"} (كان ${fmt(olderSpend)})`);
        if (!isNaN(recentCpa) && !isNaN(olderCpa)) {
          rows.push(`- متوسط CPA: ${fmt(recentCpa)} → ${recentCpa > olderCpa ? "↑ ارتفع (تراجع في الأداء)" : "↓ انخفض (تحسن في الأداء)"} (كان ${fmt(olderCpa)})`);
        }
      }
      return rows.join("\n");
    }

    if (name === "get_adsets") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return "campaign_id مطلوب.";
      const insights = await fetchInsightsCached(campaign_id);
      if (!insights.by_adset || insights.by_adset.length === 0) return "لا توجد بيانات مجموعات إعلانية لهذه الحملة.";

      const rows: string[] = [`## المجموعات الإعلانية للحملة (آخر ${days} يوم):\n`];
      rows.push("| المجموعة | الإنفاق (EGP) | الطلبات | CPA (EGP) | نسبة النقر% | التكرار |");
      rows.push("|----------|--------------|---------|-----------|-------------|---------|");
      const sorted = [...insights.by_adset].sort((a, b) => b.spend - a.spend);
      for (const as of sorted) {
        rows.push(`| ${as.label} | ${fmt(as.spend)} | ${as.purchases} | ${as.cpa > 0 ? fmt(as.cpa) : "—"} | ${fmt(as.ctr, 2)} | ${fmt(as.frequency, 2)} |`);
      }
      return rows.join("\n");
    }

    return "أداة غير معروفة.";
  } catch (err) {
    return `خطأ في جلب البيانات: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiChatBody {
  campaignContext: string;
  messages: ChatMessage[];
  imageBase64?: string;
  imageMimeType?: string;
  fileText?: string;
  fileName?: string;
}

type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } }> }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; content: string; tool_call_id: string };

// ── Route ────────────────────────────────────────────────────────────────────
router.post("/ai/chat", async (req: Request, res: Response) => {
  const { campaignContext, messages, imageBase64, imageMimeType, fileText, fileName } = req.body as AiChatBody;

  if (!campaignContext || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "campaignContext and messages are required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const systemWithContext = `${SYSTEM_PROMPT}\n\n══════════════════════════════════════\nبيانات الحملة الحالية (استخدمها في كل تشخيص)\n══════════════════════════════════════\n${campaignContext}`;

    const builtMessages: OpenAiMessage[] = [
      { role: "system", content: systemWithContext },
    ];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      const isLast = i === messages.length - 1;

      if (m.role === "user" && isLast && (imageBase64 || fileText)) {
        const textContent = fileText
          ? `${m.content}\n\n[محتوى الملف "${fileName ?? "file"}"]\n${fileText}`
          : m.content;
        if (imageBase64 && imageMimeType) {
          builtMessages.push({
            role: "user",
            content: [
              { type: "text", text: textContent },
              { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: "auto" } },
            ],
          });
        } else {
          builtMessages.push({ role: "user", content: textContent });
        }
      } else {
        builtMessages.push({ role: m.role, content: m.content });
      }
    }

    // ── Tool use loop (non-streaming until tools resolved) ──────────────────
    const MAX_TOOL_ROUNDS = 4;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 8192,
        messages: builtMessages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
        tools: [...TOOLS] as unknown as Parameters<typeof openai.chat.completions.create>[0]["tools"],
        tool_choice: "auto",
        stream: false,
      });

      const choice = resp.choices[0];
      if (!choice) break;

      // Filter to function-type tool calls only
      const toolCalls = (choice.message.tool_calls ?? []).filter(
        (tc): tc is typeof tc & { type: "function"; function: { name: string; arguments: string } } =>
          tc.type === "function" && "function" in tc
      );

      // No tool calls → stream the final answer
      if (toolCalls.length === 0) {
        const finalContent = choice.message.content ?? "";
        // Stream word-by-word for UX
        const words = finalContent.split(/(?<=\s)/);
        for (const word of words) {
          res.write(`data: ${JSON.stringify({ content: word })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      // Has tool calls → notify client (separate field, not content)
      res.write(`data: ${JSON.stringify({ searching: true })}\n\n`);

      // Push assistant message with tool calls
      builtMessages.push({
        role: "assistant",
        content: choice.message.content ?? null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      // Execute all tool calls in parallel
      await Promise.all(
        toolCalls.map(async (tc) => {
          const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          const result = await executeTool(tc.function.name, args);
          builtMessages.push({
            role: "tool",
            content: result,
            tool_call_id: tc.id,
          });
        })
      );

      // Done fetching — client can hide the indicator
      res.write(`data: ${JSON.stringify({ searching: false })}\n\n`);
    }

    // Fallback: if we ran out of rounds, do a final streaming call without tools
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: builtMessages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

export default router;
