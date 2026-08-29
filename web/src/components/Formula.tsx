/**
 * Visual formula renderer for the glossary/help pages.
 *
 * A formula is described structurally (result = operand op operand …) instead of
 * as a plain string, so each part can be shown as its own chip with a caption
 * and each operator gets a consistent color: افزودن (سبز)، کاستن (قرمز)،
 * ضرب (بنفش)، تقسیم (آبی). Parenthesized parts are drawn as a dashed group box
 * so priority of operations is visible without reading parentheses.
 */

export type FormulaOp = "+" | "−" | "×" | "÷";

export interface FormulaOperand {
  /** Operator shown before this operand; omit for the first operand. */
  op?: FormulaOp;
  /** Operand text. Omit when `group` is used. */
  label?: string;
  /** Small caption under the operand explaining it in plain words. */
  hint?: string;
  /** A sub-expression that is calculated first (shown as a dashed box). */
  group?: FormulaOperand[];
}

export interface FormulaSpec {
  /** Left-hand side: the value being calculated. */
  result: string;
  /** Right-hand side, in order. */
  terms: FormulaOperand[];
  /** A worked line with real numbers. */
  example?: string;
  /** Label shown before `example` (default: «مثال عددی»). */
  exampleLabel?: string;
}

const OP_STYLE: Record<FormulaOp, string> = {
  "+": "border-emerald-200 bg-emerald-50 text-emerald-600",
  "−": "border-rose-200 bg-rose-50 text-rose-600",
  "×": "border-violet-200 bg-violet-50 text-violet-600",
  "÷": "border-sky-200 bg-sky-50 text-sky-600",
};

function Operator({ op }: { op: FormulaOp }) {
  return (
    <span
      className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-sm font-bold leading-none ${OP_STYLE[op]}`}
      aria-hidden="true"
    >
      {op}
    </span>
  );
}

function Operand({ item }: { item: FormulaOperand }) {
  if (item.group) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white/70 px-1.5 py-1">
        {item.group.map((g, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            {g.op && <Operator op={g.op} />}
            <Operand item={g} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="inline-block rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-center text-sm text-slate-700 shadow-sm">
      {item.label}
      {item.hint && (
        <span className="mt-0.5 block text-[10px] font-normal leading-4 text-slate-400">
          {item.hint}
        </span>
      )}
    </span>
  );
}

export function Formula({ spec }: { spec: FormulaSpec }) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-block rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm">
          {spec.result}
        </span>
        <span className="px-0.5 text-lg font-bold text-slate-400" aria-hidden="true">
          =
        </span>
        {spec.terms.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            {t.op && <Operator op={t.op} />}
            <Operand item={t} />
          </span>
        ))}
      </div>
      {spec.example && (
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-dashed border-slate-200 pt-2 text-xs leading-6 text-slate-500">
          <span className="rounded bg-slate-200/70 px-1.5 py-0.5 font-medium text-slate-600">
            {spec.exampleLabel ?? "مثال عددی"}
          </span>
          <span className="tabular">{spec.example}</span>
        </div>
      )}
    </div>
  );
}

/** Renders one or many formulas for a single term. */
export function Formulas({ specs }: { specs: FormulaSpec | FormulaSpec[] }) {
  const list = Array.isArray(specs) ? specs : [specs];
  return (
    <>
      {list.map((s, i) => (
        <Formula key={i} spec={s} />
      ))}
    </>
  );
}
