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
  RefreshCw,
} from "lucide-react";
import {
  api,
  type AssetValuation,
  type MarketQuote,
  type PricePlanRow,
} from "../lib/api";
import { Card, PageHeader, Badge, Empty, RiskNotice } from "../components/ui";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/Modal";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import {
  formatMoney,
  formatUnits,
  formatPercent,
  todayIso,
  toPersianDigits,
} from "../lib/format";
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

/**
 * UNIT   — quantity × price per unit, for anything with a real market price.
 * TOTAL  — one whole amount. On a buy it becomes a single lot; on a sale it
 *          closes the position completely.
 * WITHDRAW — takes money out of a lump-sum holding without closing it, by selling
 *          the fraction of a lot that carries the requested amount at its own
 *          average cost. Only offered for lump-sum classes on a sale.
 */
type TradeMode = "UNIT" | "TOTAL" | "WITHDRAW";

/** Quantity decimals the API accepts (Decimal(8) in the schema). */
const QTY_DP = 8;

/**
 * The fraction of a lump-sum holding that carries `amountRial` at the holding's
 * average cost. Truncated rather than rounded so a withdrawal never asks for more
 * than the position holds.
 */
function withdrawQuantity(amountRial: number, avgCostRial: number): number {
  if (!Number.isFinite(amountRial) || !Number.isFinite(avgCostRial) || avgCostRial <= 0) {
    return NaN;
  }
  const factor = 10 ** QTY_DP;
  return Math.floor((amountRial / avgCostRial) * factor) / factor;
}

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

/**
 * Allows containment matching for descriptive names, but never between two
 * ticker-like ASCII symbols. In particular, USD and USDT may only match
 * exactly; a ticker prefix is not evidence that they represent the same asset.
 */
function isSafeFuzzyMatch(left: string, right: string): boolean {
  if (left.length < 3 || right.length < 3) return false;
  const contained = left.includes(right) || right.includes(left);
  if (!contained) return false;

  // Preserve existing containment matching for other assets, but do not treat a
  // USD-prefixed ticker (USDT, USDC, ...) as the USD cash benchmark.
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter === "usd" && /^usd[a-z0-9]+$/.test(longer)) return false;
  return true;
}

/** Best-effort match of an asset to a live market quote by symbol/name. */
function matchQuote(asset: AssetValuation, quotes: MarketQuote[]): MarketQuote | null {
  const sym = norm(asset.symbol);
  const nm = norm(asset.name);
  const normalized = quotes.map((quote) => ({
    quote,
    symbol: norm(quote.symbol),
    name: norm(quote.name),
  }));

  // Search every quote for an exact identity before considering any fuzzy hit.
  const exact = normalized.find(
    (candidate) =>
      (sym && sym === candidate.symbol) ||
      (nm && nm === candidate.name)
  );
  if (exact) return exact.quote;

  const fuzzy = normalized.find(
    (candidate) =>
      (sym && isSafeFuzzyMatch(sym, candidate.symbol)) ||
      (nm && isSafeFuzzyMatch(nm, candidate.name))
  );
  return fuzzy?.quote ?? null;
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

/**
 * Persian labels for the auto-pricing state. The server reports stable codes;
 * the review table must not show them to the user verbatim.
 */
const PRICE_STATUS_LABELS: Record<string, string> = {
  PINNED: "کلید دستی",
  EXACT: "تطبیق دقیق",
  ALIAS: "نرخ داخلی",
  FUZZY: "تطبیق تقریبی",
  UPDATED: "ثبت شد",
  DRY_RUN: "آمادهٔ ثبت",
  SKIPPED_MANUAL: "قیمت دستی امروز",
  SKIPPED_NO_POSITION: "بدون موجودی",
  NO_PRICE: "بدون قیمت",
  UNMATCHED: "بدون نرخ زنده",
};

function priceStatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return PRICE_STATUS_LABELS[value] ?? value;
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
  const [autoPlanOpen, setAutoPlanOpen] = useState(false);
  const [autoPlan, setAutoPlan] = useState<PricePlanRow[]>([]);
  const [autoBusy, setAutoBusy] = useState(false);

  const [newAsset, setNewAsset] = useState({ symbol: "", name: "", assetClass: "STOCK" });
  const [tradeMode, setTradeMode] = useState<TradeMode>("UNIT");
  const [cashRial, setCashRial] = useState<number | null>(null);
  const [trade, setTrade] = useState({
    quantity: "",
    pricePerUnitRial: "",
    totalRial: "",
    withdrawRial: "",
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
    // Cash balance only powers a warning, so a failure must not block the page.
    try {
      setCashRial(Number((await api.dashboard()).cashBalanceRial));
    } catch {
      setCashRial(null);
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

    if (tradeMode === "WITHDRAW") {
      const amount = num(trade.withdrawRial);
      const avg = num(asset.avgCostRial);
      const held = num(asset.quantity);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast("مبلغ برداشت را وارد کنید", "error");
        setConfirmTrade(false);
        return;
      }
      if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(held) || held <= 0) {
        toast("این دارایی بهای تمام‌شده یا موجودی ندارد", "error");
        setConfirmTrade(false);
        return;
      }
      const q = withdrawQuantity(amount, avg);
      if (!Number.isFinite(q) || q <= 0) {
        toast("مبلغ برداشت از دقت قابل ثبت کمتر است", "error");
        setConfirmTrade(false);
        return;
      }
      if (q > held) {
        toast("مبلغ برداشت از ارزش دفتری این دارایی بیشتر است", "error");
        setConfirmTrade(false);
        return;
      }
      // Selling at the average cost is what keeps a book-value withdrawal from
      // inventing a gain or a loss.
      quantity = q.toFixed(QTY_DP);
      pricePerUnitRial = Math.round(avg);
    } else if (tradeMode === "TOTAL") {
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
      withdrawRial: "",
      feeRial: "",
      effectiveDate: todayIso(),
    });
  }

  /**
   * Opens the trade modal. Lump-sum holdings have no meaningful per-unit price, so
   * they default to whole-amount entry — and on a sale to «برداشت مبلغ», because
   * taking part of the money out is the common case and closing the position
   * outright is the rare one.
   */
  function openTrade(mode: "BUY" | "SELL", asset: AssetValuation) {
    resetTrade();
    const lump = LUMP_CLASSES.has(asset.assetClass);
    setTradeMode(lump ? (mode === "SELL" ? "WITHDRAW" : "TOTAL") : "UNIT");
    setTradeOpen({ mode, asset });
  }

  /**
   * Shows which live quote each holding maps to before writing anything, so an
   * unreachable source or a missing match is visible instead of a silent no-op.
   */
  async function openAutoPlan() {
    setAutoBusy(true);
    try {
      setAutoPlan(await api.priceAutoPlan());
      setAutoPlanOpen(true);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setAutoBusy(false);
    }
  }

  async function refreshPricesFromMarket() {
    setAutoBusy(true);
    try {
      const summary = await api.priceAutoRefresh({});
      toast(
        `${toPersianDigits(summary.updated)} قیمت به‌روز شد، ${toPersianDigits(
          summary.skipped
        )} مورد دست‌نخورده ماند`,
        summary.updated > 0 ? "success" : "error"
      );
      setAutoPlan(await api.priceAutoPlan());
      await load();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setAutoBusy(false);
    }
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

  /**
   * What the pending trade would actually do, recomputed as the user types. It
   * mirrors the server's arithmetic closely enough to preview the cash movement and
   * the realized P&L, so the confirmation step can name the consequence instead of
   * only repeating the numbers that were typed.
   */
  const preview = useMemo(() => {
    if (!tradeOpen) return null;
    const asset = tradeOpen.asset;
    const fee = num(trade.feeRial) || 0;
    const avg = num(asset.avgCostRial);
    const held = num(asset.quantity);

    let qty = NaN;
    let price = NaN;
    if (tradeMode === "WITHDRAW") {
      qty = withdrawQuantity(num(trade.withdrawRial), avg);
      price = avg;
    } else if (tradeMode === "TOTAL") {
      const total = num(trade.totalRial);
      if (tradeOpen.mode === "BUY") {
        qty = 1;
        price = total;
      } else {
        qty = held;
        price = held > 0 ? total / held : NaN;
      }
    } else {
      qty = num(trade.quantity);
      price = num(trade.pricePerUnitRial);
    }
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0) return null;

    const gross = qty * price;
    if (tradeOpen.mode === "BUY") {
      const cashOut = gross + (Number.isFinite(fee) ? fee : 0);
      return {
        kind: "BUY" as const,
        qty,
        gross,
        cashOut,
        // Only flag it when the balance is actually known.
        overdraft: cashRial != null && cashOut > cashRial ? cashOut - cashRial : 0,
      };
    }
    const costOfSold = avg * qty;
    const proceeds = gross - (Number.isFinite(fee) ? fee : 0);
    const realized = proceeds - costOfSold;
    return {
      kind: "SELL" as const,
      qty,
      gross,
      proceeds,
      costOfSold,
      realized,
      remainingValue: Math.max(0, (held - qty) * avg),
      closesPosition: qty >= held - 1e-8,
      /**
       * A sale that returns less than half of what the sold quantity cost is
       * almost always a units/price mix-up rather than a real 50% loss, so it
       * gets an explicit warning before it is written to the ledger.
       */
      suspiciousLoss: costOfSold > 0 && proceeds < costOfSold / 2,
    };
  }, [tradeOpen, tradeMode, trade, cashRial]);

  /** Names the consequence of the trade rather than echoing the typed numbers. */
  function confirmMessage(): string {
    if (!tradeOpen) return "";
    const sym = tradeOpen.asset.symbol;
    const money = (v: number) => formatMoney(String(Math.round(v)), currency);
    if (!preview) {
      return `آیا از ثبت این ${tradeOpen.mode === "BUY" ? "خرید" : "فروش"} روی ${sym} اطمینان دارید؟`;
    }
    if (preview.kind === "BUY") {
      const base = `آیا از ثبت خرید ${sym} به مبلغ ${money(preview.cashOut)} اطمینان دارید؟ این مبلغ از موجودی نقد صندوق کم می‌شود.`;
      return preview.overdraft > 0
        ? `${base} توجه: این خرید ${money(preview.overdraft)} بیشتر از موجودی نقد است و نقد صندوق را منفی می‌کند.`
        : base;
    }
    if (preview.suspiciousLoss) {
      return `این فروش ${money(preview.proceeds)} به نقد اضافه می‌کند، در حالی که بهای تمام‌شدهٔ همین مقدار ${money(preview.costOfSold)} است؛ یعنی زیانی به مبلغ ${money(-preview.realized)} ثبت می‌شود${preview.closesPosition ? " و موقعیت کاملاً بسته می‌شود" : ""}. اگر منظورتان برداشت بخشی از پول این دارایی بود، انصراف بدهید و حالت «برداشت مبلغ» را انتخاب کنید.`;
    }
    if (tradeMode === "WITHDRAW") {
      return `آیا از برداشت ${money(preview.proceeds)} از ${sym} اطمینان دارید؟ این مبلغ به موجودی نقد اضافه می‌شود، ارزش دفتری این دارایی ${money(preview.remainingValue)} می‌ماند و سود یا زیانی ثبت نمی‌شود.`;
    }
    if (preview.closesPosition) {
      return `آیا از فروش کل موجودی ${sym} به مبلغ ${money(preview.proceeds)} اطمینان دارید؟ موقعیت بسته می‌شود و ${money(preview.realized)} سود / زیان محقق‌شده ثبت می‌گردد.`;
    }
    return `آیا از فروش ${formatUnits(String(preview.qty), 8)} واحد ${sym} به مبلغ ${money(preview.proceeds)} اطمینان دارید؟ ${money(preview.realized)} سود / زیان محقق‌شده ثبت می‌شود و ${money(preview.remainingValue)} از این دارایی باقی می‌ماند.`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="پرتفوی"
        subtitle="دارایی‌ها، خرید و فروش، سود/زیان و ارزش روز"
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={openAutoPlan} disabled={autoBusy}>
              <RefreshCw size={18} className={autoBusy ? "animate-spin" : ""} /> قیمت‌های بازار
            </button>
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
            {tradeOpen?.mode === "SELL" && LUMP_CLASSES.has(tradeOpen.asset.assetClass) && (
              <button
                className={`badge px-3 py-1.5 ${
                  tradeMode === "WITHDRAW" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
                onClick={() => setTradeMode("WITHDRAW")}
              >
                برداشت مبلغ
              </button>
            )}
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
              {tradeOpen?.mode === "SELL" ? "فروش کامل (بستن موقعیت)" : "مبلغ کل (یک‌جا)"}
            </button>
          </div>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {tradeMode === "WITHDRAW"
              ? "بخشی از پول این دارایی را نقد می‌کنید و موقعیت باز می‌ماند؛ فقط مبلغ را بنویسید، مقدار خودش حساب می‌شود."
              : tradeMode === "UNIT"
                ? "برای سهم، صندوق سهامی، طلا، ارز و رمزارز که «هر واحد» قیمت مشخصی دارد."
                : tradeOpen?.mode === "SELL"
                  ? "کل موجودی این دارایی فروخته و موقعیت بسته می‌شود."
                  : "برای خودرو، ملک، صندوق درآمد ثابت و هر چیزی که قیمت هر واحد ندارد؛ فقط مبلغ کل را وارد کنید."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tradeMode === "WITHDRAW" ? (
            <div className="sm:col-span-2">
              <label className="label">چقدر برداشت می‌کنید؟ (ریال)</label>
              <input
                className="input tabular"
                placeholder="مثلاً ۱۰۰۰۰۰۰۰۰"
                value={trade.withdrawRial}
                onChange={(e) => setTrade({ ...trade, withdrawRial: e.target.value })}
              />
              {!!num(trade.withdrawRial) && (
                <p className="mt-1 text-xs text-slate-500">
                  {formatMoney(String(Math.round(num(trade.withdrawRial))), currency)}
                </p>
              )}
              <p className="mt-2 text-xs leading-6 text-slate-500">
                ارزش دفتری فعلی:{" "}
                <span className="tabular font-medium text-slate-700">
                  {formatMoney(tradeOpen?.asset.remainingCostBasisRial ?? "0", currency)}
                </span>
              </p>
            </div>
          ) : tradeMode === "UNIT" ? (
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

        {/* Live consequence of the numbers above, so surprises surface before the write. */}
        {preview?.kind === "SELL" && (
          <div className="mt-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-6">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">مقداری که فروخته می‌شود</span>
              <span className="tabular font-medium text-slate-700">{formatUnits(String(preview.qty), 8)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">به نقد اضافه می‌شود</span>
              <span className="tabular font-medium text-slate-700">
                {formatMoney(String(Math.round(preview.proceeds)), currency)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">سود / زیان محقق‌شده</span>
              <span
                className={`tabular font-medium ${
                  Math.round(preview.realized) > 0
                    ? "text-green-600"
                    : Math.round(preview.realized) < 0
                      ? "text-red-600"
                      : "text-slate-700"
                }`}
              >
                {formatMoney(String(Math.round(preview.realized)), currency)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">باقی‌ماندهٔ این دارایی</span>
              <span className="tabular font-medium text-slate-700">
                {preview.closesPosition
                  ? "صفر — موقعیت بسته می‌شود"
                  : formatMoney(String(Math.round(preview.remainingValue)), currency)}
              </span>
            </div>
          </div>
        )}
        {preview?.kind === "SELL" && preview.suspiciousLoss && (
          <p className="mt-2 rounded-lg border-r-4 border-red-400 bg-red-50 px-3 py-2 text-xs leading-6 text-red-800">
            این فروش زیانی به مبلغ {formatMoney(String(Math.round(-preview.realized)), currency)} ثبت
            می‌کند، یعنی بیش از نصف بهای تمام‌شدهٔ مقداری که می‌فروشید. اگر واقعاً چنین زیانی نداده‌اید،
            احتمالاً «مقدار» و «قیمت هر واحد» با واحد اشتباهی وارد شده‌اند — برای برداشت بخشی از پول
            یک دارایی یک‌جا، حالت «برداشت مبلغ» را انتخاب کنید.
          </p>
        )}
        {preview?.kind === "BUY" && preview.overdraft > 0 && (
          <p className="mt-2 rounded-lg border-r-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
            موجودی نقد صندوق {formatMoney(String(Math.round(cashRial ?? 0)), currency)} است و این خرید{" "}
            {formatMoney(String(Math.round(preview.overdraft)), currency)} از آن بیشتر است؛ با ثبت آن نقد
            صندوق منفی می‌شود. اول واریز عضو یا فروش دارایی را ثبت کنید.
          </p>
        )}

        {tradeOpen?.mode === "BUY" ? (
          <p className="mt-3 text-xs text-slate-500">
            کارمزد خرید به بهای تمام‌شده افزوده می‌شود و در میانگین موزون خرید لحاظ می‌گردد.
          </p>
        ) : tradeMode === "WITHDRAW" ? (
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
            <Tag size={14} /> برداشت به ارزش دفتری انجام می‌شود، پس سود یا زیانی نمی‌سازد. سود صندوق را
            جداگانه با دکمهٔ «سود / هزینه» ثبت کنید.
          </p>
        ) : (
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
            <Tag size={14} /> موجودی فعلی: {formatUnits(tradeOpen?.asset.quantity ?? "0", 8)} — فروش بیش از موجودی مجاز نیست.
          </p>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmTrade}
        title={
          preview?.kind === "SELL" && preview.suspiciousLoss
            ? "این فروش زیان بزرگی ثبت می‌کند"
            : "تأیید تراکنش"
        }
        danger={tradeOpen?.mode === "SELL"}
        message={confirmMessage()}
        confirmLabel={
          preview?.kind === "SELL" && preview.suspiciousLoss
            ? "می‌دانم، ثبت شود"
            : "بله، ثبت شود"
        }
        onConfirm={submitTrade}
        onCancel={() => setConfirmTrade(false)}
      />

      {/* Automatic market pricing review */}
      <Modal
        open={autoPlanOpen}
        onClose={() => setAutoPlanOpen(false)}
        title="قیمت‌گیری خودکار از بازار"
        footer={
          <>
            <button className="btn-primary" onClick={refreshPricesFromMarket} disabled={autoBusy}>
              {autoBusy ? "در حال ثبت…" : "ثبت قیمت‌های امروز"}
            </button>
            <button className="btn-secondary" onClick={() => setAutoPlanOpen(false)}>
              بستن
            </button>
          </>
        }
      >
        <p className="mb-3 text-xs leading-6 text-slate-500">
          هر دارایی به یک نرخ زنده وصل می‌شود و قیمت امروز ثبت می‌گردد. اگر امروز خودتان قیمتی ثبت کرده باشید،
          دست‌نخورده می‌ماند. منبع فعلی: TGJU برای ارز، طلا، نقره و صندوق‌های کالایی.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">دارایی</th>
                <th className="th">نرخ زنده</th>
                <th className="th">قیمت (ریال)</th>
                <th className="th">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {autoPlan.map((row) => (
                <tr key={row.assetId} className="border-b border-slate-50">
                  <td className="td">
                    <div className="font-medium">{row.symbol}</div>
                    <div className="text-xs text-slate-400">{row.name}</div>
                  </td>
                  <td className="td text-xs">{row.matchedName ?? "—"}</td>
                  <td className="td tabular">{row.priceRial ? formatMoney(row.priceRial, currency) : "—"}</td>
                  <td className="td">
                    {row.confidence === "UNMATCHED" || row.confidence === "NO_PRICE" ? (
                      <div>
                        <Badge tone="amber">{priceStatusLabel(row.confidence)}</Badge>
                        <div className="mt-1 text-[11px] leading-5 text-slate-500">{row.reason}</div>
                      </div>
                    ) : (
                      <div>
                        <Badge tone="green">{priceStatusLabel(row.status ?? row.confidence)}</Badge>
                        <div className="mt-1 text-[11px] text-slate-400">{row.reason}</div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
          سهام و صندوق‌های بورسی تهران از این دستگاه در دسترس نیستند و برای آن‌ها قیمت را دستی وارد کنید؛ دلیلش در
          ستون وضعیت هر ردیف نوشته شده است.
        </p>
      </Modal>

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
