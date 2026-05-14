import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  badge,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 group"
      >
        <span className="flex-1 text-right text-xs font-bold uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
          {title}
        </span>
        {badge}
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground group-hover:text-foreground transition-all duration-200 shrink-0 ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        />
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          open ? "opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        }`}
        style={open ? undefined : { maxHeight: 0 }}
      >
        {children}
      </div>
    </div>
  );
}
