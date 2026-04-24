import { useMemo, useState } from "react";
import { Calculator, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { DerivedMetrics, SegmentEntry } from "@/lib/meta-api";

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="num">{children}</span>;
}

function MetricBlock({
  label,
  before,
  after,
  unit = "",
  betterDir,
  highlight,
}: {
  label: string;
  before: number;
  after: number;
  unit?: string;
  betterDir: "up" | "down";
  highlight?: boolean;
}) {
  const delta = after - before;
  const pct = before > 0 ? (delta / before) * 100 : 0;
  const isBetter = betterDir === "up" ? delta > 0 : delta < 0;
  const isSame = Math.abs(delta) < 0.01;

  const toneCls = isSame
    ? "text-muted-foreground"
    : isBetter
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";

  const isCpa = label === "CPA";

  return (
    <div
      className={`rounded-lg p-3 ${
        highlight
          ? "bg-primary/5 ring-1 ring-inset ring-primary/20"
          : "bg-muted/40"
      }`}
    >
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <div className="text-xs text-muted-foreground line-through tabular-nums">
          <Num>
            {fmt(before, isCpa ? 2 : 0)}
            {unit}
          </Num>
        </div>
        <div className="text-2xl font-bold tabular-nums">
          <Num>
            {fmt(after, isCpa ? 2 : 0)}
            {unit}
          </Num>
        </div>
      </div>
      <div className={`text-xs font-medium mt-0.5 flex items-center gap-1 ${toneCls}`}>
        {!isSame &&
          (isBetter ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          ))}
        {isSame ? (
          "بدون تغيير"
        ) : (
          <>
            <Num>
              {delta > 0 ? "+" : ""}
              {fmt(delta, isCpa ? 2 : 0)}
              {unit}
            </Num>
            <span className="text-muted-foreground/70">
              (<Num>{pct > 0 ? "+" : ""}{fmt(pct, 0)}%</Num>)
            </span>
          </>
        )}
      </div>
    </div>
  );
}

interface Props {
  totals: DerivedMetrics;
  byAd: SegmentEntry[];
}

export function ImpactCalculator({ totals, byAd }: Props) {
  // Pick top 3 worst-performing ads with significant spend as kill candidates
  const killCandidates = useMemo(() => {
    const cpas = byAd.filter((a) => a.purchases > 0).map((a) => a.cpa);
    const minCpa = cpas.length > 0 ? Math.min(...cpas) : totals.cpa || 1;
    return [...byAd]
      .filter((a) => a.spend >= 50)
      .filter((a) => a.purchases === 0 || a.cpa > minCpa * 1.6)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 3);
  }, [byAd, totals.cpa]);

  const [killed, setKilled] = useState<Set<string>>(new Set());
  const [hookBoost, setHookBoost] = useState([0]); // extra % above current
  const [budgetMult, setBudgetMult] = useState([1]); // 1.0 - 2.0
  const [crBoost, setCrBoost] = useState([0]); // 0-100% recovery on funnel leakage

  function reset() {
    setKilled(new Set());
    setHookBoost([0]);
    setBudgetMult([1]);
    setCrBoost([0]);
  }

  function toggleKill(id: string) {
    setKilled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const result = useMemo(() => {
    // Step 1: subtract killed ads' spend & orders
    const killedSpend = killCandidates
      .filter((a) => killed.has(a.id))
      .reduce((s, a) => s + a.spend, 0);
    const killedOrders = killCandidates
      .filter((a) => killed.has(a.id))
      .reduce((s, a) => s + a.purchases, 0);

    let spend = totals.spend - killedSpend;
    let orders = totals.purchases - killedOrders;

    // Step 2: hook rate boost — proportional uplift on orders only
    const baseHook = totals.hookRate || 1;
    const hookMult = (baseHook + hookBoost[0]) / baseHook;
    orders = orders * hookMult;

    // Step 3: budget multiplier on remaining (winners), with diminishing returns >1.5x
    const m = budgetMult[0];
    const orderMult = m <= 1.5 ? m : 1.5 + (m - 1.5) * 0.7;
    spend = spend * m;
    orders = orders * orderMult;

    // Step 4: CR boost recovery — recovers up to (LPV - Purchases) * 5% as new orders at full
    const recoverable = Math.max(0, totals.lpv - totals.purchases) * 0.05;
    const recovered = (crBoost[0] / 100) * recoverable;
    orders = orders + recovered;

    const cpa = orders > 0 ? spend / orders : 0;
    return { spend, orders, cpa, recovered };
  }, [killed, killCandidates, hookBoost, budgetMult, crBoost, totals]);

  const verdict = useMemo(() => {
    const before = totals.cpa;
    const after = result.cpa;
    if (after === 0 || before === 0) return null;
    if (after < before * 0.7) return { tone: "good" as const, text: "تحسّن قوي — نفّذي" };
    if (after < before * 0.95) return { tone: "good" as const, text: "تحسّن ملحوظ" };
    if (after < before * 1.05) return { tone: "neutral" as const, text: "تأثير محدود" };
    return { tone: "bad" as const, text: "هتخسري — راجعي القرار" };
  }, [result.cpa, totals.cpa]);

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-primary" />
              حاسبة "ماذا لو؟" — جرّبي القرارات قبل ما تنفّذيها
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1.5">
              غيّري الإعدادات تحت وشوفي تأثيرها فوراً على الأوردرات والـ CPA
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5 ml-1.5" />
            صفّري
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Results */}
        <div className="grid grid-cols-3 gap-3">
          <MetricBlock
            label="الأوردرات"
            before={totals.purchases}
            after={result.orders}
            betterDir="up"
            highlight
          />
          <MetricBlock
            label="CPA"
            before={totals.cpa}
            after={result.cpa}
            unit=" EGP"
            betterDir="down"
            highlight
          />
          <MetricBlock
            label="Spend"
            before={totals.spend}
            after={result.spend}
            unit=" EGP"
            betterDir="down"
          />
        </div>

        {verdict && (
          <div
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold ring-1 ring-inset ${
              verdict.tone === "good"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30"
                : verdict.tone === "bad"
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/30"
                : "bg-muted text-muted-foreground ring-border"
            }`}
          >
            الحكم: {verdict.text}
          </div>
        )}

        {/* Controls */}
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-5">
          {/* KILL toggles - dynamic from worst ads */}
          {killCandidates.length > 0 && (
            <div className="md:col-span-2 space-y-3">
              <div className="text-sm font-semibold text-foreground">
                قرارات الإيقاف — أسوأ الإعلانات في الفترة دي
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                {killCandidates.map((a) => (
                  <ToggleCard
                    key={a.id}
                    label={`أوقفي: ${a.label}`}
                    sub={`-${fmt(a.spend, 0)} EGP، -${fmt(a.purchases, 0)} طلب`}
                    checked={killed.has(a.id)}
                    onChange={() => toggleKill(a.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Hook Rate */}
          <SliderRow
            label="ارفعي Hook Rate"
            value={hookBoost[0]}
            onChange={(v) => setHookBoost([v])}
            min={0}
            max={20}
            step={1}
            display={`من ${fmt(totals.hookRate, 0)}% لـ ${fmt(totals.hookRate + hookBoost[0], 0)}%`}
            help="كل +1% Hook = +زيادة نسبية في الأوردرات"
          />

          {/* Budget Multiplier */}
          <SliderRow
            label="ضاعفي ميزانية الفائز"
            value={budgetMult[0]}
            onChange={(v) => setBudgetMult([v])}
            min={1}
            max={2}
            step={0.1}
            display={`×${budgetMult[0].toFixed(1)} من الحالي`}
            help="فوق ×1.5 الفعالية بتقل (Audience Saturation)"
          />

          {/* CR Boost / Form Fix */}
          <SliderRow
            label="إصلاح صفحة المنتج / الفورم — % تعافي"
            value={crBoost[0]}
            onChange={(v) => setCrBoost([v])}
            min={0}
            max={100}
            step={10}
            display={`${crBoost[0]}% (+${fmt(((crBoost[0] / 100) * Math.max(0, totals.lpv - totals.purchases) * 0.05), 0)} طلب)`}
            help={`بافتراض إن إصلاح الفورم يكسب 5% من الـ LPV اللي ما اشترتش (${fmt(Math.max(0, totals.lpv - totals.purchases))} مستخدم)`}
            wide
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ToggleCard({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
        checked ? "border-rose-500/40 bg-rose-500/5" : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <div className="space-y-0.5 min-w-0">
        <div className="text-sm font-medium leading-snug truncate">{label}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          <Num>{sub}</Num>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  display,
  help,
  wide,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  display: string;
  help: string;
  wide?: boolean;
}) {
  return (
    <div className={`space-y-2.5 ${wide ? "md:col-span-2" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-sm font-bold text-primary tabular-nums">
          <Num>{display}</Num>
        </div>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={min}
        max={max}
        step={step}
        dir="ltr"
      />
      <div className="text-xs text-muted-foreground">{help}</div>
    </div>
  );
}
