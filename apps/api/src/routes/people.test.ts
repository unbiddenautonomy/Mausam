import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, businessDate, monthDates } from "@mausam/shared";
import { startApp, type TestApp } from "../test/harness";

let app: TestApp;
let owner: string;
const thisMonth = businessDate().slice(0, 7);
const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);

beforeAll(async () => {
  app = await startApp();
  owner = (await app.user("owner")).token;
}, 60_000);
afterAll(() => app?.dispose());

describe("pay sheet", () => {
  it("pays someone who left mid-month for the days they worked, and keeps a paid row paid when a note is saved", async () => {
    const created = await app.call(owner, "POST", "/staff", { name: "Suresh", pay_type: "daily", pay_rate: 50000, joined_on: "2020-01-01" });
    const id = created.json.id as number;
    const left = `${lastMonth}-10`;
    const base = { name: "Suresh", pay_type: "daily", pay_rate: 50000, joined_on: "2020-01-01" };
    expect((await app.call(owner, "PUT", `/staff/${id}`, { ...base, active: false, left_on: left })).status).toBe(200);
    expect((await app.db.prepare("SELECT active, left_on FROM staff WHERE id = ?").bind(id).first())).toEqual({ active: 0, left_on: left });

    const sheet = await app.call(owner, "GET", `/people/payroll/${lastMonth}`);
    const row = sheet.json.rows.find((r: { staff_id: number }) => r.staff_id === id);
    expect(row).toMatchObject({ days_worked: 10, gross: 10 * 50000 });
    // Not on this month's sheet: they left before it started.
    const now = await app.call(owner, "GET", `/people/payroll/${thisMonth}`);
    expect(now.json.rows.some((r: { staff_id: number }) => r.staff_id === id)).toBe(false);

    expect((await app.call(owner, "PUT", `/people/payroll/${lastMonth}/${id}`, { status: "paid" })).status).toBe(200);
    expect((await app.call(owner, "PUT", `/people/payroll/${lastMonth}/${id}`, { note: "Paid in cash" })).status).toBe(200);
    const paid = await app.db.prepare("SELECT status, note, net FROM payroll WHERE staff_id = ? AND month = ?").bind(id, lastMonth).first();
    expect(paid).toEqual({ status: "paid", note: "Paid in cash", net: 10 * 50000 });
    expect((await app.call(owner, "PUT", `/people/payroll/${lastMonth}/${id}`, { status: "draft" })).status).toBe(200);
    expect((await app.db.prepare("SELECT status FROM payroll WHERE staff_id = ? AND month = ?").bind(id, lastMonth).first())).toEqual({ status: "draft" });

    // Made active again: they haven't left.
    await app.call(owner, "PUT", `/staff/${id}`, { ...base, active: true });
    expect((await app.db.prepare("SELECT left_on FROM staff WHERE id = ?").bind(id).first())).toEqual({ left_on: null });
    expect(monthDates(lastMonth).length).toBeGreaterThan(27);
  });
});

describe("audit rows", () => {
  const entries = async (table: string) =>
    (await app.db.prepare("SELECT action, before, after FROM audit_log WHERE table_name = ? ORDER BY id").bind(table).all<{ action: string; before: string; after: string }>()).results;

  it("records settings, categories, tables, attendance and POS changes to a closing", async () => {
    await app.call(owner, "PUT", "/settings", { cash_tolerance: 5000 });
    expect(JSON.parse((await entries("settings")).at(-1)!.after)).toEqual({ cash_tolerance: "5000" });
    await app.call(owner, "PUT", "/billing/settings", { bill_copies: 1 });
    expect(JSON.parse((await entries("settings")).at(-1)!.after)).toEqual({ pos_bill_copies: "1" });

    const cat = await app.db.prepare("SELECT id, name_en FROM expense_categories LIMIT 1").first<{ id: number; name_en: string }>();
    await app.call(owner, "PUT", `/manage/categories/${cat!.id}`, { name_en: "Renamed" });
    expect(JSON.parse((await entries("expense_categories")).at(-1)!.before).name_en).toBe(cat!.name_en);

    const table = await app.call(owner, "POST", "/billing/tables", { area: "Garden", name: "G1" });
    await app.call(owner, "PATCH", `/billing/tables/${table.json.id}`, { seats: 6 });
    expect((await entries("dining_tables")).map((e) => e.action)).toEqual(["create", "update"]);

    const staff = await app.db.prepare("INSERT INTO staff (name) VALUES ('Meena') RETURNING id").first<{ id: number }>();
    const date = businessDate();
    await app.call(owner, "PUT", `/people/attendance/${date}`, { marks: [{ staff_id: staff!.id, status: "present" }] });
    await app.call(owner, "PUT", `/people/attendance/${date}`, { marks: [{ staff_id: staff!.id, status: "present" }] });
    await app.call(owner, "PUT", `/people/attendance/${date}`, { marks: [{ staff_id: staff!.id, status: "half" }] });
    const att = await entries("attendance");
    expect(att.map((e) => JSON.parse(e.after))).toEqual([{ Meena: "present" }, { Meena: "half" }]);

    // A closing whose POS figure arrives later: recorded, and the owner's flag alert is raised.
    await app.call(owner, "PUT", `/closes/${date}`, { total_counter: 100000, cash: 60000, online: 40000, expenses: 0 });
    const staffToken = (await app.user("staff")).token;
    const lines = [{ item_id: null, name: "Thali", category: null, qty: 1, price: 500000, tax_rate: 0, note: null }];
    const at = new Date().toISOString();
    const r = await app.call(staffToken, "POST", "/billing/bills", {
      counter: "Z",
      bills: [{
        client_id: "audit-test-bill-1", bill_no: "Z2627-00001", counter: "Z", business_date: date, order_type: "parcel", table_id: null, table_name: null,
        token: 1, waiter_staff_id: null, guests: null, discount: 0, prices_include_tax: true, total: 500000, status: "paid", cancel_reason: null,
        opened_at: at, closed_at: at, lines, payments: [{ mode: "cash", amount: 500000 }],
      }],
    });
    expect(r.json.results[0].status).toBe("saved");
    const closeAudit = (await entries("day_closes")).at(-1)!;
    expect(JSON.parse(closeAudit.after)).toMatchObject({ pos_sales: 500000, source: "pos" });
    const alert = await app.db.prepare("SELECT seen_at FROM alerts WHERE type = 'close_flag' AND business_date = ?").bind(date).first();
    expect(alert).toEqual({ seen_at: null });
  });
});
