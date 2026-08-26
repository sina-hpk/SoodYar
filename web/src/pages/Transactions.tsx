import { useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { api, type Member, type MemberTx } from "../lib/api";
import { Card, PageHeader, Badge, Empty, RiskNotice } from "../components/ui";
import { Modal, ConfirmDialog } from "../components/Modal";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, toJalali, todayIso } from "../lib/format";
import { txTypeLabel, txStatusLabel, txStatusTone } from "../lib/labels";

const TYPE_OPTIONS = [
  "",
  "DEPOSIT",
  "WITHDRAWAL_REQUEST",
  "WITHDRAWAL_SETTLEMENT",
  "UNIT_ISSUANCE",
  "UNIT_REDEMPTION",
  "ADJUSTMENT",
];
const STATUS_OPTIONS = ["", "CONFIRMED", "PENDING", "SETTLED", "CANCELLED"];

export default function Transactions() {
  const { currency } = useSettings();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [txs, setTxs] = useState<MemberTx[]>([]);
  const [filters, setFilters] = useState({ memberId: "", type: "", status: "", search: "" });

  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [deposit, setDeposit] = useState({ memberId: "", amountRial: "", effectiveDate: todayIso(), description: "" });
  const [withdraw, setWithdraw] = useState({ memberId: "", mode: "amount", amountRial: "", units: "", effectiveDate: todayIso(), description: "" });

  const [settleTarget, setSettleTarget] = useState<MemberTx | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MemberTx | null>(null);

  async function loadMembers() {
    try {
      setMembers(await api.members());
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function loadTxs() {
    try {
      const params: Record<string, string> = {};
      if (filters.memberId) params.memberId = filters.memberId;
      if (filters.type) params.type = filters.type;
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      setTxs(await api.memberTxs(params));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  useEffect(() => {
    loadMembers();
  }, []);
  useEffect(() => {
    loadTxs();
  }, [filters]);

  async function submitDeposit() {
    if (!deposit.memberId || !deposit.amountRial) {
      toast("عضو و مبلغ الزامی است", "error");
      return;
    }
    try {
      await api.deposit({
        memberId: deposit.memberId,
        amountRial: Number(deposit.amountRial),
        effectiveDate: deposit.effectiveDate,
        description: deposit.description,
      });
      toast("واریز ثبت و واحد صادر شد", "success");
      setDepositOpen(false);
      setDeposit({ memberId: "", amountRial: "", effectiveDate: todayIso(), description: "" });
      loadTxs();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function submitWithdraw() {
    if (!withdraw.memberId) {
      toast("عضو الزامی است", "error");
      return;
    }
    const body: Record<string, unknown> = {
      memberId: withdraw.memberId,
      effectiveDate: withdraw.effectiveDate,
      description: withdraw.description,
    };
    if (withdraw.mode === "amount") body.amountRial = Number(withdraw.amountRial);
    else body.units = withdraw.units;
    try {
      await api.withdrawalRequest(body);
      toast("درخواست برداشت ثبت شد (در انتظار تسویه)", "success");
      setWithdrawOpen(false);
      setWithdraw({ memberId: "", mode: "amount", amountRial: "", units: "", effectiveDate: todayIso(), description: "" });
      loadTxs();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function doSettle() {
    if (!settleTarget) return;
    try {
      await api.settleWithdrawal(settleTarget.id, todayIso());
      toast("برداشت تسویه شد", "success");
      setSettleTarget(null);
      loadTxs();
    } catch (e) {
      toast((e as Error).message, "error");
      setSettleTarget(null);
    }
  }

  async function doCancel() {
    if (!cancelTarget) return;
    try {
      await api.cancelWithdrawal(cancelTarget.id);
      toast("درخواست لغو شد", "success");
      setCancelTarget(null);
      loadTxs();
    } catch (e) {
      toast((e as Error).message, "error");
      setCancelTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="تراکنش‌ها"
        subtitle="واریز، درخواست و تسویه برداشت اعضا"
        action={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => setDepositOpen(true)}>
              <ArrowDownCircle size={18} /> واریز
            </button>
            <button className="btn-secondary" onClick={() => setWithdrawOpen(true)}>
              <ArrowUpCircle size={18} /> درخواست برداشت
            </button>
          </div>
        }
      />
      <RiskNotice />

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">عضو</label>
            <select
              className="input"
              value={filters.memberId}
              onChange={(e) => setFilters({ ...filters, memberId: e.target.value })}
            >
              <option value="">همه</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">نوع</label>
            <select
              className="input"
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === "" ? "همه" : txTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select
              className="input"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "همه" : txStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">جستجو</label>
            <input
              className="input"
              placeholder="نام یا توضیح…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
        </div>
      </Card>

      <Card>
        {txs.length === 0 ? (
          <Empty>تراکنشی یافت نشد.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">عضو</th>
                  <th className="th">نوع</th>
                  <th className="th">مبلغ</th>
                  <th className="th">واحد</th>
                  <th className="th">NAV</th>
                  <th className="th">تاریخ</th>
                  <th className="th">وضعیت</th>
                  <th className="th">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="td">{t.member?.fullName ?? "-"}</td>
                    <td className="td">{txTypeLabel(t.type)}</td>
                    <td className="td tabular">{formatMoney(t.amountRial, currency)}</td>
                    <td className="td tabular">{formatUnits(t.units)}</td>
                    <td className="td tabular">{t.navPerUnit ? formatMoney(t.navPerUnit, currency) : "-"}</td>
                    <td className="td">{toJalali(t.effectiveDate)}</td>
                    <td className="td">
                      <Badge tone={txStatusTone(t.status)}>{txStatusLabel(t.status)}</Badge>
                    </td>
                    <td className="td">
                      {t.type === "WITHDRAWAL_REQUEST" && t.status === "PENDING" && (
                        <div className="flex gap-1">
                          <button
                            className="rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100"
                            onClick={() => setSettleTarget(t)}
                          >
                            تسویه
                          </button>
                          <button
                            className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                            onClick={() => setCancelTarget(t)}
                          >
                            لغو
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Deposit modal */}
      <Modal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        title="ثبت واریز عضو"
        footer={
          <>
            <button className="btn-primary" onClick={submitDeposit}>
              ثبت واریز
            </button>
            <button className="btn-secondary" onClick={() => setDepositOpen(false)}>
              انصراف
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label">عضو *</label>
            <select
              className="input"
              value={deposit.memberId}
              onChange={(e) => setDeposit({ ...deposit, memberId: e.target.value })}
            >
              <option value="">انتخاب کنید…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">مبلغ (ریال) *</label>
            <input
              className="input tabular"
              value={deposit.amountRial}
              onChange={(e) => setDeposit({ ...deposit, amountRial: e.target.value })}
            />
          </div>
          <div>
            <label className="label">تاریخ (شمسی)</label>
            <JalaliDateInput
              value={deposit.effectiveDate}
              onChange={(iso) => setDeposit({ ...deposit, effectiveDate: iso })}
            />
          </div>
          <div>
            <label className="label">توضیح</label>
            <input
              className="input"
              value={deposit.description}
              onChange={(e) => setDeposit({ ...deposit, description: e.target.value })}
            />
          </div>
          <p className="text-xs text-slate-500">
            واحد بر اساس NAV لحظه ثبت صادر می‌شود: واحد = مبلغ ÷ NAV هر واحد.
          </p>
        </div>
      </Modal>

      {/* Withdrawal request modal */}
      <Modal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="درخواست برداشت"
        footer={
          <>
            <button className="btn-primary" onClick={submitWithdraw}>
              ثبت درخواست
            </button>
            <button className="btn-secondary" onClick={() => setWithdrawOpen(false)}>
              انصراف
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label">عضو *</label>
            <select
              className="input"
              value={withdraw.memberId}
              onChange={(e) => setWithdraw({ ...withdraw, memberId: e.target.value })}
            >
              <option value="">انتخاب کنید…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">مبنای برداشت</label>
            <select
              className="input"
              value={withdraw.mode}
              onChange={(e) => setWithdraw({ ...withdraw, mode: e.target.value })}
            >
              <option value="amount">بر اساس مبلغ (ریال)</option>
              <option value="units">بر اساس تعداد واحد</option>
            </select>
          </div>
          {withdraw.mode === "amount" ? (
            <div>
              <label className="label">مبلغ (ریال)</label>
              <input
                className="input tabular"
                value={withdraw.amountRial}
                onChange={(e) => setWithdraw({ ...withdraw, amountRial: e.target.value })}
              />
            </div>
          ) : (
            <div>
              <label className="label">تعداد واحد</label>
              <input
                className="input tabular"
                value={withdraw.units}
                onChange={(e) => setWithdraw({ ...withdraw, units: e.target.value })}
              />
            </div>
          )}
          <div>
            <label className="label">تاریخ (شمسی)</label>
            <JalaliDateInput
              value={withdraw.effectiveDate}
              onChange={(iso) => setWithdraw({ ...withdraw, effectiveDate: iso })}
            />
          </div>
          <p className="text-xs text-slate-500">
            مبلغ نهایی هنگام تسویه و بر اساس NAV آن روز محاسبه می‌شود و ممکن است با برآورد اولیه متفاوت باشد.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!settleTarget}
        title="تأیید تسویه برداشت"
        message="با تسویه، واحدهای عضو ابطال و وجه از سبد کسر می‌شود. مبلغ نهایی بر اساس NAV امروز محاسبه خواهد شد."
        confirmLabel="تسویه شود"
        onConfirm={doSettle}
        onCancel={() => setSettleTarget(null)}
      />
      <ConfirmDialog
        open={!!cancelTarget}
        title="لغو درخواست برداشت"
        message="آیا از لغو این درخواست اطمینان دارید؟"
        confirmLabel="بله، لغو کن"
        danger
        onConfirm={doCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
