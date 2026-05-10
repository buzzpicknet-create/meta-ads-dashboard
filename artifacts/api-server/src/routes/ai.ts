import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  listAdAccounts,
  listCampaigns,
  getCampaignInsights,
  getAccountOverview,
  getCampaignDetails,
  getAdsetDetails,
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
- get_ad_performance: أداء إعلان بعينه (نسبة الجذب، نسبة النقر، تكلفة التحويل، الظهورات، الإنفاق) — استخدم قبل التوصية بتغيير أو إيقاف إعلان محدد

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

⚠️ مهم: قبل توصية بتغيير محتوى إعلان أو إيقافه، استخدم get_ad_performance للتحقق من نسبة الجذب والنقر والتكلفة الفعلية لهذا الإعلان. لا تبني توصية على بيانات الـ context وحده لو عندك ad_id محدد.

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
٣. إيه اللي المفروض يتعمل

══════════════════════════════════════
الجزء 6 — أدوات التنفيذ (Write Actions)
══════════════════════════════════════

لديك أدوات تنفيذية تتيح لك اقتراح إجراءات مباشرة على Meta.

⚠️ قاعدة ذهبية — لازم تلتزم بها دايماً:
قبل أي write action، لازم تكون جبت البيانات الفعلية أولاً. الترتيب الإلزامي:
١. اجلب حالة العنصر الحالية:
   - قبل pause_campaign أو enable_campaign: استخدم get_campaign_status أولاً
   - قبل update_campaign_budget: استخدم get_campaign_budget أولاً
   - قبل pause_adset أو enable_adset أو update_adset_budget: استخدم get_adset_status أولاً
٢. اجلب بيانات الأداء للتشخيص (get_campaign_daily أو get_adsets)
ممنوع تقترح إيقاف أو تعديل بدون تشخيص مبني على بيانات حقيقية وحالة حالية موثّقة.

الأدوات المتاحة:
- pause_campaign(campaign_id, name) — إيقاف حملة مؤقتاً
- enable_campaign(campaign_id, name) — تشغيل حملة موقوفة
- update_campaign_budget(campaign_id, name, budget_amount, budget_type) — تعديل الميزانية (budget_type: "daily" أو "lifetime")
- pause_adset(adset_id, name) — إيقاف مجموعة إعلانية
- enable_adset(adset_id, name) — تشغيل مجموعة إعلانية
- update_adset_budget(adset_id, name, budget_amount) — تعديل ميزانية مجموعة
- duplicate_adset(adset_id, name) — نسخ مجموعة إعلانية

مهم: هذه الأدوات لا تنفذ فوراً — ستظهر للمستخدم طلب تأكيد قبل التنفيذ.
بعد استدعاء الأداة قل "في انتظار موافقتك" — لا تقل "تم التنفيذ".`;

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
  {
    type: "function" as const,
    function: {
      name: "get_campaign_status",
      description: "جيب الحالة الحالية لحملة معينة (نشطة/موقوفة) مع الاسم. استخدم قبل اقتراح إيقاف أو تشغيل حملة للتحقق من حالتها الفعلية.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_campaign_budget",
      description: "جيب الميزانية الحالية لحملة معينة (يومية أو إجمالية) بالـ EGP. استخدم قبل اقتراح تعديل الميزانية للتحقق من القيمة الحالية.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_adset_status",
      description: "جيب الحالة الحالية ومعلومات الميزانية لمجموعة إعلانية معينة. استخدم قبل اقتراح إيقاف أو تعديل مجموعة إعلانية.",
      parameters: {
        type: "object",
        properties: {
          adset_id: { type: "string", description: "رقم المجموعة الإعلانية (id)" },
        },
        required: ["adset_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_ad_performance",
      description: "جيب أداء إعلان بعينه — نسبة الجذب (Hook Rate)، نسبة النقر (CTR)، تكلفة التحويل (CPA)، الإنفاق، والظهورات. استخدم قبل أي توصية بتغيير المحتوى الإعلاني أو إيقاف إعلان معين للتحقق من أرقامه الفعلية.",
      parameters: {
        type: "object",
        properties: {
          ad_id: { type: "string", description: "رقم الإعلان (id)" },
          days: { type: "number", description: "عدد الأيام للرجوع للخلف. افتراضي: 7" },
        },
        required: ["ad_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pause_campaign",
      description: "اقتراح إيقاف مؤقت لحملة إعلانية. استخدم بعد تشخيص البيانات وإثبات ضعف الأداء فقط. سيظهر طلب تأكيد للمستخدم قبل التنفيذ.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
          name: { type: "string", description: "اسم الحملة للعرض في طلب التأكيد" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enable_campaign",
      description: "اقتراح تشغيل حملة موقوفة. سيظهر طلب تأكيد للمستخدم قبل التنفيذ.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
          name: { type: "string", description: "اسم الحملة للعرض في طلب التأكيد" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_campaign_budget",
      description: "اقتراح تعديل ميزانية حملة يومية أو إجمالية. استخدم بعد تحليل الأداء وتحديد القيمة المناسبة. سيظهر طلب تأكيد للمستخدم.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
          name: { type: "string", description: "اسم الحملة" },
          budget_amount: { type: "number", description: "قيمة الميزانية الجديدة بالـ EGP" },
          budget_type: { type: "string", enum: ["daily", "lifetime"], description: "نوع الميزانية: daily (يومية) أو lifetime (إجمالية)" },
        },
        required: ["campaign_id", "budget_amount", "budget_type"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pause_adset",
      description: "اقتراح إيقاف مجموعة إعلانية (Ad Set). استخدم بعد تشخيص أداءها الفعلي. سيظهر طلب تأكيد.",
      parameters: {
        type: "object",
        properties: {
          adset_id: { type: "string", description: "رقم المجموعة الإعلانية (id)" },
          name: { type: "string", description: "اسم المجموعة للعرض في التأكيد" },
        },
        required: ["adset_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_adset_budget",
      description: "اقتراح تعديل ميزانية مجموعة إعلانية. سيظهر طلب تأكيد للمستخدم.",
      parameters: {
        type: "object",
        properties: {
          adset_id: { type: "string", description: "رقم المجموعة الإعلانية (id)" },
          name: { type: "string", description: "اسم المجموعة" },
          budget_amount: { type: "number", description: "قيمة الميزانية الجديدة بالـ EGP" },
        },
        required: ["adset_id", "budget_amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enable_adset",
      description: "اقتراح تشغيل مجموعة إعلانية موقوفة. سيظهر طلب تأكيد للمستخدم.",
      parameters: {
        type: "object",
        properties: {
          adset_id: { type: "string", description: "رقم المجموعة الإعلانية (id)" },
          name: { type: "string", description: "اسم المجموعة" },
        },
        required: ["adset_id", "name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "duplicate_adset",
      description: "اقتراح نسخ مجموعة إعلانية (إنشاء نسخة جديدة بنفس الإعدادات). سيظهر طلب تأكيد للمستخدم.",
      parameters: {
        type: "object",
        properties: {
          adset_id: { type: "string", description: "رقم المجموعة الإعلانية المراد نسخها (id)" },
          name: { type: "string", description: "اسم المجموعة" },
        },
        required: ["adset_id", "name"],
      },
    },
  },
];

// ── Write tool names (handled separately — return ACTION_PENDING marker) ─────
const WRITE_TOOL_NAMES = new Set([
  "pause_campaign",
  "enable_campaign",
  "update_campaign_budget",
  "pause_adset",
  "enable_adset",
  "update_adset_budget",
  "duplicate_adset",
]);

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
// Only annotate cache note when data is older than this threshold
const CACHE_NOTE_THRESHOLD_MS = 5 * 60 * 1000;

interface CacheResult<T> {
  data: T;
  fromCache: boolean;
  cacheAgeMs: number;
}

function buildCacheNote(fromCache: boolean, cacheAgeMs: number): string {
  if (!fromCache || cacheAgeMs <= CACHE_NOTE_THRESHOLD_MS) return "";
  const minutes = Math.round(cacheAgeMs / 60000);
  return `\n\n_(من الكاش، آخر تحديث: ${minutes} دقيقة)_`;
}

// ── Tool executor (cache-first: DB → Meta API → stale fallback) ───────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // Write tools — fetch current state then return a pending-confirmation marker
  if (WRITE_TOOL_NAMES.has(name)) {
    let summary = "";
    let currentValue: string | undefined;
    let proposedValue: string | undefined;

    const statusLabel = (s: string) => {
      if (s === "ACTIVE") return "نشطة ✅";
      if (s === "PAUSED" || s === "CAMPAIGN_PAUSED") return "موقوفة ⏸";
      return s;
    };

    if (name === "pause_campaign") {
      const label = String(args.name ?? args.campaign_id);
      summary = `إيقاف مؤقت للحملة "${label}"`;
      proposedValue = "موقوفة ⏸";
      try {
        const details = await getCampaignDetails(String(args.campaign_id));
        currentValue = statusLabel(details.effective_status);
        if (!args.name && details.name) summary = `إيقاف مؤقت للحملة "${details.name}"`;
      } catch {}
    } else if (name === "enable_campaign") {
      const label = String(args.name ?? args.campaign_id);
      summary = `تشغيل الحملة "${label}"`;
      proposedValue = "نشطة ✅";
      try {
        const details = await getCampaignDetails(String(args.campaign_id));
        currentValue = statusLabel(details.effective_status);
        if (!args.name && details.name) summary = `تشغيل الحملة "${details.name}"`;
      } catch {}
    } else if (name === "update_campaign_budget") {
      const budgetType = args.budget_type === "lifetime" ? "إجمالية" : "يومية";
      const label = String(args.name ?? args.campaign_id);
      summary = `تعديل ميزانية الحملة "${label}" إلى ${args.budget_amount} EGP (${budgetType})`;
      proposedValue = `${args.budget_amount} EGP (${budgetType})`;
      try {
        const details = await getCampaignDetails(String(args.campaign_id));
        if (!args.name && details.name) summary = `تعديل ميزانية الحملة "${details.name}" إلى ${args.budget_amount} EGP (${budgetType})`;
        const curBudget = args.budget_type === "lifetime" ? details.lifetime_budget : details.daily_budget;
        if (curBudget !== undefined && curBudget > 0) {
          currentValue = `${Math.round(curBudget)} EGP (${budgetType})`;
        }
      } catch {}
    } else if (name === "pause_adset") {
      const label = String(args.name ?? args.adset_id);
      summary = `إيقاف مؤقت للمجموعة الإعلانية "${label}"`;
      proposedValue = "موقوفة ⏸";
      try {
        const details = await getAdsetDetails(String(args.adset_id));
        currentValue = statusLabel(details.effective_status);
        if (!args.name && details.name) summary = `إيقاف مؤقت للمجموعة الإعلانية "${details.name}"`;
      } catch {}
    } else if (name === "enable_adset") {
      const label = String(args.name ?? args.adset_id);
      summary = `تشغيل المجموعة الإعلانية "${label}"`;
      proposedValue = "نشطة ✅";
      try {
        const details = await getAdsetDetails(String(args.adset_id));
        currentValue = statusLabel(details.effective_status);
        if (!args.name && details.name) summary = `تشغيل المجموعة الإعلانية "${details.name}"`;
      } catch {}
    } else if (name === "update_adset_budget") {
      const label = String(args.name ?? args.adset_id);
      summary = `تعديل ميزانية المجموعة "${label}" إلى ${args.budget_amount} EGP`;
      proposedValue = `${args.budget_amount} EGP`;
      try {
        const details = await getAdsetDetails(String(args.adset_id));
        if (!args.name && details.name) summary = `تعديل ميزانية المجموعة "${details.name}" إلى ${args.budget_amount} EGP`;
        const curBudget = details.daily_budget ?? details.lifetime_budget;
        if (curBudget !== undefined && curBudget > 0) {
          const bType = details.lifetime_budget !== undefined && details.daily_budget === undefined ? "إجمالية" : "يومية";
          currentValue = `${Math.round(curBudget)} EGP (${bType})`;
        }
      } catch {}
    } else if (name === "duplicate_adset") {
      summary = `نسخ المجموعة الإعلانية "${args.name ?? args.adset_id}"`;
      try {
        const details = await getAdsetDetails(String(args.adset_id));
        if (!args.name && details.name) summary = `نسخ المجموعة الإعلانية "${details.name}"`;
      } catch {}
    }
    return `ACTION_PENDING:${JSON.stringify({ tool: name, args, summary, currentValue, proposedValue })}`;
  }

  const days = Number(args.days ?? (name === "get_campaigns" ? 30 : (name === "get_ad_performance" || name === "get_adsets") ? 7 : 14));
  // Use Cairo time (GMT+2) so "today" matches the dashboard's date logic
  const untilD = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const sinceD = new Date(untilD);
  sinceD.setUTCDate(sinceD.getUTCDate() - days);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const u = fmtDate(untilD);
  const s = fmtDate(sinceD);

  const fmt = (n: number, dec = 0) => n.toFixed(dec);

  // ── Cache-aware getCampaignInsights ─────────────────────────────────────────
  async function fetchInsightsCached(campaign_id: string): Promise<CacheResult<Awaited<ReturnType<typeof getCampaignInsights>>>> {
    const cached = await query<{ data: unknown; fetched_at: string }>(
      `SELECT data, fetched_at FROM meta_insights_cache
       WHERE campaign_id=$1 AND period_since=$2 AND period_until=$3`,
      [campaign_id, s, u]
    ).catch(() => [] as { data: unknown; fetched_at: string }[]);
    const hit = cached[0];

    const hitAgeMs = hit ? Date.now() - new Date(hit.fetched_at).getTime() : 0;

    // Fresh cache → serve immediately, no Meta call
    if (hit && hitAgeMs < TOOL_CACHE_FRESH_MS) {
      return { data: hit.data as Awaited<ReturnType<typeof getCampaignInsights>>, fromCache: true, cacheAgeMs: hitAgeMs };
    }
    // Rate-limit is active → serve stale cache rather than blocking 90s
    if (isRateLimitActive() && hit) {
      return { data: hit.data as Awaited<ReturnType<typeof getCampaignInsights>>, fromCache: true, cacheAgeMs: hitAgeMs };
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
      return { data, fromCache: false, cacheAgeMs: 0 };
    } catch (err) {
      // Rate-limited mid-request → return stale cache if available
      if (isRateLimitErr(err) && hit) return { data: hit.data as Awaited<ReturnType<typeof getCampaignInsights>>, fromCache: true, cacheAgeMs: hitAgeMs };
      throw err;
    }
  }

  // ── Cache-aware listCampaigns ───────────────────────────────────────────────
  async function fetchCampaignsCached(adAccountId: string): Promise<CacheResult<Awaited<ReturnType<typeof listCampaigns>>>> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;
    const cached = await query<{ campaigns: unknown; fetched_at: string }>(
      `SELECT campaigns, fetched_at FROM meta_campaigns_cache
       WHERE account_id=$1 AND period_since=$2 AND period_until=$3`,
      [accountId, s, u]
    ).catch(() => [] as { campaigns: unknown; fetched_at: string }[]);
    const hit = cached[0];

    const hitAgeMs = hit ? Date.now() - new Date(hit.fetched_at).getTime() : 0;

    if (hit && hitAgeMs < TOOL_CACHE_FRESH_MS) {
      return { data: hit.campaigns as Awaited<ReturnType<typeof listCampaigns>>, fromCache: true, cacheAgeMs: hitAgeMs };
    }
    if (isRateLimitActive() && hit) return { data: hit.campaigns as Awaited<ReturnType<typeof listCampaigns>>, fromCache: true, cacheAgeMs: hitAgeMs };
    try {
      const campaigns = await listCampaigns({ since: s, until: u, adAccountId });
      await query(
        `INSERT INTO meta_campaigns_cache (account_id, period_since, period_until, campaigns, fetched_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (account_id, period_since, period_until)
         DO UPDATE SET campaigns=$4, fetched_at=NOW()`,
        [accountId, s, u, JSON.stringify(campaigns)]
      ).catch(() => null);
      return { data: campaigns, fromCache: false, cacheAgeMs: 0 };
    } catch (err) {
      if (isRateLimitErr(err) && hit) return { data: hit.campaigns as Awaited<ReturnType<typeof listCampaigns>>, fromCache: true, cacheAgeMs: hitAgeMs };
      throw err;
    }
  }

  // ── Cache-aware getAccountOverview ──────────────────────────────────────────
  async function fetchOverviewCached(adAccountId: string): Promise<CacheResult<Awaited<ReturnType<typeof getAccountOverview>>>> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;
    const cached = await query<{ data: unknown; fetched_at: string }>(
      `SELECT data, fetched_at FROM meta_overview_cache
       WHERE account_id=$1 AND period_since=$2 AND period_until=$3`,
      [accountId, s, u]
    ).catch(() => [] as { data: unknown; fetched_at: string }[]);
    const hit = cached[0];

    const hitAgeMs = hit ? Date.now() - new Date(hit.fetched_at).getTime() : 0;

    if (hit && hitAgeMs < TOOL_CACHE_FRESH_MS) {
      return { data: hit.data as Awaited<ReturnType<typeof getAccountOverview>>, fromCache: true, cacheAgeMs: hitAgeMs };
    }
    if (isRateLimitActive() && hit) return { data: hit.data as Awaited<ReturnType<typeof getAccountOverview>>, fromCache: true, cacheAgeMs: hitAgeMs };
    try {
      const data = await getAccountOverview({ adAccountId, since: s, until: u });
      await query(
        `INSERT INTO meta_overview_cache (account_id, period_since, period_until, data, fetched_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (account_id, period_since, period_until)
         DO UPDATE SET data=$4, fetched_at=NOW()`,
        [accountId, s, u, JSON.stringify(data)]
      ).catch(() => null);
      return { data, fromCache: false, cacheAgeMs: 0 };
    } catch (err) {
      if (isRateLimitErr(err) && hit) return { data: hit.data as Awaited<ReturnType<typeof getAccountOverview>>, fromCache: true, cacheAgeMs: hitAgeMs };
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
      let maxCacheAgeMs = 0;
      let anyFromCache = false;
      for (const acc of accounts) {
        const result = await fetchCampaignsCached(acc.id);
        if (result.fromCache) { anyFromCache = true; maxCacheAgeMs = Math.max(maxCacheAgeMs, result.cacheAgeMs); }
        for (const c of result.data) {
          rows.push(`| ${c.name} (id:${c.id}) | ${c.effective_status} | ${fmt(c.spend)} | ${c.purchases} | ${c.cpa > 0 ? fmt(c.cpa) : "—"} | ${fmt(c.ctr, 2)} |`);
        }
      }
      return rows.join("\n") + buildCacheNote(anyFromCache, maxCacheAgeMs);
    }

    if (name === "get_campaign_daily") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return "campaign_id مطلوب.";
      const result = await fetchInsightsCached(campaign_id);
      const insights = result.data;
      if (!insights.daily || insights.daily.length === 0) return "لا توجد بيانات يومية لهذه الحملة في الفترة المحددة." + buildCacheNote(result.fromCache, result.cacheAgeMs);

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
      return rows.join("\n") + buildCacheNote(result.fromCache, result.cacheAgeMs);
    }

    if (name === "get_account_daily") {
      const rows: string[] = [`## الأداء اليومي للحساب كله (آخر ${days} يوم):\n`];
      rows.push("| التاريخ | الإنفاق (EGP) | الطلبات | CPA (EGP) | النقرات |");
      rows.push("|---------|--------------|---------|-----------|---------|");
      const allDaily: { day: string; spend: number; purchases: number; cpa: number; link_clicks: number }[] = [];
      let maxCacheAgeMs = 0;
      let anyFromCache = false;
      for (const acc of accounts) {
        const result = await fetchOverviewCached(acc.id);
        if (result.fromCache) { anyFromCache = true; maxCacheAgeMs = Math.max(maxCacheAgeMs, result.cacheAgeMs); }
        allDaily.push(...result.data.daily);
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
      return rows.join("\n") + buildCacheNote(anyFromCache, maxCacheAgeMs);
    }

    if (name === "get_adsets") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return "campaign_id مطلوب.";
      const result = await fetchInsightsCached(campaign_id);
      const insights = result.data;
      if (!insights.by_adset || insights.by_adset.length === 0) return "لا توجد بيانات مجموعات إعلانية لهذه الحملة." + buildCacheNote(result.fromCache, result.cacheAgeMs);

      const rows: string[] = [`## المجموعات الإعلانية للحملة (آخر ${days} يوم):\n`];
      rows.push("| المجموعة | الإنفاق (EGP) | الطلبات | CPA (EGP) | نسبة النقر% | التكرار |");
      rows.push("|----------|--------------|---------|-----------|-------------|---------|");
      const sorted = [...insights.by_adset].sort((a, b) => b.spend - a.spend);
      for (const as of sorted) {
        rows.push(`| ${as.label} | ${fmt(as.spend)} | ${as.purchases} | ${as.cpa > 0 ? fmt(as.cpa) : "—"} | ${fmt(as.ctr, 2)} | ${fmt(as.frequency, 2)} |`);
      }
      return rows.join("\n") + buildCacheNote(result.fromCache, result.cacheAgeMs);
    }

    if (name === "get_campaign_status") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return "campaign_id مطلوب.";
      try {
        const details = await getCampaignDetails(campaign_id);
        const statusMap: Record<string, string> = {
          ACTIVE: "نشطة ✅",
          PAUSED: "موقوفة ⏸",
          CAMPAIGN_PAUSED: "موقوفة (بسبب الحملة) ⏸",
          ARCHIVED: "مؤرشفة",
          DELETED: "محذوفة",
        };
        const statusAr = statusMap[details.effective_status] ?? details.effective_status;
        return `## حالة الحملة:\n- الاسم: ${details.name}\n- الحالة: ${statusAr}\n- الحالة الفعلية: ${details.effective_status}`;
      } catch (err) {
        return `خطأ في جلب حالة الحملة: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (name === "get_campaign_budget") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return "campaign_id مطلوب.";
      try {
        const details = await getCampaignDetails(campaign_id);
        const rows = [`## ميزانية الحملة:\n- الاسم: ${details.name}`];
        if (details.daily_budget !== undefined && details.daily_budget > 0) {
          rows.push(`- الميزانية اليومية: ${Math.round(details.daily_budget)} EGP`);
        }
        if (details.lifetime_budget !== undefined && details.lifetime_budget > 0) {
          rows.push(`- الميزانية الإجمالية: ${Math.round(details.lifetime_budget)} EGP`);
        }
        if ((details.daily_budget === undefined || details.daily_budget === 0) &&
            (details.lifetime_budget === undefined || details.lifetime_budget === 0)) {
          rows.push("- الميزانية: غير محددة على مستوى الحملة (محددة على مستوى المجموعات الإعلانية)");
        }
        return rows.join("\n");
      } catch (err) {
        return `خطأ في جلب ميزانية الحملة: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (name === "get_ad_performance") {
      const ad_id = String(args.ad_id ?? "");
      if (!ad_id) return "ad_id مطلوب.";

      // Search all accounts and campaigns for the matching ad in by_ad
      let foundAd: Awaited<ReturnType<typeof getCampaignInsights>>["by_ad"][number] | null = null;
      let foundCampaignName = "";
      let foundCampaignId = "";
      let cacheNote = "";

      outer: for (const acc of accounts) {
        const campaignsResult = await fetchCampaignsCached(acc.id);
        for (const campaign of campaignsResult.data) {
          try {
            const result = await fetchInsightsCached(campaign.id);
            const match = result.data.by_ad.find((ad) => ad.id === ad_id);
            if (match) {
              foundAd = match;
              foundCampaignName = result.data.campaign.name;
              foundCampaignId = result.data.campaign.id;
              cacheNote = buildCacheNote(result.fromCache, result.cacheAgeMs);
              break outer;
            }
          } catch {
            // Skip campaigns that fail to load
          }
        }
      }

      if (!foundAd) {
        return `لم يتم العثور على إعلان بالرقم ${ad_id} في البيانات المتاحة (آخر ${days} يوم). تأكد من صحة الرقم أو جرّب فترة زمنية أطول.`;
      }

      const ad = foundAd;
      const lpvRate = ad.link_clicks > 0 ? (ad.lpv / ad.link_clicks) * 100 : 0;
      const rows = [
        `## أداء الإعلان (آخر ${days} يوم):`,
        `- الاسم: ${ad.label}`,
        `- رقم الإعلان: ${ad.id}`,
        `- الحملة: ${foundCampaignName} (id:${foundCampaignId})`,
        `- الإنفاق: ${fmt(ad.spend)} EGP`,
        `- الظهورات: ${ad.impressions.toLocaleString()}`,
        `- نسبة الجذب (Hook Rate): ${fmt(ad.hookRate, 2)}%`,
        `- نسبة النقر (CTR): ${fmt(ad.ctr, 2)}%`,
        `- نسبة الوصول للصفحة (LPR): ${fmt(lpvRate, 2)}%`,
        `- تكلفة التحويل (CPA): ${ad.cpa > 0 ? fmt(ad.cpa) + " EGP" : "—"}`,
        `- الطلبات: ${ad.purchases}`,
        `- تكلفة الألف ظهور (CPM): ${fmt(ad.cpm, 2)} EGP`,
        `- التكرار: ${fmt(ad.frequency, 2)}`,
      ];
      return rows.join("\n") + cacheNote;
    }

    if (name === "get_adset_status") {
      const adset_id = String(args.adset_id ?? "");
      if (!adset_id) return "adset_id مطلوب.";
      try {
        const details = await getAdsetDetails(adset_id);
        const statusMap: Record<string, string> = {
          ACTIVE: "نشطة ✅",
          PAUSED: "موقوفة ⏸",
          CAMPAIGN_PAUSED: "موقوفة (بسبب الحملة) ⏸",
          ARCHIVED: "مؤرشفة",
          DELETED: "محذوفة",
        };
        const statusAr = statusMap[details.effective_status] ?? details.effective_status;
        const rows = [
          `## حالة المجموعة الإعلانية:`,
          `- الاسم: ${details.name}`,
          `- الحالة: ${statusAr}`,
        ];
        if (details.daily_budget !== undefined && details.daily_budget > 0) {
          rows.push(`- الميزانية اليومية: ${Math.round(details.daily_budget)} EGP`);
        }
        if (details.lifetime_budget !== undefined && details.lifetime_budget > 0) {
          rows.push(`- الميزانية الإجمالية: ${Math.round(details.lifetime_budget)} EGP`);
        }
        return rows.join("\n");
      } catch (err) {
        return `خطأ في جلب حالة المجموعة: ${err instanceof Error ? err.message : String(err)}`;
      }
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
  const isAdmin = req.session?.role === "admin";

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
        tools: (isAdmin ? TOOLS : TOOLS.filter((t) => !WRITE_TOOL_NAMES.has(t.function.name))) as unknown as Parameters<typeof openai.chat.completions.create>[0]["tools"],
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
      const pendingActions: Array<{ tool: string; args: Record<string, unknown>; summary: string }> = [];
      await Promise.all(
        toolCalls.map(async (tc) => {
          const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          const result = await executeTool(tc.function.name, args);
          // Detect write-tool pending confirmation marker
          if (result.startsWith("ACTION_PENDING:")) {
            try {
              const payload = JSON.parse(result.slice("ACTION_PENDING:".length)) as { tool: string; args: Record<string, unknown>; summary: string };
              pendingActions.push(payload);
              builtMessages.push({
                role: "tool",
                content: `في انتظار موافقة المستخدم على: ${payload.summary}`,
                tool_call_id: tc.id,
              });
            } catch {
              builtMessages.push({ role: "tool", content: result, tool_call_id: tc.id });
            }
          } else {
            builtMessages.push({ role: "tool", content: result, tool_call_id: tc.id });
          }
        })
      );

      // Emit any pending actions to the client before the final AI response
      for (const pa of pendingActions) {
        res.write(`data: ${JSON.stringify({ pending_action: pa })}\n\n`);
      }

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
