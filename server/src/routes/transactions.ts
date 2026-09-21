import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { serialize } from "../lib/serialize.js";
import {
  depositSchema,
  withdrawalRequestSchema,
  settleSchema,
  buySchema,
  sellSchema,
  cashOpSchema,
  contributionSchema,
} from "../schemas.js";
import {
  createDeposit,
  createWithdrawalRequest,
  settleWithdrawal,
  cancelWithdrawalRequest,
  createInKindContribution,
} from "../services/memberTx.js";
import { buyAsset, sellAsset, cashOperation } from "../services/assetTx.js";

export async function transactionRoutes(app: FastifyInstance) {
  // ---- Combined, filterable transaction feed ----
  app.get("/transactions/member", async (req) => {
    const q = req.query as {
      memberId?: string;
      type?: string;
      status?: string;
      search?: string;
    };
    const txs = await prisma.memberTransaction.findMany({
      where: {
        memberId: q.memberId || undefined,
        type: q.type || undefined,
        status: q.status || undefined,
      },
      include: { member: true },
      orderBy: { effectiveDate: "desc" },
    });
    const filtered = q.search
      ? txs.filter(
          (t) =>
            t.member.fullName.includes(q.search!) ||
            (t.description ?? "").includes(q.search!)
        )
      : txs;
    return serialize(filtered);
  });

  app.get("/transactions/portfolio", async (req) => {
    const q = req.query as { type?: string; assetId?: string };
    const txs = await prisma.portfolioTransaction.findMany({
      where: { type: q.type || undefined, assetId: q.assetId || undefined },
      include: { asset: true },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
    });
    return serialize(txs);
  });

  // ---- Member capital operations ----
  app.post("/transactions/deposit", async (req, reply) => {
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await createDeposit(parsed.data);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // In-kind contribution: member brings a non-cash asset (deposit + buy + price).
  app.post("/transactions/contribution", async (req, reply) => {
    const parsed = contributionSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await createInKindContribution(parsed.data);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post("/transactions/withdrawal-request", async (req, reply) => {    const parsed = withdrawalRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await createWithdrawalRequest(parsed.data);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post("/transactions/withdrawal/:id/settle", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = settleSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await settleWithdrawal(id, parsed.data.settleDate);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post("/transactions/withdrawal/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await cancelWithdrawalRequest(id);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- Portfolio asset operations ----
  app.post("/transactions/buy", async (req, reply) => {
    const parsed = buySchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await buyAsset(parsed.data);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post("/transactions/sell", async (req, reply) => {
    const parsed = sellSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await sellAsset(parsed.data);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post("/transactions/cash-op", async (req, reply) => {
    const parsed = cashOpSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await cashOperation(parsed.data);
      return serialize(result);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
