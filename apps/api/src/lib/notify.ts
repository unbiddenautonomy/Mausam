import { formatDay, formatINR, translate, type Lang, type MessageKey } from "@mausam/shared";
import type { Env } from "../env";
import { generateVapidKeys, sendPush, type VapidKeys } from "./webpush";

/**
 * Reminder (VAPID) keys. If VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set on the Worker they win.
 * Otherwise the Worker makes a key pair the first time it's needed and keeps it in the settings table,
 * so nobody has to generate keys by hand. The private key never leaves the server.
 */
export async function getVapid(env: Env, origin?: string): Promise<VapidKeys> {
  const db = env.DB;
  if (origin) await db.prepare("INSERT INTO settings (key, value) VALUES ('app_origin', ?) ON CONFLICT (key) DO NOTHING").bind(origin).run();
  const rows = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('vapid_public', 'vapid_private', 'app_origin')")
    .all<{ key: string; value: string }>();
  const saved = new Map(rows.results.map((r) => [r.key, r.value]));
  const subject = env.VAPID_SUBJECT || saved.get("app_origin") || origin || "https://mausam.workers.dev";
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject };
  let publicKey = saved.get("vapid_public");
  let privateKey = saved.get("vapid_private");
  if (!publicKey || !privateKey) {
    const fresh = await generateVapidKeys();
    // Two requests could race here; ON CONFLICT keeps the first pair, and we re-read it.
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('vapid_public', ?) ON CONFLICT (key) DO NOTHING").bind(fresh.publicKey),
      db.prepare("INSERT INTO settings (key, value) VALUES ('vapid_private', ?) ON CONFLICT (key) DO NOTHING").bind(fresh.privateKey),
    ]);
    const again = await db
      .prepare("SELECT key, value FROM settings WHERE key IN ('vapid_public', 'vapid_private')")
      .all<{ key: string; value: string }>();
    const m = new Map(again.results.map((r) => [r.key, r.value]));
    publicKey = m.get("vapid_public")!;
    privateKey = m.get("vapid_private")!;
  }
  return { publicKey, privateKey, subject };
}

export type Audience = "owner" | "manager" | "all";
/** A role group, or particular people (by user id). An empty list means every manager. */
export type Recipients = Audience | { users: number[] };

interface Target {
  user_id: number;
  language: Lang;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Unseen alert count for a role: becomes the number on the app icon. */
async function unseenFor(db: D1Database, role: string): Promise<number> {
  const audience = role === "owner" ? "('owner','manager','all')" : "('manager','all')";
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE seen_at IS NULL AND audience IN ${audience}`).first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Sends a notification to everyone in the audience, in each person's language.
 * `dedupeKey` makes it send at most once (the cron runs every 15 minutes).
 */
export async function notify(
  env: Env,
  audience: Recipients,
  text: { title: MessageKey; body: MessageKey; params?: Record<string, string | number> },
  opts: { url?: string; dedupeKey?: string } = {},
): Promise<number> {
  const db = env.DB;
  if (opts.dedupeKey) {
    const res = await db.prepare("INSERT INTO notifications_sent (key) VALUES (?) ON CONFLICT (key) DO NOTHING").bind(opts.dedupeKey).run();
    if (!res.meta.changes) return 0;
  }
  const vapid = await getVapid(env);
  const people = typeof audience === "object" && audience.users.length ? audience.users : null;
  const group = typeof audience === "object" ? "manager" : audience;
  const roles = group === "owner" ? ["owner"] : group === "manager" ? ["manager"] : ["owner", "manager"];
  const { results } = await (people
    ? db
        .prepare(
          `SELECT s.user_id, u.language, u.role, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
           JOIN users u ON u.id = s.user_id WHERE u.active = 1 AND u.id IN (${people.map(() => "?").join(",")})`,
        )
        .bind(...people)
    : db
        .prepare(
          `SELECT s.user_id, u.language, u.role, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
           JOIN users u ON u.id = s.user_id WHERE u.active = 1 AND u.role IN (${roles.map(() => "?").join(",")})`,
        )
        .bind(...roles)
  ).all<Target & { role: string }>();
  const badges = new Map<string, number>();
  let sent = 0;
  await Promise.all(
    results.map(async (t) => {
      if (!badges.has(t.role)) badges.set(t.role, await unseenFor(db, t.role));
      const lang = (["en", "hi", "kn"].includes(t.language) ? t.language : "en") as Lang;
      try {
        const status = await sendPush(
          t,
          {
            title: translate(lang, text.title, inLang(text.params, lang)),
            body: translate(lang, text.body, inLang(text.params, lang)),
            url: opts.url ?? "/",
            badge: badges.get(t.role),
            tag: opts.dedupeKey,
          },
          vapid,
        );
        if (status === 404 || status === 410) {
          await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(t.endpoint).run();
        } else if (status < 300) sent++;
      } catch (e) {
        console.error("push failed", e);
      }
    }),
  );
  return sent;
}

/** The alert's date written in the reader's language ("Thu, 12 Nov" or the same in Hindi or Kannada). */
function inLang(params: Record<string, string | number> | undefined, lang: Lang): Record<string, string | number> | undefined {
  const iso = params?.iso_date;
  return typeof iso === "string" ? { ...params, date: formatDay(iso, true, lang) } : params;
}

/** Words for an alert row, used for both the push text and the app. */
export function alertParams(type: string, date: string, params: Record<string, unknown>): Record<string, string | number> {
  return {
    date: formatDay(date, true, "en"),
    iso_date: date,
    count: Number(params.count ?? 0),
    amount: typeof params.amount === "number" ? formatINR(params.amount) : "",
    usual: typeof params.usual === "number" ? formatINR(params.usual) : "",
    category: String(params.category ?? ""),
    name: String(params.name ?? ""),
    vendor: String(params.vendor ?? ""),
    month: String(params.month ?? ""),
  };
}
