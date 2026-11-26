import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../test/harness";

let app: TestApp;
let owner: string;
let manager: string;
beforeAll(async () => {
  app = await startApp();
  owner = (await app.user("owner")).token;
  manager = (await app.user("manager")).token;
}, 60_000);
afterAll(() => app?.dispose());

async function addAlert(type: string, audience: string) {
  const r = await app.db.prepare("INSERT INTO alerts (type, business_date, severity, params, audience) VALUES (?, '2026-11-01', 'warn', '{}', ?)").bind(type, audience).run();
  return Number(r.meta.last_row_id);
}
const seen = async (id: number) => !!(await app.db.prepare("SELECT seen_at FROM alerts WHERE id = ?").bind(id).first<{ seen_at: string | null }>())!.seen_at;

describe("alerts", () => {
  it("a manager's 'mark all as seen' leaves the owner's alerts alone", async () => {
    const forOwner = await addAlert("close_flag", "owner");
    const forAll = await addAlert("close_unbalanced", "all");
    expect((await app.call(manager, "GET", "/alerts")).json.alerts.map((a: { id: number }) => a.id)).toEqual([forAll]);
    await app.call(manager, "POST", "/alerts/seen", {});
    expect(await seen(forAll)).toBe(true);
    expect(await seen(forOwner)).toBe(false);
    // Naming the owner's alert by id doesn't work either.
    await app.call(manager, "POST", "/alerts/seen", { ids: [forOwner] });
    expect(await seen(forOwner)).toBe(false);
    await app.call(owner, "POST", "/alerts/seen", { ids: [forOwner] });
    expect(await seen(forOwner)).toBe(true);
  });

  it("accepts a long list of ids", async () => {
    const ids = [];
    for (let i = 0; i < 150; i++) ids.push(await addAlert(`expense_high:${i}`, "all"));
    const r = await app.call(owner, "POST", "/alerts/seen", { ids });
    expect(r.status).toBe(200);
    expect(await seen(ids[149])).toBe(true);
  });
});

describe("daily sales report", () => {
  it("shows a day with POS bills but no closing, marked as from the POS, and takes a 1-day range", async () => {
    await app.db.prepare("INSERT INTO pos_daily (business_date, total, cash, online, bills, source) VALUES ('2026-10-05', 500000, 200000, 300000, 12, 'pos')").run();
    const r = await app.call(owner, "GET", "/reports/daily?to=2026-10-05&days=1");
    expect(r.status).toBe(200);
    expect(r.json.from).toBe("2026-10-05");
    expect(r.json.days).toEqual([expect.objectContaining({ business_date: "2026-10-05", total_counter: 500000, cash: 200000, online: 300000, from_pos: true, flags: [] })]);
  });
});

describe("settings", () => {
  it("refuses numbers out of range", async () => {
    expect((await app.call(owner, "PUT", "/settings", { lock_hour: 24 })).json).toMatchObject({ error: "invalid", detail: { field: "lock_hour" } });
    expect((await app.call(owner, "PUT", "/settings", { cash_tolerance: 5_00_00_000 })).status).toBe(422);
    const ok = await app.call(owner, "PUT", "/settings", { lock_hour: 9, shopping_tolerance: 10000 });
    expect(ok.json.settings).toMatchObject({ lock_hour: 9, shopping_tolerance: 10000 });
  });
});

describe("owner home", () => {
  it("shows POS sales for a day nobody closed, in the day and in the last 7 days", async () => {
    await app.db.prepare("INSERT INTO pos_daily (business_date, total, cash, online, bills, source) VALUES ('2026-09-10', 420000, 120000, 300000, 9, 'pos')").run();
    const r = await app.call(owner, "GET", "/summary?date=2026-09-10");
    expect(r.status).toBe(200);
    expect(r.json.close).toBeNull();
    expect(r.json.pos).toMatchObject({ total: 420000, cash: 120000, online: 300000, bills: 9 });
    expect(r.json.last7.at(-1)).toMatchObject({ business_date: "2026-09-10", total_counter: null, pos_total: 420000, status: "missing" });
    expect(r.json.last7[0]).toMatchObject({ pos_total: null });
  });
});
