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
