import { PrismaClient } from "@prisma/client";

/**
 * Wipes all user data but keeps the schema and restores default app settings.
 * Use when you want to start fresh without reseeding sample data.
 */

const prisma = new PrismaClient();

async function main() {
  console.log("در حال پاک‌سازی داده‌ها…");
  await prisma.auditLog.deleteMany();
  await prisma.navSnapshot.deleteMany();
  await prisma.priceSnapshot.deleteMany();
  await prisma.portfolioTransaction.deleteMany();
  await prisma.memberTransaction.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.member.deleteMany();
  await prisma.appSetting.deleteMany();

  await prisma.appSetting.createMany({
    data: [
      { key: "default_nav_per_unit", value: "1000000" },
      { key: "currency", value: "RIAL" },
      { key: "withdrawal_wait_days", value: "3" },
      { key: "backup_enabled", value: "true" },
    ],
  });

  console.log("پاک‌سازی کامل شد. پایگاه‌داده خالی و آمادهٔ استفاده است.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
