import { addDays, businessDate, istMoment, usualRange } from "@mausam/shared";
import type { Env } from "./env";
import { loadSettings } from "./lib/db";

function at(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return istMoment(date, h, m).getTime();
}

async function raise(
  db: D1Database,
  type: string,
  date: string,
  params: Record<string, unknown>,
  severity: "info" | "warn" | "critical" = "warn",
  audience: "owner" | "manager" | "all" = "owner",
) {
  // UNIQUE(type, business_date) keeps this idempotent: running every 15 minutes never duplicates.
  await db
    .prepare(
      `INSERT INTO alerts (type, business_date, severity, params, audience) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (type, business_date) DO NOTHING`,
    )
    .bind(type, date, severity, JSON.stringify(params), audience)
    .run();
}

/**
 * Runs every 15 minutes. Raises alerts for overdue reports and unusual spending.
 * Push notifications (next build step) will be sent from here for each new alert.
 */
export async function runChecks(env: Env, now = new Date()): Promise<void> {
  const db = env.DB;
  const s = await loadSettings(db);
  const today = businessDate(now);
  const yesterday = addDays(today, -1);

  // 1. Yesterday's closing missing after the escalation time (default 10 am).
  if (now.getTime() >= at(today, s.close_escalate)) {
    const close = await db.prepare("SELECT 1 FROM day_closes WHERE business_date = ?").bind(yesterday).first();
    if (!close) await raise(db, "close_missing", yesterday, { date: yesterday }, "critical", "all");
  }

  // 2. Shopping still open after the escalation time (default 1 pm).
  if (now.getTime() >= at(today, s.shopping_escalate)) {
    const trip = await db
      .prepare("SELECT float_out FROM shopping_trips WHERE business_date = ? AND status = 'open'")
      .bind(today)
      .first<{ float_out: number }>();
    if (trip) await raise(db, "shopping_open", today, { date: today, amount: trip.float_out }, "warn", "all");
  }

  // 3. Unusual spending yesterday: a category far above its usual level for the last 8 weeks.
  //    Only once there's enough history (usualRange needs 4+ days).
  const { results } = await db
    .prepare(
      `SELECT e.category_id, c.key, c.name_en, e.business_date, SUM(e.amount) AS amount
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.business_date BETWEEN ? AND ?
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
        db,
        `expense_high:${y.key}`,
        yesterday,
        { date: yesterday, category: y.name_en, amount: y.amount, usual: Math.round(range.median) },
        "info",
      );
    }
  }
}
