import { describe, expect, it } from "vitest";
import type { MarketQuote } from "./market.js";
import {
  classifyExistingSnapshot,
  normalizeKey,
  parseTsetmcClosing,
  parseTsetmcSearch,
  pickTsetmcInstrument,
  planAssetPrices,
  resolveQuoteForAsset,
  type AutoPriceAssetInput,
} from "./autoPrice.js";

function quote(
  p: Partial<MarketQuote> & { key: string; symbol: string; name: string }
): MarketQuote {
  return {
    category: "FX",
    unit: "هر واحد",
    priceRial: "1000",
    priceUsd: null,
    changePercent: null,
    source: "TGJU",
    asOf: null,
    ...p,
  };
}

function asset(
  p: Partial<AutoPriceAssetInput> & { id: string; symbol: string; name: string }
): AutoPriceAssetInput {
  return { assetClass: "OTHER", quantity: "1", marketKey: null, ...p };
}

// Curated quotes with realistic Persian labels, mirroring market.ts.
const QUOTES: MarketQuote[] = [
  quote({ key: "usd", symbol: "USD", name: "دلار آمریکا" }),
  quote({ key: "eur", symbol: "EUR", name: "یورو" }),
  quote({ key: "usdt", symbol: "USDT", name: "تتر" }),
  quote({ key: "usdt_irr", symbol: "USDT/IRR", name: "تتر (بازار داخلی)" }),
  quote({ key: "gram18", symbol: "طلا ۱۸", name: "طلای ۱۸ عیار" }),
  quote({ key: "coin_emami", symbol: "سکه امامی", name: "سکه تمام (امامی)" }),
  quote({ key: "xag", symbol: "XAG", name: "انس جهانی نقره" }),
  quote({ key: "ime_fund_safron", symbol: "سافرون", name: "صندوق کالای زعفران گنجینه زمین", category: "COMMODITY" }),
  quote({ key: "ime_fund_kahroba", symbol: "کهربا", name: "صندوق کالای کهربا", category: "COMMODITY" }),
];

const byKey = (key: string) => QUOTES.find((q) => q.key === key)!;

describe("normalizeKey", () => {
  it("treats Persian and ASCII digits as equal", () => {
    expect(normalizeKey("طلا ۱۸")).toBe(normalizeKey("طلا 18"));
  });

  it("strips ZWNJ, spaces and dashes", () => {
    expect(normalizeKey("نیم‌سکه")).toBe(normalizeKey("نیم سکه"));
    expect(normalizeKey("USDT/IRR")).toBe("usdtirr");
  });

  it("strips Arabic/Persian diacritics", () => {
    expect(normalizeKey("سَکه")).toBe(normalizeKey("سکه"));
  });

  it("lowercases and drops boilerplate fund words", () => {
    expect(normalizeKey("USDT")).toBe("usdt");
    const normalized = normalizeKey("صندوق س.کالای گنجینه زمین");
    expect(normalized).toContain("گنجینهزمین");
    expect(normalized).not.toContain("صندوق");
    expect(normalized).not.toContain("کالا");
  });
});

describe("resolveQuoteForAsset — exact vs ambiguous fuzzy", () => {
  it("never matches USDT to USD via prefix containment (regression)", () => {
    const usdt = resolveQuoteForAsset(asset({ id: "a", symbol: "USDT", name: "تتر" }), QUOTES);
    // The domestic tether rate is the price a holder here actually sells at, so
    // the curated override wins over the dollar-converted `usdt` quote. What must
    // never happen is a prefix match onto the USD quote.
    expect(usdt.quote?.key).toBe("usdt_irr");
    expect(usdt.quote?.key).not.toBe("usd");
    expect(usdt.confidence).toBe("ALIAS");
  });

  it("leaves a USDT-ticker asset unmatched when only USD exists", () => {
    const onlyUsd = QUOTES.filter((q) => q.key === "usd");
    const result = resolveQuoteForAsset(
      asset({ id: "a", symbol: "USDT", name: "تتر" }),
      onlyUsd
    );
    expect(result.quote).toBeNull();
    expect(result.confidence).toBe("UNMATCHED");
  });

  it("refuses an ambiguous fuzzy match when several quotes qualify", () => {
    const ambiguous = [
      quote({ key: "a", symbol: "کهربای الف", name: "الف" }),
      quote({ key: "b", symbol: "کهربا ب", name: "ب" }),
    ];
    const result = resolveQuoteForAsset(asset({ id: "a", symbol: "کهربا", name: "x" }), ambiguous);
    expect(result.quote).toBeNull();
    expect(result.confidence).toBe("UNMATCHED");
  });

  it("allows a fuzzy match when exactly one quote contains the longer token", () => {
    const result = resolveQuoteForAsset(
      asset({ id: "a", symbol: "نامشخص", name: "گنجینه زمین" }),
      [byKey("ime_fund_safron")]
    );
    expect(result.confidence).toBe("FUZZY");
    expect(result.quote?.key).toBe("ime_fund_safron");
  });
});

describe("resolveQuoteForAsset — pinned and alias", () => {
  it("honours an explicit pin regardless of symbol", () => {
    const result = resolveQuoteForAsset(
      asset({ id: "a", symbol: "هرچیز", name: "هیچ", marketKey: "gram18" }),
      QUOTES
    );
    expect(result.confidence).toBe("PINNED");
    expect(result.quote?.key).toBe("gram18");
  });

  it("maps Persian type-word symbols through aliases", () => {
    const synthetic = [
      quote({ key: "eur", symbol: "EURO", name: "European Euro" }),
      quote({ key: "usd", symbol: "USDOLLAR", name: "American Dollar" }),
      quote({ key: "usdt_irr", symbol: "TETHERIRR", name: "Domestic Tether" }),
      quote({ key: "coin_emami", symbol: "EMAMI", name: "Full Coin" }),
    ];
    const cases: [string, string][] = [
      ["یورو", "eur"],
      ["دلار", "usd"],
      ["تتر", "usdt_irr"],
      ["سکه", "coin_emami"],
    ];
    for (const [symbol, expected] of cases) {
      const result = resolveQuoteForAsset(asset({ id: symbol, symbol, name: "دارایی" }), synthetic);
      expect(result.confidence).toBe("ALIAS");
      expect(result.quote?.key).toBe(expected);
    }
  });

  it("resolves real holdings: EUR, USDT and the IME funds", () => {
    expect(
      resolveQuoteForAsset(asset({ id: "1", symbol: "EUR", name: "یورو" }), QUOTES).quote?.key
    ).toBe("eur");
    expect(
      resolveQuoteForAsset(asset({ id: "2", symbol: "USDT", name: "تتر" }), QUOTES).quote?.key
    ).toBe("usdt_irr");
    expect(
      resolveQuoteForAsset(
        asset({ id: "3", symbol: "سافرون", name: "صندوق س.کالای گنجینه زمین" }),
        QUOTES
      ).quote?.key
    ).toBe("ime_fund_safron");
    expect(
      resolveQuoteForAsset(
        asset({ id: "4", symbol: "کهربا", name: "صندوق س. کالای کهربا" }),
        QUOTES
      ).quote?.key
    ).toBe("ime_fund_kahroba");
  });
});

describe("planAssetPrices confidence values", () => {
  const synthetic = [
    quote({ key: "eur", symbol: "EURO", name: "European Euro" }),
    quote({ key: "usd", symbol: "USDOLLAR", name: "American Dollar" }),
    quote({ key: "usdt_irr", symbol: "TETHERIRR", name: "Domestic Tether" }),
    quote({ key: "coin_emami", symbol: "EMAMI", name: "Full Coin" }),
    quote({ key: "no_price", symbol: "NOPRICE", name: "بدون قیمت", priceRial: null }),
    quote({ key: "ime_fund_safron", symbol: "SAFRON", name: "صندوق کالای زعفران گنجینه زمین" }),
  ];
  const rows = planAssetPrices(
    [
      asset({ id: "pin", symbol: "zz", name: "zz", marketKey: "eur" }),
      asset({ id: "exact", symbol: "USDOLLAR", name: "دالر" }),
      asset({ id: "alias", symbol: "تتر", name: "دارایی" }),
      asset({ id: "fuzzy", symbol: "نامشخص", name: "گنجینه زمین" }),
      asset({ id: "noprice", symbol: "NOPRICE", name: "x" }),
      asset({ id: "none", symbol: "نمونه سهام", name: "شرکت نمونه بورسی", assetClass: "OTHER" }),
    ],
    synthetic
  );
  const row = (id: string) => rows.find((r) => r.assetId === id)!;

  it("assigns PINNED, EXACT, ALIAS, FUZZY, UNMATCHED and NO_PRICE", () => {
    expect(row("pin").confidence).toBe("PINNED");
    expect(row("pin").matchedKey).toBe("eur");
    expect(row("exact").confidence).toBe("EXACT");
    expect(row("alias").confidence).toBe("ALIAS");
    expect(row("alias").matchedKey).toBe("usdt_irr");
    expect(row("fuzzy").confidence).toBe("FUZZY");
    expect(row("fuzzy").matchedKey).toBe("ime_fund_safron");
    expect(row("none").confidence).toBe("UNMATCHED");
    expect(row("none").matchedKey).toBeNull();
    expect(row("noprice").confidence).toBe("NO_PRICE");
  });

  it("returns one row per asset with provider metadata", () => {
    expect(rows).toHaveLength(6);
    const pinned = row("pin");
    expect(pinned.provider).toBe("TGJU");
    expect(pinned.source).toBe("TGJU");
    expect(pinned.priceRial).toBe("1000");
  });
});

describe("manual-only holdings", () => {
  const synthetic = [quote({ key: "usdt_irr", symbol: "TETHERIRR", name: "Domestic Tether" })];

  it("never matches a quote for a holding the owner prices by hand", () => {
    const rows = planAssetPrices(
      [
        asset({ id: "manual", symbol: "USDT", name: "تتر", autoPriceEnabled: false }),
        asset({ id: "auto", symbol: "USDT", name: "تتر" }),
      ],
      synthetic
    );
    const manualRow = rows.find((r) => r.assetId === "manual")!;
    expect(manualRow.confidence).toBe("MANUAL_ONLY");
    expect(manualRow.matchedKey).toBeNull();
    expect(manualRow.priceRial).toBeNull();
    expect(rows.find((r) => r.assetId === "auto")!.confidence).not.toBe("MANUAL_ONLY");
  });

  it("treats an absent flag as automatic so existing callers keep working", () => {
    const legacy = asset({ id: "legacy", symbol: "USDT", name: "تتر" }) as Record<string, unknown>;
    delete legacy.autoPriceEnabled;
    const row = planAssetPrices([legacy as never], synthetic).find((r) => r.assetId === "legacy")!;
    expect(row.confidence).not.toBe("MANUAL_ONLY");
  });

  it("forces STOCK/ETF/MUTUAL_FUND/SILVER to manual-only even when auto is enabled", () => {
    const rows = planAssetPrices(
      [
        asset({ id: "s1", symbol: "فملی", name: "ملی مس", assetClass: "STOCK" }),
        asset({ id: "e1", symbol: "اهرم", name: "صندوق اهرم", assetClass: "ETF" }),
        asset({ id: "m1", symbol: "آگاس", name: "صندوق آگاس", assetClass: "MUTUAL_FUND" }),
        asset({ id: "s2", symbol: "نقره", name: "نقره", assetClass: "SILVER" }),
      ],
      synthetic
    );
    for (const r of rows) {
      expect(r.confidence).toBe("MANUAL_ONLY");
      expect(r.matchedKey).toBeNull();
      expect(r.priceRial).toBeNull();
    }
  });
});

describe("manual snapshot protection", () => {
  it("skips overwriting a MANUAL snapshot of any flavour", () => {
    expect(classifyExistingSnapshot("MANUAL")).toBe("SKIP_MANUAL");
    expect(classifyExistingSnapshot("MANUAL:web")).toBe("SKIP_MANUAL");
  });

  it("allows writing when there is no snapshot or it came from auto/API", () => {
    expect(classifyExistingSnapshot(null)).toBe("WRITE");
    expect(classifyExistingSnapshot(undefined)).toBe("WRITE");
    expect(classifyExistingSnapshot("AUTO:TGJU")).toBe("WRITE");
    expect(classifyExistingSnapshot("API")).toBe("WRITE");
  });
});

describe("TSETMC parsing", () => {
  it("parses instrument search results", () => {
    const parsed = parseTsetmcSearch({
      instrumentSearch: [
        { insCode: "11111111111111111", lVal18AFC: "نمونه", lVal30: "شرکت نمونه بورسی" },
      ],
    });
    expect(parsed).toEqual([
      {
        insCode: "11111111111111111",
        symbol: "نمونه",
        name: "شرکت نمونه بورسی",
      },
    ]);
  });

  it("picks the latest valid daily close", () => {
    const parsed = parseTsetmcClosing({
      closingPriceDaily: [
        { dEven: 20260907, pClosing: 2200 },
        { dEven: 20260909, pClosing: 2327 },
        { dEven: 20260908, pClosing: 0 },
      ],
    });
    expect(parsed).toEqual({ marketDate: "2026-09-09", closeRial: "2327" });
  });

  it("returns null when no usable close exists", () => {
    expect(parseTsetmcClosing({ closingPriceDaily: [{ dEven: 0, pClosing: 1 }] })).toBeNull();
  });

  it("matches an instrument by normalized ticker", () => {
    const picked = pickTsetmcInstrument(
      { symbol: "کهربا", name: "صندوق کالای کهربا" },
      [
        { insCode: "1", symbol: "کهربا", name: "صندوق کالای کهربا" },
        { insCode: "2", symbol: "سافرون", name: "صندوق کالای زعفران" },
      ]
    );
    expect(picked?.insCode).toBe("1");
  });
});
