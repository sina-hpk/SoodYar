import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function disconnectDb() {
  await prisma.$disconnect();
}
