/**
 * Automatic market-price refresh.
 *
 * Matches portfolio assets to live market quotes (from ./market) and writes a
 * daily PriceSnapshot for each held asset, so NAV/unrealized-P&L stay fresh
 * without manual entry. This service owns its own matcher on purpose: the web
 * client also fuzzily matches quotes, but correctness here matters more (a bad
 * match writes a price), so the rules are stricter and unit-tested.
 *
 * Rules of the road:
 *   - Read-only until refresh() is called; plan() never writes.
 *   - A manual price for today is never overwritten (see classifyExistingSnapshot).
 *   - Iranian exchange (TSETMC) is a best-effort defensive adapter; it never
 *     throws and degrades to a typed failure with a Persian explanation.
 */

import { prisma } from "../db.js";
import { config } from "../config.js";
import { toDecimal } from "../lib/money.js";
import { utcDay } from "../lib/analytics.js";
import { audit } from "./audit.js";
import { recordPrice } from "./assetTx.js";
import { getMarketSnapshot, type MarketQuote } from "./market.js";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Generic fund vocabulary. Dropping these lets a descriptive holding name and a
 * shorter market label meet in the middle, e.g. "صندوق س.کالای گنجینه زمین"
 * and "سافرون" both reduce toward a fund core rather than failing on boilerplate.
 */
const FUND_WORDS = [
  "صندوق",
  "سهام",
  "بخشی",
  "کالا",
  "درآمد",
  "ثابت",
  "گذاری",
  "سرمایه",
];

/**
 * Normalizes a symbol/name for comparison: lowercase, Persian/Arabic-Indic
 * digits to ASCII, diacritics/ZWNJ/separators stripped, boilerplate fund words
 * removed. Deliberately lossy — it is only ever used for matching, never shown.
 */
export function normalizeKey(value: string | null | undefined): string {
  if (value == null) return "";
  let s = String(value);
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
  // Harakat/tatweel carry no matching signal and split otherwise-equal strings.
  s = s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
  s = s.toLowerCase();
  // ZWNJ, zero-width marks, whitespace, dashes, dots, brackets, slashes.
  s = s.replace(/[\u200b-\u200f\u2028\u2029\s\-_.,()/\\:،؛]/g, "");
  for (const word of FUND_WORDS) s = s.split(word).join("");
  return s;
}

/**
 * Persian type-words that should resolve to a specific live quote key. Only
 * applied when the asset's *own symbol* normalizes exactly to the alias, so it
 * never hijacks a descriptive name.
 */
const SYMBOL_ALIASES: Record<string, string> = {
  یورو: "eur",
  دلار: "usd",
  دلارامریکا: "usd",
  تتر: "usdt_irr",
  نقره: "xag",
  طلا: "gram18",
  سکه: "coin_emami",
  پوند: "gbp",
  لیر: "try",
  درهم: "aed",
};

/**
 * Normalized symbols whose correct quote is not the one with the same name.
 * See the comment at the use site for why tether points at the domestic rate.
 */
const MARKET_OVERRIDES: Record<string, string> = {
  usdt: "usdt_irr",
};

function safeFuzzy(a: string, b: string): boolean {
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  // Require a meaningful overlap; a 3-char prefix is how USDT gets mistaken
  // for USD, so shorter strings are only ever matched exactly.
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type MatchConfidence = "PINNED" | "EXACT" | "ALIAS" | "FUZZY" | "UNMATCHED";
export type PlanConfidence = MatchConfidence | "NO_PRICE";
export type QuoteProvider = "TGJU" | "TSETMC";

export interface AssetPricePlanRow {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  matchedKey: string | null;
  matchedName: string | null;
  priceRial: string | null;
  source: string | null;
  confidence: PlanConfidence;
  reason: string;
  provider: QuoteProvider | null;
}

/** The subset of an Asset the matcher cares about. */
export interface AutoPriceAssetInput {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
  quantity: string;
  marketKey: string | null;
}

export interface QuoteMatch {
  quote: MarketQuote | null;
  confidence: MatchConfidence;
  reason: string;
}

/**
 * Resolves the best live quote for one asset, in strict precedence order:
 * pinned key → exact symbol/name → alias → unambiguous fuzzy containment.
 */
export function resolveQuoteForAsset(
  asset: Pick<AutoPriceAssetInput, "symbol" | "name" | "marketKey">,
  quotes: MarketQuote[]
): QuoteMatch {
  const byKey = new Map(quotes.map((q) => [q.key, q]));
  const sym = normalizeKey(asset.symbol);
  const nm = normalizeKey(asset.name);

  // (a) Explicit pin wins even over an exact match — the operator knows best.
  if (asset.marketKey) {
    const pinned = byKey.get(asset.marketKey);
    if (pinned) {
      return { quote: pinned, confidence: "PINNED", reason: `اتصال دستی به کلید ${pinned.key}` };
    }
  }

  // (b) Exact normalized identity. More than one hit is ambiguous, so fall
  // through rather than picking an arbitrary quote.
  // (b) Curated market-convention overrides.
  //
  // These exist where the obvious quote is the wrong one for an Iranian
  // portfolio. Tether is the clearest case: TGJU publishes both the
  // dollar-converted rate (`usdt` ≈ 1 USD × the fiat rate) and the domestic
  // market rate an Iranian holder actually sells at (`usdt_irr`), and the two
  // differ by a wide margin. Marking a domestic holding at the international
  // peg overstates it, so the curated key wins over plain symbol equality.
  const override = MARKET_OVERRIDES[sym];
  if (override && byKey.has(override)) {
    return {
      quote: byKey.get(override)!,
      confidence: "ALIAS",
      reason: `نرخ بازار داخلی برای «${asset.symbol}» → ${override}`,
    };
  }

  const exact = quotes.filter(
    (q) => (sym && sym === normalizeKey(q.symbol)) || (nm && nm === normalizeKey(q.name))
  );
  const exactDistinct = [...new Map(exact.map((q) => [q.key, q])).values()];
  if (exactDistinct.length === 1) {
    const q = exactDistinct[0];
    return { quote: q, confidence: "EXACT", reason: `تطبیق دقیق نماد/نام با ${q.key}` };
  }

  // (c) Safe fuzzy containment, only when exactly one quote qualifies.
  const fuzzy = quotes.filter(
    (q) =>
      safeFuzzy(sym, normalizeKey(q.symbol)) ||
      safeFuzzy(sym, normalizeKey(q.name)) ||
      safeFuzzy(nm, normalizeKey(q.symbol)) ||
      safeFuzzy(nm, normalizeKey(q.name))
  );
  const fuzzyDistinct = [...new Map(fuzzy.map((q) => [q.key, q])).values()];
  if (fuzzyDistinct.length === 1) {
    const q = fuzzyDistinct[0];
    return { quote: q, confidence: "FUZZY", reason: `تطبیق تقریبی با ${q.key}` };
  }

  // (d) Persian type-word alias.
  const aliasKey = SYMBOL_ALIASES[sym];
  if (aliasKey && byKey.has(aliasKey)) {
    return {
      quote: byKey.get(aliasKey)!,
      confidence: "ALIAS",
      reason: `نام مستعار «${asset.symbol}» → ${aliasKey}`,
    };
  }

  if (exactDistinct.length > 1) {
    return {
      quote: null,
      confidence: "UNMATCHED",
      reason: "چند تطبیق دقیق یافت شد؛ برای رفع ابهام کلید بازار را دستی تعیین کنید",
    };
  }
  return { quote: null, confidence: "UNMATCHED", reason: "معادل زنده‌ای برای این دارایی یافت نشد" };
}

function toPlanRow(
  asset: AutoPriceAssetInput,
  match: QuoteMatch,
  provider: QuoteProvider | null
): AssetPricePlanRow {
  const quote = match.quote;
  const confidence: PlanConfidence =
    quote && quote.priceRial == null ? "NO_PRICE" : match.confidence;
  return {
    assetId: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    assetClass: asset.assetClass,
    matchedKey: quote?.key ?? null,
    matchedName: quote?.name ?? null,
    priceRial: quote?.priceRial ?? null,
    source: quote?.source ?? null,
    confidence,
    reason: match.reason,
    provider: quote ? provider : null,
  };
}

/**
 * Pure planner over synthetic-free inputs: takes assets + quotes and returns
 * one row per asset. No DB, no network — this is what the tests exercise.
 */
export function planAssetPrices(
  assets: AutoPriceAssetInput[],
  quotes: MarketQuote[]
): AssetPricePlanRow[] {
  return assets.map((asset) => toPlanRow(asset, resolveQuoteForAsset(asset, quotes), "TGJU"));
}

// ---------------------------------------------------------------------------
// TSETMC (Tehran exchange) adapter — best effort, never throws
// ---------------------------------------------------------------------------

const TSETMC_TIMEOUT_MS = 12_000;
const TSETMC_DOWN_TTL_MS = 5 * 60_000;
const TSETMC_SEARCH_URL = (term: string) =>
  `https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/${encodeURIComponent(term)}`;
const TSETMC_CLOSE_URL = (insCode: string, n: number) =>
  `https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/${encodeURIComponent(insCode)}/${n}`;

/** Persian message shown to the operator when the exchange CDN is unreachable. */
export const TSETMC_UNAVAILABLE_FA =
  "API بورس تهران (TSETMC) از این دستگاه در دسترس نیست؛ قیمت سهام و صندوق‌های بورسی را دستی ثبت کنید.";

/** Asset classes whose live price would come from TSETMC, not TGJU. */
const TSETMC_CLASSES = new Set(["STOCK", "ETF", "MUTUAL_FUND"]);

export interface TsetmcInstrument {
  insCode: string;
  symbol: string;
  name: string;
}

export interface TsetmcPriceResult {
  ok: boolean;
  insCode?: string;
  symbol?: string;
  name?: string;
  priceRial?: string;
  marketDate?: string; // YYYY-MM-DD of the close used
  error?: string;
}

/**
 * Failure memo: once the CDN refuses a connection (ECONNRESET here), stop
 * hammering it for every asset. After the TTL a fixed network just works.
 */
let tsetmcDownUntil = 0;
let tsetmcDownReason = "";

async function fetchTsetmcJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TSETMC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "SoodYar/1.0 (+local)", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  // Some CDN payloads nest the array under the same key.
  if (value && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(inner)) return inner;
    }
  }
  return [];
}

export function parseTsetmcSearch(payload: unknown): TsetmcInstrument[] {
  const list = asArray((payload as any)?.instrumentSearch);
  return list
    .map((item) => ({
      insCode: String(item?.insCode ?? "").trim(),
      symbol: String(item?.lVal18AFC ?? "").trim(),
      name: String(item?.lVal30 ?? "").trim(),
    }))
    .filter((item) => item.insCode.length > 0);
}

export interface TsetmcDailyClose {
  marketDate: string; // YYYY-MM-DD
  closeRial: string;
}

export function parseTsetmcClosing(payload: unknown): TsetmcDailyClose | null {
  const list = asArray((payload as any)?.closingPriceDaily);
  const rows: { dEven: number; pClosing: number }[] = [];
  for (const item of list) {
    const dEven = Number(item?.dEven);
    const pClosing = Number(item?.pClosing);
    if (!Number.isFinite(dEven) || dEven <= 0) continue;
    if (!Number.isFinite(pClosing) || pClosing <= 0) continue;
    rows.push({ dEven, pClosing });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.dEven - a.dEven);
  const latest = rows[0];
  const raw = String(latest.dEven);
  const marketDate =
    raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
  return { marketDate, closeRial: String(Math.round(latest.pClosing)) };
}

/** Picks the search hit whose normalized ticker/name best matches the asset. */
export function pickTsetmcInstrument(
  asset: Pick<AutoPriceAssetInput, "symbol" | "name">,
  instruments: TsetmcInstrument[]
): TsetmcInstrument | null {
  const sym = normalizeKey(asset.symbol);
  const nm = normalizeKey(asset.name);
  const bySymbol = instruments.find((i) => sym && normalizeKey(i.symbol) === sym);
  if (bySymbol) return bySymbol;
  const byName = instruments.find((i) => nm && normalizeKey(i.name) === nm);
  if (byName) return byName;
  const fuzzy = instruments.filter(
    (i) =>
      safeFuzzy(sym, normalizeKey(i.symbol)) ||
      safeFuzzy(sym, normalizeKey(i.name)) ||
      safeFuzzy(nm, normalizeKey(i.symbol)) ||
      safeFuzzy(nm, normalizeKey(i.name))
  );
  if (fuzzy.length === 1) return fuzzy[0];
  // A single search hit is itself strong evidence.
  return instruments.length === 1 ? instruments[0] : null;
}

/**
 * Looks up an Iranian exchange-traded instrument's latest daily close.
 * Always resolves (never throws); failure carries a Persian `error`.
 */
export async function lookupTsetmcPrice(
  asset: Pick<AutoPriceAssetInput, "symbol" | "name">
): Promise<TsetmcPriceResult> {
  if (Date.now() < tsetmcDownUntil) {
    return { ok: false, error: tsetmcDownReason || TSETMC_UNAVAILABLE_FA };
  }
  try {
    const search = await fetchTsetmcJson(TSETMC_SEARCH_URL(asset.symbol));
    const instrument = pickTsetmcInstrument(asset, parseTsetmcSearch(search));
    if (!instrument) {
      return { ok: false, error: "نماد دارایی در فهرست بورس تهران یافت نشد." };
    }

    const closing = await fetchTsetmcJson(TSETMC_CLOSE_URL(instrument.insCode, 5));
    const daily = parseTsetmcClosing(closing);
    if (!daily) {
      return { ok: false, error: "قیمت پایانی برای این نماد در بورس تهران یافت نشد." };
    }
    return {
      ok: true,
      insCode: instrument.insCode,
      symbol: instrument.symbol,
      name: instrument.name,
      priceRial: daily.closeRial,
      marketDate: daily.marketDate,
    };
  } catch (e) {
    // Remember the outage so a batch refresh does not pay the timeout per asset.
    tsetmcDownUntil = Date.now() + TSETMC_DOWN_TTL_MS;
    tsetmcDownReason = TSETMC_UNAVAILABLE_FA;
    return { ok: false, error: `${TSETMC_UNAVAILABLE_FA} (${(e as Error).message})` };
  }
}

/** Upgrades UNMATCHED equity/ETF rows with a TSETMC close when reachable. */
async function applyTsetmcFallback(
  rows: AssetPricePlanRow[],
  assets: AutoPriceAssetInput[]
): Promise<AssetPricePlanRow[]> {
  if (!config.tsetmcEnabled) return rows;
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const row of rows) {
    if (row.confidence !== "UNMATCHED") continue;
    const asset = byId.get(row.assetId);
    if (!asset || !TSETMC_CLASSES.has(asset.assetClass)) continue;
    const result = await lookupTsetmcPrice(asset);
    if (result.ok && result.priceRial) {
      row.matchedKey = result.insCode ?? null;
      row.matchedName = result.name || result.symbol || asset.name;
      row.priceRial = result.priceRial;
      row.source = "TSETMC";
      row.confidence = "EXACT";
      row.provider = "TSETMC";
      row.reason = `قیمت پایانی بورس تهران${result.marketDate ? ` (${result.marketDate})` : ""}`;
    } else if (result.error) {
      row.reason = result.error;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Planning / refresh orchestration
// ---------------------------------------------------------------------------

async function buildPlan(assetIds?: string[]): Promise<{
  rows: AssetPricePlanRow[];
  assets: AutoPriceAssetInput[];
}> {
  const [snapshot, assets] = await Promise.all([
    getMarketSnapshot(),
    prisma.asset.findMany({
      where: assetIds && assetIds.length > 0 ? { id: { in: assetIds } } : undefined,
      orderBy: { symbol: "asc" },
    }),
  ]);
  const rows = await applyTsetmcFallback(planAssetPrices(assets, snapshot.quotes), assets);
  return { rows, assets };
}

/** Dry-run plan: never writes. */
export async function planAssetPriceRefresh(assetIds?: string[]): Promise<AssetPricePlanRow[]> {
  return (await buildPlan(assetIds)).rows;
}

/**
 * Whether an existing same-day snapshot blocks an automatic write. Manual
 * entries always win; everything else (auto, legacy API) may be refreshed.
 */
export function classifyExistingSnapshot(
  source: string | null | undefined
): "SKIP_MANUAL" | "WRITE" {
  return source != null && source.startsWith("MANUAL") ? "SKIP_MANUAL" : "WRITE";
}

export type RefreshStatus =
  | "UPDATED"
  | "DRY_RUN"
  | "SKIPPED_MANUAL"
  | "SKIPPED_NO_POSITION"
  | PlanConfidence;

export interface RefreshResultRow extends AssetPricePlanRow {
  status: RefreshStatus;
}

export interface RefreshSummary {
  updated: number;
  skipped: number;
  unmatched: number;
  results: RefreshResultRow[];
}

/**
 * Writes today's PriceSnapshot for every matched asset that has a position.
 * Idempotent per day: re-running just upserts the auto snapshot. A manual
 * snapshot for today is preserved and reported as SKIPPED_MANUAL.
 */
export async function refreshAssetPrices(
  opts: { dryRun?: boolean; assetIds?: string[] } = {}
): Promise<RefreshSummary> {
  const { rows, assets } = await buildPlan(opts.assetIds);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const today = utcDay(new Date());
  const now = new Date();

  let updated = 0;
  let skipped = 0;
  let unmatched = 0;
  const results: RefreshResultRow[] = [];

  for (const row of rows) {
    const asset = byId.get(row.assetId);
    if (!asset) continue;

    if (row.confidence === "UNMATCHED" || row.confidence === "NO_PRICE") {
      unmatched++;
      results.push({ ...row, status: row.confidence });
      continue;
    }
    // A closed/empty position has nothing to value; never write a price for it.
    if (toDecimal(asset.quantity).lte(0)) {
      skipped++;
      results.push({ ...row, status: "SKIPPED_NO_POSITION" });
      continue;
    }
    if (opts.dryRun) {
      results.push({ ...row, status: "DRY_RUN" });
      continue;
    }

    const existing = await prisma.priceSnapshot.findUnique({
      where: { assetId_priceDate: { assetId: row.assetId, priceDate: today } },
    });
    if (classifyExistingSnapshot(existing?.source) === "SKIP_MANUAL") {
      skipped++;
      results.push({ ...row, status: "SKIPPED_MANUAL" });
      continue;
    }

    const sourceRef =
      row.provider === "TSETMC" ? `tsetmc:${row.matchedKey}` : `quote:${row.matchedKey}`;
    await recordPrice(row.assetId, BigInt(row.priceRial!), today, {
      source: `AUTO:${row.source ?? "MARKET"}`,
      sourceRef,
      note: `ثبت خودکار از ${row.matchedName ?? row.matchedKey} (تطبیق ${row.confidence})`,
    });
    await prisma.asset.update({
      where: { id: row.assetId },
      data: { lastAutoPriceAt: now },
    });
    updated++;
    results.push({ ...row, status: "UPDATED" });
  }

  if (!opts.dryRun) {
    await audit("PRICE_AUTO_REFRESH", "System", null, { updated, skipped, unmatched });
  }
  return { updated, skipped, unmatched, results };
}
