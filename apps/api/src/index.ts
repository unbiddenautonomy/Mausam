import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Env } from "./env";
import { requireAuth } from "./lib/auth";
import { HttpError } from "./lib/http";
import { auth } from "./routes/auth";
import { entries } from "./routes/entries";
import { owner } from "./routes/owner";
import { photos } from "./routes/photos";
import { push } from "./routes/push";
import { memo } from "./routes/memo";
import { people } from "./routes/people";
import { vendors } from "./routes/vendors";
import { month } from "./routes/month";
import { pos } from "./routes/pos";
import { analytics } from "./routes/analytics";
import { billing } from "./routes/billing";
import { runChecks } from "./cron";
import { runBackup } from "./lib/backup";
import { rateLimit } from "./lib/ratelimit";

const app = new Hono<AppEnv>().basePath("/api");

// The app and API share one address in production, so CORS is off unless ALLOWED_ORIGIN lists other sites.
app.use("*", async (c, next) => {
  const origin = (c.env.ALLOWED_ORIGIN ?? "").trim();
  if (!origin) return next();
  return cors({ origin: origin === "*" ? "*" : origin.split(",").map((o) => o.trim()), allowHeaders: ["Authorization", "Content-Type"] })(c, next);
});
app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-origin", referrerPolicy: "no-referrer" }));
app.use("*", async (c, next) => {
  await next();
  // API answers are private and change often: never let a proxy or the browser cache them (photos set their own).
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});

app.get("/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>().catch(() => null);
  return c.json({ ok: !!db, migrations: db?.n ?? null }, db ? 200 : 503);
});

// Slow down PIN guessing from one address (on top of the per-account lock in routes/auth.ts).
app.on("POST", ["/auth/login", "/auth/setup"], rateLimit("LOGIN_LIMITER", "ip"));
app.route("/auth", auth);

app.use("*", requireAuth);
// A generous per-user cap so a stuck phone or a bad script can't flood the database.
app.use("*", rateLimit("API_LIMITER", "user"));
app.route("/photos", photos);
app.route("/push", push);
app.route("/memo", memo);
app.route("/people", people);
app.route("/vendors", vendors);
app.route("/month", month);
app.route("/pos", pos);
app.route("/analytics", analytics);
app.route("/billing", billing);
app.route("/", entries);
app.route("/", owner);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, detail: err.detail ?? null }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: "invalid_json" }, 400);
  console.error(JSON.stringify({ msg: "unhandled_error", method: c.req.method, path: c.req.path, error: String(err), stack: err instanceof Error ? err.stack : undefined }));
  return c.json({ error: "server_error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.allSettled([runChecks(env), runBackup(env, new Date(event.scheduledTime))]).then((results) => {
        for (const r of results) if (r.status === "rejected") console.error(JSON.stringify({ msg: "scheduled_failed", error: String(r.reason) }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
