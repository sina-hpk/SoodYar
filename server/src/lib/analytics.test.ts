import { describe, expect, it } from "vitest";
import {
  benchmarkCounterfactual,
  calculateActualProfit,
  calculateAssetContributions,
  pointReturnPercent,
  realReturnPercent,
  replayBoundary,
  resolvePriceAtOrBefore,
  type ReplayPortfolioTx,
} from "./analytics.js";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("analytics profit formulas", () => {
  it("computes authoritative inception profit", () => {
    expect(calculateActualProfit(1_500n, 1_200n, 100n)).toBe(400n);
  });

  it("computes point-to-point NAV/unit return", () => {
    expect(pointReturnPercent("1000", "1250")).toBe("25");
    expect(pointReturnPercent("0", "1250")).toBeNull();
  });
});

describe("benchmark counterfactual", () => {
  const prices = [
    { date: date("2025-01-01"), priceRial: 100n },
    { date: date("2025-01-10"), priceRial: 200n },
    { date: date("2025-01-20"), priceRial: 250n },
  ];

  it("processes multi-date deposits and a withdrawal", () => {
    const result = benchmarkCounterfactual(
      [
        { date: date("2025-01-01"), type: "DEPOSIT", amountRial: 1_000n },
        { date: date("2025-01-10"), type: "DEPOSIT", amountRial: 1_000n },
        {
          date: date("2025-01-20"),
          type: "WITHDRAWAL_SETTLEMENT",
          amountRial: 500n,
        },
      ],
      prices,
      date("2025-01-20")
    );
    expect(result.status).toBe("EXACT");
    expect(result.endingUnits).toBe("13");
    expect(result.endingValueRial).toBe("3250");
    expect(result.profitRial).toBe("1750");
    expect(result.solvency).toBe(true);
  });

  it("resolves only exact or previous prices and never a future price", () => {
    expect(resolvePriceAtOrBefore(prices, date("2025-01-05"))).toMatchObject({
      priceRial: 100n,
      resolution: "PREVIOUS",
      gapDays: 4,
    });
    expect(resolvePriceAtOrBefore(prices, date("2024-12-31"))).toBeNull();
    const missing = benchmarkCounterfactual(
      [{ date: date("2024-12-31"), type: "DEPOSIT", amountRial: 1_000n }],
      prices,
      date("2025-01-10")
    );
    expect(missing.status).toBe("MISSING");
    expect(missing.missingFlowDates).toContain("2024-12-31");
  });

  it("marks a benchmark insolvent when withdrawal needs too many units", () => {
    const result = benchmarkCounterfactual(
      [
        { date: date("2025-01-01"), type: "DEPOSIT", amountRial: 100n },
        {
          date: date("2025-01-10"),
          type: "WITHDRAWAL_SETTLEMENT",
          amountRial: 500n,
        },
      ],
      prices,
      date("2025-01-20")
    );
    expect(result.status).toBe("PARTIAL");
    expect(result.solvency).toBe(false);
    expect(result.endingUnits).toBe("0");
  });
});

describe("real (inflation-adjusted) return", () => {
  it("subtracts inflation from a nominal return", () => {
    // 40% nominal against 25% inflation leaves 12% of real gain.
    expect(realReturnPercent("40", "25")).toBe("12");
  });

  it("turns a below-inflation return negative", () => {
    const value = realReturnPercent("10", "30");
    expect(value).not.toBeNull();
    expect(Number(value)).toBeLessThan(0);
  });

  it("returns null when either side is unknown or undefined math", () => {
    expect(realReturnPercent(null, "25")).toBeNull();
    expect(realReturnPercent("10", null)).toBeNull();
    expect(realReturnPercent("10", "-100")).toBeNull();
  });
});

describe("as-of asset replay and reconciliation", () => {
  const assets = [{ id: "asset-1", symbol: "SYN", name: "Synthetic", assetClass: "OTHER" }];
  const memberTxs = [
    {
      type: "UNIT_ISSUANCE",
      status: "CONFIRMED",
      units: "10",
      effectiveDate: date("2025-01-01"),
    },
  ];
  const txs: ReplayPortfolioTx[] = [
    {
      type: "CASH_ADJUSTMENT",
      status: "CONFIRMED",
      assetId: null,
      quantity: "0",
      pricePerUnit: "0",
      feeRial: 0n,
      cashDeltaRial: 1_000n,
      effectiveDate: date("2025-01-01"),
    },
    {
      type: "BUY",
      status: "CONFIRMED",
      assetId: "asset-1",
      quantity: "5",
      pricePerUnit: "100",
      feeRial: 0n,
      cashDeltaRial: -500n,
      effectiveDate: date("2025-01-02"),
    },
  ];
  const prices = [
    { assetId: "asset-1", priceRial: "100", priceDate: date("2025-01-02") },
    { assetId: "asset-1", priceRial: "120", priceDate: date("2025-01-10") },
  ];

  it("uses only boundary prices, links asset cash and reconciles residual", () => {
    const start = replayBoundary({
      date: date("2025-01-02"),
      assets,
      portfolioTxs: txs,
      memberTxs,
      prices,
      defaultNavPerUnitRial: 100n,
    });
    const end = replayBoundary({
      date: date("2025-01-10"),
      assets,
      portfolioTxs: txs,
      memberTxs,
      prices,
      defaultNavPerUnitRial: 100n,
    });
    expect(start.totalNavRial).toBe(1_000n);
    expect(end.totalNavRial).toBe(1_100n);
    expect(end.assets[0].valuationStatus).toBe("MARKET");

    const result = calculateAssetContributions({
      startAssets: start.assets,
      endAssets: end.assets,
      rangeTransactions: [],
      actualProfitRial: 100n,
    });
    expect(result.assets[0].profitContributionRial).toBe("100");
    expect(result.assets[0].realizedPnlRial).toBe("0");
    expect(result.assets[0].unrealizedPnlRial).toBe("100");
    expect(result.unattributedCashProfitRial).toBe(0n);
  });

  it("marks a holding at cost when no past price exists", () => {
    const replay = replayBoundary({
      date: date("2025-01-02"),
      assets,
      portfolioTxs: txs,
      memberTxs,
      prices: [{ assetId: "asset-1", priceRial: "120", priceDate: date("2025-01-10") }],
      defaultNavPerUnitRial: 100n,
    });
    expect(replay.assets[0].valuationStatus).toBe("AT_COST");
    expect(replay.assets[0].marketValueRial).toBe(500n);
    expect(replay.warnings.join(" ")).toContain("ارزش تمام‌شده");
  });
});
