import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { numberSizeClass } from "../lib/format";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: string;
}) {
  // Shrink the font as the rendered value grows so big rial numbers don't
  // overflow the card. Only auto-sizes plain string/number values.
  const sizeClass =
    typeof value === "string" || typeof value === "number"
      ? numberSizeClass(String(value))
      : "text-2xl";
  return (
    <div className="card flex items-start justify-between gap-3 p-6">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-500">{label}</div>
        <div
          className={cn(
            "mt-1.5 whitespace-nowrap font-bold leading-tight tabular",
            sizeClass,
            accent
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
      </div>
      {icon && (
        <div className="flex-shrink-0 rounded-lg bg-brand-50 p-2.5 text-brand-600">{icon}</div>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "amber" | "red" | "blue";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return <span className={cn("badge", tones[tone])}>{children}</span>;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
      {children}
    </div>
  );
}

export function RiskNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      ارزش‌ها بر اساس قیمت‌های ثبت‌شده هستند و تضمین سود وجود ندارد.
    </div>
  );
}

/** A neutral informational note box (blue), for analytical disclaimers. */
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
      {children}
    </div>
  );
}
