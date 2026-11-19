import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type TestApp } from "../test/harness";
import { isLocalHost } from "./auth";

describe("isLocalHost", () => {
  it("treats a developer's computer and local network as local", () => {
    for (const u of ["http://localhost:8787/api/auth/setup", "http://127.0.0.1:8787/x", "http://[::1]:8787/x", "http://192.168.1.20:5173/x", "http://10.0.0.5/x", "http://172.20.1.1/x"]) {
      expect(isLocalHost(u)).toBe(true);
    }
  });

  it("treats any public address as online", () => {
    for (const u of ["https://mausam-admin.example.workers.dev/api/auth/setup", "https://admin.mausam.in/x", "https://172.32.0.1/x", "https://8.8.8.8/x"]) {
      expect(isLocalHost(u)).toBe(false);
    }
  });
});

describe("logins", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startApp();
  }, 60_000);
  afterAll(() => app?.dispose());

  const phoneOf = async (id: number) => (await app.db.prepare("SELECT phone FROM users WHERE id = ?").bind(id).first<{ phone: string }>())!.phone;
  const login = (phone: string, pin: string) => app.call(null, "POST", "/auth/login", { phone, pin });
  const unlock = (id: number) => app.db.prepare("UPDATE users SET locked_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(id).run();
  const lockedFor = async (id: number) => {
    const row = await app.db.prepare("SELECT locked_until FROM users WHERE id = ?").bind(id).first<{ locked_until: string }>();
    return Math.round((Date.parse(row!.locked_until) - Date.now()) / 60_000);
  };

  it("locks after 5 wrong PINs, longer each time, alerts the owner, and clears on a right PIN", async () => {
    const { id } = await app.user("staff", "Ravi");
    const phone = await phoneOf(id);
    for (let i = 0; i < 5; i++) expect((await login(phone, "0000")).status).toBe(401);
    expect((await login(phone, "1234")).status).toBe(429);
    expect(await lockedFor(id)).toBe(15);
    const alert = await app.db.prepare("SELECT params, audience FROM alerts WHERE type = ?").bind(`login_locked:${id}`).first<{ params: string; audience: string }>();
    expect(alert?.audience).toBe("owner");
    expect(JSON.parse(alert!.params)).toEqual({ name: "Ravi", count: 15 });

    await unlock(id);
    // Five wrong tries at the same moment all count.
    await Promise.all(Array.from({ length: 5 }, () => login(phone, "0000")));
    expect(await lockedFor(id)).toBe(30);

    await unlock(id);
    expect((await login(phone, "1234")).status).toBe(200);
    const row = await app.db.prepare("SELECT failed_logins, lock_count, locked_until FROM users WHERE id = ?").bind(id).first();
    expect(row).toEqual({ failed_logins: 0, lock_count: 0, locked_until: null });
  });

  it("changes a PIN only with the old one, and logs out the person's other devices", async () => {
    const { id, token } = await app.user("manager");
    const phone = await phoneOf(id);
    const other = (await login(phone, "1234")).json.token as string;
    expect((await app.call(token, "POST", "/auth/pin", { old_pin: "9999", new_pin: "4321" })).status).toBe(403);
    expect((await app.call(token, "POST", "/auth/pin", { old_pin: "1234", new_pin: "12" })).status).toBe(422);
    expect((await app.call(token, "POST", "/auth/pin", { old_pin: "1234", new_pin: "4321" })).status).toBe(200);
    expect((await app.call(token, "GET", "/auth/me")).status).toBe(200);
    expect((await app.call(other, "GET", "/auth/me")).status).toBe(401);
    expect((await login(phone, "1234")).status).toBe(401);
    expect((await login(phone, "4321")).status).toBe(200);
  });

  it("refuses a token after logout", async () => {
    const { token } = await app.user("staff");
    expect((await app.call(token, "POST", "/auth/logout")).status).toBe(200);
    expect((await app.call(token, "GET", "/billing/config")).status).toBe(401);
  });
});
