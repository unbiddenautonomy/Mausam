import { Hono } from "hono";
import { businessDate, checkClose, isLocked, type CloseFlag } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { assertDayOpen, audit, bool, loadSettings } from "../lib/db";
import { alertParams, notify } from "../lib/notify";
import { HttpError, isDate, optionalPaise, optionalText, requireDate, requirePaise } from "../lib/http";

export const entries = new Hono<AppEnv>();
entries.use("*", requireRole("owner", "manager"));

const EXPENSE_SELECT = `
  SELECT e.id, e.business_date, e.trip_id, e.category_id, c.key AS category_key, c.name_en AS category_name,
         c.name_hi AS category_name_hi, c.name_kn AS category_name_kn,
         e.shop, e.amount, e.mode, e.has_receipt, e.photo_key, e.note, e.source, e.ref_id, e.item, e.qty, e.unit, e.created_by, u.name AS created_by_name, e.created_at
  FROM expenses e
  JOIN expense_categories c ON c.id = e.category_id
  JOIN users u ON u.id = e.created_by
  WHERE e.deleted_at IS NULL`;

function mapExpense(r: Record<string, unknown>) {
  return { ...r, has_receipt: bool(r.has_receipt) };
}

function mapClose(r: Record<string, unknown> | null) {
  if (!r) return null;
  return { ...r, flags: JSON.parse(String(r.flags ?? "[]")) as CloseFlag[], late: bool(r.late) };
}

/** Cash expenses for a shopping trip, or for a whole business day (what came out of the counter). */
async function sumCashExpenses(db: D1Database, date: string, tripId?: number) {
  const q = tripId
    ? db.prepare("SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM expenses WHERE trip_id = ? AND mode = 'cash' AND deleted_at IS NULL").bind(tripId)
    : db.prepare("SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM expenses WHERE business_date = ? AND mode = 'cash' AND deleted_at IS NULL").bind(date);
  return (await q.first<{ s: number; n: number }>()) ?? { s: 0, n: 0 };
}

/* ---------- Today ---------- */

entries.get("/today", async (c) => {
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const date = businessDate();
  const trip = await db
    .prepare(
      `SELECT t.*, u.name AS manager_name FROM shopping_trips t JOIN users u ON u.id = t.manager_id
       WHERE t.business_date = ? ORDER BY t.id DESC LIMIT 1`,
    )
    .bind(date)
    .first<Record<string, unknown>>();
  let tripOut = null;
  if (trip) {
    const spent = await sumCashExpenses(db, date, Number(trip.id));
    tripOut = { ...trip, spent: spent.s, count: spent.n };
  }
  const exp = await sumCashExpenses(db, date);
  const close = await db
    .prepare(
      `SELECT d.*, u.name AS submitted_by_name FROM day_closes d JOIN users u ON u.id = d.submitted_by WHERE d.business_date = ?`,
    )
    .bind(date)
    .first<Record<string, unknown>>();
  const alerts = await db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE seen_at IS NULL").first<{ n: number }>();
  return c.json({
    business_date: date,
    locked: isLocked(date, new Date(), settings.lock_hour),
    settings: { close_due: settings.close_due, shopping_due: settings.shopping_due },
    shopping: { status: trip ? trip.status : "not_started", trip: tripOut },
    expenses: { count: exp.n, total: exp.s },
    close: { status: close ? "done" : "pending", close: mapClose(close) },
    open_alerts: alerts?.n ?? 0,
  });
});

/* ---------- Expense categories ---------- */

entries.get("/categories", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, key, name_en, name_hi, name_kn, sort, active FROM expense_categories WHERE active = 1 ORDER BY sort, name_en",
  ).all();
  return c.json({ categories: results.map((r) => ({ ...r, active: bool(r.active) })) });
});

/* ---------- Expenses ---------- */

entries.get("/expenses", async (c) => {
  const date = c.req.query("date");
  const trip = c.req.query("trip_id");
  let sql = EXPENSE_SELECT;
  const binds: unknown[] = [];
  if (trip) {
    sql += " AND e.trip_id = ?";
    binds.push(Number(trip));
  } else {
    sql += " AND e.business_date = ?";
    binds.push(isDate(date) ? date : businessDate());
  }
  sql += " ORDER BY e.created_at DESC, e.id DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ expenses: results.map(mapExpense) });
});

entries.post("/expenses", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();
  const date = b.business_date ? requireDate(b.business_date) : businessDate();
  await assertDayOpen(c.env.DB, user, date);
  const amount = requirePaise(b.amount, "amount");
  const categoryId = Number(b.category_id);
  const cat = await c.env.DB.prepare("SELECT id FROM expense_categories WHERE id = ? AND active = 1").bind(categoryId).first();
  if (!cat) throw new HttpError(422, "invalid", { field: "category_id" });
  const mode = b.mode === "online" ? "online" : "cash";
  const tripId = b.trip_id ? Number(b.trip_id) : null;
  if (tripId) {
    const trip = await c.env.DB.prepare("SELECT status FROM shopping_trips WHERE id = ?").bind(tripId).first<{ status: string }>();
    if (!trip) throw new HttpError(422, "invalid", { field: "trip_id" });
  }
  const clientId = typeof b.client_id === "string" ? b.client_id.slice(0, 64) : null;
  if (clientId) {
    const existing = await c.env.DB.prepare(`${EXPENSE_SELECT} AND e.client_id = ?`).bind(clientId).first();
    if (existing) return c.json({ expense: mapExpense(existing), duplicate: true });
  }
  const photoKey = optionalText(b.photo_key, 200);
  // Optional quantity bought, for price tracking.
  const qty = b.qty === undefined || b.qty === null || b.qty === "" ? null : Number(b.qty);
  if (qty !== null && !(qty > 0 && qty < 100000)) throw new HttpError(422, "invalid", { field: "qty" });
  const res = await c.env.DB.prepare(
    `INSERT INTO expenses (business_date, trip_id, category_id, shop, amount, mode, has_receipt, photo_key, note, client_id, created_by, item, qty, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      date,
      tripId,
      categoryId,
      optionalText(b.shop, 80),
      amount,
      mode,
      b.has_receipt === false ? 0 : photoKey ? 1 : bool(b.has_receipt) ? 1 : 0,
      photoKey,
      optionalText(b.note),
      clientId,
      user.id,
      optionalText(b.item, 60),
      qty,
      qty ? optionalText(b.unit, 20) ?? "kg" : null,
    )
    .run();
  const id = Number(res.meta.last_row_id);
  const row = await c.env.DB.prepare(`${EXPENSE_SELECT} AND e.id = ?`).bind(id).first();
  await audit(c.env.DB, "expenses", id, "create", null, row, user.id);
  return c.json({ expense: mapExpense(row!) }, 201);
});

entries.delete("/expenses/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(`${EXPENSE_SELECT} AND e.id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "not_found");
  if (user.role !== "owner" && row.created_by !== user.id) throw new HttpError(403, "not_allowed");
  // Advances and vendor payments are removed from their own page, which removes this line too.
  if (row.source !== "manual") throw new HttpError(409, "linked_entry", { source: row.source });
  await assertDayOpen(c.env.DB, user, String(row.business_date));
  await c.env.DB.prepare("UPDATE expenses SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();
  await audit(c.env.DB, "expenses", id, "delete", row, null, user.id);
  return c.json({ ok: true });
});

/* ---------- Shopping trips ---------- */

entries.get("/shopping/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const trip = await c.env.DB.prepare(
    "SELECT t.*, u.name AS manager_name FROM shopping_trips t JOIN users u ON u.id = t.manager_id WHERE t.id = ?",
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!trip) throw new HttpError(404, "not_found");
  const spent = await sumCashExpenses(c.env.DB, String(trip.business_date), id);
  const { results } = await c.env.DB.prepare(`${EXPENSE_SELECT} AND e.trip_id = ? ORDER BY e.id DESC`).bind(id).all();
  return c.json({ trip: { ...trip, spent: spent.s, count: spent.n }, expenses: results.map(mapExpense) });
});

entries.post("/shopping", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();
  const date = businessDate();
  const open = await c.env.DB.prepare("SELECT id FROM shopping_trips WHERE business_date = ? AND status = 'open'")
    .bind(date)
    .first<{ id: number }>();
  if (open) throw new HttpError(409, "trip_already_open", { id: open.id });
  const floatOut = requirePaise(b.float_out, "float_out");
  const res = await c.env.DB.prepare("INSERT INTO shopping_trips (business_date, manager_id, float_out) VALUES (?, ?, ?)")
    .bind(date, user.id, floatOut)
    .run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "shopping_trips", id, "create", null, { float_out: floatOut }, user.id);
  return c.json({ id }, 201);
});

entries.post("/shopping/:id/close", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const b = await c.req.json<Record<string, unknown>>();
  const trip = await c.env.DB.prepare("SELECT * FROM shopping_trips WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!trip) throw new HttpError(404, "not_found");
  await assertDayOpen(c.env.DB, user, String(trip.business_date));
  const floatBack = requirePaise(b.float_back, "float_back", { allowZero: true });
  const spent = await sumCashExpenses(c.env.DB, String(trip.business_date), id);
  const settings = await loadSettings(c.env.DB);
  const gap = Number(trip.float_out) - spent.s - floatBack;
  const note = optionalText(b.note);
  if (Math.abs(gap) > settings.shopping_tolerance && !note) throw new HttpError(422, "note_required", { gap });
  await c.env.DB.prepare(
    "UPDATE shopping_trips SET float_back = ?, note = ?, status = 'closed', closed_at = datetime('now') WHERE id = ?",
  )
    .bind(floatBack, note, id)
    .run();
  await audit(c.env.DB, "shopping_trips", id, "update", trip, { float_back: floatBack, note, gap }, user.id);
  return c.json({ ok: true, gap });
});

/* ---------- Day close ---------- */

entries.get("/closes", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 60), 400);
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, u.name AS submitted_by_name FROM day_closes d JOIN users u ON u.id = d.submitted_by
     ORDER BY d.business_date DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({ closes: results.map((r) => mapClose(r)) });
});

entries.get("/closes/:date", async (c) => {
  const date = requireDate(c.req.param("date"));
  const close = await c.env.DB.prepare(
    `SELECT d.*, u.name AS submitted_by_name FROM day_closes d JOIN users u ON u.id = d.submitted_by WHERE d.business_date = ?`,
  )
    .bind(date)
    .first();
  const exp = await sumCashExpenses(c.env.DB, date);
  const settings = await loadSettings(c.env.DB);
  const pos = await c.env.DB.prepare("SELECT total, cash, online, bills FROM pos_daily WHERE business_date = ?").bind(date).first();
  return c.json({
    close: mapClose(close),
    pos,
    expenses_entered: exp.s,
    expenses_count: exp.n,
    locked: isLocked(date, new Date(), settings.lock_hour),
    tolerance: settings.cash_tolerance,
  });
});

entries.put("/closes/:date", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const date = requireDate(c.req.param("date"));
  if (date > businessDate()) throw new HttpError(422, "future_date");
  await assertDayOpen(db, user, date);
  const b = await c.req.json<Record<string, unknown>>();
  const input = {
    total_counter: requirePaise(b.total_counter, "total_counter", { allowZero: true }),
    cash: requirePaise(b.cash, "cash", { allowZero: true }),
    online: requirePaise(b.online, "online", { allowZero: true }),
    expenses: requirePaise(b.expenses, "expenses", { allowZero: true }),
    pos_sales: optionalPaise(b.pos_sales, "pos_sales"),
    memo_photo_key: optionalText(b.memo_photo_key, 200),
    pos_photo_key: optionalText(b.pos_photo_key, 200),
    note: optionalText(b.note),
  };
  if (input.pos_sales === null) {
    const pos = await db.prepare("SELECT total FROM pos_daily WHERE business_date = ?").bind(date).first<{ total: number }>();
    if (pos) input.pos_sales = pos.total;
  }
  const settings = await loadSettings(db);
  const entered = await sumCashExpenses(db, date);
  const flags = checkClose(input, { expensesEntered: entered.s, tolerance: settings.cash_tolerance });

  // Late = submitted after the escalation time the next morning.
  const [eh, em] = settings.close_escalate.split(":").map(Number);
  const nextDay = new Date(Date.parse(date + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  const escalateAt = Date.parse(`${nextDay}T00:00:00Z`) + (eh * 60 + em - 330) * 60_000;
  const before = await db.prepare("SELECT * FROM day_closes WHERE business_date = ?").bind(date).first<Record<string, unknown>>();
  const late = before ? bool(before.late) : Date.now() > escalateAt;
  if (late) flags.push({ code: "late" });

  await db
    .prepare(
      `INSERT INTO day_closes (business_date, total_counter, cash, online, expenses, pos_sales, note, memo_photo_key, pos_photo_key, flags, late, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (business_date) DO UPDATE SET
         total_counter = excluded.total_counter, cash = excluded.cash, online = excluded.online, expenses = excluded.expenses,
         pos_sales = excluded.pos_sales, note = excluded.note, memo_photo_key = excluded.memo_photo_key,
         pos_photo_key = excluded.pos_photo_key, flags = excluded.flags`,
    )
    .bind(
      date,
      input.total_counter,
      input.cash,
      input.online,
      input.expenses,
      input.pos_sales,
      input.note,
      input.memo_photo_key,
      input.pos_photo_key,
      JSON.stringify(flags),
      late ? 1 : 0,
      before ? Number(before.submitted_by) : user.id,
    )
    .run();
  const row = await db.prepare("SELECT * FROM day_closes WHERE business_date = ?").bind(date).first<Record<string, unknown>>();
  await audit(db, "day_closes", Number(row!.id), before ? "update" : "create", before, row, user.id);

  // A missing-close alert is resolved by the submission; a flagged close raises one for the owner.
  await db.prepare("UPDATE alerts SET seen_at = datetime('now') WHERE type = 'close_missing' AND business_date = ? AND seen_at IS NULL").bind(date).run();
  // A memo that doesn't add up is accepted, but the owner and every manager get an alert, so it's looked at the same day.
  const mismatch = flags.find((f) => f.code === "formula_mismatch");
  if (mismatch) {
    const params = { amount: Math.abs(mismatch.diff ?? 0), diff: mismatch.diff ?? 0, name: user.name };
    await db
      .prepare(
        `INSERT INTO alerts (type, business_date, severity, params, audience) VALUES ('close_unbalanced', ?, 'critical', ?, 'all')
         ON CONFLICT (type, business_date) DO UPDATE SET params = excluded.params, seen_at = NULL, seen_by = NULL`,
      )
      .bind(date, JSON.stringify(params))
      .run();
    c.executionCtx.waitUntil(
      notify(
        c.env,
        "all",
        { title: "push.alert_title", body: "alert.close_unbalanced", params: alertParams("close_unbalanced", date, params) },
        { url: `/entries/close/${date}`, dedupeKey: `alert:close_unbalanced:${date}:${mismatch.diff}` },
      ),
    );
  } else {
    // Fixed on a later edit: the alert is settled.
    await db.prepare("UPDATE alerts SET seen_at = datetime('now'), seen_by = ? WHERE type = 'close_unbalanced' AND business_date = ? AND seen_at IS NULL").bind(user.id, date).run();
  }
  const serious = flags.filter((f) => f.code !== "no_memo_photo" && f.code !== "formula_mismatch");
  if (serious.length) {
    await db
      .prepare(
        `INSERT INTO alerts (type, business_date, severity, params) VALUES ('close_flag', ?, 'warn', ?)
         ON CONFLICT (type, business_date) DO UPDATE SET params = excluded.params, seen_at = NULL`,
      )
      .bind(date, JSON.stringify({ count: serious.length }))
      .run();
    c.executionCtx.waitUntil(
      notify(
        c.env,
        "owner",
        { title: "push.alert_title", body: "alert.close_flag", params: alertParams("close_flag", date, { count: serious.length }) },
        { url: `/entries/close/${date}`, dedupeKey: `alert:close_flag:${date}:${JSON.stringify(serious)}` },
      ),
    );
  }
  return c.json({ close: mapClose({ ...row!, submitted_by_name: user.name }) });
});

/** After a POS import: fill in POS sales on closes that had none and re-run their checks. */
export async function applyPosToCloses(db: D1Database, from: string, to: string): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT d.*, p.total AS pos_total FROM day_closes d JOIN pos_daily p ON p.business_date = d.business_date
       WHERE d.business_date BETWEEN ? AND ? AND (d.pos_sales IS NULL OR d.pos_sales != p.total)`,
    )
    .bind(from, to)
    .all<Record<string, unknown> & { business_date: string; pos_total: number }>();
  const settings = await loadSettings(db);
  for (const r of results) {
    const entered = await sumCashExpenses(db, r.business_date);
    const input = {
      total_counter: Number(r.total_counter), cash: Number(r.cash), online: Number(r.online), expenses: Number(r.expenses),
      pos_sales: r.pos_total, memo_photo_key: (r.memo_photo_key as string | null) ?? null,
    };
    const flags = checkClose(input, { expensesEntered: entered.s, tolerance: settings.cash_tolerance });
    if (bool(r.late)) flags.push({ code: "late" });
    await db.prepare("UPDATE day_closes SET pos_sales = ?, flags = ? WHERE business_date = ?").bind(r.pos_total, JSON.stringify(flags), r.business_date).run();
  }
  return results.length;
}
