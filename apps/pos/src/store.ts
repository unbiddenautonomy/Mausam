// Everything the counter keeps on the device, so billing carries on with no internet and survives a reload.
import { billNumber, DEFAULT_LANG, billTotals, businessDate, type BillPayMode, type BillTotals, type Lang } from "@mausam/shared";

export interface Category { id: number; name: string; name_hi: string | null; name_kn: string | null; sort: number }
export interface Item { id: number; category_id: number; name: string; short_name: string | null; price: number; tax_rate: number | null; veg: number; favourite: number; sort: number }
export interface Table { id: number; area: string; name: string; seats: number; sort: number }
export interface Waiter { id: number; name: string; name_local: string | null; waiter_code?: string | null }
export interface PosSettings {
  gst_rate: number; prices_include_tax: boolean; gstin: string; bill_header: string; bill_footer: string;
  /** Show the table map; off = orders by number, table number typed in if wanted. */
  use_tables?: boolean;
  /** Charge GST (also needs a GSTIN). */
  use_gst?: boolean;
  /** A receipt printer is connected; off = bills and kitchen orders are shown on screen. */
  printing?: boolean;
  commission_bp?: number;
  /** A dine-in order needs a waiter before payment. */
  waiter_required?: boolean;
}
export interface Config { categories: Category[]; items: Item[]; tables: Table[]; waiters: Waiter[]; settings: PosSettings; fetched_at: string }

export interface Line { key: string; item_id: number | null; name: string; category: string | null; price: number; tax_rate: number; qty: number; sent: number; note: string | null }
export interface Order {
  id: string; // becomes the bill's client_id
  type: "dine_in" | "parcel";
  table_id: number | null;
  table_name: string | null;
  token: number | null;
  waiter_staff_id: number | null;
  guests: number | null;
  lines: Line[];
  discount: number;
  opened_at: string;
  bill_no: string | null; // set when the bill is first printed (or paid)
  business_date: string;
}
export interface Payment { mode: BillPayMode; amount: number }
export interface Bill {
  client_id: string; bill_no: string; counter: string; business_date: string; order_type: Order["type"];
  table_id: number | null; table_name: string | null; token: number | null; waiter_staff_id: number | null; guests: number | null;
  discount: number; prices_include_tax: boolean; total: number; status: "paid" | "cancelled"; cancel_reason: string | null;
  opened_at: string; closed_at: string;
  lines: { item_id: number | null; name: string; category: string | null; qty: number; price: number; tax_rate: number; note: string | null }[];
  payments: Payment[];
  synced?: boolean;
  rejected?: string;
}
export interface Counter { code: string; seq: number; tokenDate: string; token: number }

const K = {
  token: "mausam.pos.token",
  user: "mausam.pos.user",
  lang: "mausam.pos.lang",
  config: "mausam.pos.config",
  orders: "mausam.pos.orders",
  bills: "mausam.pos.bills",
  counter: "mausam.pos.counter",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app keeps working in memory */
  }
}

export const storage = {
  token: () => read<string | null>(K.token, null),
  setToken: (t: string | null) => write(K.token, t),
  user: () => read<{ id: number; name: string; role: string } | null>(K.user, null),
  setUser: (u: { id: number; name: string; role: string } | null) => write(K.user, u),
  lang: () => read<Lang>(K.lang, DEFAULT_LANG),
  setLang: (l: Lang) => write(K.lang, l),
  config: () => read<Config | null>(K.config, null),
  setConfig: (c: Config) => write(K.config, c),
  orders: () => read<Order[]>(K.orders, []),
  setOrders: (o: Order[]) => write(K.orders, o),
  bills: () => read<Bill[]>(K.bills, []),
  setBills: (b: Bill[]) => write(K.bills, b),
  counter: () => read<Counter | null>(K.counter, null),
  setCounter: (c: Counter | null) => write(K.counter, c),
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** GST applies only when it's switched on and a GSTIN is set; an item can override the default rate. */
export function rateFor(item: Item, s: PosSettings): number {
  if (s.use_gst === false || !s.gstin) return 0;
  return item.tax_rate ?? s.gst_rate;
}

export function addItem(order: Order, item: Item, cats: Category[], s: PosSettings): Order {
  // Add to the last line of the same item if it has no note and hasn't been fully sent, else a new line.
  const lines = [...order.lines];
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].item_id === item.id && !lines[i].note) { idx = i; break; }
  if (idx >= 0) lines[idx] = { ...lines[idx], qty: lines[idx].qty + 1 };
  else
    lines.push({
      key: uid(), item_id: item.id, name: item.name, category: cats.find((c) => c.id === item.category_id)?.name ?? null,
      price: item.price, tax_rate: rateFor(item, s), qty: 1, sent: 0, note: null,
    });
  return { ...order, lines };
}

export function changeQty(order: Order, key: string, delta: number): Order {
  const lines = order.lines
    .map((l) => (l.key === key ? { ...l, qty: l.qty + delta, sent: Math.min(l.sent, l.qty + delta) } : l))
    .filter((l) => l.qty > 0);
  return { ...order, lines };
}

export function totalsOf(order: Order, s: PosSettings): BillTotals {
  return billTotals(order.lines, order.discount, s.prices_include_tax);
}

/** Lines (or parts of lines) not yet on a kitchen ticket. */
export function unsent(order: Order): Line[] {
  return order.lines.filter((l) => l.qty > l.sent).map((l) => ({ ...l, qty: l.qty - l.sent }));
}

export function newOrder(type: Order["type"], table: Table | null, token: number | null, opts: { waiter?: number | null; tableName?: string | null } = {}): Order {
  const now = new Date();
  return {
    id: uid(), type, table_id: table?.id ?? null, table_name: table?.name ?? (opts.tableName?.trim() || null), token, waiter_staff_id: opts.waiter ?? null, guests: null,
    lines: [], discount: 0, opened_at: now.toISOString(), bill_no: null, business_date: businessDate(now),
  };
}

/** Next bill number for this counter. Stored before it's used, so a crash can't hand it out twice. */
export function takeBillNo(): string {
  const c = storage.counter()!;
  const next = { ...c, seq: c.seq + 1 };
  storage.setCounter(next);
  return billNumber(c.code, businessDate(), next.seq);
}

/** Parcel token: starts at 1 each business day. */
export function takeToken(): number {
  const c = storage.counter()!;
  const today = businessDate();
  const token = c.tokenDate === today ? c.token + 1 : 1;
  storage.setCounter({ ...c, tokenDate: today, token });
  return token;
}

export function toBill(order: Order, s: PosSettings, status: Bill["status"], payments: Payment[], reason: string | null): Bill {
  const t = totalsOf(order, s);
  return {
    client_id: order.id, bill_no: order.bill_no ?? takeBillNo(), counter: storage.counter()!.code, business_date: order.business_date,
    order_type: order.type, table_id: order.table_id, table_name: order.table_name, token: order.token,
    waiter_staff_id: order.waiter_staff_id, guests: order.guests, discount: t.discount, prices_include_tax: s.prices_include_tax,
    total: t.total, status, cancel_reason: reason, opened_at: order.opened_at, closed_at: new Date().toISOString(),
    lines: order.lines.map((l) => ({ item_id: l.item_id, name: l.name, category: l.category, qty: l.qty, price: l.price, tax_rate: l.tax_rate, note: l.note })),
    payments,
  };
}

/** Keep sent bills for 3 days (for reprints and the day summary); unsent bills are kept until they go. */
export function pruneBills(bills: Bill[]): Bill[] {
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  return bills.filter((b) => !b.synced || b.closed_at > cutoff);
}

/** Does this order still need a waiter before it can be paid? Only dine-in, only when required, and only once waiters exist. */
export function needsWaiter(order: Order, config: Pick<Config, "settings" | "waiters">): boolean {
  return order.type === "dine_in" && config.settings.waiter_required !== false && config.waiters.length > 0 && !order.waiter_staff_id;
}

/** Use the table map only when it's switched on and tables are set up. */
export function usesTables(config: Pick<Config, "settings" | "tables">): boolean {
  return !!config.settings.use_tables && config.tables.length > 0;
}

/** How an order is named on screen: its table, or its order (token) number. */
export function orderLabel(o: Pick<Order, "type" | "table_name" | "token">, t: (k: "table" | "parcel" | "order_no", p?: Record<string, string | number>) => string): string {
  if (o.type === "parcel") return `${t("parcel")} #${o.token ?? ""}`;
  if (o.table_name) return `${t("table")} ${o.table_name}${o.token ? ` · #${o.token}` : ""}`;
  return t("order_no", { n: o.token ?? "" });
}

/** Today's paid bills grouped by waiter, biggest first (for the day summary). */
export function byWaiter(bills: Bill[], waiters: Waiter[]): { id: number | null; name: string; bills: number; total: number }[] {
  const m = new Map<number | null, { id: number | null; name: string; bills: number; total: number }>();
  for (const b of bills) {
    if (b.status !== "paid") continue;
    const id = b.waiter_staff_id ?? null;
    const row = m.get(id) ?? { id, name: waiters.find((w) => w.id === id)?.name ?? "", bills: 0, total: 0 };
    row.bills++;
    row.total += b.total;
    m.set(id, row);
  }
  return [...m.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.total - a.total));
}
