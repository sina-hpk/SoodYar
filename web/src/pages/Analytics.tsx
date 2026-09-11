import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  Database,
  Download,
  Flame,
  LineChart as LineChartIcon,
  Percent,
  RefreshCw,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  type AnalyticsBenchmarkPerformance,
  type AnalyticsCoverageStatus,
  type AnalyticsReport,
  type AnalyticsValuationStatus,
  type BenchmarkKey,
} from "../lib/api";
import { Card, Empty, InfoNote, PageHeader, RiskNotice, StatCard, Badge } from "../components/ui";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useSettings } from "../context/SettingsContext";
import { useToast } from "../components/Toast";
import {
  formatMoney,
  formatPercent,
  jalaliInputToIso,
  todayIso,
  todayJalali,
  toJalali,
  toPersianDigits,
} from "../lib/format";
import { assetClassLabel } from "../lib/labels";

type RangePreset = "INCEPTION" | "LAST_30" | "JALALI_YEAR" | "CUSTOM";
type AssetSort = "PROFIT" | "SYMBOL";

const BENCHMARK_KEYS: BenchmarkKey[] = ["USD_IRR", "GOLD18_IRR_GRAM"];
const BENCHMARK_LABELS: Record<BenchmarkKey, string> = {
  USD_IRR: "دلار",
  GOLD18_IRR_GRAM: "طلای ۱۸ عیار",
  INFLATION_INDEX_IR: "تورم (شاخص مصرف‌کننده)",
};
/** Unit suffix used in the manual-entry label for each benchmark. */
const BENCHMARK_UNIT_HINTS: Record<BenchmarkKey, string> = {
  USD_IRR: "دلار",
  GOLD18_IRR_GRAM: "گرم طلای ۱۸ عیار",
  INFLATION_INDEX_IR: "نقطهٔ شاخص",
};

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function currentJalaliYearStart(): string {
  const year = todayJalali().split("/")[0];
  return jalaliInputToIso(`${year}/01/01`) ?? todayIso();
}

function toneForNumber(value: string | null): string {
  if (value == null) return "text-slate-400";
  const number = Number(value);
  return number > 0 ? "text-green-600" : number < 0 ? "text-red-600" : "text-slate-700";
}

function moneyOrMissing(value: string | null, currency: "RIAL" | "TOMAN"): string {
  return value == null ? "داده کافی نیست" : formatMoney(value, currency);
}

/**
 * Money for display where the value is a decimal string (NAV per unit carries
 * eight fractional digits): sub-rial precision is noise in a table cell, so it
 * is rounded to whole rial before formatting.
 */
function moneyRounded(value: string | null, currency: "RIAL" | "TOMAN"): string {
  if (value == null) return "داده کافی نیست";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "داده کافی نیست";
  return formatMoney(String(Math.round(numeric)), currency);
}

function percentOrMissing(value: string | null): string {
  return value == null ? "داده کافی نیست" : formatPercent(value);
}

function statusLabel(status: AnalyticsCoverageStatus): string {
  if (status === "COMPLETE") return "کامل";
  if (status === "PARTIAL") return "ناقص";
  return "فاقد داده";
}

function statusTone(status: AnalyticsCoverageStatus): "green" | "amber" | "red" {
  if (status === "COMPLETE") return "green";
  if (status === "PARTIAL") return "amber";
  return "red";
}

function valuationLabel(status: AnalyticsValuationStatus): string {
  const labels: Record<AnalyticsValuationStatus, string> = {
    MARKET: "قیمت بازار",
    STALE: "قیمت قدیمی",
    AT_COST: "بهای تمام‌شده",
    MISSING: "فاقد قیمت",
  };
  return labels[status];
}

function valuationTone(status: AnalyticsValuationStatus): "green" | "amber" | "red" {
  return status === "MARKET" ? "green" : status === "MISSING" ? "red" : "amber";
}

function missingDatesText(dates: string[]): string {
  if (dates.length === 0) return "";
  const visible = dates.slice(0, 4).map((date) => toJalali(date)).join("، ");
  const rest = dates.length - 4;
  return rest > 0 ? `${visible} و ${toPersianDigits(rest)} تاریخ دیگر` : visible;
}

function CounterfactualCard({
  benchmark,
  actualProfitRial,
  currency,
}: {
  benchmark: AnalyticsBenchmarkPerformance | undefined;
  actualProfitRial: string;
  currency: "RIAL" | "TOMAN";
}) {
  if (!benchmark) {
    return (
      <Card className="border-amber-200 bg-amber-50/30">
        <h3 className="font-semibold text-slate-800">اگر هر واریز صرف خرید بازار می‌شد</h3>
        <Empty>این شاخص در پاسخ گزارش وجود ندارد؛ ابتدا دادهٔ مبنا را ثبت کنید.</Empty>
      </Card>
    );
  }

  const { counterfactual } = benchmark;
  const missing =
    benchmark.status !== "COMPLETE" ||
    counterfactual == null ||
    counterfactual.solvency !== "OK" ||
    counterfactual.endingValueRial == null ||
    counterfactual.profitRial == null;

  if (missing) {
    return (
      <Card className="border-amber-200 bg-amber-50/30">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-800">اگر هر واریز صرف خرید {benchmark.name} می‌شد</h3>
          <Badge tone={statusTone(benchmark.status)}>{statusLabel(benchmark.status)}</Badge>
        </div>
        <div className="rounded-lg border border-amber-200 bg-white p-4 text-sm leading-7 text-amber-900">
          <div className="font-semibold">دادهٔ کافی برای محاسبهٔ این سناریو وجود ندارد.</div>
          {counterfactual && counterfactual.missingFlowDates.length > 0 && (
            <div>قیمت ثبت‌نشده در تاریخ واریز/برداشت: {missingDatesText(counterfactual.missingFlowDates)}</div>
          )}
          {counterfactual?.solvency === "INSOLVENT_AT_FLOW" && (
            <div>در یک تاریخ برداشت، موجودی فرضی این بازار برای پوشش برداشت کافی نبوده است.</div>
          )}
          {counterfactual?.solvency === "MISSING_DATA" && counterfactual.missingFlowDates.length === 0 && (
            <div>قیمت شروع، پایان یا یکی از تاریخ‌های جریان سرمایه ثبت نشده است.</div>
          )}
          {counterfactual == null && (
            <div>این شاخص قابل خرید نیست؛ سناریوی خرید برای آن ساخته نمی‌شود.</div>
          )}
          <div className="mt-2 text-xs text-slate-500">به‌جای دادهٔ مفقود صفر یا قیمت روز دیگری جایگزین نمی‌شود.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">اگر هر واریز صرف خرید {benchmark.name} می‌شد</h3>
          <p className="mt-1 text-xs text-slate-500">خرید و فروش فرضی دقیقاً در تاریخ جریان‌های سرمایه</p>
        </div>
        <Badge tone={statusTone(benchmark.status)}>{statusLabel(benchmark.status)}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">ارزش پایانی فرضی</div>
          <div className="mt-1 break-words tabular font-semibold leading-6">
            {moneyOrMissing(counterfactual.endingValueRial, currency)}
          </div>
        </div>
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">سود فرضی</div>
          <div className={`mt-1 break-words tabular font-semibold leading-6 ${toneForNumber(counterfactual.profitRial)}`}>
            {moneyOrMissing(counterfactual.profitRial, currency)}
          </div>
        </div>
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">بازده فرضی</div>
          <div className={`mt-1 break-words tabular font-semibold leading-6 ${toneForNumber(counterfactual.returnPercent)}`}>
            {percentOrMissing(counterfactual.returnPercent)}
          </div>
        </div>
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">اختلاف بازده با سودیار</div>
          <div className={`mt-1 break-words tabular font-semibold leading-6 ${toneForNumber(benchmark.excessVsFundPercent)}`}>
            {percentOrMissing(benchmark.excessVsFundPercent)}
          </div>
          <div className="mt-1 break-words text-[11px] leading-5 text-slate-400">
            سود واقعی سودیار: {formatMoney(actualProfitRial, currency)}
          </div>
        </div>
      </div>
      {benchmark.realPointReturnPercent != null && (
        <p className="mt-3 text-xs leading-6 text-slate-500">
          بازده واقعی این بازار پس از تورم: {formatPercent(benchmark.realPointReturnPercent)}
        </p>
      )}
    </Card>
  );
}

export default function Analytics() {
  const { currency } = useSettings();
  const toast = useToast();
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState<RangePreset>("INCEPTION");
  const [range, setRange] = useState({ from: "", to: todayIso() });
  const [draftRange, setDraftRange] = useState({ from: "", to: todayIso() });
  const [assetSort, setAssetSort] = useState<AssetSort>("PROFIT");
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmarkForm, setBenchmarkForm] = useState({
    key: "USD_IRR" as BenchmarkKey,
    date: todayIso(),
    priceRial: "",
  });

  async function load(from: string, to: string) {
    setLoading(true);
    setError("");
    try {
      setReport(await api.analyticsPerformance(from, to));
    } catch (caught) {
      setReport(null);
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("", todayIso());
  }, []);

  function selectPreset(nextPreset: Exclude<RangePreset, "CUSTOM">) {
    const nextRange = {
      from:
        nextPreset === "INCEPTION"
          ? ""
          : nextPreset === "LAST_30"
            ? isoDaysAgo(29)
            : currentJalaliYearStart(),
      to: todayIso(),
    };
    setPreset(nextPreset);
    setRange(nextRange);
    setDraftRange(nextRange);
    load(nextRange.from, nextRange.to);
  }

  function applyCustomRange() {
    if (!draftRange.from || !draftRange.to) {
      toast("برای بازهٔ سفارشی هر دو تاریخ را وارد کنید", "error");
      return;
    }
    if (draftRange.from > draftRange.to) {
      toast("تاریخ شروع باید پیش از تاریخ پایان باشد", "error");
      return;
    }
    setPreset("CUSTOM");
    setRange(draftRange);
    load(draftRange.from, draftRange.to);
  }

  async function captureLiveBenchmarks() {
    setBenchmarkBusy(true);
    try {
      const result = await api.captureLiveBenchmarks();
      toast(
        result.captured.length > 0
          ? `${toPersianDigits(result.captured.length)} قیمت امروز ثبت شد`
          : "قیمت تازه‌ای ثبت نشد؛ موارد موجود بازنویسی نشدند",
        result.captured.length > 0 ? "success" : "error"
      );
      await load(range.from, range.to);
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBenchmarkBusy(false);
    }
  }

  /**
   * Pulls the daily history of USD and 18k gold from the public TGJU pages, so
   * the comparison has real prices on the dates members actually deposited.
   */
  async function backfillBenchmarks() {
    setBenchmarkBusy(true);
    try {
      const result = await api.backfillBenchmarks();
      const inserted = result.results.reduce((sum, row) => sum + row.inserted, 0);
      const failed = result.results.filter((row) => row.error);
      if (failed.length > 0) {
        toast(`${failed[0].key}: ${failed[0].error}`, "error");
      } else {
        toast(
          inserted > 0
            ? `${toPersianDigits(inserted)} قیمت تاریخی ثبت شد`
            : "تاریخچه از قبل کامل است؛ چیزی بازنویسی نشد",
          "success"
        );
      }
      await load(range.from, range.to);
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function addBenchmarkPrice() {
    if (!benchmarkForm.priceRial.trim()) {
      toast("قیمت ریالی را وارد کنید", "error");
      return;
    }
    setBenchmarkBusy(true);
    try {
      await api.addBenchmarkPrice({
        key: benchmarkForm.key,
        date: benchmarkForm.date,
        priceRial: benchmarkForm.priceRial.trim(),
        source: "MANUAL",
      });
      toast("قیمت مبنا ثبت شد؛ ردیف موجود بازنویسی نمی‌شود", "success");
      setBenchmarkForm((current) => ({ ...current, priceRial: "" }));
      await load(range.from, range.to);
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBenchmarkBusy(false);
    }
  }

  const chartData = useMemo(
    () =>
      (report?.series ?? []).map((point) => ({
        date: point.date,
        label: toJalali(point.date, "MM/dd"),
        fund: point.fund == null ? null : Number(point.fund),
        USD_IRR: point.USD_IRR == null ? null : Number(point.USD_IRR),
        GOLD18_IRR_GRAM:
          point.GOLD18_IRR_GRAM == null ? null : Number(point.GOLD18_IRR_GRAM),
        INFLATION_INDEX_IR:
          point.INFLATION_INDEX_IR == null ? null : Number(point.INFLATION_INDEX_IR),
      })),
    [report]
  );

  const chartAvailability = useMemo(
    () => ({
      fund: chartData.some((point) => point.fund != null),
      USD_IRR: chartData.some((point) => point.USD_IRR != null),
      GOLD18_IRR_GRAM: chartData.some((point) => point.GOLD18_IRR_GRAM != null),
      INFLATION_INDEX_IR: chartData.some((point) => point.INFLATION_INDEX_IR != null),
    }),
    [chartData]
  );

  const sortedAssets = useMemo(() => {
    const assets = [...(report?.assets ?? [])];
    if (assetSort === "SYMBOL") {
      return assets.sort((left, right) => left.symbol.localeCompare(right.symbol, "fa"));
    }
    return assets.sort(
      (left, right) => Number(right.profitContributionRial) - Number(left.profitContributionRial)
    );
  }, [assetSort, report]);

  const winner = useMemo(() => {
    if (!report) return null;
    const candidates = [
      report.fund.navUnitReturnPercent == null
        ? null
        : { name: "سودیار", value: report.fund.navUnitReturnPercent },
      ...report.benchmarks.map((benchmark) =>
        benchmark.status === "COMPLETE" && benchmark.pointReturnPercent != null
          ? { name: benchmark.name, value: benchmark.pointReturnPercent }
          : null
      ),
    ].filter((candidate): candidate is { name: string; value: string } => candidate != null);
    if (candidates.length < 2) return null;
    return candidates.reduce((best, candidate) =>
      Number(candidate.value) > Number(best.value) ? candidate : best
    );
  }, [report]);

  const benchmarkByKey = (key: BenchmarkKey) =>
    report?.benchmarks.find((benchmark) => benchmark.key === key);

  const residualIsNonZero = Boolean(
    report && !/^[-+]?0*(?:\.0*)?$/.test(report.unattributedCashProfitRial.trim())
  );

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="تحلیل سود و مقایسه بازار"
        subtitle="تفکیک سود واقعی، بازده NAV و مقایسهٔ هم‌زمان با دلار و طلای ۱۸ عیار"
      />

      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 font-semibold text-slate-700">
              <CalendarRange size={18} /> بازهٔ تحلیل
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["INCEPTION", "از شروع"],
                ["LAST_30", "۳۰ روز اخیر"],
                ["JALALI_YEAR", "سال شمسی جاری"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={preset === value ? "btn-primary" : "btn-secondary"}
                  onClick={() => selectPreset(value)}
                  disabled={loading}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_auto] sm:items-end">
            <div>
              <label className="label">از تاریخ (شمسی)</label>
              <JalaliDateInput
                value={draftRange.from}
                onChange={(from) => setDraftRange((current) => ({ ...current, from }))}
              />
            </div>
            <div>
              <label className="label">تا تاریخ (شمسی)</label>
              <JalaliDateInput
                value={draftRange.to}
                onChange={(to) => setDraftRange((current) => ({ ...current, to }))}
              />
            </div>
            <button className="btn-primary" onClick={applyCustomRange} disabled={loading}>
              اعمال بازه
            </button>
          </div>
        </div>
        {preset === "INCEPTION" && (
          <p className="mt-3 text-xs text-slate-500">تاریخ شروع خالی است؛ سرور کل سابقهٔ قابل محاسبه را تحلیل می‌کند.</p>
        )}
      </Card>

      {loading && <Card className="text-center text-slate-500">در حال محاسبهٔ گزارش عملکرد…</Card>}
      {!loading && error && (
        <Card className="border-red-200 bg-red-50 text-red-700">
          <div className="font-semibold">گزارش عملکرد بارگذاری نشد.</div>
          <div className="mt-1 text-sm">{error}</div>
          <button className="btn-secondary mt-3" onClick={() => load(range.from, range.to)}>
            <RefreshCw size={16} /> تلاش دوباره
          </button>
        </Card>
      )}

      {!loading && report && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="سود واقعی ریالی"
              value={formatMoney(report.fund.actualProfitRial, currency)}
              hint="NAV پایان منهای NAV شروع و جریان خالص سرمایه؛ واریز سود نیست."
              icon={<Wallet size={20} />}
              accent={toneForNumber(report.fund.actualProfitRial)}
            />
            <StatCard
              label="بازده NAV هر واحد (نقطه‌به‌نقطه)"
              value={percentOrMissing(report.fund.navUnitReturnPercent)}
              hint="تغییر ارزش یک واحد بین ابتدا و انتهای بازه؛ مستقل از اندازهٔ واریزها."
              icon={<TrendingUp size={20} />}
              accent={toneForNumber(report.fund.navUnitReturnPercent)}
            />
            <StatCard
              label="بازده واقعی (پس از تورم)"
              value={percentOrMissing(report.fund.realReturnPercent)}
              hint={
                report.inflation.status === "COMPLETE"
                  ? `بازده NAV منهای تورم ${percentOrMissing(report.inflation.inflationPercent)} در همین بازه.`
                  : "برای محاسبهٔ این عدد، نقاط شاخص تورم را در کارت «دادهٔ مبنا» وارد کنید."
              }
              icon={<Percent size={20} />}
              accent={toneForNumber(report.fund.realReturnPercent)}
            />
            <StatCard
              label="تورم بازه (شاخص مصرف‌کننده)"
              value={
                report.inflation.status === "COMPLETE"
                  ? percentOrMissing(report.inflation.inflationPercent)
                  : "داده کافی نیست"
              }
              hint={
                report.inflation.status === "COMPLETE"
                  ? `${toPersianDigits(report.inflation.pointsCount)} نقطهٔ شاخص ثبت شده است.`
                  : "شاخص تورم قابل خرید نیست؛ فقط برای سنجش بازده واقعی استفاده می‌شود."
              }
              icon={<Flame size={20} />}
              accent={toneForNumber(
                report.inflation.status === "COMPLETE" ? report.inflation.inflationPercent : null
              )}
            />
            <StatCard
              label="XIRR سالانه‌شده"
              value={percentOrMissing(report.fund.xirrAnnualizedPercent)}
              hint={report.fund.xirrNote ?? "بازده پول‌وزن با لحظهٔ دقیق ورود و خروج سرمایه."}
              icon={<LineChartIcon size={20} />}
              accent={toneForNumber(report.fund.xirrAnnualizedPercent)}
            />
            <StatCard
              label="جریان خالص سرمایه (اجزای ورودی/خروجی)"
              value={
                <div className="space-y-1 text-base">
                  <div className="text-green-600">واریز: {formatMoney(report.fund.contributionsRial, currency)}</div>
                  <div className="text-red-600">برداشت: {formatMoney(report.fund.withdrawalsRial, currency)}</div>
                </div>
              }
              hint="ورود و خروج پول اعضا؛ این ارقام سود یا زیان نیستند."
              icon={<Scale size={20} />}
            />
          </div>

          <InfoNote>
            <strong>این چهار عدد یک مفهوم را نشان نمی‌دهند:</strong> سود واقعی مبلغ ریالی ایجادشده است؛ بازده NAV
            عملکرد یک واحد را می‌سنجد؛ XIRR زمان‌بندی پول اعضا را وزن می‌دهد؛ و واریز/برداشت صرفاً جریان سرمایه است.
            بنابراین جمع واریزها هرگز به‌عنوان سود نمایش داده نمی‌شود.
          </InfoNote>

          <RiskNotice />
          {(report.coverage.warnings.length > 0 || report.coverage.navStatus !== "COMPLETE") && (
            <Card className="border-amber-300 bg-amber-50">
              <div className="flex items-start gap-3 text-amber-900">
                <AlertTriangle className="mt-0.5 shrink-0" size={20} />
                <div>
                  <div className="font-semibold">پوشش داده‌های این گزارش کامل نیست</div>
                  <div className="mt-1 text-sm leading-7">
                    وضعیت NAV: <Badge tone={statusTone(report.coverage.navStatus)}>{statusLabel(report.coverage.navStatus)}</Badge>
                  </div>
                  {report.coverage.warnings.length > 0 && (
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-7">
                      {report.coverage.warnings.map((warning, index) => (
                        <li key={`${warning}-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs leading-6 text-amber-800">
                    دارایی با ارزش دفتری، ارزش منصفانهٔ بازار نیست. برای قیمت گمشده هرگز قیمت آینده یا صفر جایگزین نمی‌شود.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">مقایسهٔ نرمال‌شدهٔ عملکرد (مبنای ۱۰۰)</h2>
                <p className="mt-1 text-xs leading-6 text-slate-500">
                  هر خط فقط در تاریخ‌هایی رسم می‌شود که دادهٔ معتبر دارد؛ خلأ داده با صفر یا قیمت آینده پر نمی‌شود.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {report.coverage.benchmarks.map((coverage) => (
                  <Badge key={coverage.key} tone={statusTone(coverage.status)}>
                    {BENCHMARK_LABELS[coverage.key]}: {statusLabel(coverage.status)}
                  </Badge>
                ))}
              </div>
            </div>
            {chartData.length === 0 || !chartAvailability.fund ? (
              <Empty>برای رسم عملکرد سودیار، نقطه‌های NAV کافی در این بازه وجود ندارد.</Empty>
            ) : (
              <div>
                <div className="h-[320px] w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 12, left: 12, bottom: 8 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        reversed
                        tick={{ fontSize: 11, direction: "rtl" }}
                        minTickGap={26}
                      />
                      <YAxis
                        orientation="right"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value: number) => toPersianDigits(value.toFixed(0))}
                        width={46}
                      />
                      <Tooltip
                        contentStyle={{ direction: "rtl", textAlign: "right", borderRadius: 8 }}
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.date ? `تاریخ: ${toJalali(payload[0].payload.date)}` : ""
                        }
                        formatter={(value: number, name: string) => [
                          toPersianDigits(Number(value).toFixed(2)),
                          name,
                        ]}
                      />
                      <Legend wrapperStyle={{ direction: "rtl", fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="fund"
                        name="سودیار"
                        stroke="#2f8659"
                        strokeWidth={3}
                        dot={false}
                        connectNulls={false}
                      />
                      {chartAvailability.USD_IRR && (
                        <Line
                          type="monotone"
                          dataKey="USD_IRR"
                          name="دلار"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                        />
                      )}
                      {chartAvailability.GOLD18_IRR_GRAM && (
                        <Line
                          type="monotone"
                          dataKey="GOLD18_IRR_GRAM"
                          name="طلای ۱۸ عیار"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                        />
                      )}
                      {chartAvailability.INFLATION_INDEX_IR && (
                        <Line
                          type="monotone"
                          dataKey="INFLATION_INDEX_IR"
                          name="تورم (شاخص مصرف‌کننده)"
                          stroke="#8b5cf6"
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          dot={false}
                          connectNulls={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {(!chartAvailability.USD_IRR ||
                  !chartAvailability.GOLD18_IRR_GRAM ||
                  !chartAvailability.INFLATION_INDEX_IR) && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                    {!chartAvailability.USD_IRR && "خط دلار به‌دلیل نبود دادهٔ کافی رسم نشده است. "}
                    {!chartAvailability.GOLD18_IRR_GRAM && "خط طلا به‌دلیل نبود دادهٔ کافی رسم نشده است. "}
                    {!chartAvailability.INFLATION_INDEX_IR &&
                      "خط تورم رسم نشده است؛ نقاط شاخص مصرف‌کننده را در کارت «دادهٔ مبنا» وارد کنید. "}
                    ثبت قیمت امروز به‌تنهایی تاریخچه نمی‌سازد؛ برای بازه‌های گذشته ردیف‌های تاریخی را دستی وارد کنید.
                  </div>
                )}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {BENCHMARK_KEYS.map((key) => (
              <CounterfactualCard
                key={key}
                benchmark={benchmarkByKey(key)}
                actualProfitRial={report.fund.actualProfitRial}
                currency={currency}
              />
            ))}
          </div>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">مقایسهٔ نقطه‌به‌نقطه</h2>
                <p className="mt-1 text-xs text-slate-500">
                  تغییر قیمت/واحد بین دو انتهای بازه؛ جریان‌های میان‌بازه در این جدول وزن نمی‌گیرند. ستون آخر همان بازده
                  اسمی است که با تورم همان بازه تعدیل شده.
                </p>
              </div>
              {winner ? (
                <Badge tone="green">برندهٔ داده‌های کامل: {winner.name} با {formatPercent(winner.value)}</Badge>
              ) : (
                <Badge tone="amber">برای تعیین برنده حداقل دو سری کامل لازم است</Badge>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="th">شاخص</th>
                    <th className="th">قیمت / NAV شروع</th>
                    <th className="th">قیمت / NAV پایان</th>
                    <th className="th">بازده نقطه‌به‌نقطه</th>
                    <th className="th">بازده واقعی (پس از تورم)</th>
                    <th className="th">اختلاف با سودیار</th>
                    <th className="th">پوشش</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-50">
                    <td className="td font-medium">سودیار</td>
                    <td className="td tabular">{moneyRounded(report.fund.startNavPerUnit, currency)}</td>
                    <td className="td tabular">{moneyRounded(report.fund.endNavPerUnit, currency)}</td>
                    <td className={`td tabular ${toneForNumber(report.fund.navUnitReturnPercent)}`}>
                      {percentOrMissing(report.fund.navUnitReturnPercent)}
                    </td>
                    <td className={`td tabular ${toneForNumber(report.fund.realReturnPercent)}`}>
                      {percentOrMissing(report.fund.realReturnPercent)}
                    </td>
                    <td className="td">—</td>
                    <td className="td"><Badge tone={statusTone(report.coverage.navStatus)}>{statusLabel(report.coverage.navStatus)}</Badge></td>
                  </tr>
                  {BENCHMARK_KEYS.map((key) => {
                    const benchmark = benchmarkByKey(key);
                    if (!benchmark) {
                      return (
                        <tr key={key} className="border-b border-slate-50 bg-amber-50/30">
                          <td className="td font-medium">{BENCHMARK_LABELS[key]}</td>
                          <td className="td text-amber-700" colSpan={5}>دادهٔ این شاخص در پاسخ گزارش موجود نیست؛ هیچ مقدار صفری فرض نشده است.</td>
                          <td className="td"><Badge tone="red">فاقد داده</Badge></td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={key} className={`border-b border-slate-50 ${benchmark.status !== "COMPLETE" ? "bg-amber-50/30" : ""}`}>
                        <td className="td font-medium">{benchmark.name}</td>
                        <td className="td tabular">{moneyOrMissing(benchmark.startPriceRial, currency)}</td>
                        <td className="td tabular">{moneyOrMissing(benchmark.endPriceRial, currency)}</td>
                        <td className={`td tabular ${toneForNumber(benchmark.pointReturnPercent)}`}>
                          {percentOrMissing(benchmark.pointReturnPercent)}
                        </td>
                        <td className={`td tabular ${toneForNumber(benchmark.realPointReturnPercent ?? null)}`}>
                          {percentOrMissing(benchmark.realPointReturnPercent ?? null)}
                        </td>
                        <td className={`td tabular ${toneForNumber(benchmark.excessVsFundPercent)}`}>
                          {percentOrMissing(benchmark.excessVsFundPercent)}
                        </td>
                        <td className="td"><Badge tone={statusTone(benchmark.status)}>{statusLabel(benchmark.status)}</Badge></td>
                      </tr>
                    );
                  })}
                  <tr className="border-b border-slate-50 bg-violet-50/40">
                    <td className="td font-medium">تورم (شاخص مصرف‌کننده)</td>
                    <td className="td tabular">
                      {report.inflation.startIndex == null ? "داده کافی نیست" : toPersianDigits(report.inflation.startIndex)}
                    </td>
                    <td className="td tabular">
                      {report.inflation.endIndex == null ? "داده کافی نیست" : toPersianDigits(report.inflation.endIndex)}
                    </td>
                    <td className={`td tabular ${toneForNumber(report.inflation.inflationPercent)}`}>
                      {percentOrMissing(report.inflation.inflationPercent)}
                    </td>
                    <td className="td text-slate-400">—</td>
                    <td className={`td tabular ${toneForNumber(
                      report.inflation.inflationPercent == null || report.fund.navUnitReturnPercent == null
                        ? null
                        : String(Number(report.fund.navUnitReturnPercent) - Number(report.inflation.inflationPercent))
                    )}`}>
                      {report.inflation.inflationPercent == null || report.fund.navUnitReturnPercent == null
                        ? "داده کافی نیست"
                        : formatPercent(String(Number(report.fund.navUnitReturnPercent) - Number(report.inflation.inflationPercent)))}
                    </td>
                    <td className="td"><Badge tone={statusTone(report.inflation.status)}>{statusLabel(report.inflation.status)}</Badge></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">سهم سود و زیان هر دارایی</h2>
                <p className="mt-1 text-xs text-slate-500">تمام مبالغ محاسبه‌شدهٔ سرور هستند؛ مرورگر فقط نمایش و مرتب‌سازی می‌کند.</p>
              </div>
              <select
                className="input w-auto"
                value={assetSort}
                onChange={(event) => setAssetSort(event.target.value as AssetSort)}
              >
                <option value="PROFIT">مرتب‌سازی بر اساس سهم سود</option>
                <option value="SYMBOL">مرتب‌سازی بر اساس نماد</option>
              </select>
            </div>
            {sortedAssets.length === 0 && !residualIsNonZero ? (
              <Empty>دارایی یا سود نقدی منتسب‌نشده‌ای برای این بازه وجود ندارد.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px]">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="th">دارایی</th>
                      <th className="th">ارزش شروع</th>
                      <th className="th">ارزش پایان</th>
                      <th className="th">جریان نقد مرتبط</th>
                      <th className="th">سهم در سود</th>
                      <th className="th">محقق‌شده</th>
                      <th className="th">تحقق‌نیافته</th>
                      <th className="th">سود کل تاریخی</th>
                      <th className="th">بازده</th>
                      <th className="th">کیفیت ارزش‌گذاری</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAssets.map((asset) => (
                      <tr key={asset.assetId} className="border-b border-slate-50">
                        <td className="td">
                          <div className="font-medium">{asset.symbol} — {asset.name}</div>
                          <div className="text-xs text-slate-400">{assetClassLabel(asset.assetClass)}</div>
                        </td>
                        <td className="td tabular">{formatMoney(asset.startMarketValueRial, currency)}</td>
                        <td className="td tabular">{formatMoney(asset.endMarketValueRial, currency)}</td>
                        <td className={`td tabular ${toneForNumber(asset.linkedCashDeltaRial)}`}>{formatMoney(asset.linkedCashDeltaRial, currency)}</td>
                        <td className={`td tabular font-semibold ${toneForNumber(asset.profitContributionRial)}`}>{formatMoney(asset.profitContributionRial, currency)}</td>
                        <td className={`td tabular ${toneForNumber(asset.realizedPnlRial)}`}>{formatMoney(asset.realizedPnlRial, currency)}</td>
                        <td className={`td tabular ${toneForNumber(asset.unrealizedPnlRial)}`}>{formatMoney(asset.unrealizedPnlRial, currency)}</td>
                        <td className={`td tabular ${toneForNumber(asset.totalPnlRial)}`}>{formatMoney(asset.totalPnlRial, currency)}</td>
                        <td className={`td tabular ${toneForNumber(asset.returnPercent)}`}>{percentOrMissing(asset.returnPercent)}</td>
                        <td className="td">
                          <Badge tone={valuationTone(asset.valuationStatus)}>{valuationLabel(asset.valuationStatus)}</Badge>
                          {asset.priceDate && <div className="mt-1 text-[11px] text-slate-400">{toJalali(asset.priceDate)}</div>}
                        </td>
                      </tr>
                    ))}
                    {residualIsNonZero && (
                      <tr className="border-b border-slate-50 bg-blue-50/40">
                        <td className="td font-medium">سود نقدی منتسب‌نشده</td>
                        <td className="td" colSpan={3}>سود/هزینهٔ نقدی بدون دارایی مرتبط</td>
                        <td className={`td tabular font-semibold ${toneForNumber(report.unattributedCashProfitRial)}`}>{formatMoney(report.unattributedCashProfitRial, currency)}</td>
                        <td className="td" colSpan={5}>—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="border-slate-300">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Database size={18} className="text-brand-600" />
                  <h2 className="font-semibold text-slate-800">دادهٔ مبنای دلار و طلا</h2>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500">
                  ثبت قیمت امروز فقط یک نقطه می‌سازد. برای سناریوی هر واریز، قیمت همان تاریخ تمام جریان‌های سرمایه لازم است.
                  API دادهٔ تاریخی را می‌پذیرد؛ فعلاً ردیف‌ها را دستی وارد کنید و برای ورود گروهی از مسیر import API استفاده کنید.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={backfillBenchmarks} disabled={benchmarkBusy}>
                  <Download size={16} /> دریافت تاریخچهٔ دلار و طلا
                </button>
                <button className="btn-secondary" onClick={captureLiveBenchmarks} disabled={benchmarkBusy}>
                  <RefreshCw size={16} className={benchmarkBusy ? "animate-spin" : ""} />
                  ثبت قیمت زندهٔ امروز
                </button>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              {BENCHMARK_KEYS.map((key) => {
                const coverage = report.coverage.benchmarks.find((item) => item.key === key);
                return (
                  <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{BENCHMARK_LABELS[key]}</span>
                      <Badge tone={coverage ? statusTone(coverage.status) : "red"}>
                        {coverage ? statusLabel(coverage.status) : "فاقد داده"}
                      </Badge>
                    </div>
                    {coverage?.missingFlowDates.length ? (
                      <div className="mt-2 leading-6 text-amber-800">
                        تاریخ‌های جریان بدون قیمت: {missingDatesText(coverage.missingFlowDates)}
                      </div>
                    ) : coverage?.status === "COMPLETE" ? (
                      <div className="mt-2 text-green-700">قیمت تاریخ تمام جریان‌ها موجود است.</div>
                    ) : (
                      <div className="mt-2 text-amber-800">قیمت شروع/پایان یا تاریخ‌های موردنیاز هنوز کامل نیست.</div>
                    )}
                    {coverage?.staleDays != null && coverage.staleDays > 0 && (
                      <div className="mt-1 text-xs text-slate-500">
                        آخرین قیمت {toPersianDigits(coverage.staleDays)} روز با انتهای بازه فاصله دارد.
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{BENCHMARK_LABELS.INFLATION_INDEX_IR}</span>
                  <Badge tone={statusTone(report.inflation.status)}>{statusLabel(report.inflation.status)}</Badge>
                </div>
                {report.inflation.status === "COMPLETE" ? (
                  <div className="mt-2 text-violet-900">
                    تورم بازه: {percentOrMissing(report.inflation.inflationPercent)}
                    {report.inflation.lastAcceptedDate && (
                      <div className="text-xs text-violet-700">
                        آخرین نقطهٔ ثبت‌شده: {toJalali(report.inflation.lastAcceptedDate)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 leading-6 text-violet-900">
                    {report.inflation.pointsCount > 0
                      ? "نقاط شاخص ثبت شده اما یکی از دو انتهای بازه پوشش ندارد."
                      : "هیچ نقطهٔ شاخصی ثبت نشده است؛ برای بازده واقعی، نقاط شاخص مصرف‌کننده را وارد کنید."}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-800">
                دادهٔ ناقص عمداً به صورت «داده کافی نیست» می‌ماند؛ هیچ بازده، سود یا برندهٔ صفر از آن ساخته نمی‌شود.
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(170px,1fr)_minmax(220px,1.4fr)_auto] md:items-end">
              <div>
                <label className="label">شاخص</label>
                <select
                  className="input"
                  value={benchmarkForm.key}
                  onChange={(event) =>
                    setBenchmarkForm((current) => ({ ...current, key: event.target.value as BenchmarkKey }))
                  }
                >
                  {[...BENCHMARK_KEYS, "INFLATION_INDEX_IR" as BenchmarkKey].map((key) => (
                    <option key={key} value={key}>{BENCHMARK_LABELS[key]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">تاریخ قیمت (شمسی)</label>
                <JalaliDateInput
                  value={benchmarkForm.date}
                  onChange={(date) => setBenchmarkForm((current) => ({ ...current, date }))}
                />
              </div>
              <div>
                <label className="label">مقدار هر {BENCHMARK_UNIT_HINTS[benchmarkForm.key]} (ریال)</label>
                <input
                  className="input tabular"
                  inputMode="decimal"
                  value={benchmarkForm.priceRial}
                  onChange={(event) =>
                    setBenchmarkForm((current) => ({ ...current, priceRial: event.target.value }))
                  }
                  placeholder={benchmarkForm.key === "INFLATION_INDEX_IR" ? "مثلاً 185.4" : "مبلغ ریالی بدون جداکننده"}
                />
              </div>
              <button className="btn-primary" onClick={addBenchmarkPrice} disabled={benchmarkBusy}>
                ثبت ردیف
              </button>
            </div>
            <p className="mt-3 text-xs leading-6 text-amber-700">
              ثبت دستی یا زنده با overwrite=false انجام می‌شود؛ اگر همان شاخص و تاریخ قبلاً وجود داشته باشد، بازنویسی باید عمداً در سمت سرور مدیریت شود.
            </p>
            {benchmarkForm.key === "INFLATION_INDEX_IR" && (
              <p className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-6 text-violet-900">
                برای تورم، «عدد شاخص قیمت مصرف‌کننده» همان ماه را وارد کنید (اعشار مجاز است، مثلاً ۱۸۵٫۴). فقط نسبت دو نقطه
                مهم است، پس مقیاس و پایهٔ شاخص اهمیتی ندارد؛ کافی است همهٔ نقاط از یک جدول و یک پایه باشند. برای هر بازه
                حداقل یک نقطه در ابتدا و یک نقطه در انتها لازم است.
              </p>
            )}
          </Card>

          <Card className="border-blue-200 bg-blue-50/40">
            <h2 className="mb-2 font-semibold text-blue-900">روش محاسبه و محدودیت‌ها</h2>
            <ul className="list-inside list-disc space-y-1 text-sm leading-7 text-blue-900">
              <li>سود واقعی ریالی از تغییر NAV پس از حذف اثر واریز و برداشت به‌دست می‌آید؛ خود واریز سود نیست.</li>
              <li>دارایی AT_COST به بهای تمام‌شده است و ارزش منصفانهٔ بازار یا سود تحقق‌نیافتهٔ قابل اتکا نشان نمی‌دهد.</li>
              <li>قیمت گمشدهٔ دلار یا طلا با قیمت روز بعد، قیمت آینده یا صفر پر نمی‌شود.</li>
              <li>مقایسهٔ نقطه‌به‌نقطه و سناریوی خرید در تاریخ هر واریز دو روش متفاوت‌اند و می‌توانند نتیجه‌های متفاوت بدهند.</li>
              <li>
                بازده واقعی از رابطهٔ (۱ + بازده اسمی) ÷ (۱ + تورم) − ۱ می‌آید و تورم آن از نقاط «شاخص قیمت مصرف‌کننده» است
                که خودتان وارد می‌کنید؛ اگر نقطه‌ای برای ابتدا یا انتهای بازه نباشد، عددی ساخته نمی‌شود.
              </li>
              <li>قیمت‌های تاریخی دلار و طلا از صفحهٔ عمومی تاریخچهٔ TGJU گرفته می‌شوند (حدود ۳۰ روز اخیر) و ردیف‌های موجود هرگز بازنویسی نمی‌شوند.</li>
              <li>بازهٔ مؤثر گزارش از {report.meta.effectiveFrom ? toJalali(report.meta.effectiveFrom) : "اولین دادهٔ موجود"} تا {report.meta.effectiveTo ? toJalali(report.meta.effectiveTo) : toJalali(report.meta.to)} است.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
