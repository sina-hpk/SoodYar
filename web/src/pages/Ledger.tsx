import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  PlusCircle,
  MinusCircle,
  RefreshCw,
  ShoppingCart,
  Banknote,
  Receipt,
  Coins,
  History,
  Wallet,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { api, type MemberTx, type PortfolioTx } from "../lib/api";
import { Card, PageHeader, Badge, Empty, RiskNotice, StatCard } from "../components/ui";
import { JalaliDateInput } from "../components/JalaliDateInput";
import { useToast } from "../components/Toast";
import { useSettings } from "../context/SettingsContext";
import { formatMoney, formatUnits, toJalali } from "../lib/format";
import { txTypeLabel, txStatusLabel, txStatusTone } from "../lib/labels";

type LedgerSource = "MEMBER" | "PORTFOLIO";

interface LedgerEvent {
  key: string;
  source: LedgerSource;
  type: string;
  status: string;
  effectiveDate: string;
  createdAt: string;
  party: string;
  description: string;
  amountRial: string;
  amountTone: "green" | "red" | "amber" | "slate";
  cashDeltaRial: string | null;
  units: string | null;
  navPerUnit: string | null;
  quantity: string | null;
  pricePerUnit: string | null;
  feeRial: string | null;
  realizedPnlRial: string | null;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  DEPOSIT: ArrowDownLeft,
  WITHDRAWAL_REQUEST: Clock,
  WITHDRAWAL_SETTLEMENT: ArrowUpRight,
  UNIT_ISSUANCE: PlusCircle,
  UNIT_REDEMPTION: MinusCircle,
  ADJUSTMENT: RefreshCw,
  BUY: ShoppingCart,
  SELL: Banknote,
  FEE: Receipt,
  DIVIDEND: Coins,
  CASH_ADJUSTMENT: RefreshCw,
};

const SOURCE_OPTIONS = [
  { value: "", label: "همه منابع" },
  { value: "MEMBER", label: "سرمایهٔ اعضا" },
  { value: "PORTFOLIO", label: "دارایی و نقد سبد" },
];
const MEMBER_TYPES = [
  "DEPOSIT",
  "WITHDRAWAL_REQUEST",
  "WITHDRAWAL_SETTLEMENT",
  "UNIT_ISSUANCE",
  "UNIT_REDEMPTION",
  "ADJUSTMENT",
];
const PORTFOLIO_TYPES = ["BUY", "SELL", "FEE", "DIVIDEND", "CASH_ADJUSTMENT"];
const STATUS_OPTIONS = ["", "CONFIRMED", "PENDING", "SETTLED", "CANCELLED"];

/** Gross rial magnitude of a portfolio row, derived from cash + fee (BigInt-safe). */
function grossRial(p: PortfolioTx): string {
  const cash = BigInt(p.cashDeltaRial || "0");
  const fee = BigInt(p.feeRial || "0");
  if (p.type === "BUY") return (-cash - fee).toString();
  if (p.type === "SELL") return (cash + fee).toString();
  return (cash < 0n ? -cash : cash).toString();
}

function memberTone(type: string): LedgerEvent["amountTone"] {
  if (type === "DEPOSIT") return "green";
  if (type === "WITHDRAWAL_SETTLEMENT") return "red";
  if (type === "WITHDRAWAL_REQUEST") return "amber";
  return "slate";
}

export default function Ledger() {
  const { currency } = useSettings();
  const toast = useToast();
  const [memberTxs, setMemberTxs] = useState<MemberTx[]>([]);
  const [portfolioTxs, setPortfolioTxs] = useState<PortfolioTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    source: "",
    type: "",
    status: "",
    search: "",
    from: "",
    to: "",
  });
  const [sort, setSort] = useState<"desc" | "asc">("desc");

  async function loadAll() {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([api.memberTxs(), api.portfolioTxs()]);
      setMemberTxs(m);
      setPortfolioTxs(p);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadAll();
  }, []);

  // Merge both ledgers into one normalized event stream.
  const allEvents = useMemo<LedgerEvent[]>(() => {
    const events: LedgerEvent[] = [];
    for (const t of memberTxs) {
      const hasUnits = t.units && Number(t.units) !== 0;
      events.push({
        key: `m-${t.id}`,
        source: "MEMBER",
        type: t.type,
        status: t.status,
        effectiveDate: t.effectiveDate,
        createdAt: t.createdAt ?? t.effectiveDate,
        party: t.member?.fullName ?? "—",
        description: t.description ?? "",
        amountRial: t.amountRial,
        amountTone: memberTone(t.type),
        cashDeltaRial: null,
        units: hasUnits ? t.units : null,
        navPerUnit: t.navPerUnit,
        quantity: null,
        pricePerUnit: null,
        feeRial: null,
        realizedPnlRial: null,
      });
    }
    for (const p of portfolioTxs) {
      events.push({
        key: `p-${p.id}`,
        source: "PORTFOLIO",
        type: p.type,
        status: p.status,
        effectiveDate: p.effectiveDate,
        createdAt: p.createdAt ?? p.effectiveDate,
        party: p.asset ? `${p.asset.symbol} — ${p.asset.name}` : "—",
        description: p.description ?? "",
        amountRial: grossRial(p),
        amountTone: "slate",
        cashDeltaRial: p.cashDeltaRial ?? "0",
        units: null,
        navPerUnit: null,
        quantity: p.quantity && Number(p.quantity) !== 0 ? p.quantity : null,
        pricePerUnit: p.pricePerUnit && Number(p.pricePerUnit) !== 0 ? p.pricePerUnit : null,
        feeRial: p.feeRial && BigInt(p.feeRial) !== 0n ? p.feeRial : null,
        realizedPnlRial:
          p.realizedPnlRial && BigInt(p.realizedPnlRial) !== 0n ? p.realizedPnlRial : null,
      });
    }
    return events;
  }, [memberTxs, portfolioTxs]);

  const events = useMemo<LedgerEvent[]>(() => {
    const q = filters.search.trim();
    const out = allEvents.filter((e) => {
      if (filters.source && e.source !== filters.source) return false;
      if (filters.type && e.type !== filters.type) return false;
      if (filters.status && e.status !== filters.status) return false;
      const day = e.effectiveDate.slice(0, 10);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      if (q) {
        const hay = `${e.party} ${e.description} ${txTypeLabel(e.type)}`;
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const da = new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime();
      if (da !== 0) return sort === "asc" ? da : -da;
      const ca = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === "asc" ? ca : -ca;
    });
    return out;
  }, [allEvents, filters, sort]);

  // Cash-flow summary uses the portfolio ledger only — the single source of
  // truth for real cash moving in/out of the fund (member rows are the paired
  // unit/capital view of the same events, so counting both double-counts).
  const summary = useMemo(() => {
    let inflow = 0n;
    let outflow = 0n;
    for (const e of events) {
      if (e.source !== "PORTFOLIO" || e.cashDeltaRial == null) continue;
      const d = BigInt(e.cashDeltaRial);
      if (d > 0n) inflow += d;
      else outflow += -d;
    }
    return { inflow, outflow, net: inflow - outflow };
  }, [events]);

  const typeOptions =
    filters.source === "MEMBER"
      ? MEMBER_TYPES
      : filters.source === "PORTFOLIO"
        ? PORTFOLIO_TYPES
        : [...MEMBER_TYPES, ...PORTFOLIO_TYPES];

  return (
    <div className="space-y-6">
      <PageHeader
        title="دفتر کل"
        subtitle="همهٔ تراکنش‌ها و تاریخچهٔ دارایی‌ها، به‌ترتیب تاریخ و زمان ثبت"
        action={
          <button className="btn-secondary" onClick={loadAll}>
            <RefreshCw size={18} /> تازه‌سازی
          </button>
        }
      />
      <RiskNotice />

      {/* Cash-flow summary (portfolio ledger) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="رویدادها (پس از فیلتر)"
          value={formatUnits(events.length, 0)}
          hint={`از مجموع ${formatUnits(allEvents.length, 0)} رویداد`}
          icon={<History size={20} />}
        />
        <StatCard
          label="کل ورود نقد به سبد"
          value={formatMoney(summary.inflow.toString(), currency)}
          accent="text-green-600"
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          label="کل خروج نقد از سبد"
          value={formatMoney(summary.outflow.toString(), currency)}
          accent="text-red-600"
          icon={<TrendingDown size={20} />}
        />
        <StatCard
          label="خالص گردش نقد"
          value={formatMoney(summary.net.toString(), currency)}
          accent={summary.net >= 0n ? "text-green-600" : "text-red-600"}
          icon={<Wallet size={20} />}
        />
      </div>

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">منبع</label>
            <select
              className="input"
              value={filters.source}
              onChange={(e) => setFilters({ ...filters, source: e.target.value, type: "" })}
            >
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
              <option value="">همه</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {txTypeLabel(t)}
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
            <label className="label">ترتیب</label>
            <select
              className="input"
              value={sort}
              onChange={(e) => setSort(e.target.value as "desc" | "asc")}
            >
              <option value="desc">جدیدترین ابتدا</option>
              <option value="asc">قدیمی‌ترین ابتدا</option>
            </select>
          </div>
          <div>
            <label className="label">از تاریخ</label>
            <JalaliDateInput
              value={filters.from}
              onChange={(iso) => setFilters({ ...filters, from: iso })}
            />
          </div>
          <div>
            <label className="label">تا تاریخ</label>
            <JalaliDateInput
              value={filters.to}
              onChange={(iso) => setFilters({ ...filters, to: iso })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">جستجو</label>
            <input
              className="input"
              placeholder="نام عضو، دارایی یا توضیح…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
        </div>
      </Card>

      <Card>
        {loading ? (
          <Empty>در حال بارگذاری…</Empty>
        ) : events.length === 0 ? (
          <Empty>رویدادی با این فیلترها یافت نشد.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">تاریخ</th>
                  <th className="th">منبع</th>
                  <th className="th">نوع</th>
                  <th className="th">طرف / دارایی</th>
                  <th className="th">جزئیات</th>
                  <th className="th">مبلغ</th>
                  <th className="th">اثر نقدی سبد</th>
                  <th className="th">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <LedgerRow key={e.key} e={e} currency={currency} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs leading-6 text-slate-500">
        هر واریز یا برداشت عضو، هم در «سرمایهٔ اعضا» (دفتر واحد) و هم در «دارایی و نقد سبد» (دفتر نقدی)
        ثبت می‌شود؛ این دو، دو نمای یک رویدادِ واحدند. به همین دلیل «گردش نقد» فقط از روی دفتر نقدیِ سبد
        شمرده می‌شود تا رقم دوباره حساب نشود. مرتب‌سازی بر پایهٔ تاریخِ مؤثر و سپس زمان ثبت است.
      </p>
    </div>
  );
}

function AmountCell({
  value,
  tone,
  currency,
}: {
  value: string;
  tone: LedgerEvent["amountTone"];
  currency: "RIAL" | "TOMAN";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-600"
      : tone === "red"
        ? "text-red-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-slate-700";
  return <span className={`tabular ${toneClass}`}>{formatMoney(value, currency)}</span>;
}

function CashDeltaCell({
  value,
  currency,
}: {
  value: string | null;
  currency: "RIAL" | "TOMAN";
}) {
  if (value == null) return <span className="text-slate-300">—</span>;
  const d = BigInt(value);
  if (d === 0n) return <span className="text-slate-400 tabular">{formatMoney("0", currency)}</span>;
  const positive = d > 0n;
  return (
    <span className={`tabular ${positive ? "text-green-600" : "text-red-600"}`}>
      {positive ? "+" : ""}
      {formatMoney(value, currency)}
    </span>
  );
}

function LedgerRow({ e, currency }: { e: LedgerEvent; currency: "RIAL" | "TOMAN" }) {
  const Icon = TYPE_ICON[e.type] ?? History;
  const details: string[] = [];
  if (e.units) details.push(`${formatUnits(e.units)} واحد`);
  if (e.navPerUnit) details.push(`NAV ${formatMoney(e.navPerUnit, currency)}`);
  if (e.quantity) details.push(`مقدار ${formatUnits(e.quantity, 8)}`);
  if (e.pricePerUnit) details.push(`قیمت ${formatMoney(e.pricePerUnit, currency)}`);
  if (e.feeRial) details.push(`کارمزد ${formatMoney(e.feeRial, currency)}`);
  if (e.realizedPnlRial) details.push(`سود محقق ${formatMoney(e.realizedPnlRial, currency)}`);

  return (
    <tr className="border-b border-slate-50 align-top">
      <td className="td whitespace-nowrap">
        <div>{toJalali(e.effectiveDate)}</div>
        <div className="text-[11px] text-slate-400">ثبت {toJalali(e.createdAt, "HH:mm")}</div>
      </td>
      <td className="td">
        <Badge tone={e.source === "MEMBER" ? "blue" : "slate"}>
          {e.source === "MEMBER" ? "سرمایهٔ اعضا" : "سبد دارایی"}
        </Badge>
      </td>
      <td className="td whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <Icon size={15} className="text-slate-400" />
          {txTypeLabel(e.type)}
        </span>
      </td>
      <td className="td" title={e.party}>
        <span className="block max-w-[14rem] truncate">{e.party}</span>
      </td>
      <td className="td" title={[...details, e.description].filter(Boolean).join(" · ")}>
        {details.length > 0 || e.description ? (
          <div className="max-w-[18rem] space-y-0.5">
            {details.length > 0 && (
              <div className="truncate text-xs text-slate-600">{details.join(" · ")}</div>
            )}
            {e.description && (
              <div className="truncate text-[11px] text-slate-400">{e.description}</div>
            )}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="td whitespace-nowrap">
        <AmountCell value={e.amountRial} tone={e.amountTone} currency={currency} />
      </td>
      <td className="td whitespace-nowrap">
        <CashDeltaCell value={e.cashDeltaRial} currency={currency} />
      </td>
      <td className="td">
        <Badge tone={txStatusTone(e.status)}>{txStatusLabel(e.status)}</Badge>
      </td>
    </tr>
  );
}
