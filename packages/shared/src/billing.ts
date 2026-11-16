// Bill maths shared by the POS (to show totals) and the API (to re-check every synced bill).
// Money is integer paise. Tax rates are basis points: 500 = 5%.

export type BillPayMode = "cash" | "upi" | "card" | "other";
export const BILL_PAY_MODES: BillPayMode[] = ["cash", "upi", "card", "other"];

export interface BillLineInput {
  price: number; // paise, for one unit
  qty: number; // whole units
  tax_rate: number; // basis points
}

export interface BillTotals {
  subtotal: number; // sum of price × qty
  discount: number; // applied, never more than subtotal
  tax: number; // GST inside (or added to) the total
  cgst: number;
  sgst: number;
  round_off: number; // + or −, to make the total a whole rupee
  total: number; // what the guest pays
}

/**
 * Works out a bill. The discount is shared across lines in proportion to their amount, so GST is
 * charged on what the guest actually pays. When prices include tax, the tax is the part of the price
 * that is GST; otherwise it is added on top. The total is rounded to the nearest rupee.
 */
export function billTotals(lines: BillLineInput[], discount = 0, pricesIncludeTax = true): BillTotals {
  const amounts = lines.map((l) => Math.max(0, Math.round(l.price)) * Math.max(0, Math.floor(l.qty)));
  const subtotal = amounts.reduce((a, b) => a + b, 0);
  const disc = Math.min(Math.max(0, Math.round(discount)), subtotal);
  let tax = 0;
  let remaining = disc;
  lines.forEach((l, i) => {
    // The last line takes whatever discount is left, so the shares add up exactly.
    const share = i === lines.length - 1 ? remaining : subtotal ? Math.round((disc * amounts[i]) / subtotal) : 0;
    remaining -= share;
    const net = amounts[i] - share;
    const r = Math.max(0, l.tax_rate || 0);
    tax += pricesIncludeTax ? (net * r) / (10_000 + r) : (net * r) / 10_000;
  });
  tax = Math.round(tax);
  const beforeRound = subtotal - disc + (pricesIncludeTax ? 0 : tax);
  const total = Math.round(beforeRound / 100) * 100;
  const cgst = Math.floor(tax / 2);
  return { subtotal, discount: disc, tax, cgst, sgst: tax - cgst, round_off: total - beforeRound, total };
}

/** Change to give back, given what the guest handed over in cash and what's left to pay. */
export function changeDue(cashGiven: number, due: number): number {
  return Math.max(0, cashGiven - due);
}

/** India's financial year (April to March) for a date, as "2627" for 2026-27. */
export function financialYear(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Bill numbers are made on the counter so they work offline: counter code, financial year, running number. */
export function billNumber(counter: string, date: string, seq: number): string {
  return `${counter.toUpperCase()}${financialYear(date)}-${String(seq).padStart(5, "0")}`;
}

/** A valid counter code: 1 to 3 capital letters or digits. */
export function validCounter(code: unknown): code is string {
  return typeof code === "string" && /^[A-Z0-9]{1,3}$/.test(code);
}

/** A waiter's commission on one bill: a rate in basis points (250 = 2.5%) of the amount, rounded to the paisa. */
export function waiterCommission(amount: number, rateBp: number): number {
  if (!(amount > 0) || !(rateBp > 0)) return 0;
  return Math.round((amount * rateBp) / 10_000);
}

/** "2.5" → 250 basis points. Blank → null. Refuses anything outside 0–100%. */
export function percentToBp(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}
