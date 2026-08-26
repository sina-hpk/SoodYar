import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { disconnectDb } from "./db.js";
import { memberRoutes } from "./routes/members.js";
import { assetRoutes } from "./routes/assets.js";
import { transactionRoutes } from "./routes/transactions.js";
import { navRoutes } from "./routes/nav.js";
import { reportRoutes } from "./routes/reports.js";
import { settingsRoutes } from "./routes/settings.js";

export async function buildServer() {
  const app = Fastify({
    logger: config.nodeEnv === "development",
  });

  await app.register(cors, { origin: config.corsOrigin });

  app.get("/api/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  // All API routes are namespaced under /api.
  await app.register(
    async (api) => {
      await memberRoutes(api);
      await assetRoutes(api);
      await transactionRoutes(api);
      await navRoutes(api);
      await reportRoutes(api);
      await settingsRoutes(api);
    },
    { prefix: "/api" }
  );

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log?.info?.(`SoodYar API listening on http://${config.host}:${config.port}`);
    console.log(`SoodYar API listening on http://localhost:${config.port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  const shutdown = async () => {
    await app.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
