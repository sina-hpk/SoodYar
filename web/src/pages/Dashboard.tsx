import { useEffect, useState } from "react";
import {
  Wallet,
  TrendingUp,
  Users,
  Layers,
  Coins,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";
import { api, type Dashboard as DashboardData, type NavSnapshot, type MemberTx, type MarketSnapshot } from "../lib/api";
import { StatCard, Card, PageHeader, RiskNotice, Badge, Empty } from "../components/ui";
import { formatMoney, formatUnits, formatPercent, toJalali, toPersianDigits } from "../lib/format";
import { useSettings } from "../context/SettingsContext";
import { txTypeLabel, txStatusTone, txStatusLabel, assetClassLabel } from "../lib/labels";

const PIE_COLORS = ["#2f8659", "#4fa172", "#7fbf99", "#aed8bf", "#226b47", "#d6ecdf", "#94a3b8", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#eab308", "#06b6d4", "#a855f7"];

const MARKET_CAT_LABEL: Record<string, string> = {
  FX: "ارز",
  GOLD: "طلا",
  COIN: "سکه",
  SILVER: "نقره",
  CRYPTO: "رمزارز",
};
const MARKET_CAT_ORDER = ["FX", "GOLD", "COIN", "SILVER", "CRYPTO"];

export default function Dashboard() {
  const { currency } = useSettings();
  const [data, setData] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<NavSnapshot[]>([]);
  const [recent, setRecent] = useState<MemberTx[]>([]);
  const [error, setError] = useState("");
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");

  useEffect(() => {
    Promise.all([api.dashboard(), api.navHistory(), api.memberTxs()])
      .then(([d, h, txs]) => {
        setData(d);
        setHistory(h);
        setRecent(txs.slice(0, 8));
      })
      .catch((e) => setError(e.message));
  }, []);

  function loadMarket(force = false) {
    setMarketLoading(true);
    setMarketError("");
    api
      .marketQuotes(force)
      .then(setMarket)
      .catch((e) => setMarketError(e.message))
      .finally(() => setMarketLoading(false));
  }
  useEffect(() => {
    loadMarket(false);
  }, []);

  if (error)
    return (
      <Card className="text-red-600">
        خطا در بارگذاری داده‌ها: {error}. مطمئن شوید سرور در حال اجراست.
      </Card>
    );
  if (!data) return <div className="text-slate-400">در حال بارگذاری…</div>;

  const chartData = history.map((h) => ({
    date: toJalali(h.navDate, "MM/dd"),
    nav: Number(h.navPerUnit),
  }));

  // Total fund value (کل ارزش صندوق) over time, from committed NAV snapshots.
  const fundValueData = history.map((h) => ({
    date: toJalali(h.navDate, "MM/dd"),
    total: Number(h.totalNavRial),
    cash: Number(h.cashBalanceRial),
    assets: Number(h.assetsValueRial),
  }));

  const totalNavPositive = Number(data.totalNavRial) > 0;
  const categories = data.categories ?? [];
  const pieData = categories
    .filter((c) => Number(c.marketValueRial) > 0)
    .map((c) => ({ name: assetClassLabel(c.category), value: Number(c.marketValueRial) }));

  const compact = (v: number) =>
    toPersianDigits(new Intl.NumberFormat("en-US", { notation: "compact" }).format(v));

  const marketGroups = MARKET_CAT_ORDER.map((cat) => ({
    cat,
    label: MARKET_CAT_LABEL[cat],
    quotes: (market?.quotes ?? []).filter((q) => q.category === cat),
  })).filter((g) => g.quotes.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="داشبورد" subtitle="نمای کلی سبد سرمایه‌گذاری" />
      <RiskNotice />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="NAV کل"
          value={formatMoney(data.totalNavRial, currency)}
          icon={<TrendingUp size={22} />}
          accent="text-brand-700"
        />
        <StatCard
          label="NAV هر واحد"
          value={formatMoney(data.navPerUnit, currency)}
          icon={<Coins size={22} />}
        />
        <StatCard
          label="موجودی نقد"
          value={formatMoney(data.cashBalanceRial, currency)}
          icon={<Wallet size={22} />}
        />
        <StatCard
          label="اعضای فعال"
          value={toPersianDigits(data.activeMemberCount)}
          icon={<Users size={22} />}
        />
        <StatCard
          label="واحدهای فعال"
          value={formatUnits(data.totalActiveUnits)}
          icon={<Layers size={22} />}
        />
      </div>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">ارزش کل صندوق در طول زمان</h3>
        {fundValueData.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            هنوز NAV ثبت‌شده‌ای وجود ندارد. پس از ثبت اولین NAV در صفحهٔ «محاسبه NAV»، روند ارزش کل صندوق اینجا رسم می‌شود.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={fundValueData} margin={{ left: 10, right: 10 }}>
              <defs>
                <linearGradient id="fundTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2f8659" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2f8659" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} reversed />
              <YAxis
                tick={{ fontSize: 11 }}
                width={80}
                tickFormatter={compact}
              />
              <Tooltip
                formatter={(v: number, name) => [
                  formatMoney(String(Math.round(v)), currency),
                  name as string,
                ]}
                labelFormatter={(l) => `تاریخ: ${l}`}
              />
              <Area
                type="monotone"
                dataKey="total"
                name="ارزش کل"
                stroke="#2f8659"
                strokeWidth={2}
                fill="url(#fundTotal)"
              />
              <Line type="monotone" dataKey="assets" name="دارایی‌ها" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="cash" name="نقد" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <p className="mt-3 text-xs leading-6 text-slate-500">
          این نمودار مجموع ارزش صندوق (نقد + ارزش روز دارایی‌ها − بدهی) را در تاریخ‌هایی که NAV ثبت شده نشان می‌دهد. برای پرشدن آن، هر بار پس از به‌روزرسانی قیمت‌ها در صفحهٔ «محاسبه NAV» یک عکس‌فوری NAV ثبت کنید.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-4 font-semibold text-slate-700">روند NAV هر واحد</h3>
          {chartData.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              هنوز تاریخچه‌ای ثبت نشده است.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} reversed />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={80}
                  tickFormatter={(v) => toPersianDigits(new Intl.NumberFormat("en-US", { notation: "compact" }).format(v))}
                />
                <Tooltip
                  formatter={(v: number) => formatMoney(String(Math.round(v)), currency)}
                  labelFormatter={(l) => `تاریخ: ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="nav"
                  stroke="#2f8659"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h3 className="mb-4 font-semibold text-slate-700">تخصیص دارایی بر اساس دسته</h3>
          {!totalNavPositive ? (
            <div className="py-12 text-center text-sm text-slate-400">
              خالص ارزش دارایی صفر یا منفی است؛ نمودار تخصیص قابل نمایش نیست.
            </div>
          ) : pieData.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              دارایی‌ای برای نمایش نیست.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={2}
                  label={(e) => e.name}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => formatMoney(String(v), currency)}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">جدول تخصیص دسته‌ها</h3>
        {categories.length === 0 ? (
          <Empty>هنوز دارایی یا نقدی برای تخصیص وجود ندارد.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">دسته</th>
                  <th className="th">ارزش بازار</th>
                  <th className="th">درصد تخصیص</th>
                  <th className="th">تعداد دارایی</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.category} className="border-b border-slate-50">
                    <td className="td">
                      <Badge tone={c.category === "CASH" ? "amber" : "blue"}>
                        {assetClassLabel(c.category)}
                      </Badge>
                    </td>
                    <td className="td tabular">{formatMoney(c.marketValueRial, currency)}</td>
                    <td className="td tabular">
                      {c.allocationPercent != null ? formatPercent(c.allocationPercent) : "—"}
                    </td>
                    <td className="td tabular">
                      {c.category === "CASH" ? "—" : toPersianDigits(c.assetCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-700">بازارهای زنده</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              قیمت لحظه‌ای ارز، طلا، سکه، نقره و رمزارز — منبع: TGJU/CoinGecko
              {market?.fetchedAt && (
                <> · به‌روزرسانی: {toJalali(market.fetchedAt, "HH:mm")}</>
              )}
            </p>
          </div>
          <button
            className="btn-secondary"
            onClick={() => loadMarket(true)}
            disabled={marketLoading}
          >
            <RefreshCw size={16} className={marketLoading ? "animate-spin" : ""} />
            به‌روزرسانی
          </button>
        </div>

        {marketError ? (
          <div className="py-8 text-center text-sm text-red-500">
            دریافت قیمت‌های بازار ناموفق بود: {marketError}
          </div>
        ) : marketLoading && !market ? (
          <div className="py-8 text-center text-sm text-slate-400">در حال دریافت قیمت‌ها…</div>
        ) : marketGroups.length === 0 ? (
          <Empty>در حال حاضر قیمتی از بازار در دسترس نیست.</Empty>
        ) : (
          <div className="space-y-5">
            {market?.partial && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                برخی منابع در دسترس نبودند؛ داده‌ها ممکن است ناقص باشد.
              </div>
            )}
            {marketGroups.map((g) => (
              <div key={g.cat}>
                <div className="mb-2 text-sm font-medium text-slate-600">{g.label}</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {g.quotes.map((q) => {
                    const up = q.changePercent != null && q.changePercent > 0;
                    const down = q.changePercent != null && q.changePercent < 0;
                    return (
                      <div
                        key={q.key}
                        className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-600">{q.name}</span>
                          {q.changePercent != null && q.changePercent !== 0 && (
                            <span
                              className={`flex items-center gap-0.5 text-[11px] ${
                                up ? "text-green-600" : down ? "text-red-600" : "text-slate-400"
                              }`}
                            >
                              {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                              {formatPercent(Math.abs(q.changePercent))}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 tabular text-sm font-semibold text-slate-800">
                          {q.priceRial
                            ? formatMoney(q.priceRial, currency)
                            : q.priceUsd
                              ? `${toPersianDigits(q.priceUsd)} $`
                              : "—"}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {q.unit}
                          {q.priceUsd && q.priceRial ? ` · ${toPersianDigits(q.priceUsd)}$` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">آخرین تراکنش‌ها</h3>
        {recent.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">تراکنشی نیست.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">عضو</th>
                  <th className="th">نوع</th>
                  <th className="th">مبلغ</th>
                  <th className="th">واحد</th>
                  <th className="th">تاریخ</th>
                  <th className="th">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="td">{t.member?.fullName ?? "-"}</td>
                    <td className="td">{txTypeLabel(t.type)}</td>
                    <td className="td tabular">{formatMoney(t.amountRial, currency)}</td>
                    <td className="td tabular">{formatUnits(t.units)}</td>
                    <td className="td">{toJalali(t.effectiveDate)}</td>
                    <td className="td">
                      <Badge tone={txStatusTone(t.status)}>{txStatusLabel(t.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
