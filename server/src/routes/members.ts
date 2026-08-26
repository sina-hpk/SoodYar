import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { serialize } from "../lib/serialize.js";
import { memberCreateSchema, memberUpdateSchema } from "../schemas.js";
import { audit } from "../services/audit.js";
import {
  getMemberSummary,
  getPortfolioState,
  getMemberCategoryExposure,
  getMemberXirr,
} from "../services/portfolio.js";

export async function memberRoutes(app: FastifyInstance) {
  // List members with derived summary values.
  app.get("/members", async () => {
    const [members, state] = await Promise.all([
      prisma.member.findMany({ orderBy: { createdAt: "asc" } }),
      getPortfolioState(),
    ]);
    const rows = await Promise.all(
      members.map(async (m) => ({
        ...m,
        summary: await getMemberSummary(m.id, state),
      }))
    );
    return serialize(rows);
  });

  app.get("/members/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const member = await prisma.member.findUnique({ where: { id } });
    if (!member) return reply.code(404).send({ error: "عضو یافت نشد" });
    const state = await getPortfolioState();
    const summary = await getMemberSummary(id, state);
    const exposure = await getMemberCategoryExposure(id, state);
    const xirr = await getMemberXirr(id, state);
    const transactions = await prisma.memberTransaction.findMany({
      where: { memberId: id },
      orderBy: { effectiveDate: "desc" },
    });
    return serialize({ member, summary, exposure, xirr, transactions });
  });

  app.post("/members", async (req, reply) => {
    const parsed = memberCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const data = parsed.data;
    const member = await prisma.member.create({
      data: { ...data, email: data.email || null },
    });
    await audit("MEMBER_CREATE", "Member", member.id, data);
    return serialize(member);
  });

  app.put("/members/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = memberUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const member = await prisma.member.update({
      where: { id },
      data: parsed.data,
    });
    await audit("MEMBER_UPDATE", "Member", id, parsed.data);
    return serialize(member);
  });
}
