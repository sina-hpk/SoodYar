import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { api, exportUrl, type NavSnapshot } from "../lib/api";
import { Card, PageHeader, StatCard, RiskNotice, Empty, Badge } from "../components/ui";
import { AllocationChart } from "../components/AllocationChart";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, formatPercent, toJalali, toPersianDigits } from "../lib/format";
import { assetClassLabel } from "../lib/labels";

const CAT_COLORS = ["#2f8659", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#eab308", "#06b6d4", "#a855f7", "#4fa172", "#94a3b8", "#226b47", "#7fbf99", "#d6ecdf", "#aed8bf"];

export default function Reports() {
  const { currency } = useSettings();
  const [report, setReport] = useState<any>(null);
  const [nav, setNav] = useState<NavSnapshot[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.portfolioReport().then(setReport).catch((e) => setError(e.message));
    api.navHistory().then(setNav).catch(() => {});
  }, []);

  if (error) return <Card className="text-red-600">{error}</Card>;
  if (!report) return <div className="text-slate-400">در حال بارگذاری…</div>;

  const compact = (v: number) =>
    toPersianDigits(new Intl.NumberFormat("en-US", { notation: "compact" }).format(v));

  const navChartData = nav.map((s) => ({
    date: toJalali(s.navDate, "MM/dd"),
    total: Number(s.totalNavRial),
    assets: Number(s.assetsValueRial),
    cash: Number(s.cashBalanceRial),
  }));

  const categoryBarData = (report.categories ?? [])
    .filter((c: any) => Number(c.marketValueRial) > 0)
    .map((c: any) => ({
      name: assetClassLabel(c.category),
      value: Number(c.marketValueRial),
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="گزارش‌ها"
        subtitle="عملکرد کل سبد، گزارش اعضا و خروجی‌ها"
        action={
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary" href={exportUrl("/reports/export/member-transactions.csv")}>
              <Download size={16} /> تراکنش اعضا (CSV)
            </a>
            <a className="btn-secondary" href={exportUrl("/reports/export/portfolio-transactions.csv")}>
              <Download size={16} /> تراکنش پرتفوی (CSV)
            </a>
            <a className="btn-secondary" href={exportUrl("/reports/export/portfolio-assets.csv")}>
              <Download size={16} /> دارایی‌ها و سود/زیان (CSV)
            </a>
            <a className="btn-secondary" href={exportUrl("/reports/export/members.csv")}>
              <Download size={16} /> اعضا (CSV)
            </a>
            <a className="btn-secondary" href={exportUrl("/reports/export/nav-history.csv")}>
              <FileSpreadsheet size={16} /> تاریخچه NAV (CSV)
            </a>
          </div>
        }
      />
      <RiskNotice />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="NAV کل" value={formatMoney(report.totalNavRial, currency)} accent="text-brand-700" />
        <StatCard label="NAV هر واحد" value={formatMoney(report.navPerUnit, currency)} />
        <StatCard label="ارزش دارایی‌ها" value={formatMoney(report.assetsValueRial, currency)} />
        <StatCard label="واحدهای فعال" value={formatUnits(report.totalActiveUnits)} />
      </div>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">روند ارزش کل صندوق</h3>
        {navChartData.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            برای رسم این نمودار، در صفحهٔ «محاسبه NAV» چند عکس‌فوری NAV ثبت کنید.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={navChartData} margin={{ left: 10, right: 10 }}>
              <defs>
                <linearGradient id="repTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2f8659" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2f8659" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="repAssets" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} reversed />
              <YAxis tick={{ fontSize: 11 }} width={80} tickFormatter={compact} />
              <Tooltip
                formatter={(v: number, name) => [formatMoney(String(Math.round(v)), currency), name as string]}
                labelFormatter={(l) => `تاریخ: ${l}`}
              />
              <Area type="monotone" dataKey="total" name="ارزش کل" stroke="#2f8659" strokeWidth={2} fill="url(#repTotal)" />
              <Area type="monotone" dataKey="assets" name="دارایی‌ها" stroke="#3b82f6" strokeWidth={1.5} fill="url(#repAssets)" />
              <Area type="monotone" dataKey="cash" name="نقد" stroke="#f59e0b" strokeWidth={1.5} fillOpacity={0} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-6">
        <AllocationChart categories={report.categories ?? []} currency={currency} />
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">ارزش هر دستهٔ دارایی</h3>
        {categoryBarData.length === 0 ? (
          <Empty>دسته‌ای با ارزش روز برای نمایش وجود ندارد.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, categoryBarData.length * 46)}>
            <BarChart data={categoryBarData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={compact} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12 }}
                width={110}
                orientation="right"
              />
              <Tooltip formatter={(v: number) => formatMoney(String(Math.round(v)), currency)} />
              <Bar dataKey="value" name="ارزش روز" radius={[0, 6, 6, 0]}>
                {categoryBarData.map((_: any, i: number) => (
                  <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">جدول تخصیص دسته‌ها</h3>
        {!report.categories || report.categories.length === 0 ? (
          <Empty>دسته‌ای برای نمایش وجود ندارد.</Empty>
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
                {report.categories.map((c: any) => (
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
                    <td className="td tabular">{c.category === "CASH" ? "—" : c.assetCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">گزارش اعضا</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">عضو</th>
                <th className="th">واحد فعال</th>
                <th className="th">درصد مالکیت</th>
                <th className="th">سرمایه خالص واردشده</th>
                <th className="th">ارزش روز</th>
                <th className="th">سود/زیان خالص ساده</th>
              </tr>
            </thead>
            <tbody>
              {report.members.map((m: any) => {
                const pnl = Number(m.simpleNetPnlRial ?? m.pnlRial);
                return (
                  <tr key={m.id} className="border-b border-slate-50">
                    <td className="td font-medium">{m.fullName}</td>
                    <td className="td tabular">{formatUnits(m.activeUnits)}</td>
                    <td className="td tabular">{formatPercent(m.ownershipPercent)}</td>
                    <td className="td tabular">{formatMoney(m.netContributedCapitalRial, currency)}</td>
                    <td className="td tabular">{formatMoney(m.currentValueRial, currency)}</td>
                    <td className={`td tabular ${pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatMoney(m.simpleNetPnlRial ?? m.pnlRial, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">گزارش NAV در بازه زمانی</h3>
        {nav.length === 0 ? (
          <Empty>تاریخچه NAV موجود نیست.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">تاریخ</th>
                  <th className="th">نقد</th>
                  <th className="th">دارایی‌ها</th>
                  <th className="th">بدهی</th>
                  <th className="th">NAV کل</th>
                  <th className="th">واحد فعال</th>
                  <th className="th">NAV هر واحد</th>
                </tr>
              </thead>
              <tbody>
                {nav.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50">
                    <td className="td">{toJalali(s.navDate)}</td>
                    <td className="td tabular">{formatMoney(s.cashBalanceRial, currency)}</td>
                    <td className="td tabular">{formatMoney(s.assetsValueRial, currency)}</td>
                    <td className="td tabular">{formatMoney(s.liabilitiesRial, currency)}</td>
                    <td className="td tabular">{formatMoney(s.totalNavRial, currency)}</td>
                    <td className="td tabular">{formatUnits(s.totalActiveUnits)}</td>
                    <td className="td tabular">{formatMoney(s.navPerUnit, currency)}</td>
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
