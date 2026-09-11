import type { FastifyInstance } from "fastify";
import { serialize } from "../lib/serialize.js";
import {
  backfillBenchmarksFromTgjuHistory,
  captureLiveBenchmarks,
  commitBenchmarkImport,
  commitSingleBenchmarkPrice,
  getBenchmarkCoverage,
  isBenchmarkKey,
  listBenchmarkPrices,
  listBenchmarks,
  previewBenchmarkImport,
} from "../services/benchmarks.js";

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (value == null || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} باید YYYY-MM-DD باشد.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} نامعتبر است.`);
  return date;
}

export async function benchmarkRoutes(app: FastifyInstance) {
  app.get("/benchmarks", async () => serialize(await listBenchmarks()));

  app.get("/benchmarks/coverage", async (req, reply) => {
    try {
      const query = req.query as { from?: string; to?: string };
      const from = parseDate(query.from, "from");
      const to = parseDate(query.to, "to");
      if (!from || !to) return reply.code(400).send({ error: "from و to الزامی هستند." });
      if (from > to) return reply.code(400).send({ error: "from نباید بعد از to باشد." });
      return serialize(await getBenchmarkCoverage(from, to));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/benchmarks/:key/prices", async (req, reply) => {
    try {
      const { key } = req.params as { key: string };
      if (!isBenchmarkKey(key)) return reply.code(404).send({ error: "شاخص یافت نشد." });
      const query = req.query as { from?: string; to?: string };
      const from = parseDate(query.from, "from");
      const to = parseDate(query.to, "to");
      if (from && to && from > to) {
        return reply.code(400).send({ error: "from نباید بعد از to باشد." });
      }
      return serialize(await listBenchmarkPrices(key, from, to));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/benchmarks/prices", async (req, reply) => {
    try {
      const body = req.body as {
        key?: string;
        date?: string;
        priceRial?: string;
        source?: string;
      };
      return serialize(
        await commitSingleBenchmarkPrice({
          key: String(body?.key ?? ""),
          date: String(body?.date ?? ""),
          priceRial: String(body?.priceRial ?? ""),
          source: body?.source,
        })
      );
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  });

  app.post("/benchmarks/backfill", async (_req, reply) => {
    try {
      return serialize(await backfillBenchmarksFromTgjuHistory());
    } catch (error) {
      return reply.code(502).send({ error: (error as Error).message });
    }
  });

  app.post("/benchmarks/capture-live", async (_req, reply) => {
    try {
      return serialize(await captureLiveBenchmarks());
    } catch (error) {
      return reply.code(502).send({ error: (error as Error).message });
    }
  });

  app.post("/benchmarks/prices/preview", async (req, reply) => {
    const body = req.body as { rows?: unknown[] };
    if (!Array.isArray(body?.rows)) {
      return reply.code(400).send({ error: "rows باید آرایه باشد." });
    }
    return serialize(await previewBenchmarkImport(body.rows));
  });

  app.post("/benchmarks/prices/commit", async (req, reply) => {
    try {
      const body = req.body as {
        rows?: unknown[];
        overwriteManual?: boolean;
        ingestMethod?: "MANUAL_JSON" | "CSV_JSON";
      };
      if (!Array.isArray(body?.rows)) {
        return reply.code(400).send({ error: "rows باید آرایه باشد." });
      }
      if (body.ingestMethod && !["MANUAL_JSON", "CSV_JSON"].includes(body.ingestMethod)) {
        return reply.code(400).send({ error: "ingestMethod نامعتبر است." });
      }
      return serialize(
        await commitBenchmarkImport({
          rows: body.rows,
          overwriteManual: body.overwriteManual === true,
          ingestMethod: body.ingestMethod,
        })
      );
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  });
}
