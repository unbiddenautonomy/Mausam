import { Hono } from "hono";
import { addDays, billTotals, businessDate, BILL_PAY_MODES, financialYear, validCounter, waiterCommission, type BillPayMode, type Role } from "@mausam/shared";
import type { AppEnv } from "../env";
import { requireRole, validPin } from "../lib/auth";
import { PIN_COLUMNS, tryPin, type PinUser } from "../lib/pin";
import { audit, auditStmt, bool } from "../lib/db";
import { HttpError, isDate, optionalText, requireText } from "../lib/http";
import { managersCanSee } from "./analytics";
import { applyPosToCloses } from "./entries";
import { alertParams, notify } from "../lib/notify";

/**
 * The touchscreen POS: menu and tables for the counter, and bill sync.
 * The counter works offline and sends finished bills here; a bill's client_id makes re-sending harmless.
 * Mounted at /api/billing (the /api/pos routes are the owner-only Excel import).
 */
export const billing = new Hono<AppEnv>();

const POS_SETTING_KEYS = [
  "pos_gst_rate", "pos_prices_include_tax", "pos_gstin", "pos_bill_header", "pos_bill_footer",
  "pos_use_tables", "pos_use_gst", "pos_printing", "pos_commission_bp", "pos_waiter_required", "pos_bill_copies",
  "pos_discount_limit_pct", "pos_discount_limit_paise",
] as const;
type PosSettingKey = (typeof POS_SETTING_KEYS)[number];

export interface PosSettings {
  gst_rate: number;
  prices_include_tax: boolean;
  gstin: string;
  bill_header: string;
  bill_footer: string;
  /** Show the table map. Off: orders are listed by order number, with an optional table number typed in. */
  use_tables: boolean;
  /** Charge GST (also needs a GSTIN). Off: no tax on any bill. */
  use_gst: boolean;
  /** A receipt printer is connected. Off: bills and kitchen tickets are shown on screen only. */
  printing: boolean;
  /** Default waiter commission, basis points (250 = 2.5%). A waiter's own rate wins. */
  commission_bp: number;
  /** A dine-in order needs a waiter before it can be paid. */
  waiter_required: boolean;
  /** How many copies of a bill print at Save & Print (the second goes to the kitchen). Reprints print one. */
  bill_copies: number;
  /** The biggest discount staff may give on their own, as a % of the bill. More needs a manager's or the owner's PIN. 100 = no limit. */
  discount_limit_pct: number;
  /** The biggest discount staff may give on their own, in paise (10000 = ₹100). 0 = no rupee limit. Over this or the % needs a PIN. */
  discount_limit_paise: number;
}

async function loadPosSettings(db: D1Database): Promise<PosSettings> {
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${POS_SETTING_KEYS.map(() => "?").join(",")})`)
    .bind(...POS_SETTING_KEYS)
    .all<{ key: PosSettingKey; value: string }>();
  const m = Object.fromEntries(results.map((r) => [r.key, r.value])) as Partial<Record<PosSettingKey, string>>;
  return {
    gst_rate: Number(m.pos_gst_rate ?? 500) || 0,
    prices_include_tax: (m.pos_prices_include_tax ?? "1") === "1",
    gstin: m.pos_gstin ?? "",
    bill_header: m.pos_bill_header ?? "Mausam Restaurant",
    bill_footer: m.pos_bill_footer ?? "",
    use_tables: m.pos_use_tables === "1",
    use_gst: m.pos_use_gst === "1",
    printing: m.pos_printing === "1",
    commission_bp: Number(m.pos_commission_bp ?? 0) || 0,
    waiter_required: (m.pos_waiter_required ?? "1") === "1",
    bill_copies: Math.min(Math.max(Number(m.pos_bill_copies ?? 2) || 2, 1), 3),
    discount_limit_pct: Math.min(Math.max(Number(m.pos_discount_limit_pct ?? 100) || 0, 0), 100),
    discount_limit_paise: Math.max(Number(m.pos_discount_limit_paise ?? 0) || 0, 0),
  };
}

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** A variation or add-on on a menu item: its name and price in paise (an add-on's price is added to the item's). */
export interface ItemOption { name: string; price: number }

/** Reads the JSON stored in menu_items.variations / addons. Anything malformed is treated as none. */
function parseOptions(raw: unknown): ItemOption[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v.filter((o) => o && typeof o.name === "string" && Number.isInteger(o.price)) : null;
  } catch {
    return null;
  }
}

/** Checks variations or add-ons sent by the owner and returns the JSON to store (null = none). */
function optionsField(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (!Array.isArray(v) || v.length > 20) throw new HttpError(422, "invalid", { field });
  const out: ItemOption[] = [];
  for (const o of v as { name?: unknown; price?: unknown }[]) {
    const name = typeof o?.name === "string" ? o.name.trim().slice(0, 40) : "";
    const price = int(o?.price, 0, 1e8);
    if (!name || price === null) throw new HttpError(422, "invalid", { field });
    out.push({ name, price });
  }
  return out.length ? JSON.stringify(out) : null;
}

const withOptions = <T extends Record<string, unknown>>(rows: T[]) =>
  rows.map((r) => ({ ...r, variations: parseOptions(r.variations), addons: parseOptions(r.addons) }));

/* ---------------- For the counter (owner, manager, staff) ---------------- */

/** Everything the counter needs to bill offline. */
billing.get("/config", async (c) => {
  const db = c.env.DB;
  const [cats, items, tables, waiters, settings, approvers] = await Promise.all([
    db.prepare("SELECT id, name, name_hi, name_kn, sort FROM menu_categories WHERE active = 1 ORDER BY sort, name").all(),
    db.prepare("SELECT id, category_id, name, name_hi, name_kn, short_name, price, tax_rate, veg, favourite, sort, variations, addons FROM menu_items WHERE active = 1 ORDER BY sort, name").all<Record<string, unknown>>(),
    db.prepare("SELECT id, area, name, seats, sort FROM dining_tables WHERE active = 1 ORDER BY sort, area, name").all(),
    db.prepare("SELECT id, name, name_local, waiter_code FROM staff WHERE active = 1 AND is_waiter = 1 ORDER BY CAST(waiter_code AS INTEGER), waiter_code, name").all(),
    loadPosSettings(db),
    // Who can allow a discount above the staff limit with their PIN.
    db.prepare("SELECT id, name FROM users WHERE active = 1 AND role IN ('owner', 'manager') ORDER BY role DESC, name").all(),
  ]);
  return c.json({
    categories: cats.results,
    items: withOptions(items.results),
    tables: tables.results,
    waiters: waiters.results,
    approvers: approvers.results,
    settings,
    business_date: businessDate(),
    server_time: new Date().toISOString(),
  });
});

interface LineIn { item_id?: unknown; name?: unknown; category?: unknown; qty?: unknown; price?: unknown; tax_rate?: unknown; note?: unknown; variation?: unknown; modifier?: unknown }
interface BillIn {
  client_id?: unknown; bill_no?: unknown; counter?: unknown; business_date?: unknown; order_type?: unknown;
  table_id?: unknown; table_name?: unknown; token?: unknown; waiter_staff_id?: unknown; guests?: unknown;
  discount?: unknown; prices_include_tax?: unknown; total?: unknown; status?: unknown; cancel_reason?: unknown;
  opened_at?: unknown; closed_at?: unknown; lines?: unknown; payments?: unknown; voids?: unknown;
  discount_reason?: unknown; discount_approved_by?: unknown; printed_no?: unknown;
}

type Result = { client_id: string; status: "saved" | "duplicate" | "rejected"; error?: string; bill_no?: string };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const BILL_NO_RE = /^[A-Z0-9]{1,3}\d{4}-\d{5}$/;

/** Checks one bill from the counter and returns the statements that save it, or a reason it's refused. */
interface WaiterInfo { name: string; is_waiter: number; commission_bp: number | null }
interface BillCtx {
  waiters: Map<number, WaiterInfo>; defaultBp: number; discountLimitPct: number; discountLimitPaise: number;
  /** Every price a menu item can be billed at today: its own or a variation's, with or without each add-on. */
  prices: Map<number, Set<number>>;
  /** The business day now, for spotting bills dated in the future or more than a week back. */
  today: string;
}

/** Loads what the bill check needs: staff names and commission rates, the menu's prices, and the discount limit. */
async function billCtx(db: D1Database): Promise<BillCtx> {
  const [{ results }, settings, menu] = await Promise.all([
    db.prepare("SELECT id, name, is_waiter, commission_bp FROM staff").all<WaiterInfo & { id: number }>(),
    loadPosSettings(db),
    db.prepare("SELECT id, price, variations, addons FROM menu_items").all<{ id: number; price: number; variations: string | null; addons: string | null }>(),
  ]);
  const prices = new Map<number, Set<number>>();
  for (const m of menu.results) {
    const variations = parseOptions(m.variations) ?? [];
    const bases = variations.length ? [m.price, ...variations.map((v) => v.price)] : [m.price];
    const extras = [0, ...(parseOptions(m.addons) ?? []).map((a) => a.price)];
    prices.set(m.id, new Set(bases.flatMap((p) => extras.map((x) => p + x))));
  }
  return {
    waiters: new Map(results.map((r) => [r.id, r])), defaultBp: settings.commission_bp, discountLimitPct: settings.discount_limit_pct,
    discountLimitPaise: settings.discount_limit_paise,
    prices, today: businessDate(),
  };
}

/**
 * Things on a bill the owner should look at. A flag never refuses a bill: it's a real sale.
 * - price_changed: a line's price isn't one the menu has for that item (now). Menu prices can change in a day.
 * - odd_date: the bill's business day is in the future or more than 7 days back.
 * - discount_over_limit: staff gave a discount above the limit with no manager's or owner's PIN (the POS was offline).
 */
function billFlags(
  b: { business_date: string; discount: number; subtotal: number; approvedBy: number | null; lines: { item_id: number | null; price: number }[] },
  role: Role, ctx: BillCtx,
): string[] {
  const flags: string[] = [];
  if (b.lines.some((l) => l.item_id !== null && ctx.prices.has(l.item_id) && !ctx.prices.get(l.item_id)!.has(l.price))) flags.push("price_changed");
  if (b.business_date > ctx.today || b.business_date < addDays(ctx.today, -7)) flags.push("odd_date");
  const overPct = ctx.discountLimitPct < 100 && b.discount > Math.round((b.subtotal * ctx.discountLimitPct) / 100);
  const overRupees = ctx.discountLimitPaise > 0 && b.discount > ctx.discountLimitPaise;
  if (role === "staff" && (overPct || overRupees) && b.approvedBy === null) flags.push("discount_over_limit");
  return flags;
}

function prepareBill(db: D1Database, b: BillIn, user: { id: number; role: Role }, ctx: BillCtx): { stmts: D1PreparedStatement[]; date: string } | { error: string } {
  const userId = user.id;
  if (typeof b.client_id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(b.client_id)) return { error: "client_id" };
  if (!validCounter(b.counter)) return { error: "counter" };
  if (typeof b.bill_no !== "string" || !BILL_NO_RE.test(b.bill_no) || !b.bill_no.startsWith(b.counter)) return { error: "bill_no" };
  if (!isDate(b.business_date)) return { error: "business_date" };
  if (b.order_type !== "dine_in" && b.order_type !== "parcel") return { error: "order_type" };
  if (b.status !== "paid" && b.status !== "cancelled") return { error: "status" };
  if (typeof b.opened_at !== "string" || !ISO_RE.test(b.opened_at) || typeof b.closed_at !== "string" || !ISO_RE.test(b.closed_at)) return { error: "time" };
  const tableId = b.table_id == null ? null : int(b.table_id, 1, 1e9);
  if (b.table_id != null && tableId === null) return { error: "table_id" };
  const waiterId = b.waiter_staff_id == null ? null : int(b.waiter_staff_id, 1, 1e9);
  // A waiter removed from staff since the bill was made is dropped rather than refusing the bill.
  const waiterInfo = waiterId === null ? undefined : ctx.waiters.get(waiterId);
  const waiter = waiterInfo ? waiterId : null;
  const token = b.token == null ? null : int(b.token, 1, 1e9);
  const guests = b.guests == null ? null : int(b.guests, 0, 500);
  const discount = b.discount == null ? 0 : int(b.discount, 0, 1e10);
  if (discount === null) return { error: "discount" };
  const include = b.prices_include_tax === undefined ? true : bool(b.prices_include_tax);

  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 200) return { error: "lines" };
  const lines: { item_id: number | null; name: string; category: string | null; qty: number; price: number; tax_rate: number; note: string | null; variation: string | null; modifier: string | null }[] = [];
  for (const l of b.lines as LineIn[]) {
    const qty = int(l?.qty, 1, 999);
    const price = int(l?.price, 0, 1e8);
    const rate = int(l?.tax_rate ?? 0, 0, 2800);
    if (qty === null || price === null || rate === null || typeof l.name !== "string" || !l.name.trim()) return { error: "line" };
    lines.push({
      item_id: l.item_id == null ? null : int(l.item_id, 1, 1e9),
      name: l.name.trim().slice(0, 120),
      category: typeof l.category === "string" ? l.category.slice(0, 80) : null,
      qty, price, tax_rate: rate,
      note: typeof l.note === "string" && l.note.trim() ? l.note.trim().slice(0, 200) : null,
      variation: typeof l.variation === "string" && l.variation.trim() ? l.variation.trim().slice(0, 40) : null,
      modifier: typeof l.modifier === "string" && l.modifier.trim() ? l.modifier.trim().slice(0, 40) : null,
    });
  }
  const totals = billTotals(lines, discount, include);
  if (b.total !== totals.total) return { error: "total_mismatch" };

  const payments: { mode: BillPayMode; amount: number }[] = [];
  if (b.status === "paid") {
    if (!Array.isArray(b.payments) || b.payments.length === 0 || b.payments.length > 6) return { error: "payments" };
    for (const p of b.payments as { mode?: unknown; amount?: unknown }[]) {
      const amount = int(p?.amount, 1, 1e10);
      if (!BILL_PAY_MODES.includes(p?.mode as BillPayMode) || amount === null) return { error: "payments" };
      payments.push({ mode: p.mode as BillPayMode, amount });
    }
    if (payments.reduce((s, p) => s + p.amount, 0) !== totals.total) return { error: "payments_total" };
  }
  // Waiter commission: a % of what the guest paid, before GST. Cancelled bills earn nothing.
  const commissionBp = b.status === "paid" && waiterInfo?.is_waiter ? waiterInfo.commission_bp ?? ctx.defaultBp : null;
  const commission = commissionBp ? waiterCommission(totals.total - totals.tax, commissionBp) : 0;

  const reason = optionalText(b.cancel_reason, 200);
  if (b.status === "cancelled" && !reason) return { error: "cancel_reason" };
  const voids = voidsOf(b.voids);
  const discountReason = totals.discount > 0 ? optionalText(b.discount_reason, 40) : null;
  const approvedBy = totals.discount > 0 && b.discount_approved_by != null ? int(b.discount_approved_by, 1, 1e9) : null;
  const flags = billFlags({ business_date: b.business_date, discount: totals.discount, subtotal: totals.subtotal, approvedBy, lines }, user.role, ctx);

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO pos_bills (client_id, bill_no, counter, business_date, order_type, table_id, table_name, token, waiter_staff_id, guests,
         subtotal, discount, tax, round_off, total, prices_include_tax, status, cancel_reason, opened_at, closed_at, created_by,
         waiter_name, commission_bp, commission, discount_reason, discount_approved_by, flags, printed_bill_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      b.client_id, b.bill_no, b.counter, b.business_date, b.order_type, tableId, optionalText(b.table_name, 40), token, waiter, guests,
      totals.subtotal, totals.discount, totals.tax, totals.round_off, totals.total, include ? 1 : 0, b.status, b.status === "cancelled" ? reason : null,
      b.opened_at, b.closed_at, userId, waiterInfo?.name ?? null, commissionBp, commission, discountReason, approvedBy,
      flags.length ? JSON.stringify(flags) : null,
      typeof b.printed_no === "string" && BILL_NO_RE.test(b.printed_no) && b.printed_no !== b.bill_no ? b.printed_no : null,
    ),
    ...lines.map((l) =>
      db.prepare(
        `INSERT INTO pos_bill_items (bill_id, item_id, name, category, qty, price, tax_rate, amount, note, variation, modifier)
         VALUES ((SELECT id FROM pos_bills WHERE client_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(b.client_id, l.item_id, l.name, l.category, l.qty, l.price, l.tax_rate, l.price * l.qty, l.note, l.variation, l.modifier),
    ),
    ...payments.map((p) =>
      db.prepare("INSERT INTO pos_payments (bill_id, mode, amount) VALUES ((SELECT id FROM pos_bills WHERE client_id = ?), ?, ?)").bind(b.client_id, p.mode, p.amount),
    ),
    // A bill the server refused before and the POS sent again: it's sorted now.
    db.prepare("UPDATE pos_bill_rejects SET resolved_at = datetime('now') WHERE client_id = ? AND resolved_at IS NULL").bind(b.client_id),
    ...voids.map((v) =>
      db.prepare(
        `INSERT INTO pos_bill_voids (bill_id, name, variation, qty, price, stage, removed_at, removed_by)
         VALUES ((SELECT id FROM pos_bills WHERE client_id = ?), ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(b.client_id, v.name, v.variation, v.qty, v.price, v.stage, v.at, v.by),
    ),
  ];
  return { stmts, date: b.business_date };
}

interface VoidRow { name: string; variation: string | null; qty: number; price: number; stage: "kitchen" | "billed"; at: string; by: number | null }

/**
 * Items taken off after the kitchen got them or the bill was printed. Optional, and never a reason to refuse a bill:
 * an entry that doesn't make sense is skipped. At most 200 are kept.
 */
function voidsOf(raw: unknown): VoidRow[] {
  if (!Array.isArray(raw)) return [];
  const out: VoidRow[] = [];
  for (const v of raw.slice(-200) as Record<string, unknown>[]) {
    const qty = int(v?.qty, 1, 999);
    const price = int(v?.price, 0, 1e8);
    if (qty === null || price === null || typeof v.name !== "string" || !v.name.trim()) continue;
    if (v.stage !== "kitchen" && v.stage !== "billed") continue;
    out.push({
      name: v.name.trim().slice(0, 120),
      variation: typeof v.variation === "string" && v.variation.trim() ? v.variation.trim().slice(0, 40) : null,
      qty, price, stage: v.stage,
      at: typeof v.at === "string" && ISO_RE.test(v.at) ? v.at : new Date().toISOString(),
      by: v.by == null ? null : int(v.by, 1, 1e9),
    });
  }
  return out;
}

/**
 * The statements that rebuild a day's POS figures (pos_daily, pos_items) from Mausam POS bills, so the closing
 * check and the reports pick them up exactly as they do an Excel import. Rows that haven't changed are left alone,
 * so a busy day doesn't rewrite every item row on every bill (the free plan allows 100,000 row writes a day).
 */
function posDayStatements(db: D1Database, date: string): D1PreparedStatement[] {
  return [
    db.prepare(
      `INSERT INTO pos_daily (business_date, total, cash, online, bills, dine_in, parcel, discount, cancelled, import_id, source)
       SELECT ?1,
         COALESCE(SUM(CASE WHEN b.status = 'paid' THEN b.total END), 0),
         COALESCE((SELECT SUM(p.amount) FROM pos_payments p JOIN pos_bills x ON x.id = p.bill_id WHERE x.business_date = ?1 AND x.status = 'paid' AND p.mode = 'cash'), 0),
         COALESCE((SELECT SUM(p.amount) FROM pos_payments p JOIN pos_bills x ON x.id = p.bill_id WHERE x.business_date = ?1 AND x.status = 'paid' AND p.mode != 'cash'), 0),
         COUNT(CASE WHEN b.status = 'paid' THEN 1 END),
         COALESCE(SUM(CASE WHEN b.status = 'paid' AND b.order_type = 'dine_in' THEN b.total END), 0),
         COALESCE(SUM(CASE WHEN b.status = 'paid' AND b.order_type = 'parcel' THEN b.total END), 0),
         COALESCE(SUM(CASE WHEN b.status = 'paid' THEN b.discount END), 0),
         COALESCE(SUM(CASE WHEN b.status = 'cancelled' THEN b.total END), 0),
         NULL, 'pos'
       FROM pos_bills b WHERE b.business_date = ?1
       ON CONFLICT (business_date) DO UPDATE SET total = excluded.total, cash = excluded.cash, online = excluded.online, bills = excluded.bills,
         dine_in = excluded.dine_in, parcel = excluded.parcel, discount = excluded.discount, cancelled = excluded.cancelled,
         import_id = NULL, source = 'pos'
       WHERE pos_daily.total IS NOT excluded.total OR pos_daily.cash IS NOT excluded.cash OR pos_daily.online IS NOT excluded.online
         OR pos_daily.bills IS NOT excluded.bills OR pos_daily.dine_in IS NOT excluded.dine_in OR pos_daily.parcel IS NOT excluded.parcel
         OR pos_daily.discount IS NOT excluded.discount OR pos_daily.cancelled IS NOT excluded.cancelled
         OR pos_daily.import_id IS NOT NULL OR pos_daily.source IS NOT 'pos'`,
    ).bind(date),
    // Items no longer sold that day (an imported day, or a bill since cancelled) go; the rest are updated only if they changed.
    db.prepare(
      `DELETE FROM pos_items WHERE business_date = ?1 AND item NOT IN (
         SELECT i.name || COALESCE(' [' || i.variation || ']', '') FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id
         WHERE b.business_date = ?1 AND b.status = 'paid')`,
    ).bind(date),
    db.prepare(
      `INSERT INTO pos_items (business_date, item, category, qty, amount, import_id)
       SELECT b.business_date, i.name || COALESCE(' [' || i.variation || ']', ''), MAX(i.category), SUM(i.qty), SUM(i.amount), NULL
       FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id
       WHERE b.business_date = ?1 AND b.status = 'paid'
       GROUP BY i.name, i.variation
       ON CONFLICT (business_date, item) DO UPDATE SET category = excluded.category, qty = excluded.qty, amount = excluded.amount, import_id = NULL
       WHERE pos_items.qty IS NOT excluded.qty OR pos_items.amount IS NOT excluded.amount
         OR pos_items.category IS NOT excluded.category OR pos_items.import_id IS NOT NULL`,
    ).bind(date),
  ];
}

/**
 * Bills saved per request. The free plan allows 50 database calls per request; saving all of them in one batch
 * keeps a request to about 8 calls, and 20 keeps the batch small. Screens that send more get results for the
 * first 20 and send the rest next time.
 */
const BILLS_PER_REQUEST = 20;

/** Send finished bills. Each one is saved, recognised as already saved, or refused with a reason. */
/**
 * A manager or the owner allows a discount above the staff limit by typing their PIN on the POS. Wrong PINs count
 * towards their account lock, like wrong logins. The bill then carries discount_approved_by.
 */
billing.post("/discount-approval", requireRole("owner", "manager", "staff"), async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const id = int(b.approver_id, 1, 1e9);
  if (id === null || !validPin(b.pin)) throw new HttpError(403, "wrong_pin");
  const approver = await c.env.DB.prepare(`SELECT ${PIN_COLUMNS} FROM users WHERE id = ? AND active = 1 AND role IN ('owner', 'manager')`)
    .bind(id)
    .first<PinUser>();
  if (!approver) throw new HttpError(403, "wrong_pin");
  const check = await tryPin(c.env, approver, b.pin);
  if (check === "locked") throw new HttpError(429, "too_many_tries");
  if (check === "wrong") throw new HttpError(403, "wrong_pin");
  return c.json({ ok: true, id: approver.id, name: approver.name });
});

billing.post("/bills", requireRole("owner", "manager", "staff"), async (c) => {
  const body = await c.req.json<{ bills?: unknown; counter?: unknown; device?: unknown }>();
  if (!Array.isArray(body.bills) || body.bills.length === 0 || body.bills.length > 50) throw new HttpError(422, "invalid", { field: "bills" });
  const db = c.env.DB;
  const user = c.get("user");
  const list = (body.bills as BillIn[]).slice(0, BILLS_PER_REQUEST);
  const clientIds = list.map((b) => (typeof b?.client_id === "string" ? b.client_id : "")).filter(Boolean);

  const [ctx, { results: found }] = await Promise.all([
    billCtx(db),
    db.prepare("SELECT client_id, bill_no, business_date FROM pos_bills WHERE client_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(clientIds))
      .all<{ client_id: string; bill_no: string; business_date: string }>(),
  ]);
  const existing = new Map(found.map((r) => [r.client_id, r]));

  const results: Result[] = [];
  const toSave: { index: number; clientId: string; billNo: string; date: string; stmts: D1PreparedStatement[] }[] = [];
  const seen = new Set<string>();
  // Days to rebuild. Days of re-sent bills are included too, so a day whose totals were missed gets repaired.
  const dates = new Set<string>();
  for (const raw of list) {
    const clientId = typeof raw?.client_id === "string" ? raw.client_id : "";
    const had = existing.get(clientId);
    if (had) {
      results.push({ client_id: clientId, status: "duplicate", bill_no: had.bill_no });
      dates.add(had.business_date);
      continue;
    }
    if (clientId && seen.has(clientId)) {
      results.push({ client_id: clientId, status: "duplicate", bill_no: String(raw.bill_no) });
      continue;
    }
    const prepared = prepareBill(db, raw ?? {}, user, ctx);
    if ("error" in prepared) {
      results.push({ client_id: clientId, status: "rejected", error: prepared.error });
      continue;
    }
    seen.add(clientId);
    toSave.push({ index: results.length, clientId, billNo: String(raw.bill_no), date: prepared.date, stmts: prepared.stmts });
    results.push({ client_id: clientId, status: "saved", bill_no: String(raw.bill_no) });
  }
  for (const b of toSave) dates.add(b.date);
  const dayStmts = [...dates].flatMap((d) => posDayStatements(db, d));

  if (toSave.length) {
    try {
      // One batch is one transaction: the bills and the day totals are saved together, or not at all.
      await db.batch([...toSave.flatMap((b) => b.stmts), ...dayStmts]);
    } catch {
      // Something in the batch was refused (usually a bill number already used): save the bills one by one.
      for (const b of toSave) {
        try {
          await db.batch(b.stmts);
        } catch (e) {
          const msg = String(e);
          results[b.index] = { client_id: b.clientId, status: "rejected", error: msg.includes("bill_no") ? "duplicate_number" : "save_failed" };
          if (!msg.includes("UNIQUE")) console.error(JSON.stringify({ msg: "bill_save_failed", client_id: b.clientId, error: msg }));
        }
      }
      await db.batch(dayStmts);
    }
  } else if (dayStmts.length) {
    await db.batch(dayStmts);
  }

  const savedDates = [...new Set(toSave.filter((b) => results[b.index].status === "saved").map((b) => b.date))].sort();
  if (savedDates.length) await applyPosToCloses(db, savedDates[0], savedDates.at(-1)!, user.id);
  // The counter was seen. A device set up offline claims its letter here, if nobody holds it.
  let counterTaken = false;
  if (validCounter(body.counter)) {
    const last = results.filter((r) => r.status === "saved").at(-1)?.bill_no ?? null;
    const device = validDevice(body.device) ? body.device : null;
    const now = new Date().toISOString();
    const row = await db
      .prepare(
        `INSERT INTO pos_counters (code, last_seen_at, last_bill_no, device_id, claimed_at) VALUES (?1, ?2, ?3, ?4, CASE WHEN ?4 IS NULL THEN NULL ELSE ?2 END)
         ON CONFLICT (code) DO UPDATE SET last_seen_at = excluded.last_seen_at, last_bill_no = COALESCE(excluded.last_bill_no, pos_counters.last_bill_no),
           claimed_at = CASE WHEN pos_counters.device_id IS NULL THEN excluded.claimed_at ELSE pos_counters.claimed_at END,
           device_id = COALESCE(pos_counters.device_id, excluded.device_id)
         RETURNING device_id`,
      )
      .bind(body.counter, now, last, device)
      .first<{ device_id: string | null }>();
    counterTaken = !!device && !!row?.device_id && row.device_id !== device;
  }
  // Bills are saved either way (they're real sales); a device told its letter is taken must pick another.
  return c.json({ results, ...(counterTaken ? { counter_taken: true } : {}) });
});

/**
 * The POS reports bills the server refused (with the reason), so the owner can see them on the bills page. Reporting
 * the same bill again updates it. A bill that is later saved is marked sorted.
 */
billing.post("/rejects", requireRole("owner", "manager", "staff"), async (c) => {
  const body = await c.req.json<{ rejects?: unknown }>();
  if (!Array.isArray(body.rejects) || body.rejects.length === 0 || body.rejects.length > 20) throw new HttpError(422, "invalid", { field: "rejects" });
  const db = c.env.DB;
  const user = c.get("user");
  const stmts: D1PreparedStatement[] = [];
  for (const r of body.rejects as { bill?: BillIn; reason?: unknown }[]) {
    const b = r?.bill;
    if (!b || typeof b.client_id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(b.client_id)) continue;
    const data = JSON.stringify(b);
    if (data.length > 64_000) continue;
    stmts.push(
      db.prepare(
        `INSERT INTO pos_bill_rejects (client_id, bill_no, counter, business_date, total, reason, data, reported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (client_id) DO UPDATE SET reason = excluded.reason, data = excluded.data, bill_no = excluded.bill_no,
           reported_at = datetime('now'), reported_by = excluded.reported_by
         WHERE pos_bill_rejects.resolved_at IS NULL`,
      ).bind(
        b.client_id, typeof b.bill_no === "string" ? b.bill_no.slice(0, 20) : null, typeof b.counter === "string" ? b.counter.slice(0, 3) : null,
        isDate(b.business_date) ? b.business_date : null, typeof b.total === "number" ? Math.round(b.total) : null,
        optionalText(r.reason, 40) ?? "rejected", data, user.id,
      ),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return c.json({ ok: true, saved: stmts.length });
});

/** The highest bill number this counter has synced, so a reinstalled counter carries on from it. */
billing.get("/counters/:code/last", requireRole("owner", "manager", "staff"), async (c) => {
  const code = c.req.param("code");
  if (!validCounter(code)) throw new HttpError(422, "invalid", { field: "code" });
  // By number, not by the counter that sent it: another screen may have taken payment for this counter's bill.
  // This financial year only, since numbers restart on 1 April ("A2627-%" also keeps counter A apart from AB).
  const prefix = `${code}${financialYear(businessDate())}-`;
  const row = await c.env.DB.prepare("SELECT bill_no FROM pos_bills WHERE bill_no LIKE ? ORDER BY bill_no DESC LIMIT 1").bind(`${prefix}%`).first<{ bill_no: string }>();
  return c.json({ last_bill_no: row?.bill_no ?? null });
});

/** A POS device's own random id, made once and kept on the device. */
function validDevice(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);
}

/** A counter letter held by a device that sent nothing for this long is free to take. */
const COUNTER_IDLE_DAYS = 30;

/**
 * A device takes a counter letter when it's set up. Refused with 409 counter_taken while another device holds it and
 * has used it in the last 30 days; the owner can release a letter (for a reinstalled or replaced device).
 */
billing.post("/counters/:code/claim", requireRole("owner", "manager", "staff"), async (c) => {
  const code = c.req.param("code");
  if (!validCounter(code)) throw new HttpError(422, "invalid", { field: "code" });
  const body = await c.req.json<{ device?: unknown }>();
  if (!validDevice(body.device)) throw new HttpError(422, "invalid", { field: "device" });
  const db = c.env.DB;
  const row = await db.prepare("SELECT device_id, last_seen_at, claimed_at FROM pos_counters WHERE code = ?").bind(code)
    .first<{ device_id: string | null; last_seen_at: string | null; claimed_at: string | null }>();
  const cutoff = new Date(Date.now() - COUNTER_IDLE_DAYS * 86_400_000).toISOString();
  const lastUsed = [row?.last_seen_at, row?.claimed_at].filter(Boolean).sort().at(-1) ?? "";
  if (row?.device_id && row.device_id !== body.device && lastUsed > cutoff) throw new HttpError(409, "counter_taken");
  await db.prepare(
    `INSERT INTO pos_counters (code, device_id, claimed_at) VALUES (?, ?, ?)
     ON CONFLICT (code) DO UPDATE SET device_id = excluded.device_id, claimed_at = excluded.claimed_at`,
  ).bind(code, body.device, new Date().toISOString()).run();
  return c.json({ ok: true });
});

/** The letters a device can be given without asking: A to Z, in order. */
const AUTO_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Gives this device a counter letter, nobody asked: the letter it already holds, else the first letter nobody holds
 * (or whose device sent nothing for 30 days). Letters only keep bill numbers apart between screens billing offline,
 * so which one a device gets doesn't matter, and a closed tab or an old test device never blocks a new one.
 */
billing.post("/counters/auto", requireRole("owner", "manager", "staff"), async (c) => {
  const body = await c.req.json<{ device?: unknown }>();
  if (!validDevice(body.device)) throw new HttpError(422, "invalid", { field: "device" });
  const device = body.device;
  const db = c.env.DB;
  const mine = await db.prepare("SELECT code FROM pos_counters WHERE device_id = ? ORDER BY code LIMIT 1").bind(device).first<{ code: string }>();
  if (mine) return c.json({ code: mine.code });
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - COUNTER_IDLE_DAYS * 86_400_000).toISOString();
  for (const code of AUTO_LETTERS) {
    // Takes the letter only if it's still free when written, so two devices starting together get different ones.
    const r = await db.prepare(
      `INSERT INTO pos_counters (code, device_id, claimed_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (code) DO UPDATE SET device_id = excluded.device_id, claimed_at = excluded.claimed_at
       WHERE pos_counters.device_id IS NULL OR pos_counters.device_id = excluded.device_id
         OR MAX(COALESCE(pos_counters.last_seen_at, ''), COALESCE(pos_counters.claimed_at, '')) < ?4`,
    ).bind(code, device, now, cutoff).run();
    if (r.meta.changes > 0) return c.json({ code });
  }
  throw new HttpError(409, "counter_taken");
});

/** Owner: the counter letters, which are held by a device, and when each was last used. */
billing.get("/counters", requireRole("owner"), async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT code, last_seen_at, last_bill_no, claimed_at, device_id IS NOT NULL AS held FROM pos_counters ORDER BY code",
  ).all();
  return c.json({ counters: results });
});

/** Owner: frees a counter letter, so another (or a reinstalled) device can take it. */
billing.post("/counters/:code/release", requireRole("owner"), async (c) => {
  const code = c.req.param("code");
  if (!validCounter(code)) throw new HttpError(422, "invalid", { field: "code" });
  const db = c.env.DB;
  const before = await db.prepare("SELECT code, device_id, claimed_at FROM pos_counters WHERE code = ?").bind(code).first();
  await db.prepare("UPDATE pos_counters SET device_id = NULL, claimed_at = NULL WHERE code = ?").bind(code).run();
  if (before) await audit(db, "pos_counters", 0, "update", before, { code, device_id: null }, c.get("user").id);
  return c.json({ ok: true });
});

/* ---------------- Several POS screens: shared running orders and one token counter ---------------- */

const ORDER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** The routes below are for everyone who uses the POS: the owner, managers and employees. */
const anyPosUser = requireRole("owner", "manager", "staff");

async function tokenLast(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'pos_token_last'").first<{ value: string }>();
  return Number(r?.value ?? 0) || 0;
}

/**
 * The next token number, for any screen. Tokens keep counting and never restart. `min` is the highest token the
 * screen has seen (it may have handed some out while offline), so the count never goes backwards.
 */
billing.post("/tokens/next", anyPosUser, async (c) => {
  const b = await c.req.json<{ min?: unknown }>().catch(() => ({} as { min?: unknown }));
  const min = int(b.min ?? 0, 0, 1e9) ?? 0;
  const row = await c.env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('pos_token_last', CAST(?1 + 1 AS TEXT))
     ON CONFLICT (key) DO UPDATE SET value = CAST(MAX(CAST(value AS INTEGER), ?1) + 1 AS TEXT)
     RETURNING value`,
  ).bind(min).first<{ value: string }>();
  return c.json({ token: Number(row?.value) });
});

interface OrderIn { id?: unknown; updated_at?: unknown; closed?: unknown; data?: unknown }
interface OrderRow { id: string; data: string; updated_at: string; closed: number; seq: number }

/**
 * A screen sends the running orders it changed (and the ones it closed), and gets back every change since `since`.
 * The newest change to an order wins; once any screen closes an order, it stays closed.
 */
billing.post("/orders/sync", anyPosUser, async (c) => {
  const body = await c.req.json<{ counter?: unknown; since?: unknown; last_token?: unknown; orders?: unknown }>();
  const db = c.env.DB;
  const since = int(body.since ?? 0, 0, 1e15) ?? 0;
  const counter = validCounter(body.counter) ? body.counter : null;
  const list = Array.isArray(body.orders) ? (body.orders as OrderIn[]) : [];
  if (list.length > 100) throw new HttpError(422, "invalid", { field: "orders" });

  const stmts: D1PreparedStatement[] = [];
  const ids: string[] = [];
  let maxToken = int(body.last_token ?? 0, 0, 1e9) ?? 0;
  for (const o of list) {
    if (typeof o?.id !== "string" || !ORDER_ID_RE.test(o.id)) throw new HttpError(422, "invalid", { field: "id" });
    if (typeof o.updated_at !== "string" || !ISO_RE.test(o.updated_at)) throw new HttpError(422, "invalid", { field: "updated_at" });
    const closed = o.closed === true;
    let data = "{}";
    if (!closed) {
      if (!o.data || typeof o.data !== "object" || Array.isArray(o.data)) throw new HttpError(422, "invalid", { field: "data" });
      data = JSON.stringify(o.data);
      if (data.length > 64_000) throw new HttpError(422, "invalid", { field: "data" });
      const tok = int((o.data as { token?: unknown }).token ?? 0, 0, 1e9) ?? 0;
      if (tok > maxToken) maxToken = tok;
    }
    ids.push(o.id);
    stmts.push(
      db.prepare(
        `INSERT INTO pos_open_orders (id, data, updated_at, closed, counter, seq)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM pos_open_orders))
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, closed = excluded.closed,
           counter = excluded.counter, seq = excluded.seq, saved_at = datetime('now')
         WHERE pos_open_orders.closed = 0 AND (excluded.closed = 1 OR excluded.updated_at > pos_open_orders.updated_at)`,
      ).bind(o.id, data, o.updated_at, closed ? 1 : 0, counter),
    );
  }
  if (stmts.length) await db.batch(stmts);

  // Keep the shared token counter at least as high as any token a screen has used (e.g. while offline).
  let last = await tokenLast(db);
  if (maxToken > last) {
    await db.prepare("UPDATE settings SET value = CAST(MAX(CAST(value AS INTEGER), ?) AS TEXT) WHERE key = 'pos_token_last'").bind(maxToken).run();
    last = maxToken;
  }
  // Closed orders are only needed until every screen has seen them.
  if (Math.random() < 0.02) await db.prepare("DELETE FROM pos_open_orders WHERE closed = 1 AND saved_at < datetime('now', '-3 days')").run();

  // What changed since this screen last asked (a new screen gets just the open orders), plus the current
  // state of every order it sent, in case another screen's change was newer.
  const { results: changed } = await db
    .prepare("SELECT id, data, updated_at, closed, seq FROM pos_open_orders WHERE seq > ?1 AND (?1 > 0 OR closed = 0) ORDER BY seq LIMIT 500")
    .bind(since)
    .all<OrderRow>();
  const sent = ids.length
    ? (await db.prepare("SELECT id, data, updated_at, closed, seq FROM pos_open_orders WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<OrderRow>()).results
    : [];
  const top = since === 0 && changed.length < 500
    ? (await db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM pos_open_orders").first<{ m: number }>())?.m ?? 0
    : changed.at(-1)?.seq ?? since;
  const rows = new Map<string, OrderRow>();
  for (const r of [...changed, ...sent]) rows.set(r.id, r);
  return c.json({
    cursor: Math.max(since, top),
    token_last: last,
    orders: [...rows.values()].map((r) => ({ id: r.id, updated_at: r.updated_at, closed: r.closed === 1, data: r.closed ? null : JSON.parse(r.data) })),
  });
});

/** Every bill between two business dates (inclusive), with its lines and payments, as the POS shows them. */
async function billsBetween(db: D1Database, from: string, to: string) {
  const { results: bills } = await db
    .prepare(
      `SELECT id, client_id, bill_no, counter, business_date, order_type, table_id, table_name, token, waiter_staff_id, guests,
              discount, prices_include_tax, total, status, cancel_reason, opened_at, closed_at, commission
       FROM pos_bills WHERE business_date BETWEEN ? AND ? ORDER BY closed_at`,
    )
    .bind(from, to)
    .all<Record<string, unknown> & { id: number }>();
  const [items, pays] = await Promise.all([
    db.prepare(
      `SELECT i.bill_id, i.item_id, i.name, i.category, i.qty, i.price, i.tax_rate, i.note, i.variation, i.modifier
       FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id WHERE b.business_date BETWEEN ? AND ? ORDER BY i.id`,
    ).bind(from, to).all<{ bill_id: number }>(),
    db.prepare("SELECT p.bill_id, p.mode, p.amount FROM pos_payments p JOIN pos_bills b ON b.id = p.bill_id WHERE b.business_date BETWEEN ? AND ? ORDER BY p.id")
      .bind(from, to).all<{ bill_id: number }>(),
  ]);
  const strip = <R extends { bill_id: number }>(r: R) => { const { bill_id: _b, ...rest } = r; return rest; };
  const linesOf = new Map<number, unknown[]>();
  for (const i of items.results) linesOf.set(i.bill_id, [...(linesOf.get(i.bill_id) ?? []), strip(i)]);
  const paysOf = new Map<number, unknown[]>();
  for (const p of pays.results) paysOf.set(p.bill_id, [...(paysOf.get(p.bill_id) ?? []), strip(p)]);
  return bills.map(({ id, ...b }) => ({
    ...b,
    prices_include_tax: bool(b.prices_include_tax),
    lines: linesOf.get(id) ?? [],
    payments: paysOf.get(id) ?? [],
  }));
}

/** Every bill of a day from all screens, for the day summary on any screen (and reprints). */
billing.get("/day", anyPosUser, async (c) => {
  const date = c.req.query("date") ?? businessDate();
  if (!isDate(date)) throw new HttpError(422, "invalid", { field: "date" });
  return c.json({ date, bills: await billsBetween(c.env.DB, date, date) });
});

/** The longest stretch the POS reports ask for at once. */
const RANGE_MAX_DAYS = 92;

/** Bills from a date to a date, for the POS's Report's menu (owner and managers, like the old POS's super user). */
billing.get("/range", requireRole("owner", "manager"), async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!isDate(from)) throw new HttpError(422, "invalid", { field: "from" });
  if (!isDate(to) || to < from) throw new HttpError(422, "invalid", { field: "to" });
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (days > RANGE_MAX_DAYS) throw new HttpError(422, "range_too_long", { max_days: RANGE_MAX_DAYS });
  return c.json({ from, to, bills: await billsBetween(c.env.DB, from, to) });
});

/* ---------------- For the owner and managers: looking at bills ---------------- */

billing.get("/bills", requireRole("owner", "manager"), async (c) => {
  const date = c.req.query("date") ?? businessDate();
  if (!isDate(date)) throw new HttpError(422, "invalid", { field: "date" });
  const db = c.env.DB;
  const { results: bills } = await db
    .prepare(
      `SELECT b.*, COALESCE(b.waiter_name, s.name) AS waiter_name, s.waiter_code, u.name AS by_name FROM pos_bills b
       LEFT JOIN staff s ON s.id = b.waiter_staff_id LEFT JOIN users u ON u.id = b.created_by
       WHERE b.business_date = ? ORDER BY b.closed_at DESC`,
    )
    .bind(date)
    .all<Record<string, unknown> & { id: number }>();
  // By date, not by a list of bill ids: D1 allows only 100 values in one query, and a busy day has more bills.
  const [items, pays, counters, rejects] = await Promise.all([
    db.prepare("SELECT i.* FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id WHERE b.business_date = ? ORDER BY i.id").bind(date).all<{ bill_id: number }>(),
    db.prepare("SELECT p.* FROM pos_payments p JOIN pos_bills b ON b.id = p.bill_id WHERE b.business_date = ? ORDER BY p.id").bind(date).all<{ bill_id: number }>(),
    db.prepare("SELECT code, last_seen_at, last_bill_no FROM pos_counters ORDER BY code").all(),
    // Bills the server refused that haven't been saved since (a bill with no readable date shows on every day).
    db.prepare(
      `SELECT r.client_id, r.bill_no, r.counter, r.business_date, r.total, r.reason, r.reported_at, u.name AS by_name
       FROM pos_bill_rejects r LEFT JOIN users u ON u.id = r.reported_by
       WHERE r.resolved_at IS NULL AND (r.business_date = ? OR r.business_date IS NULL) ORDER BY r.reported_at DESC LIMIT 100`,
    ).bind(date).all(),
  ]);
  return c.json({
    date,
    bills: bills.map((b) => ({ ...b, lines: items.results.filter((i) => i.bill_id === b.id), payments: pays.results.filter((p) => p.bill_id === b.id) })),
    counters: counters.results,
    rejects: rejects.results,
  });
});

/* ---------------- New items from the counter (owner, manager, staff) ---------------- */

/**
 * Adds a menu item from the POS, so a dish that isn't on the menu yet can be billed straight away. It goes on the
 * menu at once; the owner and the managers get a reminder and an alert, so they can check the name and the price.
 */
billing.post("/items", anyPosUser, async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const db = c.env.DB;
  const user = c.get("user");
  const f = itemFields({ category_id: b.category_id, name: b.name, short_name: b.short_name, price: b.price, veg: b.veg });
  const cat = await db.prepare("SELECT id, name FROM menu_categories WHERE id = ? AND active = 1").bind(f.category_id).first<{ id: number; name: string }>();
  if (!cat) throw new HttpError(422, "invalid", { field: "category_id" });
  const same = await db.prepare("SELECT id FROM menu_items WHERE active = 1 AND lower(name) = lower(?)").bind(f.name).first();
  if (same) throw new HttpError(409, "item_exists");
  const res = await db.prepare(
    "INSERT INTO menu_items (category_id, name, short_name, price, veg, favourite, sort, active) VALUES (?, ?, ?, ?, ?, 0, ?, 1)",
  ).bind(f.category_id, f.name, f.short_name, f.price, f.veg, f.sort).run();
  const id = Number(res.meta.last_row_id);
  await audit(db, "menu_items", id, "create", null, { ...f, from: "pos" }, user.id);
  const item = await db
    .prepare("SELECT id, category_id, name, name_hi, name_kn, short_name, price, tax_rate, veg, favourite, sort, variations, addons FROM menu_items WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();

  // Tell the owner and the managers, but not the person who added it.
  const today = businessDate();
  const params = { name: f.name, amount: f.price, category: cat.name, by: user.name, item_id: id };
  await db.prepare("INSERT INTO alerts (type, business_date, severity, params, audience) VALUES (?, ?, 'info', ?, 'all') ON CONFLICT (type, business_date) DO NOTHING")
    .bind(`item_added:${id}`, today, JSON.stringify(params))
    .run();
  const { results: tell } = await db
    .prepare("SELECT id FROM users WHERE active = 1 AND role IN ('owner', 'manager') AND id != ?")
    .bind(user.id)
    .all<{ id: number }>();
  if (tell.length) {
    c.executionCtx.waitUntil(
      notify(
        c.env,
        { users: tell.map((u) => u.id) },
        { title: "push.item_added_title", body: "alert.item_added", params: alertParams("item_added", today, params) },
        { url: "/manage/menu", dedupeKey: `alert:item_added:${id}` },
      ).catch((e) => console.error("item added push failed", e)),
    );
  }
  return c.json({ item: withOptions([item!])[0] }, 201);
});

/* ---------------- Owner: menu, tables and POS settings ---------------- */

billing.use("/menu/*", requireRole("owner"));
billing.use("/menu", requireRole("owner"));
billing.use("/tables/*", requireRole("owner"));
billing.use("/tables", requireRole("owner"));
billing.use("/settings", requireRole("owner"));
billing.use("/waiters", requireRole("owner"));
billing.use("/waiters/*", async (c, next) => {
  // The waiters report is part of the analytics the owner can share with managers for the month.
  const user = c.get("user");
  if (user.role === "manager" && c.req.method === "GET" && c.req.path.endsWith("/waiters/report") && (await managersCanSee(c.env.DB))) return next();
  if (user.role !== "owner") throw new HttpError(403, "not_allowed");
  return next();
});

billing.get("/menu", async (c) => {
  const db = c.env.DB;
  const [cats, items] = await Promise.all([
    db.prepare("SELECT * FROM menu_categories ORDER BY active DESC, sort, name").all(),
    db.prepare("SELECT * FROM menu_items ORDER BY active DESC, sort, name").all<Record<string, unknown>>(),
  ]);
  return c.json({ categories: cats.results, items: withOptions(items.results) });
});

function categoryFields(b: Record<string, unknown>) {
  return {
    name: requireText(b.name, "name", 60),
    name_hi: optionalText(b.name_hi, 60),
    name_kn: optionalText(b.name_kn, 60),
    sort: int(b.sort, 0, 10000) ?? 100,
    active: b.active === false ? 0 : 1,
  };
}

billing.post("/menu/categories", async (c) => {
  const f = categoryFields(await c.req.json());
  const res = await c.env.DB.prepare("INSERT INTO menu_categories (name, name_hi, name_kn, sort, active) VALUES (?, ?, ?, ?, ?)")
    .bind(f.name, f.name_hi, f.name_kn, f.sort, f.active).run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "menu_categories", id, "create", null, f, c.get("user").id);
  return c.json({ id }, 201);
});

billing.patch("/menu/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT * FROM menu_categories WHERE id = ?").bind(id).first();
  if (!before) throw new HttpError(404, "not_found");
  const f = categoryFields({ ...before, active: before.active === 1, ...(await c.req.json<Record<string, unknown>>()) });
  await c.env.DB.prepare("UPDATE menu_categories SET name = ?, name_hi = ?, name_kn = ?, sort = ?, active = ? WHERE id = ?")
    .bind(f.name, f.name_hi, f.name_kn, f.sort, f.active, id).run();
  await audit(c.env.DB, "menu_categories", id, "update", before, f, c.get("user").id);
  return c.json({ ok: true });
});

function itemFields(b: Record<string, unknown>) {
  const price = int(b.price, 0, 1e8);
  if (price === null) throw new HttpError(422, "invalid", { field: "price" });
  const category = int(b.category_id, 1, 1e9);
  if (category === null) throw new HttpError(422, "invalid", { field: "category_id" });
  const rate = b.tax_rate === null || b.tax_rate === undefined || b.tax_rate === "" ? null : int(b.tax_rate, 0, 2800);
  if (b.tax_rate != null && b.tax_rate !== "" && rate === null) throw new HttpError(422, "invalid", { field: "tax_rate" });
  return {
    category_id: category,
    name: requireText(b.name, "name", 120),
    name_hi: optionalText(b.name_hi, 120),
    name_kn: optionalText(b.name_kn, 120),
    short_name: optionalText(b.short_name, 40),
    variations: typeof b.variations === "string" ? optionsField(parseOptions(b.variations), "variations") : optionsField(b.variations, "variations"),
    addons: typeof b.addons === "string" ? optionsField(parseOptions(b.addons), "addons") : optionsField(b.addons, "addons"),
    price,
    tax_rate: rate,
    hsn: optionalText(b.hsn, 12),
    veg: b.veg === false || b.veg === 0 ? 0 : 1,
    favourite: b.favourite === true || b.favourite === 1 ? 1 : 0,
    sort: int(b.sort, 0, 10000) ?? 100,
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
}

billing.post("/menu/items", async (c) => {
  const f = itemFields(await c.req.json());
  const res = await c.env.DB.prepare(
    "INSERT INTO menu_items (category_id, name, name_hi, name_kn, short_name, variations, addons, price, tax_rate, hsn, veg, favourite, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(f.category_id, f.name, f.name_hi, f.name_kn, f.short_name, f.variations, f.addons, f.price, f.tax_rate, f.hsn, f.veg, f.favourite, f.sort, f.active).run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "menu_items", id, "create", null, f, c.get("user").id);
  return c.json({ id }, 201);
});

billing.patch("/menu/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT * FROM menu_items WHERE id = ?").bind(id).first();
  if (!before) throw new HttpError(404, "not_found");
  const f = itemFields({ ...before, ...(await c.req.json<Record<string, unknown>>()) });
  await c.env.DB.prepare(
    `UPDATE menu_items SET category_id = ?, name = ?, name_hi = ?, name_kn = ?, short_name = ?, variations = ?, addons = ?, price = ?, tax_rate = ?, hsn = ?, veg = ?, favourite = ?, sort = ?, active = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(f.category_id, f.name, f.name_hi, f.name_kn, f.short_name, f.variations, f.addons, f.price, f.tax_rate, f.hsn, f.veg, f.favourite, f.sort, f.active, id).run();
  await audit(c.env.DB, "menu_items", id, "update", before, f, c.get("user").id);
  return c.json({ ok: true });
});

billing.get("/tables", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM dining_tables ORDER BY active DESC, sort, area, name").all();
  return c.json({ tables: results });
});

function tableFields(b: Record<string, unknown>) {
  return {
    area: optionalText(b.area, 40) ?? "",
    name: requireText(b.name, "name", 20),
    seats: int(b.seats, 1, 50) ?? 4,
    sort: int(b.sort, 0, 10000) ?? 100,
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
}

billing.post("/tables", async (c) => {
  const f = tableFields(await c.req.json());
  const res = await c.env.DB.prepare("INSERT INTO dining_tables (area, name, seats, sort, active) VALUES (?, ?, ?, ?, ?)")
    .bind(f.area, f.name, f.seats, f.sort, f.active).run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "dining_tables", id, "create", null, f, c.get("user").id);
  return c.json({ id }, 201);
});

billing.patch("/tables/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT * FROM dining_tables WHERE id = ?").bind(id).first();
  if (!before) throw new HttpError(404, "not_found");
  const f = tableFields({ ...before, ...(await c.req.json<Record<string, unknown>>()) });
  const db = c.env.DB;
  await db.batch([
    db.prepare("UPDATE dining_tables SET area = ?, name = ?, seats = ?, sort = ?, active = ? WHERE id = ?").bind(f.area, f.name, f.seats, f.sort, f.active, id),
    auditStmt(db, "dining_tables", id, "update", before, f, c.get("user").id),
  ]);
  return c.json({ ok: true });
});

billing.get("/settings", async (c) => c.json({ settings: await loadPosSettings(c.env.DB) }));

billing.put("/settings", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const db = c.env.DB;
  const updates: [PosSettingKey, string][] = [];
  if (b.gst_rate !== undefined) {
    const r = int(b.gst_rate, 0, 2800);
    if (r === null) throw new HttpError(422, "invalid", { field: "gst_rate" });
    updates.push(["pos_gst_rate", String(r)]);
  }
  if (b.prices_include_tax !== undefined) updates.push(["pos_prices_include_tax", b.prices_include_tax ? "1" : "0"]);
  if (b.gstin !== undefined) {
    const g = (optionalText(b.gstin, 15) ?? "").toUpperCase();
    if (g && !/^[0-9]{2}[A-Z0-9]{13}$/.test(g)) throw new HttpError(422, "invalid", { field: "gstin" });
    updates.push(["pos_gstin", g]);
  }
  if (b.bill_header !== undefined) updates.push(["pos_bill_header", optionalText(b.bill_header, 200) ?? ""]);
  if (b.bill_footer !== undefined) updates.push(["pos_bill_footer", optionalText(b.bill_footer, 200) ?? ""]);
  for (const [field, key] of [["use_tables", "pos_use_tables"], ["use_gst", "pos_use_gst"], ["printing", "pos_printing"], ["waiter_required", "pos_waiter_required"]] as const) {
    if (b[field] !== undefined) updates.push([key, b[field] ? "1" : "0"]);
  }
  if (b.bill_copies !== undefined) {
    const r = int(b.bill_copies, 1, 3);
    if (r === null) throw new HttpError(422, "invalid", { field: "bill_copies" });
    updates.push(["pos_bill_copies", String(r)]);
  }
  if (b.discount_limit_pct !== undefined) {
    const r = int(b.discount_limit_pct, 0, 100);
    if (r === null) throw new HttpError(422, "invalid", { field: "discount_limit_pct" });
    updates.push(["pos_discount_limit_pct", String(r)]);
  }
  if (b.discount_limit_paise !== undefined) {
    const r = int(b.discount_limit_paise, 0, 10_000_000);
    if (r === null) throw new HttpError(422, "invalid", { field: "discount_limit_paise" });
    updates.push(["pos_discount_limit_paise", String(r)]);
  }
  if (b.commission_bp !== undefined) {
    const r = int(b.commission_bp, 0, 10000);
    if (r === null) throw new HttpError(422, "invalid", { field: "commission_bp" });
    updates.push(["pos_commission_bp", String(r)]);
  }
  if (updates.length) {
    const before = await loadPosSettings(db);
    const was = Object.fromEntries(updates.map(([k]) => [k, String((before as unknown as Record<string, unknown>)[k.replace(/^pos_/, "")])]));
    await db.batch([
      ...updates.map(([k, v]) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(k, v)),
      auditStmt(db, "settings", 0, "update", was, Object.fromEntries(updates), c.get("user").id),
    ]);
  }
  return c.json({ settings: await loadPosSettings(db) });
});

/* ---------------- Owner: waiters and their commission ---------------- */

/** Every staff member, with their waiter details, so the owner can add someone as a waiter. */
billing.get("/waiters", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, name_local, role, is_waiter, waiter_code, commission_bp, active FROM staff
     ORDER BY is_waiter DESC, active DESC, CAST(waiter_code AS INTEGER), waiter_code, name`,
  ).all();
  return c.json({ staff: results, settings: await loadPosSettings(c.env.DB) });
});

async function waiterFields(db: D1Database, b: Record<string, unknown>, selfId: number | null) {
  const code = optionalText(b.waiter_code, 6)?.toUpperCase() ?? null;
  if (code && !/^[A-Z0-9]{1,6}$/.test(code)) throw new HttpError(422, "invalid", { field: "waiter_code" });
  if (code) {
    const clash = await db.prepare("SELECT id FROM staff WHERE is_waiter = 1 AND active = 1 AND upper(waiter_code) = ? AND id != ?")
      .bind(code, selfId ?? 0).first();
    if (clash) throw new HttpError(409, "waiter_code_taken", { field: "waiter_code" });
  }
  const bp = b.commission_bp === null || b.commission_bp === undefined || b.commission_bp === "" ? null : int(b.commission_bp, 0, 10000);
  if (b.commission_bp != null && b.commission_bp !== "" && bp === null) throw new HttpError(422, "invalid", { field: "commission_bp" });
  return { waiter_code: code, commission_bp: bp, is_waiter: b.is_waiter === false || b.is_waiter === 0 ? 0 : 1 };
}

/** Adds a new person straight in as a waiter (they appear on Staff too). */
billing.post("/waiters", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const name = requireText(b.name, "name", 80);
  const f = await waiterFields(c.env.DB, b, null);
  const res = await c.env.DB.prepare("INSERT INTO staff (name, name_local, role, is_waiter, waiter_code, commission_bp) VALUES (?, ?, 'Waiter', 1, ?, ?)")
    .bind(name, optionalText(b.name_local, 80), f.waiter_code, f.commission_bp).run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, "staff", id, "create", null, { name, ...f }, c.get("user").id);
  return c.json({ id }, 201);
});

/** Makes a staff member a waiter (or not), and sets their ID and commission. */
billing.patch("/waiters/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT id, name, is_waiter, waiter_code, commission_bp FROM staff WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) throw new HttpError(404, "not_found");
  const f = await waiterFields(c.env.DB, { ...before, ...(await c.req.json<Record<string, unknown>>()) }, id);
  await c.env.DB.prepare("UPDATE staff SET is_waiter = ?, waiter_code = ?, commission_bp = ? WHERE id = ?")
    .bind(f.is_waiter, f.waiter_code, f.commission_bp, id).run();
  await audit(c.env.DB, "staff", id, "update", before, f, c.get("user").id);
  return c.json({ ok: true });
});

const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/**
 * Waiter sales and commission for a month, one row per waiter per day (paid bills only).
 * Bills with no waiter come back with waiter_id null so the owner can see how much went unassigned.
 */
billing.get("/waiters/report", async (c) => {
  const month = c.req.query("month") ?? businessDate().slice(0, 7);
  if (!isMonth(month)) throw new HttpError(422, "invalid", { field: "month" });
  const { results } = await c.env.DB.prepare(
    `SELECT b.waiter_staff_id AS waiter_id, COALESCE(s.name, MAX(b.waiter_name)) AS name, s.waiter_code, b.business_date,
       COUNT(*) AS bills, SUM(b.total) AS sales, SUM(b.total - b.tax) AS before_tax, SUM(b.commission) AS commission
     FROM pos_bills b LEFT JOIN staff s ON s.id = b.waiter_staff_id
     WHERE b.status = 'paid' AND b.business_date BETWEEN ?1 || '-01' AND ?1 || '-31'
     GROUP BY b.waiter_staff_id, b.business_date
     ORDER BY b.business_date`,
  ).bind(month).all();
  return c.json({ month, rows: results });
});
