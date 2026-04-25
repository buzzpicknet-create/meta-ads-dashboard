import type { DailyPoint } from "./meta-api";

export interface DailyCalc {
  day: string;
  cpa: number;
  ctr: number;
  cpc: number;
  spend: number;
  purchases: number;
  frequency: number;
}

// ── Frequency / Audience Saturation ─────────────────────────────────────────

export type FrequencyLevel = "fresh" | "normal" | "warning" | "danger" | "saturated";

export interface FrequencyAlert {
  level: FrequencyLevel;
  frequency: number;
  trend: "rising" | "stable" | "falling";
  trendPerDay: number;       // slope (how much freq grows per day)
  consecutiveRising: number; // consecutive days frequency increased
  predictedIn3Days: number;
  headline: string;
  action: string;
}

function freqLevel(f: number): FrequencyLevel {
  if (f < 1.5)  return "fresh";
  if (f < 2.5)  return "normal";
  if (f < 3.5)  return "warning";
  if (f < 5.0)  return "danger";
  return "saturated";
}

function freqLevelLabel(l: FrequencyLevel): string {
  switch (l) {
    case "fresh":     return "جمهور طازج";
    case "normal":    return "تنبه — حضّر بديل";
    case "warning":   return "غيّر الكريتف أو الجمهور الآن";
    case "danger":    return "تشبع عالٍ — تدخّل فوراً";
    case "saturated": return "جمهور مشبع — أوقف";
  }
}

export function buildFrequencyAlert(daily: DailyPoint[]): FrequencyAlert | null {
  const active = daily
    .filter((d) => d.spend > 0 && d.frequency > 0)
    .slice(-7);
  if (active.length < 2) return null;

  const freqVals = active.map((d) => d.frequency);
  const current = freqVals[freqVals.length - 1];
  const slope = linSlope(freqVals);
  const predicted = Math.max(0, current + slope * 3);

  let consecutiveRising = 0;
  for (let i = freqVals.length - 1; i > 0; i--) {
    if (freqVals[i] > freqVals[i - 1]) consecutiveRising++;
    else break;
  }

  const trend: FrequencyAlert["trend"] =
    slope > 0.1 ? "rising" : slope < -0.1 ? "falling" : "stable";

  const level = freqLevel(current);
  const predictedLevel = freqLevel(predicted);

  let headline = "";
  let action = "";

  switch (level) {
    case "fresh":
      headline = `التكرار ${current.toFixed(1)}x — الجمهور طازج`;
      action = trend === "rising"
        ? "التكرار يرتفع — راقب الوضع وابدأ تحضير كريتف احتياطي"
        : "الأداء طبيعي — يمكن توسيع الميزانية بأمان";
      break;
    case "normal":
      headline = `⚡ التكرار ${current.toFixed(1)}x — تنبه: وقت تحضير بديل${consecutiveRising >= 2 ? ` (${consecutiveRising} أيام متصاعدة)` : ""}`;
      action = "ابدأ الآن في تحضير كريتف جديد أو جمهور مختلف أو زاوية إعلانية جديدة";
      break;
    case "warning":
      headline = `⚠️ التكرار ${current.toFixed(1)}x — غيّر الكريتف أو الجمهور الآن${consecutiveRising >= 2 ? ` (${consecutiveRising} أيام متصاعدة)` : ""}`;
      action = "جمهورك بدأ يتشبع — جرّب Look-alike Audience جديد أو كريتف من زاوية مختلفة تماماً";
      break;
    case "danger":
      headline = `🚨 التكرار ${current.toFixed(1)}x — تشبع عالٍ${consecutiveRising >= 2 ? ` (${consecutiveRising} أيام متصاعدة)` : ""}`;
      action = "غيّر الكريتف والأوديانس فوراً — أو أوقف الحملة مؤقتاً قبل ما تخسر أكتر";
      break;
    case "saturated":
      headline = `🔴 التكرار ${current.toFixed(1)}x — جمهور مشبع تماماً`;
      action = "أوقف الإعلان الحالي — غيّر الكريتف والأوديانس بشكل كامل";
      break;
  }

  // Upgrade urgency if predicted level is worse
  if (trend === "rising" && predictedLevel !== level && ["warning","danger","saturated"].includes(predictedLevel)) {
    action += ` (التكرار سيصل ${predicted.toFixed(1)}x خلال 3 أيام)`;
  }

  return { level, frequency: current, trend, trendPerDay: slope, consecutiveRising, predictedIn3Days: predicted, headline, action };
}

export type TrendDir = "worsening" | "improving" | "stable";

export interface MetricTrend {
  metric: "cpa" | "ctr" | "cpc";
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  currentValue: number;
  prevAvg: number;
  pctChange: number;
  consecutiveWorse: number;
  consecutiveBetter: number;
  direction: TrendDir;
  predictedIn3Days: number;
  slope: number;
}

export interface TrendInsight {
  mainProblem: {
    metric: string;
    headline: string;
    reason: string;
    action: string;
    severity: "critical" | "warn";
  } | null;
  bestOpportunity: {
    metric: string;
    headline: string;
    reason: string;
    action: string;
  } | null;
}

export interface PredictionResult {
  predictedCpa3d: number;
  predictedOrders3d: number;
  predictedSpend3d: number;
  estimatedProfit3d: number | null;
  verdict: "scale" | "watch" | "danger";
  verdictText: string;
}

function linSlope(vals: number[]): number {
  const n = vals.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = vals.reduce((a, b) => a + b, 0) / n;
  const num = vals.reduce((acc, v, i) => acc + (i - meanX) * (v - meanY), 0);
  const den = vals.reduce((acc, _, i) => acc + (i - meanX) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

function predictAhead(vals: number[], days: number): number {
  if (vals.length === 0) return 0;
  const slope = linSlope(vals);
  return Math.max(0, vals[vals.length - 1] + slope * days);
}

export function calcDailyMetrics(daily: DailyPoint[]): DailyCalc[] {
  return daily
    .filter((d) => d.spend > 0)
    .map((d) => ({
      day: d.day,
      cpa: d.purchases > 0 ? d.spend / d.purchases : 0,
      ctr: d.impressions > 0 ? (d.link_clicks / d.impressions) * 100 : 0,
      cpc: d.link_clicks > 0 ? d.spend / d.link_clicks : 0,
      spend: d.spend,
      purchases: d.purchases,
      frequency: d.frequency ?? (d.reach > 0 ? d.impressions / d.reach : 0),
    }));
}

function analyzeSingle(
  data: DailyCalc[],
  metric: "cpa" | "ctr" | "cpc",
  label: string,
  unit: string,
  lowerIsBetter: boolean
): MetricTrend | null {
  const active = data.filter((d) => d[metric] > 0).slice(-7);
  if (active.length < 3) return null;

  const vals = active.map((d) => d[metric]);
  const current = vals[vals.length - 1];
  const windowLen = Math.min(3, vals.length - 1);
  const prevSlice = vals.slice(-windowLen - 3, -windowLen);
  const prevAvg =
    prevSlice.length > 0
      ? prevSlice.reduce((a, b) => a + b, 0) / prevSlice.length
      : vals[0];

  let consecutiveWorse = 0;
  let consecutiveBetter = 0;
  for (let i = vals.length - 1; i > 0; i--) {
    const worse = lowerIsBetter ? vals[i] > vals[i - 1] : vals[i] < vals[i - 1];
    const better = lowerIsBetter ? vals[i] < vals[i - 1] : vals[i] > vals[i - 1];
    if (i === vals.length - 1) {
      consecutiveWorse = worse ? 1 : 0;
      consecutiveBetter = better ? 1 : 0;
    } else {
      if (consecutiveWorse > 0 && worse) consecutiveWorse++;
      else if (consecutiveBetter > 0 && better) consecutiveBetter++;
      else break;
    }
  }

  const pctChange = prevAvg > 0 ? ((current - prevAvg) / prevAvg) * 100 : 0;
  const slope = linSlope(vals);
  const isWorse = lowerIsBetter ? pctChange > 8 || consecutiveWorse >= 2 : pctChange < -8 || consecutiveWorse >= 2;
  const isBetter = lowerIsBetter ? pctChange < -8 || consecutiveBetter >= 2 : pctChange > 8 || consecutiveBetter >= 2;
  const direction: TrendDir = isWorse ? "worsening" : isBetter ? "improving" : "stable";
  const predictedIn3Days = predictAhead(vals, 3);

  return {
    metric, label, unit, lowerIsBetter,
    currentValue: current, prevAvg, pctChange,
    consecutiveWorse, consecutiveBetter,
    direction, predictedIn3Days, slope,
  };
}

export function analyzeTrends(daily: DailyPoint[]): MetricTrend[] {
  const data = calcDailyMetrics(daily);
  return [
    analyzeSingle(data, "cpa", "CPA", "EGP", true),
    analyzeSingle(data, "ctr", "CTR", "%", false),
    analyzeSingle(data, "cpc", "CPC", "EGP", true),
  ].filter(Boolean) as MetricTrend[];
}

export function buildInsight(trends: MetricTrend[], purchases: number): TrendInsight {
  const worsening = trends
    .filter((t) => t.direction === "worsening")
    .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));
  const improving = trends
    .filter((t) => t.direction === "improving")
    .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));

  let mainProblem: TrendInsight["mainProblem"] = null;
  if (worsening.length > 0) {
    const t = worsening[0];
    const pct = Math.abs(t.pctChange).toFixed(0);
    const days = t.consecutiveWorse;
    if (t.metric === "cpa") {
      mainProblem = {
        metric: "CPA",
        headline: `CPA ارتفع ${pct}%${days >= 2 ? ` لـ ${days} أيام متتالية` : ""}`,
        reason: "إما الكريتف بدأ يشبع أو الأوديانس أقل استجابة مما كان",
        action: "راجع الكريتف الحالي — وسّع الاستهداف — لو استمر قلّل الميزانية مؤقتاً",
        severity: days >= 3 ? "critical" : "warn",
      };
    } else if (t.metric === "ctr") {
      mainProblem = {
        metric: "CTR",
        headline: `CTR انخفض ${pct}%${days >= 2 ? ` لـ ${days} أيام متتالية` : ""} — المحتوى يفقد جاذبيته`,
        reason: "الجمهور شاف الإعلان كتير ويتجاهله (Ad Fatigue)",
        action: "غيّر الميديا فوراً — جرّب Hook جديد في أول 3 ثواني",
        severity: days >= 2 ? "critical" : "warn",
      };
    } else {
      mainProblem = {
        metric: "CPC",
        headline: `CPC ارتفع ${pct}%${days >= 2 ? ` لـ ${days} أيام متتالية` : ""}`,
        reason: "المزاد أصبح أكثر تنافساً أو الأوديانس وصل لمرحلة الشبع",
        action: "جرّب Audience جديد — غيّر الكريتف لتقليل تكلفة المزاد",
        severity: "warn",
      };
    }
  }

  let bestOpportunity: TrendInsight["bestOpportunity"] = null;
  if (improving.length > 0) {
    const t = improving[0];
    const pct = Math.abs(t.pctChange).toFixed(0);
    if (t.metric === "cpa") {
      bestOpportunity = {
        metric: "CPA",
        headline: `CPA تحسّن ${pct}% — فرصة Scale الآن`,
        reason: "انخفاض تكلفة الأوردر يعني أداء إعلاني أقوى",
        action: "زوّد الميزانية 20–30% واستغل الزخم قبل ما ينتهي",
      };
    } else if (t.metric === "ctr") {
      bestOpportunity = {
        metric: "CTR",
        headline: `CTR تحسّن ${pct}% — الجمهور يتفاعل أكثر`,
        reason: "ارتفاع CTR يعني محتوى أكثر ملاءمة للجمهور المستهدف",
        action: "الكريتف الحالي شغّال — ثبّته وزوّد الميزانية عليه",
      };
    } else {
      bestOpportunity = {
        metric: "CPC",
        headline: `CPC انخفض ${pct}% — تكلفة الترافيك في تحسن`,
        reason: "أداء مزاد أفضل يعني كل جنيه بيجيب زيارات أكتر",
        action: "استغل الكفاءة الحالية — وسّع الأوديانس تدريجياً",
      };
    }
  }

  return { mainProblem, bestOpportunity };
}

export function buildPrediction(
  daily: DailyPoint[],
  trends: MetricTrend[]
): PredictionResult | null {
  const data = calcDailyMetrics(daily).slice(-7);
  if (data.length < 3) return null;

  const spendVals = data.map((d) => d.spend);
  const purchaseVals = data.map((d) => d.purchases);
  const cpaVals = data.filter((d) => d.cpa > 0).map((d) => d.cpa);

  const predictedSpend3d = predictAhead(spendVals, 3);
  const predictedOrders3d = Math.round(predictAhead(purchaseVals, 3));
  const predictedCpa3d = cpaVals.length >= 2 ? predictAhead(cpaVals, 3) : 0;

  const cpaTrend = trends.find((t) => t.metric === "cpa");
  const ctrTrend = trends.find((t) => t.metric === "ctr");

  let verdict: PredictionResult["verdict"] = "watch";
  let verdictText = "الأداء مستقر — تابع الأرقام يومياً";

  if (
    cpaTrend?.direction === "worsening" && (cpaTrend.consecutiveWorse ?? 0) >= 2 ||
    ctrTrend?.direction === "worsening" && (ctrTrend.consecutiveWorse ?? 0) >= 2
  ) {
    verdict = "danger";
    verdictText = "الأداء يتجه للأسوأ — تدخّل الآن";
  } else if (
    cpaTrend?.direction === "improving" && (cpaTrend.consecutiveBetter ?? 0) >= 2 ||
    ctrTrend?.direction === "improving"
  ) {
    verdict = "scale";
    verdictText = "الأداء يتحسن — فرصة Scale";
  }

  return {
    predictedCpa3d,
    predictedOrders3d,
    predictedSpend3d,
    estimatedProfit3d: null,
    verdict,
    verdictText,
  };
}
