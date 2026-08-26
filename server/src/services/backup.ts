import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { bigintReplacer } from "./audit.js";

/**
 * Derives the SQLite file path from DATABASE_URL (e.g. file:./prisma/dev.db).
 * Prisma resolves `file:` URLs relative to the schema directory (prisma/),
 * so we resolve against packageRoot/prisma to match the real file location.
 * Returns null if the DB is not a local SQLite file (e.g. after PG migration).
 */
export function sqliteFilePath(): string | null {
  const url = config.databaseUrl;
  if (!url.startsWith("file:")) return null;
  const rel = url.slice("file:".length);
  return path.resolve(config.packageRoot, "prisma", rel);
}

export function ensureBackupDir(): string {
  const dir = path.resolve(config.packageRoot, config.backupDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Copies the SQLite DB file into the backup directory with a timestamped name. */
export function backupSqlite(): { file: string; size: number } {
  const src = sqliteFilePath();
  if (!src || !fs.existsSync(src)) {
    throw new Error("فایل پایگاه‌داده SQLite یافت نشد");
  }
  const dir = ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `soodyar-backup-${stamp}.db`);
  fs.copyFileSync(src, dest);
  const size = fs.statSync(dest).size;
  return { file: dest, size };
}

export function listBackups(): { file: string; size: number; createdAt: string }[] {
  const dir = ensureBackupDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return { file: f, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ------------------------------ CSV export ---------------------------------

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  // Prepend BOM so Excel opens UTF-8 (Persian) correctly.
  return "\uFEFF" + lines.join("\r\n");
}

export async function exportMemberTransactionsCsv(): Promise<string> {
  const txs = await prisma.memberTransaction.findMany({
    include: { member: true },
    orderBy: { effectiveDate: "desc" },
  });
  return toCsv(
    txs.map((t) => ({
      id: t.id,
      member: t.member.fullName,
      type: t.type,
      status: t.status,
      amountRial: t.amountRial.toString(),
      units: t.units,
      navPerUnit: t.navPerUnit ?? "",
      effectiveDate: t.effectiveDate.toISOString().slice(0, 10),
      description: t.description ?? "",
    }))
  );
}

export async function exportPortfolioTransactionsCsv(): Promise<string> {
  const txs = await prisma.portfolioTransaction.findMany({
    include: { asset: true },
    orderBy: { effectiveDate: "desc" },
  });
  return toCsv(
    txs.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      asset: t.asset?.symbol ?? "",
      quantity: t.quantity,
      pricePerUnitRial: t.pricePerUnit,
      feeRial: t.feeRial.toString(),
      realizedPnlRial: t.realizedPnlRial.toString(),
      cashDeltaRial: t.cashDeltaRial.toString(),
      effectiveDate: t.effectiveDate.toISOString().slice(0, 10),
      description: t.description ?? "",
    }))
  );
}

export async function exportNavHistoryCsv(): Promise<string> {
  const snaps = await prisma.navSnapshot.findMany({ orderBy: { navDate: "asc" } });
  return toCsv(
    snaps.map((s) => ({
      navDate: s.navDate.toISOString().slice(0, 10),
      cashBalanceRial: s.cashBalanceRial.toString(),
      assetsValueRial: s.assetsValueRial.toString(),
      liabilitiesRial: s.liabilitiesRial.toString(),
      totalNavRial: s.totalNavRial.toString(),
      totalActiveUnits: s.totalActiveUnits,
      navPerUnit: s.navPerUnit,
    }))
  );
}

/** Portfolio holdings with derived P&L (uses the live portfolio state). */
export async function exportPortfolioAssetsCsv(): Promise<string> {
  const { getPortfolioState } = await import("./portfolio.js");
  const state = await getPortfolioState();
  return toCsv(
    state.assets.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      category: a.assetClass,
      quantity: a.quantity,
      avgBuyPriceRial: a.avgCostRial,
      currentPriceRial: a.latestPriceRial ?? "",
      marketValueRial: a.marketValueRial,
      remainingCostBasisRial: a.remainingCostBasisRial,
      realizedPnlRial: a.realizedPnlRial,
      unrealizedPnlRial: a.unrealizedPnlRial,
      totalPnlRial: a.totalPnlRial,
      unrealizedReturnPercent: a.unrealizedReturnPercent ?? "",
      allocationPercent: a.weightPercent,
      status: a.isClosed ? "CLOSED" : "OPEN",
    }))
  );
}

/** Members with derived performance figures (uses the live portfolio state). */
export async function exportMembersCsv(): Promise<string> {
  const { getPortfolioState, getMemberSummary } = await import("./portfolio.js");
  const state = await getPortfolioState();
  const members = await prisma.member.findMany({ orderBy: { createdAt: "asc" } });
  const rows = await Promise.all(
    members.map(async (m) => {
      const s = await getMemberSummary(m.id, state);
      return {
        name: m.fullName,
        status: m.status,
        activeUnits: s.activeUnits,
        ownershipPercent: s.ownershipPercent,
        grossDepositsRial: s.totalDepositRial,
        withdrawalsRial: s.totalWithdrawalRial,
        netContributedCapitalRial: s.netContributedCapitalRial,
        currentValueRial: s.currentValueRial,
        simpleNetPnlRial: s.simpleNetPnlRial,
        simpleReturnPercent: s.simpleReturnPercent ?? "",
      };
    })
  );
  return toCsv(rows);
}

export { bigintReplacer };
