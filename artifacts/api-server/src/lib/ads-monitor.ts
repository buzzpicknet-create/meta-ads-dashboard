import cron from "node-cron";
import { sendTelegramAlert } from "./telegram.js";

const META_TOKEN = process.env.META_ACCESS_TOKEN ?? "";
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID ?? "";

// ── KPI thresholds (قابلة للتعديل) ───────────────────────────────────────
const TARGET_CPA = Number(process.env.TARGET_CPA ?? 40);       // EGP
const MAX_CPA_RATIO = Number(process.env.MAX_CPA_RATIO ?? 2);  // 2× الهدف = خطر
const MAX_FREQUENCY = Number(process.env.MAX_FREQUENCY ?? 4);  // حد Frequency

interface AdInsight {
  ad_id: string;
  ad_name: string;
  spend: number;
  purchases: number;
  cpa: number;
  frequency: number;
  hook_rate: number;
  campaign_name: string;
}

async function fetchActiveAdsInsights(): Promise<AdInsight[]> {
  if (!META_TOKEN || !AD_ACCOUNT_ID) return [];

  const accountId = AD_ACCOUNT_ID.replace("act_", "");
  const url = `https://graph.facebook.com/v19.0/act_${accountId}/insights` +
    `?level=ad` +
    `&fields=ad_id,ad_name,campaign_name,spend,actions,impressions,video_play_actions,frequency` +
    `&date_preset=last_7d` +
    `&filtering=[{"field":"ad.effective_status","operator":"IN","value":["ACTIVE"]}]` +
    `&action_attribution_windows=["click_7d","view_1d"]` +
    `&limit=100` +
    `&access_token=${META_TOKEN}`;

  const res = await fetch(url);
  const json = await res.json() as any;
  const rows = json.data ?? [];

  return rows.map((r: any) => {
    const spend = Number(r.spend ?? 0);
    const impressions = Number(r.impressions ?? 0);
    const actions: any[] = r.actions ?? [];
    const videoPlays: any[] = r.video_play_actions ?? [];
    const purchases = Number(
      actions.find((a: any) =>
        ["offsite_conversion.fb_pixel_purchase", "purchase"].includes(a.action_type)
      )?.value ?? 0
    );
    const videoViews = Number(
      videoPlays.find((a: any) => a.action_type === "video_view")?.value ?? 0
    );
    return {
      ad_id: r.ad_id,
      ad_name: r.ad_name,
      campaign_name: r.campaign_name,
      spend,
      purchases,
      cpa: purchases > 0 ? spend / purchases : 999,
      frequency: Number(r.frequency ?? 0),
      hook_rate: impressions > 0 ? (videoViews / impressions) * 100 : 0,
    };
  });
}

async function runDailyBrief(): Promise<void> {
  try {
    const ads = await fetchActiveAdsInsights();
    if (ads.length === 0) {
      await sendTelegramAlert("📊 <b>التقرير الصباحي</b>\nلا توجد إعلانات نشطة حالياً.");
      return;
    }

    const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
    const totalPurchases = ads.reduce((s, a) => s + a.purchases, 0);
    const avgCPA = totalPurchases > 0 ? totalSpend / totalPurchases : 0;

    const winners = ads.filter(a => a.cpa <= TARGET_CPA && a.spend >= TARGET_CPA * 2);
    const danger  = ads.filter(a => a.cpa > TARGET_CPA * MAX_CPA_RATIO && a.spend >= TARGET_CPA * 2);
    const fatigue = ads.filter(a => a.frequency >= MAX_FREQUENCY);

    let msg = `🌅 <b>التقرير الصباحي</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // تحذيرات
    const warnings = [...danger, ...fatigue.filter(a => !danger.find(d => d.ad_id === a.ad_id))];
    if (warnings.length > 0) {
      msg += `🚨 <b>تحذيرات فورية:</b>\n`;
      for (const a of danger) {
        msg += `• ${a.ad_name} — CPA ${a.cpa.toFixed(0)} EGP (${(a.cpa/TARGET_CPA).toFixed(1)}× الهدف) ❌\n`;
      }
      for (const a of fatigue) {
        msg += `• ${a.ad_name} — Frequency ${a.frequency.toFixed(1)} ⚠️\n`;
      }
    } else {
      msg += `✅ لا تحذيرات\n`;
    }

    msg += `\n📊 <b>الأداء (7 أيام):</b>\n`;
    msg += `• إنفاق: ${totalSpend.toFixed(0)} EGP\n`;
    msg += `• طلبات: ${totalPurchases}\n`;
    msg += `• CPA: ${avgCPA > 0 ? avgCPA.toFixed(0) + " EGP" : "—"} | الهدف: ${TARGET_CPA} EGP\n`;

    if (winners.length > 0) {
      msg += `\n🏆 <b>الرابحين:</b>\n`;
      for (const a of winners.slice(0, 5)) {
        msg += `• ${a.ad_name} — CPA ${a.cpa.toFixed(0)} EGP | Hook ${a.hook_rate.toFixed(0)}% ✅\n`;
      }
    }

    if (danger.length > 0) {
      msg += `\n💀 <b>محتاجين وقف:</b>\n`;
      for (const a of danger.slice(0, 5)) {
        msg += `• ${a.ad_name} — CPA ${a.cpa.toFixed(0)} EGP\n`;
      }
    }

    // النمذجة
    if (avgCPA > 0) {
      const dailySpend = totalSpend / 7;
      const dailyOrders = dailySpend / avgCPA;
      msg += `\n📈 <b>النمذجة:</b>\n`;
      msg += `• إنفاق يومي: ${dailySpend.toFixed(0)} EGP → شهري: ${(dailySpend * 30).toFixed(0)} EGP\n`;
      msg += `• طلبات متوقعة: ${dailyOrders.toFixed(0)}/يوم\n`;
    }

    await sendTelegramAlert(msg);
  } catch (e) {
    console.error("Daily brief error:", e);
    await sendTelegramAlert(`⚠️ خطأ في التقرير الصباحي: ${String(e).slice(0, 200)}`);
  }
}

async function runCPAAlert(): Promise<void> {
  try {
    const ads = await fetchActiveAdsInsights();
    const critical = ads.filter(a =>
      a.cpa > TARGET_CPA * MAX_CPA_RATIO &&
      a.spend >= TARGET_CPA * 3
    );
    const fatigue = ads.filter(a => a.frequency >= MAX_FREQUENCY);

    if (critical.length > 0 || fatigue.length > 0) {
      let msg = `🚨 <b>تنبيه فوري</b>\n━━━━━━━━━━━━━━\n`;
      for (const a of critical) {
        msg += `❌ <b>${a.ad_name}</b>\nCPA: ${a.cpa.toFixed(0)} EGP (${(a.cpa/TARGET_CPA).toFixed(1)}× الهدف)\nالحملة: ${a.campaign_name}\n\n`;
      }
      for (const a of fatigue) {
        msg += `⚠️ <b>${a.ad_name}</b>\nFrequency: ${a.frequency.toFixed(1)} — Audience Fatigue\n\n`;
      }
      msg += `افتح الـ dashboard وراجع فوراً 👆`;
      await sendTelegramAlert(msg);
    }
  } catch (e) {
    console.error("CPA alert error:", e);
  }
}

export function startAdsMonitor(): void {
  if (!META_TOKEN || !AD_ACCOUNT_ID) {
    console.warn("⚠️ Ads Monitor: META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set — skipping");
    return;
  }

  // التقرير الصباحي — كل يوم الساعة 8 صباحاً (توقيت مصر UTC+2 = 6 UTC)
  cron.schedule("0 6 * * *", runDailyBrief, { timezone: "Africa/Cairo" });

  // تنبيه CPA — كل 4 ساعات
  cron.schedule("0 */4 * * *", runCPAAlert, { timezone: "Africa/Cairo" });

  console.log("✅ Ads Monitor started — Daily brief: 8AM Cairo | CPA alerts: every 4h");
}
