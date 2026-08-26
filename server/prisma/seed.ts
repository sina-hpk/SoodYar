import { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import {
  calculateNav,
  calculateNavPerUnit,
  issueUnits,
  decToString,
  assetMarketValue,
} from "../src/lib/money.js";

Decimal.set({ precision: 40 });

const prisma = new PrismaClient();

/**
 * Seeds a realistic starting dataset:
 *  - 3 members with staggered deposits at different NAV levels
 *  - a few assets, buys, and daily prices
 *  - NAV snapshots so charts have history
 *
 * The seed replays operations through the same finance functions the app uses,
 * so the ledger is internally consistent (rule #11).
 */

const DEFAULT_NAV = 1_000_000n; // rial

function iso(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00.000Z");
}

async function reset() {
  await prisma.auditLog.deleteMany();
  await prisma.navSnapshot.deleteMany();
  await prisma.priceSnapshot.deleteMany();
  await prisma.portfolioTransaction.deleteMany();
  await prisma.memberTransaction.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.member.deleteMany();
  await prisma.appSetting.deleteMany();
}

// In-memory running state mirroring services, used only to compute NAV during seeding.
let cash = 0n;
let totalUnits = new Decimal(0);
const assetState = new Map<
  string,
  { qty: Decimal; avg: bigint; price: bigint; realized: bigint }
>();

function currentAssetsValue(): bigint {
  let v = 0n;
  for (const a of assetState.values()) {
    if (a.qty.gt(0)) v += assetMarketValue(a.qty, a.price);
  }
  return v;
}

function currentNavPerUnit(): Decimal {
  const nav = calculateNav({
    cashBalanceRial: cash,
    totalMarketValueOfAssetsRial: currentAssetsValue(),
  });
  return calculateNavPerUnit(nav, totalUnits, DEFAULT_NAV);
}

async function deposit(memberId: string, amount: bigint, date: string) {
  const nav = currentNavPerUnit();
  const units = issueUnits(amount, nav);
  await prisma.memberTransaction.create({
    data: {
      memberId,
      type: "DEPOSIT",
      status: "CONFIRMED",
      amountRial: amount,
      units: "0",
      navPerUnit: decToString(nav),
      effectiveDate: iso(date),
    },
  });
  await prisma.memberTransaction.create({
    data: {
      memberId,
      type: "UNIT_ISSUANCE",
      status: "CONFIRMED",
      amountRial: amount,
      units: decToString(units),
      navPerUnit: decToString(nav),
      effectiveDate: iso(date),
    },
  });
  await prisma.portfolioTransaction.create({
    data: {
      type: "CASH_ADJUSTMENT",
      status: "CONFIRMED",
      cashDeltaRial: amount,
      effectiveDate: iso(date),
      description: "واریز عضو (seed)",
    },
  });
  cash += amount;
  totalUnits = totalUnits.add(units);
  console.log(
    `  + deposit ${amount} rial @ nav ${decToString(nav)} -> ${decToString(units)} units`
  );
}

async function buy(
  assetId: string,
  qty: string,
  priceRial: bigint,
  date: string,
  feeRial: bigint = 0n
) {
  const st = assetState.get(assetId)!;
  const buyQty = new Decimal(qty);
  const gross = assetMarketValue(buyQty, priceRial);
  // Fee-inclusive weighted average cost.
  const oldBasis = st.qty.mul(new Decimal(st.avg.toString()));
  const addedBasis = new Decimal(gross.toString()).add(feeRial.toString());
  const newQty = st.qty.add(buyQty);
  const newAvg = newQty.lte(0)
    ? 0n
    : BigInt(oldBasis.add(addedBasis).div(newQty).toFixed(0));
  st.qty = newQty;
  st.avg = newAvg;
  st.price = priceRial;
  cash -= gross + feeRial;
  await prisma.portfolioTransaction.create({
    data: {
      type: "BUY",
      status: "CONFIRMED",
      assetId,
      quantity: qty,
      pricePerUnit: priceRial.toString(),
      feeRial,
      realizedPnlRial: 0n,
      cashDeltaRial: -(gross + feeRial),
      effectiveDate: iso(date),
      description: "خرید دارایی (seed)",
    },
  });
  await prisma.asset.update({
    where: { id: assetId },
    data: { quantity: decToString(st.qty), avgCost: st.avg.toString() },
  });
}

async function sell(
  assetId: string,
  qty: string,
  priceRial: bigint,
  date: string,
  feeRial: bigint = 0n
) {
  const st = assetState.get(assetId)!;
  const sellQty = new Decimal(qty);
  const gross = assetMarketValue(sellQty, priceRial);
  const avg = new Decimal(st.avg.toString());
  const costOfSold = avg.mul(sellQty);
  const proceeds = new Decimal(gross.toString()).sub(feeRial.toString());
  const realized = BigInt(proceeds.sub(costOfSold).toFixed(0));
  st.qty = st.qty.sub(sellQty);
  st.realized += realized;
  if (st.qty.lte(0)) {
    st.qty = new Decimal(0);
    st.avg = 0n;
  }
  st.price = priceRial;
  cash += gross - feeRial;
  await prisma.portfolioTransaction.create({
    data: {
      type: "SELL",
      status: "CONFIRMED",
      assetId,
      quantity: qty,
      pricePerUnit: priceRial.toString(),
      feeRial,
      realizedPnlRial: realized,
      cashDeltaRial: gross - feeRial,
      effectiveDate: iso(date),
      description: "فروش دارایی (seed)",
    },
  });
  await prisma.asset.update({
    where: { id: assetId },
    data: {
      quantity: decToString(st.qty),
      avgCost: st.avg.toString(),
      realizedPnl: st.realized.toString(),
    },
  });
}

async function price(assetId: string, priceRial: bigint, date: string) {
  await prisma.priceSnapshot.create({
    data: {
      assetId,
      priceRial: priceRial.toString(),
      priceDate: iso(date),
      source: "MANUAL",
    },
  });
  const st = assetState.get(assetId);
  if (st) st.price = priceRial;
}

async function navSnapshot(date: string) {
  const assetsValue = currentAssetsValue();
  const nav = calculateNav({
    cashBalanceRial: cash,
    totalMarketValueOfAssetsRial: assetsValue,
  });
  const navPer = calculateNavPerUnit(nav, totalUnits, DEFAULT_NAV);
  await prisma.navSnapshot.create({
    data: {
      navDate: iso(date),
      cashBalanceRial: cash,
      assetsValueRial: assetsValue,
      liabilitiesRial: 0n,
      totalNavRial: nav,
      totalActiveUnits: decToString(totalUnits),
      navPerUnit: decToString(navPer),
      note: "seed snapshot",
    },
  });
  console.log(`  * NAV @ ${date}: total=${nav} perUnit=${decToString(navPer)}`);
}

async function main() {
  console.log("Resetting database...");
  await reset();

  console.log("Settings...");
  await prisma.appSetting.createMany({
    data: [
      { key: "default_nav_per_unit", value: "1000000" },
      { key: "currency", value: "RIAL" },
      { key: "withdrawal_wait_days", value: "3" },
      { key: "backup_enabled", value: "true" },
    ],
  });

  console.log("Members...");
  const ali = await prisma.member.create({
    data: { fullName: "عضو نمونه ۱", phone: "09120000001", joinDate: iso("2024-04-03"), status: "ACTIVE" },
  });
  const sara = await prisma.member.create({
    data: { fullName: "عضو نمونه ۲", phone: "09120000002", joinDate: iso("2024-05-10"), status: "ACTIVE" },
  });
  const reza = await prisma.member.create({
    data: { fullName: "عضو نمونه ۳", phone: "09120000003", joinDate: iso("2024-06-20"), status: "ACTIVE" },
  });

  console.log("Assets...");
  const gold = await prisma.asset.create({
    data: { symbol: "GOLD18", name: "طلای ۱۸ عیار (گرم)", assetClass: "GOLD" },
  });
  const shasta = await prisma.asset.create({
    data: { symbol: "SHASTA", name: "سهام شستا", assetClass: "STOCK" },
  });
  const btc = await prisma.asset.create({
    data: { symbol: "BTC", name: "بیت‌کوین", assetClass: "CRYPTO" },
  });
  const etf = await prisma.asset.create({
    data: { symbol: "AGAH", name: "صندوق آگاه (ETF)", assetClass: "ETF" },
  });
  for (const a of [gold, shasta, btc, etf]) {
    assetState.set(a.id, { qty: new Decimal(0), avg: 0n, price: 0n, realized: 0n });
  }

  console.log("Ledger replay...");
  // Member 1 deposits at inception (NAV = default 1,000,000).
  await deposit(ali.id, 100_000_000n, "2024-04-03");

  // Buy some gold and stock (with small buy fees folded into cost basis).
  await buy(gold.id, "20", 3_000_000n, "2024-04-05", 300_000n); // 60,000,000 + fee
  await buy(shasta.id, "5000", 6_000n, "2024-04-06", 150_000n); // 30,000,000 + fee

  // Prices tick up; member 2 joins at a higher NAV.
  await price(gold.id, 3_200_000n, "2024-05-09");
  await price(shasta.id, 6_500n, "2024-05-09");
  await navSnapshot("2024-05-09");
  await deposit(sara.id, 60_000_000n, "2024-05-10");

  // More buying, more price movement, member 3 joins.
  await buy(btc.id, "0.05", 2_000_000_000n, "2024-06-01", 500_000n); // 100,000,000 + fee
  await buy(etf.id, "10000", 2_000n, "2024-06-02", 100_000n); // 20,000,000 + fee
  await price(gold.id, 3_500_000n, "2024-06-19");
  await price(shasta.id, 7_000n, "2024-06-19");
  await price(btc.id, 2_400_000_000n, "2024-06-19");
  await price(etf.id, 2_100n, "2024-06-19");
  await navSnapshot("2024-06-19");
  await deposit(reza.id, 80_000_000n, "2024-06-20");

  // Partial sell of stock to realize some profit.
  await sell(shasta.id, "2000", 7_200n, "2024-06-25", 120_000n);

  // A dividend and a fee.
  await prisma.portfolioTransaction.create({
    data: {
      type: "DIVIDEND",
      status: "CONFIRMED",
      assetId: shasta.id,
      cashDeltaRial: 3_000_000n,
      effectiveDate: iso("2024-07-01"),
      description: "سود نقدی شستا (seed)",
    },
  });
  cash += 3_000_000n;
  await prisma.portfolioTransaction.create({
    data: {
      type: "FEE",
      status: "CONFIRMED",
      cashDeltaRial: -500_000n,
      effectiveDate: iso("2024-07-01"),
      description: "کارمزد کارگزاری (seed)",
    },
  });
  cash -= 500_000n;

  // Latest prices + final snapshot.
  await price(gold.id, 3_800_000n, "2024-08-01");
  await price(shasta.id, 7_500n, "2024-08-01");
  await price(btc.id, 2_600_000_000n, "2024-08-01");
  await price(etf.id, 2_250n, "2024-08-01");
  await navSnapshot("2024-08-01");

  // A pending withdrawal request for member 2 to show Pending state in UI.
  const nav = currentNavPerUnit();
  await prisma.memberTransaction.create({
    data: {
      memberId: sara.id,
      type: "WITHDRAWAL_REQUEST",
      status: "PENDING",
      amountRial: 10_000_000n,
      units: decToString(new Decimal("10000000").div(nav)),
      navPerUnit: decToString(nav),
      effectiveDate: iso("2024-08-05"),
      description: "درخواست برداشت (seed)",
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
