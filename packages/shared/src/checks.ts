import type { Paise } from "./money";
import type { CloseFlag } from "./types";

export interface CloseInput {
  total_counter: Paise;
  cash: Paise;
  online: Paise;
  expenses: Paise;
  pos_sales?: Paise | null;
  memo_photo_key?: string | null;
}

/**
 * Checks run on the closing report.
 * Formula agreed with the owner: cash left in drawer + online + counter expenses = total counter.
 */
export function checkClose(
  input: CloseInput,
  ctx: { expensesEntered: Paise; tolerance: Paise },
): CloseFlag[] {
  const flags: CloseFlag[] = [];
  const formulaDiff = input.cash + input.online + input.expenses - input.total_counter;
  if (formulaDiff !== 0) flags.push({ code: "formula_mismatch", diff: formulaDiff });

  // Expenses typed on the closing vs. the sum of expense entries made in the app that day.
  // Only meaningful once managers are logging expenses; skip when none were entered.
  if (ctx.expensesEntered > 0) {
    const d = input.expenses - ctx.expensesEntered;
    if (Math.abs(d) > ctx.tolerance) flags.push({ code: "expenses_differ", diff: d });
  }

  if (input.pos_sales !== null && input.pos_sales !== undefined) {
    const d = input.total_counter - input.pos_sales;
    if (Math.abs(d) > ctx.tolerance) flags.push({ code: "pos_differs", diff: d });
  }

  if (!input.memo_photo_key) flags.push({ code: "no_memo_photo" });
  return flags;
}

/** Shopping float check: float out − cash spent should equal float back. Positive diff = money missing. */
export function shoppingGap(floatOut: Paise, cashSpent: Paise, floatBack: Paise): Paise {
  return floatOut - cashSpent - floatBack;
}

/** Robust "usual range" for anomaly flags: median ± 1.5×IQR of past values. */
export function usualRange(values: number[]): { low: number; high: number; median: number } | null {
  if (values.length < 4) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  return { low: Math.max(0, q1 - 1.5 * iqr), high: q3 + 1.5 * iqr, median: q(0.5) };
}
