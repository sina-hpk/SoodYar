import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from "recharts";
import { Info } from "lucide-react";
import { assetClassLabel } from "../lib/labels";
import { formatMoney, formatPercent, toPersianDigits } from "../lib/format";
import type { Currency } from "../lib/format";
import type { CategoryAllocation } from "../lib/api";

/**
 * Each asset class keeps the same colour everywhere it is drawn, so a reader who
 * learns "green = نقد" on the dashboard is not re-learning it on the reports page.
 */
const CLASS_COLORS: Record<string, string> = {
  CASH: "#f59e0b",
  FIXED_INCOME: "#14b8a6",
  BOND: "#0ea5e9",
  STOCK: "#2f8659",
  ETF: "#4fa172",
  MUTUAL_FUND: "#7fbf99",
  GOLD: "#eab308",
  COIN: "#d97706",
  SILVER: "#94a3b8",
  CRYPTO: "#8b5cf6",
  FX: "#3b82f6",
  COMMODITY: "#f97316",
  REAL_ESTATE: "#a855f7",
  VEHICLE: "#ec4899",
  PRIVATE_EQUITY: "#6366f1",
  COLLECTIBLE: "#db2777",
  OTHER: "#64748b",
};
const FALLBACK_COLORS = ["#2f8659", "#3b82f6", "#8b5cf6", "#f59e0b", "#14b8a6", "#ec4899"];
const OTHER_COLOR = "#cbd5e1";

/** Slices below this share are folded into a single «سایر» wedge to stop label clutter. */
const SMALL_SLICE_PERCENT = 3;

interface Slice {
  key: string;
  label: string;
  value: number;
  percent: number;
  color: string;
  /** Categories folded into this slice, when it is the grouped «سایر» wedge. */
  members?: { label: string; value: number; percent: number }[];
}

type Scope = "ALL" | "ASSETS";

function colorFor(category: string, i: number): string {
  return CLASS_COLORS[category] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

/** The enlarged wedge drawn for the hovered or selected slice. */
function ActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  const geometry = { cx, cy, startAngle, endAngle, fill };
  return (
    <g>
      <Sector {...geometry} innerRadius={innerRadius} outerRadius={outerRadius + 6} />
      <Sector
        {...geometry}
        innerRadius={outerRadius + 8}
        outerRadius={outerRadius + 11}
        fillOpacity={0.35}
      />
    </g>
  );
}

export function AllocationChart({
  categories,
  currency,
  className,
}: {
  categories: CategoryAllocation[];
  currency: Currency;
  className?: string;
}) {
  const [scope, setScope] = useState<Scope>("ALL");
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const model = useMemo<{ slices: Slice[]; total: number; hidden: number }>(() => {
    const rows = categories
      .filter((c) => (scope === "ASSETS" ? c.category !== "CASH" : true))
      .map((c) => ({ category: c.category, value: Number(c.marketValueRial) }))
      .filter((r) => Number.isFinite(r.value) && r.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = rows.reduce((s, r) => s + r.value, 0);
    if (total <= 0) return { slices: [], total: 0, hidden: 0 };

    const withPct: Slice[] = rows.map((r, i) => ({
      key: r.category,
      label: assetClassLabel(r.category),
      value: r.value,
      percent: (r.value / total) * 100,
      color: colorFor(r.category, i),
    }));

    // Only group when it actually buys clarity: at least two tiny slices.
    const tiny = withPct.filter((s) => s.percent < SMALL_SLICE_PERCENT);
    if (tiny.length < 2) return { slices: withPct, total, hidden: 0 };

    const big = withPct.filter((s) => s.percent >= SMALL_SLICE_PERCENT);
    const groupedValue = tiny.reduce((s, t) => s + t.value, 0);
    const slices: Slice[] = [
      ...big,
      {
        key: "__other__",
        label: "سایر دسته‌ها",
        value: groupedValue,
        percent: (groupedValue / total) * 100,
        color: OTHER_COLOR,
        members: tiny.map((t) => ({ label: t.label, value: t.value, percent: t.percent })),
      },
    ];
    return { slices, total, hidden: tiny.length };
  }, [categories, scope]);

  const { slices, total } = model;

  // The pinned slice survives re-renders; hover only previews.
  const pinnedIndex = pinned ? slices.findIndex((s) => s.key === pinned) : -1;
  const shownIndex = active ?? (pinnedIndex >= 0 ? pinnedIndex : null);
  const shown = shownIndex != null ? slices[shownIndex] : null;

  const top = slices[0];
  const cash = categories.find((c) => c.category === "CASH");
  const cashPercent =
    cash && Number(cash.marketValueRial) > 0 && scope === "ALL"
      ? (Number(cash.marketValueRial) / total) * 100
      : null;

  /**
   * One sentence that says something the numbers alone don't: whether the fund is
   * concentrated, or sitting on idle cash. Only the strongest signal is shown.
   */
  const insight = (() => {
    if (!top) return null;
    if (top.percent >= 50)
      return {
        tone: "amber" as const,
        text: `${formatPercent(top.percent)} از ${
          scope === "ALL" ? "کل صندوق" : "دارایی‌ها"
        } در «${top.label}» است؛ تمرکز بالا یعنی نوسان همان یک دسته، کل صندوق را جابه‌جا می‌کند.`,
      };
    if (cashPercent != null && cashPercent >= 30)
      return {
        tone: "blue" as const,
        text: `${formatPercent(cashPercent)} از صندوق نقد است. نقد ریسک ندارد، اما بازدهی هم ندارد و در تورم ارزشش کم می‌شود.`,
      };
    if (slices.length >= 4)
      return {
        tone: "slate" as const,
        text: `سرمایه بین ${toPersianDigits(slices.length)} دسته پخش شده و بزرگ‌ترین سهم ${formatPercent(
          top.percent
        )} است؛ تخصیص نسبتاً متعادلی است.`,
      };
    return null;
  })();

  if (slices.length === 0) {
    return (
      <div className={className}>
        <Header scope={scope} setScope={setScope} />
        <div className="py-14 text-center text-sm text-slate-400">
          {scope === "ASSETS"
            ? "دارایی غیرنقدی برای نمایش وجود ندارد؛ کل صندوق نقد است."
            : "هنوز دارایی یا نقدی برای تخصیص ثبت نشده است."}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <Header scope={scope} setScope={setScope} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius={78}
                outerRadius={110}
                paddingAngle={slices.length > 1 ? 2 : 0}
                startAngle={90}
                endAngle={-270}
                activeIndex={shownIndex ?? undefined}
                activeShape={ActiveShape}
                onMouseEnter={(_, i) => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={(_, i) =>
                  setPinned((p) => (p === slices[i].key ? null : slices[i].key))
                }
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.color} stroke="#fff" strokeWidth={2} className="cursor-pointer" />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Centre readout: the whole fund by default, the focused slice when one is chosen. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="max-w-[9.5rem] truncate text-xs text-slate-400">
              {shown ? shown.label : scope === "ALL" ? "کل صندوق" : "کل دارایی‌ها"}
            </span>
            <span className="tabular text-2xl font-bold leading-tight text-slate-800">
              {shown ? formatPercent(shown.percent) : formatPercent(100)}
            </span>
            <span className="tabular mt-1 max-w-[10rem] truncate text-[11px] text-slate-500">
              {formatMoney(String(Math.round(shown ? shown.value : total)), currency)}
            </span>
          </div>
        </div>

        {/* Two columns once there is room, so a long class list does not out-run the donut. */}
        <ul className="grid grid-cols-1 gap-x-4 gap-y-2 self-center sm:grid-cols-2 lg:col-span-3">
          {slices.map((s, i) => {
            const focused = shownIndex === i;
            return (
              <li key={s.key}>
                <button
                  className={`w-full rounded-lg px-3 py-2 text-start transition ${
                    focused ? "bg-slate-50 ring-1 ring-slate-200" : "hover:bg-slate-50"
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onClick={() => setPinned((p) => (p === s.key ? null : s.key))}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{s.label}</span>
                    <span className="tabular text-sm font-semibold text-slate-800">
                      {formatPercent(s.percent)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 ps-[18px]">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(s.percent, 1.5)}%`, backgroundColor: s.color }}
                      />
                    </div>
                    <span className="tabular text-[11px] text-slate-400">
                      {formatMoney(String(Math.round(s.value)), currency)}
                    </span>
                  </div>
                  {s.members && focused && (
                    <div className="mt-2 space-y-1 rounded-md bg-white/70 px-2 py-1.5">
                      {s.members.map((m) => (
                        <div key={m.label} className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="min-w-0 flex-1 truncate">{m.label}</span>
                          <span className="tabular">{formatPercent(m.percent)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {insight && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-6 ${
            insight.tone === "amber"
              ? "bg-amber-50 text-amber-800"
              : insight.tone === "blue"
                ? "bg-blue-50 text-blue-800"
                : "bg-slate-50 text-slate-600"
          }`}
        >
          <Info size={14} className="mt-1 flex-shrink-0" />
          <span>{insight.text}</span>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-6 text-slate-400">
        درصدها بر اساس ارزش روز هستند. دسته‌های کمتر از {formatPercent(SMALL_SLICE_PERCENT, 0)} در
        «سایر دسته‌ها» جمع می‌شوند؛ روی هر بخش کلیک کنید تا ثابت بماند.
      </p>
    </div>
  );
}

function Header({ scope, setScope }: { scope: Scope; setScope: (s: Scope) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-slate-700">تخصیص دارایی بر اساس دسته</h3>
      <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
        {(
          [
            ["ALL", "کل صندوق (با نقد)"],
            ["ASSETS", "فقط دارایی‌ها"],
          ] as [Scope, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            className={`rounded-md px-2.5 py-1 transition ${
              scope === v ? "bg-white font-medium text-slate-800 shadow-sm" : "text-slate-500"
            }`}
            onClick={() => setScope(v)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
