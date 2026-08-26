import Decimal from "decimal.js";
import { prisma } from "../db.js";
import { toDecimal, decToString, assetMarketValue } from "../lib/money.js";
import { audit } from "./audit.js";

/**
 * Portfolio-level asset operations. BUY/SELL update the asset's quantity and
 * weighted-average cost and move portfolio cash. FEE/DIVIDEND/CASH_ADJUSTMENT
 * only affect cash. Confirmed transactions are never deleted (rule #10);
 * corrections use a reversing CASH_ADJUSTMENT or a SELL/BUY.
 *
 * Cost basis is fee-inclusive: a BUY fee is added to the cost basis (so it
 * raises the average cost), and a SELL fee reduces the proceeds (so it lowers
 * the realized P&L). Realized P&L is computed against the weighted-average cost
 * of the quantity sold and accumulated on the asset for Closed Positions.
 */

export interface BuyInput {
  assetId: string;
  quantity: string;
  pricePerUnitRial: bigint;
  feeRial?: bigint;
  effectiveDate: Date;
  description?: string;
}

export async function buyAsset(input: BuyInput) {
  const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
  if (!asset) throw new Error("دارایی یافت نشد");

  const buyQty = new Decimal(input.quantity);
  if (buyQty.lte(0)) throw new Error("مقدار خرید نامعتبر است");

  const gross = assetMarketValue(buyQty, input.pricePerUnitRial);
  const fee = input.feeRial ?? 0n;
  const cashDelta = -(gross + fee); // cash leaves the portfolio (price + fee)

  // Weighted-average cost is fee-inclusive: fold the fee into the incremental
  // cost basis before recomputing the average.
  const oldQty = toDecimal(asset.quantity);
  const oldBasis = oldQty.mul(toDecimal(asset.avgCost));
  const addedBasis = toDecimal(gross.toString()).add(toDecimal(fee.toString()));
  const newQty = oldQty.add(buyQty);
  const newAvg = newQty.lte(0)
    ? new Decimal(0)
    : oldBasis.add(addedBasis).div(newQty);

  const result = await prisma.$transaction(async (tx) => {
    const ptx = await tx.portfolioTransaction.create({
      data: {
        type: "BUY",
        status: "CONFIRMED",
        assetId: input.assetId,
        quantity: input.quantity,
        pricePerUnit: input.pricePerUnitRial.toString(),
        feeRial: fee,
        realizedPnlRial: 0n,
        cashDeltaRial: cashDelta,
        effectiveDate: input.effectiveDate,
        description: input.description,
      },
    });
    await tx.asset.update({
      where: { id: input.assetId },
      data: {
        quantity: decToString(newQty),
        avgCost: newAvg.toFixed(0, Decimal.ROUND_HALF_UP),
      },
    });
    return ptx;
  });

  await audit("ASSET_BUY", "PortfolioTransaction", result.id, {
    assetId: input.assetId,
    quantity: input.quantity,
    pricePerUnitRial: input.pricePerUnitRial,
    feeRial: fee,
    newAvgCostRial: newAvg.toFixed(0),
  });
  return result;
}

export interface SellInput {
  assetId: string;
  quantity: string;
  pricePerUnitRial: bigint;
  feeRial?: bigint;
  effectiveDate: Date;
  description?: string;
}

export async function sellAsset(input: SellInput) {
  const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
  if (!asset) throw new Error("دارایی یافت نشد");

  const sellQty = new Decimal(input.quantity);
  if (sellQty.lte(0)) throw new Error("مقدار فروش نامعتبر است");
  const currentQty = toDecimal(asset.quantity);
  if (sellQty.gt(currentQty)) throw new Error("موجودی دارایی کافی نیست");

  const gross = assetMarketValue(sellQty, input.pricePerUnitRial);
  const fee = input.feeRial ?? 0n;
  const cashDelta = gross - fee; // net proceeds enter the portfolio

  // Realized P&L = (proceeds - fee) - avgCost * qtySold.
  const avgCost = toDecimal(asset.avgCost);
  const costOfSold = avgCost.mul(sellQty);
  const proceeds = toDecimal(gross.toString()).sub(toDecimal(fee.toString()));
  const realized = proceeds.sub(costOfSold);
  const realizedRial = BigInt(realized.toFixed(0, Decimal.ROUND_HALF_UP));

  const newQty = currentQty.sub(sellQty);
  // Average cost per remaining unit is unchanged on a sale (WAC method).
  const prevRealized = BigInt(asset.realizedPnl || "0");

  const result = await prisma.$transaction(async (tx) => {
    const ptx = await tx.portfolioTransaction.create({
      data: {
        type: "SELL",
        status: "CONFIRMED",
        assetId: input.assetId,
        quantity: input.quantity,
        pricePerUnit: input.pricePerUnitRial.toString(),
        feeRial: fee,
        realizedPnlRial: realizedRial,
        cashDeltaRial: cashDelta,
        effectiveDate: input.effectiveDate,
        description: input.description,
      },
    });
    await tx.asset.update({
      where: { id: input.assetId },
      data: {
        quantity: decToString(newQty),
        avgCost: newQty.lte(0) ? "0" : asset.avgCost,
        realizedPnl: (prevRealized + realizedRial).toString(),
      },
    });
    return ptx;
  });

  await audit("ASSET_SELL", "PortfolioTransaction", result.id, {
    assetId: input.assetId,
    quantity: input.quantity,
    pricePerUnitRial: input.pricePerUnitRial,
    feeRial: fee,
    realizedPnlRial: realizedRial,
  });
  return result;
}

export interface CashOpInput {
  type: "FEE" | "DIVIDEND" | "CASH_ADJUSTMENT";
  amountRial: bigint; // magnitude
  assetId?: string;
  effectiveDate: Date;
  description?: string;
}

export async function cashOperation(input: CashOpInput) {
  // FEE reduces cash, DIVIDEND increases cash, CASH_ADJUSTMENT uses signed amount.
  let cashDelta: bigint;
  if (input.type === "FEE") cashDelta = -abs(input.amountRial);
  else if (input.type === "DIVIDEND") cashDelta = abs(input.amountRial);
  else cashDelta = input.amountRial; // signed

  const ptx = await prisma.portfolioTransaction.create({
    data: {
      type: input.type,
      status: "CONFIRMED",
      assetId: input.assetId,
      cashDeltaRial: cashDelta,
      effectiveDate: input.effectiveDate,
      description: input.description,
    },
  });
  await audit(`PORTFOLIO_${input.type}`, "PortfolioTransaction", ptx.id, {
    cashDeltaRial: cashDelta,
    assetId: input.assetId,
  });
  return ptx;
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** Records a manual daily price for an asset. Unique per (asset, date). */
export async function recordPrice(
  assetId: string,
  priceRial: bigint,
  priceDate: Date,
  meta: { source?: string; sourceRef?: string; note?: string } = {}
) {
  const source = meta.source ?? "MANUAL";
  const snap = await prisma.priceSnapshot.upsert({
    where: { assetId_priceDate: { assetId, priceDate } },
    create: {
      assetId,
      priceRial: priceRial.toString(),
      priceDate,
      source,
      sourceRef: meta.sourceRef,
      note: meta.note,
    },
    update: {
      priceRial: priceRial.toString(),
      source,
      sourceRef: meta.sourceRef,
      note: meta.note,
    },
  });
  await audit("PRICE_RECORD", "PriceSnapshot", snap.id, {
    assetId,
    priceRial,
    priceDate: priceDate.toISOString(),
    source,
  });
  return snap;
}
