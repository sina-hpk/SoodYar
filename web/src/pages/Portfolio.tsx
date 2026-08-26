import { useEffect, useMemo, useState } from "react";
import { Plus, TrendingUp, TrendingDown, Tag } from "lucide-react";
import { api, type AssetValuation } from "../lib/api";
import { Card, PageHeader, Badge, Empty, RiskNotice } from "../components/ui";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/Modal";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, formatPercent, todayIso } from "../lib/format";
import { assetClassLabel, ASSET_CLASSES } from "../lib/labels";

/** Small colored P&L cell that shows amount + return percent. */
function PnlCell({
  amount,
  percent,
  currency,
}: {
  amount: string;
  percent: string | null;
  currency: "RIAL" | "TOMAN";
}) {
  const n = Number(amount);
  const tone = n > 0 ? "text-green-600" : n < 0 ? "text-red-600" : "text-slate-500";
  return (
    <div className={`tabular ${tone}`}>
      <div>{formatMoney(amount, currency)}</div>
      {percent != null && <div className="text-xs opacity-80">{formatPercent(percent)}</div>}
    </div>
  );
}

export default function Portfolio() {
  const { currency } = useSettings();
  const toast = useToast();
  const [assets, setAssets] = useState<AssetValuation[]>([]);
  const [filter, setFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState<null | { mode: "BUY" | "SELL"; asset: AssetValuation }>(null);
  const [confirmTrade, setConfirmTrade] = useState(false);

  const [newAsset, setNewAsset] = useState({ symbol: "", name: "", assetClass: "STOCK" });
  const [trade, setTrade] = useState({
    quantity: "",
    pricePerUnitRial: "",
    feeRial: "",
    effectiveDate: todayIso(),
  });

  async function load() {
    try {
      setAssets(await api.assets());
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  useEffect(() => {
    load();
  }, []);

  const active = useMemo(
    () => assets.filter((a) => !a.isClosed && (!filter || a.assetClass === filter)),
    [assets, filter]
  );
  const closed = useMemo(() => assets.filter((a) => a.isClosed), [assets]);

  async function createAsset() {
    if (!newAsset.symbol || !newAsset.name) {
      toast("نماد و نام الزامی است", "error");
      return;
    }
    try {
      await api.createAsset(newAsset);
      toast("دارایی ثبت شد", "success");
      setNewOpen(false);
      setNewAsset({ symbol: "", name: "", assetClass: "STOCK" });
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function submitTrade() {
    if (!tradeOpen) return;
    const body = {
      assetId: tradeOpen.asset.assetId,
      quantity: trade.quantity,
      pricePerUnitRial: Number(trade.pricePerUnitRial),
      feeRial: trade.feeRial ? Number(trade.feeRial) : 0,
      effectiveDate: trade.effectiveDate,
    };
    try {
      if (tradeOpen.mode === "BUY") await api.buy(body);
      else await api.sell(body);
      toast(tradeOpen.mode === "BUY" ? "خرید ثبت شد" : "فروش ثبت شد", "success");
      setConfirmTrade(false);
      setTradeOpen(null);
      setTrade({ quantity: "", pricePerUnitRial: "", feeRial: "", effectiveDate: todayIso() });
      load();
    } catch (e) {
      toast((e as Error).message, "error");
      setConfirmTrade(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="پرتفوی"
        subtitle="دارایی‌ها، خرید و فروش، سود/زیان و ارزش روز"
        action={
          <button className="btn-primary" onClick={() => setNewOpen(true)}>
            <Plus size={18} /> دارایی جدید
          </button>
        }
      />
      <RiskNotice />

      {/* Category filter */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">فیلتر دسته:</span>
          <button
            className={`badge ${filter === "" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}
            onClick={() => setFilter("")}
          >
            همه
          </button>
          {ASSET_CLASSES.filter((c) => c.value !== "CASH").map((c) => (
            <button
              key={c.value}
              className={`badge ${filter === c.value ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setFilter(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        {active.length === 0 ? (
          <Empty>دارایی فعالی در این دسته ثبت نشده است.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">نماد</th>
                  <th className="th">دسته</th>
                  <th className="th">مقدار</th>
                  <th className="th">میانگین خرید</th>
                  <th className="th">قیمت روز</th>
                  <th className="th">ارزش روز</th>
                  <th className="th">سود/زیان تحقق‌نیافته</th>
                  <th className="th">سود/زیان محقق‌شده</th>
                  <th className="th">سود/زیان کل</th>
                  <th className="th">درصد سبد</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.assetId} className="border-b border-slate-50">
                    <td className="td">
                      <div className="font-medium">{a.symbol}</div>
                      <div className="text-xs text-slate-400">{a.name}</div>
                    </td>
                    <td className="td">
                      <Badge tone="blue">{assetClassLabel(a.assetClass)}</Badge>
                    </td>
                    <td className="td tabular">{formatUnits(a.quantity, 8)}</td>
                    <td className="td tabular">{formatMoney(a.avgCostRial, currency)}</td>
                    <td className="td tabular">
                      {a.latestPriceRial ? formatMoney(a.latestPriceRial, currency) : "—"}
                    </td>
                    <td className="td tabular">{formatMoney(a.marketValueRial, currency)}</td>
                    <td className="td">
                      <PnlCell amount={a.unrealizedPnlRial} percent={a.unrealizedReturnPercent} currency={currency} />
                    </td>
                    <td className="td tabular">{formatMoney(a.realizedPnlRial, currency)}</td>
                    <td className="td">
                      <PnlCell amount={a.totalPnlRial} percent={a.totalReturnPercent} currency={currency} />
                    </td>
                    <td className="td tabular">{formatPercent(a.weightPercent)}</td>
                    <td className="td">
                      <div className="flex gap-1">
                        <button
                          className="rounded-md bg-green-50 p-1.5 text-green-600 hover:bg-green-100"
                          title="خرید"
                          onClick={() => setTradeOpen({ mode: "BUY", asset: a })}
                        >
                          <TrendingUp size={16} />
                        </button>
                        <button
                          className="rounded-md bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                          title="فروش"
                          onClick={() => setTradeOpen({ mode: "SELL", asset: a })}
                        >
                          <TrendingDown size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Closed positions — realized P&L preserved even at qty 0 */}
      {closed.length > 0 && (
        <Card>
          <h3 className="mb-4 font-semibold text-slate-700">موقعیت‌های بسته‌شده</h3>
          <p className="mb-3 text-xs text-slate-500">
            دارایی‌هایی که موجودی آن‌ها صفر شده اما سود/زیان محقق‌شده آن‌ها همچنان در سوابق نگهداری می‌شود.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">نماد</th>
                  <th className="th">دسته</th>
                  <th className="th">سود/زیان محقق‌شده</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {closed.map((a) => {
                  const n = Number(a.realizedPnlRial);
                  return (
                    <tr key={a.assetId} className="border-b border-slate-50">
                      <td className="td">
                        <div className="font-medium">{a.symbol}</div>
                        <div className="text-xs text-slate-400">{a.name}</div>
                      </td>
                      <td className="td">
                        <Badge tone="slate">{assetClassLabel(a.assetClass)}</Badge>
                      </td>
                      <td className={`td tabular ${n >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatMoney(a.realizedPnlRial, currency)}
                      </td>
                      <td className="td">
                        <button
                          className="rounded-md bg-green-50 p-1.5 text-green-600 hover:bg-green-100"
                          title="خرید مجدد"
                          onClick={() => setTradeOpen({ mode: "BUY", asset: a })}
                        >
                          <TrendingUp size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* New asset modal */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="دارایی جدید"
        footer={
          <>
            <button className="btn-primary" onClick={createAsset}>
              ذخیره
            </button>
            <button className="btn-secondary" onClick={() => setNewOpen(false)}>
              انصراف
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">نماد *</label>
            <input
              className="input"
              value={newAsset.symbol}
              onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value })}
            />
          </div>
          <div>
            <label className="label">نام *</label>
            <input
              className="input"
              value={newAsset.name}
              onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">دسته</label>
            <select
              className="input"
              value={newAsset.assetClass}
              onChange={(e) => setNewAsset({ ...newAsset, assetClass: e.target.value })}
            >
              {ASSET_CLASSES.filter((c) => c.value !== "CASH").map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Trade modal */}
      <Modal
        open={!!tradeOpen}
        onClose={() => setTradeOpen(null)}
        title={`${tradeOpen?.mode === "BUY" ? "خرید" : "فروش"} ${tradeOpen?.asset.symbol ?? ""}`}
        footer={
          <>
            <button
              className={tradeOpen?.mode === "BUY" ? "btn-primary" : "btn-danger"}
              onClick={() => setConfirmTrade(true)}
            >
              ثبت {tradeOpen?.mode === "BUY" ? "خرید" : "فروش"}
            </button>
            <button className="btn-secondary" onClick={() => setTradeOpen(null)}>
              انصراف
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">مقدار</label>
            <input
              className="input tabular"
              value={trade.quantity}
              onChange={(e) => setTrade({ ...trade, quantity: e.target.value })}
            />
          </div>
          <div>
            <label className="label">قیمت هر واحد (ریال)</label>
            <input
              className="input tabular"
              value={trade.pricePerUnitRial}
              onChange={(e) => setTrade({ ...trade, pricePerUnitRial: e.target.value })}
            />
          </div>
          <div>
            <label className="label">کارمزد (ریال)</label>
            <input
              className="input tabular"
              value={trade.feeRial}
              onChange={(e) => setTrade({ ...trade, feeRial: e.target.value })}
            />
          </div>
          <div>
            <label className="label">تاریخ (شمسی)</label>
            <JalaliDateInput
              value={trade.effectiveDate}
              onChange={(iso) => setTrade({ ...trade, effectiveDate: iso })}
            />
          </div>
        </div>
        {tradeOpen?.mode === "BUY" ? (
          <p className="mt-3 text-xs text-slate-500">
            کارمزد خرید به بهای تمام‌شده افزوده می‌شود و در میانگین موزون خرید لحاظ می‌گردد.
          </p>
        ) : (
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
            <Tag size={14} /> موجودی فعلی: {formatUnits(tradeOpen?.asset.quantity ?? "0", 8)} — فروش بیش از موجودی مجاز نیست.
          </p>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmTrade}
        title="تأیید تراکنش"
        danger={tradeOpen?.mode === "SELL"}
        message={`آیا از ثبت ${tradeOpen?.mode === "BUY" ? "خرید" : "فروش"} ${trade.quantity} واحد ${tradeOpen?.asset.symbol} اطمینان دارید؟ این عملیات موجودی نقد سبد را تغییر می‌دهد.`}
        confirmLabel="بله، ثبت شود"
        onConfirm={submitTrade}
        onCancel={() => setConfirmTrade(false)}
      />
    </div>
  );
}
