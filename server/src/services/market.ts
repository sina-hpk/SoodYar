/**
 * Live market data. Fetches spot prices from public, keyless sources and
 * normalizes them into rial-denominated quotes grouped by asset class so the
 * UI can show interpretable market charts and let the user snapshot a live
 * price onto a matching asset.
 *
 * Sources (all free / no API key):
 *   - TGJU (call1.tgju.org/ajax.json): Iranian market aggregator. Returns rial
 *     prices for fiat (USD/EUR/…), domestic gold (gram, mithqal) and coins, and
 *     USD prices for global instruments (gold ounce, silver ounce, crypto).
 *   - CoinGecko (api.coingecko.com): crypto USD fallback if TGJU is unreachable.
 *
 * Everything here is read-only and never writes to the DB. Results are cached
 * in memory for a short TTL so we don't hammer upstream on every page load.
 */

export type MarketCategory =
  | "FX"
  | "GOLD"
  | "GOLD_TOKEN"
  | "COIN"
  | "SILVER"
  | "CRYPTO"
  | "COMMODITY";

export interface MarketQuote {
  key: string; // stable identifier, e.g. "usd", "btc", "gram18"
  symbol: string; // short display symbol
  name: string; // Persian label
  category: MarketCategory;
  unit: string; // Persian unit, e.g. "هر دلار", "هر گرم"
  priceRial: string | null; // integer rial as string (null if not derivable)
  priceUsd: string | null; // original USD price when the source is USD
  changePercent: number | null; // 24h/day change percent when available
  source: string; // "TGJU" | "CoinGecko"
  asOf: string | null; // upstream timestamp when available
}

export interface MarketSnapshot {
  quotes: MarketQuote[];
  usdRial: string | null; // USD→rial rate used for conversions
  fetchedAt: string; // ISO time we assembled the snapshot
  partial: boolean; // true if some sources failed
  errors: string[];
}

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 12_000;

let cache: { at: number; data: MarketSnapshot } | null = null;

/** Curated TGJU instruments → normalized quote metadata. */
interface TgjuMap {
  tgjuKey: string;
  key: string;
  symbol: string;
  name: string;
  category: MarketCategory;
  unit: string;
  /** Currency the TGJU `p` value is expressed in. */
  denom: "IRR" | "USD";
}

const TGJU_INSTRUMENTS: TgjuMap[] = [
  // Fiat (rial)
  { tgjuKey: "price_dollar_rl", key: "usd", symbol: "USD", name: "دلار آمریکا", category: "FX", unit: "هر دلار", denom: "IRR" },
  { tgjuKey: "price_eur", key: "eur", symbol: "EUR", name: "یورو", category: "FX", unit: "هر یورو", denom: "IRR" },
  { tgjuKey: "price_gbp", key: "gbp", symbol: "GBP", name: "پوند انگلیس", category: "FX", unit: "هر پوند", denom: "IRR" },
  { tgjuKey: "price_aed", key: "aed", symbol: "AED", name: "درهم امارات", category: "FX", unit: "هر درهم", denom: "IRR" },
  { tgjuKey: "price_try", key: "try", symbol: "TRY", name: "لیر ترکیه", category: "FX", unit: "هر لیر", denom: "IRR" },
  // Domestic gold (rial)
  { tgjuKey: "geram18", key: "gram18", symbol: "طلا ۱۸", name: "طلای ۱۸ عیار", category: "GOLD", unit: "هر گرم", denom: "IRR" },
  { tgjuKey: "geram24", key: "gram24", symbol: "طلا ۲۴", name: "طلای ۲۴ عیار", category: "GOLD", unit: "هر گرم", denom: "IRR" },
  { tgjuKey: "mesghal", key: "mesghal", symbol: "مثقال", name: "مثقال طلا", category: "GOLD", unit: "هر مثقال", denom: "IRR" },
  // Global gold ounce (USD)
  { tgjuKey: "ons", key: "xau", symbol: "XAU", name: "انس جهانی طلا", category: "GOLD", unit: "هر انس", denom: "USD" },
  // Coins (rial)
  { tgjuKey: "sekee", key: "coin_emami", symbol: "سکه امامی", name: "سکه تمام (امامی)", category: "COIN", unit: "هر سکه", denom: "IRR" },
  { tgjuKey: "sekeb", key: "coin_bahar", symbol: "بهار آزادی", name: "سکه بهار آزادی", category: "COIN", unit: "هر سکه", denom: "IRR" },
  { tgjuKey: "nim", key: "coin_half", symbol: "نیم‌سکه", name: "نیم‌سکه", category: "COIN", unit: "هر سکه", denom: "IRR" },
  { tgjuKey: "rob", key: "coin_quarter", symbol: "ربع‌سکه", name: "ربع‌سکه", category: "COIN", unit: "هر سکه", denom: "IRR" },
  // Silver ounce (USD)
  { tgjuKey: "silver", key: "xag", symbol: "XAG", name: "انس جهانی نقره", category: "SILVER", unit: "هر انس", denom: "USD" },
  // Crypto (USD)
  { tgjuKey: "crypto-bitcoin", key: "btc", symbol: "BTC", name: "بیت‌کوین", category: "CRYPTO", unit: "هر واحد", denom: "USD" },
  { tgjuKey: "crypto-ethereum", key: "eth", symbol: "ETH", name: "اتریوم", category: "CRYPTO", unit: "هر واحد", denom: "USD" },
  { tgjuKey: "crypto-tether", key: "usdt", symbol: "USDT", name: "تتر", category: "CRYPTO", unit: "هر واحد", denom: "USD" },
  // Tether in the domestic market: TGJU quotes it directly in rial, which is the
  // rate an Iranian buyer actually pays, not the 1$ peg times the fiat rate.
  { tgjuKey: "crypto-tether-irr", key: "usdt_irr", symbol: "USDT/IRR", name: "تتر (بازار داخلی)", category: "CRYPTO", unit: "هر تتر", denom: "IRR" },
  // Gold-backed tokens: one unit tracks one troy ounce of gold. Kept in their own
  // category because they behave like gold but trade on crypto venues.
  { tgjuKey: "tether_gold_xaut", key: "xaut", symbol: "XAUT", name: "تتر گلد", category: "GOLD_TOKEN", unit: "هر واحد ≈ یک انس طلا", denom: "USD" },
  { tgjuKey: "crypto_paxg_gold", key: "paxg", symbol: "PAXG", name: "پکس گلد", category: "GOLD_TOKEN", unit: "هر واحد ≈ یک انس طلا", denom: "USD" },
  // IME (Iran Mercantile Exchange) commodity funds, quoted in rial per fund
  // unit. TGJU publishes the whole `ime_fund_*` family; the widely traded ones
  // are mapped here so a holding can be pinned to its own ticker. Symbols are
  // the funds' public tickers, names are the fund families as published.
  { tgjuKey: "ime_fund_zar", key: "ime_fund_zar", symbol: "زر", name: "صندوق کالای زر", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_simin", key: "ime_fund_simin", symbol: "سیمین", name: "صندوق کالای سیمین", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_silver", key: "ime_fund_silver", symbol: "نقره", name: "صندوق کالای نقره", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_safron", key: "ime_fund_safron", symbol: "سافرون", name: "صندوق کالای زعفران گنجینه زمین", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_mesghal", key: "ime_fund_mesghal", symbol: "مثقال", name: "صندوق کالای مثقال", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_kahroba", key: "ime_fund_kahroba", symbol: "کهربا", name: "صندوق کالای کهربا", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_zomorod", key: "ime_fund_zomorod", symbol: "زمرد", name: "صندوق کالای زمرد", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_zarvan", key: "ime_fund_zarvan", symbol: "زروان", name: "صندوق کالای زروان", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_zarfam", key: "ime_fund_zarfam", symbol: "زرفام", name: "صندوق کالای زرفام", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_zargar", key: "ime_fund_zargar", symbol: "زرگر", name: "صندوق کالای زرگر", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_goldis", key: "ime_fund_goldis", symbol: "گلدیس", name: "صندوق کالای گلدیس", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_gohar", key: "ime_fund_gohar", symbol: "گوهر", name: "صندوق کالای گوهر", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_ganj", key: "ime_fund_ganj", symbol: "گنج", name: "صندوق کالای گنج", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_javaher", key: "ime_fund_javaher", symbol: "جواهر", name: "صندوق کالای جواهر", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_noghrin", key: "ime_fund_noghrin", symbol: "نقرین", name: "صندوق کالای نقرین", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
  { tgjuKey: "ime_fund_nafis", key: "ime_fund_nafis", symbol: "نفیس", name: "صندوق کالای نفیس", category: "COMMODITY", unit: "هر واحد صندوق", denom: "IRR" },
];

async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "SoodYar/1.0 (+local)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a TGJU numeric string like "2,005,000" or "77934.15" to a number. */
function parseNum(p: unknown): number | null {
  if (p == null) return null;
  const n = Number(String(p).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function roundRial(n: number): string {
  return Math.round(n).toString();
}

export async function getMarketSnapshot(force = false): Promise<MarketSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const errors: string[] = [];
  const quotes: MarketQuote[] = [];
  let usdRial: number | null = null;

  // ---- Primary source: TGJU ----
  let tgju: any = null;
  try {
    tgju = await fetchJson("https://call1.tgju.org/ajax.json");
  } catch (e) {
    errors.push(`TGJU: ${(e as Error).message}`);
  }

  const cur = tgju?.current ?? null;
  if (cur) {
    const usd = parseNum(cur["price_dollar_rl"]?.p);
    if (usd && usd > 0) usdRial = usd;

    for (const inst of TGJU_INSTRUMENTS) {
      const raw = cur[inst.tgjuKey];
      if (!raw) continue;
      const value = parseNum(raw.p);
      if (value == null) continue;

      let priceRial: string | null = null;
      let priceUsd: string | null = null;
      if (inst.denom === "IRR") {
        priceRial = roundRial(value);
      } else {
        priceUsd = value.toString();
        if (usdRial) priceRial = roundRial(value * usdRial);
      }

      const change = typeof raw.dp === "number" ? raw.dp : parseNum(raw.dp);

      quotes.push({
        key: inst.key,
        symbol: inst.symbol,
        name: inst.name,
        category: inst.category,
        unit: inst.unit,
        priceRial,
        priceUsd,
        changePercent: change ?? null,
        source: "TGJU",
        asOf: raw.ts ?? raw.t_en ?? null,
      });
    }
  }

  // ---- Fallback: CoinGecko for crypto / gold tokens TGJU didn't give us ----
  const cgMap: {
    id: string;
    key: string;
    symbol: string;
    name: string;
    category: MarketCategory;
    unit: string;
  }[] = [
    { id: "bitcoin", key: "btc", symbol: "BTC", name: "بیت‌کوین", category: "CRYPTO", unit: "هر واحد" },
    { id: "ethereum", key: "eth", symbol: "ETH", name: "اتریوم", category: "CRYPTO", unit: "هر واحد" },
    { id: "tether", key: "usdt", symbol: "USDT", name: "تتر", category: "CRYPTO", unit: "هر واحد" },
    { id: "tether-gold", key: "xaut", symbol: "XAUT", name: "تتر گلد", category: "GOLD_TOKEN", unit: "هر واحد ≈ یک انس طلا" },
    { id: "pax-gold", key: "paxg", symbol: "PAXG", name: "پکس گلد", category: "GOLD_TOKEN", unit: "هر واحد ≈ یک انس طلا" },
  ];
  const missing = cgMap.filter((m) => !quotes.some((q) => q.key === m.key));
  if (missing.length > 0) {
    try {
      const cg = await fetchJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${missing
          .map((m) => m.id)
          .join(",")}&vs_currencies=usd&include_24hr_change=true`
      );
      for (const m of missing) {
        const usdPrice = cg?.[m.id]?.usd;
        if (usdPrice == null) continue;
        quotes.push({
          key: m.key,
          symbol: m.symbol,
          name: m.name,
          category: m.category,
          unit: m.unit,
          priceRial: usdRial ? roundRial(usdPrice * usdRial) : null,
          priceUsd: String(usdPrice),
          changePercent: cg?.[m.id]?.usd_24h_change ?? null,
          source: "CoinGecko",
          asOf: null,
        });
      }
    } catch (e) {
      errors.push(`CoinGecko: ${(e as Error).message}`);
    }
  }

  const snapshot: MarketSnapshot = {
    quotes,
    usdRial: usdRial != null ? roundRial(usdRial) : null,
    fetchedAt: new Date().toISOString(),
    partial: errors.length > 0,
    errors,
  };

  // Only cache a snapshot that actually carries data; otherwise let the next
  // call retry upstream immediately.
  if (quotes.length > 0) cache = { at: Date.now(), data: snapshot };
  return snapshot;
}
