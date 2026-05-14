import { createContext, useContext } from "react";

export interface GlobalAiChatContextValue {
  openToConversation: (convId: number, campaignId?: string | null) => void;
  pendingCampaignId: string | null;
  clearPendingCampaignId: () => void;
}

export const GlobalAiChatContext = createContext<GlobalAiChatContextValue>({
  openToConversation: () => {},
  pendingCampaignId: null,
  clearPendingCampaignId: () => {},
});

export function useGlobalAiChat(): GlobalAiChatContextValue {
  return useContext(GlobalAiChatContext);
}
