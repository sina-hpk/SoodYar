import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  calculateNav,
  calculateNavPerUnit,
  issueUnits,
  redeemUnits,
  calculateMemberValue,
  calculateOwnershipPercent,
  assetMarketValue,
  updatedAvgCost,
  replayAssetLots,
  unrealizedPnl,
  returnPercent,
  allocationPercent,
  memberCategoryExposure,
  xirr,
} from "./money.js";

describe("calculateNav (rule #2)", () => {
  it("computes cash + assets - liabilities", () => {
    expect(calculateNav({
      cashBalanceRial: 100_000_000n,
      totalMarketValueOfAssetsRial: 50_000_000n,
      liabilitiesRial: 20_000_000n,
    })).toBe(130_000_000n);
  });

  it("defaults liabilities to zero", () => {
    expect(calculateNav({
      cashBalanceRial: 10n,
      totalMarketValueOfAssetsRial: 5n,
    })).toBe(15n);
  });

  it("accepts string/number inputs and rounds to integer rial", () => {
    expect(calculateNav({
      cashBalanceRial: "1000000",
      totalMarketValueOfAssetsRial: 2000000.4,
      liabilitiesRial: 0,
    })).toBe(3_000_000n);
  });
});

describe("calculateNavPerUnit (rules #3 & #8)", () => {
  it("divides nav by active units", () => {
    const nav = calculateNavPerUnit(200_000_000n, "100", 1_000_000n);
    expect(nav.toFixed(8)).toBe("2000000.00000000");
  });

  it("falls back to default when there are no units", () => {
    const nav = calculateNavPerUnit(0n, "0", 1_000_000n);
    expect(nav.toFixed(8)).toBe("1000000.00000000");
  });

  it("falls back to default when units are negative/invalid", () => {
    const nav = calculateNavPerUnit(999n, "-5", 1_000_000n);
    expect(nav.toFixed(8)).toBe("1000000.00000000");
  });

  it("keeps 8 decimal precision", () => {
    // 1,000,000 rial over 3 units => 333333.33333333
    const nav = calculateNavPerUnit(1_000_000n, "3", 1_000_000n);
    expect(nav.toFixed(8)).toBe("333333.33333333");
  });
});

describe("issueUnits (rule #4)", () => {
  it("issues deposit / navPerUnit units", () => {
    const units = issueUnits(10_000_000n, "1000000");
    expect(units.toFixed(8)).toBe("10.00000000");
  });

  it("handles fractional unit issuance with 8 dp (rounds down)", () => {
    // 1,000,000 / 333333.33333333 ~= 3.00000000 -> rounded down
    const units = issueUnits(1_000_000n, "333333.33333333");
    expect(units.toFixed(8)).toBe("3.00000000");
  });

  it("throws for non-positive navPerUnit", () => {
    expect(() => issueUnits(1000n, "0")).toThrow();
  });

  it("never issues more value than deposited (round down)", () => {
    const units = issueUnits(100n, "3");
    // 100/3 = 33.33333333... rounded down
    expect(units.toFixed(8)).toBe("33.33333333");
    expect(units.mul(3).lte(100)).toBe(true);
  });
});

describe("redeemUnits (rule #5)", () => {
  it("computes redeemedUnits * navPerUnit in integer rial", () => {
    expect(redeemUnits("5", "1000000")).toBe(5_000_000n);
  });

  it("rounds to nearest rial", () => {
    // 1.23456789 * 1000000 = 1234567.89 -> 1234568
    expect(redeemUnits("1.23456789", "1000000")).toBe(1_234_568n);
  });

  it("throws for negative units", () => {
    expect(() => redeemUnits("-1", "1000000")).toThrow();
  });
});

describe("calculateMemberValue (rule #6)", () => {
  it("computes activeUnits * currentNavPerUnit", () => {
    expect(calculateMemberValue("10", "1500000")).toBe(15_000_000n);
  });

  it("handles decimals and rounds to rial (half-up)", () => {
    // 2.5 * 1,000,001 = 2,500,002.5 -> rounds half-up to 2,500,003
    expect(calculateMemberValue("2.5", "1000001")).toBe(2_500_003n);
  });
});

describe("calculateOwnershipPercent (rule #7)", () => {
  it("computes percent of total units", () => {
    expect(calculateOwnershipPercent("25", "100").toString()).toBe("25");
  });

  it("returns zero when no total units", () => {
    expect(calculateOwnershipPercent("5", "0").toString()).toBe("0");
  });

  it("sums to ~100 across members", () => {
    const total = new Decimal(100);
    const a = calculateOwnershipPercent("30", total);
    const b = calculateOwnershipPercent("45", total);
    const c = calculateOwnershipPercent("25", total);
    expect(a.add(b).add(c).toString()).toBe("100");
  });
});

describe("assetMarketValue", () => {
  it("multiplies quantity by price", () => {
    expect(assetMarketValue("10", 2_000_000n)).toBe(20_000_000n);
  });
  it("supports fractional quantity", () => {
    expect(assetMarketValue("1.5", 1_000_000n)).toBe(1_500_000n);
  });
});

describe("updatedAvgCost (weighted average)", () => {
  it("computes weighted average when adding to a position", () => {
    // start: 10 @ 1,000,000 ; buy 10 @ 2,000,000 => avg 1,500,000
    expect(updatedAvgCost("10", 1_000_000n, "10", 2_000_000n)).toBe(1_500_000n);
  });

  it("returns buy price when starting from zero", () => {
    expect(updatedAvgCost("0", 0n, "5", 1_234_000n)).toBe(1_234_000n);
  });
});

describe("replayAssetLots (weighted average cost + realized P&L)", () => {
  it("computes weighted average cost after multiple buys (fee in basis)", () => {
    // buy 10 @ 1,000,000 (+0 fee) then 10 @ 2,000,000 (+0 fee) => avg 1,500,000
    const s = replayAssetLots([
      { type: "BUY", quantity: "10", priceRial: 1_000_000n },
      { type: "BUY", quantity: "10", priceRial: 2_000_000n },
    ]);
    expect(s.quantity.toFixed(8)).toBe("20.00000000");
    expect(s.avgCostRial.toFixed(0)).toBe("1500000");
    expect(s.remainingCostBasisRial.toFixed(0)).toBe("30000000");
    expect(s.realizedPnlRial.toFixed(0)).toBe("0");
  });

  it("folds buy fee into the cost basis", () => {
    // 10 @ 1,000,000 + 500,000 fee => basis 10,500,000 ; avg 1,050,000
    const s = replayAssetLots([
      { type: "BUY", quantity: "10", priceRial: 1_000_000n, feeRial: 500_000n },
    ]);
    expect(s.avgCostRial.toFixed(0)).toBe("1050000");
    expect(s.remainingCostBasisRial.toFixed(0)).toBe("10500000");
  });

  it("realizes P&L on a partial sell using average cost, fee reduces proceeds", () => {
    // buy 10 @ 1,000,000 (basis 10,000,000, avg 1,000,000)
    // sell 4 @ 1,500,000 with 200,000 fee:
    //   proceeds = 6,000,000 - 200,000 = 5,800,000
    //   cost of sold = 4 * 1,000,000 = 4,000,000
    //   realized = 1,800,000 ; remaining qty 6, basis 6,000,000
    const s = replayAssetLots([
      { type: "BUY", quantity: "10", priceRial: 1_000_000n },
      { type: "SELL", quantity: "4", priceRial: 1_500_000n, feeRial: 200_000n },
    ]);
    expect(s.realizedPnlRial.toFixed(0)).toBe("1800000");
    expect(s.quantity.toFixed(8)).toBe("6.00000000");
    expect(s.remainingCostBasisRial.toFixed(0)).toBe("6000000");
    expect(s.avgCostRial.toFixed(0)).toBe("1000000");
  });

  it("clears basis when the position is fully closed and preserves realized P&L", () => {
    const s = replayAssetLots([
      { type: "BUY", quantity: "5", priceRial: 1_000_000n },
      { type: "SELL", quantity: "5", priceRial: 1_200_000n },
    ]);
    expect(s.quantity.toFixed(8)).toBe("0.00000000");
    expect(s.remainingCostBasisRial.toFixed(0)).toBe("0");
    expect(s.realizedPnlRial.toFixed(0)).toBe("1000000");
  });

  it("throws when selling more than held (no short positions)", () => {
    expect(() =>
      replayAssetLots([
        { type: "BUY", quantity: "5", priceRial: 1_000_000n },
        { type: "SELL", quantity: "6", priceRial: 1_000_000n },
      ])
    ).toThrow();
  });
});

describe("unrealizedPnl", () => {
  it("is market value minus remaining cost basis", () => {
    expect(unrealizedPnl(12_000_000n, "10000000")).toBe(2_000_000n);
  });
  it("can be negative", () => {
    expect(unrealizedPnl(8_000_000n, "10000000")).toBe(-2_000_000n);
  });
});

describe("returnPercent (divide-by-zero guard)", () => {
  it("computes value/basis*100", () => {
    expect(returnPercent("2000000", "10000000")?.toFixed(2)).toBe("20.00");
  });
  it("returns null for zero basis", () => {
    expect(returnPercent("500", "0")).toBeNull();
  });
});

describe("allocationPercent (divide-by-zero guard)", () => {
  it("computes category share of total NAV", () => {
    expect(allocationPercent(400_000_000n, 1_000_000_000n)?.toFixed(2)).toBe("40.00");
  });
  it("returns null when total NAV is zero", () => {
    expect(allocationPercent(100n, 0n)).toBeNull();
  });
});

describe("memberCategoryExposure", () => {
  it("scales category value by ownership percent", () => {
    // 10% ownership of a 400,000,000 crypto bucket => 40,000,000
    expect(memberCategoryExposure("10", 400_000_000n)).toBe(40_000_000n);
  });
  it("is zero for zero ownership", () => {
    expect(memberCategoryExposure("0", 400_000_000n)).toBe(0n);
  });
});

describe("member joining after prior profit gets no free gain", () => {
  it("new member's units reflect the appreciated NAV, not the original", () => {
    const defaultNav = 1_000_000n;
    let cash = 0n;
    let totalUnits = new Decimal(0);

    // Member A deposits 10,000,000 at NAV 1,000,000 -> 10 units.
    let navPerUnit = calculateNavPerUnit(
      calculateNav({ cashBalanceRial: cash, totalMarketValueOfAssetsRial: 0n }),
      totalUnits,
      defaultNav
    );
    const unitsA = issueUnits(10_000_000n, navPerUnit);
    cash += 10_000_000n;
    totalUnits = totalUnits.add(unitsA);

    // Assets double in value: NAV per unit becomes 2,000,000.
    navPerUnit = calculateNavPerUnit(
      calculateNav({ cashBalanceRial: cash, totalMarketValueOfAssetsRial: 10_000_000n }),
      totalUnits,
      defaultNav
    );
    expect(navPerUnit.toFixed(8)).toBe("2000000.00000000");

    // Member B now deposits 10,000,000 -> only 5 units at the higher NAV.
    const unitsB = issueUnits(10_000_000n, navPerUnit);
    expect(unitsB.toFixed(8)).toBe("5.00000000");

    // Member B's value equals exactly what they contributed (no free profit).
    expect(calculateMemberValue(unitsB, navPerUnit)).toBe(10_000_000n);
    // Member A retains the full gain: 10 units * 2,000,000 = 20,000,000.
    expect(calculateMemberValue(unitsA, navPerUnit)).toBe(20_000_000n);
  });
});

describe("xirr (money-weighted return)", () => {
  it("returns ~ the simple rate for a one-year round trip", () => {
    // invest -1,000,000 on day 0, receive +1,100,000 one year later => ~10%
    const r = xirr([
      { date: new Date("2024-01-01"), amountRial: -1_000_000 },
      { date: new Date("2025-01-01"), amountRial: 1_100_000 },
    ]);
    expect(r).not.toBeNull();
    expect(Math.abs((r as number) - 0.1)).toBeLessThan(0.005);
  });

  it("returns null without a sign change (no outflow)", () => {
    expect(
      xirr([
        { date: new Date("2024-01-01"), amountRial: 1_000_000 },
        { date: new Date("2025-01-01"), amountRial: 1_100_000 },
      ])
    ).toBeNull();
  });
});

describe("full unit/NAV lifecycle (rule #11 reconstruction)", () => {
  it("keeps NAV per unit stable when depositing at current NAV", () => {
    // Portfolio starts empty. First deposit at default NAV of 1,000,000.
    const defaultNav = 1_000_000n;
    let cash = 0n;
    let totalUnits = new Decimal(0);

    // Member A deposits 10,000,000 rial.
    let navPerUnit = calculateNavPerUnit(
      calculateNav({ cashBalanceRial: cash, totalMarketValueOfAssetsRial: 0n }),
      totalUnits,
      defaultNav
    );
    const unitsA = issueUnits(10_000_000n, navPerUnit);
    cash += 10_000_000n;
    totalUnits = totalUnits.add(unitsA);
    expect(unitsA.toFixed(8)).toBe("10.00000000");

    // NAV per unit should still be 1,000,000 (no gains yet).
    navPerUnit = calculateNavPerUnit(
      calculateNav({ cashBalanceRial: cash, totalMarketValueOfAssetsRial: 0n }),
      totalUnits,
      defaultNav
    );
    expect(navPerUnit.toFixed(8)).toBe("1000000.00000000");

    // Member B deposits 5,000,000 rial at same NAV.
    const unitsB = issueUnits(5_000_000n, navPerUnit);
    cash += 5_000_000n;
    totalUnits = totalUnits.add(unitsB);
    expect(unitsB.toFixed(8)).toBe("5.00000000");
    expect(totalUnits.toFixed(8)).toBe("15.00000000");

    // Assets appreciate by 15,000,000 (portfolio value doubles).
    const nav = calculateNav({
      cashBalanceRial: cash,
      totalMarketValueOfAssetsRial: 15_000_000n,
    });
    navPerUnit = calculateNavPerUnit(nav, totalUnits, defaultNav);
    // (15,000,000 + 15,000,000) / 15 units = 2,000,000 per unit.
    expect(navPerUnit.toFixed(8)).toBe("2000000.00000000");

    // Member A's value should be 10 units * 2,000,000 = 20,000,000.
    expect(calculateMemberValue(unitsA, navPerUnit)).toBe(20_000_000n);

    // Ownership: A owns 10/15, B owns 5/15.
    expect(calculateOwnershipPercent(unitsA, totalUnits).toFixed(2)).toBe("66.67");
    expect(calculateOwnershipPercent(unitsB, totalUnits).toFixed(2)).toBe("33.33");
  });
});
