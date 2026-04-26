import { useQuery } from "@tanstack/react-query";
import {
  fetchAccounts,
  fetchAccount,
  fetchCampaigns,
  fetchCampaignsForAccount,
  fetchInsights,
  fetchTokenHealth,
  fetchAccountOverview,
  fetchCpaAlerts,
  fetchBreakdowns,
} from "@/lib/meta-api";

const ONE_HOUR = 60 * 60 * 1000;

export function useAccount() {
  return useQuery({
    queryKey: ["meta", "account"],
    queryFn: fetchAccount,
    staleTime: ONE_HOUR,
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ["meta", "accounts"],
    queryFn: fetchAccounts,
    staleTime: ONE_HOUR,
  });
}

export function useTokenHealth() {
  return useQuery({
    queryKey: ["meta", "token-health"],
    queryFn: fetchTokenHealth,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCampaigns(opts: {
  since: string;
  until: string;
  ad_account_id?: string;
}) {
  return useQuery({
    queryKey: [
      "meta",
      "campaigns",
      opts.since,
      opts.until,
      opts.ad_account_id || "",
    ],
    queryFn: () => {
      if (!opts.ad_account_id) {
        throw new Error("ad_account_id is required");
      }
      return fetchCampaignsForAccount({
        ad_account_id: opts.ad_account_id,
        since: opts.since,
        until: opts.until,
      });
    },
    staleTime: ONE_HOUR,
    enabled: Boolean(opts.since && opts.until && opts.ad_account_id),
  });
}

export function useAccountOverview(opts: {
  ad_account_id: string | null;
  since: string;
  until: string;
}) {
  return useQuery({
    queryKey: ["meta", "account-overview", opts.ad_account_id, opts.since, opts.until],
    queryFn: () =>
      fetchAccountOverview({
        ad_account_id: opts.ad_account_id!,
        since: opts.since,
        until: opts.until,
      }),
    staleTime: ONE_HOUR,
    enabled: Boolean(opts.ad_account_id && opts.since && opts.until),
  });
}

export function useCpaAlerts(opts: { ad_account_id: string | null }) {
  return useQuery({
    queryKey: ["meta", "cpa-alerts", opts.ad_account_id],
    queryFn: () => fetchCpaAlerts({ ad_account_id: opts.ad_account_id! }),
    staleTime: 15 * 60 * 1000, // 15 min — alerts are time-sensitive
    enabled: Boolean(opts.ad_account_id),
  });
}

export function useInsights(opts: {
  campaign_id: string | null;
  since: string;
  until: string;
  ad_account_id?: string;
}) {
  return useQuery({
    queryKey: [
      "meta",
      "insights",
      opts.campaign_id,
      opts.since,
      opts.until,
      opts.ad_account_id || "",
    ],
    queryFn: () =>
      fetchInsights({
        campaign_id: opts.campaign_id!,
        ad_account_id: opts.ad_account_id,
        since: opts.since,
        until: opts.until,
      }),
    staleTime: ONE_HOUR,
    enabled: Boolean(
      opts.campaign_id && opts.since && opts.until && opts.ad_account_id,
    ),
  });
}

export function useBreakdowns(opts: {
  campaign_id: string | null;
  since: string;
  until: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ["meta", "breakdowns", opts.campaign_id, opts.since, opts.until],
    queryFn: () =>
      fetchBreakdowns({
        campaign_id: opts.campaign_id!,
        since: opts.since,
        until: opts.until,
      }),
    staleTime: 8 * 60 * 1000, // 8 min — matches server cache
    enabled: Boolean(opts.enabled && opts.campaign_id && opts.since && opts.until),
  });
}
