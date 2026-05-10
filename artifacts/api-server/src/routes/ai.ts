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

المستخدم يشوف على الشاشة الأداة اللي بتتنفذ في الوقت الفعلي — هذا يبني الثقة ويثبت إنك بتعمل تشخيص حقيقي.

🔧 أدوات متاحة لك:
- get_campaigns: قائمة الحملات مع أداءها لأي فترة
- get_campaign_daily: الأداء اليومي لحملة معينة
- get_account_daily: الأداء اليومي للحساب كله
- get_adsets: المجموعات الإعلانية لحملة معينة
- get_ad_performance: أداء إعلان بعينه (نسبة الجذب، نسبة النقر، تكلفة التحويل، الظهورات، الإنفاق) — استخدم قبل التوصية بتغيير أو إيقاف إعلان محدد
- get_ads_in_adset: قائمة مقارنة بكل الإعلانات داخل مجموعة إعلانية محددة مرتّبة بالكفاءة — استخدم قبل التوصية بزيادة إعلان أو إيقاف آخر لتحديد الـ Winner والـ Drain

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
   - قبل update_campaign_budget: استخدم get_campaign_budget أولاً
   - قبل pause_adset أو enable_adset أو update_adset_budget: استخدم get_adset_status أولاً
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
              genders: { type: "array", description: "[1] ذكور، [2] إناث، [1,2] كلاهما" },
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
    case "get_ads_in_adset":   return `جلب الإعلانات داخل المجموعة ${String(args.adset_id ?? "")}…`;
    default:                    return `جلب البيانات (${name})…`;
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
// Details (status/budget) — also live, no cache
const DETAILS_CACHE_FRESH_MS = 0;

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
    default:
      return { tool: name, args, summary: label };
  }
}

// ── Resolve write-tool details (cache → Meta API) and return field updates ───
// Returns a partial update to merge into the optimistic pending action.
// Sets currentValue = proposedValue when it detects a no-op so the frontend
// naturally renders the "already in that state" UI via its existing isSameState check.
interface WriteToolResolved {
  currentValue?: string;
  proposedValue?: string;
  summary?: string;
}

async function resolveWriteToolDetails(name: string, args: Record<string, unknown>): Promise<WriteToolResolved> {
  if (name === "pause_campaign") {
    const details = await fetchCampaignDetailsCached(String(args.campaign_id));
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `إيقاف مؤقت للحملة "${details.name}"` : undefined;
    // No-op: already paused
    if (currentValue === "موقوفة ⏸") return { currentValue, proposedValue: "موقوفة ⏸", summary };
    return { currentValue, summary };
  }

  if (name === "enable_campaign") {
    const details = await fetchCampaignDetailsCached(String(args.campaign_id));
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `تشغيل الحملة "${details.name}"` : undefined;
    if (currentValue === "نشطة ✅") return { currentValue, proposedValue: "نشطة ✅", summary };
    return { currentValue, summary };
  }

  if (name === "update_campaign_budget") {
    const budgetType = args.budget_type === "lifetime" ? "إجمالية" : "يومية";
    const proposedBudget = Number(args.budget_amount);
    const details = await fetchCampaignDetailsCached(String(args.campaign_id));
    const summary = details.name
      ? `تعديل ميزانية الحملة "${details.name}" إلى ${Math.round(proposedBudget)} EGP (${budgetType})`
      : undefined;
    const curBudget = args.budget_type === "lifetime" ? details.lifetime_budget : details.daily_budget;
    if (curBudget !== undefined && curBudget > 0) {
      const currentValue = `${Math.round(curBudget)} EGP (${budgetType})`;
      const proposedValue = `${Math.round(proposedBudget)} EGP (${budgetType})`;
      // No-op: same budget (numeric comparison avoids float/int mismatch)
      if (Math.round(curBudget) === Math.round(proposedBudget)) {
        return { currentValue, proposedValue: currentValue, summary };
      }
      return { currentValue, proposedValue, summary };
    }
    return { summary };
  }

  if (name === "pause_adset") {
    const details = await fetchAdsetDetailsCached(String(args.adset_id));
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `إيقاف مؤقت للمجموعة الإعلانية "${details.name}"` : undefined;
    if (currentValue === "موقوفة ⏸") return { currentValue, proposedValue: "موقوفة ⏸", summary };
    return { currentValue, summary };
  }

  if (name === "enable_adset") {
    const details = await fetchAdsetDetailsCached(String(args.adset_id));
    const currentValue = statusLabel(details.effective_status);
    const summary = details.name ? `تشغيل المجموعة الإعلانية "${details.name}"` : undefined;
    if (currentValue === "نشطة ✅") return { currentValue, proposedValue: "نشطة ✅", summary };
    return { currentValue, summary };
  }

  if (name === "update_adset_budget") {
    const proposedBudget = Number(args.budget_amount);
    const details = await fetchAdsetDetailsCached(String(args.adset_id));
    const summary = details.name
      ? `تعديل ميزانية المجموعة "${details.name}" إلى ${Math.round(proposedBudget)} EGP`
      : undefined;
    const curBudget = details.daily_budget ?? details.lifetime_budget;
    if (curBudget !== undefined && curBudget > 0) {
      const bType = details.lifetime_budget !== undefined && details.daily_budget === undefined ? "إجمالية" : "يومية";
      const currentValue = `${Math.round(curBudget)} EGP (${bType})`;
      const proposedValue = `${Math.round(proposedBudget)} EGP (${bType})`;
      if (Math.round(curBudget) === Math.round(proposedBudget)) {
        return { currentValue, proposedValue: currentValue, summary };
      }
      return { currentValue, proposedValue, summary };
    }
    return { summary };
  }

  if (name === "duplicate_adset") {
    const details = await fetchAdsetDetailsCached(String(args.adset_id));
    const summary = details.name ? `نسخ المجموعة الإعلانية "${details.name}"` : undefined;
    return { summary };
  }

  return {};
}

// ── Pipeboard MCP read helper ────────────────────────────────────────────────
// Connects to Pipeboard, calls a read tool, and returns its text output.
// Each call opens a fresh connection (stateless per request).
async function callPipeboardRead(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  const token = process.env.PIPEBOARD_API_TOKEN;
  if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");

  const client = new Client({ name: "meta-ads-dashboard", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://mcp.pipeboard.co/meta-ads-mcp"),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    const content = result.content as Array<{ type: string; text?: string }>;
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
  } finally {
    await client.close().catch(() => null);
  }
}

// Maps our AI tool names → Pipeboard MCP read calls.
// Returns null if the tool isn't mapped (caller falls through to native Meta API).
async function tryExecuteViaPipeboard(
  name: string,
  args: Record<string, unknown>,
  since: string,
  until: string
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
      if (accRows.length === 0) return null;

      const results = await Promise.all(
        accRows.map((r) =>
          callPipeboardRead("get_insights", {
            object_id: `act_${r.account_id}`,
            level: "campaign",
            time_range: timeRange,
          }).catch((e: unknown) => `[خطأ حساب act_${r.account_id}: ${e instanceof Error ? e.message : String(e)}]`)
        )
      );
      const combined = results.join("\n\n---\n\n");
      return combined || null;
    }

    if (name === "get_account_daily") {
      const accRows = await query<{ account_id: string }>(
        `SELECT DISTINCT account_id FROM meta_overview_cache LIMIT 5`
      ).catch(() => [] as { account_id: string }[]);
      if (accRows.length === 0) return null;

      const results = await Promise.all(
        accRows.map((r) =>
          callPipeboardRead("get_insights", {
            object_id: `act_${r.account_id}`,
            level: "account",
            time_breakdown: "day",
            time_range: timeRange,
          }).catch((e: unknown) => `[خطأ حساب act_${r.account_id}: ${e instanceof Error ? e.message : String(e)}]`)
        )
      );
      const combined = results.join("\n\n---\n\n");
      return combined || null;
    }
  } catch (err) {
    logger.warn({ err, tool: name }, "Pipeboard read failed — falling back to native Meta API");
    return null;
  }

  return null; // unmapped tool
}

// ── Tool executor (Pipeboard-first → cache-first: DB → Meta API → stale fallback) ──
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // Write tools are handled via the two-phase optimistic flow in the streaming
  // loop (buildOptimisticPendingAction → resolveWriteToolDetails).
  // This fallback should not be reached in normal operation.
  if (WRITE_TOOL_NAMES.has(name)) {
    return `ACTION_PENDING:${JSON.stringify(buildOptimisticPendingAction(name, args))}`;
  }

  const days = Number(args.days ?? (name === "get_campaigns" ? 30 : (name === "get_ad_performance" || name === "get_adsets" || name === "get_ads_in_adset") ? 7 : 14));
  // Use Cairo time (GMT+2) so "today" matches the dashboard's date logic
  const untilD = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const sinceD = new Date(untilD);
  sinceD.setUTCDate(sinceD.getUTCDate() - days);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const u = fmtDate(untilD);
  const s = fmtDate(sinceD);

  // ── Pipeboard-first: try live data via Pipeboard MCP before our Meta API ────
  // Pipeboard handles rate-limiting and auth independently — no cache needed.
  // Falls back silently to our native Meta API + DB cache if it fails.
  {
    const pbResult = await tryExecuteViaPipeboard(name, args, s, u);
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
      const campaigns = await listCampaigns({ since: s, until: u, adAccountId });
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
  const { campaignContext, messages, imageBase64, imageMimeType, fileText, fileName, campaign_id, conversation_id } = req.body as AiChatBody;
  const isAdmin = req.session?.role === "admin";
  const userId = req.session?.userId;

  if (!campaignContext || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "campaignContext and messages are required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const memory = (userId && campaign_id)
      ? await fetchCampaignMemory(userId, campaign_id, conversation_id ?? null)
      : "";

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

    const systemWithContext = `${SYSTEM_PROMPT}\n\n${dateHeader}\n\n${contextHeader}\n${campaignContext}${memory ? `\n\n${memory}` : ""}`;

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

        // Guard: if the model returned a suspiciously short response (<10 chars)
        // on the first round, it likely didn't have enough context to answer.
        // Nudge it to use its tools before giving up.
        if (round === 0 && finalContent.trim().length < 10) {
          logger.warn({ content: finalContent, round }, "AI returned suspiciously short content — injecting tool-use nudge");
          builtMessages.push({ role: "assistant", content: finalContent || null });
          builtMessages.push({
            role: "user",
            content: "استخدم الأدوات المتاحة (get_campaigns, get_account_daily) لجلب البيانات وأجب على السؤال بالتفصيل.",
          });
          continue; // go to round 1
        }

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

      // Emit tool_call_label for each read tool so the client can show transparency labels
      for (const tc of toolCalls) {
        if (!WRITE_TOOL_NAMES.has(tc.function.name)) {
          const labelArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          const label = getToolLabel(tc.function.name, labelArgs);
          res.write(`data: ${JSON.stringify({ tool_call_label: label })}\n\n`);
        }
      }

      // ── Two-phase optimistic write-tool handling ──────────────────────────
      // Phase 1: immediately emit an optimistic pending_action card (detailsLoading:true)
      // so the user sees the confirmation card right away without waiting for the
      // Meta API details fetch (which can take 5-8 s on a cold cache).
      for (const tc of toolCalls) {
        if (!WRITE_TOOL_NAMES.has(tc.function.name)) continue;
        const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        const optimistic = buildOptimisticPendingAction(tc.function.name, args);
        // Register the tool message so the AI loop has a reply for this tool call
        builtMessages.push({
          role: "tool",
          content: `في انتظار موافقة المستخدم على: ${optimistic.summary}`,
          tool_call_id: tc.id,
        });
        // Emit skeleton card immediately
        res.write(`data: ${JSON.stringify({ pending_action: { ...optimistic, detailsLoading: true } })}\n\n`);
      }

      // Phase 2: execute read tools + resolve write-tool details in parallel.
      // When details arrive, emit pending_action_resolved so the frontend can
      // fill in the currentValue badge (and detect no-ops).
      await Promise.all(
        toolCalls.map(async (tc) => {
          const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          if (WRITE_TOOL_NAMES.has(tc.function.name)) {
            try {
              const resolved = await resolveWriteToolDetails(tc.function.name, args);
              res.write(`data: ${JSON.stringify({ pending_action_resolved: resolved })}\n\n`);
            } catch {
              // Details fetch failed — emit an empty resolved so the frontend
              // clears the loading skeleton and shows the card without currentValue
              res.write(`data: ${JSON.stringify({ pending_action_resolved: {} })}\n\n`);
            }
          } else {
            const result = await executeTool(tc.function.name, args);
            builtMessages.push({ role: "tool", content: result, tool_call_id: tc.id });
          }
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
