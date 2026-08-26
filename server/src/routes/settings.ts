import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { serialize } from "../lib/serialize.js";
import { settingSchema } from "../schemas.js";
import { getAllSettings, setSetting } from "../services/settings.js";
import { backupSqlite, listBackups, ensureBackupDir } from "../services/backup.js";
import { audit } from "../services/audit.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/settings", async () => {
    return serialize(await getAllSettings());
  });

  app.put("/settings", async (req, reply) => {
    const parsed = settingSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });
    await setSetting(parsed.data.key, parsed.data.value);
    await audit("SETTING_UPDATE", "AppSetting", parsed.data.key, parsed.data);
    return serialize(await getAllSettings());
  });

  // ---- Backup ----
  app.post("/backup", async (_req, reply) => {
    try {
      const result = backupSqlite();
      await audit("BACKUP_CREATE", "System", null, {
        file: path.basename(result.file),
        size: result.size,
      });
      return serialize({
        file: path.basename(result.file),
        size: result.size,
      });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/backup/list", async () => {
    return serialize(listBackups());
  });

  // Download a specific backup file.
  app.get("/backup/download/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    // Prevent path traversal.
    const safe = path.basename(file);
    const dir = ensureBackupDir();
    const full = path.join(dir, safe);
    if (!fs.existsSync(full)) {
      return reply.code(404).send({ error: "فایل بکاپ یافت نشد" });
    }
    const stream = fs.createReadStream(full);
    reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${safe}"`);
    return reply.send(stream);
  });
}
