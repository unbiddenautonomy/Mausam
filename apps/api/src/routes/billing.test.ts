import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../test/harness";

let app: TestApp;
let staff: string;
let owner: string;
beforeAll(async () => {
  app = await startApp();
  staff = (await app.user("staff")).token;
  owner = (await app.user("owner")).token;
}, 60_000);
afterAll(() => app?.dispose());

let n = 0;
/** A paid bill of two lines, as the POS sends it. */
function bill(date: string, opts: { counter?: string; no?: number; client_id?: string } = {}) {
  n++;
  const counter = opts.counter ?? "A";
  const lines = [
    { item_id: null, name: "Pav Bhaji", category: "Pav Bhaji", qty: 1 + (n % 3), price: 16000, tax_rate: 0, note: null },
    { item_id: null, name: "Chaas", category: "Drinks", qty: 1, price: 3000, tax_rate: 0, note: null },
  ];
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const at = new Date(Date.parse(`${date}T07:00:00Z`) + n * 60_000).toISOString();
  return {
    client_id: opts.client_id ?? `test-${n}-${Math.random().toString(36).slice(2, 10)}`,
    bill_no: `${counter}2627-${String(opts.no ?? n).padStart(5, "0")}`,
    counter, business_date: date, order_type: n % 4 ? "dine_in" : "parcel", table_id: null, table_name: null, token: n,
    waiter_staff_id: null, guests: null, discount: 0, prices_include_tax: true, total, status: "paid", cancel_reason: null,
    opened_at: at, closed_at: at, lines, payments: [{ mode: n % 2 ? "cash" : "upi", amount: total }],
  };
}

async function send(bills: unknown[], limit = 0) {
  return app.call(staff, "POST", "/billing/bills", { counter: "A", bills }, { limit });
}

describe("owner's POS bills page", () => {
  it("loads a day with 150 bills", async () => {
    const date = "2026-08-01";
    for (let i = 0; i < 150; i += 20) expect((await send(Array.from({ length: Math.min(20, 150 - i) }, () => bill(date)))).status).toBe(200);
    const r = await app.call(owner, "GET", `/billing/bills?date=${date}`);
    expect(r.status).toBe(200);
    expect(r.json.bills).toHaveLength(150);
    expect(r.json.bills.every((b: { lines: unknown[]; payments: unknown[] }) => b.lines.length === 2 && b.payments.length === 1)).toBe(true);
  }, 60_000);
});

async function dayRows(date: string) {
  const daily = await app.db.prepare("SELECT total, bills, cash, online FROM pos_daily WHERE business_date = ?").bind(date).first<{ total: number; bills: number; cash: number; online: number }>();
  const { results: items } = await app.db.prepare("SELECT item, qty, amount FROM pos_items WHERE business_date = ? ORDER BY item").bind(date).all<{ item: string; qty: number; amount: number }>();
  const sums = await app.db
    .prepare("SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS bills FROM pos_bills WHERE business_date = ? AND status = 'paid'")
    .bind(date)
    .first<{ total: number; bills: number }>();
  return { daily, items, sums };
}

describe("bill sync", () => {
  it("drains a 60-bill offline backlog within the free plan's 50 database calls", async () => {
    const date = "2026-08-02";
    const backlog = Array.from({ length: 60 }, () => bill(date));
    const synced = new Set<string>();
    for (let attempt = 0; attempt < 10 && synced.size < 60; attempt++) {
      // An older POS sends 50 at a time and keeps the rest for the next round.
      const r = await send(backlog.filter((b) => !synced.has(b.client_id)).slice(0, 50), 50);
      expect(r.status).toBe(200);
      for (const res of r.json.results) {
        expect(res.status).toBe("saved");
        synced.add(res.client_id);
      }
    }
    expect(synced.size).toBe(60);
    const { daily, sums } = await dayRows(date);
    expect(daily).toMatchObject({ total: sums!.total, bills: 60 });
  }, 60_000);

  it("saves 20 new bills in a handful of database calls, and a re-send saves nothing twice", async () => {
    const date = "2026-08-03";
    const bills = Array.from({ length: 20 }, () => bill(date));
    const first = await send(bills);
    expect(first.json.results.map((r: { status: string }) => r.status)).toEqual(Array(20).fill("saved"));
    expect(first.calls).toBeLessThanOrEqual(10);
    const again = await send(bills);
    expect(again.json.results.map((r: { status: string }) => r.status)).toEqual(Array(20).fill("duplicate"));
    expect(again.calls).toBeLessThanOrEqual(10);
    const { daily, sums } = await dayRows(date);
    expect(sums!.bills).toBe(20);
    expect(daily!.total).toBe(sums!.total);
  }, 60_000);

  it("saves the other bills when one has a number already used", async () => {
    const date = "2026-08-04";
    const taken = bill(date, { no: 90001 });
    await send([taken]);
    const batch = [bill(date), bill(date, { no: 90001 }), bill(date)];
    const r = await send(batch);
    expect(r.json.results.map((x: { status: string; error?: string }) => x.error ?? x.status)).toEqual(["saved", "duplicate_number", "saved"]);
    const { daily } = await dayRows(date);
    expect(daily!.bills).toBe(3);
  }, 60_000);

  it("keeps the day's item totals right, rewriting only what changed", async () => {
    const date = "2026-08-05";
    await send([bill(date), bill(date)]);
    const before = (await dayRows(date)).items;
    expect(before.map((i) => i.item)).toEqual(["Chaas", "Pav Bhaji"]);
    expect(before.find((i) => i.item === "Chaas")!.qty).toBe(2);
    await send([bill(date)]);
    const after = (await dayRows(date)).items;
    expect(after.find((i) => i.item === "Chaas")).toMatchObject({ qty: 3, amount: 9000 });
    const { results } = await app.db
      .prepare("SELECT i.name AS item, SUM(i.qty) AS qty, SUM(i.amount) AS amount FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id WHERE b.business_date = ? GROUP BY i.name ORDER BY i.name")
      .bind(date)
      .all();
    expect(after).toEqual(results);
  }, 60_000);
});
