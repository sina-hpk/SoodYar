import type { FastifyInstance } from "fastify";
import { serialize } from "../lib/serialize.js";
import { getAnalyticsPerformance } from "../services/analytics.js";

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} باید YYYY-MM-DD باشد.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} نامعتبر است.`);
  return date;
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get("/analytics/performance", async (req, reply) => {
    try {
      const query = req.query as { from?: string; to?: string };
      const from = parseDate(query.from, "from");
      const to = parseDate(query.to, "to");
      return serialize(await getAnalyticsPerformance(from, to));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
}
