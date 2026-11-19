import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, businessDate, monthDates } from "@mausam/shared";
import { startApp, type TestApp } from "../test/harness";

let app: TestApp;
let owner: string;
const thisMonth = businessDate().slice(0, 7);
const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
const twoAgo = addDays(`${lastMonth}-01`, -1).slice(0, 7);

beforeAll(async () => {
  app = await startApp();
  owner = (await app.user("owner")).token;
}, 60_000);
afterAll(() => app?.dispose());

async function closeEveryDay(m: string) {
  const stmts = monthDates(m).map((d) =>
    app.db.prepare("INSERT INTO day_closes (business_date, total_counter, cash, online, expenses, flags, submitted_by) VALUES (?, 100000, 60000, 40000, 0, '[]', 1)").bind(d),
  );
  await app.db.batch(stmts);
}

describe("month close", () => {
  it("refuses the current month and future months", async () => {
    for (const m of [thisMonth, "2099-01"]) {
      const r = await app.call(owner, "POST", `/month/${m}/close`);
      expect(r.status).toBe(422);
      expect(r.json.error).toBe("month_not_over");
    }
  });

  it("lists missing closings, and closes only when told to close anyway", async () => {
    const r = await app.call(owner, "POST", `/month/${twoAgo}/close`);
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("month_incomplete");
    expect(r.json.detail.missing).toHaveLength(monthDates(twoAgo).length);
    const forced = await app.call(owner, "POST", `/month/${twoAgo}/close`, { force: true });
    expect(forced.status).toBe(200);
    const audit = await app.db.prepare("SELECT after FROM audit_log WHERE table_name = 'month_closes' ORDER BY id DESC LIMIT 1").first<{ after: string }>();
    expect(JSON.parse(audit!.after)).toMatchObject({ status: "closed", forced: true });
  });

  it("closes a complete month straight away", async () => {
    await closeEveryDay(lastMonth);
    const r = await app.call(owner, "POST", `/month/${lastMonth}/close`);
    expect(r.status).toBe(200);
  });
});
