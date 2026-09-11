import Decimal from "decimal.js";
import {
  assetMarketValue,
  calculateNav,
  calculateNavPerUnit,
  decToString,
  replayAssetLots,
  returnPercent,
  toDecimal,
  xirr,
} from "./money.js";

const DAY_MS = 86_400_000;

export type ValuationStatus = "MARKET" | "STALE" | "AT_COST" | "MISSING";
export type Resolution = "EXACT" | "PREVIOUS";

export interface ExternalFlow {
  date: Date;
  type: "DEPOSIT" | "WITHDRAWAL_SETTLEMENT";
  amountRial: bigint;
}

export interface DatedPrice {
  date: Date;
  priceRial: bigint;
}

export interface ResolvedPrice extends DatedPrice {
  resolution: Resolution;
  gapDays: number;
}

export function utcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

export function dayKey(value: Date): string {
  return utcDay(value).toISOString().slice(0, 10);
}

export function percent(numerator: Decimal.Value, denominator: Decimal.Value) {
  const base = new Decimal(denominator);
  if (base.lte(0)) return null;
  return new Decimal(numerator).div(base).mul(100).toDecimalPlaces(8).toString();
}

export function calculateActualProfit(
  endNavRial: bigint,
  depositsRial: bigint,
  settledWithdrawalsRial: bigint
): bigint {
  return endNavRial - depositsRial + settledWithdrawalsRial;
}

export function calculateRangeProfit(
  startNavRial: bigint,
  endNavRial: bigint,
  contributionsRial: bigint,
  withdrawalsRial: bigint
): bigint {
  return endNavRial - startNavRial - contributionsRial + withdrawalsRial;
}

export function pointReturnPercent(
  startNavPerUnit: Decimal.Value,
  endNavPerUnit: Decimal.Value
): string | null {
  const start = new Decimal(startNavPerUnit);
  if (start.lte(0)) return null;
  return new Decimal(endNavPerUnit)
    .div(start)
    .sub(1)
    .mul(100)
    .toDecimalPlaces(8)
    .toString();
}

/**
 * Real (inflation-adjusted) return — how much a nominal return beats inflation.
 *   real = (1 + nominal) / (1 + inflation) - 1
 * Both inputs are percentages. Returns null when either is unknown, or when
 * inflation is -100% or lower where the ratio is undefined.
 */
export function realReturnPercent(
  nominalPercent: Decimal.Value | null,
  inflationPercent: Decimal.Value | null
): string | null {
  if (nominalPercent == null || inflationPercent == null) return null;
  const inflation = new Decimal(inflationPercent).div(100);
  if (inflation.lte(-1)) return null;
  return new Decimal(nominalPercent)
    .div(100)
    .add(1)
    .div(inflation.add(1))
    .sub(1)
    .mul(100)
    .toDecimalPlaces(8)
    .toString();
}

export function resolvePriceAtOrBefore(
  prices: DatedPrice[],
  target: Date
): ResolvedPrice | null {
  const targetDay = utcDay(target);
  let candidate: DatedPrice | null = null;
  for (const price of prices) {
    const priceDay = utcDay(price.date);
    if (priceDay.getTime() > targetDay.getTime()) continue;
    if (!candidate || priceDay.getTime() > utcDay(candidate.date).getTime()) {
      candidate = price;
    }
  }
  if (!candidate) return null;
  const gapDays = Math.floor(
    (targetDay.getTime() - utcDay(candidate.date).getTime()) / DAY_MS
  );
  return {
    ...candidate,
    resolution: gapDays === 0 ? "EXACT" : "PREVIOUS",
    gapDays,
  };
}

export interface BenchmarkCounterfactual {
  status: "EXACT" | "PARTIAL" | "MISSING";
  endingUnits: string | null;
  endingValueRial: string | null;
  profitRial: string | null;
  returnPercent: string | null;
  xirrAnnualizedPercent: string | null;
  solvency: boolean | null;
  missingFlowDates: string[];
  flowResolutions: Array<{
    date: string;
    type: ExternalFlow["type"];
    priceDate: string;
    resolution: Resolution;
    gapDays: number;
  }>;
  terminalResolution: {
    priceDate: string;
    resolution: Resolution;
    gapDays: number;
  } | null;
}

export function benchmarkCounterfactual(
  flows: ExternalFlow[],
  prices: DatedPrice[],
  to: Date
): BenchmarkCounterfactual {
  let units = new Decimal(0);
  let deposited = 0n;
  let withdrawn = 0n;
  let solvent = true;
  const missing = new Set<string>();
  const resolutions: BenchmarkCounterfactual["flowResolutions"] = [];
  const ordered = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const flow of ordered) {
    const resolved = resolvePriceAtOrBefore(prices, flow.date);
    if (!resolved) {
      missing.add(dayKey(flow.date));
      continue;
    }
    resolutions.push({
      date: dayKey(flow.date),
      type: flow.type,
      priceDate: dayKey(resolved.date),
      resolution: resolved.resolution,
      gapDays: resolved.gapDays,
    });
    const amount = new Decimal(flow.amountRial.toString());
    const price = new Decimal(resolved.priceRial.toString());
    if (flow.type === "DEPOSIT") {
      units = units.add(amount.div(price));
      deposited += flow.amountRial;
    } else {
      const soldUnits = amount.div(price);
      if (soldUnits.gt(units)) {
        solvent = false;
        units = new Decimal(0);
      } else {
        units = units.sub(soldUnits);
      }
      withdrawn += flow.amountRial;
    }
  }

  const terminal = resolvePriceAtOrBefore(prices, to);
  if (!terminal) missing.add(dayKey(to));
  const missingFlowDates = [...missing].sort();
  if (!terminal || deposited === 0n || missingFlowDates.length > 0) {
    return {
      status: "MISSING",
      endingUnits: null,
      endingValueRial: null,
      profitRial: null,
      returnPercent: null,
      xirrAnnualizedPercent: null,
      solvency: resolutions.length === 0 ? null : solvent,
      missingFlowDates,
      flowResolutions: resolutions,
      terminalResolution: null,
    };
  }

  const endingValue = BigInt(
    units.mul(terminal.priceRial.toString()).toFixed(0, Decimal.ROUND_HALF_UP)
  );
  const profit = endingValue - deposited + withdrawn;
  const netInvested = deposited - withdrawn;
  const rate = xirr([
    ...ordered.map((flow) => ({
      date: flow.date,
      amountRial:
        flow.type === "DEPOSIT" ? -flow.amountRial : flow.amountRial,
    })),
    { date: to, amountRial: endingValue },
  ]);
  return {
    status: solvent ? "EXACT" : "PARTIAL",
    endingUnits: units.toDecimalPlaces(12).toString(),
    endingValueRial: endingValue.toString(),
    profitRial: profit.toString(),
    returnPercent: percent(profit.toString(), netInvested.toString()),
    xirrAnnualizedPercent:
      rate == null ? null : new Decimal(rate).mul(100).toDecimalPlaces(8).toString(),
    solvency: solvent,
    missingFlowDates,
    flowResolutions: resolutions,
    terminalResolution: {
      priceDate: dayKey(terminal.date),
      resolution: terminal.resolution,
      gapDays: terminal.gapDays,
    },
  };
}

export interface ReplayAsset {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
}

export interface ReplayPortfolioTx {
  type: string;
  status: string;
  assetId: string | null;
  quantity: string;
  pricePerUnit: string;
  feeRial: bigint;
  cashDeltaRial: bigint;
  effectiveDate: Date;
}

export interface ReplayMemberTx {
  type: string;
  status: string;
  units: string;
  effectiveDate: Date;
}

export interface ReplayPrice {
  assetId: string;
  priceRial: string;
  priceDate: Date;
}

export interface ReplayAssetValue {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  quantity: string;
  avgCostRial: string;
  remainingCostBasisRial: string;
  marketValueRial: bigint | null;
  realizedPnlRial: bigint;
  unrealizedPnlRial: bigint | null;
  totalPnlRial: bigint | null;
  valuationStatus: ValuationStatus;
  priceDate: string | null;
}

export interface BoundaryReplay {
  date: Date;
  cashBalanceRial: bigint;
  assetsValueRial: bigint | null;
  totalNavRial: bigint | null;
  totalActiveUnits: Decimal;
  navPerUnit: Decimal | null;
  assets: ReplayAssetValue[];
  warnings: string[];
}

export function replayBoundary(input: {
  date: Date;
  assets: ReplayAsset[];
  portfolioTxs: ReplayPortfolioTx[];
  memberTxs: ReplayMemberTx[];
  prices: ReplayPrice[];
  defaultNavPerUnitRial: bigint;
  liabilitiesRial?: bigint;
  staleAfterDays?: number;
}): BoundaryReplay {
  const boundary = utcDay(input.date);
  const through = (date: Date) => utcDay(date).getTime() <= boundary.getTime();
  const ptx = input.portfolioTxs.filter(
    (tx) => tx.status === "CONFIRMED" && through(tx.effectiveDate)
  );
  const mtx = input.memberTxs.filter(
    (tx) => ["CONFIRMED", "SETTLED"].includes(tx.status) && through(tx.effectiveDate)
  );
  const cashBalanceRial = ptx.reduce((sum, tx) => sum + tx.cashDeltaRial, 0n);
  let totalUnits = new Decimal(0);
  for (const tx of mtx) {
    if (tx.type === "UNIT_ISSUANCE") totalUnits = totalUnits.add(tx.units);
    if (tx.type === "UNIT_REDEMPTION") totalUnits = totalUnits.sub(tx.units);
    if (tx.type === "ADJUSTMENT") totalUnits = totalUnits.add(tx.units);
  }

  const warnings: string[] = [];
  const values: ReplayAssetValue[] = [];
  let assetsValue = 0n;
  let navComplete = true;
  for (const asset of input.assets) {
    const assetTxs = ptx.filter(
      (tx) => tx.assetId === asset.id && ["BUY", "SELL"].includes(tx.type)
    );
    const lots = assetTxs.map((tx) => ({
      type: tx.type as "BUY" | "SELL",
      quantity: tx.quantity,
      priceRial: tx.pricePerUnit,
      feeRial: tx.feeRial,
    }));
    const state = replayAssetLots(lots, { storedAverageCost: true });
    const basis = BigInt(
      state.remainingCostBasisRial.toFixed(0, Decimal.ROUND_HALF_UP)
    );
    const resolved = resolvePriceAtOrBefore(
      input.prices
        .filter((price) => price.assetId === asset.id)
        .map((price) => ({ date: price.priceDate, priceRial: BigInt(price.priceRial) })),
      boundary
    );
    let marketValue: bigint | null = 0n;
    let valuationStatus: ValuationStatus = "MARKET";
    if (state.quantity.gt(0) && resolved) {
      marketValue = assetMarketValue(state.quantity, resolved.priceRial);
      valuationStatus =
        resolved.gapDays > (input.staleAfterDays ?? 7) ? "STALE" : "MARKET";
      if (valuationStatus === "STALE") {
        warnings.push(
          `${asset.symbol}: قیمت ${resolved.gapDays} روز پیش برای ارزش‌گذاری استفاده شد.`
        );
      }
    } else if (state.quantity.gt(0) && basis > 0n) {
      marketValue = basis;
      valuationStatus = "AT_COST";
      warnings.push(`${asset.symbol}: قیمت گذشته موجود نیست؛ ارزش تمام‌شده استفاده شد.`);
    } else if (state.quantity.gt(0)) {
      marketValue = null;
      valuationStatus = "MISSING";
      navComplete = false;
      warnings.push(`${asset.symbol}: قیمت و بهای تمام‌شده برای ارزش‌گذاری موجود نیست.`);
    }
    if (marketValue != null) assetsValue += marketValue;
    const unrealized = marketValue == null ? null : marketValue - basis;
    const realized = BigInt(state.realizedPnlRial.toFixed(0, Decimal.ROUND_HALF_UP));
    values.push({
      assetId: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      quantity: decToString(state.quantity),
      avgCostRial: state.avgCostRial.toFixed(0, Decimal.ROUND_HALF_UP),
      remainingCostBasisRial: basis.toString(),
      marketValueRial: marketValue,
      realizedPnlRial: realized,
      unrealizedPnlRial: unrealized,
      totalPnlRial: unrealized == null ? null : realized + unrealized,
      valuationStatus,
      priceDate: resolved ? dayKey(resolved.date) : null,
    });
  }

  const totalNav = navComplete
    ? calculateNav({
        cashBalanceRial,
        totalMarketValueOfAssetsRial: assetsValue,
        liabilitiesRial: input.liabilitiesRial ?? 0n,
      })
    : null;
  return {
    date: boundary,
    cashBalanceRial,
    assetsValueRial: navComplete ? assetsValue : null,
    totalNavRial: totalNav,
    totalActiveUnits: totalUnits,
    navPerUnit:
      totalNav == null
        ? null
        : calculateNavPerUnit(totalNav, totalUnits, input.defaultNavPerUnitRial),
    assets: values,
    warnings,
  };
}

export interface AssetContribution {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  startMarketValueRial: string | null;
  endMarketValueRial: string | null;
  linkedCashDeltaRial: string;
  profitContributionRial: string | null;
  avgCostRial: string;
  remainingCostBasisRial: string;
  realizedPnlRial: string;
  unrealizedPnlRial: string | null;
  totalPnlRial: string | null;
  returnPercent: string | null;
  valuationStatus: ValuationStatus;
  priceDate: string | null;
}

export function calculateAssetContributions(input: {
  startAssets: ReplayAssetValue[];
  endAssets: ReplayAssetValue[];
  rangeTransactions: ReplayPortfolioTx[];
  actualProfitRial: bigint;
}): { assets: AssetContribution[]; unattributedCashProfitRial: bigint } {
  const startById = new Map(input.startAssets.map((asset) => [asset.assetId, asset]));
  let attributed = 0n;
  const rows = input.endAssets.map((end) => {
    const start = startById.get(end.assetId);
    const linkedCashDelta = input.rangeTransactions
      .filter((tx) => tx.status === "CONFIRMED" && tx.assetId === end.assetId)
      .reduce((sum, tx) => sum + tx.cashDeltaRial, 0n);
    const contribution =
      end.marketValueRial == null || (start && start.marketValueRial == null)
        ? null
        : end.marketValueRial - (start?.marketValueRial ?? 0n) + linkedCashDelta;
    if (contribution != null) attributed += contribution;
    return {
      assetId: end.assetId,
      symbol: end.symbol,
      name: end.name,
      assetClass: end.assetClass,
      startMarketValueRial: start?.marketValueRial?.toString() ?? "0",
      endMarketValueRial: end.marketValueRial?.toString() ?? null,
      linkedCashDeltaRial: linkedCashDelta.toString(),
      profitContributionRial: contribution?.toString() ?? null,
      avgCostRial: end.avgCostRial,
      remainingCostBasisRial: end.remainingCostBasisRial,
      realizedPnlRial: end.realizedPnlRial.toString(),
      unrealizedPnlRial: end.unrealizedPnlRial?.toString() ?? null,
      totalPnlRial: end.totalPnlRial?.toString() ?? null,
      returnPercent:
        end.totalPnlRial == null
          ? null
          : returnPercent(end.totalPnlRial.toString(), end.remainingCostBasisRial)?.toString() ??
            null,
      valuationStatus: end.valuationStatus,
      priceDate: end.priceDate,
    };
  });
  return { assets: rows, unattributedCashProfitRial: input.actualProfitRial - attributed };
}
