import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { serialize } from "../lib/serialize.js";
import {
  getPortfolioState,
  getMemberSummary,
  getMemberCategoryExposure,
  getMemberXirr,
} from "../services/portfolio.js";
import {
  exportMemberTransactionsCsv,
  exportPortfolioTransactionsCsv,
  exportNavHistoryCsv,
  exportPortfolioAssetsCsv,
  exportMembersCsv,
} from "../services/backup.js";

export async function reportRoutes(app: FastifyInstance) {
  // Whole-portfolio performance report.
  app.get("/reports/portfolio", async () => {
    const state = await getPortfolioState();
    const members = await prisma.member.findMany();
    const memberSummaries = await Promise.all(
      members.map((m) => getMemberSummary(m.id, state))
    );
    return serialize({
      totalNavRial: state.totalNavRial.toString(),
      navPerUnit: state.navPerUnit.toFixed(8),
      cashBalanceRial: state.cashBalanceRial.toString(),
      assetsValueRial: state.assetsValueRial.toString(),
      totalActiveUnits: state.totalActiveUnits.toFixed(8),
      activeMemberCount: state.activeMemberCount,
      assets: state.assets,
      categories: state.categories,
      members: members.map((m, i) => ({
        id: m.id,
        fullName: m.fullName,
        ...memberSummaries[i],
      })),
    });
  });

  app.get("/reports/member/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const member = await prisma.member.findUnique({ where: { id } });
    if (!member) return reply.code(404).send({ error: "عضو یافت نشد" });
    const state = await getPortfolioState();
    const summary = await getMemberSummary(id, state);
    const exposure = await getMemberCategoryExposure(id, state);
    const xirr = await getMemberXirr(id, state);
    const transactions = await prisma.memberTransaction.findMany({
      where: { memberId: id },
      orderBy: { effectiveDate: "asc" },
    });
    return serialize({ member, summary, exposure, xirr, transactions });
  });

  // Calculation details / audit: shows how NAV, each asset value, and each
  // member's units/value are derived, plus the recent audit log.
  app.get("/reports/audit", async () => {
    const state = await getPortfolioState();
    const members = await prisma.member.findMany({ orderBy: { createdAt: "asc" } });
    const memberSummaries = await Promise.all(
      members.map((m) => getMemberSummary(m.id, state))
    );
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return serialize({
      nav: {
        cashBalanceRial: state.cashBalanceRial.toString(),
        assetsValueRial: state.assetsValueRial.toString(),
        liabilitiesRial: state.liabilitiesRial.toString(),
        totalNavRial: state.totalNavRial.toString(),
        totalActiveUnits: state.totalActiveUnits.toFixed(8),
        navPerUnit: state.navPerUnit.toFixed(8),
      },
      assets: state.assets,
      categories: state.categories,
      members: members.map((m, i) => ({
        id: m.id,
        fullName: m.fullName,
        ...memberSummaries[i],
      })),
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        data: l.data,
        actor: l.actor,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  });

  // ---- CSV exports ----
  function sendCsv(reply: any, filename: string, csv: string) {
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csv);
  }

  app.get("/reports/export/member-transactions.csv", async (_req, reply) => {
    sendCsv(reply, "member-transactions.csv", await exportMemberTransactionsCsv());
  });

  app.get("/reports/export/portfolio-transactions.csv", async (_req, reply) => {
    sendCsv(
      reply,
      "portfolio-transactions.csv",
      await exportPortfolioTransactionsCsv()
    );
  });

  app.get("/reports/export/nav-history.csv", async (_req, reply) => {
    sendCsv(reply, "nav-history.csv", await exportNavHistoryCsv());
  });

  app.get("/reports/export/portfolio-assets.csv", async (_req, reply) => {
    sendCsv(reply, "portfolio-assets.csv", await exportPortfolioAssetsCsv());
  });

  app.get("/reports/export/members.csv", async (_req, reply) => {
    sendCsv(reply, "members.csv", await exportMembersCsv());
  });
}
