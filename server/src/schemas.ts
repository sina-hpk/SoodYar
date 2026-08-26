import { z } from "zod";

/** Rial amount: accepts integer-like strings/numbers, stored as BigInt. */
export const rialSchema = z
  .union([z.string(), z.number()])
  .transform((v) => BigInt(Math.round(Number(v))))
  .refine((v) => v >= 0n, { message: "مبلغ نباید منفی باشد" });

export const signedRialSchema = z
  .union([z.string(), z.number()])
  .transform((v) => BigInt(Math.round(Number(v))));

/** Decimal string for units/quantity. Positive. */
export const decimalStringSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), { message: "مقدار نامعتبر است" });

export const isoDateSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "تاریخ نامعتبر است" })
  .transform((v) => new Date(v));

export const memberCreateSchema = z.object({
  fullName: z.string().min(2, "نام باید حداقل ۲ نویسه باشد"),
  nationalId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("ایمیل نامعتبر").optional().or(z.literal("")),
  joinDate: isoDateSchema,
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  notes: z.string().optional(),
});

export const memberUpdateSchema = memberCreateSchema.partial();

export const assetClassEnum = z.enum([
  "CRYPTO",
  "STOCK",
  "ETF",
  "MUTUAL_FUND",
  "GOLD",
  "COIN",
  "SILVER",
  "COMMODITY",
  "FIXED_INCOME",
  "BOND",
  "FX",
  "REAL_ESTATE",
  "VEHICLE",
  "PRIVATE_EQUITY",
  "COLLECTIBLE",
  "CASH",
  "OTHER",
]);

export const assetCreateSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  assetClass: assetClassEnum.default("OTHER"),
});

export const assetUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  assetClass: assetClassEnum.optional(),
  isActive: z.boolean().optional(),
});

export const depositSchema = z.object({
  memberId: z.string().min(1),
  amountRial: rialSchema,
  effectiveDate: isoDateSchema,
  description: z.string().optional(),
});

export const withdrawalRequestSchema = z
  .object({
    memberId: z.string().min(1),
    units: decimalStringSchema.optional(),
    amountRial: rialSchema.optional(),
    effectiveDate: isoDateSchema,
    description: z.string().optional(),
  })
  .refine((d) => d.units != null || d.amountRial != null, {
    message: "واحد یا مبلغ برداشت لازم است",
  });

export const settleSchema = z.object({
  settleDate: isoDateSchema,
});

export const buySchema = z.object({
  assetId: z.string().min(1),
  quantity: decimalStringSchema,
  pricePerUnitRial: rialSchema,
  feeRial: rialSchema.optional(),
  effectiveDate: isoDateSchema,
  description: z.string().optional(),
});

export const sellSchema = buySchema;

export const cashOpSchema = z.object({
  type: z.enum(["FEE", "DIVIDEND", "CASH_ADJUSTMENT"]),
  amountRial: signedRialSchema,
  assetId: z.string().optional(),
  effectiveDate: isoDateSchema,
  description: z.string().optional(),
});

export const priceSchema = z.object({
  assetId: z.string().min(1),
  priceRial: rialSchema,
  priceDate: isoDateSchema,
  source: z.enum(["MANUAL", "API"]).optional().default("MANUAL"),
  sourceRef: z.string().optional(),
  note: z.string().optional(),
});

export const navCommitSchema = z.object({
  navDate: isoDateSchema,
  liabilitiesRial: rialSchema.optional(),
  note: z.string().optional(),
  overwrite: z.boolean().optional().default(false),
});

export const settingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
