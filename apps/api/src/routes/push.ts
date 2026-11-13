import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/http";
import { vapidFrom } from "../lib/notify";
import { sendPush } from "../lib/webpush";

export const push = new Hono<AppEnv>();

/** The public key the browser needs to subscribe. `null` when push isn't set up on the server yet. */
push.get("/key", (c) => c.json({ key: vapidFrom(c.env)?.publicKey ?? null }));

push.post("/subscribe", async (c) => {
  const b = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>();
  if (!b.endpoint?.startsWith("https://") || !b.keys?.p256dh || !b.keys?.auth) throw new HttpError(422, "invalid");
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(c.get("user").id, b.endpoint, b.keys.p256dh, b.keys.auth)
    .run();
  return c.json({ ok: true });
});

push.post("/unsubscribe", async (c) => {
  const b = await c.req.json<{ endpoint?: string }>();
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(b.endpoint ?? "", c.get("user").id).run();
  return c.json({ ok: true });
});

/** Sends a test notification to all of this person's devices. */
push.post("/test", async (c) => {
  const vapid = vapidFrom(c.env);
  if (!vapid) throw new HttpError(409, "push_not_configured");
  const { results } = await c.env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .bind(c.get("user").id)
    .all<{ endpoint: string; p256dh: string; auth: string }>();
  let ok = 0;
  for (const s of results) {
    const status = await sendPush(s, { title: "Mausam", body: "✓ Reminders are working.", url: "/" }, vapid);
    if (status < 300) ok++;
    else if (status === 404 || status === 410) await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(s.endpoint).run();
  }
  return c.json({ devices: results.length, delivered: ok });
});

