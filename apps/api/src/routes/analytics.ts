import { Hono } from "hono";
import { addDays, businessDate, dateRange } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { isDate } from "../lib/http";
import { rangeTotals } from "../lib/totals";

export const analytics = new Hono<AppEnv>();
analytics.use("*", requireRole("owner"));

function range(c: { req: { query: (k: string) => string | undefined } }) {
  const to = isDate(c.req.query("to")) ? c.req.query("to")! : businessDate();
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 7), 366);
  return { from: addDays(to, -(days - 1)), to, days };
}

/** Where the money went, and food cost % week by week. */
analytics.get("/costs", async (c) => {
  const { from, to } = range(c);
  const totals = await rangeTotals(c.env.DB, from, to);
  // Weeks ending on `to`, oldest first; only full weeks inside the range.
  const weeks: { from: string; to: string; sales: number; food: number; wages: number; left: number }[] = [];
  for (let end = to; addDays(end, -6) >= from; end = addDays(end, -7)) {
    const start = addDays(end, -6);
    const w = await rangeTotals(c.env.DB, start, end);
    weeks.unshift({ from: start, to: end, sales: w.sales, food: w.food, wages: w.wages, left: w.left });
  }
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
