import { createContext, useContext } from "react";

export interface GlobalAiChatContextValue {
  openToConversation: (convId: number, campaignId?: string | null) => void;
  pendingCampaignId: string | null;
  clearPendingCampaignId: () => void;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
}

export const GlobalAiChatContext = createContext<GlobalAiChatContextValue>({
  openToConversation: () => {},
  pendingCampaignId: null,
  clearPendingCampaignId: () => {},
  selectedAccountId: null,
  setSelectedAccountId: () => {},
});

export function useGlobalAiChat(): GlobalAiChatContextValue {
  return useContext(GlobalAiChatContext);
}
