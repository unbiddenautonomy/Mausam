import { Hono } from "hono";
import { POS_FIELDS, type PosKind } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { audit } from "../lib/db";
import { isDate as isDateStr } from "../lib/http";
import { HttpError, optionalText } from "../lib/http";
import { applyPosToCloses } from "./entries";

export const pos = new Hono<AppEnv>();
pos.use("*", requireRole("owner"));

const kindOf = (v: unknown): PosKind => {
  if (v !== "sales" && v !== "items") throw new HttpError(422, "invalid", { field: "kind" });
  return v;
};

pos.get("/mappings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT kind, mapping FROM pos_mappings").all<{ kind: string; mapping: string }>();
  return c.json({ mappings: Object.fromEntries(results.map((r) => [r.kind, JSON.parse(r.mapping)])) });
});

/** Mapping is stored as { field: header name } so it survives column order changes. */
pos.put("/mappings/:kind", async (c) => {
  const kind = kindOf(c.req.param("kind"));
  const b = await c.req.json<Record<string, string | null>>();
  const clean = Object.fromEntries(POS_FIELDS[kind].map((f) => [f, typeof b[f] === "string" ? b[f]!.slice(0, 100) : null]));
  await c.env.DB.prepare("INSERT INTO pos_mappings (kind, mapping) VALUES (?, ?) ON CONFLICT (kind) DO UPDATE SET mapping = excluded.mapping")
    .bind(kind, JSON.stringify(clean))
    .run();
  return c.json({ ok: true });
});

pos.get("/imports", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT i.*, u.name AS by_name FROM pos_imports i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.id DESC LIMIT 30",
  ).all();
  return c.json({ imports: results });
});

interface SalesRow { date: string; total: number; cash?: number | null; online?: number | null; bills?: number | null; dine_in?: number | null; parcel?: number | null; discount?: number | null; cancelled?: number | null }
interface ItemRow { date: string; item: string; category?: string | null; qty: number; amount: number }

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Rows arrive already parsed by the browser (dates as YYYY-MM-DD, money in paise). Same date re-imported replaces the old numbers. */
pos.post("/import", async (c) => {
  const b = await c.req.json<{ kind?: unknown; filename?: unknown; rows?: unknown[] }>();
  const kind = kindOf(b.kind);
  if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > 5000) throw new HttpError(422, "invalid", { field: "rows" });
  const db = c.env.DB;
  const user = c.get("user");
  const dates = new Set<string>();
  const stmts: D1PreparedStatement[] = [];

  const imp = await db.prepare("INSERT INTO pos_imports (kind, filename, rows, created_by) VALUES (?, ?, 0, ?)").bind(kind, optionalText(b.filename, 120), user.id).run();
  const importId = Number(imp.meta.last_row_id);

  if (kind === "sales") {
    for (const raw of b.rows as SalesRow[]) {
      if (!isDateStr(raw?.date) || int(raw.total) === null) continue;
      dates.add(raw.date);
      stmts.push(
        db.prepare(
          `INSERT INTO pos_daily (business_date, total, cash, online, bills, dine_in, parcel, discount, cancelled, import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (business_date) DO UPDATE SET total = excluded.total, cash = excluded.cash, online = excluded.online, bills = excluded.bills,
             dine_in = excluded.dine_in, parcel = excluded.parcel, discount = excluded.discount, cancelled = excluded.cancelled, import_id = excluded.import_id`,
        ).bind(raw.date, int(raw.total), int(raw.cash), int(raw.online), int(raw.bills), int(raw.dine_in), int(raw.parcel), int(raw.discount), int(raw.cancelled), importId),
      );
    }
  } else {
    // Combine repeated item lines for the same day before saving.
    const merged = new Map<string, ItemRow>();
    for (const raw of b.rows as ItemRow[]) {
      const item = typeof raw?.item === "string" ? raw.item.trim().slice(0, 120) : "";
      if (!isDateStr(raw?.date) || !item || typeof raw.qty !== "number" || int(raw.amount) === null) continue;
      const key = `${raw.date}|${item.toLowerCase()}`;
      const prev = merged.get(key);
      merged.set(key, prev ? { ...prev, qty: prev.qty + raw.qty, amount: prev.amount + int(raw.amount)! } : { ...raw, item, amount: int(raw.amount)! });
    }
    for (const r of merged.values()) dates.add(r.date);
    // Replace whole days so a re-import doesn't leave stale items behind.
    for (const d of dates) stmts.push(db.prepare("DELETE FROM pos_items WHERE business_date = ?").bind(d));
    for (const r of merged.values()) {
      stmts.push(
        db.prepare("INSERT INTO pos_items (business_date, item, category, qty, amount, import_id) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(r.date, r.item, typeof r.category === "string" ? r.category.slice(0, 60) : null, r.qty, r.amount, importId),
      );
    }
  }
  if (stmts.length === 0) {
    await db.prepare("DELETE FROM pos_imports WHERE id = ?").bind(importId).run();
    throw new HttpError(422, "invalid", { field: "rows" });
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  const sorted = [...dates].sort();
  const saved = kind === "sales" ? stmts.length : stmts.length - dates.size;
  await db.prepare("UPDATE pos_imports SET rows = ?, from_date = ?, to_date = ? WHERE id = ?").bind(saved, sorted[0], sorted.at(-1), importId).run();
  const rechecked = kind === "sales" ? await applyPosToCloses(db, sorted[0], sorted.at(-1)!) : 0;
  await audit(db, "pos_imports", importId, "create", null, { kind, rows: saved, from: sorted[0], to: sorted.at(-1) }, user.id);
  return c.json({ id: importId, rows: saved, from: sorted[0], to: sorted.at(-1), rechecked });
});
