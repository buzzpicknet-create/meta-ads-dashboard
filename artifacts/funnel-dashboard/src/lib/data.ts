export type DailyRow = {
  adSet: string;
  day: string;
  ad: string;
  headline: string;
  reach: number;
  impressions: number;
  spend: number;
  linkClicks: number;
  allClicks: number;
  lpv: number;
  purchases: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpLpv: number;
  hookRate: number;
  cr: number;
};

export const HEADLINE_A = "ودّعي الرؤوس السوداء واحصلي على بشرة نضيفة في 5 دقايق";
export const HEADLINE_B = "تنضيف عميق للمسام وبشرة صافية من أول استخدام";

export const dailyData: DailyRow[] = [
  { adSet: "Broad", day: "2026-04-20", ad: "ad1", headline: HEADLINE_A, reach: 920, impressions: 977, spend: 85.04, linkClicks: 39, allClicks: 58, lpv: 34, purchases: 4, ctr: 3.99, cpc: 2.18, cpm: 87.04, cpLpv: 2.50, hookRate: 31.63, cr: 10.26 },
  { adSet: "Broad", day: "2026-04-22", ad: "ad1", headline: HEADLINE_A, reach: 823, impressions: 869, spend: 54.35, linkClicks: 17, allClicks: 33, lpv: 12, purchases: 3, ctr: 1.96, cpc: 3.20, cpm: 62.54, cpLpv: 4.53, hookRate: 25.20, cr: 17.65 },
  { adSet: "Broad", day: "2026-04-20", ad: "ad1", headline: HEADLINE_B, reach: 201, impressions: 205, spend: 21.38, linkClicks: 14, allClicks: 18, lpv: 10, purchases: 2, ctr: 6.83, cpc: 1.53, cpm: 104.29, cpLpv: 2.14, hookRate: 28.78, cr: 14.29 },
  { adSet: "Broad", day: "2026-04-21", ad: "ad1", headline: HEADLINE_A, reach: 613, impressions: 713, spend: 60.04, linkClicks: 41, allClicks: 56, lpv: 34, purchases: 2, ctr: 5.75, cpc: 1.46, cpm: 84.21, cpLpv: 1.77, hookRate: 27.91, cr: 4.88 },
  { adSet: "Broad", day: "2026-04-23", ad: "ad1", headline: HEADLINE_A, reach: 980, impressions: 1013, spend: 63.25, linkClicks: 33, allClicks: 48, lpv: 27, purchases: 2, ctr: 3.26, cpc: 1.92, cpm: 62.44, cpLpv: 2.34, hookRate: 26.75, cr: 6.06 },
  { adSet: "Broad - 2 images", day: "2026-04-20", ad: "ad2", headline: HEADLINE_A, reach: 185, impressions: 216, spend: 23.50, linkClicks: 5, allClicks: 7, lpv: 4, purchases: 1, ctr: 2.31, cpc: 4.70, cpm: 108.80, cpLpv: 5.88, hookRate: 1.85, cr: 20.00 },
  { adSet: "Broad - 2 images", day: "2026-04-20", ad: "ad2", headline: HEADLINE_B, reach: 165, impressions: 186, spend: 26.07, linkClicks: 8, allClicks: 7, lpv: 6, purchases: 1, ctr: 4.30, cpc: 3.26, cpm: 140.16, cpLpv: 4.35, hookRate: 0.54, cr: 12.50 },
  { adSet: "Broad", day: "2026-04-22", ad: "ad1", headline: HEADLINE_B, reach: 212, impressions: 224, spend: 22.58, linkClicks: 12, allClicks: 22, lpv: 12, purchases: 1, ctr: 5.36, cpc: 1.88, cpm: 100.80, cpLpv: 1.88, hookRate: 35.71, cr: 8.33 },
  { adSet: "Broad", day: "2026-04-23", ad: "ad1", headline: HEADLINE_B, reach: 153, impressions: 164, spend: 17.28, linkClicks: 5, allClicks: 5, lpv: 5, purchases: 0, ctr: 3.05, cpc: 3.46, cpm: 105.37, cpLpv: 3.46, hookRate: 25.61, cr: 0 },
  { adSet: "Broad - 2 images", day: "2026-04-23", ad: "ad2", headline: HEADLINE_A, reach: 47, impressions: 50, spend: 4.31, linkClicks: 1, allClicks: 1, lpv: 1, purchases: 0, ctr: 2.00, cpc: 4.31, cpm: 86.20, cpLpv: 4.31, hookRate: 4.00, cr: 0 },
  { adSet: "Broad - 2 images", day: "2026-04-23", ad: "ad2", headline: HEADLINE_B, reach: 254, impressions: 318, spend: 25.35, linkClicks: 6, allClicks: 10, lpv: 6, purchases: 0, ctr: 1.89, cpc: 4.23, cpm: 79.72, cpLpv: 4.23, hookRate: 0.63, cr: 0 },
  { adSet: "Broad - 2 images", day: "2026-04-22", ad: "ad1", headline: HEADLINE_B, reach: 93, impressions: 118, spend: 7.45, linkClicks: 1, allClicks: 2, lpv: 1, purchases: 0, ctr: 0.85, cpc: 7.45, cpm: 63.14, cpLpv: 7.45, hookRate: 0.85, cr: 0 },
  { adSet: "Broad - 2 images", day: "2026-04-23", ad: "ad1", headline: HEADLINE_B, reach: 106, impressions: 121, spend: 9.54, linkClicks: 2, allClicks: 2, lpv: 2, purchases: 0, ctr: 1.65, cpc: 4.77, cpm: 78.84, cpLpv: 4.77, hookRate: 0.83, cr: 0 },
  { adSet: "Broad - 2 images", day: "2026-04-22", ad: "ad1", headline: HEADLINE_A, reach: 75, impressions: 89, spend: 6.15, linkClicks: 0, allClicks: 1, lpv: 0, purchases: 0, ctr: 0, cpc: 0, cpm: 69.10, cpLpv: 0, hookRate: 2.25, cr: 0 },
  { adSet: "Broad - 2 images", day: "2026-04-22", ad: "ad2", headline: HEADLINE_B, reach: 271, impressions: 351, spend: 31.14, linkClicks: 8, allClicks: 13, lpv: 8, purchases: 0, ctr: 2.28, cpc: 3.89, cpm: 88.72, cpLpv: 3.89, hookRate: 0.85, cr: 0 },
  { adSet: "Broad - 2 images", day: "2026-04-22", ad: "ad2", headline: HEADLINE_A, reach: 74, impressions: 87, spend: 9.83, linkClicks: 1, allClicks: 1, lpv: 1, purchases: 0, ctr: 1.15, cpc: 9.83, cpm: 112.99, cpLpv: 9.83, hookRate: 1.15, cr: 0 },
];

// Funnel totals (from the report total row, which is more accurate than sum of daily rows)
export const funnelTotals = {
  reach: 6411,
  impressions: 8653,
  linkClicks: 290,
  lpv: 238,
  purchases: 17,
  spend: 745.94,
  videoStart: 1737, // hook rate 20.07% × impressions
  v25: 681,
  v50: 529,
  v75: 472,
  v95: 351,
  v100: 291,
  hookRate: 20.07,
  ctr: 3.35,
  cpc: 2.57,
  cpm: 86.21,
  costPerLpv: 3.13,
  costPerPurchase: 43.88,
  crLpv: 7.14, // 17/238
  crClick: 5.86, // 17/290
  lpvRate: 82.07, // 238/290
};

export type ClarityInsight = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  arabicSummary: string;
  whatItMeans: string;
  funnelStage: "Ad" | "Landing" | "Offer" | "Checkout";
  affectedSessions: number;
  diagnosis: string;
  recommendation: string;
  expectedImpact: string;
};

export const clarityInsights: ClarityInsight[] = [
  {
    id: "checkout-stuck",
    severity: "critical",
    title: "فورم الطلب: تفاعل عالي بدون إكمال",
    arabicSummary:
      'الفورم في نفس صفحة المنتج (مفيش Cart ولا صفحة Checkout منفصلة). مستخدمين كتير كتبوا بياناتهم في الفورم، ضغطوا على زر "تأكيد الطلب" — ومحدش طلبه اتسجّل.',
    whatItMeans:
      'في فشل تقني في الفورم نفسه — إما الـ Validation بيرفض رقم تليفون/عنوان صحيح، أو زر "تأكيد الطلب" بيلود ومبيبعتش، أو الـ Submit بيفشل بصمت من غير رسالة خطأ واضحة.',
    funnelStage: "Checkout",
    affectedSessions: 38516616,
    diagnosis:
      'Form Validation Failure أو Submit Handler Broken في صفحة المنتج. ده أخطر مشكلة في الفانل كله — المستخدم عمل كل المجهود (شاف الإعلان، دخل الصفحة، قرا، ملا الفورم، ضغط تأكيد) والمنتج خسر الطلب في آخر millisecond.',
    recommendation:
      'افتحي صفحة المنتج بنفسك من موبايل (Chrome + Safari) وكمبيوتر، املي الفورم بأرقام مختلفة (01x, 02x, ببداية صفر وبدونه)، اضغطي تأكيد ولاحظي: في Loading؟ في رسالة نجاح؟ بيوصل WhatsApp/Email؟ شيكي Console لو في Errors. اتأكدي إن الفورم بيبعت لـ Backend شغّال (مش Endpoint قديم).',
    expectedImpact:
      "إصلاح ده ممكن يضاعف الـ Purchases من 17 لـ 30+ بنفس الـ Spend (CPA من 44 EGP لـ ~25 EGP).",
  },
  {
    id: "offer-stalled",
    severity: "high",
    title: 'زر العرض بيتضغط — والفورم تحت مش بيوصل ليه',
    arabicSummary:
      'سيشنز كتير ضغطت على "عرض قطعتين" أو "الحق العرض واطلبها" — لكن لأن الفورم في نفس الصفحة، المفروض الضغط يوديهم له مباشرة. اللي حصل: عملوا تفاعل وبعدين وقفوا.',
    whatItMeans:
      'زر العرض ما بيعملش Scroll تلقائي لجزء الفورم، أو بيعمل Scroll لكن الفورم مش واضح إنه "هنا اطلبي". المستخدم بيدوّر بعينه ومش لاقي الخطوة اللي بعدها فيخرج.',
    funnelStage: "Offer",
    affectedSessions: 25666,
    diagnosis:
      "نية شراء صريحة بدون اتجاه واضح. الزر شال تعب الإقناع، لكن الفورم تحت مش بيتنده عليه ولا بيتميّز لما المستخدم يوصله.",
    recommendation:
      'زر العرض لازم يعمل smooth scroll للفورم + يعمل Highlight (Border ملوّن أو Shake خفيف) لمدة ثانية على الفورم لما يوصل له + يعدّل عنوان الفورم تلقائياً لـ "اطلبي عرض القطعتين دلوقتي". وضّحي بصرياً إنها خطوة واحدة.',
    expectedImpact:
      "تحسين تدفق الزر→الفورم ممكن يرفع الـ CR من 7.14% لـ 9-10% على نفس الترافيك.",
  },
  {
    id: "ad-mismatch",
    severity: "high",
    title: "خروج سريع من إعلانات السوشيال",
    arabicSummary:
      "زيارات كتيرة جايّة من Facebook/Instagram على صفحة المنتج، وخرجت في ثواني بعد Scroll واحد أو Click واحد.",
    whatItMeans:
      "Mismatch بين الإعلان واللاندينج — اللي وعد به الإعلان مش ظاهر فوراً في الجزء العلوي من الصفحة، فالمستخدم بيحس إنه في مكان غلط ويخرج.",
    funnelStage: "Ad",
    affectedSessions: 145452,
    diagnosis:
      "Above-the-Fold ضعيف. الفيديو/الصورة الأولى في الإعلان مش متطابقة بصرياً مع أول حاجة بيشوفها المستخدم في الصفحة.",
    recommendation:
      "ضعي أول scroll: نفس الـ Hook بتاع الإعلان حرفياً (نص + صورة Before/After). اعرضي السعر والوعد في أول 100 بكسل. شيلي أي Banner أو Cookie Popup يعطّل أول ثانية.",
    expectedImpact:
      "تقليل Quick Exit بـ 30% = +60-80 LPV مفيدة بدل ما تتحرق. ممكن CPA ينزل لـ 35 EGP.",
  },
  {
    id: "high-dwell-no-cart",
    severity: "medium",
    title: "وقت طويل في الصفحة بدون فتح الفورم",
    arabicSummary:
      "مستخدمين قعدوا أكتر من دقيقة في صفحة المنتج، شافوا وقروا وعملوا Scroll، وخرجوا من غير ما يبدأوا حتى يكتبوا أول حرف في فورم الطلب.",
    whatItMeans:
      "تردّد في القرار — High Intent بدون فعل. المستخدم مهتم وقاعد بيقرا، لكن في حاجز ثقة أو سعر أو خوف من الفورم نفسه (هل هيتسجّل اسمي؟ هل في تأكيد قبل الشحن؟).",
    funnelStage: "Landing",
    affectedSessions: 413657,
    diagnosis:
      "نقص في عناصر الإقناع جنب الفورم: Reviews, Trust Badges, ضمان استرجاع، توضيح إن الدفع عند الاستلام (COD) ومفيش أي خصم قبل التأكيد على التليفون.",
    recommendation:
      'ضيفي فوق الفورم مباشرة: "✓ الدفع كاش عند الاستلام · ✓ هنكلّمك للتأكيد قبل الشحن · ✓ ضمان استرجاع 14 يوم". تحت زرار "تأكيد الطلب" حطي تقييمات نجوم + Reviews فيديو. وزر "اطلبي دلوقتي" يبقى Sticky في الموبايل وبيعمل Scroll للفورم لما يتضغط.',
    expectedImpact:
      "تحويل 10% من اللي بيقعدوا دقيقة بدون فعل = +20 طلب إضافي على نفس الترافيك حالياً.",
  },
];

// Per-segment aggregations (computed)
export type Segment = {
  key: string;
  label: string;
  spend: number;
  impressions: number;
  linkClicks: number;
  lpv: number;
  purchases: number;
  ctr: number;
  cpc: number;
  cr: number;
  cpa: number;
  costPerLpv: number;
};

function aggregate(rows: DailyRow[], key: string, label: string): Segment {
  const sum = (k: keyof DailyRow) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const spend = sum("spend");
  const impressions = sum("impressions");
  const linkClicks = sum("linkClicks");
  const lpv = sum("lpv");
  const purchases = sum("purchases");
  return {
    key, label, spend, impressions, linkClicks, lpv, purchases,
    ctr: impressions ? (linkClicks / impressions) * 100 : 0,
    cpc: linkClicks ? spend / linkClicks : 0,
    cr: lpv ? (purchases / lpv) * 100 : 0,
    cpa: purchases ? spend / purchases : 0,
    costPerLpv: lpv ? spend / lpv : 0,
  };
}

export const adSetSegments: Segment[] = [
  aggregate(dailyData.filter(r => r.adSet === "Broad"), "Broad", "Broad"),
  aggregate(dailyData.filter(r => r.adSet === "Broad - 2 images"), "Broad - 2 images", "Broad - 2 images"),
];

export const adSegments: Segment[] = [
  aggregate(dailyData.filter(r => r.ad === "ad1"), "ad1", "ad1 (فيديو)"),
  aggregate(dailyData.filter(r => r.ad === "ad2"), "ad2", "ad2 (صورتين)"),
];

export const headlineSegments: Segment[] = [
  aggregate(dailyData.filter(r => r.headline === HEADLINE_A), "A", "ودّعي الرؤوس السوداء..."),
  aggregate(dailyData.filter(r => r.headline === HEADLINE_B), "B", "تنضيف عميق للمسام..."),
];

// Daily aggregation for trend chart
export const dailyTrend = Array.from(
  dailyData.reduce((map, r) => {
    const cur = map.get(r.day) || { day: r.day, spend: 0, purchases: 0, lpv: 0, impressions: 0, linkClicks: 0 };
    cur.spend += r.spend;
    cur.purchases += r.purchases;
    cur.lpv += r.lpv;
    cur.impressions += r.impressions;
    cur.linkClicks += r.linkClicks;
    map.set(r.day, cur);
    return map;
  }, new Map<string, { day: string; spend: number; purchases: number; lpv: number; impressions: number; linkClicks: number }>())
).map(([, v]) => v).sort((a, b) => a.day.localeCompare(b.day));

// Final action plan items
export type ActionItem = {
  id: string;
  priority: "kill" | "scale" | "test" | "fix";
  title: string;
  why: string;
  expectedSaving?: string;
};

export const actionPlan: ActionItem[] = [
  {
    id: "fix-checkout",
    priority: "fix",
    title: 'افتحي صفحة المنتج وجربي الفورم دلوقتي (موبايل + كمبيوتر)',
    why: 'Clarity بيقول مستخدمين بيملوا الفورم ويضغطوا "تأكيد الطلب" والطلب مش بيتسجّل. ده أكبر مصدر للخسارة لأن الفورم في نفس الصفحة — مفيش خطوة تانية تتلام عليها.',
    expectedSaving: "ممكن يضاعف الأوردرات (من 17 لـ 30+)",
  },
  {
    id: "kill-broad-2-images",
    priority: "kill",
    title: 'أوقفي Ad Set "Broad - 2 images" فوراً',
    why: "CPA = 125 EGP مقابل 29 EGP في Broad. بياخد 38% من الميزانية ويرجّع 12% من الأوردرات.",
    expectedSaving: "+250 EGP/أسبوع",
  },
  {
    id: "kill-ad2",
    priority: "kill",
    title: "أوقفي Creative ad2 (الصورتين)",
    why: "Hook Rate 0.5%-4% فقط = الناس بتعدّيه من أول ثانية. CPA 78 EGP.",
    expectedSaving: "+157 EGP/أسبوع",
  },
  {
    id: "kill-headline-b",
    priority: "kill",
    title: 'وقفي Headline "تنضيف عميق للمسام"',
    why: "CPA = 62 EGP مقابل 34 EGP في Headline الأول. عام جداً، بدون Pain Point.",
    expectedSaving: "+27 EGP لكل أوردر",
  },
  {
    id: "scale-winner",
    priority: "scale",
    title: 'ضاعفي على Broad + ad1 + Headline "ودّعي الرؤوس السوداء"',
    why: "CPA = 29 EGP فقط، CR = 8.33%. ارفعي الميزانية بـ 30-50% بس عشان ما تكسريش الـ Learning.",
  },
  {
    id: "test-hooks",
    priority: "test",
    title: "اختبري 3 Hooks جديدة لأول 3 ثواني من الفيديو",
    why: "Hook Rate الإجمالي 20% فقط. لو رفعتيه لـ 30% الـ CPA هينزل من 44 لـ 28 EGP.",
  },
  {
    id: "fix-offer-flow",
    priority: "fix",
    title: "خلّي زر العرض يعمل Scroll تلقائي للفورم + Highlight",
    why: 'Clarity: ضغطات على "عرض قطعتين" بدون إكمال. الزر مش بيوصّل المستخدم بصرياً للفورم اللي تحت في نفس الصفحة.',
  },
  {
    id: "fix-trust",
    priority: "fix",
    title: 'ضيفي فوق الفورم: "كاش عند الاستلام · تأكيد بالتليفون · استرجاع 14 يوم"',
    why: "Clarity: 413K سيشن قعدوا أكتر من دقيقة بدون ما يبدأوا الفورم = خوف من إلزام الشراء أو من تسجيل بياناتهم.",
    expectedSaving: "+20 طلب متوقع",
  },
];
