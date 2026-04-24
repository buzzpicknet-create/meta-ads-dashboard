import { useMemo } from "react";
import { CalendarRange, ChevronDown, RefreshCw } from "lucide-react";
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
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated?: string;
}

const presetLabels: Record<DatePreset, string> = {
  yesterday: "أمس",
  "7d": "آخر 7 أيام",
  "14d": "آخر 14 يوم",
  "30d": "آخر 30 يوم",
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
  onRefresh,
  isRefreshing,
  lastUpdated,
}: Props) {
  // Sort & group campaigns: active with spend first, then paused, then no-spend
  const sortedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return [...campaigns].sort((a, b) => {
      const aActive = a.effective_status === "ACTIVE" ? 1 : 0;
      const bActive = b.effective_status === "ACTIVE" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.spend - a.spend;
    });
  }, [campaigns]);

  const withSpend = sortedCampaigns.filter((c) => c.spend > 0);
  const noSpend = sortedCampaigns.filter((c) => c.spend === 0);

  const fmtSpend = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const fmtAgo = (iso: string | undefined) => {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "الآن";
    if (min < 60) return `منذ ${min} دقيقة`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `منذ ${hr} ساعة`;
    const day = Math.floor(hr / 24);
    return `منذ ${day} يوم`;
  };

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-end gap-3 sm:gap-4">
        <div className="flex-1 min-w-[240px] space-y-1.5">
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
                  <div className="flex items-center justify-between gap-3 w-full">
                    <span className="truncate max-w-[280px]">{account.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {account.id}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Campaign Selector */}
        <div className="flex-1 min-w-[260px] space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            الحملة
          </label>
          <Select
            key={selectedAccountId ?? "none"}
            value={selectedCampaignId || ""}
            onValueChange={onSelectCampaign}
            disabled={isLoadingCampaigns || !campaigns}
            dir="rtl"
          >
            <SelectTrigger className="w-full h-11 text-right">
              <SelectValue
                placeholder={
                  isLoadingCampaigns
                    ? "جاري تحميل الحملات..."
                    : "اختر حملة"
                }
              />
            </SelectTrigger>
            <SelectContent className="max-h-[420px]">
              {withSpend.length > 0 && (
                <SelectGroup>
                  <SelectLabel>
                    حملات نشطة بإنفاق ({withSpend.length})
                  </SelectLabel>
                  {withSpend.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center justify-between gap-3 w-full text-right">
                        <span className="truncate max-w-[280px]">{c.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums ltr">
                          {fmtSpend(c.spend)} EGP
                          {c.purchases > 0 && (
                            <span className="mx-1.5 text-emerald-600 dark:text-emerald-400">
                              · {c.purchases} طلب
                            </span>
                          )}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {noSpend.length > 0 && (
                <SelectGroup>
                  <SelectLabel>
                    بدون إنفاق في الفترة ({noSpend.length})
                  </SelectLabel>
                  {noSpend.slice(0, 50).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="truncate max-w-[420px]">{c.name}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Date Range Preset */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            الفترة
          </label>
          <Select
            value={preset}
            onValueChange={(v) => onPresetChange(v as DatePreset)}
            dir="rtl"
          >
            <SelectTrigger className="h-11 min-w-[160px]">
              <CalendarRange className="h-4 w-4 ml-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(presetLabels) as DatePreset[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {presetLabels[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Refresh Button */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider invisible">
            تحديث
          </label>
          <Button
            onClick={onRefresh}
            disabled={isRefreshing}
            variant="outline"
            className="h-11 gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            تحديث
          </Button>
        </div>
      </div>

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          فترة البيانات: <span className="num font-medium text-foreground">{formatRange(range.since, range.until)}</span>
        </div>
        {lastUpdated && (
          <div>
            آخر تحديث:{" "}
            <span className="font-medium text-foreground">
              {fmtAgo(lastUpdated)}
            </span>
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
