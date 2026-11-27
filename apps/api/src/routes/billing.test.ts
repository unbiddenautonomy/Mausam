import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, billTotals, businessDate } from "@mausam/shared";
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

  it("an empty day points to the newest day that has bills", async () => {
    const empty = await app.call(owner, "GET", "/billing/bills?date=2020-01-01");
    expect(empty.json.bills).toEqual([]);
    expect(empty.json.latest_date >= "2026-08-01").toBe(true);
    const there = await app.call(owner, "GET", `/billing/bills?date=${empty.json.latest_date}`);
    expect(there.json.bills.length).toBeGreaterThan(0);
    expect(there.json.latest_date).toBe(empty.json.latest_date);
  });
});

describe("POS reports: bills from a date to a date", () => {
  it("returns every bill in the range with lines and payments, for the owner only", async () => {
    expect((await send([bill("2026-08-10"), bill("2026-08-11"), bill("2026-08-11"), bill("2026-08-13")])).status).toBe(200);
    const r = await app.call(owner, "GET", "/billing/range?from=2026-08-10&to=2026-08-11");
    expect(r.status).toBe(200);
    expect(r.json.bills).toHaveLength(3);
    expect(r.json.bills.every((b: { lines: unknown[]; payments: unknown[]; commission: number }) => b.lines.length === 2 && b.payments.length === 1 && typeof b.commission === "number")).toBe(true);
    expect((await app.call(staff, "GET", "/billing/range?from=2026-08-10&to=2026-08-11")).status).toBe(403);
    expect((await app.call(owner, "GET", "/billing/range?from=2026-08-12&to=2026-08-10")).status).toBe(422);
    expect((await app.call(owner, "GET", "/billing/range?from=2026-01-01&to=2026-08-10")).status).toBe(422);
  }, 60_000);

  it("the day list still has each bill's lines and payments", async () => {
    const r = await app.call(staff, "GET", "/billing/day?date=2026-08-11");
    expect(r.status).toBe(200);
    expect(r.json.bills).toHaveLength(2);
    expect(r.json.bills[0].lines).toHaveLength(2);
    expect(r.json.bills[0].payments).toHaveLength(1);
  });
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

describe("items taken off after printing", () => {
  it("saves them with the bill, skips nonsense, and shows them in the leaks report", async () => {
    const date = "2026-08-05";
    const at = "2026-08-05T08:00:00.000Z";
    const b = {
      ...bill(date),
      voids: [
        { name: "Bhaji", variation: "Jain", qty: 2, price: 22000, stage: "billed", at, by: null },
        { name: "Chaas", variation: null, qty: 1, price: 3000, stage: "kitchen", at, by: 99_999 },
        { name: "", qty: 1, price: 100, stage: "billed", at },
        { name: "Odd", qty: -3, price: 100, stage: "billed", at },
        { name: "Odd", qty: 1, price: 100, stage: "lost", at },
      ],
    };
    const odd = { ...bill(date), voids: "not a list" };
    const r = await send([b, odd, bill(date)]);
    expect(r.status).toBe(200);
    expect(r.json.results.map((x: { status: string }) => x.status)).toEqual(["saved", "saved", "saved"]);
    const { results } = await app.db.prepare("SELECT name, variation, qty, price, stage, removed_by FROM pos_bill_voids ORDER BY id").all();
    expect(results).toEqual([
      { name: "Bhaji", variation: "Jain", qty: 2, price: 22000, stage: "billed", removed_by: null },
      { name: "Chaas", variation: null, qty: 1, price: 3000, stage: "kitchen", removed_by: 99_999 },
    ]);
    const leaks = await app.call(owner, "GET", `/reports/leaks?to=${date}&days=7`);
    expect(leaks.status).toBe(200);
    expect(leaks.json.voids).toHaveLength(2);
    expect(leaks.json.voids[0]).toMatchObject({ bill_no: b.bill_no, all_amount: 47_000, all_n: 2 });
  });
});

describe("discounts and flags", () => {
  /** A bill with one line, at the given price and discount, as the POS sends it. */
  function one(date: string, price: number, discount: number, extra: Record<string, unknown> = {}) {
    const b = bill(date);
    const lines = [{ item_id: extra.item_id ?? null, name: "Thali", category: null, qty: 1, price, tax_rate: 0, note: null, variation: extra.variation ?? null }];
    const total = billTotals(lines, discount, true).total;
    return { ...b, lines, discount, total, payments: [{ mode: "cash", amount: total }], ...extra };
  }
  const flagsOf = async (clientId: string) =>
    app.db.prepare("SELECT flags, discount_reason, discount_approved_by FROM pos_bills WHERE client_id = ?").bind(clientId)
      .first<{ flags: string | null; discount_reason: string | null; discount_approved_by: number | null }>();

  it("saves every bill, and flags a big discount with no PIN, an edited price and an odd date", async () => {
    const today = businessDate();
    expect((await app.call(owner, "PUT", "/billing/settings", { discount_limit_pct: 10 })).json.settings.discount_limit_pct).toBe(10);
    const cat = await app.db.prepare("INSERT INTO menu_categories (name) VALUES ('Meals') RETURNING id").first<{ id: number }>();
    const item = await app.db.prepare("INSERT INTO menu_items (category_id, name, price, variations) VALUES (?, 'Thali', 20000, ?) RETURNING id")
      .bind(cat!.id, JSON.stringify([{ name: "Mini", price: 15000 }])).first<{ id: number }>();
    const ownerId = (await app.db.prepare("SELECT user_id FROM sessions WHERE token = ?").bind(owner).first<{ user_id: number }>())!.user_id;

    const plain = one(today, 20000, 0, { item_id: item!.id });
    const mini = one(today, 15000, 0, { item_id: item!.id, variation: "Mini" });
    const small = one(today, 20000, 2000, { item_id: item!.id, discount_reason: "regular" });
    const big = one(today, 20000, 5000, { item_id: item!.id });
    const allowed = one(today, 20000, 5000, { item_id: item!.id, discount_reason: "guest", discount_approved_by: ownerId });
    const edited = one(today, 12000, 0, { item_id: item!.id });
    const old = one(addDays(today, -30), 20000, 0, { item_id: item!.id });
    const r = await send([plain, mini, small, big, allowed, edited, old]);
    expect(r.json.results.map((x: { status: string }) => x.status)).toEqual(Array(7).fill("saved"));

    expect(await flagsOf(plain.client_id)).toEqual({ flags: null, discount_reason: null, discount_approved_by: null });
    expect((await flagsOf(mini.client_id))?.flags).toBeNull();
    expect(await flagsOf(small.client_id)).toEqual({ flags: null, discount_reason: "regular", discount_approved_by: null });
    expect(await flagsOf(big.client_id)).toEqual({ flags: '["discount_over_limit"]', discount_reason: null, discount_approved_by: null });
    expect(await flagsOf(allowed.client_id)).toEqual({ flags: null, discount_reason: "guest", discount_approved_by: ownerId });
    expect((await flagsOf(edited.client_id))?.flags).toBe('["price_changed"]');
    expect((await flagsOf(old.client_id))?.flags).toBe('["odd_date"]');

    const leaks = await app.call(owner, "GET", `/reports/leaks?to=${today}&days=7`);
    const nos = leaks.json.bills.map((b: { bill_no: string }) => b.bill_no);
    expect(nos).toEqual(expect.arrayContaining([small.bill_no, big.bill_no, allowed.bill_no, edited.bill_no]));
    expect(nos).not.toContain(plain.bill_no);
    expect(leaks.json.bills.find((b: { bill_no: string }) => b.bill_no === allowed.bill_no).approved_by_name).toBeTruthy();
    await app.call(owner, "PUT", "/billing/settings", { discount_limit_pct: 100 });
  });

  it("flags a staff discount above a rupee limit", async () => {
    const today = businessDate();
    expect((await app.call(owner, "PUT", "/billing/settings", { discount_limit_paise: 10000 })).json.settings.discount_limit_paise).toBe(10000);
    expect((await app.call(owner, "PUT", "/billing/settings", { discount_limit_paise: -1 })).status).toBe(422);
    const upTo = one(today, 50000, 10000, { discount_reason: "regular" });
    const above = one(today, 50000, 10100, { discount_reason: "regular" });
    const r = await send([upTo, above]);
    expect(r.json.results.map((x: { status: string }) => x.status)).toEqual(["saved", "saved"]);
    expect((await flagsOf(upTo.client_id))?.flags).toBeNull();
    expect((await flagsOf(above.client_id))?.flags).toBe('["discount_over_limit"]');
    await app.call(owner, "PUT", "/billing/settings", { discount_limit_paise: 0 });
  });

  it("checks a manager's PIN for a discount above the limit", async () => {
    const config = await app.call(staff, "GET", "/billing/config");
    const approver = config.json.approvers[0];
    expect(approver).toBeTruthy();
    expect((await app.call(staff, "POST", "/billing/discount-approval", { approver_id: approver.id, pin: "9999" })).status).toBe(403);
    const ok = await app.call(staff, "POST", "/billing/discount-approval", { approver_id: approver.id, pin: "1234" });
    expect(ok.status).toBe(200);
    expect(ok.json.id).toBe(approver.id);
    // Staff can't approve discounts.
    const staffId = (await app.db.prepare("SELECT user_id FROM sessions WHERE token = ?").bind(staff).first<{ user_id: number }>())!.user_id;
    expect((await app.call(staff, "POST", "/billing/discount-approval", { approver_id: staffId, pin: "1234" })).status).toBe(403);
  });
});

describe("refused bills", () => {
  it("lists a refused bill for the owner until it's sent again with a new number", async () => {
    const date = businessDate();
    const first = bill(date, { counter: "R", no: 7 });
    const clash = bill(date, { counter: "R", no: 7 });
    expect((await send([first])).json.results[0].status).toBe("saved");
    const r = await send([clash]);
    expect(r.json.results[0]).toMatchObject({ status: "rejected", error: "duplicate_number" });

    expect((await app.call(staff, "POST", "/billing/rejects", { rejects: [{ bill: clash, reason: "duplicate_number" }] })).status).toBe(200);
    let page = await app.call(owner, "GET", `/billing/bills?date=${date}`);
    expect(page.json.rejects).toEqual([expect.objectContaining({ client_id: clash.client_id, bill_no: "R2627-00007", reason: "duplicate_number" })]);

    const again = { ...clash, bill_no: "R2627-00008", printed_no: clash.bill_no };
    expect((await send([again])).json.results[0].status).toBe("saved");
    page = await app.call(owner, "GET", `/billing/bills?date=${date}`);
    expect(page.json.rejects).toEqual([]);
    expect(page.json.bills.find((b: { client_id: string }) => b.client_id === clash.client_id).printed_bill_no).toBe("R2627-00007");
  });
});

describe("counter letters", () => {
  it("keeps a letter for one device until the owner frees it, and claims a letter set up offline", async () => {
    const date = businessDate();
    const claim = (code: string, device: string) => app.call(staff, "POST", `/billing/counters/${code}/claim`, { device });
    expect((await claim("K", "device-one-1234")).status).toBe(200);
    expect((await claim("K", "device-one-1234")).status).toBe(200);
    expect((await claim("K", "device-two-1234")).json.error).toBe("counter_taken");

    // The second device bills as K anyway (set up offline): the bill is saved, and it's told to pick another letter.
    const r = await app.call(staff, "POST", "/billing/bills", { counter: "K", device: "device-two-1234", bills: [bill(date, { counter: "K", no: 1 })] });
    expect(r.json.results[0].status).toBe("saved");
    expect(r.json.counter_taken).toBe(true);
    const mine = await app.call(staff, "POST", "/billing/bills", { counter: "K", device: "device-one-1234", bills: [bill(date, { counter: "K", no: 2 })] });
    expect(mine.json.counter_taken).toBeUndefined();

    expect((await app.call(staff, "POST", "/billing/counters/K/release")).status).toBe(403);
    expect((await app.call(owner, "POST", "/billing/counters/K/release")).status).toBe(200);
    expect((await claim("K", "device-two-1234")).status).toBe(200);

    // A letter nobody claimed is taken by the first device that sends bills with it.
    await app.call(staff, "POST", "/billing/bills", { counter: "Q", device: "device-three-12", bills: [bill(date, { counter: "Q", no: 1 })] });
    expect((await claim("Q", "device-four-123")).json.error).toBe("counter_taken");
    const list = await app.call(owner, "GET", "/billing/counters");
    expect(list.json.counters.find((c: { code: string }) => c.code === "Q").held).toBe(1);
  });

  it("gives each device its own letter without asking, and the same one again", async () => {
    const auto = (device: string) => app.call(staff, "POST", "/billing/counters/auto", { device });
    const one = (await auto("auto-device-one")).json.code;
    const two = (await auto("auto-device-two")).json.code;
    expect(one).toMatch(/^[A-Z]$/);
    expect(two).toMatch(/^[A-Z]$/);
    expect(two).not.toBe(one);
    expect((await auto("auto-device-one")).json.code).toBe(one);
    // Letters held by other devices (K and Q above) are skipped.
    expect([one, two]).not.toContain("K");
    expect([one, two]).not.toContain("Q");
    // A freed letter goes to the next new device.
    expect((await app.call(owner, "POST", `/billing/counters/${one}/release`)).status).toBe(200);
    expect((await auto("auto-device-three")).json.code).toBe(one);
    expect((await auto("bad")).status).toBe(422);
  });
});

describe("new items from the counter", () => {
  it("puts the item on the menu, refuses a second one with the same name, and alerts the owner and managers", async () => {
    const cat = await app.db.prepare("INSERT INTO menu_categories (name) VALUES ('Specials') RETURNING id").first<{ id: number }>();
    const manager = await app.user("manager");
    const add = (token: string, body: unknown) => app.call(token, "POST", "/billing/items", body);

    const r = await add(staff, { name: "  Cheese Masala Pav ", category_id: cat!.id, price: 9000, veg: true });
    expect(r.status).toBe(201);
    expect(r.json.item).toMatchObject({ name: "Cheese Masala Pav", price: 9000, category_id: cat!.id, veg: 1 });

    // Every screen gets it with the menu.
    const config = await app.call(staff, "GET", "/billing/config");
    expect(config.json.items.some((i: { id: number }) => i.id === r.json.item.id)).toBe(true);

    expect((await add(staff, { name: "cheese masala pav", category_id: cat!.id, price: 9500 })).json.error).toBe("item_exists");
    expect((await add(staff, { name: "No Price", category_id: cat!.id })).status).toBe(422);
    expect((await add(staff, { name: "No Category", category_id: 999999, price: 100 })).status).toBe(422);

    // The owner and the managers see it in their alerts, with who added it.
    for (const token of [owner, manager.token]) {
      const alerts = await app.call(token, "GET", "/alerts");
      const a = alerts.json.alerts.find((x: { type: string }) => x.type === `item_added:${r.json.item.id}`);
      expect(a.params).toMatchObject({ name: "Cheese Masala Pav", amount: 9000, category: "Specials" });
      expect(a.params.by).toBeTruthy();
    }
    const audit = await app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'menu_items' AND row_id = ?").bind(r.json.item.id).first<{ n: number }>();
    expect(audit!.n).toBe(1);
  });
});

describe("Invoice screen: edit and delete a bill", () => {
  it("keeps an edited bill as cancelled with the new number, and the day counts only the new one", async () => {
    const date = businessDate();
    const first = bill(date);
    await send([first]);
    const edited = { ...bill(date), replaces: first.client_id };
    const r = await send([edited]);
    expect(r.json.results[0].status).toBe("saved");
    const old = await app.db.prepare("SELECT status, cancel_reason, commission, flags FROM pos_bills WHERE client_id = ?").bind(first.client_id).first();
    expect(old).toMatchObject({ status: "cancelled", cancel_reason: `Edited: now ${edited.bill_no}`, commission: 0, flags: '["edited"]' });
    const { results } = await app.db.prepare("SELECT client_id FROM pos_bills WHERE business_date = ? AND status = 'paid'").bind(date).all<{ client_id: string }>();
    expect(results.map((x) => x.client_id)).toContain(edited.client_id);
    expect(results.map((x) => x.client_id)).not.toContain(first.client_id);
    const { daily, sums } = await dayRows(date);
    expect(daily!.total).toBe(sums!.total);
  }, 60_000);

  it("an edit sent with the bill it replaces, offline, still cancels that bill", async () => {
    const date = businessDate();
    const first = bill(date);
    const edited = { ...bill(date), replaces: first.client_id };
    await send([first, edited]);
    const old = await app.db.prepare("SELECT status FROM pos_bills WHERE client_id = ?").bind(first.client_id).first();
    expect(old).toMatchObject({ status: "cancelled" });
  }, 60_000);

  it("deletes today's paid bill (kept as cancelled), refuses an older one, and leaves the day's totals right", async () => {
    const today = businessDate();
    const b = bill(today);
    const old = bill(addDays(today, -2));
    await send([b, old]);
    const r = await app.call(staff, "POST", `/billing/bills/${b.client_id}/delete`);
    expect(r.status).toBe(200);
    const row = await app.db.prepare("SELECT status, cancel_reason, flags FROM pos_bills WHERE client_id = ?").bind(b.client_id).first();
    expect(row).toMatchObject({ status: "cancelled", cancel_reason: "Deleted at the counter", flags: '["deleted"]' });
    expect((await app.call(staff, "POST", `/billing/bills/${b.client_id}/delete`)).json).toMatchObject({ already: true });
    expect((await app.call(staff, "POST", `/billing/bills/${old.client_id}/delete`)).status).toBe(409);
    expect((await app.call(staff, "POST", "/billing/bills/nope-nope-nope/delete")).status).toBe(404);
    const { daily, sums } = await dayRows(today);
    expect(daily!.total).toBe(sums!.total);
  }, 60_000);
});

describe("the menu as on the old POS", () => {
  it("has each category in the old POS's order, with Half ₹100 less than Full on four Chinese items", async () => {
    const r = await app.call(staff, "GET", "/billing/config");
    const items = r.json.items as { name: string; category_id: number; price: number; variations: { name: string; price: number }[] | null; fav_sort: number | null; favourite: number }[];
    const cats = r.json.categories as { id: number; name: string }[];
    const names = (c: string) => items.filter((i) => i.category_id === cats.find((x) => x.name === c)!.id).map((i) => i.name);
    expect(names("Chinese")).toEqual(["Manchurian", "Chinese Bhel", "Bombay Bhel", "Manchurian Gravy", "Green Manchurian", "Manchow Soup",
      "Manchurian Rice Full", "Noodles", "Schezwan Noodles", "Schezwan Rice", "Singapore Noodles", "Singapore Rice", "Triple Rice",
      "Veg. Fried Rice", "Manchurian Noodles"]);
    expect(names("Pav Bhaji").slice(0, 9)).toEqual(["Kora Pav", "Pav Bhaji", "1 Pav (Oil) (1 pc)", "1 Pav (Amul Butter) (1 pc)", "Pulav (Oil)",
      "Masala Pav (Oil)", "Bhaji Tikka", "Jain Bhaji", "Green Pav Bhaji (Oil)"]);
    expect(names("Pav Bhaji").at(-1)).toBe("Butter Pav Bhaji");
    expect(names("Dosa")[0]).toBe("Cheese Masala Dosa");
    expect(names("Soft Drink")).toEqual(["Chaas (Buttermilk)", "Cold Drinks", "Water", "Water Bottle Small"]);
    const noodles = items.find((i) => i.name === "Noodles")!;
    expect(noodles.variations).toEqual([{ name: "Full", price: 28000 }, { name: "Half", price: 18000 }, { name: "Full Jain", price: 28000 }, { name: "Half Jain", price: 18000 }]);
    expect(items.find((i) => i.name === "Bombay Bhel")!.variations!.map((v) => v.name)).toEqual(["Regular", "Jain"]);
    expect(items.find((i) => i.name === "Green Pav Bhaji (Oil)")!.variations!.map((v) => `${v.name} ${v.price / 100}`))
      .toEqual(["Oil 330", "Jain Oil 330", "Butter 370", "Jain Butter 370"]);
    const favs = items.filter((i) => i.favourite).sort((a, b) => (a.fav_sort ?? 99) - (b.fav_sort ?? 99)).map((i) => i.name);
    expect(favs).toEqual(["1 Pav (Amul Butter) (1 pc)", "1 Pav (Oil) (1 pc)", "Pav Bhaji", "Jain Bhaji", "Chinese Bhel", "Manchurian"]);
    expect(r.json.settings).toMatchObject({ bill_copies: 2, bill_copies_dine_in: 1 });
  }, 60_000);
});

describe("managers run the menu and the waiters", () => {
  it("lets a manager add and switch off menu items and waiters, but not set commission, tables or settings", async () => {
    const manager = (await app.user("manager")).token;
    const cat = await app.call(manager, "POST", "/billing/menu/categories", { name: "Manager Cat" });
    expect(cat.status).toBe(201);
    const item = await app.call(manager, "POST", "/billing/menu/items", { category_id: cat.json.id, name: "Manager Dosa", price: 12000 });
    expect(item.status).toBe(201);
    expect((await app.call(manager, "PATCH", `/billing/menu/items/${item.json.id}`, { active: false, category_id: cat.json.id, name: "Manager Dosa", price: 12000 })).status).toBe(200);
    expect((await app.call(manager, "GET", "/billing/settings")).status).toBe(200);
    expect((await app.call(manager, "PUT", "/billing/settings", { commission_bp: 900 })).status).toBe(403);
    expect((await app.call(manager, "POST", "/billing/tables", { name: "T99" })).status).toBe(403);

    const w = await app.call(manager, "POST", "/billing/waiters", { name: "Manager Waiter", waiter_code: "77", commission_bp: 500 });
    expect(w.status).toBe(201);
    expect((await app.call(manager, "PATCH", `/billing/waiters/${w.json.id}`, { commission_bp: 900 })).status).toBe(200);
    const list = await app.call(manager, "GET", "/billing/waiters");
    const mine = list.json.staff.find((s: { id: number }) => s.id === w.json.id);
    expect(mine).toMatchObject({ waiter_code: "77", commission_bp: null, is_waiter: 1 });
    expect((await app.call(manager, "PATCH", `/billing/waiters/${w.json.id}`, { is_waiter: false })).status).toBe(200);

    // Staff still can't.
    expect((await app.call(staff, "POST", "/billing/waiters", { name: "Nope" })).status).toBe(403);
    expect((await app.call(staff, "POST", "/billing/menu/items", { category_id: cat.json.id, name: "Nope", price: 100 })).status).toBe(403);
  });
});

describe("today's sales on the home page", () => {
  it("adds each paid bill straight away, with the top items, for the owner and managers but not staff", async () => {
    const before = (await app.call(owner, "GET", "/reports/today")).json;
    expect(before.date).toBe(businessDate());
    const b = bill(businessDate());
    expect((await send([b])).status).toBe(200);
    const after = (await app.call(owner, "GET", "/reports/today")).json;
    expect(after.total - before.total).toBe(b.total);
    expect(after.bills - before.bills).toBe(1);
    expect(after.last_bill_at).toBeTruthy();
    expect(after.top.map((i: { name: string }) => i.name)).toEqual(expect.arrayContaining(["Pav Bhaji", "Chaas"]));
    const manager = (await app.user("manager")).token;
    expect((await app.call(manager, "GET", "/reports/today")).status).toBe(200);
    expect((await app.call(staff, "GET", "/reports/today")).status).toBe(403);
  });
});
