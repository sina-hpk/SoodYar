import { useEffect, useState } from "react";
import {
  Wallet,
  TrendingUp,
  Users,
  Layers,
  Coins,
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
} from "recharts";
import { api, type Dashboard as DashboardData, type NavSnapshot, type MemberTx } from "../lib/api";
import { StatCard, Card, PageHeader, RiskNotice, Badge, Empty } from "../components/ui";
import { formatMoney, formatUnits, formatPercent, toJalali, toPersianDigits } from "../lib/format";
import { useSettings } from "../context/SettingsContext";
import { txTypeLabel, txStatusTone, txStatusLabel, assetClassLabel } from "../lib/labels";

const PIE_COLORS = ["#2f8659", "#4fa172", "#7fbf99", "#aed8bf", "#226b47", "#d6ecdf", "#94a3b8", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#eab308", "#06b6d4", "#a855f7"];

export default function Dashboard() {
  const { currency } = useSettings();
  const [data, setData] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<NavSnapshot[]>([]);
  const [recent, setRecent] = useState<MemberTx[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.dashboard(), api.navHistory(), api.memberTxs()])
      .then(([d, h, txs]) => {
        setData(d);
        setHistory(h);
        setRecent(txs.slice(0, 8));
      })
      .catch((e) => setError(e.message));
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

  const totalNavPositive = Number(data.totalNavRial) > 0;
  const categories = data.categories ?? [];
  const pieData = categories
    .filter((c) => Number(c.marketValueRial) > 0)
    .map((c) => ({ name: assetClassLabel(c.category), value: Number(c.marketValueRial) }));

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
