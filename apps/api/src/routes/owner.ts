import { Hono } from "hono";
import { addDays, DEFAULT_LANG, businessDate, DEFAULT_SETTINGS, parseUserList, type CloseFlag } from "@mausam/shared";
import type { AppEnv } from "../env";
import { hashPin, normalisePhone, requireRole, validPin } from "../lib/auth";
import { audit, auditStmt, bool, loadSettings } from "../lib/db";
import { HttpError, isDate, optionalPaise, optionalText, requireDate, requireText } from "../lib/http";

export const owner = new Hono<AppEnv>();

/* ---------- Alerts (owner and managers can see; only unseen count matters for badges) ---------- */

/** The alert audiences each role sees. */
const audienceFor = (role: string) => (role === "owner" ? ["owner", "manager", "all"] : ["manager", "all"]);

owner.get("/alerts", requireRole("owner", "manager"), async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT id, type, business_date, severity, params, created_at, seen_at FROM alerts
     WHERE audience IN (SELECT value FROM json_each(?)) ORDER BY seen_at IS NOT NULL, created_at DESC LIMIT 100`,
  )
    .bind(JSON.stringify(audienceFor(user.role)))
    .all<Record<string, unknown>>();
  return c.json({ alerts: results.map((r) => ({ ...r, params: JSON.parse(String(r.params)) })) });
});

/** Marks alerts seen: the ones listed, or all unseen ones. Only alerts this person can see: a manager can't clear the owner's. */
owner.post("/alerts/seen", requireRole("owner", "manager"), async (c) => {
  const b = await c.req.json<{ ids?: number[] }>();
  const user = c.get("user");
  const audience = JSON.stringify(audienceFor(user.role));
  if (Array.isArray(b.ids) && b.ids.length) {
    const ids = b.ids.map(Number).filter(Number.isInteger).slice(0, 200);
    await c.env.DB.prepare(
      `UPDATE alerts SET seen_at = datetime('now'), seen_by = ?1
       WHERE id IN (SELECT value FROM json_each(?2)) AND audience IN (SELECT value FROM json_each(?3)) AND seen_at IS NULL`,
    )
      .bind(user.id, JSON.stringify(ids), audience)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE alerts SET seen_at = datetime('now'), seen_by = ?1 WHERE seen_at IS NULL AND audience IN (SELECT value FROM json_each(?2))")
      .bind(user.id, audience)
      .run();
  }
  return c.json({ ok: true });
});

/* ---------- Everything below is owner-only ---------- */

owner.use("/summary", requireRole("owner"));
// Daily sales, cash/online and expenses are the basic reports managers see too.
owner.use("/reports/*", requireRole("owner", "manager"));
owner.use("/users", requireRole("owner"));
owner.use("/users/*", requireRole("owner"));
owner.use("/staff", requireRole("owner"));
owner.use("/staff/*", requireRole("owner"));
owner.use("/settings", requireRole("owner"));
owner.use("/manage/categories", requireRole("owner"));
owner.use("/manage/categories/*", requireRole("owner"));

const parseClose = (r: Record<string, unknown> | null) =>
  r ? { ...r, flags: JSON.parse(String(r.flags ?? "[]")) as CloseFlag[], late: bool(r.late) } : null;

/** Owner home: one business day (default yesterday) with comparison and context. */
owner.get("/summary", async (c) => {
  const db = c.env.DB;
  const q = c.req.query("date");
  const date = isDate(q) ? q : addDays(businessDate(), -1);
  const lastWeek = addDays(date, -7);
  const closeSql = `SELECT d.*, u.name AS submitted_by_name FROM day_closes d JOIN users u ON u.id = d.submitted_by WHERE d.business_date = ?`;
  const [close, compare] = await Promise.all([
    db.prepare(closeSql).bind(date).first<Record<string, unknown>>(),
    db.prepare(closeSql).bind(lastWeek).first<Record<string, unknown>>(),
  ]);
  const { results: byCat } = await db
    .prepare(
      `SELECT c.key, c.name_en AS name, c.name_hi, c.name_kn, SUM(e.amount) AS amount FROM expenses e
       JOIN expense_categories c ON c.id = e.category_id
       WHERE e.business_date = ? AND e.deleted_at IS NULL GROUP BY c.id ORDER BY amount DESC`,
    )
    .bind(date)
    .all();
  const noReceipt = await db
    .prepare("SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE business_date = ? AND has_receipt = 0 AND deleted_at IS NULL")
    .bind(date)
    .first<{ s: number }>();
  const entered = await db
    .prepare("SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE business_date = ? AND deleted_at IS NULL")
    .bind(date)
    .first<{ s: number }>();
  const from = addDays(date, -6);
  const { results: week } = await db
    .prepare("SELECT business_date, total_counter, expenses, late FROM day_closes WHERE business_date BETWEEN ? AND ? ORDER BY business_date")
    .bind(from, date)
    .all<{ business_date: string; total_counter: number; expenses: number; late: number }>();
  const map = new Map(week.map((w) => [w.business_date, w]));
  const last7 = [];
  for (let d = from; d <= date; d = addDays(d, 1)) {
    const w = map.get(d);
    last7.push({
      business_date: d,
      total_counter: w?.total_counter ?? null,
      expenses: w?.expenses ?? null,
      status: w ? (bool(w.late) ? "late" : "on_time") : "missing",
    });
  }
  return c.json({
    business_date: date,
    close: parseClose(close),
    compare: parseClose(compare),
    expenses_entered: entered?.s ?? 0,
    expenses_by_category: byCat,
    no_receipt_total: noReceipt?.s ?? 0,
    last7,
  });
});

function rangeFrom(c: { req: { query: (k: string) => string | undefined } }) {
  const to = isDate(c.req.query("to")) ? c.req.query("to")! : businessDate();
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 7), 366);
  return { from: addDays(to, -(days - 1)), to };
}

/** Daily totals for sales, cash/online split and reporting punctuality. */
owner.get("/reports/daily", async (c) => {
  const { from, to } = rangeFrom(c);
  const { results } = await c.env.DB.prepare(
    `SELECT business_date, total_counter, cash, online, expenses, pos_sales, late, flags, submitted_at
     FROM day_closes WHERE business_date BETWEEN ? AND ? ORDER BY business_date`,
  )
    .bind(from, to)
    .all<Record<string, unknown>>();
  return c.json({ from, to, days: results.map((r) => ({ ...r, late: bool(r.late), flags: JSON.parse(String(r.flags)) })) });
});

/** Expenses per category per week (weeks start Monday). */
owner.get("/reports/expenses", async (c) => {
  const { from, to } = rangeFrom(c);
  const { results } = await c.env.DB.prepare(
    `SELECT e.business_date, c.key, c.name_en AS name, c.name_hi, c.name_kn, SUM(e.amount) AS amount,
            SUM(CASE WHEN e.has_receipt = 0 THEN e.amount ELSE 0 END) AS no_receipt
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ?
     GROUP BY e.business_date, c.id ORDER BY e.business_date`,
  )
    .bind(from, to)
    .all();
  return c.json({ from, to, rows: results });
});

/**
 * Cancelled bills, discounts and items taken off after printing: where money can go missing at the counter. Daily
 * totals, who did them, and the bills, newest first (with bills the server flagged, e.g. a price not on the menu).
 * "Who" is the person logged in on the POS device.
 */
owner.get("/reports/leaks", async (c) => {
  const { from, to } = rangeFrom(c);
  const db = c.env.DB;
  const [daily, people, bills, sales, voids, voidPeople] = await Promise.all([
    db.prepare(
      `SELECT business_date,
              SUM(CASE WHEN status = 'cancelled' THEN total ELSE 0 END) AS cancelled,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_n,
              SUM(CASE WHEN status = 'paid' THEN discount ELSE 0 END) AS discount,
              SUM(CASE WHEN status = 'paid' AND discount > 0 THEN 1 ELSE 0 END) AS discount_n
       FROM pos_bills WHERE business_date BETWEEN ? AND ? AND (status = 'cancelled' OR discount > 0)
       GROUP BY business_date ORDER BY business_date`,
    ).bind(from, to).all<{ business_date: string; cancelled: number; cancelled_n: number; discount: number; discount_n: number }>(),
    db.prepare(
      `SELECT COALESCE(u.name, '—') AS name,
              SUM(CASE WHEN b.status = 'cancelled' THEN b.total ELSE 0 END) AS cancelled,
              SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_n,
              SUM(CASE WHEN b.status = 'paid' THEN b.discount ELSE 0 END) AS discount,
              SUM(CASE WHEN b.status = 'paid' AND b.discount > 0 THEN 1 ELSE 0 END) AS discount_n
       FROM pos_bills b LEFT JOIN users u ON u.id = b.created_by
       WHERE b.business_date BETWEEN ? AND ? AND (b.status = 'cancelled' OR b.discount > 0)
       GROUP BY b.created_by ORDER BY cancelled + discount DESC`,
    ).bind(from, to).all<{ name: string; cancelled: number; cancelled_n: number; discount: number; discount_n: number }>(),
    db.prepare(
      `SELECT b.bill_no, b.business_date, b.closed_at, b.order_type, b.table_name, b.token, b.status, b.total, b.subtotal, b.discount,
              b.cancel_reason, u.name AS by_name, COALESCE(b.waiter_name, s.name) AS waiter_name,
              b.discount_reason, a.name AS approved_by_name, b.flags
       FROM pos_bills b LEFT JOIN users u ON u.id = b.created_by LEFT JOIN staff s ON s.id = b.waiter_staff_id
            LEFT JOIN users a ON a.id = b.discount_approved_by
       WHERE b.business_date BETWEEN ? AND ? AND (b.status = 'cancelled' OR b.discount > 0 OR b.flags IS NOT NULL)
       ORDER BY b.closed_at DESC LIMIT 300`,
    ).bind(from, to).all(),
    db.prepare("SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n FROM pos_bills WHERE status = 'paid' AND business_date BETWEEN ? AND ?")
      .bind(from, to).first<{ total: number; n: number }>(),
    db.prepare(
      `SELECT b.bill_no, b.business_date, b.status AS bill_status, v.name, v.variation, v.qty, v.price, v.qty * v.price AS amount,
              v.stage, v.removed_at, u.name AS by_name,
              SUM(v.qty * v.price) OVER () AS all_amount, COUNT(*) OVER () AS all_n
       FROM pos_bill_voids v JOIN pos_bills b ON b.id = v.bill_id LEFT JOIN users u ON u.id = v.removed_by
       WHERE b.business_date BETWEEN ? AND ?
       ORDER BY v.removed_at DESC LIMIT 300`,
    ).bind(from, to).all<{ amount: number; all_amount: number; all_n: number }>(),
    db.prepare(
      `SELECT COALESCE(u.name, '—') AS name, SUM(v.qty * v.price) AS removed, COUNT(*) AS removed_n
       FROM pos_bill_voids v JOIN pos_bills b ON b.id = v.bill_id LEFT JOIN users u ON u.id = v.removed_by
       WHERE b.business_date BETWEEN ? AND ?
       GROUP BY v.removed_by ORDER BY removed DESC`,
    ).bind(from, to).all<{ name: string; removed: number; removed_n: number }>(),
  ]);
  return c.json({
    from, to, sales: sales?.total ?? 0, paid_bills: sales?.n ?? 0, days: daily.results, people: people.results, bills: bills.results,
    voids: voids.results, void_people: voidPeople.results,
  });
});

/** Item sales for one day, like the old POS's Item Sales Summary: each item and variation, by category. Paid bills only. */
owner.get("/reports/item-sales", async (c) => {
  const date = c.req.query("date") ?? businessDate();
  if (!isDate(date)) throw new HttpError(422, "invalid", { field: "date" });
  const { results } = await c.env.DB.prepare(
    `SELECT COALESCE(i.category, '—') AS category, i.name, i.variation, SUM(i.qty) AS qty, SUM(i.amount) AS amount
     FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id
     WHERE b.business_date = ? AND b.status = 'paid'
     GROUP BY i.category, i.name, i.variation ORDER BY category, amount DESC`,
  )
    .bind(date)
    .all<{ category: string; name: string; variation: string | null; qty: number; amount: number }>();
  return c.json({ date, items: results });
});

/** Dine-in against parcel: sales, bills and average bill for each, by day and by hour, and each one's top items. Paid bills only. */
owner.get("/reports/order-types", async (c) => {
  const { from, to } = rangeFrom(c);
  const db = c.env.DB;
  const [daily, hours, items] = await Promise.all([
    db.prepare(
      `SELECT business_date, order_type, COUNT(*) AS bills, SUM(total) AS sales
       FROM pos_bills WHERE status = 'paid' AND business_date BETWEEN ? AND ?
       GROUP BY business_date, order_type ORDER BY business_date`,
    ).bind(from, to).all<{ business_date: string; order_type: "dine_in" | "parcel"; bills: number; sales: number }>(),
    db.prepare(
      `SELECT CAST(strftime('%H', closed_at, '+330 minutes') AS INTEGER) AS hour, order_type, COUNT(*) AS bills, SUM(total) AS sales
       FROM pos_bills WHERE status = 'paid' AND business_date BETWEEN ? AND ?
       GROUP BY hour, order_type ORDER BY hour`,
    ).bind(from, to).all<{ hour: number; order_type: "dine_in" | "parcel"; bills: number; sales: number }>(),
    db.prepare(
      `SELECT order_type, name, qty, amount FROM (
         SELECT b.order_type, i.name, SUM(i.qty) AS qty, SUM(i.amount) AS amount,
                ROW_NUMBER() OVER (PARTITION BY b.order_type ORDER BY SUM(i.amount) DESC) AS rn
         FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id
         WHERE b.status = 'paid' AND b.business_date BETWEEN ? AND ?
         GROUP BY b.order_type, i.name)
       WHERE rn <= 8 ORDER BY order_type, amount DESC`,
    ).bind(from, to).all<{ order_type: "dine_in" | "parcel"; name: string; qty: number; amount: number }>(),
  ]);
  return c.json({ from, to, days: daily.results, hours: hours.results, items: items.results });
});

/* ---------- App users ---------- */

owner.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, phone, role, language, active, created_at FROM users ORDER BY role = 'owner' DESC, name",
  ).all();
  return c.json({ users: results.map((r) => ({ ...r, active: bool(r.active) })) });
});

owner.post("/users", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const name = requireText(b.name, "name", 80);
  const phone = normalisePhone(b.phone);
  if (!phone) throw new HttpError(422, "invalid", { field: "phone" });
  if (!validPin(b.pin)) throw new HttpError(422, "invalid", { field: "pin" });
  const role = ["owner", "manager", "staff"].includes(String(b.role)) ? String(b.role) : "manager";
  const language = ["en", "hi", "kn"].includes(String(b.language)) ? String(b.language) : DEFAULT_LANG;
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first();
  if (exists) throw new HttpError(409, "phone_taken");
  const { hash, salt } = await hashPin(b.pin);
  const res = await c.env.DB.prepare(
    "INSERT INTO users (name, phone, role, pin_hash, pin_salt, language) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(name, phone, role, hash, salt, language)
    .run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "users", id, "create", null, { name, phone, role }, c.get("user").id);
  return c.json({ id }, 201);
});

owner.patch("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<Record<string, unknown>>();
  const before = await c.env.DB.prepare("SELECT id, name, phone, role, language, active FROM users WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) throw new HttpError(404, "not_found");
  if (id === c.get("user").id && (b.active === false || (b.role && b.role !== "owner"))) {
    throw new HttpError(422, "cannot_demote_self");
  }
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (b.name !== undefined) (sets.push("name = ?"), binds.push(requireText(b.name, "name", 80)));
  if (b.role !== undefined) {
    if (!["owner", "manager", "staff"].includes(String(b.role))) throw new HttpError(422, "invalid", { field: "role" });
    sets.push("role = ?"), binds.push(b.role);
  }
  if (b.language !== undefined) sets.push("language = ?"), binds.push(String(b.language));
  if (b.active !== undefined) sets.push("active = ?"), binds.push(b.active ? 1 : 0);
  if (b.pin !== undefined) {
    if (!validPin(b.pin)) throw new HttpError(422, "invalid", { field: "pin" });
    const { hash, salt } = await hashPin(b.pin);
    sets.push("pin_hash = ?", "pin_salt = ?", "failed_logins = 0", "locked_until = NULL", "lock_count = 0");
    binds.push(hash, salt);
  }
  if (!sets.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
  if (b.active === false || b.pin !== undefined) await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  const { pin: _p, ...logged } = b;
  await audit(c.env.DB, "users", id, "update", before, { ...logged, pin_changed: b.pin !== undefined }, c.get("user").id);
  return c.json({ ok: true });
});

/* ---------- Staff ---------- */

owner.get("/staff", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM staff ORDER BY active DESC, name").all();
  return c.json({ staff: results.map((r) => ({ ...r, active: bool(r.active) })) });
});

function staffFields(b: Record<string, unknown>) {
  const payType = b.pay_type ? String(b.pay_type) : null;
  if (payType && !["monthly", "daily", "shift"].includes(payType)) throw new HttpError(422, "invalid", { field: "pay_type" });
  return {
    name: requireText(b.name, "name", 80),
    name_local: optionalText(b.name_local, 80),
    role: optionalText(b.role, 60) ?? "",
    phone: b.phone ? normalisePhone(b.phone) : null,
    pay_type: payType,
    pay_rate: optionalPaise(b.pay_rate, "pay_rate"),
    joined_on: isDate(b.joined_on) ? b.joined_on : null,
    active: b.active === false ? 0 : 1,
    left_on: isDate(b.left_on) ? b.left_on : null,
  };
}

owner.post("/staff", async (c) => {
  const f = staffFields(await c.req.json());
  const res = await c.env.DB.prepare(
    "INSERT INTO staff (name, name_local, role, phone, pay_type, pay_rate, joined_on, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(f.name, f.name_local, f.role, f.phone, f.pay_type, f.pay_rate, f.joined_on, f.active)
    .run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "staff", id, "create", null, f, c.get("user").id);
  return c.json({ id }, 201);
});

owner.put("/staff/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT * FROM staff WHERE id = ?").bind(id).first();
  if (!before) throw new HttpError(404, "not_found");
  const f = staffFields(await c.req.json());
  // Someone made inactive left on the day given, or today. Made active again, they haven't left.
  f.left_on = f.active ? null : f.left_on ?? (before.left_on as string | null) ?? businessDate();
  await c.env.DB.prepare(
    "UPDATE staff SET name = ?, name_local = ?, role = ?, phone = ?, pay_type = ?, pay_rate = ?, joined_on = ?, active = ?, left_on = ? WHERE id = ?",
  )
    .bind(f.name, f.name_local, f.role, f.phone, f.pay_type, f.pay_rate, f.joined_on, f.active, f.left_on, id)
    .run();
  await audit(c.env.DB, "staff", id, "update", before, f, c.get("user").id);
  return c.json({ ok: true });
});

/* ---------- Expense categories ---------- */

owner.get("/manage/categories", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM expense_categories ORDER BY active DESC, sort, name_en").all();
  return c.json({ categories: results.map((r) => ({ ...r, active: bool(r.active) })) });
});

owner.post("/manage/categories", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const name = requireText(b.name_en, "name_en", 60);
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `cat_${Date.now()}`;
  const res = await c.env.DB.prepare(
    "INSERT INTO expense_categories (key, name_en, name_hi, name_kn, sort) VALUES (?, ?, ?, ?, 500) ON CONFLICT (key) DO UPDATE SET active = 1, name_en = excluded.name_en",
  )
    .bind(key, name, optionalText(b.name_hi, 60), optionalText(b.name_kn, 60))
    .run();
  return c.json({ id: Number(res.meta.last_row_id) }, 201);
});

owner.put("/manage/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<Record<string, unknown>>();
  const db = c.env.DB;
  const before = await db.prepare("SELECT name_en, name_hi, name_kn, active FROM expense_categories WHERE id = ?").bind(id).first();
  if (!before) throw new HttpError(404, "not_found");
  const after = { name_en: requireText(b.name_en, "name_en", 60), name_hi: optionalText(b.name_hi, 60), name_kn: optionalText(b.name_kn, 60), active: b.active === false ? 0 : 1 };
  await db.batch([
    db.prepare("UPDATE expense_categories SET name_en = ?, name_hi = ?, name_kn = ?, active = ? WHERE id = ?")
      .bind(after.name_en, after.name_hi, after.name_kn, after.active, id),
    auditStmt(db, "expense_categories", id, "update", before, after, c.get("user").id),
  ]);
  return c.json({ ok: true });
});

/* ---------- Settings ---------- */

owner.get("/settings", async (c) => c.json({ settings: await loadSettings(c.env.DB) }));

owner.put("/settings", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const stmts = [];
  const changed: Record<string, string> = {};
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (b[key] === undefined) continue;
    let value: string;
    if (key === "remind_shopping_to" || key === "remind_close_to") {
      const raw = Array.isArray(b[key]) ? (b[key] as unknown[]).join(",") : String(b[key] ?? "");
      value = parseUserList(raw).join(",");
    } else if (typeof def === "number") {
      const n = Number(b[key]);
      if (!Number.isFinite(n) || n < 0) throw new HttpError(422, "invalid", { field: key });
      value = String(Math.round(n));
    } else {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b[key]))) throw new HttpError(422, "invalid", { field: key });
      value = String(b[key]);
    }
    changed[key] = value;
    stmts.push(
      c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, value),
    );
  }
  if (stmts.length) {
    const before = await loadSettings(c.env.DB);
    const was = Object.fromEntries(Object.keys(changed).map((k) => [k, String((before as unknown as Record<string, unknown>)[k])]));
    await c.env.DB.batch([...stmts, auditStmt(c.env.DB, "settings", 0, "update", was, changed, c.get("user").id)]);
  }
  return c.json({ settings: await loadSettings(c.env.DB) });
});

/* ---------- Audit trail for one record ---------- */

owner.get("/audit/:table/:id", requireRole("owner"), async (c) => {
  const table = c.req.param("table");
  if (!["expenses", "day_closes", "shopping_trips", "staff", "users"].includes(table)) throw new HttpError(404, "not_found");
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.table_name = ? AND a.row_id = ? ORDER BY a.at DESC`,
  )
    .bind(table, Number(c.req.param("id")))
    .all();
  return c.json({ entries: results });
});

