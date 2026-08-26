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

  // Assets & prices
  assets: () => request<AssetValuation[]>("/assets"),
  assetsRaw: () => request<any[]>("/assets/raw"),
  createAsset: (body: Record<string, unknown>) =>
    request("/assets", { method: "POST", body: JSON.stringify(body) }),
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

  // Reports
  portfolioReport: () => request<any>("/reports/portfolio"),
  memberReport: (id: string) => request<any>(`/reports/member/${id}`),
  auditReport: () => request<AuditReport>("/reports/audit"),

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
