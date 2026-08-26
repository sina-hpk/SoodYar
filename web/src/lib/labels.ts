// Shared Persian labels and status tones for transaction types.

export function txTypeLabel(type: string): string {
  const map: Record<string, string> = {
    DEPOSIT: "واریز",
    WITHDRAWAL_REQUEST: "درخواست برداشت",
    WITHDRAWAL_SETTLEMENT: "تسویه برداشت",
    UNIT_ISSUANCE: "صدور واحد",
    UNIT_REDEMPTION: "ابطال واحد",
    ADJUSTMENT: "اصلاحیه",
    BUY: "خرید",
    SELL: "فروش",
    FEE: "کارمزد",
    DIVIDEND: "سود نقدی",
    CASH_ADJUSTMENT: "تعدیل نقدی",
  };
  return map[type] ?? type;
}

export function txStatusLabel(status: string): string {
  const map: Record<string, string> = {
    CONFIRMED: "تأییدشده",
    PENDING: "در انتظار",
    SETTLED: "تسویه‌شده",
    CANCELLED: "لغوشده",
  };
  return map[status] ?? status;
}

export function txStatusTone(
  status: string
): "slate" | "green" | "amber" | "red" | "blue" {
  const map: Record<string, "slate" | "green" | "amber" | "red" | "blue"> = {
    CONFIRMED: "green",
    PENDING: "amber",
    SETTLED: "blue",
    CANCELLED: "red",
  };
  return map[status] ?? "slate";
}

export function assetClassLabel(cls: string): string {
  const map: Record<string, string> = {
    CRYPTO: "رمزارز",
    STOCK: "سهام",
    ETF: "صندوق قابل معامله (ETF)",
    MUTUAL_FUND: "صندوق سرمایه‌گذاری",
    GOLD: "طلا",
    COIN: "سکه",
    SILVER: "نقره",
    COMMODITY: "کالا (نفت، فلزات، کشاورزی)",
    FIXED_INCOME: "درآمد ثابت / سپرده",
    BOND: "اوراق قرضه/مشارکت",
    FX: "ارز",
    REAL_ESTATE: "املاک و مستغلات",
    VEHICLE: "خودرو",
    PRIVATE_EQUITY: "سرمایه‌گذاری در کسب‌وکار خصوصی",
    COLLECTIBLE: "کالای کلکسیونی (هنر، عتیقه)",
    CASH: "نقد",
    OTHER: "سایر",
    // legacy values from earlier data
    FUND: "صندوق",
    CASH_EQUIV: "معادل نقد",
  };
  return map[cls] ?? cls;
}

/** Ordered list of selectable asset categories (includes CASH for manual cash-like holdings). */
export const ASSET_CLASSES: { value: string; label: string }[] = [
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
].map((v) => ({ value: v, label: assetClassLabel(v) }));
