import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDate } from "@mausam/shared";
import { startApp, type TestApp } from "../test/harness";

let app: TestApp;
let owner: string;
let manager: string;
beforeAll(async () => {
  app = await startApp();
  owner = (await app.user("owner", "Asha")).token;
  manager = (await app.user("manager", "Vikram")).token;
}, 60_000);
afterAll(() => app?.dispose());

const close = (cash: number) => ({ total_counter: cash + 40000, cash, online: 40000, expenses: 0 });

describe("closing drafts", () => {
  it("refuses to overwrite a closing someone else saved since the screen loaded it", async () => {
    const date = businessDate();
    // Two people open the same day: no closing yet.
    const first = await app.call(manager, "PUT", `/closes/${date}`, { ...close(60000), base_updated_at: null });
    expect(first.status).toBe(200);
    const clash = await app.call(owner, "PUT", `/closes/${date}`, { ...close(70000), base_updated_at: null });
    expect(clash.status).toBe(409);
    expect(clash.json).toMatchObject({ error: "changed_elsewhere", detail: { name: "Vikram" } });

    // After reloading, the owner's save goes through, and the screen names the last editor.
    const loaded = await app.call(owner, "GET", `/closes/${date}`);
    expect(loaded.json.close).toMatchObject({ cash: 60000, updated_by_name: "Vikram" });
    const ok = await app.call(owner, "PUT", `/closes/${date}`, { ...close(70000), base_updated_at: loaded.json.close.updated_at });
    expect(ok.status).toBe(200);
    expect((await app.call(manager, "GET", `/closes/${date}`)).json.close).toMatchObject({ cash: 70000, updated_by_name: "Asha", submitted_by_name: "Vikram" });

    // A screen that doesn't send a version (an older one) saves as before.
    expect((await app.call(manager, "PUT", `/closes/${date}`, close(65000))).status).toBe(200);
  });
});

describe("double saves", () => {
  it("saves an advance, a delivery and a vendor payment once when the same form is sent twice", async () => {
    const staff = await app.db.prepare("INSERT INTO staff (name) VALUES ('Ravi') RETURNING id").first<{ id: number }>();
    const vendor = await app.db.prepare("INSERT INTO vendors (name) VALUES ('Milk') RETURNING id").first<{ id: number }>();
    const count = async (table: string) => (await app.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

    const advance = { staff_id: staff!.id, amount: 50000, from_counter: true, client_id: "advance-form-0001" };
    const [a1, a2] = await Promise.all([app.call(manager, "POST", "/people/advances", advance), app.call(manager, "POST", "/people/advances", advance)]);
    expect(a1.json.id).toBe(a2.json.id);
    const a3 = await app.call(manager, "POST", "/people/advances", advance);
    expect(a3.json).toEqual({ id: a1.json.id, duplicate: true });
    expect(await count("advances")).toBe(1);
    // The advance and its counter expense were saved together and linked both ways.
    const linked = await app.db.prepare("SELECT a.expense_id, e.ref_id, e.source, e.amount FROM advances a JOIN expenses e ON e.id = a.expense_id").first();
    expect(linked).toMatchObject({ ref_id: a1.json.id, source: "advance", amount: 50000 });

    const delivery = { item: "Milk", unit: "litre", qty: 10, rate: 5000, client_id: "delivery-form-01" };
    const d1 = await app.call(manager, "POST", `/vendors/${vendor!.id}/deliveries`, delivery);
    const d2 = await app.call(manager, "POST", `/vendors/${vendor!.id}/deliveries`, delivery);
    expect(d2.json).toMatchObject({ id: d1.json.id, amount: 50000, duplicate: true });
    expect(await count("deliveries")).toBe(1);

    const payment = { amount: 30000, mode: "cash", from_counter: true, client_id: "payment-form-001" };
    const p1 = await app.call(manager, "POST", `/vendors/${vendor!.id}/payments`, payment);
    const p2 = await app.call(manager, "POST", `/vendors/${vendor!.id}/payments`, payment);
    expect(p2.json.id).toBe(p1.json.id);
    expect(await count("vendor_payments")).toBe(1);
    const paid = await app.db.prepare("SELECT e.ref_id, e.source FROM vendor_payments p JOIN expenses e ON e.id = p.expense_id").first();
    expect(paid).toEqual({ ref_id: p1.json.id, source: "vendor_payment" });
    // Each saved row has its audit row.
    expect(await count("audit_log")).toBeGreaterThanOrEqual(5);
  });
});

describe("expenses and shopping trips", () => {
  const catId = async () => (await app.db.prepare("SELECT id FROM expense_categories WHERE active = 1 ORDER BY id LIMIT 1").first<{ id: number }>())!.id;

  it("lets the person who entered an expense fix it, with an audit row", async () => {
    const category_id = await catId();
    const made = await app.call(manager, "POST", "/expenses", { category_id, amount: 12000, has_receipt: false, note: "milk" });
    expect(made.status).toBe(201);
    const id = made.json.expense.id;
    const fixed = await app.call(manager, "PUT", `/expenses/${id}`, { category_id, amount: 21000, mode: "online", has_receipt: false, note: "milk, 2 days" });
    expect(fixed.status).toBe(200);
    expect(fixed.json.expense).toMatchObject({ amount: 21000, mode: "online", note: "milk, 2 days", business_date: made.json.expense.business_date });
    const row = await app.db.prepare("SELECT action FROM audit_log WHERE table_name = 'expenses' AND row_id = ? ORDER BY id DESC").bind(id).first<{ action: string }>();
    expect(row!.action).toBe("update");
    expect((await app.call(manager, "GET", `/expenses/${id}`)).json.expense.amount).toBe(21000);
  });

  it("refuses a new bill on a finished trip, and lets a manager finish yesterday's trip after the day locks", async () => {
    const category_id = await catId();
    const old = "2026-01-10";
    const r = await app.db.prepare("INSERT INTO shopping_trips (business_date, manager_id, float_out) SELECT ?, id, 500000 FROM users WHERE name = 'Vikram'").bind(old).run();
    const tripId = Number(r.meta.last_row_id);
    const today = await app.call(manager, "GET", "/today");
    expect(today.json.shopping.stale_trip).toMatchObject({ id: tripId, business_date: old, manager_name: "Vikram" });
    const done = await app.call(manager, "POST", `/shopping/${tripId}/close`, { float_back: 500000 });
    expect(done.status).toBe(200);
    expect((await app.call(manager, "GET", "/today")).json.shopping.stale_trip).toBeNull();
    // Once finished, the locked day applies again: a manager can't redo it.
    expect((await app.call(manager, "POST", `/shopping/${tripId}/close`, { float_back: 0, note: "x" })).status).toBe(409);
    const late = await app.call(owner, "POST", "/expenses", { category_id, amount: 5000, has_receipt: false, trip_id: tripId, business_date: old });
    expect(late.status).toBe(409);
    expect(late.json.error).toBe("trip_closed");
  });

  it("asks for the cash taken from the counter when shopping is finished, not when it starts", async () => {
    const vegId = (await app.db.prepare("SELECT id FROM expense_categories WHERE key = 'vegetables'").first<{ id: number }>())!.id;
    const started = await app.call(manager, "POST", "/shopping", {});
    expect(started.status).toBe(201);
    const id = started.json.id;
    const bill = await app.call(manager, "POST", "/expenses", { category_id: vegId, amount: 30000, has_receipt: false, trip_id: id, item: "Kanda / Onion" });
    expect(bill.status).toBe(201);
    expect(bill.json.expense.item).toBe("Kanda / Onion");
    // Finishing without the cash taken is refused.
    const missing = await app.call(manager, "POST", `/shopping/${id}/close`, { float_back: 20000 });
    expect(missing.status).toBe(422);
    expect(missing.json.detail).toMatchObject({ field: "float_out" });
    // ₹500 out, ₹300 spent, ₹200 back: it adds up.
    const done = await app.call(manager, "POST", `/shopping/${id}/close`, { float_out: 50000, float_back: 20000 });
    expect(done.status).toBe(200);
    expect(done.json.gap).toBe(0);
    const trip = (await app.call(manager, "GET", `/shopping/${id}`)).json.trip;
    expect(trip).toMatchObject({ status: "closed", float_out: 50000, float_back: 20000, spent: 30000 });
  });
});

describe("vendors", () => {
  it("starts with Mausam's vendors and how often each one bills", async () => {
    const list = (await app.call(owner, "GET", "/vendors")).json.vendors as { name: string; payment_terms: string; bills_per_month: number | null }[];
    const by = (n: string) => list.find((v) => v.name === n);
    expect(by("Water")).toMatchObject({ payment_terms: "times_month", bills_per_month: 3 });
    expect(by("Karyanu / Grain")).toMatchObject({ payment_terms: "times_month", bills_per_month: 5 });
    expect(by("Mukhwas")).toMatchObject({ payment_terms: "per_delivery" });
    expect(by("Butter + Cheese + Paneer")).toMatchObject({ payment_terms: "every_2_days" });
    for (const n of ["Gas", "Pau", "Chaas / Butter Milk", "Sukka Lasan / Dry Garlic", "Cleaners"]) expect(by(n)).toMatchObject({ payment_terms: "daily" });
  });

  it("keeps a running tally of what was bought and what was paid", async () => {
    const v = await app.call(owner, "POST", "/vendors", { name: "Tally test", payment_terms: "times_month", bills_per_month: 4, opening_due: 10000 });
    expect(v.status).toBe(201);
    const id = v.json.id;
    expect((await app.call(owner, "POST", "/vendors", { name: "Bad", payment_terms: "times_month", bills_per_month: 0 })).status).toBe(422);
    await app.call(manager, "POST", `/vendors/${id}/deliveries`, { item: "Oil tin", unit: "tin", qty: 2, rate: 150000 });
    await app.call(manager, "POST", `/vendors/${id}/payments`, { amount: 200000, mode: "online" });
    const res = (await app.call(owner, "GET", `/vendors/${id}`)).json;
    expect(res.totals).toEqual({ opening: 10000, bought: 300000, paid: 200000, due: 110000 });
    expect(res.vendor).toMatchObject({ due: 110000, bills_per_month: 4 });
    // Newest first, each row with what was owed after it.
    expect(res.history.map((r: { kind: string; balance: number }) => [r.kind, r.balance])).toEqual([["payment", 110000], ["delivery", 310000]]);
  });
});

describe("closing alerts", () => {
  it("settles the flag alert once a later edit clears the flags", async () => {
    // Today's closing, so it isn't late (a late closing keeps its flag).
    const date = businessDate();
    const base = (await app.call(owner, "GET", `/closes/${date}`)).json.close?.updated_at ?? null;
    // Match the cash expenses other tests entered today, so only the POS figure differs.
    const spent: number = (await app.call(owner, "GET", "/today")).json.expenses.total;
    const ok = { total_counter: 100000 + spent, cash: 60000, online: 40000, expenses: spent };
    // The POS says 9,000 but the counter says 1,000: a serious flag.
    const flagged = await app.call(owner, "PUT", `/closes/${date}`, { ...ok, pos_sales: 900000, base_updated_at: base });
    expect(flagged.status).toBe(200);
    expect(flagged.json.close.flags.map((f: { code: string }) => f.code)).toContain("pos_differs");
    const alert = () => app.db.prepare("SELECT seen_at FROM alerts WHERE type = 'close_flag' AND business_date = ?").bind(date).first<{ seen_at: string | null }>();
    expect((await alert())!.seen_at).toBeNull();
    const fixed = await app.call(owner, "PUT", `/closes/${date}`, { ...ok, pos_sales: ok.total_counter, base_updated_at: flagged.json.close.updated_at });
    expect(fixed.status).toBe(200);
    expect((await alert())!.seen_at).not.toBeNull();
  });
});
