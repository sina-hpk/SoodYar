import type { FastifyInstance } from "fastify";
import { serialize } from "../lib/serialize.js";
import { navCommitSchema } from "../schemas.js";
import {
  previewNav,
  commitNavSnapshot,
  listNavSnapshots,
} from "../services/nav.js";
import { getPortfolioState } from "../services/portfolio.js";
import { decToString } from "../lib/money.js";

export async function navRoutes(app: FastifyInstance) {
  // Dashboard summary (live state).
  app.get("/dashboard", async () => {
    const state = await getPortfolioState();
    return serialize({
      totalNavRial: state.totalNavRial.toString(),
      navPerUnit: decToString(state.navPerUnit),
      cashBalanceRial: state.cashBalanceRial.toString(),
      assetsValueRial: state.assetsValueRial.toString(),
      activeMemberCount: state.activeMemberCount,
      totalActiveUnits: decToString(state.totalActiveUnits),
      assets: state.assets,
      categories: state.categories,
    });
  });

  // Live NAV preview (no write).
  app.get("/nav/preview", async () => {
    return serialize(await previewNav());
  });

  // Commit a dated NAV snapshot (blocks same-day duplicates unless overwrite).
  app.post("/nav/commit", async (req, reply) => {
    const parsed = navCommitSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const snap = await commitNavSnapshot(parsed.data.navDate, {
        liabilitiesRial: parsed.data.liabilitiesRial,
        note: parsed.data.note,
        overwrite: parsed.data.overwrite,
      });
      return serialize(snap);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.get("/nav/history", async (req) => {
    const q = req.query as { from?: string; to?: string };
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    return serialize(await listNavSnapshots(from, to));
  });
}
