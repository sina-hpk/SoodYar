import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { dayKey, resolvePriceAtOrBefore, utcDay } from "../lib/analytics.js";
import { audit } from "./audit.js";
import { getMarketSnapshot } from "./market.js";

export const BENCHMARKS = [
  {
    key: "USD_IRR",
    name: "دلار آمریکا",
    unit: "هر دلار",
    kind: "MARKET",
    marketKey: "usd",
  },
  {
    key: "GOLD18_IRR_GRAM",
    name: "طلای ۱۸ عیار",
    unit: "هر گرم",
    kind: "MARKET",
    marketKey: "gram18",
  },
  {
    // Inflation is not investable, so it never gets a counterfactual portfolio.
    // It is an index of consumer prices entered as dated points (monthly is
    // enough), and the analytics compares returns against it.
    key: "INFLATION_INDEX_IR",
    name: "تورم (شاخص قیمت مصرف‌کننده)",
    unit: "نقطهٔ شاخص",
    kind: "INDEX",
    marketKey: null,
  },
] as const;

export type BenchmarkKey = (typeof BENCHMARKS)[number]["key"];

/** The only INDEX instrument; its values may carry decimals. */
export const INDEX_BENCHMARK_KEY: BenchmarkKey = "INFLATION_INDEX_IR";
/**
 * Index levels are scaled by this factor before being stored in the integer
 * `priceRial` column, so "185.4" survives exactly. Only the absolute level is
 * scaled; every ratio used in the analytics is scale-invariant.
 */
export const INDEX_SCALE = 10000;

export function scaleIndexValue(value: string): number {
  return Math.round(Number(value) * INDEX_SCALE);
}

export function unscaleIndexValue(value: bigint | number | string): string {
  return (Number(value) / INDEX_SCALE).toString();
}

export interface BenchmarkImportRow {
  key: BenchmarkKey;
  date: string;
  priceRial: string;
  /** Echo of the stored integer for INDEX rows (scaled level). */
  storedValue?: string;
  source?: string;
}

export function isBenchmarkKey(value: string): value is BenchmarkKey {
  return BENCHMARKS.some((item) => item.key === value);
}

export async function ensureBenchmarkInstruments() {
  await Promise.all(
    BENCHMARKS.map((item) =>
      prisma.benchmarkInstrument.upsert({
        where: { key: item.key },
        create: { ...item },
        update: { name: item.name, unit: item.unit, kind: item.kind, marketKey: item.marketKey },
      })
    )
  );
}

export async function listBenchmarks() {
  await ensureBenchmarkInstruments();
  const rows = await prisma.benchmarkInstrument.findMany({
    where: { isActive: true },
    include: {
      prices: {
        where: { qualityStatus: "ACCEPTED" },
        orderBy: { priceDate: "desc" },
        take: 1,
      },
    },
    orderBy: { key: "asc" },
  });
  return rows.map(({ prices, ...row }) => ({
    ...row,
    latestPrice: prices[0] ?? null,
  }));
}

export async function listBenchmarkPrices(
  key: BenchmarkKey,
  from?: Date,
  to?: Date
) {
  await ensureBenchmarkInstruments();
  return prisma.benchmarkPrice.findMany({
    where: {
      instrumentKey: key,
      qualityStatus: "ACCEPTED",
      priceDate: { gte: from ? utcDay(from) : undefined, lte: to ? utcDay(to) : undefined },
    },
    orderBy: { priceDate: "asc" },
  });
}

export async function getBenchmarkCoverage(from: Date, to: Date) {
  await ensureBenchmarkInstruments();
  const results = [];
  for (const instrument of BENCHMARKS) {
    const prices = await prisma.benchmarkPrice.findMany({
      where: {
        instrumentKey: instrument.key,
        qualityStatus: "ACCEPTED",
        priceDate: { lte: utcDay(to) },
      },
      orderBy: { priceDate: "asc" },
    });
    const dated = prices.map((price) => ({
      date: price.priceDate,
      priceRial: price.priceRial,
    }));
    const start = resolvePriceAtOrBefore(dated, from);
    const end = resolvePriceAtOrBefore(dated, to);
    results.push({
      key: instrument.key,
      from: start
        ? {
            status: start.resolution,
            priceDate: dayKey(start.date),
            gapDays: start.gapDays,
          }
        : { status: "MISSING", priceDate: null, gapDays: null },
      to: end
        ? {
            status: end.resolution,
            priceDate: dayKey(end.date),
            gapDays: end.gapDays,
          }
        : { status: "MISSING", priceDate: null, gapDays: null },
      firstAcceptedDate: prices[0] ? dayKey(prices[0].priceDate) : null,
      lastAcceptedDate: prices.at(-1) ? dayKey(prices.at(-1)!.priceDate) : null,
      acceptedCount: prices.length,
    });
  }
  return results;
}

function normalizeImportRows(rows: unknown[]): {
  accepted: BenchmarkImportRow[];
  errors: Array<{ row: number; error: string }>;
} {
  const accepted: BenchmarkImportRow[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const row = raw as Record<string, unknown>;
    const key = String(row?.key ?? "");
    const date = String(row?.date ?? "");
    const rawPrice = row?.priceRial;
    const priceRial = typeof rawPrice === "string" ? rawPrice : "";
    if (!isBenchmarkKey(key)) {
      errors.push({ row: index + 1, error: "کلید شاخص پشتیبانی نمی‌شود." });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      errors.push({ row: index + 1, error: "تاریخ باید YYYY-MM-DD باشد." });
      return;
    }
    // A price is whole rial. An INDEX is a level that may carry decimals
    // (a CPI of 185.4), so it is scaled to keep exact integers in the column.
    const isIndex = key === INDEX_BENCHMARK_KEY;
    const pattern = isIndex ? /^\d+(?:\.\d{1,4})?$/ : /^[1-9]\d*$/;
    if (!pattern.test(priceRial) || Number(priceRial) <= 0) {
      errors.push({
        row: index + 1,
        error: isIndex
          ? "مقدار شاخص باید عدد مثبت باشد (اعشار تا چهار رقم مجاز است)."
          : "قیمت باید رشتهٔ عدد صحیح مثبت ریالی باشد.",
      });
      return;
    }
    const unique = `${key}:${date}`;
    if (seen.has(unique)) {
      errors.push({ row: index + 1, error: "ردیف تکراری در همین ورودی است." });
      return;
    }
    seen.add(unique);
    accepted.push({
      key,
      date,
      priceRial: isIndex ? String(scaleIndexValue(priceRial)) : priceRial,
      storedValue: isIndex ? String(scaleIndexValue(priceRial)) : priceRial,
      source: row.source ? String(row.source).trim().slice(0, 80) : undefined,
    });
  });
  return { accepted, errors };
}

export async function previewBenchmarkImport(rows: unknown[]) {
  await ensureBenchmarkInstruments();
  const parsed = normalizeImportRows(rows);
  const existing = await prisma.benchmarkPrice.findMany({
    where: {
      OR: parsed.accepted.map((row) => ({
        instrumentKey: row.key,
        priceDate: utcDay(new Date(`${row.date}T00:00:00Z`)),
      })),
    },
    select: {
      instrumentKey: true,
      priceDate: true,
      priceRial: true,
      source: true,
      ingestMethod: true,
    },
  });
  const existingMap = new Map(
    existing.map((price) => [
      `${price.instrumentKey}:${dayKey(price.priceDate)}`,
      price,
    ])
  );
  return {
    valid: parsed.errors.length === 0,
    rows: parsed.accepted.map((row) => {
      const prior = existingMap.get(`${row.key}:${row.date}`);
      return {
        ...row,
        qualityStatus: "ACCEPTED",
        action: prior ? "DUPLICATE" : "CREATE",
        existingPriceRial: prior?.priceRial.toString() ?? null,
        existingSource: prior?.source ?? null,
        existingIngestMethod: prior?.ingestMethod ?? null,
      };
    }),
    errors: parsed.errors,
    policy:
      "ردیف جدید ایجاد می‌شود؛ تاریخ تکراری فقط با overwriteManual=true و فقط برای رکوردهای MANUAL/CSV بازنویسی می‌شود.",
  };
}

export async function commitBenchmarkImport(input: {
  rows: unknown[];
  overwriteManual?: boolean;
  ingestMethod?: "MANUAL_JSON" | "CSV_JSON";
}) {
  const preview = await previewBenchmarkImport(input.rows);
  if (!preview.valid) throw new Error("ورودی نامعتبر است؛ ابتدا خطاهای پیش‌نمایش را رفع کنید.");
  const duplicates = preview.rows.filter((row) => row.action === "DUPLICATE");
  if (duplicates.length > 0 && !input.overwriteManual) {
    throw new Error("تاریخ تکراری وجود دارد؛ برای بازنویسی دستی تأیید صریح لازم است.");
  }
  if (
    duplicates.some(
      (row) => !["MANUAL_JSON", "CSV_JSON"].includes(row.existingIngestMethod ?? "")
    )
  ) {
    throw new Error("قیمت ثبت‌شده از منبع زنده با واردسازی دستی قابل بازنویسی نیست.");
  }

  const batchId = randomUUID();
  const committed = await prisma.$transaction(
    preview.rows.map((row) =>
      prisma.benchmarkPrice.upsert({
        where: {
          instrumentKey_priceDate: {
            instrumentKey: row.key,
            priceDate: utcDay(new Date(`${row.date}T00:00:00Z`)),
          },
        },
        create: {
          instrumentKey: row.key,
          priceDate: utcDay(new Date(`${row.date}T00:00:00Z`)),
          priceRial: BigInt(row.priceRial),
          source: row.source || (input.ingestMethod === "CSV_JSON" ? "CSV" : "MANUAL"),
          ingestMethod: input.ingestMethod ?? "MANUAL_JSON",
          ingestBatchId: batchId,
          qualityStatus: "ACCEPTED",
          marketDateConfirmed: true,
        },
        update: {
          priceRial: BigInt(row.priceRial),
          source: row.source || (input.ingestMethod === "CSV_JSON" ? "CSV" : "MANUAL"),
          ingestMethod: input.ingestMethod ?? "MANUAL_JSON",
          ingestBatchId: batchId,
          qualityStatus: "ACCEPTED",
          marketDateConfirmed: true,
        },
      })
    )
  );
  await audit("BENCHMARK_IMPORT", "BenchmarkPrice", batchId, {
    batchId,
    count: committed.length,
    overwritten: duplicates.length,
    keys: [...new Set(preview.rows.map((row) => row.key))],
  });
  return { batchId, committed: committed.length, overwritten: duplicates.length };
}

function marketDateForQuote(asOf: string | null, fetchedAt: string): Date {
  if (asOf) {
    const parsed = new Date(asOf);
    if (!Number.isNaN(parsed.getTime())) return utcDay(parsed);
  }
  return utcDay(new Date(fetchedAt));
}

/**
 * Records one row for a single instrument, used by the simple form on the
 * analytics page. Existing rows are never overwritten silently: a duplicate
 * date is refused, because the stored value may have come from a live capture.
 */
export async function commitSingleBenchmarkPrice(input: {
  key: string;
  date: string;
  priceRial: string;
  source?: string;
}) {
  if (!isBenchmarkKey(input.key)) throw new Error("کلید شاخص پشتیبانی نمی‌شود.");
  const result = await commitBenchmarkImport({
    rows: [
      {
        key: input.key,
        date: input.date,
        priceRial: input.priceRial,
        source: input.source,
      },
    ],
    overwriteManual: false,
    ingestMethod: "MANUAL_JSON",
  });
  return result;
}

/** TGJU daily-history pages are server-rendered tables; this maps to their slug. */
const TGJU_HISTORY_SLUGS: Record<string, string> = {
  usd: "price_dollar_rl",
  gram18: "geram18",
};

const TGJU_HISTORY_URL = "https://www.tgju.org/profile";
const TGJU_FETCH_TIMEOUT_MS = 15_000;

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses the daily-history table of a TGJU profile page into close prices.
 * Only rows with a numeric close and a Gregorian date are kept; anything else
 * is skipped rather than guessed, so a markup change degrades to "no rows"
 * instead of writing a wrong price into the ledger.
 */
export function parseTgjuHistoryTable(html: string): Array<{ date: string; closeRial: string }> {
  const bodyStart = html.indexOf('id="table-list"');
  if (bodyStart < 0) return [];
  const bodyEnd = html.indexOf("</tbody>", bodyStart);
  const body = html.slice(bodyStart, bodyEnd < 0 ? html.length : bodyEnd);

  const seen = new Set<string>();
  const rows: Array<{ date: string; closeRial: string }> = [];
  for (const rowMatch of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      stripTags(cell[1])
    );
    if (cells.length < 8) continue;
    const closeRial = cells[3].replace(/,/g, "").trim();
    const dateMatch = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(cells[6].trim());
    if (!/^\d+$/.test(closeRial) || Number(closeRial) <= 0) continue;
    if (!dateMatch) continue;
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    if (seen.has(date)) continue;
    seen.add(date);
    rows.push({ date, closeRial });
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchTgjuHistory(path: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TGJU_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${TGJU_HISTORY_URL}/${path}/history`, {
      signal: controller.signal,
      headers: { "User-Agent": "SoodYar/1.0 (+local)" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Backfills traded benchmarks from TGJU's public daily-history pages (~30 days).
 * Rows already present are skipped, never overwritten, so this is safe to run
 * repeatedly and can never clobber a manually entered or live-captured price.
 */
export async function backfillBenchmarksFromTgjuHistory() {
  await ensureBenchmarkInstruments();
  const batchId = randomUUID();
  const results: Array<{
    key: BenchmarkKey;
    fetchedRows: number;
    inserted: number;
    skippedExisting: number;
    firstDate: string | null;
    lastDate: string | null;
    error: string | null;
  }> = [];

  for (const instrument of BENCHMARKS) {
    if (instrument.kind !== "MARKET" || !instrument.marketKey) continue;
    const slug = TGJU_HISTORY_SLUGS[instrument.marketKey];
    if (!slug) continue;

    try {
      const html = await fetchTgjuHistory(slug);
      const parsed = parseTgjuHistoryTable(html);
      if (parsed.length === 0) {
        results.push({
          key: instrument.key,
          fetchedRows: 0,
          inserted: 0,
          skippedExisting: 0,
          firstDate: null,
          lastDate: null,
          error: "جدولی در صفحهٔ تاریخچه پیدا نشد؛ ساختار منبع تغییر کرده است.",
        });
        continue;
      }

      const existing = await prisma.benchmarkPrice.findMany({
        where: { instrumentKey: instrument.key },
        select: { priceDate: true },
      });
      const existingDays = new Set(existing.map((price) => dayKey(price.priceDate)));
      const fresh = parsed.filter((row) => !existingDays.has(row.date));

      if (fresh.length > 0) {
        await prisma.$transaction(
          fresh.map((row) =>
            prisma.benchmarkPrice.create({
              data: {
                instrumentKey: instrument.key,
                priceDate: utcDay(new Date(`${row.date}T00:00:00Z`)),
                priceRial: BigInt(row.closeRial),
                source: "TGJU_HISTORY",
                sourceRef: `${TGJU_HISTORY_URL}/${slug}/history`,
                ingestMethod: "BACKFILL",
                ingestBatchId: batchId,
                qualityStatus: "ACCEPTED",
                marketDateConfirmed: true,
              },
            })
          )
        );
      }

      results.push({
        key: instrument.key,
        fetchedRows: parsed.length,
        inserted: fresh.length,
        skippedExisting: parsed.length - fresh.length,
        firstDate: parsed[0].date,
        lastDate: parsed[parsed.length - 1].date,
        error: null,
      });
    } catch (error) {
      results.push({
        key: instrument.key,
        fetchedRows: 0,
        inserted: 0,
        skippedExisting: 0,
        firstDate: null,
        lastDate: null,
        error: (error as Error).message,
      });
    }
  }

  await audit("BENCHMARK_BACKFILL", "BenchmarkPrice", batchId, { batchId, results });
  return { batchId, results };
}

export async function captureLiveBenchmarks() {
  await ensureBenchmarkInstruments();
  const snapshot = await getMarketSnapshot(true);
  const batchId = randomUUID();
  const captures = [];
  const warnings: string[] = [];
  for (const instrument of BENCHMARKS) {
    // Only traded benchmarks have a live quote; an index like inflation is fed
    // by manual/CSV points, so there is nothing to capture here.
    if (instrument.kind !== "MARKET" || !instrument.marketKey) continue;
    const quote = snapshot.quotes.find((item) => item.key === instrument.marketKey);
    if (!quote?.priceRial || !/^[1-9]\d*$/.test(quote.priceRial)) {
      warnings.push(`${instrument.key}: قیمت معتبر در دادهٔ زنده موجود نیست.`);
      continue;
    }
    const priceDate = marketDateForQuote(quote.asOf, snapshot.fetchedAt);
    const price = await prisma.benchmarkPrice.upsert({
      where: {
        instrumentKey_priceDate: { instrumentKey: instrument.key, priceDate },
      },
      create: {
        instrumentKey: instrument.key,
        priceDate,
        priceRial: BigInt(quote.priceRial),
        source: quote.source,
        sourceRef: quote.asOf ?? snapshot.fetchedAt,
        ingestMethod: "LIVE_CAPTURE",
        ingestBatchId: batchId,
        qualityStatus: "ACCEPTED",
        marketDateConfirmed: quote.asOf != null,
      },
      update: {
        priceRial: BigInt(quote.priceRial),
        source: quote.source,
        sourceRef: quote.asOf ?? snapshot.fetchedAt,
        ingestMethod: "LIVE_CAPTURE",
        ingestBatchId: batchId,
        qualityStatus: "ACCEPTED",
        marketDateConfirmed: quote.asOf != null,
      },
    });
    captures.push(price);
  }
  await audit("BENCHMARK_CAPTURE_LIVE", "BenchmarkPrice", batchId, {
    batchId,
    count: captures.length,
    dates: captures.map((item) => ({ key: item.instrumentKey, date: dayKey(item.priceDate) })),
    warnings,
  });
  return { batchId, captured: captures, warnings, upstreamErrors: snapshot.errors };
}
