import { Hono } from "hono";
import { addDays, businessDate, monthDates } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { audit } from "../lib/db";
import { HttpError, optionalPaise, optionalText } from "../lib/http";
import { BILL_KEYS, rangeTotals } from "../lib/totals";
import { vendorDues } from "./vendors";

export const month = new Hono<AppEnv>();
month.use("*", requireRole("owner"));

function requireMonth(v: string | undefined) {
  if (!v || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpError(422, "invalid", { field: "month" });
  return v;
}

interface MonthRow {
  month: string; status: "open" | "closed"; tally_photo_key: string | null; tally_sales: number | null; tally_expenses: number | null;
  tally_wages: number | null; note: string | null; totals: string | null; closed_by: number | null; closed_at: string | null;
}

async function summary(db: D1Database, m: string) {
  const dates = monthDates(m);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const lastDue = [to, addDays(businessDate(), -1)].sort()[0]; // days that should be closed by now
  const due = dates.filter((d) => d <= lastDue);
  const { results: closed } = await db.prepare("SELECT business_date FROM day_closes WHERE business_date BETWEEN ? AND ?").bind(from, to).all<{ business_date: string }>();
  const closedSet = new Set(closed.map((r) => r.business_date));
  const missing = due.filter((d) => !closedSet.has(d));

  const staff = await db.prepare("SELECT COUNT(*) AS n FROM staff WHERE active = 1 AND pay_rate IS NOT NULL").first<{ n: number }>();
  const paid = await db.prepare("SELECT COUNT(*) AS n FROM payroll WHERE month = ? AND status = 'paid'").bind(m).first<{ n: number }>();
  const dues = await vendorDues(db);

  const { results: bills } = await db
    .prepare(
      `SELECT e.id, e.business_date, e.amount, e.mode, e.note, e.photo_key, c.key AS category_key, c.name_en AS category_name, c.name_hi AS category_name_hi, c.name_kn AS category_name_kn
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ? AND c.key IN (${BILL_KEYS.map(() => "?").join(",")})
       ORDER BY e.business_date`,
    )
    .bind(from, to, ...BILL_KEYS)
    .all();
  const { results: billCats } = await db
    .prepare(`SELECT id, key, name_en, name_hi, name_kn FROM expense_categories WHERE key IN (${BILL_KEYS.map(() => "?").join(",")}) AND active = 1 ORDER BY sort`)
    .bind(...BILL_KEYS)
    .all();

  return {
    checklist: {
      days_due: due.length,
      days_closed: due.length - missing.length,
      missing,
      staff_with_pay: staff?.n ?? 0,
      payroll_paid: paid?.n ?? 0,
      vendor_due: dues.reduce((s, v) => s + Math.max(0, v.due), 0),
      vendors_owed: dues.filter((v) => v.due > 0),
    },
    bills,
    bill_categories: billCats,
    totals: await rangeTotals(db, from, to),
  };
}

month.get("/:month", async (c) => {
  const m = requireMonth(c.req.param("month"));
  const row = await c.env.DB.prepare("SELECT * FROM month_closes WHERE month = ?").bind(m).first<MonthRow>();
  if (row?.status === "closed" && row.totals) {
    // A closed month shows the numbers as they were when it was closed.
    const snap = JSON.parse(row.totals);
    return c.json({ month: m, close: row, ...snap, frozen: true });
  }
  return c.json({ month: m, close: row ?? { month: m, status: "open" }, ...(await summary(c.env.DB, m)), frozen: false });
});

month.put("/:month", async (c) => {
  const m = requireMonth(c.req.param("month"));
  const b = await c.req.json<Record<string, unknown>>();
  const before = await c.env.DB.prepare("SELECT * FROM month_closes WHERE month = ?").bind(m).first<MonthRow>();
  if (before?.status === "closed") throw new HttpError(409, "month_closed");
  const v = {
    tally_photo_key: optionalText(b.tally_photo_key, 200),
    tally_sales: optionalPaise(b.tally_sales, "tally_sales"),
    tally_expenses: optionalPaise(b.tally_expenses, "tally_expenses"),
    tally_wages: optionalPaise(b.tally_wages, "tally_wages"),
    note: optionalText(b.note, 1000),
  };
  await c.env.DB.prepare(
    `INSERT INTO month_closes (month, tally_photo_key, tally_sales, tally_expenses, tally_wages, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (month) DO UPDATE SET tally_photo_key = excluded.tally_photo_key, tally_sales = excluded.tally_sales, tally_expenses = excluded.tally_expenses,
       tally_wages = excluded.tally_wages, note = excluded.note, updated_at = excluded.updated_at`,
  )
    .bind(m, v.tally_photo_key, v.tally_sales, v.tally_expenses, v.tally_wages, v.note)
    .run();
  await audit(c.env.DB, "month_closes", 0, before ? "update" : "create", before, { month: m, ...v }, c.get("user").id);
  return c.json({ ok: true });
});

month.post("/:month/close", async (c) => {
  const m = requireMonth(c.req.param("month"));
  // Closing locks every entry in the month, so only a month that has ended can be closed.
  if (m >= businessDate().slice(0, 7)) throw new HttpError(422, "month_not_over");
  const body = await c.req.json<{ force?: unknown }>().catch(() => ({}) as { force?: unknown });
  const snap = await summary(c.env.DB, m);
  const missing = snap.checklist.missing;
  const unpaid = Math.max(0, snap.checklist.staff_with_pay - snap.checklist.payroll_paid);
  // Days without a closing or pay not marked paid: the owner has to say "close anyway", and that is recorded.
  if ((missing.length || unpaid) && body.force !== true) throw new HttpError(422, "month_incomplete", { missing, unpaid });
  await c.env.DB.prepare(
    `INSERT INTO month_closes (month, status, totals, closed_by, closed_at, updated_at) VALUES (?, 'closed', ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (month) DO UPDATE SET status = 'closed', totals = excluded.totals, closed_by = excluded.closed_by, closed_at = excluded.closed_at, updated_at = excluded.updated_at`,
  )
    .bind(m, JSON.stringify(snap), c.get("user").id)
    .run();
  await c.env.DB.prepare("UPDATE alerts SET seen_at = COALESCE(seen_at, datetime('now')) WHERE type = 'month_close' AND business_date = ?").bind(`${m}-01`).run().catch(() => null);
  const forced = missing.length || unpaid ? { forced: true, missing, unpaid } : {};
  await audit(c.env.DB, "month_closes", 0, "update", { month: m, status: "open" }, { month: m, status: "closed", ...forced }, c.get("user").id);
  return c.json({ ok: true });
});

month.post("/:month/reopen", async (c) => {
  const m = requireMonth(c.req.param("month"));
  await c.env.DB.prepare("UPDATE month_closes SET status = 'open', totals = NULL, closed_by = NULL, closed_at = NULL, updated_at = datetime('now') WHERE month = ?").bind(m).run();
  await audit(c.env.DB, "month_closes", 0, "update", { month: m, status: "closed" }, { month: m, status: "open" }, c.get("user").id);
  return c.json({ ok: true });
});
