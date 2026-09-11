import Decimal from "decimal.js";

// Configure decimal.js for high precision. We keep 8 fractional digits for
// units and NAV-per-unit (financial rule #9), with extra internal precision
// to avoid rounding drift during intermediate calculations.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

// Number of fractional digits persisted for units / navPerUnit.
export const UNIT_DP = 8;

/**
 * Money model:
 *  - Rial amounts are integers (BigInt). We (de)serialize them as strings.
 *  - Units and navPerUnit are Decimals with 8 fractional digits, stored as strings.
 *
 * All functions here are pure and side-effect free so they can be unit tested
 * and used to reconstruct state from the transaction ledger (rule #11).
 */

export type RialInput = bigint | number | string;
export type DecInput = Decimal | number | string;

/** Parse a rial value into BigInt (integer rial). Rejects fractional rial. */
export function toRial(value: RialInput): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid rial amount");
    return BigInt(Math.round(value));
  }
  const trimmed = value.trim();
  if (trimmed === "") return 0n;
  // Allow decimal strings but round to integer rial.
  if (trimmed.includes(".")) {
    return BigInt(new Decimal(trimmed).toFixed(0));
  }
  return BigInt(trimmed);
}

/** Serialize a BigInt rial value to a string for JSON/DB. */
export function rialToString(value: bigint): string {
  return value.toString();
}

/** Parse a Decimal-like value into a decimal.js instance. */
export function toDecimal(value: DecInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value === "" ? 0 : value);
}

/** Serialize a Decimal to a fixed 8-dp string for DB storage. */
export function decToString(value: Decimal): string {
  return value.toFixed(UNIT_DP);
}

// ---------------------------------------------------------------------------
// Core financial formulas (mirror the rules in the project brief).
// ---------------------------------------------------------------------------

export interface NavInput {
  cashBalanceRial: RialInput;
  totalMarketValueOfAssetsRial: RialInput;
  liabilitiesRial?: RialInput;
}

/**
 * Rule #2: totalNav = cashBalance + totalMarketValueOfAssets - liabilities
 * Returns integer rial (BigInt).
 */
export function calculateNav(input: NavInput): bigint {
  const cash = toRial(input.cashBalanceRial);
  const assets = toRial(input.totalMarketValueOfAssetsRial);
  const liabilities = toRial(input.liabilitiesRial ?? 0n);
  return cash + assets - liabilities;
}

/**
 * Rule #3: navPerUnit = totalNav / totalActiveUnits
 * Rule #8: when there are no units yet, fall back to the configured default.
 * Returns a Decimal with 8 dp.
 */
export function calculateNavPerUnit(
  totalNavRial: RialInput,
  totalActiveUnits: DecInput,
  defaultNavPerUnitRial: RialInput
): Decimal {
  const units = toDecimal(totalActiveUnits);
  if (units.lte(0)) {
    return toDecimal(toRial(defaultNavPerUnitRial).toString()).toDecimalPlaces(
      UNIT_DP
    );
  }
  const nav = toDecimal(toRial(totalNavRial).toString());
  return nav.div(units).toDecimalPlaces(UNIT_DP, Decimal.ROUND_HALF_UP);
}

/**
 * Rule #4: issuedUnits = netDepositAmount / navPerUnit
 * netDepositAmount is integer rial; navPerUnit is Decimal rial.
 * Returns units as a Decimal with 8 dp.
 */
export function issueUnits(
  netDepositAmountRial: RialInput,
  navPerUnit: DecInput
): Decimal {
  const nav = toDecimal(navPerUnit);
  if (nav.lte(0)) throw new Error("navPerUnit must be greater than zero");
  const amount = toDecimal(toRial(netDepositAmountRial).toString());
  return amount.div(nav).toDecimalPlaces(UNIT_DP, Decimal.ROUND_DOWN);
}

/**
 * Rule #5: withdrawalAmount = redeemedUnits * navPerUnit
 * Returns integer rial (BigInt), rounded to nearest rial.
 */
export function redeemUnits(
  redeemedUnits: DecInput,
  navPerUnit: DecInput
): bigint {
  const units = toDecimal(redeemedUnits);
  const nav = toDecimal(navPerUnit);
  if (units.lt(0)) throw new Error("redeemedUnits must not be negative");
  const amount = units.mul(nav);
  return BigInt(amount.toFixed(0, Decimal.ROUND_HALF_UP));
}

/**
 * Rule #6: memberValue = activeUnits * currentNavPerUnit
 * Returns integer rial (BigInt).
 */
export function calculateMemberValue(
  activeUnits: DecInput,
  currentNavPerUnit: DecInput
): bigint {
  const units = toDecimal(activeUnits);
  const nav = toDecimal(currentNavPerUnit);
  return BigInt(units.mul(nav).toFixed(0, Decimal.ROUND_HALF_UP));
}

/**
 * Rule #7: ownershipPercent = activeUnits / totalActiveUnits * 100
 * Returns a Decimal (percentage) with up to 4 dp for display.
 */
export function calculateOwnershipPercent(
  activeUnits: DecInput,
  totalActiveUnits: DecInput
): Decimal {
  const total = toDecimal(totalActiveUnits);
  if (total.lte(0)) return new Decimal(0);
  return toDecimal(activeUnits).div(total).mul(100).toDecimalPlaces(4);
}

/** Market value of an asset holding: quantity * price. Returns integer rial. */
export function assetMarketValue(
  quantity: DecInput,
  priceRial: RialInput
): bigint {
  const qty = toDecimal(quantity);
  const price = toDecimal(toRial(priceRial).toString());
  return BigInt(qty.mul(price).toFixed(0, Decimal.ROUND_HALF_UP));
}

/**
 * Weighted-average cost update when buying more of an asset.
 * newAvg = (oldQty*oldAvg + buyQty*buyPrice) / (oldQty + buyQty)
 * Returns avg cost per unit as integer rial (BigInt).
 */
export function updatedAvgCost(
  oldQty: DecInput,
  oldAvgRial: RialInput,
  buyQty: DecInput,
  buyPriceRial: RialInput
): bigint {
  const q0 = toDecimal(oldQty);
  const a0 = toDecimal(toRial(oldAvgRial).toString());
  const qb = toDecimal(buyQty);
  const pb = toDecimal(toRial(buyPriceRial).toString());
  const newQty = q0.add(qb);
  if (newQty.lte(0)) return 0n;
  const total = q0.mul(a0).add(qb.mul(pb));
  return BigInt(total.div(newQty).toFixed(0, Decimal.ROUND_HALF_UP));
}

/** Rial <-> Toman display helpers (1 Toman = 10 Rial). Display only. */
export function rialToToman(rial: bigint): Decimal {
  return toDecimal(rial.toString()).div(10);
}

// ---------------------------------------------------------------------------
// Asset profit & loss (Weighted Average Cost) — reconstructable from the
// BUY/SELL ledger so realized/unrealized P&L is always auditable (rule #11).
// ---------------------------------------------------------------------------

export interface AssetLot {
  type: "BUY" | "SELL";
  quantity: DecInput;
  priceRial: RialInput;
  feeRial?: RialInput;
}

export interface AssetPnlState {
  quantity: Decimal; // remaining quantity held
  avgCostRial: Decimal; // weighted-average cost per unit (rial), fee-inclusive
  remainingCostBasisRial: Decimal; // cost basis of the remaining quantity (rial)
  realizedPnlRial: Decimal; // cumulative realized P&L across all sells (rial)
}

/**
 * Replays a chronologically ordered list of BUY/SELL lots using the weighted
 * average cost method:
 *   - BUY  adds (qty*price + fee) to the cost basis; avg cost is recomputed.
 *   - SELL realizes (proceeds - avgCost*qtySold); fee reduces proceeds.
 * Selling more than the held quantity throws (no short positions).
 *
 * `storedAverageCost` reproduces what the ledger writer does: it rounds the
 * average cost to whole rial after every buy and carries that rounded figure
 * forward (see buyAsset/sellAsset). Without it the replay keeps exact fractions
 * and drifts away from the stored asset row, which matters for holdings that
 * have no market price and are therefore valued at cost.
 */
export function replayAssetLots(
  lots: AssetLot[],
  options: { storedAverageCost?: boolean } = {}
): AssetPnlState {
  const stored = options.storedAverageCost === true;
  let qty = new Decimal(0);
  let costBasis = new Decimal(0); // total cost basis of remaining quantity
  let realized = new Decimal(0);
  let avgRial = new Decimal(0); // rounded average carried forward in stored mode

  for (const lot of lots) {
    const q = toDecimal(lot.quantity);
    const price = toDecimal(toRial(lot.priceRial).toString());
    const fee = toDecimal(toRial(lot.feeRial ?? 0n).toString());

    if (lot.type === "BUY") {
      if (q.lte(0)) throw new Error("مقدار خرید نامعتبر است");
      // In stored mode the previous basis is the rounded average times quantity,
      // exactly as the writer recomputes it before adding the new purchase.
      const oldBasis = stored ? qty.mul(avgRial) : costBasis;
      const newQty = qty.add(q);
      const newBasis = oldBasis.add(q.mul(price)).add(fee);
      if (stored) {
        avgRial = newQty.gt(0)
          ? new Decimal(newBasis.div(newQty).toFixed(0, Decimal.ROUND_HALF_UP))
          : new Decimal(0);
        costBasis = newQty.mul(avgRial);
      } else {
        costBasis = newBasis;
      }
      qty = newQty;
    } else {
      if (q.lte(0)) throw new Error("مقدار فروش نامعتبر است");
      if (q.gt(qty)) throw new Error("موجودی دارایی کافی نیست");
      const avgPerUnit = stored
        ? avgRial
        : qty.gt(0)
          ? costBasis.div(qty)
          : new Decimal(0);
      const costOfSold = avgPerUnit.mul(q);
      const proceeds = q.mul(price).sub(fee);
      const gain = proceeds.sub(costOfSold);
      // The writer stores each sale's P&L as whole rial and adds the integers.
      realized = stored
        ? realized.add(new Decimal(gain.toFixed(0, Decimal.ROUND_HALF_UP)))
        : realized.add(gain);
      costBasis = stored ? qty.sub(q).mul(avgRial) : costBasis.sub(costOfSold);
      qty = qty.sub(q);
      if (qty.lte(0)) {
        // Fully closed: clear any residual rounding in the basis.
        qty = new Decimal(0);
        costBasis = new Decimal(0);
        avgRial = new Decimal(0);
      }
    }
  }

  const avgCost = qty.gt(0) ? costBasis.div(qty) : new Decimal(0);
  return {
    quantity: qty,
    avgCostRial: avgCost,
    remainingCostBasisRial: costBasis,
    realizedPnlRial: realized,
  };
}

/**
 * Unrealized P&L = currentMarketValue - remainingCostBasis. Integer rial.
 */
export function unrealizedPnl(
  currentMarketValueRial: RialInput,
  remainingCostBasisRial: DecInput
): bigint {
  const mv = toDecimal(toRial(currentMarketValueRial).toString());
  const basis = toDecimal(remainingCostBasisRial);
  return BigInt(mv.sub(basis).toFixed(0, Decimal.ROUND_HALF_UP));
}

/**
 * Return percent = value / basis * 100, to 2 dp. Returns null when the basis is
 * non-positive (avoids division by zero; rule: guard against divide-by-zero).
 */
export function returnPercent(
  valueRial: DecInput,
  basisRial: DecInput
): Decimal | null {
  const basis = toDecimal(basisRial);
  if (basis.lte(0)) return null;
  return toDecimal(valueRial).div(basis).mul(100).toDecimalPlaces(2);
}

/**
 * Allocation percent = categoryValue / totalNav * 100, to 2 dp. Returns null
 * when totalNav is non-positive so the UI can show a friendly message instead.
 */
export function allocationPercent(
  categoryValueRial: RialInput,
  totalNavRial: RialInput
): Decimal | null {
  const nav = toDecimal(toRial(totalNavRial).toString());
  if (nav.lte(0)) return null;
  const value = toDecimal(toRial(categoryValueRial).toString());
  return value.div(nav).mul(100).toDecimalPlaces(2);
}

/**
 * A member's analytical exposure to a category:
 *   exposure = ownershipPercent/100 * categoryMarketValue
 * The member does not own the assets directly; this is a proportional view of
 * the shared portfolio. Returns integer rial.
 */
export function memberCategoryExposure(
  ownershipPercent: DecInput,
  categoryValueRial: RialInput
): bigint {
  const own = toDecimal(ownershipPercent).div(100);
  const value = toDecimal(toRial(categoryValueRial).toString());
  return BigInt(own.mul(value).toFixed(0, Decimal.ROUND_HALF_UP));
}

// ---------------------------------------------------------------------------
// XIRR — money-weighted annualized return from dated cash flows.
// Independent, optional analytics; the core Unit/NAV logic never depends on it.
// ---------------------------------------------------------------------------

export interface CashFlow {
  date: Date;
  amountRial: DecInput | bigint;
}

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

function xnpv(rate: number, flows: { t: number; amount: number }[]): number {
  return flows.reduce(
    (acc, f) => acc + f.amount / Math.pow(1 + rate, f.t),
    0
  );
}

/**
 * Computes XIRR (annualized money-weighted return) via Newton's method with a
 * bisection fallback. Returns null when there is no sign change in the flows or
 * the solver fails to converge, so callers can show "قابل محاسبه نیست".
 */
export function xirr(flows: CashFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  const t0 = flows[0].date.getTime();
  const norm = flows.map((f) => ({
    t: (f.date.getTime() - t0) / MS_PER_YEAR,
    amount: Number(toDecimal(f.amountRial as DecInput).toString()),
  }));

  const hasPos = norm.some((f) => f.amount > 0);
  const hasNeg = norm.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  // Newton's method.
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = xnpv(rate, norm);
    const dr = 1e-6;
    const df = (xnpv(rate + dr, norm) - f) / dr;
    if (!Number.isFinite(df) || df === 0) break;
    const next = rate - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-8) {
      return next <= -1 ? null : next;
    }
    rate = next;
  }

  // Bisection fallback over a wide bracket.
  let lo = -0.9999;
  let hi = 100;
  let flo = xnpv(lo, norm);
  let fhi = xnpv(hi, norm);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = xnpv(mid, norm);
    if (Math.abs(fmid) < 1e-7) return mid;
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return null;
}
