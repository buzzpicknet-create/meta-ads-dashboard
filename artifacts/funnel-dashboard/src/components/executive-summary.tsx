import { PauseCircle, Rocket, Wrench, Sparkles, Megaphone, Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { DerivedMetrics, SegmentEntry } from "@/lib/meta-api";

type Item = { text: string; sub?: string };

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
        {items.length === 0 ? (
          <li className="text-xs text-muted-foreground italic">
            لا توجد توصيات في الفترة دي
          </li>
        ) : (
          items.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${config.bullet}`}
              />
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium leading-snug">{it.text}</div>
                {it.sub && (
                  <div className="text-xs text-muted-foreground leading-snug num">
                    {it.sub}
                  </div>
                )}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

interface Props {
  totals: DerivedMetrics;
  byAd: SegmentEntry[];
  byAdset: SegmentEntry[];
  campaignName?: string;
  headlineWinner?: SegmentEntry | null;
  adsetWinner?: SegmentEntry | null;
  mediaWinner?: SegmentEntry | null;
}

function fmt(n: number, d = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function ExecutiveSummary({
  totals,
  campaignName,
  headlineWinner,
  adsetWinner,
  mediaWinner,
}: Props) {
  const topItems: Item[] = [
    headlineWinner
      ? {
          text: `أفضل Headline: ${headlineWinner.label}`,
          sub: `CPA ${fmt(headlineWinner.cpa, 2)} EGP · ${fmt(headlineWinner.purchases)} طلب`,
        }
      : { text: "أفضل Headline: لا توجد بيانات كافية" },
    adsetWinner
      ? {
          text: `أفضل Ad Set: ${adsetWinner.label}`,
          sub: `CPA ${fmt(adsetWinner.cpa, 2)} EGP · ${fmt(adsetWinner.purchases)} طلب`,
        }
      : { text: "أفضل Ad Set: لا توجد بيانات كافية" },
    mediaWinner
      ? {
          text: `أفضل Video / Media: ${mediaWinner.label}`,
          sub: `CPA ${fmt(mediaWinner.cpa, 2)} EGP · ${fmt(mediaWinner.purchases)} طلب`,
        }
      : { text: "أفضل Video / Media: لا توجد بيانات كافية" },
  ];

  // Fix recommendations based on funnel weak points
  const fixItems: Item[] = [];
  if (totals.crLpv < 5 && totals.lpv > 0) {
    fixItems.push({
      text: "تحسين تحويل صفحة المنتج",
      sub: `CR من LPV حالياً ${fmt(totals.crLpv, 2)}% — راجعي الفورم والـ Checkout`,
    });
  }
  if (totals.hookRate < 30) {
    fixItems.push({
      text: "اشتغلي على Hook الفيديو",
      sub: `Hook Rate ${fmt(totals.hookRate, 1)}% — أول 3 ثواني محتاجة قوة`,
    });
  }
  if (totals.ctr < 1.5) {
    fixItems.push({
      text: "حسّني الـ Creative للـ CTR",
      sub: `CTR ${fmt(totals.ctr, 2)}% — أقل من المعدل الصحي`,
    });
  }
  if (totals.lpvRate < 70 && totals.link_clicks > 0) {
    fixItems.push({
      text: "صفحة الـ Landing بطيئة أو مش جذابة",
      sub: `${fmt(totals.lpvRate, 1)}% فقط من الكليكات وصلت للصفحة`,
    });
  }
  if (fixItems.length === 0) {
    fixItems.push({
      text: "الفانل سليم — ركّزي على Scaling",
      sub: "كل المراحل بتعمل في النطاق الصحي",
    });
  }

  return (
    <Card className="border-primary/20">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold">القرارات في 30 ثانية</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {campaignName ? `الحملة الحالية: ${campaignName}` : "أهم 3 رابحين من Meta"}
            </p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <Column icon={Sparkles} title="Headline الرابح" items={[topItems[0]]} tone="scale" />
          <Column icon={Megaphone} title="Ad Set الرابح" items={[topItems[1]]} tone="scale" />
          <Column icon={Video} title="Video / Media الرابحة" items={[topItems[2]]} tone="scale" />
        </div>
      </CardContent>
    </Card>
  );
}
