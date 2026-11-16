import { beforeEach, describe, expect, it } from "vitest";

// A tiny in-memory localStorage, so the store can run under Node.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { addItem, byWaiter, changeQty, needsWaiter, newOrder, orderLabel, rateFor, storage, takeBillNo, takeToken, toBill, totalsOf, unsent, usesTables } = await import("./store");

const settings = { gst_rate: 500, prices_include_tax: true, gstin: "29ABCDE1234F1Z5", bill_header: "", bill_footer: "", use_gst: true };
const cats = [{ id: 1, name: "Pav Bhaji", name_hi: null, name_kn: null, sort: 1 }];
const bhaji = { id: 10, category_id: 1, name: "Bhaji", short_name: null, price: 22000, tax_rate: null, veg: 1, favourite: 1, sort: 1 };
const pav = { id: 11, category_id: 1, name: "1 Pav (Oil)", short_name: null, price: 500, tax_rate: 0, veg: 1, favourite: 1, sort: 2 };

beforeEach(() => {
  mem.clear();
  storage.setCounter({ code: "A", seq: 0, tokenDate: "2000-01-01", token: 0 });
});

describe("orders", () => {
  it("adds, merges and removes lines", () => {
    let o = newOrder("dine_in", { id: 1, area: "Garden", name: "C1", seats: 6, sort: 1 }, null);
    o = addItem(o, bhaji, cats, settings);
    o = addItem(o, bhaji, cats, settings);
    o = addItem(o, pav, cats, settings);
    expect(o.lines).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ qty: 2, tax_rate: 500, category: "Pav Bhaji" });
    expect(o.lines[1].tax_rate).toBe(0); // the item's own rate wins
    o = changeQty(o, o.lines[1].key, -1);
    expect(o.lines).toHaveLength(1);
    expect(totalsOf(o, settings).total).toBe(44000);
  });

  it("no GST without a GSTIN", () => {
    const o = addItem(newOrder("parcel", null, 1), bhaji, cats, { ...settings, gstin: "" });
    expect(o.lines[0].tax_rate).toBe(0);
    expect(totalsOf(o, settings).tax).toBe(0);
  });

  it("kitchen ticket only has what wasn't sent", () => {
    let o = addItem(newOrder("parcel", null, 1), bhaji, cats, settings);
    o = { ...o, lines: o.lines.map((l) => ({ ...l, sent: l.qty })) };
    o = addItem(o, bhaji, cats, settings);
    expect(unsent(o)).toEqual([expect.objectContaining({ name: "Bhaji", qty: 1 })]);
  });

  it("bill numbers and tokens run on", () => {
    expect(takeBillNo()).toMatch(/^A\d{4}-00001$/);
    expect(takeBillNo()).toMatch(/^A\d{4}-00002$/);
    expect(takeToken()).toBe(1);
    expect(takeToken()).toBe(2);
  });

  it("a paid bill has payments that add up to the total", () => {
    const o = addItem(addItem(newOrder("parcel", null, 3), bhaji, cats, settings), pav, cats, settings);
    const total = totalsOf(o, settings).total;
    const b = toBill(o, settings, "paid", [{ mode: "cash", amount: total }], null);
    expect(b).toMatchObject({ client_id: o.id, counter: "A", status: "paid", total: 22500, order_type: "parcel", token: 3 });
    expect(b.lines.map((l) => l.qty)).toEqual([1, 1]);
  });
});

describe("waiters, tables and GST options", () => {
  const waiters = [{ id: 7, name: "Rohit", name_local: null, waiter_code: "1" }];
  it("needs a waiter only for dine-in, when required and when waiters exist", () => {
    const dine = newOrder("dine_in", null, 3);
    const cfg = { settings: { ...settings, waiter_required: true }, waiters };
    expect(needsWaiter(dine, cfg)).toBe(true);
    expect(needsWaiter({ ...dine, waiter_staff_id: 7 }, cfg)).toBe(false);
    expect(needsWaiter(newOrder("parcel", null, 4), cfg)).toBe(false);
    expect(needsWaiter(dine, { ...cfg, waiters: [] })).toBe(false);
    expect(needsWaiter(dine, { ...cfg, settings: { ...settings, waiter_required: false } })).toBe(false);
  });
  it("starts an order with a waiter and a typed table number", () => {
    const o = newOrder("dine_in", null, 12, { waiter: 7, tableName: " 5 " });
    expect(o.waiter_staff_id).toBe(7);
    expect(o.table_name).toBe("5");
    expect(o.table_id).toBeNull();
    const t = (k: string, p?: Record<string, string | number>) => (k === "order_no" ? `Order #${p?.n}` : k === "table" ? "Table" : "Parcel");
    expect(orderLabel(o, t)).toBe("Table 5 · #12");
    expect(orderLabel({ ...o, table_name: null }, t)).toBe("Order #12");
  });
  it("uses the table map only when on and tables exist", () => {
    const table = { id: 1, area: "", name: "1", seats: 4, sort: 1 };
    expect(usesTables({ settings: { ...settings, use_tables: false }, tables: [table] })).toBe(false);
    expect(usesTables({ settings: { ...settings, use_tables: true }, tables: [] })).toBe(false);
    expect(usesTables({ settings: { ...settings, use_tables: true }, tables: [table] })).toBe(true);
  });
  it("charges no GST when GST is switched off, even with a GSTIN", () => {
    expect(rateFor(bhaji, settings)).toBe(500);
    expect(rateFor(bhaji, { ...settings, use_gst: false })).toBe(0);
  });
  it("totals paid bills by waiter, with no-waiter last", () => {
    let o = addItem(newOrder("dine_in", null, 1, { waiter: 7 }), bhaji, cats, settings);
    const a = toBill(o, settings, "paid", [{ mode: "cash", amount: 22000 }], null);
    o = addItem(newOrder("parcel", null, 2), pav, cats, settings);
    const b = toBill(o, settings, "paid", [{ mode: "upi", amount: 500 }], null);
    const c = { ...a, client_id: "x", status: "cancelled" as const };
    const rows = byWaiter([b, a, c], waiters);
    expect(rows).toEqual([
      { id: 7, name: "Rohit", bills: 1, total: 22000 },
      { id: null, name: "", bills: 1, total: 500 },
    ]);
  });
});
