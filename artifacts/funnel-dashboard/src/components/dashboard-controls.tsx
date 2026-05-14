import { useMemo, useState, useRef, useEffect } from "react";
import { CalendarRange, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type CampaignSummary,
  type AdAccountSummary,
  type DatePreset,
  formatRange,
} from "@/lib/meta-api";

interface Props {
  campaigns: CampaignSummary[] | undefined;
  accounts: AdAccountSummary[] | undefined;
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  isLoadingCampaigns: boolean;
  selectedCampaignId: string | null;
  onSelectCampaign: (id: string) => void;
  preset: DatePreset;
  onPresetChange: (p: DatePreset) => void;
  range: { since: string; until: string };
  customRange: { since: string; until: string };
  onCustomRangeChange: (r: { since: string; until: string }) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated?: string;
}

const presetLabels: Record<DatePreset, string> = {
  today: "اليوم",
  yesterday: "أمس",
  "7d": "آخر 7 أيام",
  "14d": "آخر 14 يوم",
  "28d": "آخر 28 يوم",
  current_month: "الشهر الحالي",
  prev_month: "الشهر السابق",
  custom: "مخصص",
};

export function DashboardControls({
  campaigns,
  accounts,
  selectedAccountId,
  onSelectAccount,
  isLoadingCampaigns,
  selectedCampaignId,
  onSelectCampaign,
  preset,
  onPresetChange,
  range,
  customRange,
  onCustomRangeChange,
  onRefresh,
  isRefreshing,
  lastUpdated,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const sortedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return [...campaigns].sort((a, b) => {
      const aActive = a.effective_status === "ACTIVE" ? 1 : 0;
      const bActive = b.effective_status === "ACTIVE" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.spend - a.spend;
    });
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    if (!searchQuery.trim()) return sortedCampaigns;
    const q = searchQuery.toLowerCase();
    return sortedCampaigns.filter((c) => c.name.toLowerCase().includes(q));
  }, [sortedCampaigns, searchQuery]);

  const selectedCampaign = sortedCampaigns.find((c) => c.id === selectedCampaignId);

  const withSpend = sortedCampaigns.filter((c) => c.spend > 0);
  const noSpend = sortedCampaigns.filter((c) => c.spend === 0);

  const fmtSpend = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const fmtAgo = (iso: string | undefined) => {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "الآن";
    if (min < 60) return `منذ ${min} دقيقة`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `منذ ${hr} ساعة`;
    return `منذ ${Math.floor(hr / 24)} يوم`;
  };

  const today = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-end gap-3 sm:gap-4">
        {/* Account Selector */}
        <div className="flex-1 min-w-[220px] space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            الحساب
          </label>
          <Select
            key={selectedAccountId ?? "none"}
            value={selectedAccountId || ""}
            onValueChange={onSelectAccount}
            dir="rtl"
          >
            <SelectTrigger className="w-full h-11 text-right">
              <SelectValue placeholder="اختر حساب" />
            </SelectTrigger>
            <SelectContent>
              {(accounts ?? []).map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <span className="truncate max-w-[280px]">{account.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Campaign Search */}
        <div className="flex-1 min-w-[240px] space-y-1.5" ref={searchRef}>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            الحملة
          </label>
          <div className="relative">
            <div className="relative flex items-center">
              <Search className="absolute right-3 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                dir="rtl"
                disabled={isLoadingCampaigns || !campaigns}
                placeholder={
                  isLoadingCampaigns
                    ? "جاري تحميل الحملات..."
                    : selectedCampaign
                    ? selectedCampaign.name
                    : "ابحث باسم الحملة..."
                }
                value={isOpen ? searchQuery : ""}
                onFocus={() => {
                  setSearchQuery("");
                  setIsOpen(true);
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-11 pr-9 pl-8 rounded-md border border-input bg-background text-sm text-right placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {isOpen && searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute left-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {!isOpen && selectedCampaign && (
                <span className="absolute left-2.5 text-xs text-muted-foreground tabular-nums ltr whitespace-nowrap">
                  {fmtSpend(selectedCampaign.spend)} EGP
                </span>
              )}
            </div>

            {isOpen && (
              <div className="absolute z-50 mt-1 w-full max-h-[380px] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
                {filteredCampaigns.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد حملات مطابقة
                  </div>
                ) : (
                  <>
                    {filteredCampaigns.filter((c) => c.spend > 0).length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 border-b border-border">
                          حملات بإنفاق ({filteredCampaigns.filter((c) => c.spend > 0).length})
                        </div>
                        {filteredCampaigns
                          .filter((c) => c.spend > 0)
                          .map((c) => (
                            <button
                              key={c.id}
                              onMouseDown={() => {
                                onSelectCampaign(c.id);
                                setIsOpen(false);
                                setSearchQuery("");
                              }}
                              className={`flex items-center justify-between w-full px-3 py-2.5 text-right text-sm hover:bg-accent transition-colors gap-3 ${selectedCampaignId === c.id ? "bg-accent/60 font-medium" : ""}`}
                            >
                              <span className="truncate flex-1">{c.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums ltr">
                                {fmtSpend(c.spend)} EGP
                                {c.purchases > 0 && (
                                  <span className="mx-1.5 text-emerald-600">· {c.purchases} طلب</span>
                                )}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                    {filteredCampaigns.filter((c) => c.spend === 0).length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 border-b border-t border-border">
                          بدون إنفاق ({filteredCampaigns.filter((c) => c.spend === 0).length})
                        </div>
                        {filteredCampaigns
                          .filter((c) => c.spend === 0)
                          .slice(0, 50)
                          .map((c) => (
                            <button
                              key={c.id}
                              onMouseDown={() => {
                                onSelectCampaign(c.id);
                                setIsOpen(false);
                                setSearchQuery("");
                              }}
                              className={`flex items-center w-full px-3 py-2.5 text-right text-sm hover:bg-accent transition-colors ${selectedCampaignId === c.id ? "bg-accent/60 font-medium" : ""}`}
                            >
                              <span className="truncate">{c.name}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Date Preset */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            الفترة
          </label>
          <Select
            value={preset}
            onValueChange={(v) => onPresetChange(v as DatePreset)}
            dir="rtl"
          >
            <SelectTrigger className="h-11 min-w-[170px]">
              <CalendarRange className="h-4 w-4 ml-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>فترات سريعة</SelectLabel>
                {(["today", "yesterday", "7d", "14d", "28d"] as DatePreset[]).map((p) => (
                  <SelectItem key={p} value={p}>{presetLabels[p]}</SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>شهري</SelectLabel>
                {(["current_month", "prev_month"] as DatePreset[]).map((p) => (
                  <SelectItem key={p} value={p}>{presetLabels[p]}</SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>مخصص</SelectLabel>
                <SelectItem value="custom">مخصص</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Refresh */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider invisible">
            تحديث
          </label>
          <Button onClick={onRefresh} disabled={isRefreshing} variant="outline" className="h-11 gap-2">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            تحديث
          </Button>
        </div>
      </div>

      {/* Custom date inputs */}
      {preset === "custom" && (
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              من تاريخ
            </label>
            <input
              type="date"
              max={customRange.until || today}
              value={customRange.since}
              onChange={(e) => onCustomRangeChange({ ...customRange, since: e.target.value })}
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              إلى تاريخ
            </label>
            <input
              type="date"
              min={customRange.since}
              max={today}
              value={customRange.until}
              onChange={(e) => onCustomRangeChange({ ...customRange, until: e.target.value })}
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {customRange.since && customRange.until && (
            <div className="text-xs text-muted-foreground self-center pt-5">
              {Math.round((new Date(customRange.until).getTime() - new Date(customRange.since).getTime()) / 86400000) + 1} يوم
            </div>
          )}
        </div>
      )}

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          فترة البيانات:{" "}
          <span className="num font-medium text-foreground">{formatRange(range.since, range.until)}</span>
        </div>
        {lastUpdated && (
          <div>
            آخر تحديث:{" "}
            <span className="font-medium text-foreground">{fmtAgo(lastUpdated)}</span>
          </div>
        )}
        {campaigns && (
          <div>
            متاح: <span className="num font-medium text-foreground">{withSpend.length}</span> حملة بإنفاق
          </div>
        )}
      </div>
    </div>
  );
}
