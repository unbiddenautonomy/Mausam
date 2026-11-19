// Test helper: runs the real API Worker against a fresh local D1 database (no network, nothing kept on disk).
// It also counts database calls, and can make the 51st call fail, like Cloudflare's free plan.
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import type { Role } from "@mausam/shared";
import worker from "../index";
import type { Env } from "../env";
import { createSession, hashPin } from "../lib/auth";

const API_DIR = new URL("../../", import.meta.url);

/** Splits a migration file into statements (statements end with ";" at the end of a line). */
function statements(sql: string): string[] {
  return sql
    .split(/;[ \t]*(?:--[^\n]*)?\r?\n/)
    .map((s) => s.replace(/^\s*--[^\n]*$/gm, "").trim())
    .filter(Boolean);
}

export interface Counter {
  calls: number;
  /** 0 = no limit. Otherwise the call after `limit` fails, as on the free plan (a batch counts as one call). */
  limit: number;
}

function counted(db: D1Database, counter: Counter): D1Database {
  const tooMany = () => Promise.reject(new Error("D1_ERROR: Too many API requests by single worker invocation (test limit)"));
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const p = new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
        if (prop === "first" || prop === "all" || prop === "run" || prop === "raw") {
          return (...args: unknown[]) => {
            counter.calls++;
            if (counter.limit && counter.calls > counter.limit) return tooMany();
            return (target[prop] as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    real.set(p, stmt);
    return p;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          counter.calls++;
          if (counter.limit && counter.calls > counter.limit) return tooMany();
          return target.batch(stmts.map((s) => real.get(s) ?? s));
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

export interface Reply<T = any> {
  status: number;
  json: T;
  /** Database calls the request made, background work included. */
  calls: number;
}

export interface TestApp {
  env: Env;
  db: D1Database;
  /** Makes a user and returns a login token for them. */
  user(role: Role, name?: string): Promise<{ id: number; token: string }>;
  call<T = any>(token: string | null, method: string, path: string, body?: unknown, opts?: { limit?: number }): Promise<Reply<T>>;
  cron(time: Date, opts?: { limit?: number }): Promise<{ calls: number; errors: string[] }>;
  dispose(): Promise<void>;
}

let phones = 9100000000;

export async function startApp(): Promise<TestApp> {
  const proxy = await getPlatformProxy<Env>({ configPath: new URL("wrangler.jsonc", API_DIR).pathname, persist: false });
  // No rate limits in tests: they would make results depend on timing.
  const base = { ...proxy.env, LOGIN_LIMITER: undefined, API_LIMITER: undefined } as Env;
  const db = base.DB;
  const dir = new URL("migrations/", API_DIR).pathname;
  await db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const s of statements(readFileSync(`${dir}${file}`, "utf8"))) await db.prepare(s).run();
    await db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(file).run();
  }

  const run = async <T>(limit: number, fn: (env: Env, ctx: ExecutionContext) => Promise<T>) => {
    const counter: Counter = { calls: 0, limit };
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const out = await fn({ ...base, DB: counted(db, counter) }, ctx);
    await Promise.all(pending);
    return { out, calls: counter.calls };
  };

  return {
    env: base,
    db,
    async user(role, name = `${role} ${phones}`) {
      const { hash, salt } = await hashPin("1234");
      const res = await db
        .prepare("INSERT INTO users (name, phone, role, pin_hash, pin_salt) VALUES (?, ?, ?, ?, ?)")
        .bind(name, String(phones++), role, hash, salt)
        .run();
      const id = Number(res.meta.last_row_id);
      return { id, token: await createSession(db, id) };
    },
    async call(token, method, path, body, opts = {}) {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const req = new Request(`http://localhost/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const { out, calls } = await run(opts.limit ?? 0, async (env, ctx) => {
        const res = await worker.fetch(req, env, ctx);
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : null };
      });
      return { ...out, calls };
    },
    async cron(time, opts = {}) {
      const errors: string[] = [];
      const orig = console.error;
      console.error = (...a: unknown[]) => void errors.push(a.join(" "));
      try {
        const { calls } = await run(opts.limit ?? 0, (env, ctx) =>
          Promise.resolve(worker.scheduled({ scheduledTime: time.getTime(), cron: "*/15 * * * *", noRetry() {} } as ScheduledController, env, ctx)),
        );
        return { calls, errors };
      } finally {
        console.error = orig;
      }
    },
    dispose: () => proxy.dispose(),
  };
}
