import { useState } from "react";
import { Link2, Copy, CheckCheck, ExternalLink, Sparkles } from "lucide-react";

function cleanUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    const path = url.pathname.replace(/\/$/, "");
    return `${url.origin}${path}`;
  } catch {
    return "";
  }
}

function extractCampaignId(input: string): string {
  const s = input.trim();
  if (!s) return "";
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1]!.toLowerCase();
    const host = url.hostname.replace(/^www\./, "");
    return host.split(".")[0] ?? host;
  } catch {
    return s.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase().replace(/-+/g, "-");
  }
}

function slugify(text: string): string {
  return text.trim().replace(/\s+/g, "-");
}

export function UtmBuilder() {
  const [productUrl, setProductUrl] = useState("");
  const [angle, setAngle] = useState("");
  const [copiedFinal, setCopiedFinal] = useState(false);
  const [copiedDynamic, setCopiedDynamic] = useState(false);

  const base = cleanUrl(productUrl);
  const campaignId = base ? extractCampaignId(productUrl) : "";
  const angleSlug = angle.trim() ? slugify(angle) : "creative";
  const hasInputs = !!base;

  const finalUrl =
    `${base}` +
    `?utm_source=facebook&utm_medium=paid_social` +
    `&utm_campaign=${campaignId}&utm_content=${angleSlug}`;

  const dynamicUrl =
    `${base}` +
    `?utm_source=facebook&utm_medium={{placement}}` +
    `&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`;

  function copy(text: string, which: "final" | "dynamic") {
    navigator.clipboard.writeText(text).then(() => {
      if (which === "final") {
        setCopiedFinal(true);
        setTimeout(() => setCopiedFinal(false), 2000);
      } else {
        setCopiedDynamic(true);
        setTimeout(() => setCopiedDynamic(false), 2000);
      }
    });
  }

  return (
    <div dir="rtl" className="rounded-2xl border-2 border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/20 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
          <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">UTM Builder — Meta Ads</h2>
          <p className="text-[11px] text-muted-foreground">أنشئ UTM links جاهزة لأي رابط — Facebook &amp; Instagram</p>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">رابط الصفحة</label>
          <input
            type="text"
            dir="ltr"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://example.com/any-page"
            className="w-full text-sm rounded-xl border border-border bg-white dark:bg-card px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400 placeholder:text-muted-foreground/50 transition-all"
          />
          {base && (
            <p className="text-[11px] text-blue-700 dark:text-blue-400">
              <span className="font-mono bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                utm_campaign: {campaignId}
              </span>
            </p>
          )}
          {productUrl.trim() && !base && (
            <p className="text-[11px] text-red-600 dark:text-red-400">رابط غير صالح</p>
          )}
        </div>

        {/* Angle / Creative name */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">اسم الزاوية (الكريتيف)</label>
          <input
            type="text"
            dir="ltr"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="before-after  or  زاوية-الألم  or  ad1"
            className="w-full text-sm rounded-xl border border-border bg-white dark:bg-card px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400 placeholder:text-muted-foreground/50 transition-all"
          />
          {angle.trim() && (
            <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
              <span className="font-mono bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded">utm_content: {slugify(angle)}</span>
            </p>
          )}
        </div>
      </div>

      {/* UTM Pills */}
      {hasInputs && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
            utm_source=facebook
          </span>
          <span className="inline-flex items-center text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            utm_medium=paid_social
          </span>
          <span className="inline-flex items-center text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800/50">
            utm_campaign={campaignId}
          </span>
          <span className="inline-flex items-center text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
            utm_content={angleSlug}
          </span>
        </div>
      )}

      {/* Output boxes or empty state */}
      {!hasInputs ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-blue-200 dark:border-blue-800/40 py-8 text-center">
          <Link2 className="h-8 w-8 text-blue-300 dark:text-blue-700" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">أدخل أي رابط لإنشاء UTM links</p>
            <p className="text-xs text-muted-foreground/60">يشتغل مع أي موقع — Shopify, WordPress, Landing Pages…</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Static Final URL */}
          <div className="rounded-xl border-2 border-blue-300 dark:border-blue-700/50 bg-white dark:bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-blue-100 dark:border-blue-800/30">
              <div className="flex items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <div>
                  <span className="text-xs font-bold text-blue-800 dark:text-blue-300">رابط الإعلان — Final URL</span>
                  <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70">الصقه في خانة "Website URL" في الإعلان</p>
                </div>
              </div>
              <button
                onClick={() => copy(finalUrl, "final")}
                className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                  copiedFinal
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-white dark:bg-muted border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                }`}
              >
                {copiedFinal ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedFinal ? "تم النسخ ✓" : "نسخ"}
              </button>
            </div>
            <div className="px-4 py-3">
              <code
                dir="ltr"
                className="block text-[12px] font-mono text-blue-900 dark:text-blue-200 break-all leading-relaxed select-all cursor-text"
              >
                {finalUrl}
              </code>
            </div>
          </div>

          {/* Dynamic URL */}
          <div className="rounded-xl border border-violet-200 dark:border-violet-800/40 bg-violet-50 dark:bg-violet-950/20 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-violet-100 dark:border-violet-800/30">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-violet-800 dark:text-violet-300">Dynamic URL — Meta Parameters</p>
                  <p className="text-[10px] text-violet-600/70 dark:text-violet-400/70">بيتملى تلقائياً من Meta — استخدمه على مستوى الحملة أو الـ Ad Set</p>
                </div>
              </div>
              <button
                onClick={() => copy(dynamicUrl, "dynamic")}
                className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ms-3 ${
                  copiedDynamic
                    ? "bg-violet-500 text-white border-violet-500"
                    : "bg-white dark:bg-muted border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                }`}
              >
                {copiedDynamic ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedDynamic ? "تم النسخ ✓" : "نسخ"}
              </button>
            </div>
            <div className="px-4 py-3 space-y-2">
              <code
                dir="ltr"
                className="block text-[12px] font-mono text-violet-900 dark:text-violet-200 break-all leading-relaxed select-all cursor-text"
              >
                {dynamicUrl}
              </code>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-violet-100 dark:border-violet-800/30">
                {[
                  { param: "{{campaign.name}}", desc: "اسم الحملة" },
                  { param: "{{ad.name}}", desc: "اسم الإعلان" },
                  { param: "{{placement}}", desc: "الموضع (Feed / Stories…)" },
                ].map(({ param, desc }) => (
                  <span key={param} className="text-[10px] text-violet-600/80 dark:text-violet-400/80 flex items-center gap-1">
                    <code className="font-mono bg-violet-100 dark:bg-violet-900/40 px-1 rounded">{param}</code>
                    <span>= {desc}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
