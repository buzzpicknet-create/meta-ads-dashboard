import { type ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon?: ReactNode;
  highlight?: "good" | "warn" | "danger" | "neutral";
  loading?: boolean;
}

export function KpiCard({
  label,
  value,
  change,
  changeLabel,
  icon,
  highlight = "neutral",
  loading = false,
}: KpiCardProps) {
  const highlightBorder = {
    good: "border-t-emerald-500",
    warn: "border-t-amber-400",
    danger: "border-t-red-500",
    neutral: "border-t-slate-600",
  }[highlight];

  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div
      className={cn(
        "relative bg-slate-800/80 rounded-xl border border-slate-700 border-t-2 p-4 flex flex-col gap-1 shadow-sm",
        highlightBorder
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-medium">{label}</span>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>
      {loading ? (
        <div className="h-8 bg-slate-700 rounded animate-pulse w-24 mt-1" />
      ) : (
        <p className="text-2xl font-bold text-white mt-1 tracking-tight">{value}</p>
      )}
      {change !== undefined && (
        <div className="flex items-center gap-1 mt-1">
          {isPositive ? (
            <TrendingUp className="w-3 h-3 text-emerald-400" />
          ) : isNegative ? (
            <TrendingDown className="w-3 h-3 text-red-400" />
          ) : (
            <Minus className="w-3 h-3 text-slate-400" />
          )}
          <span
            className={cn(
              "text-xs font-semibold",
              isPositive && "text-emerald-400",
              isNegative && "text-red-400",
              !isPositive && !isNegative && "text-slate-400"
            )}
          >
            {change > 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>
          {changeLabel && (
            <span className="text-xs text-slate-500">{changeLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
