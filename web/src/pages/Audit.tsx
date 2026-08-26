import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type AuditReport } from "../lib/api";
import { Card, PageHeader, Empty, InfoNote, Badge } from "../components/ui";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, formatPercent, toJalali } from "../lib/format";
import { assetClassLabel } from "../lib/labels";

export default function Audit() {
  const { currency } = useSettings();
  const [data, setData] = useState<AuditReport | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setData(await api.auditReport());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (error) return <Card className="text-red-600">{error}</Card>;
  if (!data) return <div className="text-slate-400">در حال بارگذاری…</div>;

  const { nav, assets, categories, members, logs } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="جزئیات محاسبات و ممیزی"
        subtitle="نمایش شفاف نحوه محاسبه NAV، ارزش دارایی‌ها و سهم اعضا"
        action={
          <button className="btn-secondary" onClick={load}>
            <RefreshCw size={18} /> به‌روزرسانی
          </button>
        }
      />
      <InfoNote>
        همه اعداد از روی تراکنش‌های تأییدشده بازسازی می‌شوند و قابل ردیابی هستند؛ هیچ عددی به‌صورت دستی ذخیره نمی‌شود.
      </InfoNote>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">محاسبه NAV</h3>
        <div className="space-y-1 rounded-lg bg-slate-50 p-4 text-sm tabular text-slate-700">
          <div>موجودی نقد: {formatMoney(nav.cashBalanceRial, currency)}</div>
          <div>+ ارزش روز دارایی‌ها: {formatMoney(nav.assetsValueRial, currency)}</div>
          <div>− بدهی‌ها: {formatMoney(nav.liabilitiesRial, currency)}</div>
          <div className="border-t border-slate-200 pt-1 font-semibold text-slate-800">
            = NAV کل: {formatMoney(nav.totalNavRial, currency)}
          </div>
          <div className="pt-1">
            ÷ واحدهای فعال: {formatUnits(nav.totalActiveUnits)} = NAV هر واحد:{" "}
            {formatMoney(nav.navPerUnit, currency)}
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">ریز محاسبات دارایی‌ها</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">نماد</th>
                <th className="th">دسته</th>
                <th className="th">مقدار</th>
                <th className="th">میانگین خرید</th>
                <th className="th">بهای باقی‌مانده</th>
                <th className="th">قیمت روز</th>
                <th className="th">ارزش روز</th>
                <th className="th">تحقق‌نیافته</th>
                <th className="th">محقق‌شده</th>
                <th className="th">کل</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.assetId} className="border-b border-slate-50">
                  <td className="td">{a.symbol}</td>
                  <td className="td"><Badge tone="blue">{assetClassLabel(a.assetClass)}</Badge></td>
                  <td className="td tabular">{formatUnits(a.quantity, 8)}</td>
                  <td className="td tabular">{formatMoney(a.avgCostRial, currency)}</td>
                  <td className="td tabular">{formatMoney(a.remainingCostBasisRial, currency)}</td>
                  <td className="td tabular">{a.latestPriceRial ? formatMoney(a.latestPriceRial, currency) : "—"}</td>
                  <td className="td tabular">{formatMoney(a.marketValueRial, currency)}</td>
                  <td className="td tabular">{formatMoney(a.unrealizedPnlRial, currency)}</td>
                  <td className="td tabular">{formatMoney(a.realizedPnlRial, currency)}</td>
                  <td className="td tabular">{formatMoney(a.totalPnlRial, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">تخصیص دسته‌ها</h3>
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
                  <td className="td"><Badge tone={c.category === "CASH" ? "amber" : "blue"}>{assetClassLabel(c.category)}</Badge></td>
                  <td className="td tabular">{formatMoney(c.marketValueRial, currency)}</td>
                  <td className="td tabular">{c.allocationPercent != null ? formatPercent(c.allocationPercent) : "—"}</td>
                  <td className="td tabular">{c.category === "CASH" ? "—" : c.assetCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">سهم اعضا</h3>
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
              {members.map((m) => (
                <tr key={m.id} className="border-b border-slate-50">
                  <td className="td font-medium">{m.fullName}</td>
                  <td className="td tabular">{formatUnits(m.activeUnits)}</td>
                  <td className="td tabular">{formatPercent(m.ownershipPercent)}</td>
                  <td className="td tabular">{formatMoney(m.netContributedCapitalRial, currency)}</td>
                  <td className="td tabular">{formatMoney(m.currentValueRial, currency)}</td>
                  <td className="td tabular">{formatMoney(m.simpleNetPnlRial, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">آخرین رویدادهای ثبت‌شده (Audit Log)</h3>
        {logs.length === 0 ? (
          <Empty>رویدادی ثبت نشده است.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">تاریخ</th>
                  <th className="th">عملیات</th>
                  <th className="th">موجودیت</th>
                  <th className="th">کاربر</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50">
                    <td className="td">{toJalali(l.createdAt, "yyyy/MM/dd HH:mm")}</td>
                    <td className="td font-mono text-xs">{l.action}</td>
                    <td className="td text-xs text-slate-500">{l.entityType}</td>
                    <td className="td text-xs text-slate-500">{l.actor}</td>
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
