import { createContext, useContext, useState, type ReactNode } from "react";

export interface DateRange {
  since: string;
  until: string;
}

interface DashboardContextValue {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  selectedAccount: string;
  setSelectedAccount: (id: string) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function defaultRange(): DateRange {
  const today = new Date();
  const since = new Date(today);
  since.setDate(today.getDate() - 14);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(today) };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);
  const [selectedAccount, setSelectedAccount] = useState("");

  return (
    <DashboardContext.Provider
      value={{ dateRange, setDateRange, selectedAccount, setSelectedAccount }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be inside DashboardProvider");
  return ctx;
}
