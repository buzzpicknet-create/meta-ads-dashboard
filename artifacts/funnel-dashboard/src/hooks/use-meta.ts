import { useQuery } from "@tanstack/react-query";
import {
  fetchAccount,
  fetchCampaigns,
  fetchInsights,
  fetchTokenHealth,
} from "@/lib/meta-api";

const ONE_HOUR = 60 * 60 * 1000;

export function useAccount() {
  return useQuery({
    queryKey: ["meta", "account"],
    queryFn: fetchAccount,
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

export function useCampaigns(opts: { since: string; until: string }) {
  return useQuery({
    queryKey: ["meta", "campaigns", opts.since, opts.until],
    queryFn: () => fetchCampaigns(opts),
    staleTime: ONE_HOUR,
    enabled: Boolean(opts.since && opts.until),
  });
}

export function useInsights(opts: {
  campaign_id: string | null;
  since: string;
  until: string;
}) {
  return useQuery({
    queryKey: ["meta", "insights", opts.campaign_id, opts.since, opts.until],
    queryFn: () =>
      fetchInsights({
        campaign_id: opts.campaign_id!,
        since: opts.since,
        until: opts.until,
      }),
    staleTime: ONE_HOUR,
    enabled: Boolean(opts.campaign_id && opts.since && opts.until),
  });
}
