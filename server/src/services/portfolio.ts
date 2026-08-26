import Decimal from "decimal.js";
import { prisma } from "../db.js";
import {
  calculateNav,
  calculateNavPerUnit,
  calculateMemberValue,
  calculateOwnershipPercent,
  assetMarketValue,
  unrealizedPnl,
  returnPercent,
  allocationPercent,
  memberCategoryExposure,
  xirr,
  toDecimal,
  decToString,
} from "../lib/money.js";
import { getDefaultNavPerUnit } from "./settings.js";

/**
 * Reconstructs live state from the confirmed transaction ledger (rule #11).
 * Nothing here mutates the DB; everything is derived so the numbers are
 * always reproducible and auditable.
 */

export interface AssetValuation {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  isActive: boolean;
  quantity: string;
  avgCostRial: string;
  remainingCostBasisRial: string;
  latestPriceRial: string | null;
  priceDate: string | null;
  marketValueRial: string; // integer rial as string
  unrealizedPnlRial: string;
  unrealizedReturnPercent: string | null;
  realizedPnlRial: string;
  totalPnlRial: string;
  totalReturnPercent: string | null;
  weightPercent: string; // share of total NAV
  isClosed: boolean;
}

export interface CategoryAllocation {
  category: string;
  marketValueRial: string;
  allocationPercent: string | null;
  assetCount: number;
}

export interface PortfolioState {
  cashBalanceRial: bigint;
  assetsValueRial: bigint;
  liabilitiesRial: bigint;
  totalNavRial: bigint;
  totalActiveUnits: Decimal;
  navPerUnit: Decimal;
  activeMemberCount: number;
  assets: AssetValuation[];
  categories: CategoryAllocation[];
}

/** Sum the signed cash effect of all confirmed portfolio transactions. */
async function computeCashBalance(): Promise<bigint> {
  const txs = await prisma.portfolioTransaction.findMany({
    where: { status: "CONFIRMED" },
    select: { cashDeltaRial: true },
  });
  return txs.reduce((acc, t) => acc + t.cashDeltaRial, 0n);
}

/** Net units per member from confirmed member transactions. */
export async function computeMemberUnits(): Promise<Map<string, Decimal>> {
  const txs = await prisma.memberTransaction.findMany({
    where: { status: { in: ["CONFIRMED", "SETTLED"] } },
    select: { memberId: true, type: true, units: true },
  });
  const map = new Map<string, Decimal>();
  for (const t of txs) {
    const current = map.get(t.memberId) ?? new Decimal(0);
    const u = toDecimal(t.units);
    if (t.type === "UNIT_ISSUANCE") {
      map.set(t.memberId, current.add(u));
    } else if (t.type === "UNIT_REDEMPTION") {
      map.set(t.memberId, current.sub(u));
    } else if (t.type === "ADJUSTMENT") {
      map.set(t.memberId, current.add(u));
    }
    // DEPOSIT / WITHDRAWAL_* do not themselves move units; the paired
    // UNIT_ISSUANCE / UNIT_REDEMPTION entries do.
  }
  return map;
}

export async function computeTotalActiveUnits(): Promise<Decimal> {
  const map = await computeMemberUnits();
  let total = new Decimal(0);
  for (const v of map.values()) total = total.add(v);
  return total;
}

/**
 * Values every asset using its latest recorded price, computes per-asset P&L
 * (realized + unrealized), category allocation, and the whole portfolio state
 * including NAV and NAV-per-unit. Closed positions (quantity 0) are included so
 * their realized P&L stays visible.
 */
export async function getPortfolioState(): Promise<PortfolioState> {
  const [assets, cashBalanceRial, totalActiveUnits, defaultNav, activeMembers] =
    await Promise.all([
      prisma.asset.findMany({ orderBy: { symbol: "asc" } }),
      computeCashBalance(),
      computeTotalActiveUnits(),
      getDefaultNavPerUnit(),
      prisma.member.count({ where: { status: "ACTIVE" } }),
    ]);

  const valuations: AssetValuation[] = [];
  let assetsValueRial = 0n;

  for (const a of assets) {
    const latest = await prisma.priceSnapshot.findFirst({
      where: { assetId: a.id },
      orderBy: { priceDate: "desc" },
    });
    const qty = toDecimal(a.quantity);
    const priceRial = latest ? BigInt(latest.priceRial) : 0n;
    const marketValue =
      latest && qty.gt(0) ? assetMarketValue(qty, priceRial) : 0n;
    const remainingBasis = assetMarketValue(qty, BigInt(a.avgCost));
    const unrealized = unrealizedPnl(marketValue, remainingBasis.toString());
    const realized = BigInt(a.realizedPnl || "0");
    const totalPnl = realized + unrealized;
    assetsValueRial += marketValue;

    const unrealizedRet = returnPercent(
      unrealized.toString(),
      remainingBasis.toString()
    );
    // Total return relative to the cost basis still at work in the position.
    const totalRet = returnPercent(totalPnl.toString(), remainingBasis.toString());

    valuations.push({
      assetId: a.id,
      symbol: a.symbol,
      name: a.name,
      assetClass: a.assetClass,
      isActive: a.isActive,
      quantity: a.quantity,
      avgCostRial: a.avgCost,
      remainingCostBasisRial: remainingBasis.toString(),
      latestPriceRial: latest ? latest.priceRial : null,
      priceDate: latest ? latest.priceDate.toISOString() : null,
      marketValueRial: marketValue.toString(),
      unrealizedPnlRial: unrealized.toString(),
      unrealizedReturnPercent: unrealizedRet ? unrealizedRet.toString() : null,
      realizedPnlRial: realized.toString(),
      totalPnlRial: totalPnl.toString(),
      totalReturnPercent: totalRet ? totalRet.toString() : null,
      weightPercent: "0",
      isClosed: qty.lte(0),
    });
  }

  const liabilitiesRial = 0n;
  const totalNavRial = calculateNav({
    cashBalanceRial,
    totalMarketValueOfAssetsRial: assetsValueRial,
    liabilitiesRial,
  });
  const navPerUnit = calculateNavPerUnit(
    totalNavRial,
    totalActiveUnits,
    defaultNav
  );

  // Fill asset weights relative to total NAV.
  for (const v of valuations) {
    const pct = allocationPercent(BigInt(v.marketValueRial), totalNavRial);
    v.weightPercent = pct ? pct.toString() : "0";
  }

  const categories = buildCategoryAllocation(
    valuations,
    cashBalanceRial,
    totalNavRial
  );

  return {
    cashBalanceRial,
    assetsValueRial,
    liabilitiesRial,
    totalNavRial,
    totalActiveUnits,
    navPerUnit,
    activeMemberCount: activeMembers,
    assets: valuations,
    categories,
  };
}

/**
 * Groups asset market values by category and adds cash as its own category, so
 * the allocation view sums to (close to) 100% of NAV.
 */
function buildCategoryAllocation(
  assets: AssetValuation[],
  cashBalanceRial: bigint,
  totalNavRial: bigint
): CategoryAllocation[] {
  const byCat = new Map<string, { value: bigint; count: number }>();
  for (const a of assets) {
    const mv = BigInt(a.marketValueRial);
    if (mv <= 0n) continue; // only holdings with live value contribute
    const entry = byCat.get(a.assetClass) ?? { value: 0n, count: 0 };
    entry.value += mv;
    entry.count += 1;
    byCat.set(a.assetClass, entry);
  }

  const rows: CategoryAllocation[] = [];
  for (const [category, { value, count }] of byCat) {
    const pct = allocationPercent(value, totalNavRial);
    rows.push({
      category,
      marketValueRial: value.toString(),
      allocationPercent: pct ? pct.toString() : null,
      assetCount: count,
    });
  }

  // Cash is always shown as an independent category.
  if (cashBalanceRial !== 0n) {
    const pct = allocationPercent(
      cashBalanceRial > 0n ? cashBalanceRial : 0n,
      totalNavRial
    );
    rows.push({
      category: "CASH",
      marketValueRial: cashBalanceRial.toString(),
      allocationPercent: pct ? pct.toString() : null,
      assetCount: 0,
    });
  }

  rows.sort((a, b) =>
    BigInt(b.marketValueRial) > BigInt(a.marketValueRial) ? 1 : -1
  );
  return rows;
}

export interface MemberSummary {
  memberId: string;
  activeUnits: string;
  totalDepositRial: string;
  totalWithdrawalRial: string;
  netContributedCapitalRial: string;
  ownershipPercent: string;
  currentValueRial: string;
  simpleNetPnlRial: string;
  simpleReturnPercent: string | null;
  // kept for backward compatibility with existing UI/serialization
  pnlRial: string;
}

/** Per-member rollup derived from the ledger + current NAV. */
export async function getMemberSummary(
  memberId: string,
  state?: PortfolioState
): Promise<MemberSummary> {
  const st = state ?? (await getPortfolioState());
  const unitsMap = await computeMemberUnits();
  const activeUnits = unitsMap.get(memberId) ?? new Decimal(0);

  const txs = await prisma.memberTransaction.findMany({
    where: { memberId, status: { in: ["CONFIRMED", "SETTLED"] } },
  });
  let totalDeposit = 0n;
  let totalWithdrawal = 0n;
  for (const t of txs) {
    if (t.type === "DEPOSIT") totalDeposit += t.amountRial;
    if (t.type === "WITHDRAWAL_SETTLEMENT") totalWithdrawal += t.amountRial;
  }

  const currentValue = calculateMemberValue(activeUnits, st.navPerUnit);
  const ownership = calculateOwnershipPercent(activeUnits, st.totalActiveUnits);
  const netContributed = totalDeposit - totalWithdrawal;
  // Simple net P&L = current value - net contributed capital.
  const simpleNetPnl = currentValue - netContributed;
  const simpleRet = returnPercent(
    simpleNetPnl.toString(),
    netContributed.toString()
  );

  return {
    memberId,
    activeUnits: decToString(activeUnits),
    totalDepositRial: totalDeposit.toString(),
    totalWithdrawalRial: totalWithdrawal.toString(),
    netContributedCapitalRial: netContributed.toString(),
    ownershipPercent: ownership.toString(),
    currentValueRial: currentValue.toString(),
    simpleNetPnlRial: simpleNetPnl.toString(),
    simpleReturnPercent: simpleRet ? simpleRet.toString() : null,
    pnlRial: simpleNetPnl.toString(),
  };
}

export interface MemberCategoryExposure {
  category: string;
  categoryValueRial: string;
  exposureRial: string;
}

/**
 * A member's proportional (analytical) exposure to each category based on their
 * ownership percent of the whole portfolio. They do not directly own the
 * assets; this is a "what your share looks like" view.
 */
export async function getMemberCategoryExposure(
  memberId: string,
  state?: PortfolioState
): Promise<MemberCategoryExposure[]> {
  const st = state ?? (await getPortfolioState());
  const summary = await getMemberSummary(memberId, st);
  const ownership = summary.ownershipPercent;
  return st.categories.map((c) => ({
    category: c.category,
    categoryValueRial: c.marketValueRial,
    exposureRial: memberCategoryExposure(
      ownership,
      BigInt(c.marketValueRial)
    ).toString(),
  }));
}

export interface MemberXirr {
  xirrPercent: string | null;
  note: string;
}

/**
 * XIRR for a member from dated cash flows: deposits are outflows (negative from
 * the member's perspective), settled withdrawals are inflows, and the current
 * value is treated as a final inflow today. Optional analytics — never feeds
 * the core Unit/NAV logic.
 */
export async function getMemberXirr(
  memberId: string,
  state?: PortfolioState
): Promise<MemberXirr> {
  const st = state ?? (await getPortfolioState());
  const unitsMap = await computeMemberUnits();
  const activeUnits = unitsMap.get(memberId) ?? new Decimal(0);
  const currentValue = calculateMemberValue(activeUnits, st.navPerUnit);

  const txs = await prisma.memberTransaction.findMany({
    where: { memberId, status: { in: ["CONFIRMED", "SETTLED"] } },
    orderBy: { effectiveDate: "asc" },
  });

  const flows: { date: Date; amountRial: bigint }[] = [];
  for (const t of txs) {
    if (t.type === "DEPOSIT") {
      flows.push({ date: t.effectiveDate, amountRial: -t.amountRial });
    } else if (t.type === "WITHDRAWAL_SETTLEMENT") {
      flows.push({ date: t.effectiveDate, amountRial: t.amountRial });
    }
  }
  if (currentValue > 0n) {
    flows.push({ date: new Date(), amountRial: currentValue });
  }

  if (flows.length < 2) {
    return { xirrPercent: null, note: "داده کافی برای محاسبه XIRR وجود ندارد." };
  }
  const rate = xirr(flows);
  if (rate === null) {
    return {
      xirrPercent: null,
      note: "محاسبه XIRR همگرا نشد یا جریان نقدی مناسب نبود.",
    };
  }
  return {
    xirrPercent: new Decimal(rate).mul(100).toDecimalPlaces(2).toString(),
    note: "بازده سالانه‌شده مبتنی بر جریان نقدی (XIRR).",
  };
}
