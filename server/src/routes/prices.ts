import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { serialize } from "../lib/serialize.js";
import { marketKeySchema } from "../schemas.js";
import { audit } from "../services/audit.js";
import { planAssetPriceRefresh, refreshAssetPrices } from "../services/autoPrice.js";

/**
 * Automatic market-price refresh endpoints plus the per-asset quote pin.
 * The plan endpoint is read-only; only refresh writes PriceSnapshots.
 */
export async function priceRoutes(app: FastifyInstance) {
  // Dry-run: which live quote would feed each asset, and at what price.
  app.get("/prices/auto/plan", async (req) => {
    const q = req.query as { assetIds?: string };
    const assetIds = q.assetIds
      ? q.assetIds.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    return serialize(await planAssetPriceRefresh(assetIds));
  });

  // Run the refresh. `dryRun` computes the plan without writing.
  app.post("/prices/auto/refresh", async (req, reply) => {
    const body = (req.body ?? {}) as { dryRun?: boolean; assetIds?: string[] };
    if (body.assetIds != null && !Array.isArray(body.assetIds)) {
      return reply.code(400).send({ error: "assetIds باید آرایه باشد" });
    }
    try {
      const summary = await refreshAssetPrices({
        dryRun: body.dryRun === true,
        assetIds: body.assetIds,
      });
      return serialize(summary);
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // Pin/clear the live quote key that feeds this asset.
  app.put("/assets/:id/market-key", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = marketKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return reply.code(404).send({ error: "دارایی یافت نشد" });

    const marketKey = parsed.data.marketKey?.trim() || null;
    const updated = await prisma.asset.update({ where: { id }, data: { marketKey } });
    await audit("ASSET_MARKET_KEY_SET", "Asset", id, {
      marketKey,
      previousMarketKey: asset.marketKey,
    });
    return serialize(updated);
  });
}
