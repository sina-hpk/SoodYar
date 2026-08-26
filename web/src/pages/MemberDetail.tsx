import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import {
  api,
  type Member,
  type MemberSummary,
  type MemberTx,
  type MemberCategoryExposure,
  type MemberXirr,
} from "../lib/api";
import { Card, PageHeader, StatCard, Badge, Empty, RiskNotice, InfoNote } from "../components/ui";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, formatPercent, toJalali } from "../lib/format";
import { txTypeLabel, txStatusLabel, txStatusTone, assetClassLabel } from "../lib/labels";

const DISCLAIMER =
  "این ارقام، سهم تحلیلی و متناسب عضو از ترکیب فعلی کل سبد هستند؛ دارایی‌ها به‌صورت مجزا به نام عضو نگهداری نمی‌شوند.";

export default function MemberDetail() {
  const { id } = useParams<{ id: string }>();
  const { currency } = useSettings();
  const [data, setData] = useState<{
    member: Member;
    summary: MemberSummary;
    exposure: MemberCategoryExposure[];
    xirr: MemberXirr;
    transactions: MemberTx[];
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api.member(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <Card className="text-red-600">{error}</Card>;
  if (!data) return <div className="text-slate-400">در حال بارگذاری…</div>;

  const { member, summary, exposure, xirr, transactions } = data;
  const pnl = Number(summary.simpleNetPnlRial);

  return (
    <div className="space-y-6">
      <PageHeader
        title={member.fullName}
        subtitle="عملکرد، سهم تحلیلی از دسته‌ها و تاریخچه تراکنش‌ها"
        action={
          <Link to="/members" className="btn-secondary">
            <ArrowRight size={18} /> بازگشت
          </Link>
        }
      />
      <RiskNotice />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="واحد فعال" value={formatUnits(summary.activeUnits)} />
        <StatCard label="درصد مالکیت" value={formatPercent(summary.ownershipPercent)} />
        <StatCard label="ارزش روز" value={formatMoney(summary.currentValueRial, currency)} accent="text-brand-700" />
        <StatCard label="مجموع واریز" value={formatMoney(summary.totalDepositRial, currency)} />
        <StatCard label="مجموع برداشت" value={formatMoney(summary.totalWithdrawalRial, currency)} />
        <StatCard label="سرمایه خالص واردشده" value={formatMoney(summary.netContributedCapitalRial, currency)} />
        <StatCard
          label="سود/زیان خالص ساده"
          value={formatMoney(summary.simpleNetPnlRial, currency)}
          hint={summary.simpleReturnPercent != null ? `بازده ساده: ${formatPercent(summary.simpleReturnPercent)}` : undefined}
          accent={pnl >= 0 ? "text-green-600" : "text-red-600"}
        />
        <StatCard
          label="بازده سالانه‌شده مبتنی بر جریان نقدی (XIRR)"
          value={xirr.xirrPercent != null ? formatPercent(xirr.xirrPercent) : "—"}
          hint={xirr.note}
        />
      </div>

      <InfoNote>{DISCLAIMER}</InfoNote>

      <Card>
        <h3 className="mb-1 font-semibold text-slate-700">سهم تحلیلی عضو از دسته‌های دارایی</h3>
        <p className="mb-4 text-xs text-slate-500">
          سهم عضو از هر دسته = درصد مالکیت × ارزش بازار آن دسته در کل سبد.
        </p>
        {exposure.length === 0 ? (
          <Empty>دسته‌ای برای نمایش وجود ندارد.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">دسته</th>
                  <th className="th">ارزش دسته در کل سبد</th>
                  <th className="th">سهم تحلیلی عضو</th>
                </tr>
              </thead>
              <tbody>
                {exposure.map((c) => (
                  <tr key={c.category} className="border-b border-slate-50">
                    <td className="td">
                      <Badge tone={c.category === "CASH" ? "amber" : "blue"}>
                        {assetClassLabel(c.category)}
                      </Badge>
                    </td>
                    <td className="td tabular">{formatMoney(c.categoryValueRial, currency)}</td>
                    <td className="td tabular">{formatMoney(c.exposureRial, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-700">تاریخچه تراکنش‌ها</h3>
        {transactions.length === 0 ? (
          <Empty>تراکنشی ثبت نشده است.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">نوع</th>
                  <th className="th">مبلغ</th>
                  <th className="th">واحد</th>
                  <th className="th">NAV هر واحد</th>
                  <th className="th">تاریخ</th>
                  <th className="th">وضعیت</th>
                  <th className="th">توضیح</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="td">{txTypeLabel(t.type)}</td>
                    <td className="td tabular">{formatMoney(t.amountRial, currency)}</td>
                    <td className="td tabular">{formatUnits(t.units)}</td>
                    <td className="td tabular">
                      {t.navPerUnit ? formatMoney(t.navPerUnit, currency) : "-"}
                    </td>
                    <td className="td">{toJalali(t.effectiveDate)}</td>
                    <td className="td">
                      <Badge tone={txStatusTone(t.status)}>{txStatusLabel(t.status)}</Badge>
                    </td>
                    <td className="td text-slate-500">{t.description ?? "-"}</td>
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
