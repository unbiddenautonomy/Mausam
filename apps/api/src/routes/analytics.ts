import { Hono } from "hono";
import { addDays, businessDate, dateRange } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { audit } from "../lib/db";
import { HttpError, isDate } from "../lib/http";
import { rangeTotals, totalsByRange } from "../lib/totals";

export const analytics = new Hono<AppEnv>();

/** The last day (inclusive) the owner has shared the deeper analytics with managers, or null. */
export async function sharedUntil(db: D1Database): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'analytics_shared_until'").first<{ value: string }>();
  return r && isDate(r.value) ? r.value : null;
}

/** Can a manager see the deeper analytics today? Only while the owner's monthly share lasts. */
export async function managersCanSee(db: D1Database): Promise<boolean> {
  const until = await sharedUntil(db);
  return !!until && until >= businessDate();
}

// Managers always see the basic sales views; the rest only while the owner shares them. The audit log stays the owner's.
const BASIC = new Set(["/weekdays", "/hours", "/share"]);
analytics.use("*", async (c, next) => {
  const role = c.get("user").role;
  if (role === "owner") return next();
  const path = c.req.path.replace(/^\/api/, "").replace(/^\/analytics/, "");
  if (role === "manager" && path !== "/audit" && (BASIC.has(path) || (await managersCanSee(c.env.DB)))) return next();
  throw new HttpError(403, "not_allowed");
});

/** Whether the deeper analytics are shared with managers, and until when. */
analytics.get("/share", async (c) => {
  const until = await sharedUntil(c.env.DB);
  return c.json({ until, active: !!until && until >= businessDate() });
});

/** Owner: share the deeper analytics with managers until the end of this month, or stop sharing. */
analytics.put("/share", requireRole("owner"), async (c) => {
  const b = await c.req.json<{ share?: unknown }>();
  const db = c.env.DB;
  const today = businessDate();
  if (b.share) {
    const [y, m] = today.split("-").map(Number);
    const until = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of this month
    await db.prepare("INSERT INTO settings (key, value) VALUES ('analytics_shared_until', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(until).run();
    await audit(db, "settings", 0, "update", null, { analytics_shared_until: until }, c.get("user").id);
  } else {
    await db.prepare("DELETE FROM settings WHERE key = 'analytics_shared_until'").run();
    await audit(db, "settings", 0, "update", null, { analytics_shared_until: null }, c.get("user").id);
  }
  const until = await sharedUntil(db);
  return c.json({ until, active: !!until && until >= today });
});

function range(c: { req: { query: (k: string) => string | undefined } }) {
  const to = isDate(c.req.query("to")) ? c.req.query("to")! : businessDate();
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 7), 366);
  return { from: addDays(to, -(days - 1)), to, days };
}

/** Where the money went, and food cost % week by week. */
analytics.get("/costs", async (c) => {
  const { from, to } = range(c);
  // Weeks ending on `to`, oldest first; only full weeks inside the range. All weeks come from one set of queries.
  const spans: { from: string; to: string }[] = [];
  for (let end = to; addDays(end, -6) >= from; end = addDays(end, -7)) spans.unshift({ from: addDays(end, -6), to: end });
  const [totals, perWeek] = await Promise.all([rangeTotals(c.env.DB, from, to), totalsByRange(c.env.DB, from, to, spans)]);
  const weeks = spans.map((w, i) => ({ from: w.from, to: w.to, sales: perWeek[i].sales, food: perWeek[i].food, wages: perWeek[i].wages, left: perWeek[i].left }));
  return c.json({ from, to, totals, weeks });
});

/** Best sellers from POS item sales. */
analytics.get("/items", async (c) => {
  const { from, to } = range(c);
  const { results: items } = await c.env.DB.prepare(
    `SELECT item, MAX(category) AS category, SUM(qty) AS qty, SUM(amount) AS amount, COUNT(DISTINCT business_date) AS days
     FROM pos_items WHERE business_date BETWEEN ? AND ? GROUP BY LOWER(item) ORDER BY amount DESC`,
  )
    .bind(from, to)
    .all<{ item: string; category: string | null; qty: number; amount: number; days: number }>();
  const { results: cats } = await c.env.DB.prepare(
    `SELECT COALESCE(category, '—') AS category, SUM(amount) AS amount FROM pos_items WHERE business_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`,
  )
    .bind(from, to)
    .all<{ category: string; amount: number }>();
  const span = await c.env.DB.prepare("SELECT COUNT(DISTINCT business_date) AS n FROM pos_items WHERE business_date BETWEEN ? AND ?").bind(from, to).first<{ n: number }>();
  return c.json({ from, to, days_with_data: span?.n ?? 0, items, categories: cats });
});

/** What we pay per unit over time: vendor deliveries, plus expenses entered with a quantity. */
analytics.get("/prices", async (c) => {
  const { from, to } = range(c);
  const { results } = await c.env.DB.prepare(
    `SELECT d.item AS item, d.unit AS unit, d.business_date AS date, d.rate AS rate, v.name AS source
       FROM deliveries d JOIN vendors v ON v.id = d.vendor_id
       WHERE d.deleted_at IS NULL AND d.business_date BETWEEN ? AND ?
     UNION ALL
     SELECT COALESCE(e.item, c.name_en) AS item, e.unit AS unit, e.business_date AS date, CAST(ROUND(e.amount / e.qty) AS INTEGER) AS rate, COALESCE(e.shop, '') AS source
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.qty > 0 AND e.unit IS NOT NULL AND e.business_date BETWEEN ? AND ?
     ORDER BY date`,
  )
    .bind(from, to, from, to)
    .all<{ item: string; unit: string | null; date: string; rate: number; source: string }>();
  const byItem = new Map<string, { item: string; unit: string | null; points: { date: string; rate: number; source: string }[] }>();
  for (const r of results) {
    const key = `${r.item.trim().toLowerCase()}|${(r.unit ?? "").toLowerCase()}`;
    const entry = byItem.get(key) ?? { item: r.item.trim(), unit: r.unit, points: [] };
    entry.points.push({ date: r.date, rate: r.rate, source: r.source });
    byItem.set(key, entry);
  }
  const items = [...byItem.values()].map((e) => {
    const rates = e.points.map((p) => p.rate);
    const first = rates[0];
    const last = rates[rates.length - 1];
    return { ...e, first, last, min: Math.min(...rates), max: Math.max(...rates), change: first ? (last - first) / first : 0 };
  });
  items.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.points.length - a.points.length);
  return c.json({ from, to, items });
});

/** Average sales by weekday from closings. */
analytics.get("/weekdays", async (c) => {
  const { from, to } = range(c);
  const { results } = await c.env.DB.prepare("SELECT business_date, total_counter FROM day_closes WHERE business_date BETWEEN ? AND ?")
    .bind(from, to)
    .all<{ business_date: string; total_counter: number }>();
  const sums = Array.from({ length: 7 }, () => ({ total: 0, n: 0 }));
  for (const r of results) {
    const d = new Date(r.business_date + "T00:00:00Z").getUTCDay();
    sums[d].total += r.total_counter;
    sums[d].n++;
  }
  return c.json({ from, to, days: dateRange(from, to).length, weekdays: sums.map((s, i) => ({ weekday: i, avg: s.n ? Math.round(s.total / s.n) : null, n: s.n })) });
});

/** Busy hours: average sales in each hour of the day, from POS bills (India time). */
analytics.get("/hours", async (c) => {
  const { from, to } = range(c);
  const { results } = await c.env.DB.prepare(
    `SELECT CAST(strftime('%H', closed_at, '+330 minutes') AS INTEGER) AS hour, COUNT(*) AS bills, SUM(total) AS sales,
            COUNT(DISTINCT business_date) AS days
     FROM pos_bills WHERE status = 'paid' AND business_date BETWEEN ? AND ? GROUP BY hour ORDER BY hour`,
  )
    .bind(from, to)
    .all<{ hour: number; bills: number; sales: number; days: number }>();
  const span = await c.env.DB.prepare("SELECT COUNT(DISTINCT business_date) AS n FROM pos_bills WHERE status = 'paid' AND business_date BETWEEN ? AND ?")
    .bind(from, to)
    .first<{ n: number }>();
  const n = span?.n ?? 0;
  return c.json({
    from, to, days_with_bills: n,
    hours: results.map((r) => ({ hour: r.hour, avg_sales: n ? Math.round(r.sales / n) : 0, avg_bills: n ? Math.round((r.bills / n) * 10) / 10 : 0 })),
  });
});

/** Recent changes across the app, newest first. */
analytics.get("/audit", async (c) => {
  const before = Number(c.req.query("before") ?? 0) || null;
  const table = c.req.query("table");
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.table_name, a.row_id, a.action, a.before, a.after, a.at, u.name AS user_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE (?1 IS NULL OR a.id < ?1) AND (?2 IS NULL OR a.table_name = ?2)
     ORDER BY a.id DESC LIMIT 50`,
  )
    .bind(before, table || null)
    .all();
  return c.json({ entries: results });
});
