// Everything the counter keeps on the device, so billing carries on with no internet and survives a reload.
import { billNumber, DEFAULT_LANG, billTotals, businessDate, type BillPayMode, type BillTotals, type Lang } from "@mausam/shared";

export interface Category { id: number; name: string; name_hi: string | null; name_kn: string | null; sort: number }
/** A variation (pick one; its price is the item's price) or an add-on (pick at most one; its price is added). Paise. */
export interface ItemOption { name: string; price: number }
export interface Item {
  id: number; category_id: number; name: string; name_hi?: string | null; name_kn?: string | null; short_name: string | null;
  price: number; tax_rate: number | null; veg: number; favourite: number; sort: number;
  variations?: ItemOption[] | null; addons?: ItemOption[] | null;
}
/** Does tapping this item ask which variation or add-on, before it goes on the order? */
export const hasChoices = (i: Item) => !!(i.variations?.length || i.addons?.length);
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
  /** Copies of a bill printed at Save & Print, one after the other (the second is the kitchen's). */
  bill_copies?: number;
}
export interface Config { categories: Category[]; items: Item[]; tables: Table[]; waiters: Waiter[]; settings: PosSettings; fetched_at: string }

export interface Line {
  key: string; item_id: number | null; name: string; category: string | null; price: number; tax_rate: number; qty: number; sent: number; note: string | null;
  /** The variation picked (e.g. "Jain", "Half") and the add-on (e.g. "Kadak"), shown as [Jain · Kadak] on the bill. */
  variation?: string | null; modifier?: string | null;
}
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
  /** When any screen last changed this order. Screens share running orders, and the newest change wins. */
  updated_at?: string;
}
export interface Payment { mode: BillPayMode; amount: number }
export interface Bill {
  client_id: string; bill_no: string; counter: string; business_date: string; order_type: Order["type"];
  table_id: number | null; table_name: string | null; token: number | null; waiter_staff_id: number | null; guests: number | null;
  discount: number; prices_include_tax: boolean; total: number; status: "paid" | "cancelled"; cancel_reason: string | null;
  opened_at: string; closed_at: string;
  lines: { item_id: number | null; name: string; category: string | null; qty: number; price: number; tax_rate: number; note: string | null; variation?: string | null; modifier?: string | null }[];
  payments: Payment[];
  synced?: boolean;
  rejected?: string;
}
/** This screen's counter code and bill number sequence, and the highest token number it has seen (tokens never restart). */
export interface Counter { code: string; seq: number; tokenDate: string; token: number }
/** An order closed on this screen (paid, cancelled or dropped) that the other screens haven't been told about yet. */
export interface Closed { id: string; updated_at: string }

const K = {
  token: "mausam.pos.token",
  user: "mausam.pos.user",
  lang: "mausam.pos.lang",
  config: "mausam.pos.config",
  orders: "mausam.pos.orders",
  bills: "mausam.pos.bills",
  counter: "mausam.pos.counter",
  pushed: "mausam.pos.pushed",
  closed: "mausam.pos.closed",
  cursor: "mausam.pos.cursor",
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
  /** For each running order, the version (updated_at) the server already has. */
  pushed: () => read<Record<string, string>>(K.pushed, {}),
  setPushed: (p: Record<string, string>) => write(K.pushed, p),
  closed: () => read<Closed[]>(K.closed, []),
  setClosed: (c: Closed[]) => write(K.closed, c),
  /** How far this screen has read the server's list of order changes. */
  cursor: () => read<number>(K.cursor, 0),
  setCursor: (n: number) => write(K.cursor, n),
};

/** A running order as the server has it: the newest version from any screen, or closed. */
export interface RemoteOrder { id: string; updated_at: string; closed: boolean; data: Order | null }

/**
 * Takes in the server's versions of running orders: a newer version replaces this screen's, a new order is added,
 * and an order closed on any screen is dropped. Returns `orders` itself when nothing changed.
 */
export function mergeRemote(orders: Order[], remote: RemoteOrder[]): Order[] {
  const closing = new Set(storage.closed().map((c) => c.id));
  const pushed = storage.pushed();
  let next = orders;
  for (const ro of remote) {
    const mine = next.find((o) => o.id === ro.id);
    if (ro.closed) {
      delete pushed[ro.id];
      if (mine) next = next.filter((o) => o.id !== ro.id);
      continue;
    }
    // Closed here but the server doesn't know yet: it stays closed.
    if (!ro.data || closing.has(ro.id)) continue;
    if (!mine) {
      next = [...next, { ...ro.data, updated_at: ro.updated_at }];
      pushed[ro.id] = ro.updated_at;
    } else if (ro.updated_at > (mine.updated_at ?? "")) {
      next = next.map((o) => (o.id === ro.id ? { ...ro.data!, updated_at: ro.updated_at } : o));
      pushed[ro.id] = ro.updated_at;
    }
  }
  const live = new Set(next.map((o) => o.id));
  storage.setPushed(Object.fromEntries(Object.entries(pushed).filter(([id]) => live.has(id))));
  return next;
}

/** Remember orders closed here until the server has them, so the other screens drop them too. */
export function noteClosed(list: Closed[]) {
  if (!list.length) return;
  const ids = new Set(list.map((c) => c.id));
  storage.setClosed([...storage.closed().filter((c) => !ids.has(c.id)), ...list]);
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** GST applies only when it's switched on and a GSTIN is set; an item can override the default rate. */
export function rateFor(item: Item, s: PosSettings): number {
  if (s.use_gst === false || !s.gstin) return 0;
  return item.tax_rate ?? s.gst_rate;
}

export interface Choice { variation?: ItemOption | null; addon?: ItemOption | null }

/** The [Jain · Kadak] tag for a line, or "" when nothing was picked. */
export function lineTag(l: { variation?: string | null; modifier?: string | null }): string {
  const parts = [l.variation, l.modifier].filter(Boolean);
  return parts.length ? `[${parts.join(" · ")}]` : "";
}

export function addItem(order: Order, item: Item, cats: Category[], s: PosSettings, pick: Choice = {}, qty = 1): Order {
  // The variation's price replaces the item's; an add-on's price is added on top.
  const price = (pick.variation?.price ?? item.price) + (pick.addon?.price ?? 0);
  const variation = pick.variation?.name ?? null;
  const modifier = pick.addon?.name ?? null;
  // Add to the last line of the same item with the same choices and no note, else start a new line.
  const lines = [...order.lines];
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.item_id === item.id && !l.note && (l.variation ?? null) === variation && (l.modifier ?? null) === modifier && l.price === price) { idx = i; break; }
  }
  if (idx >= 0) lines[idx] = { ...lines[idx], qty: lines[idx].qty + qty };
  else
    lines.push({
      key: uid(), item_id: item.id, name: item.name, category: cats.find((c) => c.id === item.category_id)?.name ?? null,
      price, tax_rate: rateFor(item, s), qty, sent: 0, note: null, variation, modifier,
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

/**
 * Token number when the server can't be reached: one more than the highest this screen has seen.
 * Tokens keep counting and never restart. Online, tokens come from the server, so two screens never share one.
 */
export function takeToken(): number {
  const c = storage.counter()!;
  const token = c.token + 1;
  storage.setCounter({ ...c, token });
  return token;
}

/** Remember a token number seen (from the server or another screen), so this screen never goes below it. */
export function noteToken(n: number) {
  const c = storage.counter();
  if (c && n > c.token) storage.setCounter({ ...c, token: n });
}

/** The counter a bill number belongs to: "B2627-00012" → "B". Another screen may take payment for it. */
export function counterOf(billNo: string): string {
  return billNo.slice(0, -10);
}

export function toBill(order: Order, s: PosSettings, status: Bill["status"], payments: Payment[], reason: string | null): Bill {
  const t = totalsOf(order, s);
  const billNo = order.bill_no ?? takeBillNo();
  return {
    client_id: order.id, bill_no: billNo, counter: counterOf(billNo), business_date: order.business_date,
    order_type: order.type, table_id: order.table_id, table_name: order.table_name, token: order.token,
    waiter_staff_id: order.waiter_staff_id, guests: order.guests, discount: t.discount, prices_include_tax: s.prices_include_tax,
    total: t.total, status, cancel_reason: reason, opened_at: order.opened_at, closed_at: new Date().toISOString(),
    lines: order.lines.map((l) => ({
      item_id: l.item_id, name: l.name, category: l.category, qty: l.qty, price: l.price, tax_rate: l.tax_rate, note: l.note,
      variation: l.variation ?? null, modifier: l.modifier ?? null,
    })),
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

export interface ItemSale { category: string; name: string; variation: string | null; qty: number; amount: number }

/** Item sales from paid bills, like the old POS's Item Sales Summary: by category, then item and variation, biggest first. */
export function itemSales(bills: Bill[]): ItemSale[] {
  const m = new Map<string, ItemSale>();
  for (const b of bills) {
    if (b.status !== "paid") continue;
    for (const l of b.lines) {
      const category = l.category ?? "—";
      const variation = l.variation ?? null;
      const key = `${category}|${l.name}|${variation ?? ""}`;
      const row = m.get(key) ?? { category, name: l.name, variation, qty: 0, amount: 0 };
      row.qty += l.qty;
      row.amount += l.qty * l.price;
      m.set(key, row);
    }
  }
  return [...m.values()].sort((a, b) => a.category.localeCompare(b.category) || b.amount - a.amount);
}
