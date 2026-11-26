import { beforeEach, describe, expect, it } from "vitest";
import type { Order } from "./store";

// A tiny in-memory localStorage, so the store can run under Node.
const mem = new Map<string, string>();
/** Set to make the stub refuse to save, like a full or blocked browser storage. */
let full = false;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (full) throw new Error("QuotaExceededError");
    mem.set(k, v);
  },
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { addItem, billNumbersFull, clockOffMinutes, readyToResend, noteServerTime, onStorageChange, overDiscountLimit, discountLimit, serverNow, storageBroken, byWaiter, changeQty, counterOf, itemSales, hasChoices, variationRows, lineTag, mergeRemote, needsWaiter, newOrder, noteClosed, noteToken, orderLabel, rateFor, storage, takeBillNo, takeToken, toBill, totalsOf, unsent, usesTables } = await import("./store");

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

  it("records items taken off after the kitchen got them or the bill was printed", () => {
    let o = newOrder("dine_in", null, 1);
    o = addItem(o, bhaji, cats, settings);
    o = addItem(o, bhaji, cats, settings);
    o = addItem(o, pav, cats, settings);
    // Taking off something the kitchen hasn't seen isn't recorded.
    o = changeQty(o, o.lines[1].key, -1, 7);
    expect(o.voids).toBeUndefined();
    // The kitchen has 1 of the 2 bhajis: the first one taken off is unsent, the second was sent.
    o = { ...o, lines: o.lines.map((l) => ({ ...l, sent: 1 })) };
    o = changeQty(o, o.lines[0].key, -1, 7);
    expect(o.voids).toBeUndefined();
    o = changeQty(o, o.lines[0].key, -1, 7, new Date("2026-08-01T08:00:00Z"));
    expect(o.lines).toHaveLength(0);
    expect(o.voids).toEqual([{ name: "Bhaji", variation: null, qty: 1, price: 22000, stage: "kitchen", at: "2026-08-01T08:00:00.000Z", by: 7 }]);
    // After the bill is printed, every item taken off counts, sent or not.
    o = addItem(addItem(o, pav, cats, settings), pav, cats, settings);
    o = { ...o, bill_no: "A2627-00001" };
    o = changeQty(o, o.lines[0].key, -1, 8);
    expect(o.voids?.[1]).toMatchObject({ name: "1 Pav (Oil)", qty: 1, price: 500, stage: "billed", by: 8 });
    const b = toBill(o, settings, "paid", [{ mode: "cash", amount: 500 }], null);
    expect(b.voids).toHaveLength(2);
    // A bill with nothing taken off carries no voids field, as before.
    expect(toBill(addItem(newOrder("parcel", null, 2), pav, cats, settings), settings, "paid", [], null).voids).toBeUndefined();
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

  it("bill numbers restart at 1 on 1 April, with the new year in the number", () => {
    const before = storage.counter();
    storage.setCounter({ code: "B", seq: 41, tokenDate: "2027-03-31", token: 0, fy: "2627" });
    expect(takeBillNo(new Date("2027-03-31T10:00:00Z"))).toBe("B2627-00042");
    expect(takeBillNo(new Date("2027-04-01T10:00:00Z"))).toBe("B2728-00001");
    expect(takeBillNo(new Date("2027-04-01T11:00:00Z"))).toBe("B2728-00002");
    storage.setCounter(before);
  });

  it("a counter saved before the yearly restart keeps counting", () => {
    const before = storage.counter();
    storage.setCounter({ code: "C", seq: 120, tokenDate: "2026-11-19", token: 0 });
    expect(takeBillNo(new Date("2026-11-19T10:00:00Z"))).toBe("C2627-00121");
    storage.setCounter(before);
  });

  it("refuses to hand out a number past 99,999", () => {
    const before = storage.counter();
    storage.setCounter({ code: "D", seq: 99_999, tokenDate: "2026-11-19", token: 0, fy: "2627" });
    expect(billNumbersFull(storage.counter(), "2026-11-19")).toBe(true);
    expect(() => takeBillNo(new Date("2026-11-19T10:00:00Z"))).toThrow("bill_numbers_full");
    expect(billNumbersFull(storage.counter(), "2027-04-02")).toBe(false);
    storage.setCounter(before);
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

  it("adds variations and add-ons as their own lines, at the variation's price", () => {
    const manchurian = { ...bhaji, id: 20, name: "Manchurian", variations: [{ name: "Full", price: 22000 }, { name: "Half", price: 15000 }] };
    const paper = { ...bhaji, id: 21, name: "Paper (Oil)", price: 9000, variations: [{ name: "Regular", price: 9000 }, { name: "Jain", price: 9000 }], addons: [{ name: "Kadak", price: 0 }, { name: "Extra cheese", price: 3000 }] };
    expect(hasChoices(manchurian)).toBe(true);
    expect(hasChoices(bhaji)).toBe(false);
    let o = newOrder("parcel", null, 3);
    o = addItem(o, manchurian, cats, settings, { variation: manchurian.variations[1] });
    o = addItem(o, manchurian, cats, settings, { variation: manchurian.variations[1] }, 2);
    o = addItem(o, manchurian, cats, settings, { variation: manchurian.variations[0] });
    o = addItem(o, paper, cats, settings, { variation: paper.variations[1], addon: paper.addons[1] });
    expect(o.lines.map((l) => [l.name, l.variation, l.modifier, l.qty, l.price])).toEqual([
      ["Manchurian", "Half", null, 3, 15000],
      ["Manchurian", "Full", null, 1, 22000],
      ["Paper (Oil)", "Jain", "Extra cheese", 1, 12000],
    ]);
    expect(lineTag(o.lines[2])).toBe("[Jain · Extra cheese]");
    expect(lineTag(addItem(newOrder("parcel", null, 4), bhaji, cats, settings).lines[0])).toBe("");
    const bill = toBill(o, settings, "paid", [{ mode: "cash", amount: 79000 }], null);
    expect(bill.lines[0]).toMatchObject({ variation: "Half", modifier: null });
    expect(bill.total).toBe(79000);
  });
});

describe("two screens", () => {
  it("tokens keep counting across days and never go below one seen elsewhere", () => {
    expect(takeToken()).toBe(1);
    storage.setCounter({ ...storage.counter()!, tokenDate: "1999-01-01" });
    expect(takeToken()).toBe(2);
    noteToken(40);
    noteToken(12);
    expect(takeToken()).toBe(41);
  });

  it("a bill paid on another screen keeps its own counter", () => {
    expect(counterOf("B2627-00012")).toBe("B");
    const o = { ...addItem(newOrder("parcel", null, 5), pav, cats, settings), bill_no: "B2627-00012" };
    const bill = toBill(o, settings, "paid", [{ mode: "cash", amount: 500 }], null);
    expect(bill.counter).toBe("B");
  });

  it("takes in newer orders from the other screen, keeps its own newer ones, and drops closed ones", () => {
    const mine = { ...newOrder("parcel", null, 1), id: "order-aaaa-1", updated_at: "2026-11-16T10:00:05.000Z" };
    const other = { ...newOrder("parcel", null, 2), id: "order-bbbb-2", updated_at: "2026-11-16T10:00:00.000Z" };
    let orders: Order[] = [mine, other];
    // Same object back when nothing changed.
    expect(mergeRemote(orders, [{ id: mine.id, updated_at: "2026-11-16T10:00:01.000Z", closed: false, data: { ...mine, token: 99 } }])).toBe(orders);
    orders = mergeRemote(orders, [
      { id: other.id, updated_at: "2026-11-16T10:00:09.000Z", closed: false, data: { ...other, discount: 1000 } },
      { id: "order-cccc-3", updated_at: "2026-11-16T10:00:09.000Z", closed: false, data: { ...newOrder("dine_in", null, 3), id: "order-cccc-3" } },
    ]);
    expect(orders.map((o) => o.id)).toEqual([mine.id, other.id, "order-cccc-3"]);
    expect(orders[1].discount).toBe(1000);
    orders = mergeRemote(orders, [{ id: mine.id, updated_at: "2026-11-16T10:00:10.000Z", closed: true, data: null }]);
    expect(orders.map((o) => o.id)).toEqual([other.id, "order-cccc-3"]);
    // Closed here but not yet sent: an older open copy from the server doesn't bring it back.
    noteClosed([{ id: other.id, updated_at: "2026-11-16T10:00:11.000Z" }]);
    orders = mergeRemote(orders.filter((o) => o.id !== other.id), [{ id: other.id, updated_at: "2026-11-16T10:00:09.000Z", closed: false, data: other }]);
    expect(orders.map((o) => o.id)).toEqual(["order-cccc-3"]);
  });
});

describe("item sales", () => {
  it("adds up paid bills by category, item and variation, and skips cancelled bills", () => {
    const manch = { ...bhaji, id: 12, name: "Manchurian", variations: [{ name: "Full", price: 22000 }, { name: "Half", price: 15000 }] };
    let o = newOrder("parcel", null, 1);
    o = addItem(o, manch, cats, settings, { variation: manch.variations[1] }, 2);
    o = addItem(o, pav, cats, settings, {}, 3);
    const paid = toBill(o, settings, "paid", [{ mode: "cash", amount: 31500 }], null);
    const again = toBill(addItem(newOrder("parcel", null, 2), manch, cats, settings, { variation: manch.variations[1] }), settings, "paid", [{ mode: "cash", amount: 15000 }], null);
    const cancelled = { ...paid, client_id: "x-cancelled-1", status: "cancelled" as const };
    const rows = itemSales([paid, again, cancelled]);
    expect(rows).toEqual([
      { category: "Pav Bhaji", name: "Manchurian", variation: "Half", qty: 3, amount: 45000 },
      { category: "Pav Bhaji", name: "1 Pav (Oil)", variation: null, qty: 3, amount: 1500 },
    ]);
  });
});

describe("discounts", () => {
  it("limits staff, not managers, and only when a limit is set", () => {
    expect(overDiscountLimit(1001, 10000, { discount_limit_pct: 10 }, "staff")).toBe(true);
    expect(overDiscountLimit(1000, 10000, { discount_limit_pct: 10 }, "staff")).toBe(false);
    expect(overDiscountLimit(5000, 10000, { discount_limit_pct: 10 }, "manager")).toBe(false);
    expect(overDiscountLimit(5000, 10000, {}, "staff")).toBe(false);
  });

  it("limits staff to a rupee amount too, whichever limit is lower", () => {
    const s = { discount_limit_pct: 100, discount_limit_paise: 10000 };
    expect(overDiscountLimit(10000, 50000, s, "staff")).toBe(false);
    expect(overDiscountLimit(10100, 50000, s, "staff")).toBe(true);
    expect(overDiscountLimit(20000, 50000, s, "manager")).toBe(false);
    expect(discountLimit(50000, s)).toBe(10000);
    expect(discountLimit(50000, { discount_limit_pct: 10, discount_limit_paise: 10000 })).toBe(5000);
    expect(discountLimit(500000, { discount_limit_pct: 10, discount_limit_paise: 10000 })).toBe(10000);
    expect(discountLimit(50000, { discount_limit_pct: 100, discount_limit_paise: 0 })).toBeNull();
  });

  it("carries the reason and who allowed it onto the bill, only when there is a discount", () => {
    let o = addItem(newOrder("parcel", null, 1), bhaji, cats, settings);
    o = { ...o, discount: 2000, discount_reason: "regular", discount_approved_by: 3 };
    expect(toBill(o, settings, "paid", [], null)).toMatchObject({ discount: 2000, discount_reason: "regular", discount_approved_by: 3 });
    expect(toBill({ ...o, discount: 0 }, settings, "paid", [], null).discount_reason).toBeUndefined();
  });
});

describe("device storage", () => {
  it("keeps bills in memory and warns while the device can't save, then saves again", () => {
    const seen: boolean[] = [];
    const stop = onStorageChange((b) => seen.push(b));
    const order = addItem(newOrder("parcel", null, 1), bhaji, cats, settings);
    const first = toBill(order, settings, "paid", [{ mode: "cash", amount: 22000 }], null);
    full = true;
    try {
      storage.setBills([first]);
      expect(storageBroken()).toBe(true);
      // The bill is still there for this session, so it still gets sent.
      expect(storage.bills().map((b) => b.client_id)).toEqual([first.client_id]);
      expect(mem.get("mausam.pos.bills")).toBeUndefined();
    } finally {
      full = false;
    }
    storage.setBills(storage.bills());
    expect(storageBroken()).toBe(false);
    expect(JSON.parse(mem.get("mausam.pos.bills")!)).toHaveLength(1);
    expect(seen).toEqual([true, false]);
    stop();
  });
});

describe("device clock", () => {
  it("works out how far off the clock is, and corrects order times by it", () => {
    const now = Date.now();
    noteServerTime(new Date(now + 5 * 60_000).toISOString(), now - 100, now + 100);
    expect(clockOffMinutes()).toBe(5);
    expect(Math.abs(serverNow().getTime() - (Date.now() + 5 * 60_000))).toBeLessThan(1000);
    // A clock right to within a few seconds counts as right.
    noteServerTime(new Date(now + 2000).toISOString(), now, now);
    expect(clockOffMinutes()).toBe(0);
    expect(storage.clock()).toBe(0);
  });
});

describe("refused bills", () => {
  it("gives a bill refused for a used number the next number, keeping its id and the printed number", () => {
    const b = { ...toBill(addItem(newOrder("parcel", null, 1), pav, cats, settings), settings, "paid", [{ mode: "cash", amount: 500 }], null), rejected: "duplicate_number", reported: true };
    expect(b.bill_no).toMatch(/^A\d{4}-00001$/);
    const again = readyToResend(b);
    expect(again).toMatchObject({ client_id: b.client_id, bill_no: b.bill_no.replace("00001", "00002"), printed_no: b.bill_no });
    expect(again.rejected).toBeUndefined();
    expect(again.reported).toBeUndefined();
    // Any other refusal is just sent again as it is.
    expect(readyToResend({ ...b, rejected: "total_mismatch" }).bill_no).toBe(b.bill_no);
  });
});

describe("matching the old POS", () => {
  it("lists favourites in the old POS's order, then other starred items in menu order", async () => {
    const { favouritesOf } = await import("./store");
    const items = [
      { ...bhaji, id: 1, name: "Bhaji", fav_sort: 3 },
      { ...bhaji, id: 2, name: "Not starred", favourite: 0 },
      { ...bhaji, id: 3, name: "Starred later", fav_sort: null },
      { ...pav, id: 4, name: "1 Pav (Amul Butter)", fav_sort: 1 },
      { ...pav, id: 5, name: "1 Pav (Oil)", fav_sort: 2 },
    ];
    expect(favouritesOf(items).map((i) => i.name)).toEqual(["1 Pav (Amul Butter)", "1 Pav (Oil)", "Bhaji", "Starred later"]);
  });

  it("prints a dine-in bill once and a parcel bill twice, unless POS options say otherwise", async () => {
    const { billCopies } = await import("./store");
    expect(billCopies("dine_in", settings)).toBe(1);
    expect(billCopies("parcel", settings)).toBe(2);
    expect(billCopies("dine_in", { ...settings, bill_copies_dine_in: 2, bill_copies: 3 })).toBe(2);
    expect(billCopies("parcel", { ...settings, bill_copies: 9 })).toBe(3);
  });

  it("opens a saved bill to edit: same items, token and day, a new id, and the new bill names the one it replaces", async () => {
    const { orderFromBill, cancelLocal, EDITED_REASON } = await import("./store");
    let o = newOrder("parcel", null, 7);
    o = addItem(o, bhaji, cats, settings, { variation: { name: "Jain", price: 22000 } }, 2);
    const paid = toBill({ ...o, bill_no: takeBillNo() }, settings, "paid", [{ mode: "upi", amount: totalsOf(o, settings).total }], null);
    const edit = orderFromBill(paid);
    expect(edit.id).not.toBe(paid.client_id);
    expect(edit).toMatchObject({ type: "parcel", token: 7, business_date: paid.business_date, bill_no: null,
      replaces: { client_id: paid.client_id, bill_no: paid.bill_no, mode: "upi" } });
    expect(edit.lines).toMatchObject([{ name: "Bhaji", qty: 2, sent: 2, variation: "Jain" }]);
    // Taking an item off an edited bill is recorded, like one already sent to the kitchen.
    const less = changeQty(edit, edit.lines[0].key, -1, 5);
    expect(less.voids).toHaveLength(1);
    const again = toBill({ ...less, bill_no: takeBillNo() }, settings, "paid", [{ mode: "upi", amount: totalsOf(less, settings).total }], null);
    expect(again.replaces).toBe(paid.client_id);
    const local = cancelLocal([paid], paid.client_id, `${EDITED_REASON} ${again.bill_no}`);
    expect(local[0]).toMatchObject({ status: "cancelled", cancel_reason: `Edited: now ${again.bill_no}` });
  });
});

describe("variationRows", () => {
  const v = (name: string, price = 100) => ({ name, price });
  it("splits Oil/Butter × Regular/Jain into two rows", () => {
    const vs = [v("Oil", 330), v("Jain Oil", 330), v("Butter", 370), v("Jain Butter", 370)];
    const r = variationRows(vs)!;
    expect(r.rows.map((row) => row.labels)).toEqual([["Oil", "Butter"], ["Regular", "Jain"]]);
    expect(r.find(["butter", "jain"])).toBe(vs[3]);
    expect(r.keyOf(vs[0])).toEqual(["oil", "regular"]);
  });
  it("splits Half/Full × Regular/Jain", () => {
    const vs = [v("Half"), v("Full"), v("Half Jain"), v("Full Jain")];
    const r = variationRows(vs)!;
    expect(r.rows.map((row) => row.values)).toEqual([["regular", "jain"], ["half", "full"]]);
    expect(r.find(["jain", "full"])).toBe(vs[3]);
  });
  it("keeps a plain list when names don't split", () => {
    expect(variationRows([v("Regular"), v("Jain")])).toBeNull();
    expect(variationRows([v("Small"), v("Medium"), v("Large")])).toBeNull();
    expect(variationRows([v("Oil"), v("Butter"), v("Amul Butter")])).toBeNull();
  });
});
