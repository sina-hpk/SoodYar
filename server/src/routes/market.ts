import type { FastifyInstance } from "fastify";
import { serialize } from "../lib/serialize.js";
import { getMarketSnapshot } from "../services/market.js";

export async function marketRoutes(app: FastifyInstance) {
  // Live market quotes (FX, gold, coins, silver, crypto) normalized to rial.
  // Read-only; cached upstream for a short TTL. `?force=1` bypasses the cache.
  app.get("/market/quotes", async (req) => {
    const q = req.query as { force?: string };
    const force = q.force === "1" || q.force === "true";
    const snapshot = await getMarketSnapshot(force);
    return serialize(snapshot);
  });
}
