import { useState } from "react";
import { Link2, Copy, CheckCheck, ExternalLink } from "lucide-react";

function extractHandle(input: string): string {
  const s = input.trim();
  const m = s.match(/\/products\/([^?&#/\s]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-]+$/.test(s)) return s.toLowerCase();
  return s.replace(/\s+/g, "-").toLowerCase();
}

function slugify(text: string): string {
  return text.trim().replace(/\s+/g, "-");
}

interface UtmBuilderProps {
  storeBaseUrl?: string;
}

export function UtmBuilder({ storeBaseUrl = "https://your-store.com" }: UtmBuilderProps) {
  const [productUrl, setProductUrl] = useState("");
  const [angle, setAngle] = useState("");
  const [copiedFinal, setCopiedFinal] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  const handle = productUrl.trim() ? extractHandle(productUrl) : "";
  const angleSlug = angle.trim() ? slugify(angle) : "{adname}";
  const hasInputs = handle && productUrl.trim();

  const finalUrl = `${storeBaseUrl}/products/${handle}?utm_source=Google&utm_medium=${angleSlug}&utm_campaign=${handle}`;
  const trackingTemplate = `{lpurl}?utm_source=Google&utm_medium=${angleSlug}&utm_campaign=${handle}`;

  function copy(text: string, which: "final" | "template") {
    navigator.clipboard.writeText(text).then(() => {
      if (which === "final") {
        setCopiedFinal(true);
        setTimeout(() => setCopiedFinal(false), 2000);
      } else {
        setCopiedTemplate(true);
        setTimeout(() => setCopiedTemplate(false), 2000);
      }
    });
  }

  return (
    <div dir="rtl" className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
          <Link2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">UTM Builder</h2>
          <p className="text-[11px] text-muted-foreground">أنشئ UTM links جاهزة لحملات Google Ads</p>
        </div>
      </div>

      {/* Inputs — 2-col on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Product URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">رابط المنتج</label>
          <input
            type="text"
            dir="ltr"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://your-store.com/products/magic-roll"
            className="w-full text-sm rounded-xl border border-border bg-white dark:bg-card px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 placeholder:text-muted-foreground/50 transition-all"
          />
          {handle && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <span className="font-mono bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">handle: {handle}</span>
            </p>
          )}
        </div>

        {/* Angle name */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">اسم الزاوية (الكريتيف)</label>
          <input
            type="text"
            dir="ltr"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="before-after or زاوية-الألم or ad1"
            className="w-full text-sm rounded-xl border border-border bg-white dark:bg-card px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 placeholder:text-muted-foreground/50 transition-all"
          />
          {angle.trim() && (
            <p className="text-[11px] text-blue-700 dark:text-blue-400 flex items-center gap-1">
              <span className="font-mono bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">utm_medium: {slugify(angle)}</span>
            </p>
          )}
        </div>
      </div>

      {/* UTM Pills */}
      {hasInputs && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800/50">
            utm_source=Google
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
            utm_medium={angleSlug}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800/50">
            utm_campaign={handle}
          </span>
        </div>
      )}

      {/* Output boxes or empty state */}
      {!hasInputs ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-emerald-200 dark:border-emerald-800/40 py-8 text-center">
          <Link2 className="h-8 w-8 text-emerald-300 dark:text-emerald-700" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">أدخل رابط المنتج لإنشاء UTM links</p>
            <p className="text-xs text-muted-foreground/60">ادخل الرابط واسم الزاوية وهيتولد الـ UTM تلقائياً</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Final URL box */}
          <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-700/50 bg-white dark:bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-100 dark:border-emerald-800/30">
              <div className="flex items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">رابط الإعلان النهائي — Final URL</span>
              </div>
              <button
                onClick={() => copy(finalUrl, "final")}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                  copiedFinal
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-white dark:bg-muted border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                }`}
              >
                {copiedFinal ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedFinal ? "تم النسخ ✓" : "نسخ"}
              </button>
            </div>
            <div className="px-4 py-3">
              <code
                dir="ltr"
                className="block text-[12px] font-mono text-emerald-900 dark:text-emerald-200 break-all leading-relaxed select-all cursor-text"
              >
                {finalUrl}
              </code>
            </div>
          </div>

          {/* Tracking Template box */}
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-100 dark:border-amber-800/30">
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-300">Google Ads — Tracking Template</p>
                <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 mt-0.5">ضعه في حقل URL suffix أو Tracking template في Google Ads على مستوى الحملة</p>
              </div>
              <button
                onClick={() => copy(trackingTemplate, "template")}
                className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ms-3 ${
                  copiedTemplate
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-white dark:bg-muted border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                }`}
              >
                {copiedTemplate ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedTemplate ? "تم النسخ ✓" : "نسخ"}
              </button>
            </div>
            <div className="px-4 py-3">
              <code
                dir="ltr"
                className="block text-[12px] font-mono text-amber-900 dark:text-amber-200 break-all leading-relaxed select-all cursor-text"
              >
                {trackingTemplate}
              </code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
