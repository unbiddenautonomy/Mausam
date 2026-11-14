import { attendanceMarked } from "./routes/people";
import { addDays, businessDate, DAY_START_HOUR, istMoment, monthCloseFor, usualRange, type MessageKey } from "@mausam/shared";
import type { Env } from "./env";
import { loadSettings } from "./lib/db";
import { alertParams, notify, type Audience } from "./lib/notify";

/** The moment an "HH:MM" time happens for a business date. Times before 5 am belong to the next calendar day. */
export function dueAt(businessDate: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const calendarDay = h < DAY_START_HOUR ? addDays(businessDate, 1) : businessDate;
  return istMoment(calendarDay, h, m).getTime();
}

/**
 * Creates an alert once (UNIQUE(type, business_date) keeps it idempotent) and, if it is new, sends a push.
 * Returns true when the alert was newly created.
 */
export async function raise(
  env: Env,
  type: string,
  date: string,
  params: Record<string, unknown>,
  severity: "info" | "warn" | "critical" = "warn",
  audience: Audience = "owner",
  url = "/alerts",
): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO alerts (type, business_date, severity, params, audience) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (type, business_date) DO NOTHING`,
  )
    .bind(type, date, severity, JSON.stringify(params), audience)
    .run();
  if (!res.meta.changes) return false;
  const base = type.split(":")[0];
  await notify(env, audience, { title: "push.alert_title", body: `alert.${base}` as MessageKey, params: alertParams(base, date, params) }, { url, dedupeKey: `alert:${type}:${date}` });
  return true;
}

/**
 * Runs every 15 minutes: reminders before things are due, alerts when they're overdue,
 * and checks for unusual spending.
 */
export async function runChecks(env: Env, now = new Date()): Promise<void> {
  const db = env.DB;
  const s = await loadSettings(db);
  const today = businessDate(now);
  const yesterday = addDays(today, -1);
  const t = now.getTime();

  // ---- Reminders to managers ----
  const trip = await db
    .prepare("SELECT status, float_out FROM shopping_trips WHERE business_date = ? ORDER BY id DESC LIMIT 1")
    .bind(today)
    .first<{ status: string; float_out: number }>();
  if (t >= dueAt(today, s.shopping_due) && trip?.status !== "closed") {
    await notify(env, "manager", { title: "push.shopping_title", body: trip ? "push.shopping_open_body" : "push.shopping_body" }, { url: "/entries/shopping", dedupeKey: `remind:shopping:${today}` });
  }
  const closeToday = await db.prepare("SELECT 1 FROM day_closes WHERE business_date = ?").bind(today).first();
  if (t >= dueAt(today, s.close_due) && !closeToday) {
    await notify(env, "manager", { title: "push.close_title", body: "push.close_body" }, { url: "/entries/close", dedupeKey: `remind:close:${today}` });
  }

  // ---- Escalations ----
  // Yesterday's closing still missing at the escalation time (default 10 am).
  if (t >= dueAt(today, s.close_escalate)) {
    const close = await db.prepare("SELECT 1 FROM day_closes WHERE business_date = ?").bind(yesterday).first();
    if (!close) await raise(env, "close_missing", yesterday, { date: yesterday }, "critical", "all", `/entries/close/${yesterday}`);
  }
  // Shopping still open at the escalation time (default 1 pm).
  if (t >= dueAt(today, s.shopping_escalate) && trip?.status === "open") {
    await raise(env, "shopping_open", today, { date: today, amount: trip.float_out }, "warn", "all", "/entries/shopping");
  }

  // Nobody marked attendance yesterday (only once staff are set up).
  if (t >= dueAt(today, s.close_escalate)) {
    const staff = await db.prepare("SELECT COUNT(*) AS n FROM staff WHERE active = 1").first<{ n: number }>();
    if ((staff?.n ?? 0) > 0 && !(await attendanceMarked(db, yesterday))) {
      await raise(env, "attendance_missing", yesterday, { date: yesterday }, "warn", "all", "/people/attendance");
    }
  }

  // ---- Month close window: 27th to 3rd ----
  const month = monthCloseFor(today);
  if (month && t >= dueAt(today, "10:00")) {
    const closed = await db.prepare("SELECT status FROM month_closes WHERE month = ?").bind(month).first<{ status: string }>().catch(() => null);
    if (closed?.status !== "closed") await raise(env, "month_close", `${month}-01`, { month }, "info", "all", "/month");
  }

  // ---- Unusual spending yesterday ----
  // A category far above its usual daily amount over the last 8 weeks (needs 4+ days of history).
  const { results } = await db
    .prepare(
      `SELECT e.category_id, c.key, c.name_en, e.business_date, SUM(e.amount) AS amount
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.source = 'manual' AND e.business_date BETWEEN ? AND ?
       GROUP BY e.category_id, e.business_date`,
    )
    .bind(addDays(yesterday, -56), yesterday)
    .all<{ category_id: number; key: string; name_en: string; business_date: string; amount: number }>();
  const byCat = new Map<number, typeof results>();
  for (const r of results) byCat.set(r.category_id, [...(byCat.get(r.category_id) ?? []), r]);
  for (const rows of byCat.values()) {
    const y = rows.find((r) => r.business_date === yesterday);
    if (!y) continue;
    const range = usualRange(rows.filter((r) => r.business_date !== yesterday).map((r) => r.amount));
    if (range && y.amount > range.high && y.amount > range.median * 1.5) {
      await raise(
        env,
        `expense_high:${y.key}`,
        yesterday,
        { date: yesterday, category: y.name_en, amount: y.amount, usual: Math.round(range.median) },
        "info",
        "owner",
        `/entries/expenses?date=${yesterday}`,
      );
    }
  }

  // Keep the dedupe table small, and drop expired logins.
  await db.prepare("DELETE FROM notifications_sent WHERE at < datetime('now', '-14 days')").run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now.toISOString()).run();
}
