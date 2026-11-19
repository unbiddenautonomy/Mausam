import { Hono } from "hono";
import { businessDate, computePay, countDays, monthDates, type AttendanceStatus, type PayType } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { counterExpenseStmts, removeCounterExpense } from "../lib/counter";
import { assertDayOpen, audit, auditStmt, bool, clientIdOf, isClientIdClash } from "../lib/db";
import { HttpError, optionalText, requireDate, requirePaise } from "../lib/http";

const STATUSES: AttendanceStatus[] = ["present", "half", "absent", "leave", "off"];
const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const requireMonth = (v: unknown) => {
  if (!isMonth(v)) throw new HttpError(422, "invalid", { field: "month" });
  return v;
};

export const people = new Hono<AppEnv>();
people.use("*", requireRole("owner", "manager"));

/* ---------- Attendance ---------- */

people.get("/attendance/:date", async (c) => {
  const date = requireDate(c.req.param("date"));
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.name_local, s.role, a.status, u.name AS marked_by_name
     FROM staff s
     LEFT JOIN attendance a ON a.staff_id = s.id AND a.business_date = ?
     LEFT JOIN users u ON u.id = a.marked_by
     WHERE s.active = 1 AND (s.joined_on IS NULL OR s.joined_on <= ?)
     ORDER BY s.role, s.name`,
  )
    .bind(date, date)
    .all();
  return c.json({ date, staff: results });
});

/** Saves several marks at once. A null status clears the mark. */
people.put("/attendance/:date", async (c) => {
  const user = c.get("user");
  const date = requireDate(c.req.param("date"));
  await assertDayOpen(c.env.DB, user, date);
  const b = await c.req.json<{ marks?: { staff_id: number; status: AttendanceStatus | null }[] }>();
  if (!Array.isArray(b.marks) || b.marks.length > 200) throw new HttpError(422, "invalid", { field: "marks" });
  // What each person was marked before, by name, for the audit log (one row for the day's changes).
  const { results: was } = await c.env.DB.prepare(
    `SELECT s.id, s.name, a.status FROM staff s LEFT JOIN attendance a ON a.staff_id = s.id AND a.business_date = ?1
     WHERE s.id IN (SELECT value FROM json_each(?2))`,
  ).bind(date, JSON.stringify(b.marks.map((m) => Number(m.staff_id)))).all<{ id: number; name: string; status: AttendanceStatus | null }>();
  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  for (const m of b.marks) {
    const row = was.find((w) => w.id === Number(m.staff_id));
    if (!row || (row.status ?? null) === (m.status ?? null)) continue;
    before[row.name] = row.status ?? null;
    after[row.name] = m.status ?? null;
  }
  const stmts = b.marks.map((m) => {
    if (m.status === null) return c.env.DB.prepare("DELETE FROM attendance WHERE staff_id = ? AND business_date = ?").bind(Number(m.staff_id), date);
    if (!STATUSES.includes(m.status)) throw new HttpError(422, "invalid", { field: "status" });
    return c.env.DB.prepare(
      `INSERT INTO attendance (staff_id, business_date, status, marked_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (staff_id, business_date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, marked_at = datetime('now')`,
    ).bind(Number(m.staff_id), date, m.status, user.id);
  });
  if (Object.keys(after).length) stmts.push(auditStmt(c.env.DB, "attendance", Number(date.replace(/-/g, "")), "update", before, after, user.id));
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, saved: b.marks.length });
});

/** Month grid for the owner: one row per person, one letter per day. */
people.get("/attendance-month/:month", requireRole("owner"), async (c) => {
  const month = requireMonth(c.req.param("month"));
  const { results } = await c.env.DB.prepare(
    "SELECT staff_id, business_date, status FROM attendance WHERE business_date BETWEEN ?1 || '-01' AND ?1 || '-31'",
  )
    .bind(month)
    .all<{ staff_id: number; business_date: string; status: AttendanceStatus }>();
  return c.json({ month, marks: results });
});

/* ---------- Advances ---------- */

people.get("/advances", async (c) => {
  const month = c.req.query("month") ?? businessDate().slice(0, 7);
  requireMonth(month);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.staff_id, s.name AS staff_name, a.business_date, a.amount, a.mode, a.from_counter, a.note, u.name AS given_by_name, a.created_at
     FROM advances a JOIN staff s ON s.id = a.staff_id LEFT JOIN users u ON u.id = a.given_by
     WHERE a.deleted_at IS NULL AND a.business_date BETWEEN ?1 || '-01' AND ?1 || '-31'
     ORDER BY a.business_date DESC, a.id DESC`,
  )
    .bind(month)
    .all();
  return c.json({ month, advances: results });
});

people.post("/advances", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();
  const date = b.business_date ? requireDate(b.business_date) : businessDate();
  await assertDayOpen(c.env.DB, user, date);
  const staffId = Number(b.staff_id);
  const staff = await c.env.DB.prepare("SELECT name FROM staff WHERE id = ? AND active = 1").bind(staffId).first<{ name: string }>();
  if (!staff) throw new HttpError(422, "invalid", { field: "staff_id" });
  const amount = requirePaise(b.amount, "amount");
  const fromCounter = b.from_counter === undefined ? true : bool(b.from_counter);
  const mode = b.mode === "online" ? "online" : "cash";
  const note = optionalText(b.note);
  const db = c.env.DB;
  const clientId = clientIdOf(b.client_id);
  const already = async () =>
    clientId ? await db.prepare("SELECT id FROM advances WHERE client_id = ?").bind(clientId).first<{ id: number }>() : null;
  const had = await already();
  if (had) return c.json({ id: had.id, duplicate: true });
  const cash = fromCounter && mode === "cash";
  // The advance, its counter expense and the link between them are saved together, or not at all.
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(
        "INSERT INTO advances (staff_id, business_date, amount, mode, from_counter, note, given_by, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      ).bind(staffId, date, amount, mode, cash ? 1 : 0, note, user.id, clientId),
      ...(cash
        ? counterExpenseStmts(db, "advances", {
          date, categoryKey: "staff_advance", amount, source: "advance", note: `${staff.name}${note ? ` · ${note}` : ""}`, userId: user.id,
        })
        : []),
    ]);
  } catch (e) {
    // The same form saved twice at the same moment: the other save won.
    const won = isClientIdClash(e) ? await already() : null;
    if (won) return c.json({ id: won.id, duplicate: true });
    throw e;
  }
  const id = Number((results[0].results[0] as { id: number }).id);
  const row = await db.prepare("SELECT expense_id FROM advances WHERE id = ?").bind(id).first<{ expense_id: number | null }>();
  await db.batch([
    auditStmt(db, "advances", id, "create", null, { staff_id: staffId, date, amount, mode, from_counter: fromCounter }, user.id),
    ...(row?.expense_id ? [auditStmt(db, "expenses", row.expense_id, "create", null, { date, amount, source: "advance", ref_id: id }, user.id)] : []),
  ]);
  return c.json({ id }, 201);
});

people.delete("/advances/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT * FROM advances WHERE id = ? AND deleted_at IS NULL").bind(id).first<{ business_date: string; expense_id: number | null }>();
  if (!row) throw new HttpError(404, "not_found");
  await assertDayOpen(c.env.DB, user, row.business_date);
  await c.env.DB.prepare("UPDATE advances SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();
  await removeCounterExpense(c.env.DB, row.expense_id, user.id);
  await audit(c.env.DB, "advances", id, "delete", row, null, user.id);
  return c.json({ ok: true });
});

/* ---------- Month-end pay (owner) ---------- */

interface StaffRow {
  id: number; name: string; role: string; pay_type: PayType | null; pay_rate: number | null; joined_on: string | null; is_waiter: number;
  /** The last day they worked, if they've left. */
  left_on?: string | null;
}
interface PayrollRow {
  staff_id: number; pay_type: string | null; rate: number | null; days_worked: number; days_absent: number; days_unmarked: number;
  gross: number; advances: number; adjustment: number; net: number; commission: number; status: "draft" | "paid"; paid_on: string | null; note: string | null;
}

/** A month's attendance, advances and waiter commission for everyone, loaded in three queries. */
interface MonthData { marks: Map<number, Map<string, AttendanceStatus>>; advances: Map<number, number>; commission: Map<number, number> }

async function loadMonth(db: D1Database, month: string, staffId?: number): Promise<MonthData> {
  const [from, to] = [`${month}-01`, `${month}-31`];
  const one = staffId === undefined ? "" : " AND staff_id = ?3";
  const bind = (sql: string) => (staffId === undefined ? db.prepare(sql).bind(from, to) : db.prepare(sql).bind(from, to, staffId));
  const [att, adv, comm] = await Promise.all([
    bind(`SELECT staff_id, business_date, status FROM attendance WHERE business_date BETWEEN ?1 AND ?2${one}`).all<{ staff_id: number; business_date: string; status: AttendanceStatus }>(),
    bind(`SELECT staff_id, COALESCE(SUM(amount), 0) AS t FROM advances WHERE deleted_at IS NULL AND business_date BETWEEN ?1 AND ?2${one} GROUP BY staff_id`).all<{ staff_id: number; t: number }>(),
    // Commission is counted for anyone who served bills, even if they're no longer marked as a waiter.
    bind(
      `SELECT waiter_staff_id AS staff_id, COALESCE(SUM(commission), 0) AS t FROM pos_bills
       WHERE status = 'paid' AND business_date BETWEEN ?1 AND ?2${one.replace("staff_id", "waiter_staff_id")} GROUP BY waiter_staff_id`,
    ).all<{ staff_id: number; t: number }>(),
  ]);
  const marks = new Map<number, Map<string, AttendanceStatus>>();
  for (const r of att.results) {
    if (!marks.has(r.staff_id)) marks.set(r.staff_id, new Map());
    marks.get(r.staff_id)!.set(r.business_date, r.status);
  }
  return {
    marks,
    advances: new Map(adv.results.map((r) => [r.staff_id, r.t])),
    commission: new Map(comm.results.map((r) => [r.staff_id, r.t])),
  };
}

/** Works out one person's pay for a month from attendance and advances. */
function payFor(month: string, s: StaffRow, adjustment: number, data: MonthData) {
  const today = businessDate();
  const all = monthDates(month);
  // Days before they joined or after they left aren't counted, and a monthly wage is cut for them.
  const employed = (d: string) => (!s.joined_on || d >= s.joined_on) && (!s.left_on || d <= s.left_on);
  const dates = all.filter((d) => d <= today && employed(d));
  const notEmployed = all.filter((d) => !employed(d)).length;
  const counts = countDays(dates, data.marks.get(s.id) ?? new Map());
  const advances = data.advances.get(s.id) ?? 0;
  const commission = data.commission.get(s.id) ?? 0;
  const pay = computePay({ pay_type: s.pay_type, rate: s.pay_rate, days: counts, days_not_employed: notEmployed, advances, adjustment, commission });
  return { ...pay, counts, commission, advances, partial: dates.length < all.length - notEmployed };
}

/** One person's pay for a month (loads just their data). */
async function computeFor(db: D1Database, month: string, s: StaffRow, adjustment: number) {
  return payFor(month, s, adjustment, await loadMonth(db, month, s.id));
}

people.get("/payroll/:month", requireRole("owner"), async (c) => {
  const month = requireMonth(c.req.param("month"));
  const { results: staff } = await c.env.DB.prepare(
    `SELECT id, name, role, pay_type, pay_rate, joined_on, is_waiter, left_on FROM staff
     WHERE active = 1 OR left_on >= ?2 OR id IN (SELECT staff_id FROM payroll WHERE month = ?1) ORDER BY role, name`,
  )
    .bind(month, `${month}-01`)
    .all<StaffRow>();
  const { results: saved } = await c.env.DB.prepare("SELECT * FROM payroll WHERE month = ?").bind(month).all<PayrollRow>();
  const byStaff = new Map(saved.map((r) => [r.staff_id, r]));
  const data = await loadMonth(c.env.DB, month);
  const rows = [];
  for (const s of staff) {
    if (s.joined_on && s.joined_on > `${month}-31`) continue;
    const row = byStaff.get(s.id);
    if (row?.status === "paid") {
      rows.push({ ...row, name: s.name, role: s.role, partial: false });
      continue;
    }
    const p = payFor(month, s, row?.adjustment ?? 0, data);
    rows.push({
      staff_id: s.id, name: s.name, role: s.role, pay_type: s.pay_type, rate: s.pay_rate,
      days_worked: p.days_worked, days_absent: p.days_absent, days_unmarked: p.counts.unmarked,
      gross: p.gross, commission: p.commission, advances: p.advances, adjustment: row?.adjustment ?? 0, net: p.net,
      status: "draft" as const, paid_on: null, note: row?.note ?? null, partial: p.partial,
    });
  }
  const totals = rows.reduce(
    (t, r) => ({ gross: t.gross + r.gross, commission: t.commission + (r.commission ?? 0), advances: t.advances + r.advances, net: t.net + r.net }),
    { gross: 0, commission: 0, advances: 0, net: 0 },
  );
  return c.json({ month, rows, totals });
});

/** Saves an adjustment or note, or marks the month's pay as paid (which freezes the numbers). */
people.put("/payroll/:month/:staffId", requireRole("owner"), async (c) => {
  const user = c.get("user");
  const month = requireMonth(c.req.param("month"));
  const staffId = Number(c.req.param("staffId"));
  const s = await c.env.DB.prepare("SELECT id, name, role, pay_type, pay_rate, joined_on, is_waiter, left_on FROM staff WHERE id = ?").bind(staffId).first<StaffRow>();
  if (!s) throw new HttpError(404, "not_found");
  const b = await c.req.json<{ adjustment?: unknown; note?: unknown; status?: unknown }>();
  const before = await c.env.DB.prepare("SELECT * FROM payroll WHERE staff_id = ? AND month = ?").bind(staffId, month).first<PayrollRow>();
  // Adjustment is whole paise and may be negative (a deduction) or positive (a bonus).
  let adjustment = before?.adjustment ?? 0;
  if (b.adjustment !== undefined && b.adjustment !== null) {
    if (typeof b.adjustment !== "number" || !Number.isInteger(b.adjustment) || Math.abs(b.adjustment) > 1_00_00_000_00) throw new HttpError(422, "invalid", { field: "adjustment" });
    adjustment = b.adjustment;
  }
  const note = b.note === undefined ? before?.note ?? null : optionalText(b.note);
  // A paid row stays paid, with its numbers frozen, unless the request asks for "draft": saving a note changes only the note.
  if (before?.status === "paid" && b.status === undefined) {
    await c.env.DB.prepare("UPDATE payroll SET note = ?, updated_at = datetime('now') WHERE staff_id = ? AND month = ?").bind(note, staffId, month).run();
    await audit(c.env.DB, "payroll", staffId, "update", before, { month, note }, user.id);
    return c.json({ ok: true, net: before.net });
  }
  const status = b.status === "paid" || (b.status === undefined && before?.status === "paid") ? "paid" : "draft";
  const p = await computeFor(c.env.DB, month, s, adjustment);
  await c.env.DB.prepare(
    `INSERT INTO payroll (staff_id, month, pay_type, rate, days_worked, days_absent, days_unmarked, gross, advances, adjustment, net, status, paid_on, note, commission, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (staff_id, month) DO UPDATE SET pay_type = excluded.pay_type, rate = excluded.rate, days_worked = excluded.days_worked,
       days_absent = excluded.days_absent, days_unmarked = excluded.days_unmarked, gross = excluded.gross, advances = excluded.advances,
       adjustment = excluded.adjustment, net = excluded.net, status = excluded.status, paid_on = excluded.paid_on, note = excluded.note,
       commission = excluded.commission, updated_at = excluded.updated_at`,
  )
    .bind(staffId, month, s.pay_type, s.pay_rate, p.days_worked, p.days_absent, p.counts.unmarked, p.gross, p.advances, adjustment, p.net, status,
      status === "paid" ? businessDate() : null, note, p.commission)
    .run();
  await audit(c.env.DB, "payroll", staffId, before ? "update" : "create", before, { month, status, adjustment, net: p.net }, user.id);
  return c.json({ ok: true, net: p.net });
});

// Used by cron: was attendance marked for yesterday?
export async function attendanceMarked(db: D1Database, date: string): Promise<boolean> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM attendance WHERE business_date = ?").bind(date).first<{ n: number }>();
  return (r?.n ?? 0) > 0;
}
