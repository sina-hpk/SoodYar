import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  Tag,
  Radio,
  Trash2,
  Coins,
  Calculator,
} from "lucide-react";
import { api, type AssetValuation, type MarketQuote } from "../lib/api";
import { Card, PageHeader, Badge, Empty, RiskNotice } from "../components/ui";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/Modal";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, formatPercent, todayIso } from "../lib/format";
import { assetClassLabel, ASSET_CLASSES } from "../lib/labels";

/**
 * Asset classes that are normally held as a single lot: a car, an apartment, a
 * share in a private business, or money parked in a fixed-income fund. They have
 * no meaningful "price per unit", so the trade modal defaults to entering one
 * total amount and stores it as a single lot (quantity 1 × the whole amount).
 */
const LUMP_CLASSES = new Set([
  "VEHICLE",
  "REAL_ESTATE",
  "FIXED_INCOME",
  "PRIVATE_EQUITY",
  "COLLECTIBLE",
  "BOND",
  "OTHER",
]);

type TradeMode = "UNIT" | "TOTAL";

/** Parses a possibly-Persian numeric string to a number; NaN when unusable. */
function num(v: string): number {
  const latin = String(v ?? "")
    .replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)])
    .replace(/[،,\s]/g, "")
    .trim();
  if (!latin) return NaN;
  return Number(latin);
}

/** Normalizes a symbol/name for fuzzy matching against a market quote. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u200c\s\-_]/g, "")
    .replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)]);
}

/** Best-effort match of an asset to a live market quote by symbol/name. */
function matchQuote(asset: AssetValuation, quotes: MarketQuote[]): MarketQuote | null {
  const sym = norm(asset.symbol);
  const nm = norm(asset.name);
  for (const q of quotes) {
    const qsym = norm(q.symbol);
    const qname = norm(q.name);
    if (sym && (sym === qsym || sym.includes(qsym) || qsym.includes(sym))) return q;
    if (nm && (nm === qname || nm.includes(qname) || qname.includes(nm))) return q;
  }
  return null;
}

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
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [priceOpen, setPriceOpen] = useState<null | { asset: AssetValuation; quote: MarketQuote }>(null);
  const [applyingPrice, setApplyingPrice] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AssetValuation | null>(null);
  const [valueOpen, setValueOpen] = useState<AssetValuation | null>(null);
  const [cashOpen, setCashOpen] = useState<null | { asset: AssetValuation | null }>(null);
  const [busy, setBusy] = useState(false);

  const [newAsset, setNewAsset] = useState({ symbol: "", name: "", assetClass: "STOCK" });
  const [tradeMode, setTradeMode] = useState<TradeMode>("UNIT");
  const [trade, setTrade] = useState({
    quantity: "",
    pricePerUnitRial: "",
    totalRial: "",
    feeRial: "",
    effectiveDate: todayIso(),
  });
  const [valueForm, setValueForm] = useState({ totalRial: "", priceDate: todayIso(), note: "" });
  const [cashForm, setCashForm] = useState({
    type: "DIVIDEND" as "DIVIDEND" | "FEE" | "CASH_ADJUSTMENT",
    amountRial: "",
    effectiveDate: todayIso(),
    description: "",
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
    // Live quotes are best-effort; failure just hides the "live price" action.
    api.marketQuotes().then((m) => setQuotes(m.quotes)).catch(() => {});
  }, []);

  async function applyLivePrice() {
    if (!priceOpen) return;
    const { asset, quote } = priceOpen;
    if (!quote.priceRial) {
      toast("قیمت ریالی برای این مورد در دسترس نیست", "error");
      return;
    }
    setApplyingPrice(true);
    try {
      await api.recordPrice({
        assetId: asset.assetId,
        priceRial: Number(quote.priceRial),
        priceDate: todayIso(),
        source: "API",
        sourceRef: `${quote.source}:${quote.key}`,
        note: `قیمت زندهٔ ${quote.name} (${quote.unit})`,
      });
      toast(`قیمت روز ${asset.symbol} از بازار ثبت شد`, "success");
      setPriceOpen(null);
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setApplyingPrice(false);
    }
  }

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
    const asset = tradeOpen.asset;
    const fee = trade.feeRial ? num(trade.feeRial) : 0;
    let quantity = trade.quantity;
    let pricePerUnitRial = num(trade.pricePerUnitRial);

    if (tradeMode === "TOTAL") {
      const total = num(trade.totalRial);
      if (!Number.isFinite(total) || total <= 0) {
        toast("مبلغ کل را وارد کنید", "error");
        setConfirmTrade(false);
        return;
      }
      if (tradeOpen.mode === "BUY") {
        // One lot: quantity 1 whose "unit price" is the whole amount. The lot
        // count stays meaningful when more money goes into the same asset later,
        // and the value modal always divides the new total value by the lot count.
        quantity = "1";
        pricePerUnitRial = Math.round(total);
      } else {
        // Total mode on a sale means exiting the position completely.
        const held = num(asset.quantity);
        if (!Number.isFinite(held) || held <= 0) {
          toast("این دارایی موجودی ندارد", "error");
          setConfirmTrade(false);
          return;
        }
        quantity = asset.quantity;
        pricePerUnitRial = Math.round(total / held);
      }
    } else if (!Number.isFinite(pricePerUnitRial) || !num(trade.quantity)) {
      toast("مقدار و قیمت هر واحد را وارد کنید", "error");
      setConfirmTrade(false);
      return;
    }

    const body = {
      assetId: asset.assetId,
      quantity,
      pricePerUnitRial,
      feeRial: Number.isFinite(fee) ? fee : 0,
      effectiveDate: trade.effectiveDate,
    };
    try {
      if (tradeOpen.mode === "BUY") await api.buy(body);
      else await api.sell(body);
      toast(tradeOpen.mode === "BUY" ? "خرید ثبت شد" : "فروش ثبت شد", "success");
      setConfirmTrade(false);
      setTradeOpen(null);
      resetTrade();
      load();
    } catch (e) {
      toast((e as Error).message, "error");
      setConfirmTrade(false);
    }
  }

  function resetTrade() {
    setTrade({
      quantity: "",
      pricePerUnitRial: "",
      totalRial: "",
      feeRial: "",
      effectiveDate: todayIso(),
    });
  }

  /**
   * Opens the trade modal, defaulting to lump-sum entry for assets that have no
   * meaningful per-unit price (a car, an apartment, a fixed-income fund).
   */
  function openTrade(mode: "BUY" | "SELL", asset: AssetValuation) {
    resetTrade();
    setTradeMode(LUMP_CLASSES.has(asset.assetClass) ? "TOTAL" : "UNIT");
    setTradeOpen({ mode, asset });
  }

  async function deleteAsset() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteAsset(deleteTarget.assetId);
      toast(`دارایی ${deleteTarget.symbol} حذف شد`, "success");
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records a new total value for a holding. The user thinks in whole amounts
   * ("the car is worth 900 million now"), while a PriceSnapshot is per unit, so
   * the entered total is divided by the quantity held.
   */
  async function submitValue() {
    if (!valueOpen) return;
    const total = num(valueForm.totalRial);
    const qty = num(valueOpen.quantity);
    if (!Number.isFinite(total) || total < 0) {
      toast("ارزش کل را وارد کنید", "error");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast("این دارایی موجودی ندارد", "error");
      return;
    }
    setBusy(true);
    try {
      await api.recordPrice({
        assetId: valueOpen.assetId,
        priceRial: Math.round(total / qty),
        priceDate: valueForm.priceDate,
        source: "MANUAL",
        note: valueForm.note || undefined,
      });
      toast(`ارزش روز ${valueOpen.symbol} ثبت شد`, "success");
      setValueOpen(null);
      setValueForm({ totalRial: "", priceDate: todayIso(), note: "" });
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Money that enters or leaves the fund without any unit being issued or
   * redeemed: a fixed-income fund's monthly profit, a dividend, a bank fee, or a
   * correction. It raises (or lowers) navPerUnit for everyone.
   */
  async function submitCashOp() {
    if (!cashOpen) return;
    const amount = num(cashForm.amountRial);
    if (!Number.isFinite(amount) || amount === 0) {
      toast("مبلغ را وارد کنید", "error");
      return;
    }
    setBusy(true);
    try {
      await api.cashOp({
        type: cashForm.type,
        amountRial: Math.round(amount),
        assetId: cashOpen.asset?.assetId,
        effectiveDate: cashForm.effectiveDate,
        description: cashForm.description || undefined,
      });
      toast("تراکنش نقدی ثبت شد", "success");
      setCashOpen(null);
      setCashForm({
        type: "DIVIDEND",
        amountRial: "",
        effectiveDate: todayIso(),
        description: "",
      });
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="پرتفوی"
        subtitle="دارایی‌ها، خرید و فروش، سود/زیان و ارزش روز"
        action={
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                setCashForm({
                  type: "DIVIDEND",
                  amountRial: "",
                  effectiveDate: todayIso(),
                  description: "",
                });
                setCashOpen({ asset: null });
              }}
            >
              <Coins size={18} /> سود / هزینه
            </button>
            <button className="btn-primary" onClick={() => setNewOpen(true)}>
              <Plus size={18} /> دارایی جدید
            </button>
          </div>
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
                      {a.latestPriceRial ? (
                        formatMoney(a.latestPriceRial, currency)
                      ) : (
                        <span className="text-amber-600" title="هنوز قیمت روز ثبت نشده؛ به بهای خرید ارزش‌گذاری شده است.">
                          ثبت‌نشده
                        </span>
                      )}
                    </td>
                    <td className="td tabular">
                      {formatMoney(a.marketValueRial, currency)}
                      {a.valuedAtCost && (
                        <div className="text-[10px] text-amber-600">به بهای خرید</div>
                      )}
                    </td>
                    <td className="td">
                      {a.valuedAtCost ? (
                        <span className="text-xs text-slate-400" title="تا زمانی که قیمت روز ثبت نشود، سود/زیان تحقق‌نیافته صفر در نظر گرفته می‌شود.">
                          —
                        </span>
                      ) : (
                        <PnlCell amount={a.unrealizedPnlRial} percent={a.unrealizedReturnPercent} currency={currency} />
                      )}
                    </td>
                    <td className="td tabular">{formatMoney(a.realizedPnlRial, currency)}</td>
                    <td className="td">
                      <PnlCell amount={a.totalPnlRial} percent={a.totalReturnPercent} currency={currency} />
                    </td>
                    <td className="td tabular">{formatPercent(a.weightPercent)}</td>
                    <td className="td">
                      <div className="flex gap-1">
                        {(() => {
                          const q = matchQuote(a, quotes);
                          if (!q || !q.priceRial) return null;
                          return (
                            <button
                              className="rounded-md bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100"
                              title={`ثبت قیمت زنده از بازار (${q.name})`}
                              onClick={() => setPriceOpen({ asset: a, quote: q })}
                            >
                              <Radio size={16} />
                            </button>
                          );
                        })()}
                        <button
                          className="rounded-md bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200"
                          title="به‌روزرسانی ارزش روز (دستی)"
                          onClick={() => {
                            setValueForm({
                              totalRial: a.marketValueRial,
                              priceDate: todayIso(),
                              note: "",
                            });
                            setValueOpen(a);
                          }}
                        >
                          <Calculator size={16} />
                        </button>
                        <button
                          className="rounded-md bg-amber-50 p-1.5 text-amber-600 hover:bg-amber-100"
                          title="ثبت سود دریافتی یا هزینه"
                          onClick={() => {
                            setCashForm({
                              type: "DIVIDEND",
                              amountRial: "",
                              effectiveDate: todayIso(),
                              description: `سود ${a.name}`,
                            });
                            setCashOpen({ asset: a });
                          }}
                        >
                          <Coins size={16} />
                        </button>
                        <button
                          className="rounded-md bg-green-50 p-1.5 text-green-600 hover:bg-green-100"
                          title="خرید"
                          onClick={() => openTrade("BUY", a)}
                        >
                          <TrendingUp size={16} />
                        </button>
                        <button
                          className="rounded-md bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                          title="فروش"
                          onClick={() => openTrade("SELL", a)}
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
            دارایی‌ای که اشتباهی ساخته شده و هیچ خرید یا فروشی برای آن ثبت نشده است را می‌توانید حذف کنید؛
            اگر تراکنشی داشته باشد، برای حفظ صحت محاسبات NAV حذف نمی‌شود.
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
                        <div className="flex gap-1">
                          <button
                            className="rounded-md bg-green-50 p-1.5 text-green-600 hover:bg-green-100"
                            title="خرید مجدد"
                            onClick={() => openTrade("BUY", a)}
                          >
                            <TrendingUp size={16} />
                          </button>
                          <button
                            className="rounded-md bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                            title="حذف دارایی"
                            onClick={() => setDeleteTarget(a)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
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
        {LUMP_CLASSES.has(newAsset.assetClass) ? (
          <p className="mt-3 rounded-lg border-r-4 border-brand-300 bg-brand-50/60 px-3 py-2 text-xs leading-6 text-brand-800">
            این دسته «تک‌قلم» است: خودرو، ملک، صندوق درآمد ثابت و مشابه آن‌ها قیمت هر واحد ندارند.
            در گام بعد هنگام ثبت خرید، حالت «مبلغ کل» به‌صورت خودکار انتخاب می‌شود و فقط کافی است
            کل مبلغی که پرداخت کرده‌اید را وارد کنید. سود ماهانهٔ صندوق را هم بعداً با دکمهٔ
            «سود / هزینه» ثبت می‌کنید.
          </p>
        ) : (
          <p className="mt-3 text-xs leading-6 text-slate-500">
            ابتدا دارایی را می‌سازید و سپس با دکمهٔ خرید، مقدار و قیمت هر واحد را ثبت می‌کنید.
          </p>
        )}
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
        <div className="mb-4">
          <label className="label">نحوهٔ ثبت</label>
          <div className="flex flex-wrap gap-2">
            <button
              className={`badge px-3 py-1.5 ${
                tradeMode === "UNIT" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"
              }`}
              onClick={() => setTradeMode("UNIT")}
            >
              مقدار × قیمت هر واحد
            </button>
            <button
              className={`badge px-3 py-1.5 ${
                tradeMode === "TOTAL" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"
              }`}
              onClick={() => setTradeMode("TOTAL")}
            >
              مبلغ کل (یک‌جا)
            </button>
          </div>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {tradeMode === "UNIT"
              ? "برای سهم، صندوق سهامی، طلا، ارز و رمزارز که «هر واحد» قیمت مشخصی دارد."
              : "برای خودرو، ملک، صندوق درآمد ثابت و هر چیزی که قیمت هر واحد ندارد؛ فقط مبلغ کل را وارد کنید."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tradeMode === "UNIT" ? (
            <>
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
            </>
          ) : (
            <div className="sm:col-span-2">
              <label className="label">
                {tradeOpen?.mode === "BUY" ? "مبلغ کل پرداختی (ریال)" : "مبلغ کل دریافتی (ریال)"}
              </label>
              <input
                className="input tabular"
                placeholder="مثلاً ۵۰۰۰۰۰۰۰۰"
                value={trade.totalRial}
                onChange={(e) => setTrade({ ...trade, totalRial: e.target.value })}
              />
              {!!num(trade.totalRial) && (
                <p className="mt-1 text-xs text-slate-500">
                  {formatMoney(String(Math.round(num(trade.totalRial))), currency)}
                </p>
              )}
            </div>
          )}
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
        {tradeMode === "TOTAL" && (
          <p className="mt-3 rounded-lg border-r-4 border-brand-300 bg-brand-50/60 px-3 py-2 text-xs leading-6 text-brand-800">
            {tradeOpen?.mode === "BUY"
              ? "این مبلغ به‌صورت «یک قلم» ثبت می‌شود (مقدار ۱ به بهای همان مبلغ). بعداً با دکمهٔ ماشین‌حساب می‌توانید ارزش روز آن را به‌روز کنید و برای صندوق درآمد ثابت، سود ماهانه را با دکمهٔ «سود / هزینه» وارد کنید."
              : "کل موجودی این دارایی به این مبلغ فروخته می‌شود و موقعیت بسته خواهد شد."}
          </p>
        )}
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
        message={
          tradeMode === "TOTAL"
            ? `آیا از ثبت ${tradeOpen?.mode === "BUY" ? "خرید" : "فروش"} ${tradeOpen?.asset.symbol} به مبلغ کل ${formatMoney(String(Math.round(num(trade.totalRial) || 0)), currency)} اطمینان دارید؟ این عملیات موجودی نقد سبد را تغییر می‌دهد.`
            : `آیا از ثبت ${tradeOpen?.mode === "BUY" ? "خرید" : "فروش"} ${trade.quantity} واحد ${tradeOpen?.asset.symbol} اطمینان دارید؟ این عملیات موجودی نقد سبد را تغییر می‌دهد.`
        }
        confirmLabel="بله، ثبت شود"
        onConfirm={submitTrade}
        onCancel={() => setConfirmTrade(false)}
      />

      {/* Live market price modal */}
      <Modal
        open={!!priceOpen}
        onClose={() => setPriceOpen(null)}
        title={`ثبت قیمت زنده — ${priceOpen?.asset.symbol ?? ""}`}
        footer={
          <>
            <button className="btn-primary" onClick={applyLivePrice} disabled={applyingPrice}>
              {applyingPrice ? "در حال ثبت…" : "ثبت به‌عنوان قیمت امروز"}
            </button>
            <button className="btn-secondary" onClick={() => setPriceOpen(null)}>
              انصراف
            </button>
          </>
        }
      >
        {priceOpen && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-500">مورد بازار متناظر</span>
              <span className="font-medium text-slate-700">
                {priceOpen.quote.name} <span className="text-xs text-slate-400">({priceOpen.quote.unit})</span>
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-500">قیمت زنده</span>
              <span className="tabular font-semibold text-brand-700">
                {priceOpen.quote.priceRial ? formatMoney(priceOpen.quote.priceRial, currency) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-500">منبع</span>
              <span className="text-slate-600">{priceOpen.quote.source}</span>
            </div>
            <p className="leading-6 text-slate-500">
              این قیمت به‌عنوان «قیمت روز» دارایی برای تاریخ امروز ثبت می‌شود (منبع: API) و
              در محاسبهٔ ارزش روز و سود/زیان به‌کار می‌رود. اگر قیمت واحد دارایی شما با واحد
              بازار متفاوت است (مثلاً هر گرم در برابر هر مثقال)، پیش از ثبت از تطابق واحدها مطمئن شوید.
            </p>
          </div>
        )}
      </Modal>

      {/* Manual value update — the user enters a whole value, not a per-unit price */}
      <Modal
        open={!!valueOpen}
        onClose={() => setValueOpen(null)}
        title={`به‌روزرسانی ارزش روز — ${valueOpen?.symbol ?? ""}`}
        footer={
          <>
            <button className="btn-primary" onClick={submitValue} disabled={busy}>
              {busy ? "در حال ثبت…" : "ثبت ارزش روز"}
            </button>
            <button className="btn-secondary" onClick={() => setValueOpen(null)}>
              انصراف
            </button>
          </>
        }
      >
        {valueOpen && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">ارزش ثبت‌شدهٔ فعلی</span>
              <span className="tabular font-semibold text-slate-700">
                {formatMoney(valueOpen.marketValueRial, currency)}
              </span>
            </div>
            <div>
              <label className="label">ارزش کل امروز (ریال) *</label>
              <input
                className="input tabular"
                value={valueForm.totalRial}
                onChange={(e) => setValueForm({ ...valueForm, totalRial: e.target.value })}
              />
              {!!num(valueForm.totalRial) && (
                <p className="mt-1 text-xs text-slate-500">
                  {formatMoney(String(Math.round(num(valueForm.totalRial))), currency)}
                </p>
              )}
            </div>
            <div>
              <label className="label">تاریخ (شمسی)</label>
              <JalaliDateInput
                value={valueForm.priceDate}
                onChange={(iso) => setValueForm({ ...valueForm, priceDate: iso })}
              />
            </div>
            <div>
              <label className="label">توضیح</label>
              <input
                className="input"
                placeholder="مثلاً موجودی صندوق در آخر ماه / قیمت کارشناسی خودرو"
                value={valueForm.note}
                onChange={(e) => setValueForm({ ...valueForm, note: e.target.value })}
              />
            </div>
            <p className="leading-6 text-xs text-slate-500">
              همان مبلغی را وارد کنید که امروز ارزش کل این دارایی است؛ برنامه خودش آن را بر
              مقدار موجود ({formatUnits(valueOpen.quantity, 8)}) تقسیم و به‌عنوان «قیمت هر واحد»
              ذخیره می‌کند. این کار سود/زیان تحقق‌نیافته را به‌روز می‌کند و هیچ واحدی صادر یا
              ابطال نمی‌شود.
            </p>
          </div>
        )}
      </Modal>

      {/* Cash-only operations: monthly profit of a fixed-income fund, a fee, a correction */}
      <Modal
        open={!!cashOpen}
        onClose={() => setCashOpen(null)}
        title={
          cashOpen?.asset
            ? `سود / هزینه — ${cashOpen.asset.symbol}`
            : "ثبت سود دریافتی یا هزینه"
        }
        footer={
          <>
            <button className="btn-primary" onClick={submitCashOp} disabled={busy}>
              {busy ? "در حال ثبت…" : "ثبت"}
            </button>
            <button className="btn-secondary" onClick={() => setCashOpen(null)}>
              انصراف
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">نوع</label>
            <select
              className="input"
              value={cashForm.type}
              onChange={(e) =>
                setCashForm({ ...cashForm, type: e.target.value as typeof cashForm.type })
              }
            >
              <option value="DIVIDEND">سود دریافتی (سود صندوق، سود سهام، اجاره)</option>
              <option value="FEE">هزینه / کارمزد</option>
              <option value="CASH_ADJUSTMENT">تعدیل نقدی (اصلاح اشتباه)</option>
            </select>
          </div>
          <div>
            <label className="label">
              {cashForm.type === "CASH_ADJUSTMENT" ? "مبلغ با علامت (ریال) *" : "مبلغ (ریال) *"}
            </label>
            <input
              className="input tabular"
              value={cashForm.amountRial}
              onChange={(e) => setCashForm({ ...cashForm, amountRial: e.target.value })}
            />
            {!!num(cashForm.amountRial) && (
              <p className="mt-1 text-xs text-slate-500">
                {formatMoney(String(Math.round(num(cashForm.amountRial))), currency)}
              </p>
            )}
          </div>
          <div>
            <label className="label">تاریخ (شمسی)</label>
            <JalaliDateInput
              value={cashForm.effectiveDate}
              onChange={(iso) => setCashForm({ ...cashForm, effectiveDate: iso })}
            />
          </div>
          <div>
            <label className="label">توضیح</label>
            <input
              className="input"
              placeholder="مثلاً سود مرداد صندوق درآمد ثابت"
              value={cashForm.description}
              onChange={(e) => setCashForm({ ...cashForm, description: e.target.value })}
            />
          </div>
          {cashOpen?.asset && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">دارایی مرتبط</span>
              <span className="font-medium text-slate-700">
                {cashOpen.asset.symbol} — {cashOpen.asset.name}
              </span>
            </div>
          )}
          <p className="rounded-lg border-r-4 border-amber-300 bg-amber-50/70 px-3 py-2 text-xs leading-6 text-amber-900">
            {cashForm.type === "DIVIDEND"
              ? "این پول به نقد صندوق اضافه می‌شود ولی هیچ واحدی صادر نمی‌شود؛ پس NAV هر واحد بالا می‌رود و سود آن به نسبت واحدها بین همهٔ اعضا تقسیم می‌گردد. سود ماهانهٔ صندوق درآمد ثابت را همین‌جا ثبت کنید."
              : cashForm.type === "FEE"
                ? "این مبلغ از نقد صندوق کم می‌شود و NAV هر واحد را پایین می‌آورد؛ بدون ابطال واحد."
                : "برای اصلاح اشتباه‌های نقدی است. عدد مثبت به نقد اضافه و عدد منفی از نقد کم می‌کند. تراکنش‌های تأییدشده حذف نمی‌شوند و اصلاح همیشه با یک تعدیل جدید انجام می‌شود."}
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="حذف دارایی"
        danger
        message={
          <span className="leading-7">
            دارایی «{deleteTarget?.symbol} — {deleteTarget?.name}» برای همیشه حذف می‌شود.
            این کار فقط زمانی انجام می‌شود که هیچ خرید یا فروشی برای آن ثبت نشده باشد؛
            در غیر این صورت برای حفظ صحت محاسبات NAV پیام خطا می‌گیرید و می‌توانید به‌جای
            حذف، آن را غیرفعال کنید.
          </span>
        }
        confirmLabel={busy ? "در حال حذف…" : "بله، حذف کن"}
        onConfirm={deleteAsset}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
