import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { serialize } from "../lib/serialize.js";
import { assetCreateSchema, assetUpdateSchema, priceSchema } from "../schemas.js";
import { audit } from "../services/audit.js";
import { getPortfolioState } from "../services/portfolio.js";
import { recordPrice } from "../services/assetTx.js";
import { toDecimal } from "../lib/money.js";

export async function assetRoutes(app: FastifyInstance) {
  // Assets with live valuation (quantity, avg cost, latest price, market value).
  app.get("/assets", async () => {
    const state = await getPortfolioState();
    return serialize(state.assets);
  });

  app.get("/assets/raw", async () => {
    const assets = await prisma.asset.findMany({ orderBy: { symbol: "asc" } });
    return serialize(assets);
  });

  app.post("/assets", async (req, reply) => {
    const parsed = assetCreateSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const asset = await prisma.asset.create({ data: parsed.data });
      await audit("ASSET_CREATE", "Asset", asset.id, parsed.data);
      return serialize(asset);
    } catch {
      return reply.code(400).send({ error: "نماد تکراری است" });
    }
  });

  app.put("/assets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = assetUpdateSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    const asset = await prisma.asset.update({ where: { id }, data: parsed.data });
    await audit("ASSET_UPDATE", "Asset", id, parsed.data);
    return serialize(asset);
  });

  // Hard-delete an asset. Only allowed when nothing depends on it: no portfolio
  // transactions at all and no holdings. An asset that was ever traded must stay,
  // because cash balance, NAV and realized P&L are reconstructed from that ledger.
  // This exists so a mistyped asset can be removed instead of lingering in
  // Closed Positions forever.
  app.delete("/assets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return reply.code(404).send({ error: "دارایی یافت نشد" });

    const txCount = await prisma.portfolioTransaction.count({
      where: { assetId: id },
    });
    if (txCount > 0) {
      return reply.code(409).send({
        error:
          "این دارایی تراکنش ثبت‌شده دارد و برای حفظ صحت محاسبات NAV قابل حذف نیست. به‌جای حذف، آن را «غیرفعال» کنید.",
      });
    }
    if (toDecimal(asset.quantity).gt(0)) {
      return reply
        .code(409)
        .send({ error: "این دارایی موجودی دارد؛ ابتدا آن را بفروشید." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.priceSnapshot.deleteMany({ where: { assetId: id } });
      await tx.asset.delete({ where: { id } });
    });
    await audit("ASSET_DELETE", "Asset", id, {
      symbol: asset.symbol,
      name: asset.name,
    });
    return serialize({ ok: true });
  });

  // Record a manual daily price for an asset.
  app.post("/prices", async (req, reply) => {
    const parsed = priceSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    const { assetId, priceRial, priceDate, source, sourceRef, note } = parsed.data;
    const snap = await recordPrice(assetId, priceRial, priceDate, {
      source,
      sourceRef,
      note,
    });
    return serialize(snap);
  });

  app.get("/prices/:assetId", async (req) => {
    const { assetId } = req.params as { assetId: string };
    const prices = await prisma.priceSnapshot.findMany({
      where: { assetId },
      orderBy: { priceDate: "desc" },
    });
    return serialize(prices);
  });
}
