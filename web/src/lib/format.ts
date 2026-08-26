import { format as formatJalali, parse as parseJalali } from "date-fns-jalali";

/**
 * Formatting helpers. Money is handled as string/BigInt-safe: rial values arrive
 * from the API as decimal strings of integers; we never parse them into JS floats
 * for storage, only for display formatting.
 */

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** Groups a (possibly huge) integer string with thousands separators. */
function groupThousands(intStr: string): string {
  const neg = intStr.startsWith("-");
  const digits = neg ? intStr.slice(1) : intStr;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, "،");
  return (neg ? "-" : "") + grouped;
}

export type Currency = "RIAL" | "TOMAN";

/**
 * Formats a monetary value for display. Values arrive as integer rial strings
 * (e.g. "296000000") but may also be decimal strings such as navPerUnit
 * ("1342545.45468063"), so only the integer part is thousands-grouped and the
 * fractional part is preserved verbatim. If currency is TOMAN, the value is
 * divided by 10 (display only), shifting the decimal point one place left.
 */
export function formatMoney(
  rialStr: string | number | bigint,
  currency: Currency = "RIAL"
): string {
  let s = String(rialStr ?? "0").trim();
  if (s === "") s = "0";
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);

  let [intPart, fracPart = ""] = s.split(".");
  intPart = intPart || "0";

  if (currency === "TOMAN") {
    // Divide by 10 without floats: move the decimal point one digit left.
    const combined = intPart + fracPart;
    const newFracLen = fracPart.length + 1;
    const padded = combined.padStart(newFracLen + 1, "0");
    intPart = padded.slice(0, padded.length - newFracLen);
    fracPart = padded.slice(padded.length - newFracLen).replace(/0+$/, "");
  }

  intPart = intPart.replace(/^0+(?=\d)/, "");
  let out = groupThousands(intPart);
  if (fracPart) out += "." + fracPart;
  const unit = currency === "TOMAN" ? "تومان" : "ریال";
  return `${toPersianDigits((neg ? "-" : "") + out)} ${unit}`;
}

/** Formats a decimal-string unit value with up to `dp` fractional digits. */
export function formatUnits(value: string | number, dp = 4): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return toPersianDigits(String(value));
  const fixed = n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
  return toPersianDigits(fixed);
}

export function formatPercent(value: string | number, dp = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return toPersianDigits(String(value)) + "٪";
  return toPersianDigits(n.toFixed(dp)) + "٪";
}

/** Converts an ISO date string to a Jalali (Persian) date string. */
export function toJalali(iso: string | Date, pattern = "yyyy/MM/dd"): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "-";
  return toPersianDigits(formatJalali(d, pattern));
}

/** Today's date as an ISO yyyy-MM-dd (for date inputs). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's date as a Jalali yyyy/MM/dd string (Latin digits, for inputs). */
export function todayJalali(): string {
  return formatJalali(new Date(), "yyyy/MM/dd");
}

/** Converts an ISO date (yyyy-MM-dd) to a Jalali yyyy/MM/dd string (Latin digits). */
export function isoToJalaliInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatJalali(d, "yyyy/MM/dd");
}

/**
 * Parses a Jalali date string (accepts Persian or Latin digits and / - . or ／
 * separators) into an ISO yyyy-MM-dd string suitable for the API. Returns null
 * when the input is not a valid, complete Jalali date.
 */
export function jalaliInputToIso(input: string): string | null {
  if (!input) return null;
  // Normalize Persian/Arabic digits to Latin and unify separators to "/".
  const latin = input
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[-.،؍／]/g, "/")
    .trim();
  const m = latin.match(/^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, da] = m;
  const normalized = `${y.padStart(4, "0")}/${mo.padStart(2, "0")}/${da.padStart(2, "0")}`;
  const date = parseJalali(normalized, "yyyy/MM/dd", new Date());
  if (Number.isNaN(date.getTime())) return null;
  // Round-trip guard: reject values like 1405/13/40 that JS "overflows".
  if (formatJalali(date, "yyyy/MM/dd") !== normalized) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Picks a Tailwind font-size class that shrinks as the rendered numeric string
 * grows, so large monetary values stay on a single line without overflowing
 * their card. Tuned for Persian money strings that include grouping separators
 * and a currency suffix. Values are kept on one line (whitespace-nowrap), so the
 * smaller tiers matter for very long decimals such as navPerUnit.
 */
export function numberSizeClass(text: string): string {
  const len = text.length;
  if (len <= 13) return "text-2xl";
  if (len <= 16) return "text-xl";
  if (len <= 18) return "text-lg";
  if (len <= 20) return "text-base";
  if (len <= 22) return "text-sm";
  if (len <= 30) return "text-xs";
  return "text-[10px]";
}
