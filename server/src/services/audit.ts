import { prisma } from "../db.js";

/**
 * Records an audit entry. All state-changing operations should call this so
 * the ledger is reconstructable and dated (rule #11).
 */
export async function audit(
  action: string,
  entityType: string,
  entityId: string | null,
  data: unknown,
  actor = "system"
) {
  await prisma.auditLog.create({
    data: {
      action,
      entityType,
      entityId: entityId ?? undefined,
      data: data ? JSON.stringify(data, bigintReplacer) : undefined,
      actor,
    },
  });
}

/** JSON replacer that renders BigInt as a plain string. */
export function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
