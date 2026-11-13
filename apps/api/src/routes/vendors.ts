import { Hono } from "hono";
import { businessDate, dayOfWeek } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { addCounterExpense, removeCounterExpense } from "../lib/counter";
import { assertDayOpen, audit, bool } from "../lib/db";
import { HttpError, optionalPaise, optionalText, requireDate, requirePaise, requireText } from "../lib/http";
import { raise } from "../cron";

const TERMS = ["per_delivery", "weekly", "monthly"] as const;

export const vendors = new Hono<AppEnv>();
vendors.use("*", requireRole("owner", "manager"));

const DUE_SQL = `
  v.opening_due
  + COALESCE((SELECT SUM(amount) FROM deliveries d WHERE d.vendor_id = v.id AND d.deleted_at IS NULL), 0)
  - COALESCE((SELECT SUM(amount) FROM vendor_payments p WHERE p.vendor_id = v.id AND p.deleted_at IS NULL), 0)`;

/** What each vendor is owed right now. Used by the list and by month close. */
export async function vendorDues(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT v.id, v.name, ${DUE_SQL} AS due FROM vendors v WHERE v.active = 1 ORDER BY v.name`)
    .all<{ id: number; name: string; due: number }>();
  return results;
}

vendors.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.phone, v.payment_terms, v.opening_due, v.note, v.active, c.key AS category_key,
            ${DUE_SQL} AS due,
            (SELECT MAX(business_date) FROM deliveries d WHERE d.vendor_id = v.id AND d.deleted_at IS NULL) AS last_delivery,
            (SELECT COUNT(*) FROM vendor_items i WHERE i.vendor_id = v.id AND i.active = 1) AS items
     FROM vendors v LEFT JOIN expense_categories c ON c.id = v.category_id
     ORDER BY v.active DESC, v.name`,
  ).all();
  return c.json({ vendors: results });
});

/** Items expected today (by their delivery days) and whether they've been logged. */
vendors.get("/expected", async (c) => {
  const date = c.req.query("date") ? requireDate(c.req.query("date")) : businessDate();
  const dow = String(dayOfWeek(date));
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.item, i.unit, i.agreed_rate, i.usual_qty, i.delivery_days, v.id AS vendor_id, v.name AS vendor_name,
            (SELECT COUNT(*) FROM deliveries d WHERE d.item_id = i.id AND d.business_date = ? AND d.deleted_at IS NULL) AS logged
     FROM vendor_items i JOIN vendors v ON v.id = i.vendor_id
     WHERE i.active = 1 AND v.active = 1 AND i.delivery_days IS NOT NULL AND i.delivery_days != ''`,
  )
    .bind(date)
    .all<{ delivery_days: string; logged: number }>();
  const due = results.filter((r) => r.delivery_days.split(",").map((d) => d.trim()).includes(dow));
  return c.json({ date, items: due.map((r) => ({ ...r, logged: r.logged > 0 })) });
});

function readVendor(b: Record<string, unknown>) {
  const terms = TERMS.includes(b.payment_terms as (typeof TERMS)[number]) ? (b.payment_terms as string) : "monthly";
  return {
    name: requireText(b.name, "name", 80),
    phone: optionalText(b.phone, 20),
    category_id: b.category_id ? Number(b.category_id) : null,
    payment_terms: terms,
    opening_due: optionalPaise(b.opening_due, "opening_due") ?? 0,
    note: optionalText(b.note),
    active: b.active === undefined ? 1 : bool(b.active) ? 1 : 0,
  };
}

vendors.post("/", requireRole("owner"), async (c) => {
  const v = readVendor(await c.req.json());
  const res = await c.env.DB.prepare(
    "INSERT INTO vendors (name, phone, category_id, payment_terms, opening_due, note, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(v.name, v.phone, v.category_id, v.payment_terms, v.opening_due, v.note, v.active)
    .run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "vendors", id, "create", null, v, c.get("user").id);
  return c.json({ id }, 201);
});

vendors.patch("/:id{[0-9]+}", requireRole("owner"), async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT * FROM vendors WHERE id = ?").bind(id).first();
  if (!before) throw new HttpError(404, "not_found");
  const v = readVendor({ ...before, ...(await c.req.json()) });
  await c.env.DB.prepare("UPDATE vendors SET name = ?, phone = ?, category_id = ?, payment_terms = ?, opening_due = ?, note = ?, active = ? WHERE id = ?")
    .bind(v.name, v.phone, v.category_id, v.payment_terms, v.opening_due, v.note, v.active, id)
    .run();
  await audit(c.env.DB, "vendors", id, "update", before, v, c.get("user").id);
  return c.json({ ok: true });
});

vendors.get("/:id{[0-9]+}", async (c) => {
  const id = Number(c.req.param("id"));
  const vendor = await c.env.DB.prepare(`SELECT v.*, ${DUE_SQL} AS due FROM vendors v WHERE v.id = ?`).bind(id).first();
  if (!vendor) throw new HttpError(404, "not_found");
  const items = await c.env.DB.prepare("SELECT * FROM vendor_items WHERE vendor_id = ? ORDER BY active DESC, item").bind(id).all();
  const history = await c.env.DB.prepare(
    `SELECT 'delivery' AS kind, d.id AS id, d.business_date AS business_date, d.item AS label, d.qty AS qty, d.unit AS unit, d.rate AS rate, d.agreed_rate AS agreed_rate, d.amount AS amount, d.photo_key AS photo_key, d.note AS note, u.name AS by_name, d.created_at AS created_at
       FROM deliveries d LEFT JOIN users u ON u.id = d.created_by WHERE d.vendor_id = ? AND d.deleted_at IS NULL
     UNION ALL
     SELECT 'payment', p.id, p.business_date, p.mode, NULL, NULL, NULL, NULL, p.amount, NULL, p.note, u.name, p.created_at
       FROM vendor_payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.vendor_id = ? AND p.deleted_at IS NULL
     ORDER BY business_date DESC, created_at DESC LIMIT 100`,
  )
    .bind(id, id)
    .all();
  return c.json({ vendor, items: items.results, history: history.results });
});

/* ---------- Items (the deal) ---------- */

function readItem(b: Record<string, unknown>) {
  const days = typeof b.delivery_days === "string" ? b.delivery_days.split(",").map((d) => d.trim()).filter((d) => /^[0-6]$/.test(d)).join(",") : "";
  const qty = b.usual_qty === null || b.usual_qty === undefined || b.usual_qty === "" ? null : Number(b.usual_qty);
  if (qty !== null && !(qty > 0)) throw new HttpError(422, "invalid", { field: "usual_qty" });
  return {
    item: requireText(b.item, "item", 80),
    unit: optionalText(b.unit, 20) ?? "pcs",
    agreed_rate: requirePaise(b.agreed_rate, "agreed_rate"),
    usual_qty: qty,
    delivery_days: days || null,
    active: b.active === undefined ? 1 : bool(b.active) ? 1 : 0,
  };
}

vendors.post("/:id{[0-9]+}/items", requireRole("owner"), async (c) => {
  const vendorId = Number(c.req.param("id"));
  const i = readItem(await c.req.json());
  const res = await c.env.DB.prepare("INSERT INTO vendor_items (vendor_id, item, unit, agreed_rate, usual_qty, delivery_days, active) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(vendorId, i.item, i.unit, i.agreed_rate, i.usual_qty, i.delivery_days, i.active)
    .run();
  await audit(c.env.DB, "vendor_items", Number(res.meta.last_row_id), "create", null, i, c.get("user").id);
  return c.json({ id: res.meta.last_row_id }, 201);
});

vendors.patch("/items/:itemId", requireRole("owner"), async (c) => {
  const id = Number(c.req.param("itemId"));
  const before = await c.env.DB.prepare("SELECT * FROM vendor_items WHERE id = ?").bind(id).first();
  if (!before) throw new HttpError(404, "not_found");
  const i = readItem({ ...before, ...(await c.req.json()) });
  await c.env.DB.prepare("UPDATE vendor_items SET item = ?, unit = ?, agreed_rate = ?, usual_qty = ?, delivery_days = ?, active = ? WHERE id = ?")
    .bind(i.item, i.unit, i.agreed_rate, i.usual_qty, i.delivery_days, i.active, id)
    .run();
  await audit(c.env.DB, "vendor_items", id, "update", before, i, c.get("user").id);
  return c.json({ ok: true });
});

/* ---------- Deliveries (on credit) ---------- */

vendors.post("/:id{[0-9]+}/deliveries", async (c) => {
  const user = c.get("user");
  const vendorId = Number(c.req.param("id"));
  const vendor = await c.env.DB.prepare("SELECT id, name FROM vendors WHERE id = ? AND active = 1").bind(vendorId).first<{ id: number; name: string }>();
  if (!vendor) throw new HttpError(404, "not_found");
  const b = await c.req.json<Record<string, unknown>>();
  const date = b.business_date ? requireDate(b.business_date) : businessDate();
  await assertDayOpen(c.env.DB, user, date);
  const qty = Number(b.qty);
  if (!(qty > 0) || qty > 100000) throw new HttpError(422, "invalid", { field: "qty" });
  const rate = requirePaise(b.rate, "rate");
  let item = optionalText(b.item, 80);
  let unit = optionalText(b.unit, 20);
  let agreed: number | null = null;
  const itemId = b.item_id ? Number(b.item_id) : null;
  if (itemId) {
    const it = await c.env.DB.prepare("SELECT item, unit, agreed_rate FROM vendor_items WHERE id = ? AND vendor_id = ?").bind(itemId, vendorId)
      .first<{ item: string; unit: string; agreed_rate: number }>();
    if (!it) throw new HttpError(422, "invalid", { field: "item_id" });
    item = it.item;
    unit = it.unit;
    agreed = it.agreed_rate;
  }
  if (!item) throw new HttpError(422, "invalid", { field: "item" });
  const amount = Math.round(qty * rate);
  const res = await c.env.DB.prepare(
    `INSERT INTO deliveries (vendor_id, item_id, business_date, item, unit, qty, rate, amount, agreed_rate, photo_key, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(vendorId, itemId, date, item, unit, qty, rate, amount, agreed, optionalText(b.photo_key, 200), optionalText(b.note), user.id)
    .run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "deliveries", id, "create", null, { vendorId, item, qty, rate, amount }, user.id);
  const mismatch = agreed !== null && rate !== agreed;
  if (mismatch) {
    c.executionCtx.waitUntil(
      raise(c.env, `rate_mismatch:${id}`, date, { vendor: vendor.name, category: item, amount: rate, usual: agreed }, "warn", "owner", `/vendors/${vendorId}`),
    );
  }
  return c.json({ id, amount, mismatch }, 201);
});

vendors.delete("/deliveries/:did", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("did"));
  const row = await c.env.DB.prepare("SELECT * FROM deliveries WHERE id = ? AND deleted_at IS NULL").bind(id).first<{ business_date: string; created_by: number }>();
  if (!row) throw new HttpError(404, "not_found");
  if (user.role !== "owner" && row.created_by !== user.id) throw new HttpError(403, "not_allowed");
  await assertDayOpen(c.env.DB, user, row.business_date);
  await c.env.DB.prepare("UPDATE deliveries SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();
  await audit(c.env.DB, "deliveries", id, "delete", row, null, user.id);
  return c.json({ ok: true });
});

/* ---------- Payments ---------- */

vendors.post("/:id{[0-9]+}/payments", async (c) => {
  const user = c.get("user");
  const vendorId = Number(c.req.param("id"));
  const vendor = await c.env.DB.prepare("SELECT id, name FROM vendors WHERE id = ?").bind(vendorId).first<{ id: number; name: string }>();
  if (!vendor) throw new HttpError(404, "not_found");
  const b = await c.req.json<Record<string, unknown>>();
  const date = b.business_date ? requireDate(b.business_date) : businessDate();
  await assertDayOpen(c.env.DB, user, date);
  const amount = requirePaise(b.amount, "amount");
  const mode = b.mode === "online" ? "online" : "cash";
  const fromCounter = mode === "cash" && bool(b.from_counter);
  const note = optionalText(b.note);
  const res = await c.env.DB.prepare(
    "INSERT INTO vendor_payments (vendor_id, business_date, amount, mode, from_counter, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(vendorId, date, amount, mode, fromCounter ? 1 : 0, note, user.id)
    .run();
  const id = Number(res.meta.last_row_id);
  if (fromCounter) {
    const expenseId = await addCounterExpense(c.env.DB, {
      date, categoryKey: "vendor_payment", amount, source: "vendor_payment", refId: id, note: `${vendor.name}${note ? ` · ${note}` : ""}`, userId: user.id,
    });
    await c.env.DB.prepare("UPDATE vendor_payments SET expense_id = ? WHERE id = ?").bind(expenseId, id).run();
  }
  await audit(c.env.DB, "vendor_payments", id, "create", null, { vendorId, amount, mode, fromCounter }, user.id);
  return c.json({ id }, 201);
});

vendors.delete("/payments/:pid", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("pid"));
  const row = await c.env.DB.prepare("SELECT * FROM vendor_payments WHERE id = ? AND deleted_at IS NULL").bind(id)
    .first<{ business_date: string; created_by: number; expense_id: number | null }>();
  if (!row) throw new HttpError(404, "not_found");
  if (user.role !== "owner" && row.created_by !== user.id) throw new HttpError(403, "not_allowed");
  await assertDayOpen(c.env.DB, user, row.business_date);
  await c.env.DB.prepare("UPDATE vendor_payments SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();
  await removeCounterExpense(c.env.DB, row.expense_id, user.id);
  await audit(c.env.DB, "vendor_payments", id, "delete", row, null, user.id);
  return c.json({ ok: true });
});
