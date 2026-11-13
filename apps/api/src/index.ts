import { Hono } from "hono";
import { cors } from "hono/cors";
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
import { runChecks } from "./cron";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN || "*";
  return cors({ origin: origin === "*" ? "*" : origin.split(","), allowHeaders: ["Authorization", "Content-Type"] })(c, next);
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);

app.use("*", requireAuth);
app.route("/photos", photos);
app.route("/push", push);
app.route("/memo", memo);
app.route("/people", people);
app.route("/vendors", vendors);
app.route("/month", month);
app.route("/pos", pos);
app.route("/", entries);
app.route("/", owner);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, detail: err.detail ?? null }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: "invalid_json" }, 400);
  console.error(err);
  return c.json({ error: "server_error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runChecks(env));
  },
} satisfies ExportedHandler<Env>;
