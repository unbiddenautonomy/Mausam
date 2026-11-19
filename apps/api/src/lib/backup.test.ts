import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../test/harness";
import type { Env } from "../env";
import { runBackup } from "./backup";

let app: TestApp;
beforeAll(async () => {
  app = await startApp();
}, 60_000);
afterAll(() => app?.dispose());

/** The same environment, with file storage that refuses writes (as when the free KV allowance runs out). */
function brokenFiles(): Env {
  const files = new Proxy(app.env.FILES, {
    get(target, prop) {
      if (prop === "put") return () => Promise.reject(new Error("KV put() limit exceeded for the day"));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { ...app.env, FILES: files };
}

const alerts = async () =>
  (await app.db.prepare("SELECT business_date, severity, audience FROM alerts WHERE type = 'backup_missing'").all()).results;

describe("nightly backup", () => {
  it("writes a backup after 4 am India time", async () => {
    expect(await runBackup(app.env, new Date("2026-11-10T23:00:00Z"))).toBe("backups/2026-11-11.json"); // 4:30 am IST
    expect(await runBackup(app.env, new Date("2026-11-10T23:15:00Z"))).toBeNull(); // already done today
  });

  it("tells the owner once when there is still no backup at 10 am", async () => {
    const env = brokenFiles();
    await expect(runBackup(env, new Date("2026-11-11T23:00:00Z"))).rejects.toThrow(); // 4:30 am: fails quietly, tries again later
    expect(await alerts()).toEqual([]);
    await expect(runBackup(env, new Date("2026-11-12T04:45:00Z"))).rejects.toThrow(); // 10:15 am
    await expect(runBackup(env, new Date("2026-11-12T05:00:00Z"))).rejects.toThrow();
    expect(await alerts()).toEqual([{ business_date: "2026-11-12", severity: "critical", audience: "owner" }]);
  });
});
