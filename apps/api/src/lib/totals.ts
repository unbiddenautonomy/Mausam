// Money totals for a date range, split so nothing is counted twice:
// - sales: closing totals typed by managers (POS totals where a day has no closing)
// - expenses: day-to-day counter and shopping expenses typed by managers (not bills, not salaries)
// - bills: rent, electricity, water, licences
// - deliveries: vendor goods received on credit (vendor payments aren't counted again)
// - wages: month-end pay earned (advances are part of it, so advance expense lines aren't counted again)
import { computePay, countDays, dateRange, monthDates, type AttendanceStatus, type PayType } from "@mausam/shared";

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

/**
 * Wages earned in a date range. For a whole calendar month this is the month-end pay rule
 * (saved pay when it was marked paid). For other ranges, monthly pay is counted as 1/30 per day.
 */
export async function wagesEarned(db: D1Database, from: string, to: string): Promise<number> {
  const month = from.slice(0, 7);
  const wholeMonth = from === `${month}-01` && to === monthDates(month).at(-1);
  const { results: staff } = await db
    .prepare("SELECT id, pay_type, pay_rate, joined_on FROM staff WHERE pay_rate IS NOT NULL AND (active = 1 OR id IN (SELECT staff_id FROM attendance WHERE business_date BETWEEN ? AND ?))")
    .bind(from, to)
    .all<{ id: number; pay_type: PayType | null; pay_rate: number; joined_on: string | null }>();
  if (staff.length === 0) return 0;
  const { results: marks } = await db
    .prepare("SELECT staff_id, business_date, status FROM attendance WHERE business_date BETWEEN ? AND ?")
    .bind(from, to)
    .all<{ staff_id: number; business_date: string; status: AttendanceStatus }>();
  const paid = wholeMonth
    ? new Map(
        (await db.prepare("SELECT staff_id, gross FROM payroll WHERE month = ? AND status = 'paid'").bind(month).all<{ staff_id: number; gross: number }>()).results.map(
          (r) => [r.staff_id, r.gross],
        ),
      )
    : new Map<number, number>();
  const dates = dateRange(from, to);
  let total = 0;
  for (const s of staff) {
    if (paid.has(s.id)) {
      total += paid.get(s.id)!;
      continue;
    }
    const employed = dates.filter((d) => !s.joined_on || d >= s.joined_on);
    const counts = countDays(employed, new Map(marks.filter((m) => m.staff_id === s.id).map((m) => [m.business_date, m.status])));
    if (s.pay_type === "monthly" && wholeMonth) {
      total += computePay({ pay_type: "monthly", rate: s.pay_rate, days: counts, days_not_employed: dates.length - employed.length, advances: 0 }).gross;
    } else if (s.pay_type === "monthly") {
      const paidDays = employed.length - (counts.absent + counts.leave + counts.half * 0.5);
      total += Math.max(0, Math.round((s.pay_rate / 30) * paidDays));
    } else {
      total += computePay({ pay_type: s.pay_type, rate: s.pay_rate, days: counts, advances: 0 }).gross;
    }
  }
  return total;
}
