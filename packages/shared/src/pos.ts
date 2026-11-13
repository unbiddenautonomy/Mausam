// Helpers for importing a POS export (Excel or CSV). Every POS names its columns differently,
// so the owner matches columns once and the app remembers the choice.

export type PosKind = "sales" | "items";
export const POS_FIELDS: Record<PosKind, string[]> = {
  sales: ["date", "total", "cash", "online", "bills", "dine_in", "parcel", "discount", "cancelled"],
  items: ["date", "item", "category", "qty", "amount"],
};
export const POS_REQUIRED: Record<PosKind, string[]> = { sales: ["date", "total"], items: ["item", "qty", "amount"] };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) =>
  y >= 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

/**
 * Reads a date cell. Indian exports write day first, so 03/11/2026 is 3 November.
 * Accepts Date objects, Excel serial numbers, 2026-11-03, 03/11/2026, 3-11-26, 3 Nov 2026 and Nov 3, 2026.
 */
export function parsePosDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Spreadsheet dates come through as UTC midnight; a time part may push them, so use IST.
    const ist = new Date(v.getTime() + 330 * 60_000);
    return iso(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
  }
  if (typeof v === "number") {
    if (v > 30000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s,-]+(\d{2,4})/);
  if (m && MONTHS.includes(m[2])) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  m = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{1,2}),?[\s-]+(\d{4})/);
  if (m && MONTHS.includes(m[1])) return iso(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  return null;
}

/** "₹1,23,456.50", "1234", 1234.5, "(200)" → paise. Empty → null. */
export function parsePosAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).trim();
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[^\d.]/g, "");
  if (!s || Number.isNaN(Number(s))) return null;
  const p = Math.round(Number(s) * 100);
  return negative ? -p : p;
}

export function parsePosNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d.-]/g, "");
  return s && !Number.isNaN(Number(s)) ? Number(s) : null;
}

/** The first row that looks like column names: at least two text cells, mostly non-numeric. */
export function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].filter((c) => c !== null && c !== undefined && String(c).trim() !== "");
    const text = cells.filter((c) => typeof c === "string" && !/^[\d.,₹\s-]+$/.test(c));
    if (cells.length >= 2 && text.length >= Math.max(2, cells.length * 0.6)) return i;
  }
  return 0;
}

const HINTS: Record<string, RegExp> = {
  date: /date|day|दिनांक|तारीख/i,
  total: /^(grand\s*)?total|net\s*(sale|amount)|total\s*sale|sale\s*amount|^sales?$/i,
  cash: /cash/i,
  online: /online|upi|card|paytm|phonepe|gpay|digital|wallet/i,
  bills: /bills?|orders?|invoices?|count|no\.? of/i,
  dine_in: /dine/i,
  parcel: /parcel|take\s*away|takeaway|delivery|swiggy|zomato/i,
  discount: /disc/i,
  cancelled: /cancel|void/i,
  item: /item|product|dish|name/i,
  category: /categ|group|section/i,
  qty: /qty|quantity|sold|count|units?/i,
  amount: /amount|value|sales?|total|net/i,
};

/** Guesses which column holds each field from the header names. */
export function guessMapping(headers: string[], kind: PosKind): Record<string, number | null> {
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const field of POS_FIELDS[kind]) {
    const idx = headers.findIndex((h, i) => !used.has(i) && HINTS[field].test(h ?? ""));
    out[field] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return out;
}
