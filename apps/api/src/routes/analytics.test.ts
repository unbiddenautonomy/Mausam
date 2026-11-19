import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, businessDate } from "@mausam/shared";
import { startApp, type TestApp } from "../test/harness";
import { rangeTotals } from "../lib/totals";

let app: TestApp;
let owner: string;
const today = businessDate();
const month = today.slice(0, 7);
const lastMonth = addDays(`${month}-01`, -1).slice(0, 7);

beforeAll(async () => {
  app = await startApp();
  // Five weeks of demo closings, expenses, staff and attendance.
  await app.sql(execFileSync("node", ["scripts/demo-seed.mjs"], { encoding: "utf8", cwd: new URL("../../", import.meta.url).pathname }));
  owner = (await app.user("owner")).token;
}, 120_000);
afterAll(() => app?.dispose());

describe("costs report", () => {
  it("stays well inside the free plan's 50 database calls for 90 days", async () => {
    const r = await app.call(owner, "GET", "/analytics/costs?days=90", undefined, { limit: 50 });
    expect(r.status).toBe(200);
    expect(r.calls).toBeLessThanOrEqual(25);
    expect(r.json.weeks.length).toBe(12);
  });

  it("gives each week the same totals as working that week out on its own", async () => {
    const r = await app.call(owner, "GET", `/analytics/costs?days=30&to=${addDays(today, -3)}`);
    expect(r.json.weeks.length).toBe(4);
    for (const w of r.json.weeks) {
      const alone = await rangeTotals(app.db, w.from, w.to);
      expect(w).toEqual({ from: w.from, to: w.to, sales: alone.sales, food: alone.food, wages: alone.wages, left: alone.left });
    }
    expect(r.json.weeks.some((w: { sales: number }) => w.sales > 0)).toBe(true);
  });
});

describe("month-end pay sheet", () => {
  it("loads in a handful of database calls however many staff there are", async () => {
    for (const m of [month, lastMonth]) {
      const r = await app.call(owner, "GET", `/people/payroll/${m}`, undefined, { limit: 50 });
      expect(r.status).toBe(200);
      expect(r.json.rows.length).toBeGreaterThan(0);
      expect(r.calls).toBeLessThanOrEqual(10);
    }
  });

  it("shows the same pay as saving one person's row", async () => {
    const sheet = await app.call(owner, "GET", `/people/payroll/${lastMonth}`);
    const row = sheet.json.rows.find((x: { gross: number }) => x.gross > 0);
    const saved = await app.call(owner, "PUT", `/people/payroll/${lastMonth}/${row.staff_id}`, { note: "check" });
    expect(saved.json.net).toBe(row.net);
  });
});
