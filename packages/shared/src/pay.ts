// Month-end pay. Kept simple and explainable to a family business:
// - Monthly pay: the full amount, less 1/30 for each absent or leave day (a half day counts as ½),
//   and less 1/30 for each day of the month before the person joined.
// - Daily or per-shift pay: rate × days worked (a half day counts as ½).
// - Waiters also get their commission on the bills they served (from the POS), added on top.
// - Days nobody marked count as worked, so a forgotten register never cuts anyone's pay.
//   The owner sees how many days were unmarked and can adjust.

export type AttendanceStatus = "present" | "half" | "absent" | "leave" | "off";
export type PayType = "monthly" | "daily" | "shift";

export interface DayCounts {
  present: number;
  half: number;
  absent: number;
  leave: number;
  off: number;
  unmarked: number;
}

export interface PayInput {
  pay_type: PayType | null;
  rate: number | null; // paise per month / day / shift
  days: DayCounts;
  days_not_employed?: number; // days of the month before joining
  advances: number; // paise
  adjustment?: number; // paise, + or -
  commission?: number; // paise: a waiter's commission on the bills they served this month
}

export interface PayResult {
  days_worked: number;
  days_absent: number;
  gross: number;
  net: number;
}

export function computePay(p: PayInput): PayResult {
  const d = p.days;
  const days_worked = d.present + d.half * 0.5 + d.unmarked;
  const days_absent = d.absent + d.leave + d.half * 0.5;
  let gross = 0;
  if (p.rate && p.pay_type) {
    if (p.pay_type === "monthly") {
      const missed = days_absent + (p.days_not_employed ?? 0);
      gross = Math.max(0, p.rate - (p.rate / 30) * missed);
    } else {
      gross = p.rate * days_worked;
    }
    gross = Math.round(gross / 100) * 100; // whole rupees
  }
  return { days_worked, days_absent, gross, net: gross + (p.commission ?? 0) - p.advances + (p.adjustment ?? 0) };
}

/** Counts statuses for a list of dates, treating dates with no mark as unmarked. */
export function countDays(dates: string[], marks: Map<string, AttendanceStatus>): DayCounts {
  const c: DayCounts = { present: 0, half: 0, absent: 0, leave: 0, off: 0, unmarked: 0 };
  for (const date of dates) {
    const s = marks.get(date);
    if (s) c[s]++;
    else c.unmarked++;
  }
  return c;
}

/** All dates of a YYYY-MM month, as YYYY-MM-DD. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
