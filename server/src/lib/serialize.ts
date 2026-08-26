import { bigintReplacer } from "../services/audit.js";

/**
 * Recursively converts BigInt fields to strings so Fastify's JSON serializer
 * can emit them (JSON has no BigInt). Prisma Dates become ISO strings.
 */
export function serialize<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, bigintReplacer));
}
