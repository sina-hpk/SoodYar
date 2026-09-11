import Decimal from "decimal.js";
import { prisma } from "../db.js";
import { decToString, replayAssetLots } from "../lib/money.js";

/**
 * Rebuilds an asset's derived columns (quantity, average cost, realized P&L)
 * from its own confirmed BUY/SELL ledger.
 *
 * Rule #11 says every number is reconstructed from the transaction ledger, but
 * the writing path used to update these columns incrementally in entry order.
 * The two orders diverge as soon as someone records a transaction with an
 * earlier effective date than one already stored — the wallet ends up holding a
 * different average cost than the same ledger replayed by date, and the live
 * dashboard then disagrees with the analytics report.
 *
 * Replaying in effective-date order (createdAt breaks ties) makes the stored
 * state and the reconstructions identical by construction. It throws if a sale
 * would exceed what was held on that date, which is the correct rejection for a
 * backdated trade.
 */

type TxClient = Pick<typeof prisma, "portfolioTransaction" | "asset">;

export interface AssetRebuildResult {
  assetId: string;
  quantity: string;
  avgCostRial: string;
  realizedPnlRial: string;
}

export async function rebuildAssetFromLedger(
  assetId: string,
  client: TxClient = prisma
): Promise<AssetRebuildResult> {
  const rows = await client.portfolioTransaction.findMany({
    where: {
      assetId,
      status: "CONFIRMED",
      type: { in: ["BUY", "SELL"] },
    },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
  });

  const lots = rows.map((row) => ({
    type: row.type as "BUY" | "SELL",
    quantity: row.quantity,
    priceRial: row.pricePerUnit ?? "0",
    feeRial: row.feeRial,
  }));

  // Same rounding the writer uses, so the stored row matches the replay exactly.
  const state = replayAssetLots(lots, { storedAverageCost: true });
  const realizedPnlRial = state.realizedPnlRial.toFixed(0, Decimal.ROUND_HALF_UP);
  const avgCostRial = state.quantity.gt(0)
    ? state.avgCostRial.toFixed(0, Decimal.ROUND_HALF_UP)
    : "0";

  await client.asset.update({
    where: { id: assetId },
    data: {
      quantity: decToString(state.quantity),
      avgCost: avgCostRial,
      realizedPnl: realizedPnlRial,
    },
  });

  return {
    assetId,
    quantity: decToString(state.quantity),
    avgCostRial,
    realizedPnlRial,
  };
}

/** Rebuilds every asset; used once to realign data written before this rule. */
export async function rebuildAllAssets(): Promise<AssetRebuildResult[]> {
  const assets = await prisma.asset.findMany({ select: { id: true } });
  const results: AssetRebuildResult[] = [];
  for (const asset of assets) {
    results.push(await rebuildAssetFromLedger(asset.id));
  }
  return results;
}
