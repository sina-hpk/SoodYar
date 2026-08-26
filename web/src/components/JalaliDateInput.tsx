import { useEffect, useState } from "react";
import { isoToJalaliInput, jalaliInputToIso, toPersianDigits } from "../lib/format";
import { cn } from "../lib/cn";

/**
 * A text-based Jalali (Persian) date input. The parent still stores an ISO
 * yyyy-MM-dd string (so the API and all server logic stay unchanged); this
 * component only converts to/from a Jalali yyyy/MM/dd display value. Invalid or
 * incomplete input leaves the stored ISO value untouched and shows a hint.
 */
export function JalaliDateInput({
  value,
  onChange,
  className,
}: {
  value: string; // ISO yyyy-MM-dd
  onChange: (iso: string) => void;
  className?: string;
}) {
  const [text, setText] = useState(() => isoToJalaliInput(value));
  const [invalid, setInvalid] = useState(false);

  // Keep the visible Jalali text in sync when the ISO value changes externally
  // (e.g. a form reset) without clobbering what the user is mid-typing.
  useEffect(() => {
    const asJalali = isoToJalaliInput(value);
    if (jalaliInputToIso(text) !== value) {
      setText(asJalali);
      setInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    const iso = jalaliInputToIso(raw);
    if (iso) {
      setInvalid(false);
      onChange(iso);
    } else {
      setInvalid(raw.trim().length > 0);
    }
  }

  return (
    <div>
      <input
        className={cn("input tabular", invalid && "border-red-400 focus:border-red-500", className)}
        value={toPersianDigits(text)}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="۱۴۰۵/۰۶/۰۴"
        inputMode="numeric"
        dir="ltr"
      />
      {invalid && (
        <p className="mt-1 text-xs text-red-500">تاریخ شمسی نامعتبر است (مثال: ۱۴۰۵/۰۶/۰۴).</p>
      )}
    </div>
  );
}
