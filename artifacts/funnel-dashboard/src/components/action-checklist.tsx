import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  PauseCircle,
  Rocket,
  RotateCcw,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { actionPlan, type ActionItem } from "@/lib/data";

const STORAGE_KEY = "funnel-checklist-v1";

function Num({ children }: { children: React.ReactNode }) {
  return <span className="num">{children}</span>;
}

const priorityConfig = {
  kill: {
    icon: PauseCircle,
    label: "أوقفي",
    cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/30",
  },
  scale: {
    icon: Rocket,
    label: "ضاعفي",
    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30",
  },
  test: {
    icon: Zap,
    label: "اختبري",
    cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/30",
  },
  fix: {
    icon: Wrench,
    label: "صلّحي",
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30",
  },
};

export function ActionChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDone(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  function toggle(id: string) {
    setDone(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function reset() {
    setDone({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  const completedCount = actionPlan.filter(a => done[a.id]).length;
  const total = actionPlan.length;
  const progress = (completedCount / total) * 100;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4 text-emerald-500" />
              خطة العمل التنفيذية — اشطبي اللي تنفّذيه
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1.5">
              تقدّمك بيتحفظ تلقائياً في المتصفح
            </p>
          </div>
          {completedCount > 0 && (
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5 ml-1.5" />
              صفّري
            </Button>
          )}
        </div>

        {/* Progress */}
        <div className="mt-4 space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <div className="font-semibold">
              نفّذتي <Num>{completedCount}</Num> من <Num>{total}</Num>
            </div>
            <div className="text-muted-foreground tabular-nums">
              <Num>{Math.round(progress)}%</Num>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-2">
        {actionPlan.map((item, idx) => (
          <ChecklistRow
            key={item.id}
            item={item}
            idx={idx}
            done={!!done[item.id]}
            onToggle={() => toggle(item.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ChecklistRow({
  item,
  idx,
  done,
  onToggle,
}: {
  item: ActionItem;
  idx: number;
  done: boolean;
  onToggle: () => void;
}) {
  const config = priorityConfig[item.priority];
  const Icon = config.icon;

  return (
    <button
      onClick={onToggle}
      className={`group w-full text-right flex items-start gap-3 rounded-xl border p-3.5 transition-all hover-elevate ${
        done
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border bg-card"
      }`}
    >
      <div className="shrink-0 mt-0.5">
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        )}
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground font-bold text-xs tabular-nums">
        <Num>{String(idx + 1).padStart(2, "0")}</Num>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${config.cls}`}
          >
            <Icon className="h-3 w-3" />
            {config.label}
          </span>
          {item.expectedSaving && (
            <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
              <TrendingUp className="h-3 w-3" />
              {item.expectedSaving}
            </span>
          )}
        </div>
        <h4
          className={`text-sm font-semibold leading-snug ${
            done ? "line-through text-muted-foreground" : ""
          }`}
        >
          {item.title}
        </h4>
        <p
          className={`text-xs leading-relaxed ${
            done ? "text-muted-foreground/70" : "text-muted-foreground"
          }`}
        >
          {item.why}
        </p>
      </div>
    </button>
  );
}
