import { formatDay, formatINR, translate, type Lang, type MessageKey } from "@mausam/shared";
import type { Env } from "../env";
import { sendPush, type VapidKeys } from "./webpush";

export function vapidFrom(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "mailto:admin@example.com" };
}

export type Audience = "owner" | "manager" | "all";

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
  audience: Audience,
  text: { title: MessageKey; body: MessageKey; params?: Record<string, string | number> },
  opts: { url?: string; dedupeKey?: string } = {},
): Promise<number> {
  const db = env.DB;
  if (opts.dedupeKey) {
    const res = await db.prepare("INSERT INTO notifications_sent (key) VALUES (?) ON CONFLICT (key) DO NOTHING").bind(opts.dedupeKey).run();
    if (!res.meta.changes) return 0;
  }
  const vapid = vapidFrom(env);
  if (!vapid) return 0;
  const roles = audience === "owner" ? ["owner"] : audience === "manager" ? ["manager"] : ["owner", "manager"];
  const { results } = await db
    .prepare(
      `SELECT s.user_id, u.language, u.role, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id WHERE u.active = 1 AND u.role IN (${roles.map(() => "?").join(",")})`,
    )
    .bind(...roles)
    .all<Target & { role: string }>();
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
            title: translate(lang, text.title, text.params),
            body: translate(lang, text.body, text.params),
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

/** Words for an alert row, used for both the push text and the app. */
export function alertParams(type: string, date: string, params: Record<string, unknown>): Record<string, string | number> {
  return {
    date: formatDay(date),
    count: Number(params.count ?? 0),
    amount: typeof params.amount === "number" ? formatINR(params.amount) : "",
    usual: typeof params.usual === "number" ? formatINR(params.usual) : "",
    category: String(params.category ?? ""),
    name: String(params.name ?? ""),
    vendor: String(params.vendor ?? ""),
    month: String(params.month ?? ""),
  };
}
