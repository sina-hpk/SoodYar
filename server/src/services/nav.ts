import { prisma } from "../db.js";
import { getPortfolioState } from "./portfolio.js";
import { decToString } from "../lib/money.js";
import { audit } from "./audit.js";
import { bigintReplacer } from "./audit.js";

/**
 * NAV snapshotting. A preview computes NAV from current state without writing.
 * Committing writes a dated NavSnapshot; there is at most one per day
 * (rule: prevent duplicate same-day snapshots unless explicitly overwritten).
 */

export async function previewNav() {
  const state = await getPortfolioState();
  return {
    cashBalanceRial: state.cashBalanceRial.toString(),
    assetsValueRial: state.assetsValueRial.toString(),
    liabilitiesRial: state.liabilitiesRial.toString(),
    totalNavRial: state.totalNavRial.toString(),
    totalActiveUnits: decToString(state.totalActiveUnits),
    navPerUnit: decToString(state.navPerUnit),
    activeMemberCount: state.activeMemberCount,
    assets: state.assets,
    categories: state.categories,
  };
}

export async function commitNavSnapshot(navDate: Date, options: {
  liabilitiesRial?: bigint;
  note?: string;
  overwrite?: boolean;
}) {
  const existing = await prisma.navSnapshot.findUnique({ where: { navDate } });
  if (existing && !options.overwrite) {
    throw new Error(
      "برای این تاریخ قبلاً NAV ثبت شده است. برای بازنویسی، تأیید صریح لازم است."
    );
  }

  const state = await getPortfolioState();
  const liabilities = options.liabilitiesRial ?? state.liabilitiesRial;
  const totalNav = state.cashBalanceRial + state.assetsValueRial - liabilities;

  const breakdown = JSON.stringify(
    {
      cash: state.cashBalanceRial,
      assets: state.assets
        .filter((a) => BigInt(a.marketValueRial) > 0n)
        .map((a) => ({
          symbol: a.symbol,
          assetClass: a.assetClass,
          quantity: a.quantity,
          priceRial: a.latestPriceRial,
          marketValueRial: a.marketValueRial,
          unrealizedPnlRial: a.unrealizedPnlRial,
        })),
      categories: state.categories,
      liabilities,
    },
    bigintReplacer
  );

  const data = {
    navDate,
    cashBalanceRial: state.cashBalanceRial,
    assetsValueRial: state.assetsValueRial,
    liabilitiesRial: liabilities,
    totalNavRial: totalNav,
    totalActiveUnits: decToString(state.totalActiveUnits),
    navPerUnit: decToString(state.navPerUnit),
    breakdown,
    note: options.note,
  };

  const snap = existing
    ? await prisma.navSnapshot.update({ where: { navDate }, data })
    : await prisma.navSnapshot.create({ data });

  await audit("NAV_SNAPSHOT", "NavSnapshot", snap.id, {
    navDate: navDate.toISOString(),
    totalNavRial: totalNav,
    navPerUnit: decToString(state.navPerUnit),
    overwrite: !!existing,
  });
  return snap;
}

export async function listNavSnapshots(from?: Date, to?: Date) {
  return prisma.navSnapshot.findMany({
    where: {
      navDate: {
        gte: from,
        lte: to,
      },
    },
    orderBy: { navDate: "asc" },
  });
}
