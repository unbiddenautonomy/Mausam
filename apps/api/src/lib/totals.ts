// Money totals for a date range, split so nothing is counted twice:
// - sales: closing totals typed by managers (POS totals where a day has no closing)
// - expenses: day-to-day counter and shopping expenses typed by managers (not bills, not salaries)
// - bills: rent, electricity, water, licences
// - deliveries: vendor goods received on credit (vendor payments aren't counted again)
// - wages: month-end pay earned (advances are part of it, so advance expense lines aren't counted again)
import { businessDate, computePay, countDays, dateRange, monthDates, type AttendanceStatus, type PayType } from "@mausam/shared";

export const BILL_KEYS = ["rent", "electricity", "water", "licences"];
const NOT_DAY_TO_DAY = [...BILL_KEYS, "salaries", "staff_advance", "vendor_payment"];

export interface RangeTotals {
  sales: number;
  days_with_sales: number;
  expenses: number;
  food: number; // the food and supplies part of expenses + deliveries
  bills: number;
  deliveries: number;
  wages: number;
  left: number;
}

/** Food and supplies that go into what we sell (gas included: it is a direct cooking cost). */
export const FOOD_KEYS = ["vegetables", "dairy", "bakery", "grocery", "oil", "gas", "drinks", "staff_food"];

export async function rangeTotals(db: D1Database, from: string, to: string, wages?: number): Promise<RangeTotals> {
  const placeholders = NOT_DAY_TO_DAY.map(() => "?").join(",");
  const [sales, pos, exp, bills, food, del] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(total_counter),0) AS t, COUNT(*) AS n FROM day_closes WHERE business_date BETWEEN ? AND ?").bind(from, to).first<{ t: number; n: number }>(),
    db.prepare(
      "SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS n FROM pos_daily WHERE business_date BETWEEN ? AND ? AND business_date NOT IN (SELECT business_date FROM day_closes)",
    ).bind(from, to).first<{ t: number; n: number }>(),
    db.prepare(
      `SELECT COALESCE(SUM(e.amount),0) AS t FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ? AND c.key NOT IN (${placeholders})`,
    ).bind(from, to, ...NOT_DAY_TO_DAY).first<{ t: number }>(),
    db.prepare(
      `SELECT COALESCE(SUM(e.amount),0) AS t FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ? AND c.key IN (${BILL_KEYS.map(() => "?").join(",")})`,
    ).bind(from, to, ...BILL_KEYS).first<{ t: number }>(),
    db.prepare(
      `SELECT COALESCE(SUM(e.amount),0) AS t FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ? AND c.key IN (${FOOD_KEYS.map(() => "?").join(",")})`,
    ).bind(from, to, ...FOOD_KEYS).first<{ t: number }>(),
    db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM deliveries WHERE deleted_at IS NULL AND business_date BETWEEN ? AND ?").bind(from, to).first<{ t: number }>(),
  ]);
  const w = wages ?? (await wagesEarned(db, from, to));
  const s = (sales?.t ?? 0) + (pos?.t ?? 0);
  const e = exp?.t ?? 0;
  const b = bills?.t ?? 0;
  const d = del?.t ?? 0;
  return {
    sales: s,
    days_with_sales: (sales?.n ?? 0) + (pos?.n ?? 0),
    expenses: e,
    food: (food?.t ?? 0) + d,
    bills: b,
    deliveries: d,
    wages: w,
    left: s - e - b - d - w,
  };
}

interface StaffWage { id: number; pay_type: PayType | null; pay_rate: number; joined_on: string | null; active: number }
interface Mark { staff_id: number; business_date: string; status: AttendanceStatus }

/** What wages are worked out from, for a date range: staff with a pay rate, attendance, and waiter commission per day. */
export interface WageData { staff: StaffWage[]; marks: Mark[]; commission: Map<string, number> }

/** Loads the wage inputs for a range in three queries, so several sub-ranges (weeks) can be worked out from one load. */
export async function loadWageData(db: D1Database, from: string, to: string): Promise<WageData> {
  const [staff, comm, marks] = await Promise.all([
    db
      .prepare("SELECT id, pay_type, pay_rate, joined_on, active FROM staff WHERE pay_rate IS NOT NULL AND (active = 1 OR id IN (SELECT staff_id FROM attendance WHERE business_date BETWEEN ? AND ?))")
      .bind(from, to)
      .all<StaffWage>(),
    // Waiter commission on POS bills counts as wages too.
    db
      .prepare("SELECT business_date, COALESCE(SUM(commission), 0) AS t FROM pos_bills WHERE status = 'paid' AND business_date BETWEEN ? AND ? GROUP BY business_date")
      .bind(from, to)
      .all<{ business_date: string; t: number }>()
      .catch(() => ({ results: [] as { business_date: string; t: number }[] })),
    db
      .prepare("SELECT staff_id, business_date, status FROM attendance WHERE business_date BETWEEN ? AND ?")
      .bind(from, to)
      .all<Mark>(),
  ]);
  return { staff: staff.results, marks: marks.results, commission: new Map(comm.results.map((r) => [r.business_date, r.t])) };
}

/**
 * Wages earned from `from` to `to`, worked out from data loaded for a range that covers it. `paid` is the saved
 * month-end pay per person, used only for a whole calendar month.
 */
export function wagesFrom(data: WageData, from: string, to: string, paid = new Map<number, number>()): number {
  // Only count days that have happened; future days aren't earned yet.
  const today = businessDate();
  if (from > today) return 0;
  if (to > today) to = today;
  const month = from.slice(0, 7);
  const wholeMonth = from === `${month}-01` && to === monthDates(month).at(-1);
  const inRange = (d: string) => d >= from && d <= to;
  let total = 0;
  for (const [d, t] of data.commission) if (inRange(d)) total += t;
  const marks = data.marks.filter((m) => inRange(m.business_date));
  // Everyone still on staff, plus anyone who has left but worked in this range.
  const staff = data.staff.filter((s) => s.active === 1 || marks.some((m) => m.staff_id === s.id));
  const dates = dateRange(from, to);
  for (const s of staff) {
    if (wholeMonth && paid.has(s.id)) {
      total += paid.get(s.id)!;
      continue;
    }
    const employed = dates.filter((d) => !s.joined_on || d >= s.joined_on);
    const counts = countDays(employed, new Map(marks.filter((m) => m.staff_id === s.id).map((m) => [m.business_date, m.status])));
    if (s.pay_type === "monthly" && wholeMonth) {
      total += computePay({ pay_type: "monthly", rate: s.pay_rate, days: counts, days_not_employed: dates.length - employed.length, advances: 0 }).gross;
    } else if (s.pay_type === "monthly") {
      const paidDays = employed.length - (counts.absent + counts.leave + counts.half * 0.5);
      total += Math.max(0, Math.round((s.pay_rate / 30) * paidDays / 100) * 100);
    } else {
      total += computePay({ pay_type: s.pay_type, rate: s.pay_rate, days: counts, advances: 0 }).gross;
    }
  }
  return total;
}

/**
 * Wages earned in a date range. For a whole calendar month this is the month-end pay rule
 * (saved pay when it was marked paid). For other ranges, monthly pay is counted as 1/30 per day.
 */
export async function wagesEarned(db: D1Database, from: string, to: string): Promise<number> {
  const today = businessDate();
  if (from > today) return 0;
  const end = to > today ? today : to;
  const month = from.slice(0, 7);
  const wholeMonth = from === `${month}-01` && end === monthDates(month).at(-1);
  const [data, paid] = await Promise.all([
    loadWageData(db, from, end),
    wholeMonth
      ? db.prepare("SELECT staff_id, gross FROM payroll WHERE month = ? AND status = 'paid'").bind(month).all<{ staff_id: number; gross: number }>()
      : Promise.resolve({ results: [] as { staff_id: number; gross: number }[] }),
  ]);
  return wagesFrom(data, from, end, new Map(paid.results.map((r) => [r.staff_id, r.gross])));
}

/**
 * The same totals as rangeTotals, for each of several date ranges inside [from, to] (for example the weeks of a
 * report), from one set of queries grouped by day. A report of many weeks makes 9 database calls, not 9 per week.
 */
export async function totalsByRange(db: D1Database, from: string, to: string, ranges: { from: string; to: string }[]): Promise<RangeTotals[]> {
  const placeholders = NOT_DAY_TO_DAY.map(() => "?").join(",");
  type Day = { business_date: string; t: number; n?: number };
  const byDay = (sql: string, ...extra: string[]) => db.prepare(sql).bind(from, to, ...extra).all<Day>().then((r) => r.results);
  const [sales, pos, exp, bills, food, del, wages] = await Promise.all([
    byDay("SELECT business_date, COALESCE(SUM(total_counter),0) AS t, COUNT(*) AS n FROM day_closes WHERE business_date BETWEEN ? AND ? GROUP BY business_date"),
    byDay(
      "SELECT business_date, COALESCE(SUM(total),0) AS t, COUNT(*) AS n FROM pos_daily WHERE business_date BETWEEN ? AND ? AND business_date NOT IN (SELECT business_date FROM day_closes) GROUP BY business_date",
    ),
    byDay(
      `SELECT e.business_date, COALESCE(SUM(e.amount),0) AS t FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ? AND c.key NOT IN (${placeholders}) GROUP BY e.business_date`,
      ...NOT_DAY_TO_DAY,
    ),
    byDay(
      `SELECT e.business_date, COALESCE(SUM(e.amount),0) AS t FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ? AND c.key IN (${BILL_KEYS.map(() => "?").join(",")}) GROUP BY e.business_date`,
      ...BILL_KEYS,
    ),
    byDay(
      `SELECT e.business_date, COALESCE(SUM(e.amount),0) AS t FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ? AND c.key IN (${FOOD_KEYS.map(() => "?").join(",")}) GROUP BY e.business_date`,
      ...FOOD_KEYS,
    ),
    byDay("SELECT business_date, COALESCE(SUM(amount),0) AS t FROM deliveries WHERE deleted_at IS NULL AND business_date BETWEEN ? AND ? GROUP BY business_date"),
    loadWageData(db, from, to),
  ]);
  const sum = (rows: Day[], a: string, b: string, k: "t" | "n" = "t") => rows.reduce((s, r) => (r.business_date >= a && r.business_date <= b ? s + Number(r[k] ?? 0) : s), 0);
  return ranges.map(({ from: a, to: b }) => {
    const s = sum(sales, a, b) + sum(pos, a, b);
    const e = sum(exp, a, b);
    const bl = sum(bills, a, b);
    const d = sum(del, a, b);
    const w = wagesFrom(wages, a, b);
    return {
      sales: s,
      days_with_sales: sum(sales, a, b, "n") + sum(pos, a, b, "n"),
      expenses: e,
      food: sum(food, a, b) + d,
      bills: bl,
      deliveries: d,
      wages: w,
      left: s - e - bl - d - w,
    };
  });
}
