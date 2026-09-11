import Decimal from "decimal.js";
import { prisma } from "../db.js";
import {
  benchmarkCounterfactual,
  calculateActualProfit,
  calculateAssetContributions,
  calculateRangeProfit,
  dayKey,
  percent,
  pointReturnPercent,
  realReturnPercent,
  replayBoundary,
  resolvePriceAtOrBefore,
  utcDay,
  type ExternalFlow,
} from "../lib/analytics.js";
import { xirr } from "../lib/money.js";
import { BENCHMARKS, ensureBenchmarkInstruments } from "./benchmarks.js";
import { getDefaultNavPerUnit } from "./settings.js";

function ratePercent(rate: number | null): string | null {
  return rate == null ? null : new Decimal(rate).mul(100).toDecimalPlaces(8).toString();
}

/** Below this many days an annualized rate is noise, not a performance figure. */
const MIN_XIRR_PERIOD_DAYS = 90;

export async function getAnalyticsPerformance(requestedFrom?: Date, requestedTo?: Date) {
  const today = utcDay(new Date());
  const earliestDeposit = await prisma.memberTransaction.findFirst({
    where: { type: "DEPOSIT", status: "CONFIRMED" },
    orderBy: { effectiveDate: "asc" },
    select: { effectiveDate: true },
  });
  const from = utcDay(requestedFrom ?? earliestDeposit?.effectiveDate ?? today);
  const to = utcDay(requestedTo ?? today);
  if (from > to) throw new Error("from نباید بعد از to باشد.");
  if (to > today) throw new Error("to نباید بعد از امروز باشد.");
  const isInception = earliestDeposit
    ? from.getTime() === utcDay(earliestDeposit.effectiveDate).getTime()
    : true;

  const [assets, portfolioTxs, memberTxs, prices, defaultNav, navSnapshots] =
    await Promise.all([
      prisma.asset.findMany({ orderBy: { symbol: "asc" } }),
      prisma.portfolioTransaction.findMany({ orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] }),
      prisma.memberTransaction.findMany({ orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] }),
      prisma.priceSnapshot.findMany({ orderBy: { priceDate: "asc" } }),
      getDefaultNavPerUnit(),
      prisma.navSnapshot.findMany({
        where: { navDate: { gte: from, lte: to } },
        orderBy: { navDate: "asc" },
      }),
    ]);

  const replayInput = {
    assets: assets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
    })),
    portfolioTxs,
    memberTxs,
    prices,
    defaultNavPerUnitRial: defaultNav,
  };
  const start = isInception
    ? {
        ...replayBoundary({ ...replayInput, date: new Date(from.getTime() - 86_400_000) }),
        date: from,
        totalNavRial: 0n,
        navPerUnit: new Decimal(defaultNav.toString()),
      }
    : replayBoundary({ ...replayInput, date: from });
  const end = replayBoundary({ ...replayInput, date: to });
  const periodDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  /**
   * Annualizing anything shorter than a quarter turns a normal move into a
   * three- or four-digit number, which reads as noise rather than performance.
   */
  const xirrIsMeaningful = periodDays >= MIN_XIRR_PERIOD_DAYS;

  const externalFlows: ExternalFlow[] = memberTxs
    .filter(
      (tx) =>
        ((tx.type === "DEPOSIT" && tx.status === "CONFIRMED") ||
          (tx.type === "WITHDRAWAL_SETTLEMENT" && tx.status === "SETTLED")) &&
        utcDay(tx.effectiveDate) <= to
    )
    .map((tx) => ({
      date: utcDay(tx.effectiveDate),
      type: tx.type as ExternalFlow["type"],
      amountRial: tx.amountRial,
    }));
  const rangeFlows = externalFlows.filter((flow) => {
    const time = flow.date.getTime();
    return isInception
      ? time >= from.getTime() && time <= to.getTime()
      : time > from.getTime() && time <= to.getTime();
  });
  const inceptionFlows = externalFlows.filter((flow) => flow.date <= to);
  const deposits = (isInception ? inceptionFlows : rangeFlows)
    .filter((flow) => flow.type === "DEPOSIT")
    .reduce((sum, flow) => sum + flow.amountRial, 0n);
  const withdrawals = (isInception ? inceptionFlows : rangeFlows)
    .filter((flow) => flow.type === "WITHDRAWAL_SETTLEMENT")
    .reduce((sum, flow) => sum + flow.amountRial, 0n);
  const actualProfit =
    end.totalNavRial == null || start.totalNavRial == null
      ? null
      : isInception
        ? calculateActualProfit(end.totalNavRial, deposits, withdrawals)
        : calculateRangeProfit(start.totalNavRial, end.totalNavRial, deposits, withdrawals);

  const rangePortfolioTxs = portfolioTxs.filter(
    (tx) =>
      utcDay(tx.effectiveDate).getTime() > from.getTime() &&
      utcDay(tx.effectiveDate).getTime() <= to.getTime()
  );
  const contribution =
    actualProfit == null
      ? { assets: [], unattributedCashProfitRial: null }
      : {
          ...calculateAssetContributions({
            startAssets: start.assets,
            endAssets: end.assets,
            rangeTransactions: rangePortfolioTxs,
            actualProfitRial: actualProfit,
          }),
        };

  const fundFlows = (isInception ? inceptionFlows : rangeFlows).map((flow) => ({
    date: flow.date,
    amountRial: flow.type === "DEPOSIT" ? -flow.amountRial : flow.amountRial,
  }));
  if (!isInception && start.totalNavRial != null && start.totalNavRial > 0n) {
    fundFlows.unshift({ date: from, amountRial: -start.totalNavRial });
  }
  if (end.totalNavRial != null && end.totalNavRial > 0n) {
    fundFlows.push({ date: to, amountRial: end.totalNavRial });
  }

  await ensureBenchmarkInstruments();

  // Inflation is a published index rather than a price to buy at, so it is
  // resolved once here and reused to deflate every nominal return below.
  const inflationInstrument = BENCHMARKS.find((item) => item.kind === "INDEX");
  let inflationPercent: string | null = null;
  let inflationStart = null as null | ReturnType<typeof resolvePriceAtOrBefore>;
  let inflationEnd = null as null | ReturnType<typeof resolvePriceAtOrBefore>;
  let inflationPointCount = 0;
  let inflationLastDate: string | null = null;
  if (inflationInstrument) {
    const indexPrices = await prisma.benchmarkPrice.findMany({
      where: {
        instrumentKey: inflationInstrument.key,
        qualityStatus: "ACCEPTED",
        priceDate: { lte: to },
      },
      orderBy: { priceDate: "asc" },
    });
    inflationPointCount = indexPrices.length;
    inflationLastDate = indexPrices.length ? dayKey(indexPrices[indexPrices.length - 1].priceDate) : null;
    const datedIndex = indexPrices.map((price) => ({
      date: price.priceDate,
      priceRial: price.priceRial,
    }));
    inflationStart = resolvePriceAtOrBefore(datedIndex, from);
    inflationEnd = resolvePriceAtOrBefore(datedIndex, to);
    inflationPercent =
      inflationStart && inflationEnd
        ? pointReturnPercent(
            inflationStart.priceRial.toString(),
            inflationEnd.priceRial.toString()
          )
        : null;
  }

  const benchmarkRows = [];
  const benchmarkCoverage = [];
  const pricesByKey = new Map<string, Array<{ date: Date; priceRial: bigint }>>();
  /**
   * The scenario for a custom range starts from what the fund was worth at the
   * range's open, as if that capital had gone into the benchmark on day one;
   * otherwise a mid-life range would compare against money that arrived earlier.
   */
  const counterfactualFlows: ExternalFlow[] = isInception
    ? inceptionFlows
    : [
        ...(start.totalNavRial != null && start.totalNavRial > 0n
          ? [{ date: from, type: "DEPOSIT" as const, amountRial: start.totalNavRial }]
          : []),
        ...rangeFlows,
      ];
  for (const benchmark of BENCHMARKS) {
    const dbPrices = await prisma.benchmarkPrice.findMany({
      where: {
        instrumentKey: benchmark.key,
        qualityStatus: "ACCEPTED",
        priceDate: { lte: to },
      },
      orderBy: { priceDate: "asc" },
    });
    const datedPrices = dbPrices.map((price) => ({
      date: price.priceDate,
      priceRial: price.priceRial,
    }));
    pricesByKey.set(benchmark.key, datedPrices);
    const startPrice = resolvePriceAtOrBefore(datedPrices, from);
    const endPrice = resolvePriceAtOrBefore(datedPrices, to);
    // An index (inflation) has no price to buy at, so no counterfactual is built
    // for it; only its point change matters.
    const counterfactual =
      benchmark.kind === "INDEX"
        ? null
        : benchmarkCounterfactual(counterfactualFlows, datedPrices, to);
    const status =
      startPrice && endPrice && (counterfactual == null || counterfactual.status === "EXACT")
        ? "COMPLETE"
        : endPrice || counterfactual?.status === "PARTIAL"
          ? "PARTIAL"
          : "MISSING";
    const pointReturn =
      startPrice && endPrice
        ? pointReturnPercent(startPrice.priceRial.toString(), endPrice.priceRial.toString())
        : null;
    benchmarkRows.push({
      key: benchmark.key,
      name: benchmark.name,
      unit: benchmark.unit,
      status,
      startPriceRial: startPrice?.priceRial.toString() ?? null,
      endPriceRial: endPrice?.priceRial.toString() ?? null,
      pointReturnPercent: pointReturn,
      realPointReturnPercent: realReturnPercent(pointReturn, inflationPercent),
      excessVsFundPercent:
        pointReturn != null && start.navPerUnit && end.navPerUnit
          ? new Decimal(pointReturn)
              .sub(pointReturnPercent(start.navPerUnit, end.navPerUnit) ?? 0)
              .toDecimalPlaces(8)
              .toString()
          : null,
      startResolution: startPrice
        ? { priceDate: dayKey(startPrice.date), resolution: startPrice.resolution, gapDays: startPrice.gapDays }
        : null,
      endResolution: endPrice
        ? { priceDate: dayKey(endPrice.date), resolution: endPrice.resolution, gapDays: endPrice.gapDays }
        : null,
      counterfactual:
        counterfactual == null
          ? null
          : {
              status: counterfactual.status,
              endingUnits: counterfactual.endingUnits,
              endingValueRial: counterfactual.endingValueRial,
              profitRial: counterfactual.profitRial,
              returnPercent: counterfactual.returnPercent,
              // Annualizing a few weeks prints a four-digit number, so it is
              // withheld on short ranges exactly like the fund's own XIRR.
              xirrAnnualizedPercent: xirrIsMeaningful
                ? counterfactual.xirrAnnualizedPercent
                : null,
              solvency:
                counterfactual.solvency === true
                  ? "OK"
                  : counterfactual.solvency === false
                    ? "INSOLVENT_AT_FLOW"
                    : "MISSING_DATA",
              missingFlowDates: counterfactual.missingFlowDates,
            },
    });
    benchmarkCoverage.push({
      key: benchmark.key,
      status,
      firstAcceptedDate: dbPrices[0] ? dayKey(dbPrices[0].priceDate) : null,
      lastAcceptedDate: dbPrices.at(-1) ? dayKey(dbPrices.at(-1)!.priceDate) : null,
      missingFlowDates: counterfactual?.missingFlowDates ?? [],
    });
  }

  /**
   * One point per date that carries anything to compare: every day a benchmark
   * price exists inside the range, every committed NAV snapshot, and the range
   * end. The fund's NAV per unit is replayed as-of each of those dates, so a
   * newly backfilled benchmark history immediately produces a real comparison
   * line instead of a single dot.
   */
  const seriesDates = new Set<string>([dayKey(to)]);
  for (const snapshot of navSnapshots) seriesDates.add(dayKey(snapshot.navDate));
  const fromKey = dayKey(from);
  for (const dated of pricesByKey.values()) {
    for (const price of dated) {
      const key = dayKey(price.date);
      if (key >= fromKey && key <= dayKey(to)) seriesDates.add(key);
    }
  }

  const snapshotNavByDate = new Map(
    navSnapshots.map((snapshot) => [dayKey(snapshot.navDate), snapshot.navPerUnit])
  );
  const orderedDates = [...seriesDates].sort();
  // Each point carries the fund and every benchmark as flat, rebased-to-100
  // fields, which is the shape the chart consumes directly.
  const series: Array<Record<string, string | null>> = [];
  for (const date of orderedDates) {
    const asOf = new Date(`${date}T00:00:00.000Z`);
    let navPerUnit = snapshotNavByDate.get(date) ?? null;
    if (navPerUnit == null) {
      const replay = date === dayKey(to) ? end : replayBoundary({ ...replayInput, date: asOf });
      navPerUnit = replay.navPerUnit ? replay.navPerUnit.toString() : null;
    }
    const point: Record<string, string | null> = {
      date,
      fund:
        navPerUnit && start.navPerUnit
          ? new Decimal(navPerUnit)
              .div(start.navPerUnit)
              .mul(100)
              .toDecimalPlaces(8)
              .toString()
          : null,
    };
    for (const benchmark of benchmarkRows) {
      const resolved = resolvePriceAtOrBefore(pricesByKey.get(benchmark.key) ?? [], asOf);
      point[benchmark.key] =
        resolved && benchmark.startPriceRial
          ? new Decimal(resolved.priceRial.toString())
              .div(benchmark.startPriceRial)
              .mul(100)
              .toDecimalPlaces(8)
              .toString()
          : null;
    }
    series.push(point);
  }

  const warnings = [...start.warnings, ...end.warnings];
  if (navSnapshots.length === 0) {
    warnings.push("هیچ NAV تاریخی ثبت نشده است؛ نقاط مرزی با بازپخش دفترکل محاسبه شدند.");
  }
  if (start.totalNavRial == null || end.totalNavRial == null) {
    warnings.push("NAV یکی از مرزها به‌دلیل پوشش ناقص ارزش‌گذاری قابل محاسبه نیست.");
  }
  for (const item of benchmarkCoverage) {
    if (item.status !== "COMPLETE") warnings.push(`${item.key}: پوشش شاخص ${item.status} است.`);
  }
  if (!xirrIsMeaningful) {
    warnings.push(
      "بازهٔ انتخابی برای سالانه‌سازی کوتاه است؛ فقط بازده نقطه‌به‌نقطه معنا دارد."
    );
  }

  const netInvested = deposits - withdrawals + (isInception ? 0n : start.totalNavRial ?? 0n);
  const navUnitReturn =
    start.navPerUnit && end.navPerUnit
      ? pointReturnPercent(start.navPerUnit, end.navPerUnit)
      : null;
  const inflationStatus =
    inflationPercent != null
      ? "COMPLETE"
      : inflationPointCount > 0
        ? "PARTIAL"
        : "MISSING";
  if (inflationInstrument && inflationStatus !== "COMPLETE") {
    warnings.push(
      inflationStatus === "MISSING"
        ? "برای تورم هیچ نقطهٔ شاخصی ثبت نشده است؛ بازده واقعی محاسبه نمی‌شود."
        : "شاخص تورم در یکی از دو انتهای بازه موجود نیست؛ بازده واقعی محاسبه نمی‌شود."
    );
  }
  return {
    meta: {
      from: dayKey(from),
      to: dayKey(to),
      effectiveFrom: dayKey(from),
      effectiveTo: dayKey(to),
      isInception,
    },
    coverage: {
      // Boundaries always come from an as-of ledger replay; "COMPLETE" means both
      // ends valued, and the warnings explain that no NAV snapshot was involved.
      navStatus: start.totalNavRial != null && end.totalNavRial != null ? "COMPLETE" : "PARTIAL",
      warnings: [...new Set(warnings)],
      benchmarks: benchmarkCoverage,
    },
    fund: {
      profitLabel: isInception ? "INCEPTION_ACTUAL_PROFIT" : "BOUNDARY_REPLAY_PROFIT",
      returnLabel: "NAV_PER_UNIT_POINT_RETURN",
      xirrLabel: "MONEY_WEIGHTED_XIRR_ANNUALIZED",
      startNavRial: start.totalNavRial?.toString() ?? null,
      endNavRial: end.totalNavRial?.toString() ?? null,
      contributionsRial: deposits.toString(),
      withdrawalsRial: withdrawals.toString(),
      actualProfitRial: actualProfit?.toString() ?? null,
      simpleProfitPercent:
        actualProfit == null ? null : percent(actualProfit.toString(), netInvested.toString()),
      startNavPerUnit: start.navPerUnit?.toString() ?? null,
      endNavPerUnit: end.navPerUnit?.toString() ?? null,
      navUnitReturnPercent: navUnitReturn,
      xirrAnnualizedPercent: xirrIsMeaningful ? ratePercent(xirr(fundFlows)) : null,
      xirrNote: xirrIsMeaningful
        ? "بازده سالانه‌شدهٔ پول‌وزن از جریان‌های واقعی سرمایه."
        : "بازهٔ انتخابی برای سالانه‌سازی کوتاه است؛ عدد سالانه نمایش داده نمی‌شود.",
      periodDays,
      realReturnPercent: realReturnPercent(navUnitReturn, inflationPercent),
    },
    inflation: {
      key: inflationInstrument?.key ?? null,
      status: inflationStatus,
      inflationPercent,
      fundRealReturnPercent: realReturnPercent(navUnitReturn, inflationPercent),
      startIndex: inflationStart?.priceRial.toString() ?? null,
      endIndex: inflationEnd?.priceRial.toString() ?? null,
      startDate: inflationStart ? dayKey(inflationStart.date) : null,
      endDate: inflationEnd ? dayKey(inflationEnd.date) : null,
      pointsCount: inflationPointCount,
      lastAcceptedDate: inflationLastDate,
      note:
        "شاخص قیمت مصرف‌کننده قابل خرید نیست، پس سناریوی «اگر تورم می‌خریدم» ساخته نمی‌شود؛ فقط بازده اسمی با تورم سنجیده می‌شود.",
    },
    assets: contribution.assets,
    unattributedCashProfitRial:
      contribution.unattributedCashProfitRial?.toString() ?? null,
    benchmarks: benchmarkRows,
    seriesStatus: series.length >= 2 ? "AVAILABLE" : series.length === 1 ? "PARTIAL" : "MISSING",
    series,
  };
}
