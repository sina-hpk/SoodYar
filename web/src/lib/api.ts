import type { Currency } from "./format";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let message = `خطای سرور (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.error === "string") message = body.error;
      else if (body.error?.fieldErrors) {
        const first = Object.values(body.error.fieldErrors).flat()[0];
        if (first) message = String(first);
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ---- Types (mirror serialized server shapes) ----
export interface Member {
  id: string;
  fullName: string;
  nationalId?: string | null;
  phone?: string | null;
  email?: string | null;
  joinDate: string;
  status: "ACTIVE" | "INACTIVE";
  notes?: string | null;
  /** Ledger transactions of this member; any non-zero count blocks hard deletion. */
  transactionCount?: number;
  summary?: MemberSummary;
}

export interface MemberSummary {
  memberId: string;
  activeUnits: string;
  totalDepositRial: string;
  totalWithdrawalRial: string;
  netContributedCapitalRial: string;
  ownershipPercent: string;
  currentValueRial: string;
  simpleNetPnlRial: string;
  simpleReturnPercent: string | null;
  // backward-compat alias for simpleNetPnlRial
  pnlRial: string;
}

export interface MemberCategoryExposure {
  category: string;
  categoryValueRial: string;
  exposureRial: string;
}

export interface MemberXirr {
  xirrPercent: string | null;
  note: string;
}

export type PriceMatchConfidence =
  | "PINNED"
  | "EXACT"
  | "ALIAS"
  | "FUZZY"
  | "UNMATCHED"
  | "NO_PRICE";

/** One asset's auto-pricing plan row: which live quote feeds it, if any. */
export interface PricePlanRow {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  matchedKey: string | null;
  matchedName: string | null;
  priceRial: string | null;
  source: string | null;
  confidence: PriceMatchConfidence;
  reason: string;
  provider: "TGJU" | "TSETMC" | null;
  status?: string;
}

export interface PriceRefreshSummary {
  updated: number;
  skipped: number;
  unmatched: number;
  results: PricePlanRow[];
}

export interface AssetValuation {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  isActive: boolean;
  quantity: string;
  avgCostRial: string;
  remainingCostBasisRial: string;
  latestPriceRial: string | null;
  priceDate: string | null;
  valuedAtCost: boolean;
  marketValueRial: string;
  unrealizedPnlRial: string;
  unrealizedReturnPercent: string | null;
  realizedPnlRial: string;
  totalPnlRial: string;
  totalReturnPercent: string | null;
  weightPercent: string;
  isClosed: boolean;
}

export interface CategoryAllocation {
  category: string;
  marketValueRial: string;
  allocationPercent: string | null;
  assetCount: number;
}

export interface Dashboard {
  totalNavRial: string;
  navPerUnit: string;
  cashBalanceRial: string;
  assetsValueRial: string;
  activeMemberCount: number;
  totalActiveUnits: string;
  assets: AssetValuation[];
  categories: CategoryAllocation[];
}

export interface MemberTx {
  id: string;
  memberId: string;
  type: string;
  status: string;
  amountRial: string;
  units: string;
  navPerUnit: string | null;
  effectiveDate: string;
  description?: string | null;
  member?: { fullName: string };
}

export interface PortfolioTx {
  id: string;
  type: string;
  status: string;
  assetId: string | null;
  quantity: string;
  pricePerUnit: string;
  cashDeltaRial: string;
  effectiveDate: string;
  description?: string | null;
  asset?: { symbol: string } | null;
}

export interface MarketQuote {
  key: string;
  symbol: string;
  name: string;
  category: "FX" | "GOLD" | "GOLD_TOKEN" | "COIN" | "SILVER" | "CRYPTO";
  unit: string;
  priceRial: string | null;
  priceUsd: string | null;
  changePercent: number | null;
  source: string;
  asOf: string | null;
}

export interface MarketSnapshot {
  quotes: MarketQuote[];
  usdRial: string | null;
  fetchedAt: string;
  partial: boolean;
  errors: string[];
}

export type AnalyticsCoverageStatus = "COMPLETE" | "PARTIAL" | "MISSING";
export type AnalyticsValuationStatus = "MARKET" | "STALE" | "AT_COST" | "MISSING";
export type BenchmarkKey = "USD_IRR" | "GOLD18_IRR_GRAM" | "INFLATION_INDEX_IR";
export type BenchmarkSolvency = "OK" | "INSOLVENT_AT_FLOW" | "MISSING_DATA";

export interface AnalyticsBenchmarkCoverage {
  key: BenchmarkKey;
  status: AnalyticsCoverageStatus;
  missingFlowDates: string[];
  staleDays: number | null;
}

export interface AnalyticsAssetPerformance {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  startMarketValueRial: string;
  endMarketValueRial: string;
  linkedCashDeltaRial: string;
  profitContributionRial: string;
  realizedPnlRial: string;
  unrealizedPnlRial: string;
  totalPnlRial: string;
  returnPercent: string | null;
  valuationStatus: AnalyticsValuationStatus;
  priceDate: string | null;
}

export interface AnalyticsCounterfactual {
  endingUnits: string | null;
  endingValueRial: string | null;
  profitRial: string | null;
  returnPercent: string | null;
  xirrAnnualizedPercent: string | null;
  solvency: BenchmarkSolvency;
  missingFlowDates: string[];
}

export interface AnalyticsBenchmarkPerformance {
  key: BenchmarkKey;
  name: string;
  unit: string;
  status: AnalyticsCoverageStatus;
  startPriceRial: string | null;
  endPriceRial: string | null;
  pointReturnPercent: string | null;
  /** Nominal point return minus inflation over the same period; null when unknown. */
  realPointReturnPercent?: string | null;
  excessVsFundPercent: string | null;
  /** Null for published indices such as inflation, which cannot be "bought". */
  counterfactual: AnalyticsCounterfactual | null;
}

export interface AnalyticsInflation {
  key: BenchmarkKey | null;
  status: AnalyticsCoverageStatus;
  inflationPercent: string | null;
  fundRealReturnPercent: string | null;
  startIndex: string | null;
  endIndex: string | null;
  startDate: string | null;
  endDate: string | null;
  pointsCount: number;
  lastAcceptedDate: string | null;
  note: string;
}

export interface BenchmarkCatalogItem {
  key: BenchmarkKey;
  name: string;
  unit: string;
  description?: string | null;
  latestPriceRial?: string | null;
  latestPriceDate?: string | null;
}

export interface AnalyticsReport {
  meta: {
    from: string | null;
    to: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    isInception: boolean;
  };
  coverage: {
    navStatus: AnalyticsCoverageStatus;
    warnings: string[];
    benchmarks: AnalyticsBenchmarkCoverage[];
  };
  fund: {
    startNavRial: string;
    endNavRial: string;
    contributionsRial: string;
    withdrawalsRial: string;
    actualProfitRial: string;
    simpleProfitPercent: string | null;
    startNavPerUnit: string | null;
    endNavPerUnit: string;
    navUnitReturnPercent: string | null;
    xirrAnnualizedPercent: string | null;
    /** NAV/unit return after removing inflation; null when inflation is unknown. */
    realReturnPercent: string | null;
    /** Explains why an annualized figure is absent, e.g. a very short period. */
    xirrNote?: string;
    periodDays?: number;
  };
  inflation: AnalyticsInflation;
  assets: AnalyticsAssetPerformance[];
  unattributedCashProfitRial: string;
  benchmarks: AnalyticsBenchmarkPerformance[];
  series: Array<{
    date: string;
    fund: string | null;
    USD_IRR: string | null;
    GOLD18_IRR_GRAM: string | null;
    INFLATION_INDEX_IR?: string | null;
  }>;
  benchmarkCatalog?: BenchmarkCatalogItem[];
}

export interface BenchmarkPrice {
  id?: string;
  key: BenchmarkKey;
  date: string;
  priceRial: string;
  source?: string | null;
  capturedAt?: string | null;
}

export interface BenchmarkPriceInput {
  key: BenchmarkKey;
  date: string;
  priceRial: string;
  source?: string;
}

export interface BenchmarkImportPreview {
  validRows: BenchmarkPriceInput[];
  errors: Array<{
    row: number;
    field?: string;
    message: string;
  }>;
  duplicateRows: Array<{
    key: BenchmarkKey;
    date: string;
    existingPriceRial: string;
    incomingPriceRial: string;
  }>;
}

export interface BenchmarkImportCommitResult {
  inserted: number;
  skipped: number;
  prices: BenchmarkPrice[];
}

export interface BenchmarkLiveCaptureResult {
  captured: BenchmarkPrice[];
  skipped: Array<{
    key: BenchmarkKey;
    reason: string;
  }>;
}

export interface BenchmarkBackfillResult {
  batchId: string;
  results: Array<{
    key: BenchmarkKey;
    fetchedRows: number;
    inserted: number;
    skippedExisting: number;
    firstDate: string | null;
    lastDate: string | null;
    error: string | null;
  }>;
}

export interface RawAsset {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
  quantity: string;
  avgCost: string;
  realizedPnl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioReport {
  totalNavRial: string;
  navPerUnit: string;
  cashBalanceRial: string;
  assetsValueRial: string;
  totalActiveUnits: string;
  activeMemberCount: number;
  assets: AssetValuation[];
  categories: CategoryAllocation[];
  members: Array<MemberSummary & { id: string; fullName: string }>;
}

export interface MemberReport {
  member: Member;
  summary: MemberSummary;
  exposure: MemberCategoryExposure[];
  xirr: MemberXirr;
  transactions: MemberTx[];
}

export interface NavSnapshot {
  id: string;
  navDate: string;
  cashBalanceRial: string;
  assetsValueRial: string;
  liabilitiesRial: string;
  totalNavRial: string;
  totalActiveUnits: string;
  navPerUnit: string;
  note?: string | null;
}

export interface NavPreview {
  cashBalanceRial: string;
  assetsValueRial: string;
  liabilitiesRial: string;
  totalNavRial: string;
  totalActiveUnits: string;
  navPerUnit: string;
  activeMemberCount: number;
  assets: AssetValuation[];
  categories: CategoryAllocation[];
}

export interface AuditReport {
  nav: {
    cashBalanceRial: string;
    assetsValueRial: string;
    liabilitiesRial: string;
    totalNavRial: string;
    totalActiveUnits: string;
    navPerUnit: string;
  };
  assets: AssetValuation[];
  categories: CategoryAllocation[];
  members: (MemberSummary & { id: string; fullName: string })[];
  logs: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    data: string | null;
    actor: string;
    createdAt: string;
  }[];
}

export const api = {
  // Dashboard / NAV
  dashboard: () => request<Dashboard>("/dashboard"),
  navPreview: () => request<NavPreview>("/nav/preview"),
  navHistory: (from?: string, to?: string) =>
    request<NavSnapshot[]>(
      `/nav/history${from || to ? `?from=${from ?? ""}&to=${to ?? ""}` : ""}`
    ),
  navCommit: (body: {
    navDate: string;
    liabilitiesRial?: number;
    note?: string;
    overwrite?: boolean;
  }) => request<NavSnapshot>("/nav/commit", { method: "POST", body: JSON.stringify(body) }),

  // Members
  members: () => request<Member[]>("/members"),
  member: (id: string) =>
    request<{
      member: Member;
      summary: MemberSummary;
      exposure: MemberCategoryExposure[];
      xirr: MemberXirr;
      transactions: MemberTx[];
    }>(`/members/${id}`),
  createMember: (body: Record<string, unknown>) =>
    request<Member>("/members", { method: "POST", body: JSON.stringify(body) }),
  updateMember: (id: string, body: Record<string, unknown>) =>
    request<Member>(`/members/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteMember: (id: string) =>
    request<{ ok: true }>(`/members/${id}`, { method: "DELETE" }),

  // Assets & prices
  assets: () => request<AssetValuation[]>("/assets"),
  assetsRaw: () => request<RawAsset[]>("/assets/raw"),
  createAsset: (body: Record<string, unknown>) =>
    request("/assets", { method: "POST", body: JSON.stringify(body) }),
  updateAsset: (id: string, body: Record<string, unknown>) =>
    request(`/assets/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAsset: (id: string) =>
    request<{ ok: true }>(`/assets/${id}`, { method: "DELETE" }),
  recordPrice: (body: {
    assetId: string;
    priceRial: number;
    priceDate: string;
    source?: string;
    sourceRef?: string;
    note?: string;
  }) => request("/prices", { method: "POST", body: JSON.stringify(body) }),

  // Transactions
  memberTxs: (params: Record<string, string> = {}) =>
    request<MemberTx[]>(
      `/transactions/member?${new URLSearchParams(params).toString()}`
    ),
  portfolioTxs: (params: Record<string, string> = {}) =>
    request<PortfolioTx[]>(
      `/transactions/portfolio?${new URLSearchParams(params).toString()}`
    ),
  deposit: (body: Record<string, unknown>) =>
    request("/transactions/deposit", { method: "POST", body: JSON.stringify(body) }),
  contribution: (body: Record<string, unknown>) =>
    request("/transactions/contribution", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  withdrawalRequest: (body: Record<string, unknown>) =>
    request("/transactions/withdrawal-request", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  settleWithdrawal: (id: string, settleDate: string) =>
    request(`/transactions/withdrawal/${id}/settle`, {
      method: "POST",
      body: JSON.stringify({ settleDate }),
    }),
  cancelWithdrawal: (id: string) =>
    request(`/transactions/withdrawal/${id}/cancel`, { method: "POST" }),
  buy: (body: Record<string, unknown>) =>
    request("/transactions/buy", { method: "POST", body: JSON.stringify(body) }),
  sell: (body: Record<string, unknown>) =>
    request("/transactions/sell", { method: "POST", body: JSON.stringify(body) }),
  cashOp: (body: {
    type: "FEE" | "DIVIDEND" | "CASH_ADJUSTMENT";
    amountRial: number;
    assetId?: string;
    effectiveDate: string;
    description?: string;
  }) => request("/transactions/cash-op", { method: "POST", body: JSON.stringify(body) }),

  // Reports
  portfolioReport: () => request<PortfolioReport>("/reports/portfolio"),
  memberReport: (id: string) => request<MemberReport>(`/reports/member/${id}`),
  auditReport: () => request<AuditReport>("/reports/audit"),

  // Automatic market pricing
  priceAutoPlan: () => request<PricePlanRow[]>("/prices/auto/plan"),
  priceAutoRefresh: (body: { dryRun?: boolean; assetIds?: string[] } = {}) =>
    request<PriceRefreshSummary>("/prices/auto/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setAssetMarketKey: (assetId: string, marketKey: string | null) =>
    request(`/assets/${assetId}/market-key`, {
      method: "PUT",
      body: JSON.stringify({ marketKey }),
    }),

  // Analytics & benchmark data
  analyticsPerformance: (from: string, to: string) =>
    request<AnalyticsReport>(
      `/analytics/performance?${new URLSearchParams({ from, to }).toString()}`
    ),
  benchmarkCatalog: () => request<BenchmarkCatalogItem[]>("/benchmarks"),
  benchmarkPrices: (params: { key?: BenchmarkKey; from?: string; to?: string } = {}) =>
    request<BenchmarkPrice[]>(
      `/benchmarks/prices?${new URLSearchParams(
        Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ).toString()}`
    ),
  addBenchmarkPrice: (body: BenchmarkPriceInput) =>
    request<BenchmarkPrice>("/benchmarks/prices", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  previewBenchmarkImport: (rows: BenchmarkPriceInput[]) =>
    request<BenchmarkImportPreview>("/benchmarks/prices/preview", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),
  commitBenchmarkImport: (rows: BenchmarkPriceInput[]) =>
    request<BenchmarkImportCommitResult>("/benchmarks/prices/commit", {
      method: "POST",
      body: JSON.stringify({ rows, overwriteManual: false }),
    }),
  captureLiveBenchmarks: () =>
    request<BenchmarkLiveCaptureResult>("/benchmarks/capture-live", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  backfillBenchmarks: () =>
    request<BenchmarkBackfillResult>("/benchmarks/backfill", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // Live market data
  marketQuotes: (force = false) =>
    request<MarketSnapshot>(`/market/quotes${force ? "?force=1" : ""}`),

  // Settings & backup
  settings: () => request<Record<string, string>>("/settings"),
  updateSetting: (key: string, value: string) =>
    request<Record<string, string>>("/settings", {
      method: "PUT",
      body: JSON.stringify({ key, value }),
    }),
  createBackup: () => request<{ file: string; size: number }>("/backup", { method: "POST" }),
  listBackups: () =>
    request<{ file: string; size: number; createdAt: string }[]>("/backup/list"),
};

export function exportUrl(path: string): string {
  return `${BASE}/api${path}`;
}
