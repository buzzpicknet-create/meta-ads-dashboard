import { PauseCircle, Rocket, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type Item = { text: string; sub?: string };

const stop: Item[] = [
  { text: 'Ad Set "Broad - 2 images"', sub: "CPA 125 EGP" },
  { text: "Creative ad2 (الصورتين)", sub: "Hook Rate 1%" },
  { text: 'Headline B "تنضيف عميق للمسام"', sub: "CPA 62 EGP" },
];

const scale: Item[] = [
  { text: "Ad Set Broad", sub: "CPA 29 EGP — ضاعفي ميزانيته 30-50%" },
  { text: "Creative ad1 (الفيديو)", sub: "Hook Rate 27%" },
  { text: 'Headline A "ودّعي الرؤوس السوداء"', sub: "CPA 34 EGP" },
];

const fixToday: Item[] = [
  { text: "جرّبي فورم الطلب بنفسك دلوقتي", sub: "موبايل + كمبيوتر — ده أكبر مصدر للخسارة" },
];

function Column({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: Item[];
  tone: "kill" | "scale" | "fix";
}) {
  const config = {
    kill: {
      ring: "ring-rose-500/30",
      iconBg: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
      title: "text-rose-700 dark:text-rose-400",
      bullet: "bg-rose-500",
    },
    scale: {
      ring: "ring-emerald-500/30",
      iconBg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      title: "text-emerald-700 dark:text-emerald-400",
      bullet: "bg-emerald-500",
    },
    fix: {
      ring: "ring-amber-500/30",
      iconBg: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      title: "text-amber-700 dark:text-amber-400",
      bullet: "bg-amber-500",
    },
  }[tone];

  return (
    <div className={`rounded-xl bg-card p-4 ring-1 ring-inset ${config.ring} space-y-3`}>
      <div className="flex items-center gap-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${config.iconBg}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className={`text-sm font-bold ${config.title}`}>{title}</div>
      </div>
      <ul className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${config.bullet}`}
            />
            <div className="min-w-0 space-y-0.5">
              <div className="text-sm font-medium leading-snug">{it.text}</div>
              {it.sub && (
                <div className="text-xs text-muted-foreground leading-snug">
                  {it.sub}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExecutiveSummary() {
  return (
    <Card className="border-primary/20">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold">القرارات في 30 ثانية</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              لو ما عندكيش وقت تقري الباقي، اعملي اللي في الـ 3 كروت دول
            </p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <Column icon={PauseCircle} title="أوقفي دلوقتي" items={stop} tone="kill" />
          <Column icon={Rocket} title="ضاعفي على" items={scale} tone="scale" />
          <Column icon={Wrench} title="صلّحي اليوم" items={fixToday} tone="fix" />
        </div>
      </CardContent>
    </Card>
  );
}
