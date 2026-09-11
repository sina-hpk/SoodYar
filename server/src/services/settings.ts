import { prisma } from "../db.js";
import { SETTING_KEYS, config } from "../config.js";

const DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.DEFAULT_NAV_PER_UNIT]: config.defaultNavPerUnit,
  [SETTING_KEYS.CURRENCY]: "RIAL",
  [SETTING_KEYS.WITHDRAWAL_WAIT_DAYS]: "3",
  [SETTING_KEYS.BACKUP_ENABLED]: "true",
  [SETTING_KEYS.AUTO_PRICE_REFRESH_MINUTES]: "60",
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? "";
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.appSetting.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getDefaultNavPerUnit(): Promise<bigint> {
  const v = await getSetting(SETTING_KEYS.DEFAULT_NAV_PER_UNIT);
  return BigInt(v || config.defaultNavPerUnit);
}
