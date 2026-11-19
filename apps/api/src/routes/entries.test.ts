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
