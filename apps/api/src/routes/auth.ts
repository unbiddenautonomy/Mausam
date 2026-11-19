import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createSession, hashPin, normalisePhone, requireAuth, validPin } from "../lib/auth";
import { HttpError, requireText } from "../lib/http";
import { audit } from "../lib/db";
import { PIN_COLUMNS, tryPin, type PinUser } from "../lib/pin";
import { DEFAULT_LANG } from "@mausam/shared";

const LANGS = ["en", "hi", "kn"];

export const auth = new Hono<AppEnv>();

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A developer's own computer or local network, where first-run setup may skip the code. */
export function isLocalHost(url: string): boolean {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** Is this a brand-new install with no owner yet? */
auth.get("/setup", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  const local = isLocalHost(c.req.url);
  return c.json({
    needs_setup: (row?.n ?? 0) === 0,
    code_required: !!c.env.SETUP_CODE || !local,
    // Online without a SETUP_CODE secret, first-run setup is refused rather than left open to anyone.
    code_missing: !c.env.SETUP_CODE && !local,
  });
});

/** First run only: create the owner account. */
auth.post("/setup", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) throw new HttpError(409, "already_set_up");
  // Until the owner exists, anyone with the web address could create it. SETUP_CODE (a Worker secret) closes that gap.
  // Online, the code is required: without the secret, setup is refused instead of left open.
  if (!c.env.SETUP_CODE && !isLocalHost(c.req.url)) throw new HttpError(403, "setup_code_missing");
  if (c.env.SETUP_CODE && !sameText(String(body.setup_code ?? "").trim(), c.env.SETUP_CODE.trim())) {
    throw new HttpError(403, "wrong_setup_code");
  }
  const name = requireText(body.name, "name", 80);
  const phone = normalisePhone(body.phone);
  if (!phone) throw new HttpError(422, "invalid", { field: "phone" });
  if (!validPin(body.pin)) throw new HttpError(422, "invalid", { field: "pin" });
  const language = LANGS.includes(String(body.language)) ? String(body.language) : DEFAULT_LANG;
  const { hash, salt } = await hashPin(body.pin);
  const res = await c.env.DB.prepare(
    "INSERT INTO users (name, phone, role, pin_hash, pin_salt, language) VALUES (?, ?, 'owner', ?, ?, ?)",
  )
    .bind(name, phone, hash, salt, language)
    .run();
  const id = Number(res.meta.last_row_id);
  const token = await createSession(c.env.DB, id);
  return c.json({ token, user: { id, name, phone, role: "owner", language } });
});

auth.post("/login", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const phone = normalisePhone(body.phone);
  if (!phone || !validPin(body.pin)) throw new HttpError(401, "wrong_login");
  const user = await c.env.DB.prepare(`SELECT ${PIN_COLUMNS}, phone, role, language FROM users WHERE phone = ? AND active = 1`)
    .bind(phone)
    .first<PinUser & { phone: string; role: string; language: string }>();
  if (!user) throw new HttpError(401, "wrong_login");
  const check = await tryPin(c.env, user, body.pin);
  if (check === "locked") throw new HttpError(429, "too_many_tries");
  if (check === "wrong") throw new HttpError(401, "wrong_login");
  const token = await createSession(c.env.DB, user.id);
  const { pin_hash, pin_salt, locked_until, lock_count, ...safe } = user;
  return c.json({ token, user: safe });
});

auth.use("/me", requireAuth);
auth.use("/logout", requireAuth);
auth.use("/pin", requireAuth);

auth.get("/me", (c) => c.json({ user: c.get("user") }));

auth.patch("/me", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (body.language !== undefined) {
    if (!LANGS.includes(String(body.language))) throw new HttpError(422, "invalid", { field: "language" });
    await c.env.DB.prepare("UPDATE users SET language = ? WHERE id = ?").bind(body.language, c.get("user").id).run();
  }
  return c.json({ user: { ...c.get("user"), language: body.language ?? c.get("user").language } });
});

auth.post("/logout", async (c) => {
  const token = (c.req.header("Authorization") ?? "").slice(7);
  await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return c.json({ ok: true });
});

/**
 * A person changes their own PIN, after typing the old one. Their other devices are logged out; this one stays in.
 * Wrong old PINs count towards the account lock, like wrong logins.
 */
auth.post("/pin", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!validPin(body.new_pin)) throw new HttpError(422, "invalid", { field: "new_pin" });
  const me = c.get("user");
  const db = c.env.DB;
  const user = await db.prepare(`SELECT ${PIN_COLUMNS} FROM users WHERE id = ?`).bind(me.id).first<PinUser>();
  if (!user) throw new HttpError(401, "not_logged_in");
  const check = validPin(body.old_pin) ? await tryPin(c.env, user, body.old_pin) : "wrong";
  if (check === "locked") throw new HttpError(429, "too_many_tries");
  if (check === "wrong") throw new HttpError(403, "wrong_pin");
  const { hash, salt } = await hashPin(body.new_pin);
  const token = (c.req.header("Authorization") ?? "").slice(7);
  await db.batch([
    db.prepare("UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?").bind(hash, salt, me.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").bind(me.id, token),
  ]);
  await audit(db, "users", me.id, "update", null, { pin_changed: true }, me.id);
  return c.json({ ok: true });
});
