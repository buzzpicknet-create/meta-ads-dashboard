import { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, TrendingUp, Circle } from "lucide-react";
import { useLocation } from "wouter";
import { useAccounts, useCampaigns } from "@/hooks/use-meta";
import { rangeFromPreset } from "@/lib/meta-api";
import type { CampaignSummary } from "@/lib/meta-api";

export const GLOBAL_CAMPAIGN_KEY = "global_selected_campaign";

export function GlobalCampaignSearch() {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [, navigate] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: accountsData } = useAccounts();
  const firstAccount = accountsData?.accounts?.[0];

  const range = useMemo(() => rangeFromPreset("7d"), []);

  const { data: campaignsData } = useCampaigns({
    since: range.since,
    until: range.until,
    ad_account_id: firstAccount?.id,
  });

  const allCampaigns: CampaignSummary[] = useMemo(() => {
    const list = campaignsData?.campaigns ?? [];
    return [...list].sort((a, b) => {
      const aActive = a.effective_status === "ACTIVE" ? 1 : 0;
      const bActive = b.effective_status === "ACTIVE" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.spend - a.spend;
    });
  }, [campaignsData]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allCampaigns.slice(0, 6);
    const q = query.toLowerCase();
    return allCampaigns.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [allCampaigns, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectCampaign = (campaign: CampaignSummary) => {
    sessionStorage.setItem(
      GLOBAL_CAMPAIGN_KEY,
      JSON.stringify({ accountId: firstAccount?.id, campaignId: campaign.id })
    );
    setQuery("");
    setIsOpen(false);
    navigate("/");
  };

  const clear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative w-56">
      <div className="relative">
        <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          dir="rtl"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder="ابحث عن حملة…"
          className="w-full h-8 rounded-lg border border-border bg-muted/40 pr-8 pl-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
        />
        {query && (
          <button onClick={clear} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {isOpen && filtered.length > 0 && (
        <div
          className="absolute top-full mt-1.5 w-72 right-0 z-[200] rounded-xl border border-border bg-background shadow-lg overflow-hidden"
          dir="rtl"
        >
          {!query.trim() && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground border-b border-border/50 font-medium">
              الحملات الأخيرة
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {filtered.map((c) => {
              const isActive = c.effective_status === "ACTIVE";
              return (
                <button
                  key={c.id}
                  onClick={() => selectCampaign(c)}
                  className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-muted/60 transition-colors text-start border-b border-border/30 last:border-0"
                >
                  <div className="shrink-0 mt-0.5">
                    <Circle
                      className={`h-2 w-2 fill-current ${isActive ? "text-emerald-500" : "text-muted-foreground/40"}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate leading-snug">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {c.spend > 0 ? `${c.spend.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} EGP إنفاق` : "بدون إنفاق"}
                      {c.purchases > 0 && ` · ${c.purchases} أوردر`}
                    </p>
                  </div>
                  <TrendingUp className="h-3 w-3 shrink-0 text-muted-foreground/40 mt-1" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
