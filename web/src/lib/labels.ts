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
    FIXED_INCOME: "درآمد ثابت",
    FX: "ارز",
    CASH: "نقد",
    OTHER: "سایر",
    // legacy values from earlier data
    FUND: "صندوق",
    CASH_EQUIV: "معادل نقد",
  };
  return map[cls] ?? cls;
}

/** Ordered list of selectable asset categories (excludes the CASH pseudo-bucket). */
export const ASSET_CLASSES: { value: string; label: string }[] = [
  "CRYPTO",
  "STOCK",
  "ETF",
  "MUTUAL_FUND",
  "GOLD",
  "FIXED_INCOME",
  "FX",
  "CASH",
  "OTHER",
].map((v) => ({ value: v, label: assetClassLabel(v) }));
