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
  type CampaignDetails,
  type AdsetDetails,
} from "../lib/meta-api.js";
import { query } from "../lib/db.js";
import { upsertCampaignNameCache } from "../lib/campaign-name-cache.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../lib/logger.js";

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

══════════════════════════════════════
قاعدة الأجنت — الأهم من كل حاجة
══════════════════════════════════════

🚨 دايماً اجلب البيانات الحية أولاً — دي قاعدة لازم تلتزم بها في كل رد:
- لو حد سألك عن أداء أي حملة أو حساب → استدعِ الأداة المناسبة قبل ما تجاوب
- ممنوع تبني إجابة على بيانات قديمة في الـ context لو عندك أداة تجيب البيانات الحالية
- سؤال عن حملات؟ → get_campaigns أولاً
- سؤال عن أداء يومي أو اتجاه؟ → get_campaign_daily أو get_account_daily أولاً
- سؤال عن مجموعات إعلانية؟ → get_adsets أولاً
- سؤال عن إيقاف أو تعديل؟ → اجلب الحالة الحالية أولاً (get_campaign_status / get_adset_status)

📅 قواعد تحديد الفترة الزمنية في الأدوات:
- لو المستخدم طلب "أداء اليوم" → since=today, until=today (نفس التاريخ)
- لو طلب "أداء أمس" → since=yesterday, until=yesterday
- لو طلب "الأسبوع الماضي" أو "الأسبوع اللي فات" → since=7 أيام قبل اليوم، until=أمس
- لو طلب "الشهر الماضي" → since=أول الشهر الفائت، until=آخره
- لو طلب فترة محددة مثل "من 1 مايو لـ 7 مايو" → since=2025-05-01, until=2025-05-07
- لو طلب "آخر أسبوع" → استخدم days=7 أو since/until بحساب اليوم الحالي
- تاريخ اليوم الحقيقي مذكور أعلاه — احسب التواريخ منه دائماً بدقة
- الأولوية: since/until > days — استخدم since/until دائماً لأي طلب تاريخ محدد

المستخدم يشوف على الشاشة الأداة اللي بتتنفذ في الوقت الفعلي — هذا يبني الثقة ويثبت إنك بتعمل تشخيص حقيقي.

🔧 أدوات متاحة لك:
**Meta Ads (فيسبوك/إنستجرام):**
- get_campaigns: قائمة الحملات مع أداءها لأي فترة
- get_campaign_daily: الأداء اليومي لحملة معينة
- get_account_daily: الأداء اليومي للحساب كله
- get_adsets: المجموعات الإعلانية لحملة معينة
- get_ad_performance: أداء إعلان بعينه (نسبة الجذب، نسبة النقر، تكلفة التحويل، الظهورات، الإنفاق) — استخدم قبل التوصية بتغيير أو إيقاف إعلان محدد
- get_ads_in_adset: قائمة مقارنة بكل الإعلانات داخل مجموعة إعلانية محددة مرتّبة بالكفاءة — استخدم قبل التوصية بزيادة إعلان أو إيقاف آخر لتحديد الـ Winner والـ Drain

**Google Ads (جوجل):**
- ga_get_campaigns: قائمة حملات Google Ads مع حالتها وميزانياتها عبر كل الحسابات المرتبطة — استخدم أولاً للحصول على customer_id وcampaign_id
- ga_get_campaign_metrics: أداء حملات جوجل (Clicks، CTR، CPC، Conversions، Cost، ROAS) — استخدم لمقارنة الحملات أو تشخيص الأداء
- ga_get_ad_groups: المجموعات الإعلانية لحساب جوجل مع أداء كل مجموعة
- ga_get_keywords: الكلمات المفتاحية مع Quality Score وCPC الفعلي وأداءها — اكتشف كلمات تستنزف الميزانية أو كلمات ذهبية
- ga_get_search_terms: تقرير مصطلحات البحث الفعلية — اكتشف ما يبحث عنه المستخدمون فعلاً وحدد الكلمات السلبية الضرورية

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

⚠️ مهم جداً: لو عندك adset_id وتريد تقارن الإعلانات داخله لتحديد الأفضل أو اقتراح نقل الميزانية، استخدم get_ads_in_adset أولاً. الأداة بترتّب الإعلانات حسب الكفاءة وتحدد الـ Winner والـ Drain بشكل واضح — لا تبني توصية بنقل الميزانية بدون هذه البيانات.

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
   - قبل update_campaign_budget: استخدم get_campaign_budget مرة واحدة فقط لكل حملة — لا تعيد استدعاءه. بعد الجلب يُخزَّن تلقائياً
   - قبل pause_adset أو enable_adset أو update_adset_budget: استخدم get_adset_status مرة واحدة فقط
   - ⚠️ حملات ABO: لو get_campaign_budget أرجع "النوع: ABO" فالميزانية على المجموعات الإعلانية. الرد يتضمن adset_id وميزانية كل مجموعة تلقائياً — استخدم update_adset_budget مباشرةً بدون أي استدعاء إضافي
٢. اجلب بيانات الأداء للتشخيص (get_campaign_daily أو get_adsets)
ممنوع تقترح إيقاف أو تعديل بدون تشخيص مبني على بيانات حقيقية وحالة حالية موثّقة.

الأدوات المتاحة — تعديل:
- pause_campaign(campaign_id, name) — إيقاف حملة مؤقتاً
- enable_campaign(campaign_id, name) — تشغيل حملة موقوفة
- update_campaign_budget(campaign_id, name, budget_amount, budget_type) — تعديل الميزانية (budget_type: "daily" أو "lifetime")
- pause_adset(adset_id, name) — إيقاف مجموعة إعلانية
- enable_adset(adset_id, name) — تشغيل مجموعة إعلانية
- update_adset_budget(adset_id, name, budget_amount) — تعديل ميزانية مجموعة
- duplicate_adset(adset_id, name) — نسخ مجموعة إعلانية

الأدوات المتاحة — إنشاء:
- create_campaign(account_id, name, objective, daily_budget, status?) — إنشاء حملة جديدة
  - استخدم get_campaigns أولاً للحصول على account_id من الحسابات المرتبطة
  - objectives: OUTCOME_SALES | OUTCOME_LEADS | OUTCOME_TRAFFIC | OUTCOME_AWARENESS | OUTCOME_ENGAGEMENT
  - status: PAUSED (افتراضي — للمراجعة) أو ACTIVE (تشغيل فوري)
- create_adset(account_id, campaign_id, name, optimization_goal, billing_event, daily_budget?, targeting?) — إنشاء مجموعة إعلانية
  - optimization_goal: OFFSITE_CONVERSIONS | LEAD_GENERATION | LINK_CLICKS | LANDING_PAGE_VIEWS | THRUPLAY | REACH
  - billing_event: IMPRESSIONS (الأشيع) | LINK_CLICKS
  - targeting مثال: {geo_locations: {countries: ["EG"]}, age_min: 25, age_max: 45}
- duplicate_campaign(campaign_id, name, name_suffix?, new_daily_budget?, new_status?) — نسخ حملة كاملة مع مجموعاتها وإعلاناتها
  - الأسرع لإنشاء نسخة موسمية أو تجريبية — وفّر الوقت بدل إنشاء من الصفر
  - new_status: PAUSED (افتراضي للمراجعة) أو ACTIVE

قواعد الإنشاء:
١. اجمع كل المعلومات من المستخدم قبل استدعاء أداة الإنشاء (الاسم، الهدف، الميزانية، الاستهداف)
٢. استخدم get_campaigns أولاً للحصول على account_id من الحسابات المرتبطة
٣. للنسخ: duplicate_campaign أسرع وأأمن من الإنشاء من الصفر
٤. دايماً اقترح status=PAUSED للمراجعة قبل التشغيل — ما لم يطلب المستخدم صراحةً التشغيل الفوري

مهم: هذه الأدوات لا تنفذ فوراً — ستظهر للمستخدم طلب تأكيد قبل التنفيذ.
بعد استدعاء الأداة قل "في انتظار موافقتك" — لا تقل "تم التنفيذ".

⚠️ حالة خاصة — NO_OP (لا يوجد تغيير مطلوب):
لو الأداة رجعت رداً يبدأ بـ NO_OP: ، معناه إن الحالة الحالية هي نفس القيمة المقترحة.
في هذه الحالة لازم:
١. لا تقترح أي تأكيد ولا تقول "في انتظار موافقتك".
٢. أخبر المستخدم بشكل مباشر إن الوضع مش محتاج تغيير — مثلاً: "هذه الحملة بالفعل موقوفة، لا داعي لأي إجراء." أو "الميزانية الحالية هي نفس القيمة المطلوبة، لا يوجد تغيير مطلوب."

══════════════════════════════════════
الجزء 7 — ذاكرة الميديا باير وتقييم القرارات السابقة
══════════════════════════════════════

أنت مش بس تشخّص — أنت ميديا باير متابع لهذه الحملة من الأول.
في الـ context هيجيلك قسمين إضافيين لما يكونوا متاحين:

📋 ذاكرة المحادثات السابقة:
- دي ملخصات محادثاتك السابقة مع هذه الحملة
- استخدمها تفهم السياق والمشاكل اللي اتناقشت قبل كده
- لو في مشكلة اتذكرت سابقاً وبتكرر، نبّه المستخدم: "كنا اتكلمنا في نفس الموضوع ده قبل كده"

⚡ تاريخ الإجراءات المنفّذة:
- دي قرارات حقيقية اتنفذت على الحملة (إيقاف، تشغيل، تعديل ميزانية، إلخ)
- لازم تقيّم تأثير كل قرار على الأداء الحالي:
  → لو الحملة اتوقفت من 3 أيام: "الحملة كانت واقفة من 3 أيام — الأرقام دي بعد إعادة التشغيل طبيعي تكون غير مستقرة"
  → لو الميزانية اترفعت: "الميزانية اترفعت من X لـ Y من N أيام — قارن الأداء قبل وبعد"
  → لو في إجراءات متكررة على نفس الحملة: "لاحظت إن الحملة دي اتوقفت وشغّلت أكتر من مرة — ده ممكن يأثر على تعلّم الخوارزمية"

مهم: استخدم هذا التاريخ بشكل استباقي — لا تنتظر المستخدم يسأل، بل ادمجه في التشخيص تلقائياً لما يكون ذا صلة.

══════════════════════════════════════
الجزء 8 — قواعد التنسيق البصري (إلزامي)
══════════════════════════════════════

المنصة تدعم Markdown كامل + رسوم بيانية تفاعلية. استخدمها دائماً.

**📊 متى تستخدم الجدول:**
- مقارنة حملتين أو أكثر → جدول إلزامي
- عرض أرقام متعددة لنفس الحملة (CPA + CTR + CR + إنفاق) → جدول
- ترتيب الحملات من الأكفأ للأضعف → جدول
- تقسيم المجموعات الإعلانية → جدول

مثال جدول مقارنة:
| الحملة | الإنفاق | أوردرات | CPA | التوصية |
|--------|---------|---------|-----|---------|
| حملة أ | ١٢٠٠ ج | ٤٥ | ٢٧ ج | ✅ Scale |
| حملة ب | ٨٠٠ ج | ١٢ | ٦٧ ج | ❌ أوقف |

**📈 متى تستخدم الرسم البياني (بلوك json chart):**
- سألك عن اتجاه أو تطور خلال أيام (الإنفاق اليومي، CPA يومي) → Line Chart
- مقارنة بين حملات في رقم واحد (مين أكثر إنفاقاً؟) → Bar Chart
- أداء المجموعات الإعلانية مقارنةً → Bar Chart

**🚀 Bulk Action Panel (للتنفيذ الجماعي):**
لما تقترح إجراءات متعددة (زيادة ميزانية 3 حملات، إيقاف 2، تقليل ميزانية 1) — لازم تُخرج كود bulk_action بالشكل التالي بالضبط (لا تغيّر أي مفتاح):
⚠️ مهم جداً: اكتب دائماً \`\`\`bulk_action وليس \`\`\`json — الواجهة تعتمد على الكلمة bulk_action لتحويل الكود لأزرار تنفيذ. إذا استخدمت \`\`\`json ستظهر النصوص خاماً بدون أزرار.

\`\`\`bulk_action
{
  "title": "اقتراحات Scale اليوم",
  "actions": [
    {
      "type": "update_campaign_budget",
      "campaignId": "123456789",
      "name": "اسم الحملة",
      "label": "زيادة 20%",
      "currentBudget": 500,
      "newBudget": 600,
      "budgetType": "daily",
      "reason": "CPA ممتاز واليوم 5 مبيعات"
    },
    {
      "type": "pause_campaign",
      "campaignId": "987654321",
      "name": "حملة أخرى",
      "label": "إيقاف",
      "reason": "CPA ضعيف والتاريخ سيء"
    }
  ]
}
\`\`\`

أنواع الإجراءات المتاحة (Meta): update_campaign_budget | update_adset_budget | pause_campaign | enable_campaign | pause_adset | enable_adset
- لـ update_campaign_budget: campaignId + currentBudget + newBudget + budgetType ("daily" أو "lifetime") إلزامي
- لـ update_adset_budget: adsetId + currentBudget + newBudget إلزامي
- لـ pause/enable: campaignId أو adsetId حسب النوع
- label: وصف قصير للإجراء (زيادة 20%، إيقاف، تقليل 30%، إلخ)
- reason: السبب المبني على البيانات (اختياري لكن مفيد جداً)
- الـ newBudget لازم يكون القيمة المطلقة المحسوبة، مش نسبة مئوية
- بعد كود bulk_action لا تكتب "في انتظار موافقتك" — الواجهة تعالج الموافقة تلقائياً
- لا تستدعي get_campaign_budget أو get_campaign_status أثناء التحليل الجماعي — استخدم بيانات الـ context الموجودة مباشرةً واحسب newBudget منها. لا تنتظر بيانات إضافية لتولّد الـ bulk_action

**الإجراء الفردي المدمج (Inline per-campaign):**
لما تحلّل كل حملة وتقترح إجراء، أخرج bulk_action مع "compact": true فوراً بعد تحليل تلك الحملة مباشرةً — لا تنتظر تحليل كل الحملات. شكل الإجراء الفردي:
\`\`\`bulk_action
{"compact": true, "actions": [{"type": "update_campaign_budget", "campaignId": "123", "name": "اسم الحملة", "label": "زيادة 20%", "currentBudget": 500, "newBudget": 600, "budgetType": "daily"}]}
\`\`\`
في نهاية الرد: أخرج bulk_action جماعي بدون compact يضم كل الإجراءات المقترحة.

شكل الـ JSON المطلوب بالضبط (لا تغيّر أي مفتاح):
\`\`\`json chart
{
  "type": "bar",
  "title": "مقارنة الإنفاق بالحملات",
  "xKey": "name",
  "unit": " ج",
  "series": [{"key": "spend", "label": "الإنفاق"}],
  "data": [
    {"name": "حملة الأكياس", "spend": 1200},
    {"name": "حملة الفوم", "spend": 800}
  ]
}
\`\`\`

لـ Line Chart (اتجاه يومي):
\`\`\`json chart
{
  "type": "line",
  "title": "تطور CPA يومياً",
  "xKey": "date",
  "unit": " ج",
  "series": [{"key": "cpa", "label": "تكلفة التحويل"}],
  "data": [
    {"date": "١ مايو", "cpa": 35},
    {"date": "٢ مايو", "cpa": 28},
    {"date": "٣ مايو", "cpa": 22}
  ]
}
\`\`\`

**📝 متى تستخدم العناوين (###):**
- التقرير بيتكلم عن أكثر من موضوع → افصل بعناوين
- مثال: ### ملخص الأداء / ### الحملات للـ Scale / ### الحملات للإيقاف

**قاعدة ذهبية:**
لو السؤال عن مقارنة أو اتجاه → جدول أو رسم بياني أولاً، ثم التحليل.
لو السؤال عن تشخيص حملة واحدة → نص مباشر مع عناوين لتقسيم الأجزاء.`;

// ── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_campaigns",
      description: "جيب قائمة كل الحملات الإعلانية مع أداءها (إنفاق، طلبات، CPA، CTR، الحالة) لفترة زمنية محددة. استخدم لما تحتاج مقارنة الحملات أو معرفة الأرقام الإجمالية. يمكنك تحديد فترة بالضبط باستخدام since وuntil (YYYY-MM-DD) أو استخدام days للرجوع للخلف من اليوم.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "عدد الأيام للرجوع للخلف من اليوم. افتراضي: 30. تجاهل إذا استخدمت since/until." },
          since: { type: "string", description: "تاريخ البداية بصيغة YYYY-MM-DD (مثال: 2025-05-01). استخدم لفترات محددة أو عند سؤال عن يوم معين." },
          until: { type: "string", description: "تاريخ النهاية بصيغة YYYY-MM-DD (مثال: 2025-05-07). يجب استخدامه مع since." },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_campaign_daily",
      description: "جيب الأداء اليومي لحملة معينة يوم بيوم (إنفاق، طلبات، CPA، نسبة النقر، ظهورات، نسبة الجذب). استخدم لما تحتاج تحليل تريند حملة معينة أو مقارنة أيام. يمكنك تحديد since/until لفترة بالضبط.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة (id)" },
          days: { type: "number", description: "عدد الأيام للرجوع للخلف من اليوم. افتراضي: 14. تجاهل إذا استخدمت since/until." },
          since: { type: "string", description: "تاريخ البداية بصيغة YYYY-MM-DD. استخدم لفترات محددة." },
          until: { type: "string", description: "تاريخ النهاية بصيغة YYYY-MM-DD. يجب استخدامه مع since." },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_account_daily",
      description: "جيب الأداء اليومي للحساب كله مجتمعاً يوم بيوم (إنفاق، طلبات، CPA). استخدم لمقارنة أيام أو تحليل اتجاه الأداء العام. يمكنك تحديد since/until لفترة بالضبط أو يوم واحد (since=until=اليوم المطلوب).",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "عدد الأيام للرجوع للخلف من اليوم. افتراضي: 14. تجاهل إذا استخدمت since/until." },
          since: { type: "string", description: "تاريخ البداية بصيغة YYYY-MM-DD. لبيانات يوم واحد اضبط since=until=ذلك اليوم." },
          until: { type: "string", description: "تاريخ النهاية بصيغة YYYY-MM-DD. يجب استخدامه مع since." },
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
      name: "get_ads_in_adset",
      description: "جيب قائمة مقارنة بكل الإعلانات داخل مجموعة إعلانية (Ad Set) محددة — مرتّبة حسب الكفاءة (CPA، نسبة الجذب، نسبة النقر، الإنفاق). استخدم قبل التوصية بزيادة إعلان معين أو إيقاف آخر لتحديد الـ Winner والـ Drain بشكل دقيق.",
      parameters: {
        type: "object",
        properties: {
          adset_id: { type: "string", description: "رقم المجموعة الإعلانية (id)" },
          days: { type: "number", description: "عدد الأيام للرجوع للخلف. افتراضي: 7" },
        },
        required: ["adset_id"],
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
  {
    type: "function" as const,
    function: {
      name: "create_campaign",
      description: "اقتراح إنشاء حملة إعلانية جديدة على Meta. استخدم get_campaigns أولاً للحصول على account_id. سيظهر طلب تأكيد للمستخدم قبل الإنشاء.",
      parameters: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "رقم حساب الإعلانات (act_XXXXXXXXX) — اجلبه من get_campaigns" },
          name: { type: "string", description: "اسم الحملة الجديدة" },
          objective: {
            type: "string",
            enum: ["OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_APP_PROMOTION"],
            description: "هدف الحملة: OUTCOME_SALES (مبيعات)، OUTCOME_LEADS (عملاء محتملين)، OUTCOME_TRAFFIC (زيارات)، OUTCOME_AWARENESS (وعي)، OUTCOME_ENGAGEMENT (تفاعل)",
          },
          daily_budget: { type: "number", description: "الميزانية اليومية بالـ EGP" },
          status: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "حالة الحملة عند الإنشاء — PAUSED (موقوفة، للمراجعة) أو ACTIVE (نشطة مباشرةً)" },
          special_ad_categories: { type: "string", description: "فئات الإعلانات الخاصة — اتركها فارغة إذا لم تكن إعلانات عقارية أو ائتمانية أو سياسية. افتراضي: NONE" },
        },
        required: ["account_id", "name", "objective", "daily_budget"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_adset",
      description: "اقتراح إنشاء مجموعة إعلانية جديدة داخل حملة موجودة. سيظهر طلب تأكيد للمستخدم قبل الإنشاء.",
      parameters: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "رقم حساب الإعلانات (act_XXXXXXXXX)" },
          campaign_id: { type: "string", description: "رقم الحملة (id) التي ستنتمي إليها المجموعة" },
          name: { type: "string", description: "اسم المجموعة الإعلانية الجديدة" },
          optimization_goal: {
            type: "string",
            enum: ["OFFSITE_CONVERSIONS", "LEAD_GENERATION", "REACH", "IMPRESSIONS", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "THRUPLAY", "VALUE"],
            description: "هدف التحسين: OFFSITE_CONVERSIONS (تحويلات)، LEAD_GENERATION (ليدز)، LINK_CLICKS (نقرات)، LANDING_PAGE_VIEWS (زيارات الصفحة)",
          },
          billing_event: { type: "string", enum: ["IMPRESSIONS", "LINK_CLICKS"], description: "حدث الفوترة: IMPRESSIONS (دفع لكل 1000 ظهور — الأشيع) أو LINK_CLICKS" },
          daily_budget: { type: "number", description: "الميزانية اليومية بالـ EGP (للمجموعة إذا كانت الحملة بدون CBO)" },
          targeting: {
            type: "object",
            description: "إعدادات الاستهداف — مثال: {geo_locations: {countries: [\"EG\"]}, age_min: 25, age_max: 45, genders: [1,2]}",
            properties: {
              geo_locations: { type: "object", description: "{countries: [\"EG\", \"SA\", ...]}" },
              age_min: { type: "number" },
              age_max: { type: "number" },
              genders: { type: "array", items: { type: "number" }, description: "[1] ذكور، [2] إناث، [1,2] كلاهما" },
            },
          },
          status: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "حالة المجموعة عند الإنشاء" },
        },
        required: ["account_id", "campaign_id", "name", "optimization_goal", "billing_event"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "duplicate_campaign",
      description: "اقتراح نسخ حملة إعلانية كاملة (مع مجموعاتها وإعلاناتها). الأسرع لإنشاء نسخة تجريبية أو موسمية. سيظهر طلب تأكيد للمستخدم.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "رقم الحملة الأصلية المراد نسخها (id)" },
          name: { type: "string", description: "اسم الحملة الأصلية (للعرض في التأكيد)" },
          name_suffix: { type: "string", description: "لاحقة تُضاف لاسم النسخة — مثال: ' - نسخة' أو ' - رمضان 2026'" },
          new_daily_budget: { type: "number", description: "ميزانية يومية جديدة للنسخة بالـ EGP (اختياري — يبقى نفس الأصلية إذا لم تُحدَّد)" },
          new_status: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "حالة النسخة الجديدة — افتراضي PAUSED للمراجعة قبل التشغيل" },
        },
        required: ["campaign_id"],
      },
    },
  },
  // ── Google Ads tools ────────────────────────────────────────────────────────
  {
    type: "function" as const,
    function: {
      name: "ga_get_campaigns",
      description: "جيب قائمة كل حملات Google Ads مع حالتها وميزانياتها عبر كل الحسابات المرتبطة. استخدم أولاً للحصول على customer_id وcampaign_id.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "عدد الأيام للرجوع للخلف (7، 14، 30). افتراضي: 30" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_get_campaign_metrics",
      description: "جيب أداء حملات Google Ads (Clicks، Impressions، CTR، CPC، Conversions، Cost، ROAS). استخدم لتحليل الأداء ومقارنة الحملات.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل (customer_id) من ga_get_campaigns. اتركه فارغاً لكل الحسابات." },
          campaign_id: { type: "string", description: "رقم الحملة (اختياري — بدونه يجيب كل الحملات)" },
          days: { type: "number", description: "عدد الأيام: 7، 14، 30، 90. افتراضي: 7" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_get_ad_groups",
      description: "جيب المجموعات الإعلانية (Ad Groups) لحساب Google Ads مع أداء كل مجموعة. استخدم لتحليل الأداء على مستوى المجموعة.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل (customer_id) — إلزامي" },
          campaign_id: { type: "string", description: "رقم الحملة (اختياري — بدونه يجيب كل المجموعات)" },
          days: { type: "number", description: "عدد الأيام. افتراضي: 7" },
        },
        required: ["customer_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_get_keywords",
      description: "جيب الكلمات المفتاحية مع Quality Score وCPC الفعلي وأداءها. استخدم لاكتشاف كلمات تستنزف الميزانية أو كلمات ذهبية تستحق زيادة الـ bid.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل (customer_id) — إلزامي" },
          ad_group_id: { type: "string", description: "رقم المجموعة الإعلانية (اختياري)" },
          days: { type: "number", description: "عدد الأيام. افتراضي: 7" },
        },
        required: ["customer_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_get_search_terms",
      description: "جيب تقرير مصطلحات البحث الفعلية — ما يبحث عنه المستخدمون فعلاً. استخدم لاكتشاف كلمات سلبية ضرورية أو فرص كلمات جديدة.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل (customer_id). اتركه فارغاً لكل الحسابات." },
          days: { type: "number", description: "عدد الأيام. افتراضي: 30" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_pause_campaign",
      description: "اقتراح إيقاف مؤقت لحملة Google Ads. استخدم بعد تشخيص أداءها. سيظهر طلب تأكيد للمستخدم.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل" },
          campaign_id: { type: "string", description: "رقم الحملة" },
          name: { type: "string", description: "اسم الحملة للعرض في التأكيد" },
        },
        required: ["customer_id", "campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_enable_campaign",
      description: "اقتراح تشغيل حملة Google Ads موقوفة. سيظهر طلب تأكيد.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل" },
          campaign_id: { type: "string", description: "رقم الحملة" },
          name: { type: "string", description: "اسم الحملة" },
        },
        required: ["customer_id", "campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_update_campaign_budget",
      description: "اقتراح تعديل الميزانية اليومية لحملة Google Ads. الميزانية بالـ EGP. سيظهر طلب تأكيد.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل" },
          campaign_id: { type: "string", description: "رقم الحملة" },
          name: { type: "string", description: "اسم الحملة" },
          budget_amount: { type: "number", description: "الميزانية اليومية الجديدة بالـ EGP" },
        },
        required: ["customer_id", "campaign_id", "budget_amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_update_keyword_bid",
      description: "اقتراح تعديل سعر المزايدة (Max CPC) لكلمة مفتاحية في Google Ads. الـ bid بالـ EGP. سيظهر طلب تأكيد.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل" },
          ad_group_id: { type: "string", description: "رقم المجموعة الإعلانية" },
          criterion_ids: { type: "array", items: { type: "string" }, description: "أرقام الكلمات المفتاحية (criterion IDs)" },
          cpc_bid_egp: { type: "number", description: "الـ Max CPC الجديد بالـ EGP" },
          name: { type: "string", description: "وصف للعرض في التأكيد" },
        },
        required: ["customer_id", "ad_group_id", "criterion_ids", "cpc_bid_egp"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_pause_keyword",
      description: "اقتراح إيقاف كلمة مفتاحية في Google Ads. سيظهر طلب تأكيد.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل" },
          ad_group_id: { type: "string", description: "رقم المجموعة الإعلانية" },
          criterion_ids: { type: "array", items: { type: "string" }, description: "أرقام الكلمات المفتاحية" },
          name: { type: "string", description: "وصف الكلمة للعرض في التأكيد" },
        },
        required: ["customer_id", "ad_group_id", "criterion_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ga_enable_keyword",
      description: "اقتراح تشغيل كلمة مفتاحية موقوفة في Google Ads. سيظهر طلب تأكيد.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "رقم العميل" },
          ad_group_id: { type: "string", description: "رقم المجموعة الإعلانية" },
          criterion_ids: { type: "array", items: { type: "string" }, description: "أرقام الكلمات المفتاحية" },
          name: { type: "string", description: "وصف الكلمة" },
        },
        required: ["customer_id", "ad_group_id", "criterion_ids"],
      },
    },
  },
];

// ── Arabic label for each read tool (used in tool_call_label SSE events) ─────
function getToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "get_campaigns":       return "جلب قائمة الحملات الإعلانية…";
    case "get_campaign_daily":  return `جلب الأداء اليومي للحملة ${String(args.campaign_id ?? "")}…`;
    case "get_account_daily":   return "جلب الأداء اليومي للحساب…";
    case "get_adsets":          return `جلب المجموعات الإعلانية للحملة ${String(args.campaign_id ?? "")}…`;
    case "get_campaign_status": return `جلب حالة الحملة ${String(args.campaign_id ?? "")}…`;
    case "get_campaign_budget": return `جلب ميزانية الحملة ${String(args.campaign_id ?? "")}…`;
    case "get_adset_status":    return `جلب حالة المجموعة الإعلانية ${String(args.adset_id ?? "")}…`;
    case "get_ad_performance":  return `جلب أداء الإعلان ${String(args.ad_id ?? "")}…`;
    case "get_ads_in_adset":         return `جلب الإعلانات داخل المجموعة ${String(args.adset_id ?? "")}…`;
    case "ga_get_campaigns":         return "جلب حملات Google Ads…";
    case "ga_get_campaign_metrics":  return `جلب أداء Google Ads${args.customer_id ? ` (${String(args.customer_id)})` : ""}…`;
    case "ga_get_ad_groups":         return `جلب المجموعات الإعلانية Google Ads…`;
    case "ga_get_keywords":          return `جلب الكلمات المفتاحية Google Ads…`;
    case "ga_get_search_terms":      return "جلب تقرير مصطلحات البحث Google Ads…";
    default:                         return `جلب البيانات (${name})…`;
  }
}

// ── Write tool names (handled separately — return ACTION_PENDING marker) ─────
const WRITE_TOOL_NAMES = new Set([
  "pause_campaign",
  "enable_campaign",
  "update_campaign_budget",
  "pause_adset",
  "enable_adset",
  "update_adset_budget",
  "duplicate_adset",
  "create_campaign",
  "create_adset",
  "duplicate_campaign",
  // Google Ads write tools
  "ga_pause_campaign",
  "ga_enable_campaign",
  "ga_update_campaign_budget",
  "ga_update_keyword_bid",
  "ga_pause_keyword",
  "ga_enable_keyword",
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

// 0 — AI tools always fetch live data directly from Meta (no cache)
const TOOL_CACHE_FRESH_MS = 0;
// Always show cache note since AI always fetches fresh
const CACHE_NOTE_THRESHOLD_MS = 0;
// Details (status/budget) — cache for 10 minutes to avoid repeated Pipeboard calls
// in the same conversation (resolveWriteToolDetails reuses what executeTool already fetched)
const DETAILS_CACHE_FRESH_MS = 10 * 60 * 1000;

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

// ── Cache-aware getCampaignDetails ──────────────────────────────────────────
async function fetchCampaignDetailsCached(campaign_id: string): Promise<CampaignDetails> {
  const cached = await query<{ data: unknown; fetched_at: string }>(
    `SELECT data, fetched_at FROM meta_campaign_details_cache WHERE campaign_id=$1`,
    [campaign_id]
  ).catch(() => [] as { data: unknown; fetched_at: string }[]);
  const hit = cached[0];

  if (hit) {
    const ageMs = Date.now() - new Date(hit.fetched_at).getTime();
    if (ageMs < DETAILS_CACHE_FRESH_MS) {
      return hit.data as CampaignDetails;
    }
    if (isRateLimitActive()) {
      return hit.data as CampaignDetails;
    }
  }

  try {
    const data = await getCampaignDetails(campaign_id);
    await query(
      `INSERT INTO meta_campaign_details_cache (campaign_id, data, fetched_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (campaign_id) DO UPDATE SET data=$2, fetched_at=NOW()`,
      [campaign_id, JSON.stringify(data)]
    ).catch(() => null);
    return data;
  } catch (err) {
    if (isRateLimitErr(err) && hit) return hit.data as CampaignDetails;
    throw err;
  }
}

// ── Cache-aware getAdsetDetails ─────────────────────────────────────────────
async function fetchAdsetDetailsCached(adset_id: string): Promise<AdsetDetails> {
  const cached = await query<{ data: unknown; fetched_at: string }>(
    `SELECT data, fetched_at FROM meta_adset_details_cache WHERE adset_id=$1`,
    [adset_id]
  ).catch(() => [] as { data: unknown; fetched_at: string }[]);
  const hit = cached[0];

  if (hit) {
    const ageMs = Date.now() - new Date(hit.fetched_at).getTime();
    if (ageMs < DETAILS_CACHE_FRESH_MS) {
      return hit.data as AdsetDetails;
    }
    if (isRateLimitActive()) {
      return hit.data as AdsetDetails;
    }
  }

  try {
    const data = await getAdsetDetails(adset_id);
    await query(
      `INSERT INTO meta_adset_details_cache (adset_id, data, fetched_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (adset_id) DO UPDATE SET data=$2, fetched_at=NOW()`,
      [adset_id, JSON.stringify(data)]
    ).catch(() => null);
    return data;
  } catch (err) {
    if (isRateLimitErr(err) && hit) return hit.data as AdsetDetails;
    throw err;
  }
}

// ── Shared status label helper ────────────────────────────────────────────────
function statusLabel(s: string): string {
  if (s === "ACTIVE") return "نشطة ✅";
  if (s === "PAUSED" || s === "CAMPAIGN_PAUSED") return "موقوفة ⏸";
  return s;
}

// ── Build optimistic pending-action payload from args alone (no API calls) ───
// Gives the frontend enough info to show the card immediately while details load.
function buildOptimisticPendingAction(name: string, args: Record<string, unknown>): {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  proposedValue?: string;
} {
  const label = String(args.name ?? args.campaign_id ?? args.adset_id ?? "");
  switch (name) {
    case "pause_campaign":
      return { tool: name, args, summary: `إيقاف مؤقت للحملة "${label}"`, proposedValue: "موقوفة ⏸" };
    case "enable_campaign":
      return { tool: name, args, summary: `تشغيل الحملة "${label}"`, proposedValue: "نشطة ✅" };
    case "update_campaign_budget": {
      const budgetType = args.budget_type === "lifetime" ? "إجمالية" : "يومية";
      const proposed = Math.round(Number(args.budget_amount));
      return {
        tool: name, args,
        summary: `تعديل ميزانية الحملة "${label}" إلى ${proposed} EGP (${budgetType})`,
        proposedValue: `${proposed} EGP (${budgetType})`,
      };
    }
    case "pause_adset":
      return { tool: name, args, summary: `إيقاف مؤقت للمجموعة الإعلانية "${label}"`, proposedValue: "موقوفة ⏸" };
    case "enable_adset":
      return { tool: name, args, summary: `تشغيل المجموعة الإعلانية "${label}"`, proposedValue: "نشطة ✅" };
    case "update_adset_budget": {
      const proposed = Math.round(Number(args.budget_amount));
      return {
        tool: name, args,
        summary: `تعديل ميزانية المجموعة "${label}" إلى ${proposed} EGP`,
        proposedValue: `${proposed} EGP`,
      };
    }
    case "duplicate_adset":
      return { tool: name, args, summary: `نسخ المجموعة الإعلانية "${label}"` };
    case "create_campaign": {
      const obj: Record<string, string> = {
        OUTCOME_SALES: "مبيعات", OUTCOME_LEADS: "عملاء محتملين",
        OUTCOME_TRAFFIC: "زيارات", OUTCOME_AWARENESS: "وعي", OUTCOME_ENGAGEMENT: "تفاعل", OUTCOME_APP_PROMOTION: "تطبيق",
      };
      const objAr = obj[String(args.objective ?? "")] ?? String(args.objective ?? "");
      const budget = Math.round(Number(args.daily_budget ?? 0));
      const statusAr = args.status === "ACTIVE" ? "نشطة مباشرةً" : "موقوفة للمراجعة";
      return {
        tool: name, args,
        summary: `إنشاء حملة "${String(args.name ?? "")}" — هدف: ${objAr} — ميزانية يومية: ${budget} EGP — الحالة: ${statusAr}`,
        proposedValue: `حملة جديدة — ${objAr}`,
      };
    }
    case "create_adset": {
      const campaign_id = String(args.campaign_id ?? "");
      return {
        tool: name, args,
        summary: `إنشاء مجموعة إعلانية "${String(args.name ?? "")}" داخل حملة ${campaign_id}`,
        proposedValue: "مجموعة إعلانية جديدة",
      };
    }
    case "duplicate_campaign": {
      const suffix = args.name_suffix ? ` (${String(args.name_suffix)})` : "";
      const budget = args.new_daily_budget ? ` — ميزانية: ${Math.round(Number(args.new_daily_budget))} EGP` : "";
      return {
        tool: name, args,
        summary: `نسخ الحملة "${label}"${suffix}${budget}`,
        proposedValue: `نسخة جديدة من "${label}"`,
      };
    }
    // ── Google Ads write tools ────────────────────────────────────────────────
    case "ga_pause_campaign":
      return { tool: name, args, summary: `⏸ إيقاف حملة Google Ads "${label}"`, proposedValue: "موقوفة ⏸" };
    case "ga_enable_campaign":
      return { tool: name, args, summary: `▶️ تشغيل حملة Google Ads "${label}"`, proposedValue: "نشطة ✅" };
    case "ga_update_campaign_budget": {
      const proposed = Math.round(Number(args.budget_amount ?? 0));
      return {
        tool: name, args,
        summary: `💰 تعديل ميزانية Google Ads "${label}" إلى ${proposed} EGP/يوم`,
        proposedValue: `${proposed} EGP`,
      };
    }
    case "ga_update_keyword_bid": {
      const bid = Math.round(Number(args.cpc_bid_egp ?? 0));
      return {
        tool: name, args,
        summary: `🎯 تعديل Max CPC "${label}" إلى ${bid} EGP`,
        proposedValue: `${bid} EGP CPC`,
      };
    }
    case "ga_pause_keyword":
      return { tool: name, args, summary: `⏸ إيقاف كلمة مفتاحية "${label}"`, proposedValue: "موقوفة ⏸" };
    case "ga_enable_keyword":
      return { tool: name, args, summary: `▶️ تشغيل كلمة مفتاحية "${label}"`, proposedValue: "نشطة ✅" };
    default:
      return { tool: name, args, summary: label };
  }
}

// ── Resolve write-tool details (cache → Meta API) and return field updates ───
// Returns a partial update to merge into the optimistic pending action.
// Sets currentValue = proposedValue when it detects a no-op so the frontend
// naturally renders the "already in that state" UI via its existing isSameState check.

export interface LastIntervention {
  toolName: string;
  executedBy: string;
  executedAt: string;
  hoursAgo: number;
}

interface WriteToolResolved {
  currentValue?: string;
  proposedValue?: string;
  summary?: string;
  lastIntervention?: LastIntervention;
}

/** Looks up the most recent successful (non-no-op) action on this entity
 *  from pipeboard_actions. Returns undefined if no history or query fails. */
async function getLastIntervention(
  entityId: string,
  field: "campaign_id" | "adset_id",
): Promise<LastIntervention | undefined> {
  try {
    const rows = await query<{
      tool_name: string;
      executed_by: string;
      executed_at: string;
    }>(
      `SELECT tool_name, executed_by, executed_at
       FROM pipeboard_actions
       WHERE args->>'${field}' = $1
         AND success = TRUE
         AND is_no_op = FALSE
         AND executed_at >= NOW() - INTERVAL '60 days'
       ORDER BY executed_at DESC
       LIMIT 1`,
      [entityId]
    );
    if (!rows[0]) return undefined;
    const r = rows[0];
    const hoursAgo = Math.round((Date.now() - new Date(r.executed_at).getTime()) / 3_600_000);
    return { toolName: r.tool_name, executedBy: r.executed_by, executedAt: r.executed_at, hoursAgo };
  } catch {
    return undefined;
  }
}

async function resolveWriteToolDetails(name: string, args: Record<string, unknown>): Promise<WriteToolResolved> {
  if (name === "pause_campaign") {
    const campaignId = String(args.campaign_id);
    const [details, lastIntervention] = await Promise.all([
      fetchCampaignDetailsCached(campaignId),
      getLastIntervention(campaignId, "campaign_id"),
    ]);
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `إيقاف مؤقت للحملة "${details.name}"` : undefined;
    if (currentValue === "موقوفة ⏸") return { currentValue, proposedValue: "موقوفة ⏸", summary, lastIntervention };
    return { currentValue, summary, lastIntervention };
  }

  if (name === "enable_campaign") {
    const campaignId = String(args.campaign_id);
    const [details, lastIntervention] = await Promise.all([
      fetchCampaignDetailsCached(campaignId),
      getLastIntervention(campaignId, "campaign_id"),
    ]);
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `تشغيل الحملة "${details.name}"` : undefined;
    if (currentValue === "نشطة ✅") return { currentValue, proposedValue: "نشطة ✅", summary, lastIntervention };
    return { currentValue, summary, lastIntervention };
  }

  if (name === "update_campaign_budget") {
    const campaignId = String(args.campaign_id);
    const budgetType = args.budget_type === "lifetime" ? "إجمالية" : "يومية";
    const proposedBudget = Number(args.budget_amount);
    const [details, lastIntervention] = await Promise.all([
      fetchCampaignDetailsCached(campaignId),
      getLastIntervention(campaignId, "campaign_id"),
    ]);
    const summary = details.name
      ? `تعديل ميزانية الحملة "${details.name}" إلى ${Math.round(proposedBudget)} EGP (${budgetType})`
      : undefined;
    const curBudget = args.budget_type === "lifetime" ? details.lifetime_budget : details.daily_budget;
    if (curBudget !== undefined && curBudget > 0) {
      const currentValue = `${Math.round(curBudget)} EGP (${budgetType})`;
      const proposedValue = `${Math.round(proposedBudget)} EGP (${budgetType})`;
      if (Math.round(curBudget) === Math.round(proposedBudget)) {
        return { currentValue, proposedValue: currentValue, summary, lastIntervention };
      }
      return { currentValue, proposedValue, summary, lastIntervention };
    }
    return { summary, lastIntervention };
  }

  if (name === "pause_adset") {
    const adsetId = String(args.adset_id);
    const [details, lastIntervention] = await Promise.all([
      fetchAdsetDetailsCached(adsetId),
      getLastIntervention(adsetId, "adset_id"),
    ]);
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `إيقاف مؤقت للمجموعة الإعلانية "${details.name}"` : undefined;
    if (currentValue === "موقوفة ⏸") return { currentValue, proposedValue: "موقوفة ⏸", summary, lastIntervention };
    return { currentValue, summary, lastIntervention };
  }

  if (name === "enable_adset") {
    const adsetId = String(args.adset_id);
    const [details, lastIntervention] = await Promise.all([
      fetchAdsetDetailsCached(adsetId),
      getLastIntervention(adsetId, "adset_id"),
    ]);
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `تشغيل المجموعة الإعلانية "${details.name}"` : undefined;
    if (currentValue === "نشطة ✅") return { currentValue, proposedValue: "نشطة ✅", summary, lastIntervention };
    return { currentValue, summary, lastIntervention };
  }

  if (name === "update_adset_budget") {
    const adsetId = String(args.adset_id);
    const proposedBudget = Number(args.budget_amount);
    const [details, lastIntervention] = await Promise.all([
      fetchAdsetDetailsCached(adsetId),
      getLastIntervention(adsetId, "adset_id"),
    ]);
    const summary = details.name
      ? `تعديل ميزانية المجموعة "${details.name}" إلى ${Math.round(proposedBudget)} EGP`
      : undefined;
    const curBudget = details.daily_budget ?? details.lifetime_budget;
    if (curBudget !== undefined && curBudget > 0) {
      const bType = details.lifetime_budget !== undefined && details.daily_budget === undefined ? "إجمالية" : "يومية";
      const currentValue = `${Math.round(curBudget)} EGP (${bType})`;
      const proposedValue = `${Math.round(proposedBudget)} EGP (${bType})`;
      if (Math.round(curBudget) === Math.round(proposedBudget)) {
        return { currentValue, proposedValue: currentValue, summary, lastIntervention };
      }
      return { currentValue, proposedValue, summary, lastIntervention };
    }
    return { summary, lastIntervention };
  }

  if (name === "duplicate_adset") {
    const adsetId = String(args.adset_id);
    const [details, lastIntervention] = await Promise.all([
      fetchAdsetDetailsCached(adsetId),
      getLastIntervention(adsetId, "adset_id"),
    ]);
    const summary = details.name ? `نسخ المجموعة الإعلانية "${details.name}"` : undefined;
    return { summary, lastIntervention };
  }

  return {};
}

// ── Singleton Pipeboard MCP client ───────────────────────────────────────────
// One persistent connection per server process — eliminates the 2-5s
// connect+handshake overhead that was paid on every read tool call.
let _pbClient: Client | null = null;
let _pbConnecting: Promise<Client> | null = null;

async function getPipeboardClient(): Promise<Client> {
  if (_pbClient) return _pbClient;
  if (_pbConnecting) return _pbConnecting;

  _pbConnecting = (async () => {
    const token = process.env.PIPEBOARD_API_TOKEN;
    if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");
    const c = new Client({ name: "meta-ads-dashboard", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.pipeboard.co/meta-ads-mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await c.connect(transport);
    _pbClient = c;
    _pbConnecting = null;
    logger.info("Pipeboard singleton connected");
    return c;
  })();

  try {
    return await _pbConnecting;
  } catch (err) {
    _pbConnecting = null;
    throw err;
  }
}

// ── Pipeboard MCP read helper ────────────────────────────────────────────────
// Uses the singleton client — no per-call connection overhead.
async function callPipeboardRead(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  try {
    const client = await getPipeboardClient();
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    const content = result.content as Array<{ type: string; text?: string }>;
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
  } catch (err) {
    // Stale connection — reset so next call reconnects fresh
    _pbClient = null;
    _pbConnecting = null;
    throw err;
  }
}

// ── Google Ads MCP singleton ──────────────────────────────────────────────────
let _gaClient: Client | null = null;
let _gaConnecting: Promise<Client> | null = null;

async function getGoogleAdsClient(): Promise<Client> {
  if (_gaClient) return _gaClient;
  if (_gaConnecting) return _gaConnecting;

  _gaConnecting = (async () => {
    const token = process.env.PIPEBOARD_API_TOKEN;
    if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");
    const c = new Client({ name: "google-ads-dashboard", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.pipeboard.co/google-ads-mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await c.connect(transport);
    _gaClient = c;
    _gaConnecting = null;
    logger.info("Google Ads Pipeboard singleton connected");
    return c;
  })();

  try {
    return await _gaConnecting;
  } catch (err) {
    _gaConnecting = null;
    throw err;
  }
}

async function callGoogleAdsRead(toolName: string, toolArgs: Record<string, unknown>): Promise<string> {
  try {
    const client = await getGoogleAdsClient();
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    const content = result.content as Array<{ type: string; text?: string }>;
    return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
  } catch (err) {
    _gaClient = null;
    _gaConnecting = null;
    throw err;
  }
}

// In-memory customer cache (refreshed on server restart)
let _gaCustomers: { id: string; name: string }[] | null = null;

async function getGoogleAdsCustomers(): Promise<{ id: string; name: string }[]> {
  if (_gaCustomers) return _gaCustomers;
  try {
    const raw = await callGoogleAdsRead("list_google_ads_customers", {});
    const parsed = JSON.parse(raw) as { connections?: { customers?: { id: string; name: string; can_query_metrics?: boolean }[] }[] };
    const customers: { id: string; name: string }[] = [];
    for (const conn of parsed.connections ?? []) {
      for (const c of conn.customers ?? []) {
        if (c.can_query_metrics !== false) {
          customers.push({ id: c.id, name: c.name });
        }
      }
    }
    _gaCustomers = customers;
    return customers;
  } catch {
    return [];
  }
}

function daysToGADateRange(days: number): string {
  if (days <= 1) return "TODAY";
  if (days <= 7) return "LAST_7_DAYS";
  if (days <= 14) return "LAST_14_DAYS";
  if (days <= 30) return "LAST_30_DAYS";
  return "LAST_90_DAYS";
}

// Maps ga_* tool names → Google Ads MCP calls via Pipeboard.
async function tryExecuteViaGoogleAds(
  name: string,
  args: Record<string, unknown>
): Promise<string | null> {
  if (!process.env.PIPEBOARD_API_TOKEN) return null;

  const days = Number(args.days ?? 30);
  const dateRange = daysToGADateRange(days);

  try {
    if (name === "ga_get_campaigns") {
      const customers = await getGoogleAdsCustomers();
      if (customers.length === 0) return "لا توجد حسابات Google Ads مرتبطة بـ Pipeboard.";
      const results = await Promise.all(
        customers.map(async (cust) => {
          const r = await callGoogleAdsRead("get_google_ads_campaigns", { customer_id: cust.id });
          return `### ${cust.name} (customer_id: ${cust.id})\n${r}`;
        })
      );
      return results.join("\n\n---\n\n");
    }

    if (name === "ga_get_campaign_metrics") {
      const customer_id = String(args.customer_id ?? "");
      if (customer_id) {
        const r = await callGoogleAdsRead("get_google_ads_campaign_metrics", {
          customer_id,
          ...(args.campaign_id ? { campaign_id: String(args.campaign_id) } : {}),
          date_range: dateRange,
        });
        return r;
      }
      // No customer_id — query all
      const customers = await getGoogleAdsCustomers();
      if (customers.length === 0) return "لا توجد حسابات Google Ads مرتبطة.";
      const results = await Promise.all(
        customers.map(async (cust) => {
          const r = await callGoogleAdsRead("get_google_ads_campaign_metrics", {
            customer_id: cust.id, date_range: dateRange,
          }).catch((e: unknown) => `[خطأ ${cust.name}: ${e instanceof Error ? e.message : String(e)}]`);
          return `### ${cust.name}\n${r}`;
        })
      );
      return results.join("\n\n---\n\n");
    }

    if (name === "ga_get_ad_groups") {
      const customer_id = String(args.customer_id ?? "");
      if (!customer_id) return "customer_id إلزامي لجلب المجموعات الإعلانية.";
      const [groups, metrics] = await Promise.all([
        callGoogleAdsRead("get_google_ads_ad_groups", {
          customer_id,
          ...(args.campaign_id ? { campaign_id: String(args.campaign_id) } : {}),
        }),
        callGoogleAdsRead("get_google_ads_ad_group_metrics", {
          customer_id,
          ...(args.campaign_id ? { campaign_id: String(args.campaign_id) } : {}),
          date_range: dateRange,
        }),
      ]);
      return `### المجموعات الإعلانية\n${groups}\n\n### الأداء (${dateRange})\n${metrics}`;
    }

    if (name === "ga_get_keywords") {
      const customer_id = String(args.customer_id ?? "");
      if (!customer_id) return "customer_id إلزامي لجلب الكلمات المفتاحية.";
      const [kws, metrics] = await Promise.all([
        callGoogleAdsRead("get_google_ads_keywords", {
          customer_id,
          ...(args.ad_group_id ? { ad_group_id: String(args.ad_group_id) } : {}),
        }),
        callGoogleAdsRead("get_google_ads_keyword_metrics", {
          customer_id,
          ...(args.ad_group_id ? { ad_group_id: String(args.ad_group_id) } : {}),
          date_range: dateRange,
        }),
      ]);
      return `### الكلمات المفتاحية\n${kws}\n\n### الأداء (${dateRange})\n${metrics}`;
    }

    if (name === "ga_get_search_terms") {
      const customer_id = String(args.customer_id ?? "");
      if (customer_id) {
        return await callGoogleAdsRead("get_google_ads_search_terms_report", {
          customer_id, date_range: dateRange,
        });
      }
      const customers = await getGoogleAdsCustomers();
      if (customers.length === 0) return "لا توجد حسابات Google Ads مرتبطة.";
      const results = await Promise.all(
        customers.map(async (cust) => {
          const r = await callGoogleAdsRead("get_google_ads_search_terms_report", {
            customer_id: cust.id, date_range: dateRange,
          }).catch((e: unknown) => `[خطأ ${cust.name}: ${e instanceof Error ? e.message : String(e)}]`);
          return `### ${cust.name}\n${r}`;
        })
      );
      return results.join("\n\n---\n\n");
    }

    return null;
  } catch (err) {
    logger.warn({ err, tool: name }, "Google Ads read failed");
    return null;
  }
}

// Maps our AI tool names → Pipeboard MCP read calls.
// Returns null if the tool isn't mapped (caller falls through to native Meta API).
async function tryExecuteViaPipeboard(
  name: string,
  args: Record<string, unknown>,
  since: string,
  until: string,
  selectedAccFilter?: Set<string> | null
): Promise<string | null> {
  if (!process.env.PIPEBOARD_API_TOKEN) return null;

  const timeRange = { since, until };

  try {
    // ── Per-object tools (direct id → get_insights / get_*_details) ──────────
    if (name === "get_campaign_daily") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return null;
      return await callPipeboardRead("get_insights", {
        object_id: campaign_id,
        level: "campaign",
        time_breakdown: "day",
        time_range: timeRange,
      });
    }

    if (name === "get_adsets") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return null;
      return await callPipeboardRead("get_insights", {
        object_id: campaign_id,
        level: "adset",
        time_range: timeRange,
      });
    }

    if (name === "get_campaign_status" || name === "get_campaign_budget") {
      const campaign_id = String(args.campaign_id ?? "");
      if (!campaign_id) return null;
      return await callPipeboardRead("get_campaign_details", { campaign_id });
    }

    if (name === "get_adset_status") {
      const adset_id = String(args.adset_id ?? "");
      if (!adset_id) return null;
      return await callPipeboardRead("get_adset_details", { adset_id });
    }

    if (name === "get_ad_performance") {
      const ad_id = String(args.ad_id ?? "");
      if (!ad_id) return null;
      return await callPipeboardRead("get_insights", {
        object_id: ad_id,
        level: "ad",
        time_range: timeRange,
      });
    }

    if (name === "get_ads_in_adset") {
      const adset_id = String(args.adset_id ?? "");
      if (!adset_id) return null;
      return await callPipeboardRead("get_insights", {
        object_id: adset_id,
        level: "ad",
        time_range: timeRange,
      });
    }

    // ── Account-level tools: pull account IDs from DB cache ──────────────────
    // DB stores account_id WITHOUT the "act_" prefix — we add it back for Pipeboard.
    if (name === "get_campaigns") {
      const accRows = await query<{ account_id: string }>(
        `SELECT DISTINCT account_id FROM meta_campaigns_cache LIMIT 5`
      ).catch(() => [] as { account_id: string }[]);
      const filtered = selectedAccFilter
        ? accRows.filter(r => selectedAccFilter.has(r.account_id))
        : accRows;
      if (filtered.length === 0) return null;

      const results = await Promise.all(
        filtered.map((r) =>
          callPipeboardRead("get_insights", {
            object_id: `act_${r.account_id}`,
            level: "campaign",
            time_range: timeRange,
          }).catch(() => null)
        )
      );
      const successes = results.filter((r): r is string => r !== null && r.trim().length > 0);
      if (successes.length === 0) return null;
      return successes.join("\n\n---\n\n");
    }

    if (name === "get_account_daily") {
      const accRows = await query<{ account_id: string }>(
        `SELECT DISTINCT account_id FROM meta_overview_cache LIMIT 5`
      ).catch(() => [] as { account_id: string }[]);
      const filtered = selectedAccFilter
        ? accRows.filter(r => selectedAccFilter.has(r.account_id))
        : accRows;
      if (filtered.length === 0) return null;

      const results = await Promise.all(
        filtered.map((r) =>
          callPipeboardRead("get_insights", {
            object_id: `act_${r.account_id}`,
            level: "account",
            time_breakdown: "day",
            time_range: timeRange,
          }).catch(() => null)
        )
      );
      const successes = results.filter((r): r is string => r !== null && r.trim().length > 0);
      if (successes.length === 0) return null;
      return successes.join("\n\n---\n\n");
    }
  } catch (err) {
    logger.warn({ err, tool: name }, "Pipeboard read failed — falling back to native Meta API");
    return null;
  }

  return null; // unmapped tool
}

// ── Tool executor (Pipeboard-first → cache-first: DB → Meta API → stale fallback) ──
async function executeTool(name: string, args: Record<string, unknown>, selectedAccFilter?: Set<string> | null): Promise<string> {
  // Write tools are handled via the two-phase optimistic flow in the streaming
  // loop (buildOptimisticPendingAction → resolveWriteToolDetails).
  // This fallback should not be reached in normal operation.
  if (WRITE_TOOL_NAMES.has(name)) {
    return `ACTION_PENDING:${JSON.stringify(buildOptimisticPendingAction(name, args))}`;
  }

  // ── Google Ads tools — route directly to Google Ads MCP ──────────────────
  if (name.startsWith("ga_")) {
    const gaResult = await tryExecuteViaGoogleAds(name, args);
    if (gaResult !== null && gaResult.trim().length > 0) {
      logger.info({ tool: name }, "executeTool: served via Google Ads MCP");
      return gaResult;
    }
    return "فشل جلب بيانات Google Ads. تأكد من ربط الحساب مع Pipeboard.";
  }

  const days = Number(args.days ?? (name === "get_campaigns" ? 30 : (name === "get_ad_performance" || name === "get_adsets" || name === "get_ads_in_adset") ? 7 : 14));
  // Use Cairo time (GMT+2) so "today" matches the dashboard's date logic
  const nowCairoExec = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const dateRx = /^\d{4}-\d{2}-\d{2}$/;
  // Use explicit since/until from AI args when provided (supports any date range / single day)
  const u = (typeof args.until === "string" && dateRx.test(args.until)) ? args.until : fmtDate(nowCairoExec);
  const s = (typeof args.since === "string" && dateRx.test(args.since)) ? args.since : (() => {
    const d = new Date(nowCairoExec); d.setUTCDate(d.getUTCDate() - days); return fmtDate(d);
  })();

  // ── Pipeboard-first: try live data via Pipeboard MCP before our Meta API ────
  // Pipeboard handles rate-limiting and auth independently — no cache needed.
  // Falls back silently to our native Meta API + DB cache if it fails.
  {
    const pbResult = await tryExecuteViaPipeboard(name, args, s, u, selectedAccFilter);
    if (pbResult !== null && pbResult.trim().length > 0) {
      logger.info({ tool: name }, "executeTool: served via Pipeboard MCP");
      return pbResult;
    }
  }

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
      // AI tools only need active + spending campaigns — use lean fields for minimal payload
      const campaigns = await listCampaigns({ since: s, until: u, adAccountId, activeOnly: true });
      await query(
        `INSERT INTO meta_campaigns_cache (account_id, period_since, period_until, campaigns, fetched_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (account_id, period_since, period_until)
         DO UPDATE SET campaigns=$4, fetched_at=NOW()`,
        [accountId, s, u, JSON.stringify(campaigns)]
      ).catch(() => null);
      // Write-through to campaign_name_cache
      upsertCampaignNameCache(
        campaigns.filter((c) => c.id && c.name).map((c) => ({ id: c.id, name: c.name! }))
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
    const allAccounts = await listAdAccounts();
    if (allAccounts.length === 0) return "لا توجد حسابات إعلانية مرتبطة.";
    // Apply account filter if provided (strip act_ prefix for comparison)
    const accounts = selectedAccFilter
      ? allAccounts.filter(a => selectedAccFilter.has(a.id.replace(/^act_/, "")))
      : allAccounts;
    if (accounts.length === 0) return "لا توجد بيانات للحسابات المحددة.";

    if (name === "get_campaigns") {
      const rows: string[] = [`## الحملات النشطة (آخر ${days} يوم):\n`];
      rows.push("| الحملة | الحالة | الإنفاق (EGP) | الطلبات | CPA (EGP) | CTR% |");
      rows.push("|--------|--------|--------------|---------|-----------|------|");
      let maxCacheAgeMs = 0;
      let anyFromCache = false;
      let totalShown = 0;
      for (const acc of accounts) {
        const result = await fetchCampaignsCached(acc.id);
        if (result.fromCache) { anyFromCache = true; maxCacheAgeMs = Math.max(maxCacheAgeMs, result.cacheAgeMs); }
        // Filter: only campaigns with spend > 0, sorted by spend desc
        const spending = result.data
          .filter((c) => c.spend > 0)
          .sort((a, b) => b.spend - a.spend);
        for (const c of spending) {
          rows.push(`| ${c.name} (id:${c.id}) | ${c.effective_status} | ${fmt(c.spend)} | ${c.purchases} | ${c.cpa > 0 ? fmt(c.cpa) : "—"} | ${fmt(c.ctr, 2)} |`);
          totalShown++;
        }
      }
      if (totalShown === 0) rows.push("_(لا توجد حملات بإنفاق خلال هذه الفترة)_");
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
        const details = await fetchCampaignDetailsCached(campaign_id);
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
        const details = await fetchCampaignDetailsCached(campaign_id);
        const rows = [`## ميزانية الحملة:\n- الاسم: ${details.name}`];
        const hasCampaignBudget =
          (details.daily_budget !== undefined && details.daily_budget > 0) ||
          (details.lifetime_budget !== undefined && details.lifetime_budget > 0);

        if (details.daily_budget !== undefined && details.daily_budget > 0) {
          rows.push(`- النوع: CBO (ميزانية على مستوى الحملة)`);
          rows.push(`- الميزانية اليومية الحالية: ${Math.round(details.daily_budget)} EGP`);
        }
        if (details.lifetime_budget !== undefined && details.lifetime_budget > 0) {
          rows.push(`- النوع: CBO (ميزانية على مستوى الحملة)`);
          rows.push(`- الميزانية الإجمالية الحالية: ${Math.round(details.lifetime_budget)} EGP`);
        }

        // ABO campaign — budget is at adset level; fetch adsets and their budgets automatically
        if (!hasCampaignBudget) {
          rows.push(`- النوع: ABO (ميزانية على مستوى المجموعات الإعلانية)`);
          rows.push(`- لتعديل الميزانية استخدم update_adset_budget لكل مجموعة`);

          // Get adset IDs from the most recent insights cache for this campaign
          type InsightsCacheRow = { data: { by_adset?: Array<{ id: string; label: string }> }; fetched_at: string };
          const cached = await query<InsightsCacheRow>(
            `SELECT data, fetched_at FROM meta_insights_cache
             WHERE campaign_id=$1
             ORDER BY fetched_at DESC LIMIT 1`,
            [campaign_id]
          ).catch(() => [] as InsightsCacheRow[]);

          const adsets: Array<{ id: string; label: string }> =
            (cached[0]?.data?.by_adset ?? []).slice(0, 8);

          if (adsets.length > 0) {
            rows.push(`\n### ميزانيات المجموعات الإعلانية (${adsets.length} مجموعة):`);
            const adsetDetails = await Promise.allSettled(
              adsets.map((a) => fetchAdsetDetailsCached(a.id))
            );
            for (let i = 0; i < adsets.length; i++) {
              const a = adsets[i]!;
              const result = adsetDetails[i];
              if (result?.status === "fulfilled") {
                const d = result.value;
                const budgetStr =
                  d.daily_budget && d.daily_budget > 0
                    ? `${Math.round(d.daily_budget)} EGP يومياً`
                    : d.lifetime_budget && d.lifetime_budget > 0
                    ? `${Math.round(d.lifetime_budget)} EGP إجمالي`
                    : "غير محددة";
                const statusStr = d.effective_status === "ACTIVE" ? "✅ نشطة" : d.effective_status === "PAUSED" ? "⏸ موقوفة" : d.effective_status;
                rows.push(`- **${a.label || d.name}** (adset_id: ${a.id}) — الميزانية: ${budgetStr} — الحالة: ${statusStr}`);
              } else {
                rows.push(`- ${a.label} (adset_id: ${a.id}) — تعذّر جلب التفاصيل`);
              }
            }
          } else {
            rows.push(`- لم يتم العثور على بيانات مجموعات في الكاش — استخدم get_adsets(${campaign_id}) أولاً`);
          }
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
        const details = await fetchAdsetDetailsCached(adset_id);
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

    if (name === "get_ads_in_adset") {
      const adset_id = String(args.adset_id ?? "");
      if (!adset_id) return "adset_id مطلوب.";

      // Search all accounts and campaigns for ads belonging to this adset
      const matchedAds: Awaited<ReturnType<typeof getCampaignInsights>>["by_ad"] = [];
      let foundCampaignName = "";
      let foundAdsetName = "";
      let maxCacheAgeMs = 0;
      let anyFromCache = false;

      for (const acc of accounts) {
        const campaignsResult = await fetchCampaignsCached(acc.id);
        if (campaignsResult.fromCache) { anyFromCache = true; maxCacheAgeMs = Math.max(maxCacheAgeMs, campaignsResult.cacheAgeMs); }
        for (const campaign of campaignsResult.data) {
          try {
            const result = await fetchInsightsCached(campaign.id);
            if (result.fromCache) { anyFromCache = true; maxCacheAgeMs = Math.max(maxCacheAgeMs, result.cacheAgeMs); }
            const adsInAdset = result.data.by_ad.filter((ad) => ad.adset_id === adset_id);
            if (adsInAdset.length > 0) {
              matchedAds.push(...adsInAdset);
              foundCampaignName = result.data.campaign.name;
              // Try to find adset name from by_adset
              const adsetEntry = result.data.by_adset.find((as) => as.id === adset_id);
              if (adsetEntry) foundAdsetName = adsetEntry.label;
            }
          } catch {
            // Skip campaigns that fail to load
          }
        }
      }

      if (matchedAds.length === 0) {
        return `لم يتم العثور على إعلانات للمجموعة ${adset_id} في البيانات المتاحة (آخر ${days} يوم). تأكد من صحة الرقم أو جرّب فترة زمنية أطول.`;
      }

      // Rank by CPA (ascending, lower is better); ads with no purchases go last
      const sorted = [...matchedAds].sort((a, b) => {
        if (a.cpa <= 0 && b.cpa <= 0) return b.spend - a.spend;
        if (a.cpa <= 0) return 1;
        if (b.cpa <= 0) return -1;
        return a.cpa - b.cpa;
      });

      const adsetLabel = foundAdsetName ? `"${foundAdsetName}"` : adset_id;
      const rows: string[] = [
        `## الإعلانات داخل المجموعة ${adsetLabel} (آخر ${days} يوم):`,
        `الحملة: ${foundCampaignName}\n`,
        "| الإعلان | الإنفاق (EGP) | الطلبات | CPA (EGP) | نسبة الجذب% | نسبة النقر% | الظهورات | التقييم |",
        "|---------|--------------|---------|-----------|-------------|-------------|----------|---------|",
      ];

      const avgCpa = sorted.filter((a) => a.cpa > 0).reduce((s, a) => s + a.cpa, 0) / (sorted.filter((a) => a.cpa > 0).length || 1);
      const avgHook = sorted.reduce((s, a) => s + a.hookRate, 0) / (sorted.length || 1);

      for (const ad of sorted) {
        let verdict = "—";
        if (ad.cpa > 0 && ad.cpa <= avgCpa * 0.85 && ad.hookRate >= avgHook) {
          verdict = "🏆 Winner";
        } else if (ad.cpa > avgCpa * 1.3 && ad.spend > sorted.reduce((s, a) => s + a.spend, 0) * 0.15) {
          verdict = "🔴 Drain";
        } else if (ad.hookRate >= avgHook && ad.cpa > 0 && ad.cpa <= avgCpa * 1.1) {
          verdict = "✅ كويس";
        } else if (ad.hookRate < avgHook * 0.7) {
          verdict = "⚠️ Hook ضعيف";
        }
        rows.push(
          `| ${ad.label} (id:${ad.id}) | ${fmt(ad.spend)} | ${ad.purchases} | ${ad.cpa > 0 ? fmt(ad.cpa) : "—"} | ${fmt(ad.hookRate, 2)} | ${fmt(ad.ctr, 2)} | ${ad.impressions.toLocaleString()} | ${verdict} |`
        );
      }

      // Summary note
      const winner = sorted.find((a) => a.cpa > 0 && a.cpa <= avgCpa * 0.85 && a.hookRate >= avgHook);
      const drain = sorted.find((a) => a.cpa > avgCpa * 1.3 && a.spend > sorted.reduce((s, a) => s + a.spend, 0) * 0.15);
      if (winner) rows.push(`\n✅ الأفضل كفاءة: ${winner.label} — CPA: ${fmt(winner.cpa)} EGP، نسبة جذب: ${fmt(winner.hookRate, 2)}%`);
      if (drain) rows.push(`🔴 الأعلى هدراً: ${drain.label} — CPA: ${fmt(drain.cpa)} EGP، إنفاق: ${fmt(drain.spend)} EGP`);

      return rows.join("\n") + buildCacheNote(anyFromCache, maxCacheAgeMs);
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
  campaign_id?: string;
  conversation_id?: number;
  selectedAccountIds?: string[];
}

interface MemoryRow {
  conv_id: number;
  title: string;
  updated_at: string;
  content: string;
}

interface ActionRow {
  tool_name: string;
  args: Record<string, unknown>;
  executed_at: string;
  executed_by: string;
  success: boolean;
  result_message: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  is_no_op: boolean;
}

// ── Long-Term Memory (LTM) ────────────────────────────────────────────────────

interface LtmRow {
  target_kpis: Record<string, number | null>;
  strategic_rules: string[];
  historical_insights: string;
}

const LTM_KPI_LABELS: Record<string, string> = {
  target_cpa:       "CPA المستهدف (جنيه)",
  target_roas:      "ROAS المستهدف",
  target_ctr:       "CTR المستهدف (%)",
  target_hook_rate: "Hook Rate المستهدف (%)",
  target_cpm:       "CPM المستهدف (جنيه)",
};

/** Fetch user's LTM and build a formatted block for system prompt injection. */
async function fetchUserLtm(userId: number): Promise<string> {
  try {
    const rows = await query<LtmRow>(
      `SELECT target_kpis, strategic_rules, historical_insights
       FROM user_ai_memory WHERE user_id=$1`,
      [userId]
    );
    if (!rows[0]) return "";
    const { target_kpis, strategic_rules, historical_insights } = rows[0];

    const kpiEntries = Object.entries(target_kpis ?? {})
      .filter(([, v]) => v !== null && v !== undefined && String(v) !== "");
    const rules   = (strategic_rules ?? []).filter(Boolean);
    const insights = (historical_insights ?? "").trim();

    if (kpiEntries.length === 0 && rules.length === 0 && !insights) return "";

    const lines: string[] = [
      "══════════════════════════════════════",
      "🧠 ملف المستخدم — تفضيلات تعلّمتها من المحادثات السابقة",
      "══════════════════════════════════════",
    ];

    if (kpiEntries.length > 0) {
      lines.push("📊 أهداف KPI المستهدفة:");
      for (const [k, v] of kpiEntries) {
        const label = LTM_KPI_LABELS[k] ?? k;
        lines.push(`  - ${label}: ${v}`);
      }
    }
    if (rules.length > 0) {
      lines.push("📋 القواعد الاستراتيجية:");
      for (const rule of rules) lines.push(`  • ${rule}`);
    }
    if (insights) {
      lines.push(`💡 رؤى تاريخية:\n${insights}`);
    }
    lines.push("══════════════════════════════════════");
    lines.push("⚠️ استخدم هذا الملف كمرجع في توصياتك — إذا حدد المستخدم CPA مستهدف، اعتمده معياراً في تقييم الحملات.");
    lines.push("══════════════════════════════════════");

    return lines.join("\n");
  } catch {
    return "";
  }
}

/** Background LLM extraction — runs every N messages, updates user_ai_memory. */
async function triggerMemoryExtraction(userId: number, username: string): Promise<void> {
  try {
    const rows = await query<{ role: string; content: string }>(
      `SELECT cm.role, cm.content
       FROM chat_messages cm
       JOIN chat_conversations cc ON cc.id = cm.conversation_id
       WHERE cc.user_id = $1
         AND cm.content IS NOT NULL
         AND length(cm.content) > 5
       ORDER BY cm.created_at DESC
       LIMIT 40`,
      [userId]
    );

    if (rows.length < 6) return;

    const recent = [...rows].reverse();
    const historyText = recent
      .map(m => `${m.role === "user" ? "👤 المستخدم" : "🤖 المساعد"}: ${m.content.slice(0, 350)}`)
      .join("\n\n");

    const existingRows = await query<{ target_kpis: Record<string, unknown>; strategic_rules: string[] }>(
      `SELECT target_kpis, strategic_rules FROM user_ai_memory WHERE user_id=$1`,
      [userId]
    );
    const existing      = existingRows[0];
    const existingRules = ((existing?.strategic_rules ?? []) as string[]).filter(Boolean);

    const extractionPrompt = `أنت محلل بيانات صامت. مهمتك فقط: استخرج تفضيلات الـ Media Buyer من هذه المحادثة وأجب بـ JSON فقط بدون أي نص إضافي.

المحادثة:
---
${historyText}
---

القواعد المحفوظة مسبقاً (لا تُعِد ذكرها): ${existingRules.length > 0 ? existingRules.join(" | ") : "لا يوجد"}

استخرج فقط ما ذُكر صراحةً:
1. أهداف KPI رقمية: target_cpa بالجنيه، target_roas كنسبة، target_ctr كنسبة مئوية، target_hook_rate كنسبة مئوية، target_cpm بالجنيه
2. قواعد استراتيجية جديدة فقط (لم تُذكر في القواعد المحفوظة)
3. رؤية تاريخية واحدة مختصرة إذا وُجدت

أجب بـ JSON فقط:
{"target_kpis":{},"new_rules":[],"historical_insights":""}

إذا لم تجد شيئاً قابلاً للاستخراج: {"no_update":true}`;

    const extraction = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 400,
      messages: [{ role: "user", content: extractionPrompt }],
    });

    const raw = (extraction.choices[0]?.message?.content ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    type ExtractionResult = {
      no_update?: boolean;
      target_kpis?: Record<string, unknown>;
      new_rules?: string[];
      historical_insights?: string;
    };
    let extracted: ExtractionResult;
    try { extracted = JSON.parse(jsonMatch[0]) as ExtractionResult; } catch { return; }
    if (extracted.no_update) return;

    const filteredKpis: Record<string, number> = {};
    for (const [k, v] of Object.entries(extracted.target_kpis ?? {})) {
      if (typeof v === "number" && !isNaN(v) && v > 0) filteredKpis[k] = v;
    }

    const newRules   = (extracted.new_rules ?? []).filter((r): r is string => typeof r === "string" && r.trim().length > 5);
    const mergedRules = [...new Set([...existingRules, ...newRules])].slice(0, 20);
    const insights   = (extracted.historical_insights ?? "").trim();

    if (Object.keys(filteredKpis).length === 0 && newRules.length === 0 && !insights) return;

    await query(
      `INSERT INTO user_ai_memory (user_id, target_kpis, strategic_rules, historical_insights, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         target_kpis        = user_ai_memory.target_kpis || $2::jsonb,
         strategic_rules    = $3::jsonb,
         historical_insights = CASE WHEN $4 = '' THEN user_ai_memory.historical_insights ELSE $4 END,
         updated_at         = NOW()`,
      [userId, JSON.stringify(filteredKpis), JSON.stringify(mergedRules), insights]
    );

    logger.info({ userId, username, newRules: newRules.length, kpis: Object.keys(filteredKpis) }, "LTM extraction complete");
  } catch (err) {
    logger.warn({ err, userId }, "LTM extraction failed (non-critical)");
  }
}

const ACTION_LABEL: Record<string, string> = {
  pause_campaign:              "تم إيقاف الحملة مؤقتاً",
  enable_campaign:             "تم تشغيل الحملة",
  update_campaign_budget:      "تم تعديل ميزانية الحملة",
  pause_adset:                 "تم إيقاف المجموعة الإعلانية",
  enable_adset:                "تم تشغيل المجموعة الإعلانية",
  update_adset_budget:         "تم تعديل ميزانية المجموعة الإعلانية",
  duplicate_adset:             "تم نسخ المجموعة الإعلانية",
  create_campaign:             "تم إنشاء الحملة الإعلانية",
  create_adset:                "تم إنشاء المجموعة الإعلانية",
  duplicate_campaign:          "تم نسخ الحملة الإعلانية",
};

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.round(hrs / 24);
  return `منذ ${days} يوم`;
}

async function fetchCampaignMemory(
  userId: number,
  campaignId: string,
  excludeConvId: number | null
): Promise<string> {
  const sections: string[] = [];

  // ── 1. Past conversation summaries ──────────────────────────────────────
  try {
    const rows = await query<MemoryRow>(
      `SELECT cm.content, cc.id AS conv_id, cc.title, cc.updated_at
       FROM chat_messages cm
       JOIN chat_conversations cc ON cc.id = cm.conversation_id
       WHERE cc.campaign_id = $1
         AND cc.user_id = $2
         AND ($3::int IS NULL OR cc.id != $3)
         AND cm.role = 'assistant'
         AND cm.content IS NOT NULL
         AND length(cm.content) > 30
       ORDER BY cc.updated_at DESC, cm.created_at DESC
       LIMIT 20`,
      [campaignId, userId, excludeConvId ?? null]
    );

    if (rows.length) {
      const byConv = new Map<number, { title: string; updated_at: string; msgs: string[] }>();
      for (const r of rows) {
        if (!byConv.has(r.conv_id)) {
          byConv.set(r.conv_id, { title: r.title, updated_at: r.updated_at, msgs: [] });
        }
        const entry = byConv.get(r.conv_id)!;
        if (entry.msgs.length < 2) entry.msgs.push(r.content.slice(0, 500));
      }

      const convEntries = [...byConv.values()].slice(0, 3);
      const lines: string[] = [
        "══════════════════════════════════════",
        "📋 ذاكرة المحادثات السابقة — استخدمها كخلفية ولا تُكرّرها حرفياً",
        "══════════════════════════════════════",
      ];
      for (const conv of convEntries) {
        lines.push(`\n🗓 "${conv.title}" (${relativeTime(conv.updated_at)})`);
        for (const msg of conv.msgs) lines.push(`  → ${msg}`);
      }
      sections.push(lines.join("\n"));
    }
  } catch { /* silent */ }

  // ── 2. Real executed actions on this campaign ────────────────────────────
  try {
    const actions = await query<ActionRow>(
      `SELECT tool_name, args, executed_at, executed_by, success,
              result_message, campaign_name, adset_name, is_no_op
       FROM pipeboard_actions
       WHERE (args->>'campaign_id' = $1
           OR args->>'adset_campaign_id' = $1)
         AND success = true
         AND is_no_op = false
       ORDER BY executed_at DESC
       LIMIT 10`,
      [campaignId]
    );

    if (actions.length) {
      const lines: string[] = [
        "══════════════════════════════════════",
        "⚡ تاريخ الإجراءات المنفّذة على هذه الحملة — هذه قرارات حقيقية اتخذها الفريق",
        "══════════════════════════════════════",
      ];
      for (const a of actions) {
        const label = ACTION_LABEL[a.tool_name] ?? a.tool_name;
        const who = a.executed_by;
        const when = relativeTime(a.executed_at);
        const target = a.adset_name ? ` | المجموعة: "${a.adset_name}"` : "";
        const budget = a.args.budget_amount ? ` | الميزانية الجديدة: ${a.args.budget_amount} جنيه` : "";
        lines.push(`• ${label} (${when}) — بواسطة ${who}${target}${budget}`);
      }
      lines.push("\nاستخدم هذا التاريخ لتقييم تأثير القرارات السابقة على الأداء الحالي.");
      sections.push(lines.join("\n"));
    }
  } catch { /* silent */ }

  return sections.join("\n\n");
}

type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } }> }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; content: string; tool_call_id: string };

// ── Route ────────────────────────────────────────────────────────────────────
router.post("/ai/chat", async (req: Request, res: Response) => {
  const { campaignContext, messages, imageBase64, imageMimeType, fileText, fileName, campaign_id, conversation_id, selectedAccountIds } = req.body as AiChatBody;
  const selectedAccFilter = Array.isArray(selectedAccountIds) && selectedAccountIds.length > 0
    ? new Set(selectedAccountIds.map(id => id.replace(/^act_/, "")))
    : null;
  const isAdmin = req.session?.role === "admin";
  const canExecuteActions = req.session?.role === "admin" || req.session?.role === "media_buyer";
  const userId = req.session?.userId;

  if (!campaignContext || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "campaignContext and messages are required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // LTM extraction trigger — fires after every 8 assistant messages (non-blocking)
  if (userId) {
    const username = req.session?.username ?? "unknown";
    res.on("finish", () => {
      void (async () => {
        try {
          const cnt = await query<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt
             FROM chat_messages cm
             JOIN chat_conversations cc ON cc.id = cm.conversation_id
             WHERE cc.user_id = $1 AND cm.role = 'assistant'`,
            [userId]
          );
          const n = Number(cnt[0]?.cnt ?? 0);
          if (n > 0 && n % 8 === 0) {
            await triggerMemoryExtraction(userId, username);
          }
        } catch { /* silent */ }
      })();
    });
  }

  try {
    const memory = (userId && campaign_id)
      ? await fetchCampaignMemory(userId, campaign_id, conversation_id ?? null)
      : "";
    const ltmBlock = userId ? await fetchUserLtm(userId) : "";

    // Cairo time (GMT+2) — so "today" matches the dashboard's date logic
    const nowCairo = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const todayCairo = nowCairo.toISOString().slice(0, 10);
    const todayLabel = nowCairo.toLocaleDateString("ar-EG", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      timeZone: "UTC",
    });

    const dateHeader = `══════════════════════════════════════
📅 تاريخ اليوم الحقيقي: ${todayLabel} (${todayCairo})
عندما يقول المستخدم "النهاردة" أو "اليوم" فهو يقصد ${todayCairo}.
بيانات Meta للحملات عادةً متاحة حتى الأمس فقط — بيانات اليوم الجاري تظهر متأخرة بعد منتصف الليل.
══════════════════════════════════════`;

    const contextHeader = `══════════════════════════════════════
⚠️ Snapshot من الداشبورد (بيانات مؤرشفة — مش حية)
هذه البيانات أُخذت من كاش الداشبورد وقد تكون بها تأخير.
آخر يوم في هذا الـ snapshot هو ${todayCairo} أو أقل حسب توفر Meta API.
🚨 للبيانات الحقيقية اللحظية: استخدم الأدوات (get_campaigns, get_campaign_daily, get_account_daily).
لا تعتمد على الجدول اليومي أدناه للإجابة عن "النهاردة" — استدعِ الأداة دائماً.
══════════════════════════════════════`;

    const systemWithContext = `${SYSTEM_PROMPT}${ltmBlock ? `\n\n${ltmBlock}` : ""}\n\n${dateHeader}\n\n${contextHeader}\n${campaignContext}${memory ? `\n\n${memory}` : ""}`;

    const builtMessages: OpenAiMessage[] = [
      { role: "system", content: systemWithContext },
    ];

    // Filter junk assistant messages (empty, "?", error fallbacks) from history
    // to prevent confusing the model with garbage context
    const JUNK_RE = /^[?؟!.\s]*$|^❌|^عذراً، لم أتمكن/;
    const cleanedMessages = messages.filter((m) =>
      m.role !== "assistant" || (m.content.trim().length > 5 && !JUNK_RE.test(m.content.trim()))
    );

    for (let i = 0; i < cleanedMessages.length; i++) {
      const m = cleanedMessages[i]!;
      const isLast = i === cleanedMessages.length - 1;

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

    // ── TRUE streaming tool-use loop ────────────────────────────────────────
    // Uses stream:true for every round so tokens flow to the client immediately
    // (eliminates the 3-5s "wait for full response" before any text appears).
    const MAX_TOOL_ROUNDS = 4;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const roundStream = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 2048,
        messages: builtMessages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
        tools: (canExecuteActions ? TOOLS : TOOLS.filter((t) => !WRITE_TOOL_NAMES.has(t.function.name))) as unknown as Parameters<typeof openai.chat.completions.create>[0]["tools"],
        tool_choice: "auto",
        stream: true,
      });

      let roundContent = "";
      // Accumulate tool call deltas by index
      const tcDeltaMap: Record<number, { id: string; name: string; arguments: string }> = {};

      for await (const chunk of roundStream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;

        // Collect tool call deltas — NOT forwarded to client
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!tcDeltaMap[idx]) tcDeltaMap[idx] = { id: "", name: "", arguments: "" };
            if (tc.id) tcDeltaMap[idx]!.id = tc.id;
            if (tc.function?.name) tcDeltaMap[idx]!.name += tc.function.name;
            if (tc.function?.arguments) tcDeltaMap[idx]!.arguments += tc.function.arguments;
          }
        }

        // Forward content tokens directly to client — but only if no tool calls detected yet.
        // (Models send EITHER content OR tool_calls in a response, never both.)
        if (delta?.content && Object.keys(tcDeltaMap).length === 0) {
          roundContent += delta.content;
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }
      }

      const toolCalls = Object.values(tcDeltaMap)
        .filter((tc) => tc.name)
        .map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } }));

      // ── No tool calls → final answer ──────────────────────────────────────
      if (toolCalls.length === 0) {
        // Short-response guard: if empty (nothing sent), retry with a nudge
        if (roundContent.trim().length < 10) {
          logger.warn({ content: roundContent, round }, "AI returned short content — injecting tool-use nudge");
          if (roundContent.length === 0 && round < MAX_TOOL_ROUNDS - 1) {
            // Nothing was sent to client → safe to retry
            builtMessages.push({ role: "assistant", content: null });
            builtMessages.push({
              role: "user",
              content: "استخدم الأدوات المتاحة (get_campaigns, get_campaign_daily, get_account_daily) لجلب البيانات الحقيقية وأجب على السؤال بالتفصيل باللغة العربية.",
            });
            continue;
          }
          // Content was already streamed ("?") or last round — send fallback if nothing was sent
          if (roundContent.length === 0) {
            res.write(`data: ${JSON.stringify({ content: "عذراً، لم أتمكن من الإجابة في الوقت الحالي. حاول مرة أخرى أو اطرح السؤال بطريقة مختلفة." })}\n\n`);
          }
          // If "?" was already streamed, client-side guard shows fallback automatically
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      // ── Has tool calls → execute them ─────────────────────────────────────
      res.write(`data: ${JSON.stringify({ searching: true })}\n\n`);

      // Push assistant message with the accumulated tool calls
      builtMessages.push({
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      });

      // Emit transparency labels for read tools
      for (const tc of toolCalls) {
        if (!WRITE_TOOL_NAMES.has(tc.function.name)) {
          const labelArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          res.write(`data: ${JSON.stringify({ tool_call_label: getToolLabel(tc.function.name, labelArgs) })}\n\n`);
        }
      }

      // Phase 1: emit optimistic pending_action card immediately for write tools
      for (const tc of toolCalls) {
        if (!WRITE_TOOL_NAMES.has(tc.function.name)) continue;
        const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        const optimistic = buildOptimisticPendingAction(tc.function.name, args);
        builtMessages.push({ role: "tool", content: `في انتظار موافقة المستخدم على: ${optimistic.summary}`, tool_call_id: tc.id });
        res.write(`data: ${JSON.stringify({ pending_action: { ...optimistic, detailsLoading: true } })}\n\n`);
      }

      // Phase 2: execute read tools + resolve write-tool details in parallel
      await Promise.all(
        toolCalls.map(async (tc) => {
          const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          if (WRITE_TOOL_NAMES.has(tc.function.name)) {
            try {
              const resolved = await resolveWriteToolDetails(tc.function.name, args);
              res.write(`data: ${JSON.stringify({ pending_action_resolved: resolved })}\n\n`);
            } catch {
              res.write(`data: ${JSON.stringify({ pending_action_resolved: {} })}\n\n`);
            }
          } else {
            const result = await executeTool(tc.function.name, args, selectedAccFilter);
            builtMessages.push({ role: "tool", content: result, tool_call_id: tc.id });
          }
        })
      );

      res.write(`data: ${JSON.stringify({ searching: false })}\n\n`);
    }

    // Fallback: ran out of rounds — final streaming answer without tools
    const fallbackStream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages: builtMessages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
      stream: true,
    });

    for await (const chunk of fallbackStream) {
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

// ── LTM CRUD routes ──────────────────────────────────────────────────────────

// GET /api/ai/memory — fetch current user's Long-Term Memory
router.get("/ai/memory", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "غير مصرح" }); return; }
  try {
    const rows = await query<LtmRow & { updated_at: string | null }>(
      `SELECT target_kpis, strategic_rules, historical_insights, updated_at
       FROM user_ai_memory WHERE user_id=$1`,
      [userId]
    );
    if (!rows[0]) {
      res.json({ target_kpis: {}, strategic_rules: [], historical_insights: "", updated_at: null });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "GET /ai/memory error");
    res.status(500).json({ error: "خطأ في جلب الذاكرة" });
  }
});

// PATCH /api/ai/memory — full replace of user's LTM (manual edit from UI)
router.patch("/ai/memory", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "غير مصرح" }); return; }
  const { target_kpis, strategic_rules, historical_insights } = req.body as {
    target_kpis?: Record<string, unknown>;
    strategic_rules?: string[];
    historical_insights?: string;
  };
  try {
    await query(
      `INSERT INTO user_ai_memory (user_id, target_kpis, strategic_rules, historical_insights, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         target_kpis         = $2::jsonb,
         strategic_rules     = $3::jsonb,
         historical_insights = $4,
         updated_at          = NOW()`,
      [
        userId,
        JSON.stringify(target_kpis ?? {}),
        JSON.stringify((strategic_rules ?? []).filter(Boolean)),
        (historical_insights ?? "").trim(),
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PATCH /ai/memory error");
    res.status(500).json({ error: "خطأ في تحديث الذاكرة" });
  }
});

// DELETE /api/ai/memory — wipe all LTM for current user
router.delete("/ai/memory", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "غير مصرح" }); return; }
  try {
    await query(
      `INSERT INTO user_ai_memory (user_id, target_kpis, strategic_rules, historical_insights, updated_at)
       VALUES ($1, '{}', '[]', '', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         target_kpis         = '{}',
         strategic_rules     = '[]',
         historical_insights = '',
         updated_at          = NOW()`,
      [userId]
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /ai/memory error");
    res.status(500).json({ error: "خطأ في مسح الذاكرة" });
  }
});

// ── GET /ai/accounts — combined Meta + Google Ads account list ──
// Admin sees all accounts. Others see only accounts in user_account_permissions.
// If a non-admin user has no permissions set, they see all (no restrictions yet).
router.get("/ai/accounts", async (req: Request, res: Response) => {
  try {
    const [metaResult, gaResult] = await Promise.allSettled([
      listAdAccounts(),
      (async () => {
        const client = await getGoogleAdsClient();
        const r = await client.callTool({ name: "list_google_ads_customers", arguments: {} });
        const txt = (r.content as {type:string;text?:string}[]).filter(x=>x.type==="text").map(x=>x.text).join("");
        const parsed = JSON.parse(txt) as {customers?:{id:string;descriptive_name?:string;currency_code?:string;can_query_metrics?:boolean}[]};
        return parsed.customers ?? [];
      })(),
    ]);

    const metaAccounts = metaResult.status === "fulfilled"
      ? metaResult.value.map(a => ({ id: a.id, name: a.name || a.id, type: "meta" as const, currency: a.currency }))
      : [];

    const gaAccounts = gaResult.status === "fulfilled"
      ? gaResult.value.map(c => ({ id: c.id, name: c.descriptive_name || c.id, type: "google" as const, currency: c.currency_code }))
      : [];

    const allAccounts = [...metaAccounts, ...gaAccounts];

    // Filter by permissions for non-admin users
    const role = req.session?.role;
    const userId = req.session?.userId;
    if (role !== "admin" && userId) {
      const perms = await query<{ account_id: string }>(
        `SELECT account_id FROM user_account_permissions WHERE user_id = $1`,
        [userId]
      );
      if (perms.length > 0) {
        const allowed = new Set(perms.map(p => p.account_id));
        return res.json({ accounts: allAccounts.filter(a => allowed.has(a.id)) });
      }
    }

    res.json({ accounts: allAccounts });
  } catch (err) {
    req.log.error({ err }, "GET /ai/accounts error");
    res.status(500).json({ error: "خطأ في جلب الحسابات", accounts: [] });
  }
});

// Pre-warm the Pipeboard singleton connection on server startup
// so the first user message doesn't pay the handshake cost.
export function warmUpPipeboard(): void {
  if (process.env.PIPEBOARD_API_TOKEN) {
    getPipeboardClient().catch(() => null);
    getGoogleAdsClient().catch(() => null);
  }
}

export default router;
