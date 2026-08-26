import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { api, exportUrl, type NavSnapshot } from "../lib/api";
import { Card, PageHeader, StatCard, RiskNotice, Empty, Badge } from "../components/ui";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, formatPercent, toJalali } from "../lib/format";
import { assetClassLabel } from "../lib/labels";

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
        <h3 className="mb-4 font-semibold text-slate-700">تخصیص دارایی بر اساس دسته</h3>
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
