import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  backupDir: process.env.BACKUP_DIR ?? "./backups",
  defaultNavPerUnit: process.env.DEFAULT_NAV_PER_UNIT ?? "1000000",
  // Absolute path to the server package root (one level above src/dist).
  packageRoot: path.resolve(__dirname, ".."),
};

export const SETTING_KEYS = {
  DEFAULT_NAV_PER_UNIT: "default_nav_per_unit",
  CURRENCY: "currency", // "RIAL" | "TOMAN" (display only; storage always rial)
  WITHDRAWAL_WAIT_DAYS: "withdrawal_wait_days",
  BACKUP_ENABLED: "backup_enabled",
} as const;
