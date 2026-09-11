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
import { marketRoutes } from "./routes/market.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { benchmarkRoutes } from "./routes/benchmarks.js";
import { priceRoutes } from "./routes/prices.js";
import { SETTING_KEYS } from "./config.js";
import { getSetting } from "./services/settings.js";
import { refreshAssetPrices } from "./services/autoPrice.js";

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
      await priceRoutes(api);
      await transactionRoutes(api);
      await navRoutes(api);
      await reportRoutes(api);
      await settingsRoutes(api);
      await marketRoutes(api);
      await analyticsRoutes(api);
      await benchmarkRoutes(api);
    },
    { prefix: "/api" }
  );

  return app;
}

// ---------------------------------------------------------------------------
// Automatic price refresh scheduler
// ---------------------------------------------------------------------------

let autoPriceTimer: NodeJS.Timeout | null = null;

/**
 * One scheduler cycle. Re-reads the interval each time so changing the setting
 * takes effect without a restart; a value of 0 disables refreshing but keeps a
 * slow poll alive so re-enabling also needs no restart. Failures are logged and
 * swallowed — the API must never go down because an upstream quote source did.
 */
async function autoPriceCycle() {
  let minutes = 0;
  try {
    minutes = Number(await getSetting(SETTING_KEYS.AUTO_PRICE_REFRESH_MINUTES)) || 0;
  } catch (e) {
    console.error("[auto-price] reading interval failed:", (e as Error).message);
  }

  if (minutes > 0) {
    try {
      const summary = await refreshAssetPrices({});
      console.log(
        `[auto-price] updated=${summary.updated} skipped=${summary.skipped} unmatched=${summary.unmatched}`
      );
    } catch (e) {
      console.error("[auto-price] refresh failed:", (e as Error).message);
    }
    autoPriceTimer = setTimeout(autoPriceCycle, minutes * 60_000);
  } else {
    autoPriceTimer = setTimeout(autoPriceCycle, 60_000);
  }
  autoPriceTimer.unref?.();
}

function startAutoPriceScheduler() {
  autoPriceTimer = setTimeout(autoPriceCycle, 1_000);
  autoPriceTimer.unref?.();
}

function stopAutoPriceScheduler() {
  if (autoPriceTimer) clearTimeout(autoPriceTimer);
  autoPriceTimer = null;
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

  startAutoPriceScheduler();

  const shutdown = async () => {
    stopAutoPriceScheduler();
    await app.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
