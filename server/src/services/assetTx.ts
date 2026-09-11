import Decimal from "decimal.js";
import { prisma } from "../db.js";
import { toDecimal, decToString, assetMarketValue, replayAssetLots } from "../lib/money.js";
import { audit } from "./audit.js";
import { rebuildAssetFromLedger } from "./assetRebuild.js";

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
    // The stored columns are rebuilt from the ledger in effective-date order, so
    // a backdated purchase cannot leave the wallet disagreeing with history.
    const rebuilt = await rebuildAssetFromLedger(input.assetId, tx);
    return { ptx, rebuilt };
  });

  await audit("ASSET_BUY", "PortfolioTransaction", result.ptx.id, {
    assetId: input.assetId,
    quantity: input.quantity,
    pricePerUnitRial: input.pricePerUnitRial,
    feeRial: fee,
    newAvgCostRial: result.rebuilt.avgCostRial,
  });
  return result.ptx;
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

  const gross = assetMarketValue(sellQty, input.pricePerUnitRial);
  const fee = input.feeRial ?? 0n;
  const cashDelta = gross - fee; // net proceeds enter the portfolio

  const result = await prisma.$transaction(async (tx) => {
    // Validate against the quantity held *on the effective date*, not the current
    // wallet: a backdated sale must not consume units bought later.
    const heldOnDate = await heldQuantityOnDate(input.assetId, input.effectiveDate, tx);
    if (sellQty.gt(heldOnDate.qty)) {
      throw new Error(
        `در تاریخ ${input.effectiveDate.toISOString().slice(0, 10)} موجودی این دارایی ${heldOnDate.qty.toFixed(
          8
        )} بود و فروش ${sellQty.toFixed(8)} واحد ممکن نیست. تاریخ فروش را اصلاح کنید.`
      );
    }
    const costOfSold = heldOnDate.avgCost.mul(sellQty);
    const proceeds = toDecimal(gross.toString()).sub(toDecimal(fee.toString()));
    const realizedRial = BigInt(
      proceeds.sub(costOfSold).toFixed(0, Decimal.ROUND_HALF_UP)
    );

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
    const rebuilt = await rebuildAssetFromLedger(input.assetId, tx);
    return { ptx, rebuilt, realizedRial };
  });

  await audit("ASSET_SELL", "PortfolioTransaction", result.ptx.id, {
    assetId: input.assetId,
    quantity: input.quantity,
    pricePerUnitRial: input.pricePerUnitRial,
    feeRial: fee,
    realizedPnlRial: result.realizedRial,
    quantityAfter: result.rebuilt.quantity,
  });
  return result.ptx;
}

/** Quantity and average cost held immediately before `date` (before that day's trades). */
async function heldQuantityOnDate(
  assetId: string,
  date: Date,
  client: Pick<typeof prisma, "portfolioTransaction">
): Promise<{ qty: Decimal; avgCost: Decimal }> {
  const rows = await client.portfolioTransaction.findMany({
    where: {
      assetId,
      status: "CONFIRMED",
      type: { in: ["BUY", "SELL"] },
      effectiveDate: { lt: date },
    },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
  });
  // Same-day trades are intentionally excluded: the new sale is dated that day,
  // and ordering among same-day entries is by creation, so the check is against
  // the position carried into the day.
  const state = replayAssetLots(
    rows.map((row) => ({
      type: row.type as "BUY" | "SELL",
      quantity: row.quantity,
      priceRial: row.pricePerUnit ?? "0",
      feeRial: row.feeRial,
    })),
    { storedAverageCost: true }
  );
  return { qty: state.quantity, avgCost: state.avgCostRial };
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
