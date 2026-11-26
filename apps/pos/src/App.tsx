import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { businessDate, changeDue, financialYear, formatINR, formatTime, LANGUAGES, setDateLang, rupeesToPaise, type BillPayMode, type Lang } from "@mausam/shared";
import { uid } from "./store";
import { api, ApiError, fetchConfig, fetchDay, fetchRange, autoCounter, logout, nextToken, resendBill, syncBills, syncOrders } from "./api";
import { translate, type Key } from "./i18n";
import { ordersDelay, usePolling } from "./polling";
import {
  addItem, billCopies, billNumbersFull, cancelLocal, DELETED_REASON, EDITED_REASON, favouritesOf, orderFromBill, clockOffMinutes, DISCOUNT_REASONS, keepStorage, onStorageChange, serverNow, storageBroken, overDiscountLimit, discountLimit, byWaiter, changeQty, hasChoices, itemSales, lineTag, mergeRemote, needsWaiter, newOrder, noteClosed, orderLabel, pruneBills, storage, takeBillNo, takeToken, toBill, totalsOf, unsent, usesTables,
  type Approver, type Bill, type Choice, type DiscountReason, type PosSettings, type Config, type Item, type ItemOption, type Order, type Payment, type Table,
} from "./store";

type T = (key: Key, params?: Record<string, string | number>) => string;

/** Why the server refused a bill, in words. */
function rejectText(t: T, code: string): string {
  const known: Record<string, Key> = {
    duplicate_number: "bill_error.duplicate_number", total_mismatch: "bill_error.total_mismatch", payments_total: "bill_error.payments_total",
  };
  return known[code] ? t(known[code]) : t("bill_error.other", { code });
}
/** "Original" when the bill is printed as the order is saved or paid; "Duplicate" for a reprint. */
type Copy = "Original" | "Duplicate";
type PrintJob =
  | { kind: "bill"; bill: Bill; copy: Copy }
  | { kind: "summary"; date: string; bills: Bill[] }
  | { kind: "items"; date: string; bills: Bill[] }
  | { kind: "table"; title: string; sub: string; cols: string; head: string[]; rows: string[][]; foot?: string[] };

const SYNC_EVERY_MS = 20_000;
const CONFIG_EVERY_MS = 10 * 60_000;

export function App() {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = storage.lang();
    setDateLang(l);
    return l;
  });
  const t: T = useCallback((k, p) => translate(lang, k, p), [lang]);
  const setLang = (l: Lang) => {
    storage.setLang(l);
    setDateLang(l);
    setLangState(l);
    document.documentElement.lang = l;
  };
  const [loggedIn, setLoggedIn] = useState(!!storage.token());
  const [counter, setCounter] = useState(storage.counter());

  if (!loggedIn) return <Login t={t} lang={lang} setLang={setLang} onDone={() => setLoggedIn(true)} />;
  if (!counter || counter.taken) return <CounterSetup t={t} onDone={() => setCounter(storage.counter())} />;
  return (
    <Counter t={t} lang={lang} setLang={setLang} onLogout={() => void logout().then(() => setLoggedIn(false))}
      onCounterTaken={() => setCounter(storage.counter())} />
  );
}

/* ---------------- Login: phone, then PIN on a big number pad ---------------- */

function Login({ t, lang, setLang, onDone }: { t: T; lang: Lang; setLang: (l: Lang) => void; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"phone" | "pin">("phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = step === "phone" ? phone : pin;
  const set = step === "phone" ? setPhone : setPin;

  async function submit(p = pin) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: { id: number; name: string; role: string; language: Lang } }>("/auth/login", { method: "POST", json: { phone, pin: p } });
      storage.setToken(r.token);
      storage.setUser({ id: r.user.id, name: r.user.name, role: r.user.role });
      onDone();
    } catch (e) {
      setPin("");
      setError(e instanceof ApiError ? (e.code === "too_many_tries" ? t("login.too_many") : t("login.wrong")) : t("login.offline"));
    } finally {
      setBusy(false);
    }
  }

  function press(k: string) {
    setError(null);
    if (k === "⌫") return set(value.slice(0, -1));
    if (step === "pin") {
      if (pin.length >= 4) return;
      const next = pin + k;
      setPin(next);
      if (next.length === 4) void submit(next);
    } else if (phone.length < 13) setPhone(phone + k);
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand-row"><img src="/icon.svg" alt="" width={44} height={44} /> <h1>{t("app.title")}</h1></div>
        <div className="lang-row">
          {LANGUAGES.map((l) => <button key={l.code} className={`chip${lang === l.code ? " on" : ""}`} onClick={() => setLang(l.code)}>{l.label}</button>)}
        </div>
        <h2>{step === "phone" ? t("login.phone") : t("login.pin")}</h2>
        <div className="display num" aria-live="polite">{step === "phone" ? phone || "—" : "●".repeat(pin.length).padEnd(4, "○")}</div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k) =>
            k ? <button key={k} className="key" disabled={busy} onClick={() => press(k)}>{k}</button> : <span key="gap" />,
          )}
        </div>
        {step === "phone" ? (
          <button className="btn primary big block" disabled={phone.replace(/\D/g, "").length < 10} onClick={() => setStep("pin")}>{t("login.next")}</button>
        ) : (
          <button className="btn block" onClick={() => (setStep("phone"), setPin(""))}>{t("login.phone")}: {phone}</button>
        )}
      </div>
    </div>
  );
}

/* ---------------- First run on a device: its counter letter, picked without asking ---------------- */

/**
 * Gets this device a counter letter from the server and starts billing; nobody is asked. Bill numbers start with
 * the letter (A2627-00001) so screens billing offline never make the same number. `taken`: the server says another
 * device now holds this device's letter, so it simply gets another.
 */
function CounterSetup({ t, onDone }: { t: T; onDone: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let live = true;
    void (async () => {
      let code: string | null = null;
      try {
        code = await autoCounter();
      } catch {
        /* logged out: App shows the login */
      }
      if (!live) return;
      if (!code) return setFailed(true);
      keepStorage();
      // Carry on from the last bill this letter sent, in case the device was reset.
      let seq = 0;
      try {
        const r = await api<{ last_bill_no: string | null }>(`/billing/counters/${code}/last`);
        if (r.last_bill_no) seq = Number(r.last_bill_no.split("-").at(-1)) || 0;
      } catch {
        /* the server refuses a repeated number, so nothing is lost silently */
      }
      if (!live) return;
      storage.setCounter({ code, seq, tokenDate: businessDate(), token: 0, fy: financialYear(businessDate()) });
      done.current();
    })();
    return () => void (live = false);
  }, [attempt]);
  return (
    <div className="login">
      <div className="login-card">
        {failed ? (
          <>
            <p className="error" role="alert">{t("load_failed")}</p>
            <button className="btn primary big block" onClick={() => (setFailed(false), setAttempt((a) => a + 1))}>{t("retry")}</button>
          </>
        ) : <p className="muted center">{t("loading")}</p>}
      </div>
    </div>
  );
}

/* ---------------- The counter ---------------- */

/** What's shown on screen in place of a printout (when no printer is connected), or after payment. */
type View =
  | { kind: "bill"; bill: Bill; orderId?: string }
  | { kind: "paid"; bill: Bill; change: number };

/** The screens of the menu bar, like the old POS. Billing (the menu and the order) is home. */
type ReportKind = "sales_summary" | "sales_details" | "item_sales" | "waiter_commission";
type Screen =
  | { kind: "billing" }
  | { kind: "dashboard" }
  | { kind: "dayend" }
  | { kind: "items" }
  | { kind: "invoices" }
  | { kind: "report"; report: ReportKind };
const HOME: Screen = { kind: "billing" };
const sameScreen = (a: Screen, b: Screen) => a.kind === b.kind && (a.kind !== "report" || (b.kind === "report" && a.report === b.report));
const REPORTS: { kind: ReportKind; key: Key }[] = [
  { kind: "sales_summary", key: "r.sales_summary" },
  { kind: "sales_details", key: "r.sales_details" },
  { kind: "item_sales", key: "r.item_sales" },
  { kind: "waiter_commission", key: "r.waiter_commission" },
];
/** The old POS's Master's menu. Menus, tables and waiters are kept in the admin app, so these open its pages. */
const MASTERS: { key: Key; href: string }[] = [
  { key: "m.waiter", href: "/manage/waiters" },
  { key: "m.table", href: "/manage/tables" },
  { key: "m.category", href: "/manage/menu" },
  { key: "m.menu", href: "/manage/menu" },
];

/** "01-04-2026 – 31-03-2027": the financial year the counter is billing in, shown at the top like the old POS. */
function periodOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `01-04-${start} – 31-03-${start + 1}`;
}

function Counter({ t, lang, setLang, onLogout, onCounterTaken }: {
  t: T; lang: Lang; setLang: (l: Lang) => void; onLogout: () => void; onCounterTaken: () => void;
}) {
  const [config, setConfig] = useState<Config | null>(storage.config());
  const [configError, setConfigError] = useState(false);
  const [orders, setOrdersState] = useState<Order[]>(storage.orders());
  const [bills, setBillsState] = useState<Bill[]>(storage.bills());
  /** The open order on the Billing screen; null = the fresh bill (`draft`), which isn't shared until an item is added. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Order>(() => newOrder("dine_in", null, null));
  /** Where the counter has been, for Back. Home is the Billing screen. */
  const [history, setHistory] = useState<Screen[]>([HOME]);
  const screen = history[history.length - 1];
  /** A pop-up to open on the Billing screen as it shows an order (Pay from the dashboard). */
  const [openWith, setOpenWith] = useState<"pay" | null>(null);
  const [menu, setMenu] = useState<"masters" | "reports" | "user" | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [print, setPrint] = useState<PrintJob | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [starting, setStarting] = useState<Table | null>(null);
  const [askLogout, setAskLogout] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** A message with an Undo button, shown for a few seconds after something is thrown away without asking. */
  const [undo, setUndo] = useState<{ text: string; run: () => void } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [cantSave, setCantSave] = useState(storageBroken());
  const tokenAsked = useRef(new Set<string>());
  useEffect(() => {
    keepStorage();
    return onStorageChange(setCantSave);
  }, []);

  /** A change made on this screen: changed orders get a new version time, and removed ones are closed for every screen. */
  const setOrders = useCallback((fn: (o: Order[]) => Order[]) =>
    setOrdersState((prev) => {
      const raw = fn(prev);
      const at = serverNow().toISOString();
      const before = new Map(prev.map((o) => [o.id, o]));
      const next = raw.map((o) => (before.get(o.id) === o ? o : { ...o, updated_at: at }));
      const kept = new Set(next.map((o) => o.id));
      noteClosed(prev.filter((o) => !kept.has(o.id)).map((o) => ({ id: o.id, updated_at: at })));
      storage.setOrders(next);
      return next;
    }), []);
  // When someone last tapped this screen or an order changed anywhere: a busy screen checks for orders every few
  // seconds, an idle one every half minute or so.
  const lastActive = useRef(Date.now());
  const replanOrders = useRef<() => void>(() => {});
  const markActive = useCallback(() => {
    lastActive.current = Date.now();
    replanOrders.current();
  }, []);
  useEffect(() => {
    window.addEventListener("pointerdown", markActive);
    window.addEventListener("keydown", markActive);
    return () => {
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
    };
  }, [markActive]);

  /** Sends this screen's order changes and takes in the other screens'. */
  const shareOrders = useCallback(async () => {
    try {
      const remote = await syncOrders();
      if (!remote.length) return;
      markActive();
      setOrdersState((prev) => {
        const next = mergeRemote(prev, remote);
        if (next !== prev) storage.setOrders(next);
        return next;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
    }
  }, [onLogout, markActive]);
  const refreshBills = () => setBillsState(storage.bills());

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await fetchConfig());
      setConfigError(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onLogout();
      setConfigError(true);
    }
  }, [onLogout]);

  const sync = useCallback(async () => {
    try {
      await syncBills();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onLogout();
    }
    refreshBills();
    if (storage.counter()?.taken) onCounterTaken();
  }, [onLogout, onCounterTaken]);

  /** Sends a refused bill again, once someone has looked at why. */
  const resend = async (clientId: string) => {
    try {
      await resendBill(clientId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onLogout();
    }
    refreshBills();
  };

  // Nothing polls while the screen is hidden; each check runs at once when it shows again. Bill sync only calls the
  // server when a bill is waiting.
  replanOrders.current = usePolling(shareOrders, () => ordersDelay(lastActive.current, Date.now()));
  usePolling(sync, () => SYNC_EVERY_MS);
  usePolling(loadConfig, () => CONFIG_EVERY_MS);
  useEffect(() => {
    void loadConfig();
    void sync();
    const c = window.setInterval(() => setNow(Date.now()), 30_000);
    const on = () => (setOnline(true), void sync(), void shareOrders());
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.clearInterval(c);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [loadConfig, sync, shareOrders]);

  // Share a change made here with the other screens straight away (a moment later, so quick taps go together).
  useEffect(() => {
    const pushed = storage.pushed();
    if (!orders.some((o) => o.updated_at && pushed[o.id] !== o.updated_at) && !storage.closed().length) return;
    markActive();
    const id = window.setTimeout(() => void shareOrders(), 400);
    return () => window.clearTimeout(id);
  }, [orders, shareOrders, markActive]);

  // The order open here was paid or cancelled on another screen: show a fresh bill.
  useEffect(() => {
    if (activeId && !orders.some((o) => o.id === activeId)) {
      setActiveId(null);
      setToast(t("closed_elsewhere"));
    }
  }, [orders, activeId, t]);

  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(id);
  }, [undo]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const active = activeId ? orders.find((o) => o.id === activeId) ?? null : draft;
  const waiting = bills.filter((b) => !b.synced && !b.rejected).length;
  const rejected = bills.filter((b) => b.rejected).length;

  if (!config) {
    return (
      <div className="login">
        <div className="login-card">
          <p>{configError ? t("load_failed") : t("loading")}</p>
          {configError && <button className="btn primary big block" onClick={() => void loadConfig()}>{t("retry")}</button>}
        </div>
      </div>
    );
  }
  const s = config.settings;
  const printing = !!s.printing;
  const tablesOn = usesTables(config);
  const user = storage.user();
  const canReport = user?.role === "owner" || user?.role === "manager";
  const isOwner = user?.role === "owner";

  /** Every order gets the next token number. It comes from the server so two screens never share one; offline, from this screen. */
  async function giveToken(id: string) {
    if (tokenAsked.current.has(id)) return;
    tokenAsked.current.add(id);
    let token: number;
    try {
      token = await nextToken();
    } catch {
      token = takeToken();
    }
    setOrders((os) => os.map((o) => (o.id === id && o.token == null ? { ...o, token } : o)));
  }
  /** An order about to print must have its token; if the server hasn't answered yet, this screen gives one. */
  const withToken = (o: Order): Order => (o.token == null ? { ...o, token: takeToken() } : o);

  /** An open order with nothing in it doesn't keep a table busy or sit in the held list. */
  function dropIfEmpty() {
    const o = activeId ? orders.find((x) => x.id === activeId) : null;
    if (o && o.lines.length === 0 && !o.bill_no) {
      setOrders((os) => os.filter((x) => x.id !== o.id));
      setActiveId(null);
    }
  }
  /** A clean bill on the Billing screen. The order that was there stays open (held) if it has anything in it. */
  function freshBill(type: Order["type"] = "dine_in") {
    dropIfEmpty();
    setActiveId(null);
    setOpenWith(null);
    setDraft(newOrder(type, null, null));
  }
  /** Moves to a screen of the menu bar. Leaving Billing drops an empty order, so it doesn't hold a table. */
  function go(next: Screen) {
    setMenu(null);
    if (sameScreen(screen, next)) return;
    if (screen.kind === "billing") dropIfEmpty();
    setHistory((h) => [...h.filter((x) => !sameScreen(x, next)), next].slice(-12));
  }
  /** Home: the Billing screen with a fresh bill, like opening the old POS. */
  function home() {
    setMenu(null);
    if (screen.kind === "billing" && !activeId && !draft.lines.length) return;
    freshBill();
    setHistory([HOME]);
  }
  function back() {
    setMenu(null);
    if (history.length < 2) return home();
    if (screen.kind === "billing") dropIfEmpty();
    setHistory((h) => h.slice(0, -1));
  }
  /** Shows an order on the Billing screen; `then` opens a pop-up straight away (Pay from the dashboard). */
  function showOrder(o: Order, then: "pay" | null = null) {
    if (activeId !== o.id) dropIfEmpty();
    setActiveId(o.id);
    setOpenWith(then);
    if (screen.kind !== "billing") setHistory((h) => [...h.filter((x) => x.kind !== "billing"), HOME]);
  }
  function openTable(table: Table) {
    const existing = orders.find((o) => o.table_id === table.id);
    if (existing) return showOrder(existing);
    // Ask who is serving first; with no waiters set up, go straight in.
    if (config!.waiters.length) setStarting(table);
    else startTable(table, null);
  }
  function startTable(table: Table, waiter: number | null) {
    setStarting(null);
    const o = newOrder("dine_in", table, null, { waiter });
    setOrders((os) => [...os, o]);
    void giveToken(o.id);
    showOrder(o);
  }
  function update(fn: (o: Order) => Order) {
    if (!active) return;
    if (activeId === null) {
      // The fresh bill becomes an open order (shared with the other screens) once it has an item.
      const next = fn(draft);
      if (next.lines.length) {
        setOrders((os) => [...os, next]);
        setActiveId(next.id);
        setDraft(newOrder("dine_in", null, null));
        void giveToken(next.id);
      } else setDraft(next);
      return;
    }
    setOrders((os) => os.map((o) => (o.id === active.id ? fn(o) : o)));
  }
  /** Gives an order its bill number (once) and returns the bill as it stands, to print or show. */
  function billFor(o: Order, copy: Copy): Bill | null {
    if (!o.lines.length) return null;
    const withNo = withToken(o.bill_no ? o : { ...o, bill_no: takeBillNo() });
    setOrders((os) => os.map((x) => (x.id === o.id ? withNo : x)));
    const bill = toBill(withNo, s, "paid", [], null);
    if (printing) setPrint({ kind: "bill", bill, copy });
    return bill;
  }
  /**
   * Save & Print: at a busy counter this means "paid". The order is closed as paid in cash (everything on it counts as
   * sent to the kitchen), its bill prints if a printer is connected, and a fresh bill opens. No pop-up, no question.
   * Other ways of paying (UPI, card, split) go through the Cash button.
   */
  function saveAndPrint(waiter?: number | null) {
    if (!active || !active.lines.length || activeId === null) return;
    const order: Order = {
      ...active,
      ...(waiter !== undefined ? { waiter_staff_id: waiter } : {}),
      lines: active.lines.map((l) => ({ ...l, sent: l.qty })),
    };
    const total = totalsOf(order, s).total;
    if (total <= 0) return;
    const bill = finish(order, "paid", [{ mode: "cash", amount: total }], null);
    if (printing) setPrint({ kind: "bill", bill, copy: "Original" });
    setToast(t("paid_done", { no: bill.bill_no }));
  }
  /** Update Bill, on a bill opened from Invoice → Edit: saved as a new bill, paid the way the old one was. */
  function updateBill() {
    if (!active?.replaces || !active.lines.length || activeId === null) return;
    const total = totalsOf(active, s).total;
    if (total <= 0) return;
    const bill = finish({ ...active, lines: active.lines.map((l) => ({ ...l, sent: l.qty })) }, "paid", [{ mode: active.replaces.mode, amount: total }], null);
    if (printing) setPrint({ kind: "bill", bill, copy: "Original" });
    setToast(t("bill_updated", { old: active.replaces.bill_no, no: bill.bill_no }));
  }
  /** Invoice → Edit: the bill opens on the Billing screen. If it's already open (here or on another screen), that order opens. */
  function editBill(b: Bill) {
    const open = orders.find((o) => o.replaces?.client_id === b.client_id);
    if (open) return showOrder(open);
    const o = orderFromBill(b);
    setOrders((os) => [...os, o]);
    showOrder(o);
  }
  /** Invoice → Delete: the bill is kept as cancelled ("Deleted at the counter"). One not sent yet changes here. */
  async function deleteBill(b: Bill): Promise<boolean> {
    const mine = storage.bills().find((x) => x.client_id === b.client_id);
    if (mine && !mine.synced) {
      storage.setBills(cancelLocal(storage.bills(), b.client_id, DELETED_REASON).map((x) => (x.client_id === b.client_id ? { ...x, rejected: undefined } : x)));
      refreshBills();
      void sync();
      setToast(t("bill_deleted", { no: b.bill_no }));
      return true;
    }
    try {
      await api(`/billing/bills/${encodeURIComponent(b.client_id)}/delete`, { method: "POST" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setToast(e instanceof ApiError && e.code === "not_today" ? t("delete_not_today") : t("delete_offline"));
      return false;
    }
    storage.setBills(cancelLocal(storage.bills(), b.client_id, DELETED_REASON));
    refreshBills();
    setToast(t("bill_deleted", { no: b.bill_no }));
    return true;
  }
  function hold() {
    if (active?.lines.length) setToast(t("held"));
    freshBill();
  }
  /** CLOSE: back to the screen before (the dashboard), or a fresh bill. An order with items stays open. */
  function closeBill() {
    if (active?.lines.length) setToast(t("held"));
    if (history.length > 1) back();
    else freshBill();
  }
  function setType(type: Order["type"]) {
    update((o) => ({ ...o, type, ...(type === "parcel" ? { table_id: null, table_name: null } : {}) }));
  }
  function finish(order: Order, status: Bill["status"], payments: Payment[], reason: string | null) {
    const bill = toBill(withToken(order), s, status, payments, reason);
    // An edited bill that's saved: this screen's copy of the old one is kept as cancelled (the server does the same).
    const before = order.replaces && status === "paid" ? cancelLocal(storage.bills(), order.replaces.client_id, `${EDITED_REASON} ${bill.bill_no}`) : storage.bills();
    storage.setBills(pruneBills([...before, bill]));
    refreshBills();
    setOrders((os) => os.filter((o) => o.id !== order.id));
    setActiveId(null);
    setOpenWith(null);
    setDraft(newOrder("dine_in", null, null));
    void sync();
    return bill;
  }
  /**
   * Cancel, from the Billing screen or a dashboard card. Nobody is asked, not even why. Nothing reached the kitchen or
   * the guest: the order is just dropped. Otherwise a cancelled bill is kept ("No reason given"; the printed copy can
   * be explained later), so it shows in the cancellations report.
   */
  function cancelOrder(gone: Order, reopen: boolean) {
    // Cancel while editing a saved bill: the edit is dropped and the saved bill stays as it was.
    if (gone.replaces) {
      setOrders((os) => os.filter((o) => o.id !== gone.id));
      if (activeId === gone.id) setActiveId(null);
      setToast(t("edit_dropped", { no: gone.replaces.bill_no }));
      return;
    }
    if (!gone.bill_no && gone.lines.every((l) => l.sent === 0)) {
      setOrders((os) => os.filter((o) => o.id !== gone.id));
      if (activeId === gone.id) setActiveId(null);
    } else if (activeId === gone.id) finish(gone, "cancelled", [], gone.bill_no ? NO_REASON : NOT_PRINTED);
    else {
      // From the dashboard: the order on the Billing screen (if any) stays as it is.
      const bill = toBill(withToken(gone), s, "cancelled", [], gone.bill_no ? NO_REASON : NOT_PRINTED);
      storage.setBills(pruneBills([...storage.bills(), bill]));
      refreshBills();
      setOrders((os) => os.filter((o) => o.id !== gone.id));
      void sync();
    }
    // Undo brings the order back as a new one with the same token and items (the cancel may already have reached the
    // other screens). A cancelled bill stays on record, and the order gets a new bill number. From the Billing screen
    // it opens again there; from the dashboard it goes back on the dashboard.
    setUndo({ text: t("order_cancelled"), run: () => {
      const back: Order = { ...gone, id: uid(), bill_no: null, voids: [] };
      setOrders((os) => [...os, back]);
      if (reopen) showOrder(back);
    } });
  }
  const showBill = (b: Bill) => (printing ? setPrint({ kind: "bill", bill: b, copy: "Duplicate" }) : setView({ kind: "bill", bill: b }));
  /** The bill icon on a dashboard card: prints the bill (or shows it on screen). */
  function cardBill(o: Order) {
    const b = billFor(o, "Duplicate");
    if (b && !printing) setView({ kind: "bill", bill: b, orderId: o.id });
  }
  /** A new item was added from this screen: it can be billed at once, before the menu is loaded again. */
  function itemAdded(item: Item) {
    setConfig((c) => {
      if (!c) return c;
      const next = { ...c, items: [...c.items.filter((i) => i.id !== item.id), item] };
      storage.setConfig(next);
      return next;
    });
    setToast(t("item_added", { name: item.name }));
    void loadConfig();
  }
  const held = orders.filter((o) => o.id !== activeId);
  const counter = storage.counter();
  const restaurant = (s.bill_header || "").split("\n")[0] || t("app.title");

  return (
    <div className="app">
      <header className="titlebar">
        <strong className="rname">{restaurant}</strong>
        <span className="period">{t("period")}: {periodOf(businessDate())}</span>
        <span className="grow" />
        <span className={`net ${online ? "on" : "off"}`}>
          <span className="dot" /> <span className="net-label">{online ? t("online") : t("offline")}</span>
          {waiting > 0 && <> · {t("waiting", { n: waiting })}</>}
        </span>
        <div className="mb-wrap">
          <button className="user-btn" onClick={() => setMenu(menu === "user" ? null : "user")} aria-expanded={menu === "user"}>
            👤 <span className="uname">{user?.name}</span> · {counter?.code} ▾
          </button>
          {menu === "user" && (
            <Dropdown align="right" onClose={() => setMenu(null)}>
              <div className="dd-note">{user?.name} · {t("counter_code", { code: counter?.code ?? "" })}</div>
              <div className="dd-langs">
                {LANGUAGES.map((l) => <button key={l.code} className={`chip${lang === l.code ? " on" : ""}`} onClick={() => (setLang(l.code), setMenu(null))}>{l.label}</button>)}
              </div>
              {canReport && <a className="dd-item" href="/" onClick={() => setMenu(null)}>{t("admin_app")} <span className="muted small">↗</span></a>}
              <button className="dd-item danger" onClick={() => (setMenu(null), setAskLogout(true))}>{t("logout")}</button>
            </Dropdown>
          )}
        </div>
      </header>
      <nav className="menubar" aria-label={t("menu_bar")}>
        {/* Home from anywhere: a fresh bill on the Billing screen. An order with items stays open (held). */}
        <button className="mb mb-home" onClick={home} aria-label={t("home")} title={t("home")}>
          <span aria-hidden="true">🏠</span> <span className="mb-home-label">{t("home")}</span>
        </button>
        <button className={`mb${screen.kind === "billing" ? " on" : ""}`} onClick={() => (screen.kind === "billing" ? home() : go(HOME))}>{t("billing")}</button>
        <div className="mb-wrap">
          <button className={`mb${menu === "masters" ? " on" : ""}`} onClick={() => setMenu(menu === "masters" ? null : "masters")} aria-expanded={menu === "masters"}>{t("masters")} ▾</button>
          {menu === "masters" && (
            <Dropdown onClose={() => setMenu(null)}>
              {MASTERS.map((m) => isOwner
                ? <a key={m.key} className="dd-item" href={m.href} target="_blank" rel="noopener" onClick={() => setMenu(null)}>{t(m.key)} <span className="muted small">↗</span></a>
                : <span key={m.key} className="dd-item off">{t(m.key)}</span>)}
              <div className="dd-note">{isOwner ? t("opens_admin") : t("owner_only")}</div>
            </Dropdown>
          )}
        </div>
        <div className="mb-wrap">
          <button className={`mb${menu === "reports" || screen.kind === "report" ? " on" : ""}`} onClick={() => setMenu(menu === "reports" ? null : "reports")} aria-expanded={menu === "reports"}>{t("reports")} ▾</button>
          {menu === "reports" && (
            <Dropdown onClose={() => setMenu(null)}>
              {REPORTS.map((r) => (
                <button key={r.kind} className="dd-item" disabled={!canReport} onClick={() => go({ kind: "report", report: r.kind })}>{t(r.key)}</button>
              ))}
              {!canReport && <div className="dd-note">{t("manager_only")}</div>}
            </Dropdown>
          )}
        </div>
        <button className={`mb${screen.kind === "dashboard" ? " on" : ""}`} onClick={() => go({ kind: "dashboard" })}>
          {t("dashboard")}{orders.length > 0 && <span className="mb-count">{orders.length}</span>}
        </button>
        <button className={`mb${screen.kind === "dayend" ? " on" : ""}`} onClick={() => go({ kind: "dayend" })}>{t("summary")}</button>
        <button className={`mb${screen.kind === "items" ? " on" : ""}`} onClick={() => go({ kind: "items" })}>{t("item_master")}</button>
        {/* Language switch at the right end of the bar: one tap, no menu. */}
        <div className="mb-langs" role="group" aria-label={t("language")}>
          {LANGUAGES.map((l) => (
            <button key={l.code} lang={l.code} className={`mb-lang${lang === l.code ? " on" : ""}`} aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>{l.label}</button>
          ))}
        </div>
      </nav>
      {rejected > 0 && <div className="banner bad">{t("rejected", { n: rejected })}</div>}
      {billNumbersFull(counter) && <div className="banner bad">{t("numbers_full")}</div>}
      {cantSave && <div className="banner bad" role="alert">{t("storage_broken")}</div>}
      {clockOffMinutes() > 0 && <div className="banner bad">{t("clock_off", { n: clockOffMinutes() })}</div>}

      {screen.kind === "billing" && active && (
        <OrderScreen
          key={active.id}
          t={t} lang={lang} config={config} order={active} update={update} held={held} online={online}
          openWith={openWith}
          onHold={hold} onClose={closeBill} onPickHeld={(o) => showOrder(o)}
          onSavePrint={saveAndPrint} onBill={(copy) => billFor(active, copy)} onType={setType} onItemAdded={itemAdded}
          onUpdate={updateBill} onInvoices={() => go({ kind: "invoices" })}
          onPaid={(payments, change) => {
            const bill = finish(active, "paid", payments, null);
            setToast(t("paid_done", { no: bill.bill_no }));
            if (printing) {
              if (!active.bill_no || unsent(active).length) setPrint({ kind: "bill", bill, copy: "Original" });
            } else setView({ kind: "paid", bill, change });
          }}
          onCancel={() => {
            if (activeId === null) return setDraft(newOrder("dine_in", null, null));
            cancelOrder(active, true);
          }}
        />
      )}
      {screen.kind === "dashboard" && (tablesOn ? (
        <TablesScreen t={t} config={config} orders={orders} now={now} onTable={openTable}
          onOrder={(o) => showOrder(o)} onBill={cardBill} onPay={(o) => showOrder(o, "pay")} onCancel={(o) => cancelOrder(o, false)} />
      ) : (
        <OrdersScreen t={t} config={config} orders={orders} now={now} onNew={() => go(HOME)}
          onOrder={(o) => showOrder(o)} onBill={cardBill} onPay={(o) => showOrder(o, "pay")} onCancel={(o) => cancelOrder(o, false)} />
      ))}
      {screen.kind === "dayend" && (
        <Summary
          t={t} config={config} bills={bills} waiting={waiting} online={online} printing={printing}
          onSync={() => void sync()} onPrint={(date, list) => setPrint({ kind: "summary", date, bills: list })}
          onPrintItems={(date, list) => setPrint({ kind: "items", date, bills: list })}
          onOpen={showBill}
          onResend={(id) => void resend(id)}
          onLogout={() => setAskLogout(true)}
        />
      )}
      {screen.kind === "items" && <ItemMaster t={t} lang={lang} config={config} isOwner={isOwner} online={online} onItemAdded={itemAdded} onChanged={() => void loadConfig()} />}
      {screen.kind === "invoices" && (
        <InvoiceScreen t={t} config={config} bills={bills} online={online} printing={printing}
          onView={(b) => setView({ kind: "bill", bill: b })} onPrint={(b) => setPrint({ kind: "bill", bill: b, copy: "Duplicate" })}
          onEdit={editBill} onDelete={deleteBill} />
      )}
      {screen.kind === "report" && (
        <Report key={screen.report} t={t} config={config} kind={screen.report} printing={printing} online={online}
          onOpen={showBill} onPrint={(job) => setPrint(job)} />
      )}
      {starting && (
        <StartDialog t={t} config={config} table={starting} onClose={() => setStarting(null)}
          onStart={(waiter) => startTable(starting, waiter)} />
      )}
      {(view?.kind === "bill" || view?.kind === "paid") && (
        <BillDialog t={t} config={config} bill={view.bill} paid={view.kind === "paid"} change={view.kind === "paid" ? view.change : 0}
          onPrint={printing ? () => setPrint({ kind: "bill", bill: view.bill, copy: "Duplicate" }) : undefined}
          onPay={view.kind === "bill" && view.orderId && orders.some((o) => o.id === view.orderId)
            ? () => {
              const o = orders.find((x) => x.id === view.orderId)!;
              setView(null);
              showOrder(o, "pay");
            }
            : undefined}
          onClose={() => setView(null)} />
      )}
      {askLogout && (
        <Modal t={t} title={t("logout_confirm")} onClose={() => setAskLogout(false)}>
          {(orders.length > 0 || waiting > 0) && <p className="muted">{t("logged_out_note")}</p>}
          <div className="actions-row">
            <button className="btn big" onClick={() => setAskLogout(false)}>{t("close")}</button>
            <button className="btn big danger-solid" onClick={onLogout}>{t("logout")}</button>
          </div>
        </Modal>
      )}
      {undo ? (
        <div className="toast undo-toast" role="status">
          <span>{undo.text}</span>
          <button className="btn" onClick={() => (undo.run(), setUndo(null))}>↶ {t("undo")}</button>
        </div>
      ) : toast && <div className="toast" role="status">{toast}</div>}
      <PrintArea t={t} job={print} settings={s} config={config} onDone={() => setPrint(null)} />
    </div>
  );
}

/* ---------------- Pop-ups and menus: every one has ✕, closes on Esc and on a tap outside it ---------------- */

/** Open pop-ups, newest last: Esc closes only the top one. */
const openModals: object[] = [];

function Modal({ t, title, onClose, className = "", children }: {
  t: T; title?: React.ReactNode; onClose: () => void; className?: string; children: React.ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  // Closes on a tap that starts and ends on the dark backdrop (not a drag that ends there).
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const me = {};
    openModals.push(me);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openModals[openModals.length - 1] === me) {
        e.preventDefault();
        close.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      openModals.splice(openModals.indexOf(me), 1);
    };
  }, []);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => e.target === e.currentTarget && downOnBackdrop.current && close.current()}>
      <div className={`dialog ${className}`}>
        <div className="dialog-head">
          {title ? <h2>{title}</h2> : <span />}
          <button className="x-btn" onClick={onClose} aria-label={t("close")} title={t("close")}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A menu that drops down from the menu bar. A tap anywhere else, or Esc, closes it. */
function Dropdown({ align = "left", onClose, children }: { align?: "left" | "right"; onClose: () => void; children: React.ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // On a phone or upright tablet the menu bar scrolls sideways, and some phone browsers clip or bury a menu drawn
  // inside it. There the menu is drawn on top of the whole page instead, just under the menu bar.
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  const top = narrow ? Math.round((document.querySelector(".menubar")?.getBoundingClientRect().bottom ?? 96) + 4) : undefined;
  const menu = (
    <>
      <div className="dd-backdrop" onClick={onClose} />
      <div className={`dd ${align}`} role="menu" style={top !== undefined ? { top } : undefined}>{children}</div>
    </>
  );
  return narrow ? createPortal(menu, document.body) : menu;
}

/* ---------------- Dashboard: open orders, and the tables when the table map is on ---------------- */

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

const waiterName = (config: Config, id: number | null) => {
  const w = config.waiters.find((x) => x.id === id);
  return w ? `${w.waiter_code ? `${w.waiter_code} · ` : ""}${w.name}` : "";
};

/** Running: ordering, or items added since the bill printed. Billed: the bill is printed and nothing new since. */
function orderState(o: Order): "running" | "billed" {
  return o.bill_no && unsent(o).length === 0 ? "billed" : "running";
}

/** A card on the dashboard. An open order has the old POS's three buttons (bill, pay and open), and Cancel: one tap, Undo for a few seconds. */
function OrderCard({ t, state, className = "", onOpen, onBill, onPay, onCancel, children }: {
  t: T; state: "running" | "billed" | "vacant"; className?: string; onOpen: () => void; onBill?: () => void; onPay?: () => void; onCancel?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`table-card ${state} ${className}`}>
      <button className="tc-main" onClick={onOpen}>{children}</button>
      {state !== "vacant" && (
        <div className="tc-icons">
          <button onClick={onBill}><span aria-hidden="true">🖨</span>{t("bill")}</button>
          <button onClick={onPay}><span aria-hidden="true">₹</span>{t("pay_short")}</button>
          <button onClick={onOpen}><span aria-hidden="true">👁</span>{t("open")}</button>
          <button className="tc-cancel" onClick={onCancel}><span aria-hidden="true">✕</span>{t("cancel_short")}</button>
        </div>
      )}
    </div>
  );
}

function TablesScreen({ t, config, orders, now, onTable, onOrder, onBill, onPay, onCancel }: {
  t: T; config: Config; orders: Order[]; now: number; onTable: (t: Table) => void; onOrder: (o: Order) => void; onBill: (o: Order) => void; onPay: (o: Order) => void;
  onCancel: (o: Order) => void;
}) {
  const [find, setFind] = useState("");
  const [only, setOnly] = useState<"all" | "running" | "billed" | "vacant">("all");
  const areas = [...new Set(config.tables.map((x) => x.area))];
  // Parcels and orders without a table are listed above the tables.
  const loose = orders.filter((o) => o.table_id === null).sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  const s = config.settings;
  const stateOf = (table: Table) => {
    const o = orders.find((x) => x.table_id === table.id);
    return o ? orderState(o) : "vacant";
  };
  const shown = (table: Table) => (only === "all" || stateOf(table) === only) && (!find.trim() || table.name.toLowerCase().includes(find.trim().toLowerCase()));
  const count = (st: "running" | "billed" | "vacant") => config.tables.filter((x) => stateOf(x) === st).length;
  return (
    <main className="tables-screen">
      <div className="area-tabs">
        <label className="find">
          <input className="search" inputMode="numeric" placeholder={t("enter_table_no")} value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        {find && <button className="x-btn" onClick={() => setFind("")} aria-label={t("clear")}>✕</button>}
        <span className="grow" />
        <span className="legend">
          <button className={`chip${only === "all" ? " on" : ""}`} onClick={() => setOnly("all")}>{t("all")}</button>
          {(["running", "billed", "vacant"] as const).map((st) => (
            <button key={st} className={`state-chip ${st}${only === st ? " on" : ""}`} onClick={() => setOnly(only === st ? "all" : st)}>{t(st)} · {count(st)}</button>
          ))}
        </span>
      </div>
      {loose.length > 0 && only !== "vacant" && !find && (
        <div className="table-grid">
          {loose.filter((o) => only === "all" || orderState(o) === only).map((o) => (
            <OrderCard key={o.id} t={t} state={orderState(o)} onOpen={() => onOrder(o)} onBill={() => onBill(o)} onPay={() => onPay(o)} onCancel={() => onCancel(o)}>
              <span className="tc-top"><span className="name">{orderLabel(o, t)}</span><b className={`state ${orderState(o)}`}>{t(orderState(o))}</b></span>
              <span className="amt num">{formatINR(totalsOf(o, s).total)}</span>
              <span className="meta">{t("min", { n: minutesSince(o.opened_at, now) })}{o.waiter_staff_id ? ` · ${waiterName(config, o.waiter_staff_id)}` : ""}</span>
            </OrderCard>
          ))}
        </div>
      )}
      {areas.map((area) => {
        const list = config.tables.filter((x) => x.area === area && shown(x));
        if (!list.length) return null;
        return (
          <section key={area} className="area">
            <h2 className="area-name">{area || t("tables")}</h2>
            <div className="table-grid">
              {list.map((table) => {
                const o = orders.find((x) => x.table_id === table.id);
                const st = o ? orderState(o) : "vacant";
                return (
                  <OrderCard key={table.id} t={t} state={st} onOpen={() => onTable(table)} onBill={o && (() => onBill(o))} onPay={o && (() => onPay(o))} onCancel={o && (() => onCancel(o))}>
                    <span className="tc-top"><span className="name">{table.name}</span><b className={`state ${st}`}>{t(st)}</b></span>
                    {o ? (
                      <>
                        <span className="amt num">{formatINR(totalsOf(o, s).total)}</span>
                        <span className="meta">👥 {t("seats", { n: table.seats })} · {t("min", { n: minutesSince(o.opened_at, now) })}{o.waiter_staff_id ? ` · ${waiterName(config, o.waiter_staff_id)}` : ""}</span>
                      </>
                    ) : (
                      <span className="meta">👥 {t("seats", { n: table.seats })}</span>
                    )}
                  </OrderCard>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}

/** The dashboard without the table map: every open order (held or billed), oldest first. */
function OrdersScreen({ t, config, orders, now, onNew, onOrder, onBill, onPay, onCancel }: {
  t: T; config: Config; orders: Order[]; now: number; onNew: () => void; onOrder: (o: Order) => void; onBill: (o: Order) => void; onPay: (o: Order) => void;
  onCancel: (o: Order) => void;
}) {
  const s = config.settings;
  const list = [...orders].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  return (
    <main className="tables-screen">
      <div className="area-tabs">
        <h2>{t("open_orders")} {list.length > 0 && <span className="pill">{list.length}</span>}</h2>
        <span className="grow" />
        <span className="legend"><b className="state running">{t("running")}</b><b className="state billed">{t("billed")}</b></span>
      </div>
      {list.length === 0 ? (
        <div className="empty-note center">
          <p className="muted">{t("no_open_orders")}</p>
          <button className="btn primary big" onClick={onNew}>{t("billing")}</button>
        </div>
      ) : (
        <div className="order-grid">
          {list.map((o) => (
            <OrderCard key={o.id} t={t} state={orderState(o)} className="order-card" onOpen={() => onOrder(o)} onBill={() => onBill(o)} onPay={() => onPay(o)} onCancel={() => onCancel(o)}>
              <span className="tc-top"><span className="name">{orderLabel(o, t)}</span><b className={`state ${orderState(o)}`}>{t(orderState(o))}</b></span>
              <span className="amt num">{formatINR(totalsOf(o, s).total)}</span>
              <span className="meta">
                {t("min", { n: minutesSince(o.opened_at, now) })}
                {o.waiter_staff_id ? ` · ${waiterName(config, o.waiter_staff_id)}` : o.type === "dine_in" && needsWaiter(o, config) ? ` · ⚠ ${t("waiter_needed")}` : ""}
              </span>
            </OrderCard>
          ))}
        </div>
      )}
    </main>
  );
}

/* ---------------- Billing: the menu and the order, like the old POS's Billing screen ---------------- */

type OrderDialog = "pay" | "discount" | "waiter" | "waiter_then_pay" | "waiter_then_save" | "table" | "bill" | "held";

/** A tile's price as the old POS shows it: "₹ 220.00". */
const tilePrice = (paise: number) => `₹ ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function OrderScreen({ t, lang, config, order, update, held, online, openWith, onHold, onClose, onPickHeld, onSavePrint, onBill, onType, onPaid, onCancel, onItemAdded, onUpdate, onInvoices }: {
  t: T; lang: Lang; config: Config; order: Order; update: (fn: (o: Order) => Order) => void; held: Order[]; online: boolean;
  openWith: "pay" | null; onHold: () => void; onClose: () => void; onPickHeld: (o: Order) => void;
  onSavePrint: (waiter?: number | null) => void; onBill: (copy: Copy) => Bill | null; onType: (type: Order["type"]) => void;
  onPaid: (p: Payment[], change: number) => void; onCancel: () => void; onItemAdded: (item: Item) => void;
  onUpdate: () => void; onInvoices: () => void;
}) {
  const s = config.settings;
  const printing = !!s.printing;
  const favourites = useMemo(() => favouritesOf(config.items), [config.items]);
  const missingWaiter = needsWaiter(order, config);
  const [cat, setCat] = useState<number | "fav">(config.categories[0]?.id ?? "fav");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<OrderDialog | null>(() => (openWith === "pay" && order.lines.length ? (missingWaiter ? "waiter_then_pay" : "pay") : null));
  const [choosing, setChoosing] = useState<Item | null>(null);
  const [billPreview, setBillPreview] = useState<Bill | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  /** The bill line whose quantity is being typed in (tap the number: 30 of an item is two taps, not 29). */
  const [qtyFor, setQtyFor] = useState<string | null>(null);
  const qtyLine = qtyFor ? order.lines.find((l) => l.key === qtyFor) ?? null : null;
  /** The new-item pop-up, with the name typed in the search so far. */
  const [adding, setAdding] = useState<string | null>(null);
  const totals = totalsOf(order, s);
  const totalQty = order.lines.reduce((n, l) => n + l.qty, 0);
  const listRef = useRef<HTMLDivElement>(null);
  const catName = (c: Config["categories"][number]) => (lang === "hi" && c.name_hi) || (lang === "kn" && c.name_kn) || c.name;
  // Item names follow the counter's language when the owner has filled them in; bills and the kitchen keep the English name.
  const localName = (i: Item | undefined) => (i && ((lang === "hi" && i.name_hi) || (lang === "kn" && i.name_kn))) || null;
  const itemById = useMemo(() => new Map(config.items.map((i) => [i.id, i])), [config.items]);
  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  const empty = order.lines.length === 0;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return config.items.filter((i) => [i.name, i.short_name, i.name_hi, i.name_kn].some((n) => (n ?? "").toLowerCase().includes(q)));
    return cat === "fav" ? favourites : config.items.filter((i) => i.category_id === cat);
  }, [query, cat, config.items, favourites]);

  function add(item: Item, pick: Choice = {}, qty = 1) {
    update((o) => addItem(o, item, config.categories, s, pick, qty));
    window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 0);
  }
  function tap(item: Item) {
    if (hasChoices(item)) setChoosing(item);
    else add(item);
  }
  function bill() {
    const b = onBill("Duplicate");
    if (b && !printing) {
      setBillPreview(b);
      setDialog("bill");
    }
  }
  const pay = () => setDialog(missingWaiter ? "waiter_then_pay" : "pay");

  return (
    <main className="order-screen">
      <nav className="cats" aria-label="Categories">
        {config.categories.map((c) => (
          <button key={c.id} className={`cat${cat === c.id && !query ? " on" : ""}`} onClick={() => (setCat(c.id), setQuery(""))}>{catName(c)}</button>
        ))}
        {favourites.length > 0 && <button className={`cat fav${cat === "fav" && !query ? " on" : ""}`} onClick={() => (setCat("fav"), setQuery(""))}>{t("favourites")}</button>}
        <button className="cat add" onClick={() => setAdding(query.trim())}>＋ {t("add_item")}</button>
      </nav>

      <section className="items">
        <div className="item-grid">
          {items.length === 0 && (
            <div className="center no-items">
              <p className="muted">{t("no_items_found")}</p>
              {query.trim() && <button className="btn big" onClick={() => setAdding(query.trim())}>＋ {t("add_as_item", { name: query.trim() })}</button>}
            </div>
          )}
          {items.map((i) => {
            const inOrder = order.lines.filter((l) => l.item_id === i.id).reduce((n, l) => n + l.qty, 0);
            return (
              <button key={i.id} className={`item${inOrder ? " in" : ""}`} onClick={() => tap(i)}>
                <span className="iname">{localName(i) || i.short_name || i.name}</span>
                <span className="ifoot">
                  {i.favourite ? <span className="star" aria-label={t("favourites")}>★</span> : null}
                  <span className="price num">{tilePrice(i.price)}</span>
                  {hasChoices(i) && <span className="more" aria-hidden="true">⋯</span>}
                </span>
                {inOrder > 0 && <span className="badge">{inOrder}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <aside className={`ticket${order.replaces ? " editing" : ""}`}>
        <div className="ticket-top">
          <div className="type-toggle" role="group">
            <button className={order.type === "dine_in" ? "on" : ""} onClick={() => order.type !== "dine_in" && onType("dine_in")}><span aria-hidden="true">🍴</span>{t("dine_in")}</button>
            <button className={order.type === "parcel" ? "on" : ""} onClick={() => order.type !== "parcel" && onType("parcel")}><span aria-hidden="true">🛍</span>{t("parcel")}</button>
          </div>
          <strong className="num date top-date">{today}</strong>
          <button className="btn hold-btn" onClick={() => setDialog("held")}>{t("hold_count", { n: held.length })}</button>
          <button className="btn hold-btn" onClick={onInvoices}>☰ {t("invoice")}</button>
        </div>
        {order.replaces && <div className="editing-bar" role="status">✎ {t("editing_bill", { no: order.replaces.bill_no })}</div>}
        <div className="ticket-fields">
          <div className="field"><span className="muted small">{t("token_no")}</span><strong className="num">{order.token ?? "—"}</strong></div>
          {order.type === "dine_in" && (
            <button className="field" onClick={() => order.table_id === null && setDialog("table")} disabled={order.table_id !== null}>
              <span className="muted small">{t("table")}</span><strong>{order.table_name ?? "—"}</strong>
            </button>
          )}
          <button className={`field grow${missingWaiter && !empty ? " need" : ""}`} onClick={() => setDialog("waiter")} disabled={!config.waiters.length}>
            <span className="muted small">{t("waiter_short")}</span>
            <strong>{order.waiter_staff_id ? waiterName(config, order.waiter_staff_id) : config.waiters.length ? (missingWaiter && !empty ? `⚠ ${t("waiter_needed")}` : t("no_waiter")) : "—"}</strong>
          </button>
        </div>
        <div className="select-product">
          <span className="muted small">{t("select_product")}</span>
          <input className="search" placeholder={`🔍 ${t("search")}`} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && items.length === 1 && (tap(items[0]), setQuery(""))} />
          {query && <button className="x-btn" onClick={() => setQuery("")} aria-label={t("clear")}>✕</button>}
        </div>
        <div className="grid-head"><span className="lsr">Sr</span><span className="lx" /><span>{t("item_name")}<span className="tag-inline"> · {t("modifier")}</span></span><span className="lmod">{t("modifier")}</span><span>{t("qty")}</span><span>{t("price")}</span><span>{t("amount")}</span></div>
        <div className="lines" ref={listRef}>
          {empty && <p className="muted center">{t("order_empty")}</p>}
          {order.lines.map((l, n) => (
            <div key={l.key} className={`line${l.sent >= l.qty ? " sent" : ""}`}>
              <span className="lsr num">{n + 1}</span>
              {/* The old POS's red ✕ beside each item: takes the whole line off in one tap. */}
              <button className="lx" onClick={() => update((o) => changeQty(o, l.key, -l.qty, storage.user()?.id ?? null))}
                aria-label={t("remove")} title={t("remove")}>✕</button>
              <div className="lname" onClick={() => setNoteFor(noteFor === l.key ? null : l.key)}>
                <span>{(l.item_id !== null && localName(itemById.get(l.item_id))) || l.name}</span>
                {lineTag(l) && <span className="tag tag-inline">{lineTag(l)}</span>}
                {l.note && <span className="note">✎ {l.note}</span>}
              </div>
              <span className="lmod tag">{[l.variation, l.modifier].filter(Boolean).join(" · ")}</span>
              <div className="stepper">
                {/* The ✕ takes a line off; − stops at 1 so a quick double tap doesn't remove the item by mistake. */}
                <button disabled={l.qty <= 1} onClick={() => update((o) => changeQty(o, l.key, -1, storage.user()?.id ?? null))} aria-label="−">−</button>
                <button className="qty-btn num" onClick={() => setQtyFor(l.key)} aria-label={t("how_many")}>{l.qty}</button>
                <button onClick={() => update((o) => changeQty(o, l.key, +1))} aria-label="+">+</button>
              </div>
              <span className="lprice num">{formatINR(l.price, { symbol: false })}</span>
              <span className="lamt num">{formatINR(l.price * l.qty, { symbol: false })}</span>
              {noteFor === l.key && (
                <input className="note-input" autoFocus placeholder={t("note")} defaultValue={l.note ?? ""}
                  onBlur={(e) => (update((o) => ({ ...o, lines: o.lines.map((x) => (x.key === l.key ? { ...x, note: e.target.value.trim() || null } : x)) })), setNoteFor(null))}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              )}
            </div>
          ))}
        </div>
        <div className="sums">
          {(totals.discount > 0 || totals.tax > 0 || totals.round_off !== 0) && (
            <div className="sum-small">
              {totals.discount > 0 && <Row label={t("discount")} value={`−${formatINR(totals.discount)}`} />}
              {totals.tax > 0 && <Row label={`${t("gst")}${s.prices_include_tax ? " (incl.)" : ""}`} value={formatINR(totals.tax)} />}
              {totals.round_off !== 0 && <Row label={t("round_off")} value={formatINR(totals.round_off)} />}
            </div>
          )}
          <div className="grand">
            <button className="link" disabled={empty} onClick={() => setDialog("discount")}>{t("discount")}</button>
            <span className="qty-total num">{totalQty}</span>
            <span className="num">{formatINR(totals.total)}</span>
          </div>
        </div>
        {/* The old POS's buttons, in its order: Bill, Save & Print, Cash, Amount; then HOLD, CLOSE, Cancel. */}
        <div className="actions">
          {order.replaces
            ? <button className="btn bill-btn update" disabled={empty || totals.total <= 0} onClick={onUpdate}><span aria-hidden="true">✔</span> {t("update_bill")}</button>
            : <button className="btn bill-btn" disabled={empty} onClick={bill}><span aria-hidden="true">✔</span> {t("bill")}</button>}
          <button className="btn save-print" disabled={empty || totals.total <= 0} onClick={() => (missingWaiter ? setDialog("waiter_then_save") : onSavePrint())}>🖨 {printing ? t("save_print") : t("save_only")}</button>
          <button className="btn cash" disabled={empty || totals.total <= 0} onClick={pay}>
            <span className="ok" aria-hidden="true">✔</span><span aria-hidden="true" className="cash-icon">💵</span><span>{t("cash")}</span>
            <strong className="num">{formatINR(totals.total)}</strong>
          </button>
          {/* The old POS's Amount box beside Cash: what this bill comes to. */}
          <div className="amount-box" aria-live="polite"><span>{t("amount")}</span><strong className="num">{formatINR(totals.total)}</strong></div>
          <button className="btn hold" onClick={onHold}>❚❚ {t("hold").toUpperCase()}</button>
          <button className="btn close-btn" onClick={onClose}><span className="x-red" aria-hidden="true">✕</span> {t("close").toUpperCase()}</button>
          <button className="btn cancel" disabled={empty && !order.bill_no} onClick={onCancel}><span className="x-red" aria-hidden="true">✕</span> {t("cancel_short")}</button>
        </div>
      </aside>

      {adding !== null && (
        <AddItemDialog t={t} lang={lang} config={config} online={online} name={adding} category={typeof cat === "number" ? cat : null}
          onClose={() => setAdding(null)}
          onAdded={(item) => {
            setAdding(null);
            setQuery("");
            setCat(item.category_id);
            onItemAdded(item);
            add(item);
          }} />
      )}
      {qtyLine && (
        <QtyDialog t={t} name={(qtyLine.item_id !== null && localName(itemById.get(qtyLine.item_id))) || qtyLine.name} current={qtyLine.qty}
          onClose={() => setQtyFor(null)}
          onDone={(n) => {
            setQtyFor(null);
            update((o) => changeQty(o, qtyLine.key, n - qtyLine.qty, n < qtyLine.qty ? storage.user()?.id ?? null : null));
          }} />
      )}
      {choosing && (
        <ChoiceDialog t={t} item={choosing} name={localName(choosing) || choosing.name} onClose={() => setChoosing(null)}
          onAdd={(pick, qty) => (setChoosing(null), add(choosing, pick, qty))} />
      )}
      {dialog === "pay" && <PayDialog t={t} due={totals.total} onClose={() => setDialog(null)} onDone={(p, change) => (setDialog(null), onPaid(p, change))} />}
      {dialog === "discount" && (
        <DiscountDialog t={t} subtotal={totals.subtotal} current={order.discount} currentReason={order.discount_reason ?? null}
          settings={config.settings} approvers={config.approvers ?? []} onClose={() => setDialog(null)}
          onDone={(d, reason, by) => (setDialog(null), update((o) => ({ ...o, discount: d, discount_reason: d ? reason : null, discount_approved_by: d ? by : null })))} />
      )}
      {(dialog === "waiter" || dialog === "waiter_then_pay" || dialog === "waiter_then_save") && (
        <WaiterDialog t={t} config={config} current={order.waiter_staff_id} optional={order.type === "parcel" || s.waiter_required === false}
          onClose={() => setDialog(null)}
          onPick={(id) => {
            // Save & Print with no waiter picked yet: pick one, then the order is paid straight away.
            if (dialog === "waiter_then_save" && (id || order.type === "parcel")) return (setDialog(null), onSavePrint(id));
            update((o) => ({ ...o, waiter_staff_id: id }));
            setDialog(dialog === "waiter_then_pay" && (id || order.type === "parcel") ? "pay" : null);
          }} />
      )}
      {dialog === "table" && (
        <TableNoDialog t={t} current={order.table_name} onClose={() => setDialog(null)}
          onDone={(name) => (update((o) => ({ ...o, table_name: name })), setDialog(null))} />
      )}
      {dialog === "bill" && billPreview && (
        <BillDialog t={t} config={config} bill={billPreview} onClose={() => setDialog(null)} onPay={() => setDialog(missingWaiter ? "waiter_then_pay" : "pay")} />
      )}
      {dialog === "held" && (
        <HeldDialog t={t} config={config} orders={held} onClose={() => setDialog(null)} onPick={(o) => (setDialog(null), onPickHeld(o))} />
      )}
    </main>
  );
}

/** HOLD (n): the bills kept open on hold (and printed bills waiting for payment), to pick one up again. */
function HeldDialog({ t, config, orders, onClose, onPick }: { t: T; config: Config; orders: Order[]; onClose: () => void; onPick: (o: Order) => void }) {
  const list = [...orders].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  return (
    <Modal t={t} title={`${t("held_bills")} (${list.length})`} onClose={onClose} className="wide">
      {list.length === 0 ? <p className="muted center">{t("no_held")}</p> : (
        <div className="pick-list">
          {list.map((o) => (
            <button key={o.id} className={`pick-row ${orderState(o)}`} onClick={() => onPick(o)}>
              <span className="pr-name">{orderLabel(o, t)}</span>
              <b className={`state ${orderState(o)}`}>{t(orderState(o))}</b>
              <span className="muted">{formatTime(new Date(o.opened_at))}{o.waiter_staff_id ? ` · ${waiterName(config, o.waiter_staff_id)}` : ""}</span>
              <span className="muted">{t("items", { n: o.lines.reduce((n, l) => n + l.qty, 0) })}</span>
              <strong className="num">{formatINR(totalsOf(o, config.settings).total)}</strong>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Today's bills from every screen, the newest on top, as the old POS's Invoice list. Tap one to see or reprint it. */
function useDayBills(date: string, online: boolean, mine: Bill[], reload = 0): Bill[] {
  const [shared, setShared] = useState<Bill[]>([]);
  useEffect(() => {
    if (!online) return;
    let live = true;
    const load = () => !document.hidden && fetchDay(date).then((b) => live && setShared(b)).catch(() => {});
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [date, online, reload]);
  const own = mine.filter((b) => b.business_date === date);
  const ownIds = new Set(own.map((b) => b.client_id));
  return [...own, ...shared.filter((b) => !ownIds.has(b.client_id))].sort((a, b) => a.closed_at.localeCompare(b.closed_at));
}

/**
 * Invoice: today's bills from every screen, like the old POS's invoice list. All / Dine-in / Parcel, and on each bill
 * View, Print, Edit (opens it on the Billing screen with Update Bill) and Delete (kept as cancelled). Today's Sales at
 * the foot.
 */
function InvoiceScreen({ t, config, bills, online, printing, onView, onPrint, onEdit, onDelete }: {
  t: T; config: Config; bills: Bill[]; online: boolean; printing: boolean;
  onView: (b: Bill) => void; onPrint: (b: Bill) => void; onEdit: (b: Bill) => void; onDelete: (b: Bill) => Promise<boolean>;
}) {
  const [reload, setReload] = useState(0);
  const today = useDayBills(businessDate(), online, bills, reload);
  const [mode, setMode] = useState<"all" | Order["type"]>("all");
  const [find, setFind] = useState("");
  const [asking, setAsking] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);
  const f = find.trim().toLowerCase();
  const list = [...today].reverse().filter((b) => (mode === "all" || b.order_type === mode)
    && (!f || b.bill_no.toLowerCase().includes(f) || String(b.token ?? "") === f));
  const sales = list.filter((b) => b.status === "paid").reduce((n, b) => n + b.total, 0);
  const cols = "minmax(130px, 1.1fr) 112px 90px 70px minmax(0, 1fr) minmax(0, 1fr) 64px 100px 64px 64px 64px 64px";
  return (
    <main className="summary invoices">
      <div className="report-head">
        <div className="type-toggle" role="group">
          {(["all", "dine_in", "parcel"] as const).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              <span aria-hidden="true">{m === "all" ? "▦" : m === "dine_in" ? "🍴" : "🛍"}</span>{m === "all" ? t("all") : t(m)}
            </button>
          ))}
        </div>
        <input className="search" inputMode="numeric" placeholder={t("find_bill")} value={find} onChange={(e) => setFind(e.target.value)} />
        <span className="grow" />
        <strong className="todays-sales">{t("todays_sales")}: <span className="num">{formatINR(sales)}</span></strong>
      </div>
      <div className="rtable inv-table fit r-invoices" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="rrow rhead">
          <span>{t("invoice_no")}</span><span>{t("invoice_date")}</span><span>{t("order_mode")}</span><span>{t("table")}</span><span>{t("waiter")}</span>
          <span>{t("invoice_type")}</span><span className="r">{t("token_no")}</span><span className="r">{t("amount")}</span>
          <span className="c">{t("view")}</span><span className="c">{t("print")}</span><span className="c">{t("edit")}</span><span className="c">{t("delete")}</span>
        </div>
        {list.map((b) => {
          const live = b.status === "paid";
          return (
            <div key={b.client_id} className={`rrow${live ? "" : " cancelled"}`}>
              <span className="num">{b.bill_no}</span>
              <span className="num">{dmy(b.business_date)}</span>
              <span>{b.order_type === "parcel" ? "PARCEL" : "DINEIN"}</span>
              <span>{b.table_name ?? "—"}</span>
              <span className="muted">{waiterName(config, b.waiter_staff_id) || "—"}</span>
              <span className="muted">{live ? b.payments.map((p) => t(p.mode as Key)).join(" + ") : `${t("cancelled")}: ${b.cancel_reason ?? ""}`}</span>
              <span className="num r">{b.token ?? "—"}</span>
              <strong className="num r">{money(b.total)}</strong>
              <button className="icon-btn" onClick={() => onView(b)} aria-label={t("view")} title={t("view")}>👁</button>
              <button className="icon-btn" onClick={() => onPrint(b)} disabled={!printing} aria-label={t("print")} title={printing ? t("print") : t("no_printer")}>🖨</button>
              <button className="icon-btn" onClick={() => onEdit(b)} disabled={!live} aria-label={t("edit")} title={t("edit")}>✎</button>
              <button className="icon-btn danger" onClick={() => setAsking(b)} disabled={!live} aria-label={t("delete")} title={t("delete")}>🗑</button>
            </div>
          );
        })}
        {list.length === 0 && <p className="muted center">{t("no_invoices")}</p>}
      </div>
      <p className="muted small">{t("invoice_note")}</p>
      {asking && (
        <Modal t={t} title={t("delete_confirm", { no: asking.bill_no })} onClose={() => setAsking(null)}>
          <p className="muted">{t("delete_note", { amount: formatINR(asking.total) })}</p>
          <div className="actions-row">
            <button className="btn big" onClick={() => setAsking(null)}>{t("close")}</button>
            <button className="btn big danger-solid" disabled={busy} onClick={async () => {
              setBusy(true);
              const ok = await onDelete(asking);
              setBusy(false);
              if (ok) {
                setAsking(null);
                setReload((n) => n + 1);
              }
            }}>🗑 {t("delete")}</button>
          </div>
        </Modal>
      )}
    </main>
  );
}

/** Tapping an item with choices: pick the variation (one, each with its price) and an add-on (at most one), like the old POS. */
function ChoiceDialog({ t, item, name, onClose, onAdd }: { t: T; item: Item; name: string; onClose: () => void; onAdd: (pick: Choice, qty: number) => void }) {
  const variations = item.variations ?? [];
  const addons = item.addons ?? [];
  const [variation, setVariation] = useState<ItemOption | null>(variations[0] ?? null);
  const [addon, setAddon] = useState<ItemOption | null>(null);
  const [qty, setQty] = useState(1);
  const [typing, setTyping] = useState(false);
  const unit = (variation?.price ?? item.price) + (addon?.price ?? 0);
  return (
    <Modal t={t} title={name} onClose={onClose} className="wide choice-dialog">
      {variations.length > 0 && (
        <section>
          <h3>{t("variation")} <span className="muted small">({t("pick_one")})</span></h3>
          <div className="choice-grid">
            {variations.map((v) => (
              <button key={v.name} className={`choice${variation?.name === v.name ? " on" : ""}`} onClick={() => setVariation(v)}>
                <span>{v.name}</span><span className="num">{formatINR(v.price)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {addons.length > 0 && (
        <section>
          <h3>{t("addon")} <span className="muted small">({t("pick_one")})</span></h3>
          <div className="choice-grid">
            {addons.map((a) => (
              <button key={a.name} className={`choice${addon?.name === a.name ? " on" : ""}`} onClick={() => setAddon(addon?.name === a.name ? null : a)}>
                <span>{a.name}</span><span className="num">{a.price ? `+${formatINR(a.price)}` : formatINR(0)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="choice-foot">
        <div className="stepper big">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="−">−</button>
          <button className="qty-btn num" onClick={() => setTyping(true)} aria-label={t("how_many")}>{qty}</button>
          <button onClick={() => setQty((q) => Math.min(QTY_MAX, q + 1))} aria-label="+">+</button>
        </div>
        {typing && <QtyDialog t={t} name={name} current={qty} onClose={() => setTyping(false)} onDone={(n) => (setTyping(false), n > 0 && setQty(n))} />}
        <button className="btn big" onClick={onClose}>{t("cancel_short")}</button>
        <button className="btn big primary grow" disabled={variations.length > 0 && !variation} onClick={() => onAdd({ variation, addon }, qty)}>
          {t("save")} · {formatINR(unit * qty)}
        </button>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="sum-row"><span>{label}</span><span className="num">{value}</span></div>;
}

/* ---------------- Waiter, table number, kitchen and bill on screen ---------------- */

/** Big buttons, one per waiter, with their ID. Tapping one picks them. */
function WaiterGrid({ config, current, onPick }: { config: Config; current: number | null; onPick: (id: number) => void }) {
  return (
    <div className="waiter-grid">
      {config.waiters.map((w) => (
        <button key={w.id} className={`waiter${current === w.id ? " on" : ""}`} onClick={() => onPick(w.id)}>
          {w.waiter_code && <span className="wcode">{w.waiter_code}</span>}
          <span className="wname">{w.name}</span>
        </button>
      ))}
    </div>
  );
}

function WaiterDialog({ t, config, current, optional, onClose, onPick }: {
  t: T; config: Config; current: number | null; optional: boolean; onClose: () => void; onPick: (id: number | null) => void;
}) {
  return (
    <Modal t={t} title={t("pick_waiter")} onClose={onClose} className="wide">
      <WaiterGrid config={config} current={current} onPick={onPick} />
      {optional && current !== null && <button className="btn big" onClick={() => onPick(null)}>{t("no_waiter")}</button>}
    </Modal>
  );
}

/** Opening a vacant table on the dashboard: who's serving it. A tap starts the order. */
function StartDialog({ t, config, table, onClose, onStart }: {
  t: T; config: Config; table: Table; onClose: () => void; onStart: (waiter: number | null) => void;
}) {
  const required = config.settings.waiter_required !== false && config.waiters.length > 0;
  return (
    <Modal t={t} title={`${t("table")} ${table.name} · ${t("pick_waiter")}`} onClose={onClose} className="wide">
      <WaiterGrid config={config} current={null} onPick={(id) => onStart(id)} />
      {!required && <button className="btn big" onClick={() => onStart(null)}>{t("no_waiter")}</button>}
    </Modal>
  );
}

function TableNoDialog({ t, current, onClose, onDone }: { t: T; current: string | null; onClose: () => void; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(current ?? "");
  return (
    <Modal t={t} title={t("table_optional")} onClose={onClose}>
      <div className="display num">{v || "—"}</div>
      <Keypad onKey={(k) => setV((x) => (k === "⌫" ? x.slice(0, -1) : (x + k).slice(0, 6)))} keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]} />
      <div className="actions-row">
        <button className="btn big" onClick={() => onDone(null)}>{t("no_table")}</button>
        <button className="btn big primary" onClick={() => onDone(v || null)}>{t("done")}</button>
      </div>
    </Modal>
  );
}

/** The bill on screen: shown to the guest before payment, and after it as the receipt. */
function BillDialog({ t, config, bill, paid, change = 0, onClose, onPay, onPrint }: {
  t: T; config: Config; bill: Bill; paid?: boolean; change?: number; onClose: () => void; onPay?: () => void; onPrint?: () => void;
}) {
  return (
    <Modal t={t} title={paid ? undefined : `${t("bill")} ${bill.bill_no}`} onClose={onClose} className="bill-dialog">
        {paid && (
          <div className="paid-banner">
            <strong>✓ {t("paid_title")} · {formatINR(bill.total)}</strong>
            {change > 0 && <span>{t("change_given")}: <strong className="num">{formatINR(change)}</strong></span>}
          </div>
        )}
        {bill.rejected && <div className="bill-reject" role="alert">{rejectText(t, bill.rejected)}</div>}
        <div className="receipt receipt-screen"><ReceiptBody bill={bill} settings={config.settings} config={config} /></div>
        {!paid && <p className="muted small center">{t("bill_on_screen")}</p>}
        <div className="actions-row">
          {onPrint && <button className="btn big" onClick={onPrint}>{t("print")}</button>}
          <button className="btn big" onClick={onClose}>{paid ? t("done") : t("close")}</button>
          {onPay && <button className="btn big primary" onClick={onPay}>{t("pay")} · {formatINR(bill.total)}</button>}
        </div>
    </Modal>
  );
}

/* ---------------- Dialogs ---------------- */

const MONEY_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

function Keypad({ onKey, keys = MONEY_KEYS }: { onKey: (k: string) => void; keys?: string[] }) {
  return (
    <div className="keypad">
      {keys.map((k, i) => (k ? <button key={k} className="key" onClick={() => onKey(k)}>{k}</button> : <span key={`gap${i}`} />))}
    </div>
  );
}

function PayDialog({ t, due, onClose, onDone }: { t: T; due: number; onClose: () => void; onDone: (p: Payment[], change: number) => void }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [given, setGiven] = useState("");
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = due - paid;
  const givenPaise = rupeesToPaise(given) ?? 0;

  function add(mode: BillPayMode, amount: number) {
    const applied = Math.min(amount, remaining);
    if (applied <= 0) return;
    const next = [...payments, { mode, amount: applied }];
    setGiven("");
    // Cash handed over beyond what was due is the change to give back.
    if (applied === remaining) return onDone(next, mode === "cash" ? changeDue(amount, remaining) : 0);
    setPayments(next);
  }
  const key = (k: string) => setGiven((g) => (k === "⌫" ? g.slice(0, -1) : (g + k).replace(/^0+/, "").slice(0, 7)));
  // Likely notes the guest hands over: the next ₹100, ₹500 and ₹1000 above the amount, and ₹2000.
  const notes = [...new Set([10000, 50000, 100000, 200000].map((step) => Math.ceil(remaining / step) * step))].filter((n) => n > remaining).slice(0, 3);

  return (
    <Modal t={t} title={t("pay_title")} onClose={onClose} className="pay-dialog">
        <div className="due">
          <span>{payments.length ? t("remaining") : t("due")}</span>
          <strong className="num">{formatINR(remaining)}</strong>
          {payments.length > 0 && <span className="muted small">{t("paid_so_far")}: {payments.map((p) => `${t(p.mode as Key)} ${formatINR(p.amount)}`).join(" + ")}</span>}
        </div>
        <div className="pay-cols">
          <div className="pay-modes">
            <button className="btn big upi" onClick={() => add("upi", remaining)}>{t("upi")} · {formatINR(remaining)}</button>
            <button className="btn big card" onClick={() => add("card", remaining)}>{t("card")} · {formatINR(remaining)}</button>
            <button className="btn big primary" onClick={() => add("cash", remaining)}>{t("cash")}: {t("exact")}</button>
            <div className="quick">{notes.map((n) => <button key={n} className="btn" onClick={() => setGiven(String(n / 100))}>{formatINR(n)}</button>)}</div>
          </div>
          <div className="cash-box">
            <span className="muted">{t("cash_given")}</span>
            <div className="display num">{given ? formatINR(givenPaise) : "₹0"}</div>
            {givenPaise > 0 && (
              <div className={`change ${givenPaise >= remaining ? "ok" : ""}`}>
                {givenPaise >= remaining ? <>{t("change")}: <strong className="num">{formatINR(changeDue(givenPaise, remaining))}</strong></> : <>{t("remaining")}: {formatINR(remaining - givenPaise)}</>}
              </div>
            )}
            <Keypad onKey={key} />
            <button className="btn primary big block" disabled={!givenPaise} onClick={() => add("cash", givenPaise)}>
              {givenPaise >= remaining ? t("finish") : t("add_payment", { mode: t("cash"), amount: formatINR(givenPaise) })}
            </button>
          </div>
        </div>
    </Modal>
  );
}

const QTY_MAX = 999;
const QTY_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

/**
 * Types a quantity in: the first key replaces the number shown, so 3 then 0 gives 30. Done (or Enter) sets it;
 * 0 takes the item off the bill. A keyboard's digits, Backspace and Enter work too.
 */
function QtyDialog({ t, name, current, onClose, onDone }: { t: T; name: string; current: number; onClose: () => void; onDone: (n: number) => void }) {
  const [text, setText] = useState(String(current));
  const [fresh, setFresh] = useState(true);
  const n = Number(text || "0");
  const latest = useRef({ text, fresh, n });
  latest.current = { text, fresh, n };
  function press(k: string) {
    const { text: cur, fresh: f } = latest.current;
    if (k === "C") return (setText(""), setFresh(false));
    if (k === "⌫") return (setText(f ? "" : cur.slice(0, -1)), setFresh(false));
    const next = (f ? "" : cur) + k;
    if (Number(next) > QTY_MAX) return;
    setText(next.replace(/^0+(?=\d)/, ""));
    setFresh(false);
  }
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") done.current(latest.current.n);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <Modal t={t} title={name} onClose={onClose} className="qty-dialog">
      <div className="muted small">{t("how_many")}</div>
      <div className={`display num${fresh ? " fresh" : ""}`} aria-live="polite">{text || "0"}</div>
      <Keypad keys={QTY_KEYS} onKey={press} />
      <button className={`btn big block ${n === 0 ? "danger-solid" : "primary"}`} onClick={() => onDone(n)}>
        {n === 0 ? `🗑 ${t("remove")}` : `${t("done")} · ${n}`}
      </button>
    </Modal>
  );
}

/**
 * The discount: an amount, and why (required). Staff giving more than the owner's limit need a manager or the owner
 * to type their PIN here. With no internet the PIN can't be checked, so the discount is allowed and the owner sees it.
 */
function DiscountDialog({ t, subtotal, current, currentReason, settings, approvers, onClose, onDone }: {
  t: T; subtotal: number; current: number; currentReason: DiscountReason | null; settings: PosSettings; approvers: Approver[];
  onClose: () => void; onDone: (paise: number, reason: DiscountReason | null, approvedBy: number | null) => void;
}) {
  const [rupees, setRupees] = useState(current ? String(current / 100) : "");
  const [reason, setReason] = useState<DiscountReason | null>(currentReason);
  const [asking, setAsking] = useState(false);
  const [approver, setApprover] = useState<number | null>(approvers.length === 1 ? approvers[0].id : null);
  const [pin, setPin] = useState("");
  const [problem, setProblem] = useState<"wrong" | "locked" | "offline" | null>(null);
  const [busy, setBusy] = useState(false);
  const paise = Math.min(subtotal, rupeesToPaise(rupees) ?? 0);
  const over = overDiscountLimit(paise, subtotal, settings, storage.user()?.role);

  async function allow() {
    if (!approver || pin.length < 4) return;
    setBusy(true);
    setProblem(null);
    try {
      await api("/billing/discount-approval", { method: "POST", json: { approver_id: approver, pin } });
      onDone(paise, reason, approver);
    } catch (e) {
      setPin("");
      setProblem(e instanceof ApiError ? (e.status === 429 ? "locked" : "wrong") : "offline");
    } finally {
      setBusy(false);
    }
  }

  if (asking) {
    const offline = problem === "offline" || !navigator.onLine || approvers.length === 0;
    return (
      <Modal t={t} title={t("discount_needs_pin", { amount: formatINR(discountLimit(subtotal, settings) ?? 0) })} onClose={() => (setAsking(false), setPin(""), setProblem(null))}>
          {offline ? <p>{t("discount_offline")}</p> : (
            <>
              <p className="muted">{t("discount_who")}</p>
              <div className="reason-grid">
                {approvers.map((a) => <button key={a.id} className={`chip big${approver === a.id ? " on" : ""}`} onClick={() => setApprover(a.id)}>{a.name}</button>)}
              </div>
              <div className="display num">{"•".repeat(pin.length) || " "}</div>
              {problem && <p className="banner bad">{t(problem === "locked" ? "login.too_many" : "wrong_pin")}</p>}
              <Keypad onKey={(k) => setPin((v) => (k === "⌫" ? v.slice(0, -1) : (v + k).slice(0, 4)))} keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]} />
            </>
          )}
          <div className="actions-row">
            <button className="btn big" onClick={() => (setAsking(false), setPin(""), setProblem(null))}>{t("close")}</button>
            {offline
              ? <button className="btn big primary" onClick={() => onDone(paise, reason, null)}>{t("give_anyway")}</button>
              : <button className="btn big primary" disabled={busy || !approver || pin.length < 4} onClick={allow}>{t("allow")}</button>}
          </div>
      </Modal>
    );
  }

  return (
    <Modal t={t} title={t("discount_title")} onClose={onClose}>
        <div className="reason-grid">
          {[5, 10, 15, 20].map((p) => <button key={p} className="chip big" onClick={() => setRupees(String(Math.round((subtotal * p) / 100) / 100))}>{p}%</button>)}
        </div>
        <div className="display num">{formatINR(paise)}</div>
        <Keypad onKey={(k) => setRupees((g) => (k === "⌫" ? g.slice(0, -1) : (g + k).replace(/^0+/, "").slice(0, 7)))} />
        <p className="muted" style={{ margin: "8px 0 4px" }}>{t("discount_why")}</p>
        <div className="reason-grid">
          {DISCOUNT_REASONS.map((r) => <button key={r} className={`chip${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>{t(`dr.${r}`)}</button>)}
        </div>
        {over && <p className="muted small">{t("discount_needs_pin", { amount: formatINR(discountLimit(subtotal, settings) ?? 0) })}</p>}
        <div className="actions-row">
          <button className="btn big" onClick={() => onDone(0, null, null)}>{t("remove")}</button>
          <button className="btn big" onClick={onClose}>{t("close")}</button>
          <button className="btn big primary" disabled={paise > 0 && !reason} onClick={() => (paise > 0 && over ? setAsking(true) : onDone(paise, reason, null))}>
            {t("apply")}
          </button>
        </div>
    </Modal>
  );
}

/* ---------------- Day summary ---------------- */

function Summary({ t, config, bills, waiting, online, printing, onSync, onPrint, onPrintItems, onOpen, onResend, onLogout }: {
  t: T; config: Config; bills: Bill[]; waiting: number; online: boolean; printing: boolean;
  onSync: () => void; onPrint: (date: string, b: Bill[]) => void; onPrintItems: (date: string, b: Bill[]) => void; onOpen: (b: Bill) => void;
  onResend: (clientId: string) => void; onLogout: () => void;
}) {
  const date = businessDate();
  // Bills from the other screens come from the server; this screen's own bills are always shown, sent or not.
  const today = useDayBills(date, online, bills);
  const paid = today.filter((b) => b.status === "paid");
  const sum = (list: Bill[]) => list.reduce((s, b) => s + b.total, 0);
  const mode = (m: BillPayMode) => paid.reduce((s, b) => s + b.payments.filter((p) => p.mode === m).reduce((a, p) => a + p.amount, 0), 0);
  const waiters = byWaiter(today, config.waiters);
  return (
    <main className="summary">
      <h1 className="screen-title">{t("summary")} · <span className="num">{date.split("-").reverse().join("-")}</span></h1>
      <div className="stat-row">
        <div className="stat hero"><span>{t("sales")}</span><strong className="num">{formatINR(sum(paid))}</strong><span className="muted">{t("today_bills")}: {paid.length}</span></div>
        <div className="stat"><span>{t("cash")}</span><strong className="num">{formatINR(mode("cash"))}</strong></div>
        <div className="stat"><span>{t("upi")}</span><strong className="num">{formatINR(mode("upi"))}</strong></div>
        <div className="stat"><span>{t("card")}</span><strong className="num">{formatINR(mode("card"))}</strong></div>
        <div className="stat"><span>{t("cancelled")}</span><strong className="num">{formatINR(sum(today.filter((b) => b.status === "cancelled")))}</strong></div>
      </div>
      <div className="sync-row">
        <span className={waiting ? "warn" : "good"}>{waiting ? `${t("unsynced")}: ${waiting}` : t("all_sent")}</span>
        <button className="btn" disabled={!waiting || !online} onClick={onSync}>{t("sync_now")}</button>
        {printing && <button className="btn" onClick={() => onPrint(date, today)}>{t("print_summary")}</button>}
        {printing && <button className="btn" onClick={() => onPrintItems(date, today)}>{t("print_items")}</button>}
        <span className="grow" />
        <button className="btn danger" onClick={onLogout}>{t("logout")}</button>
      </div>
      {waiters.length > 0 && (
        <>
          <h2>{t("by_waiter")}</h2>
          <div className="waiter-sums">
            {waiters.map((w) => (
              <div key={w.id ?? "none"} className="stat">
                <span>{w.id === null ? t("no_waiter") : waiterName(config, w.id) || w.name}</span>
                <strong className="num">{formatINR(w.total)}</strong>
                <span className="muted small">{t("today_bills")}: {w.bills}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <details className="item-sales">
        <summary><h2>{t("item_sales")}</h2></summary>
        <div className="item-sales-list">
          {itemSales(today).map((r) => (
            <div key={`${r.category}|${r.name}|${r.variation ?? ""}`} className="item-sale">
              <span>{r.name}{r.variation ? ` [${r.variation}]` : ""}<span className="muted small"> · {r.category}</span></span>
              <span className="num">{r.qty}</span>
              <strong className="num">{formatINR(r.amount)}</strong>
            </div>
          ))}
        </div>
      </details>
      <h2>{t("recent")}</h2>
      <div className="bill-list">
        {[...today].reverse().map((b) => (
          <Fragment key={b.client_id}>
          <button className={`bill-row${b.status === "cancelled" ? " cancelled" : ""}`} onClick={() => onOpen(b)} title={printing ? t("reprint") : t("view_bill")}>
            <span className="num">{b.bill_no}</span>
            <span>{orderLabel({ type: b.order_type, table_name: b.table_name, token: b.token }, t)}</span>
            <span className="muted">{formatTime(new Date(b.closed_at))}</span>
            <span className="muted">{b.status === "cancelled" ? `${t("cancelled")}: ${b.cancel_reason}` : b.payments.map((p) => t(p.mode as Key)).join(" + ")}</span>
            <strong className="num">{formatINR(b.total)}</strong>
            <span className={`sync ${b.synced ? "ok" : b.rejected ? "bad" : "wait"}`}>{b.synced ? "✓" : b.rejected ? "!" : "…"}</span>
          </button>
          {b.rejected && (
            <div className="bill-reject" role="alert">
              <span>{rejectText(t, b.rejected)}</span>
              <button className="btn" onClick={() => onResend(b.client_id)}>{t("send_again")}</button>
            </div>
          )}
          </Fragment>
        ))}
      </div>
    </main>
  );
}

/* ---------------- Item Master: the menu as the counter has it ---------------- */

/** The old POS's Item Master, to look things up. Items and prices are changed in the admin app (the owner). */
/** A menu item as the owner's menu page has it: hidden ("discontinued") items too. */
type MenuItem = Item & { active: number };

/**
 * Item Master, like the old POS's Product Master: the owner picks an item in the list and changes its name, category,
 * rate, choices (e.g. a Half price) or star, or discontinues it, right here at the counter. Others see the list.
 */
function ItemMaster({ t, lang, config, isOwner, online, onItemAdded, onChanged }: {
  t: T; lang: Lang; config: Config; isOwner: boolean; online: boolean; onItemAdded: (item: Item) => void; onChanged: () => void;
}) {
  const [find, setFind] = useState("");
  const [adding, setAdding] = useState(false);
  const [cat, setCat] = useState<number | "all">("all");
  const [all, setAll] = useState<MenuItem[] | null>(null);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [reload, setReload] = useState(0);
  // The owner sees discontinued items too, to switch them back on.
  useEffect(() => {
    if (!isOwner || !online) return;
    let live = true;
    api<{ items: MenuItem[] }>("/billing/menu").then((r) => live && setAll(r.items)).catch(() => {});
    return () => {
      live = false;
    };
  }, [isOwner, online, reload]);
  const q = find.trim().toLowerCase();
  const catName = (id: number) => {
    const c = config.categories.find((x) => x.id === id);
    return c ? (lang === "hi" && c.name_hi) || (lang === "kn" && c.name_kn) || c.name : "—";
  };
  const source: MenuItem[] = all ?? config.items.map((i) => ({ ...i, active: 1 }));
  const catOrder = new Map(config.categories.map((c, n) => [c.id, n]));
  const list = source
    .filter((i) => (cat === "all" || i.category_id === cat) && (!q || [i.name, i.short_name, i.name_hi, i.name_kn].some((n) => (n ?? "").toLowerCase().includes(q))))
    .sort((a, b) => (b.active - a.active) || ((catOrder.get(a.category_id) ?? 99) - (catOrder.get(b.category_id) ?? 99)) || a.sort - b.sort);
  return (
    <main className="summary item-master">
      <div className="report-head">
        <h1 className="screen-title">{t("product_master")}</h1>
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}>＋ {t("add_item")}</button>
        {isOwner && <a className="btn" href="/manage/menu" target="_blank" rel="noopener">{t("edit_in_admin")} ↗</a>}
      </div>
      {editing && (
        <ProductForm key={editing.id} t={t} lang={lang} config={config} item={editing} online={online}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), setReload((n) => n + 1), onChanged())} />
      )}
      <div className="report-filters">
        <input className="search" placeholder={`🔍 ${t("search")}`} value={find} onChange={(e) => setFind(e.target.value)} />
        {find && <button className="x-btn" onClick={() => setFind("")} aria-label={t("clear")}>✕</button>}
        <select className="search" value={cat} onChange={(e) => setCat(e.target.value === "all" ? "all" : Number(e.target.value))} aria-label={t("m.category")}>
          <option value="all">{t("all")}</option>
          {config.categories.map((c) => <option key={c.id} value={c.id}>{catName(c.id)}</option>)}
        </select>
      </div>
      <div className="rtable" style={{ "--cols": `64px minmax(0, 2fr) minmax(0, 1fr) minmax(0, 2fr) 100px 70px${isOwner ? " 70px" : ""}` } as React.CSSProperties}>
        <div className="rrow rhead">
          <span className="r">{t("item_id")}</span><span>{t("item_name")}</span><span>{t("m.category")}</span><span>{t("variation")} / {t("addon")}</span>
          <span className="r">{t("rate")}</span><span className="c">{t("active")}</span>{isOwner && <span className="c">{t("edit")}</span>}
        </div>
        {list.map((i) => (
          <div key={i.id} className={`rrow${i.active ? "" : " cancelled"}${editing?.id === i.id ? " picked" : ""}`}>
            <span className="num r muted">{i.id}</span>
            <span>{i.favourite ? "★ " : ""}{i.name}{i.short_name && i.short_name !== i.name ? <span className="muted small"> · {i.short_name}</span> : null}</span>
            <span className="muted">{catName(i.category_id)}</span>
            <span className="muted small">{[...(i.variations ?? []).map((v) => `${v.name} ${formatINR(v.price)}`), ...(i.addons ?? []).map((a) => `+${a.name}`)].join(", ")}</span>
            <strong className="num r">{formatINR(i.price)}</strong>
            <span className="c">{i.active ? "✔" : "—"}</span>
            {isOwner && <button className="icon-btn" disabled={!online} onClick={() => setEditing(i)} aria-label={t("edit")} title={online ? t("edit") : t("add_item_offline")}>✎</button>}
          </div>
        ))}
        {list.length === 0 && <p className="muted center">{t("no_items_found")}</p>}
      </div>
      <p className="muted small">{t("items", { n: list.length })}{!isOwner && ` · ${t("owner_only_edit")}`}</p>
      {adding && (
        <AddItemDialog t={t} lang={lang} config={config} online={online} name={find.trim()} category={cat === "all" ? null : cat}
          onClose={() => setAdding(false)}
          onAdded={(item) => (setAdding(false), setFind(""), setReload((n) => n + 1), onItemAdded(item))} />
      )}
    </main>
  );
}

/** One choice being edited: its name and price in rupees, as typed. */
interface ChoiceRow { name: string; rupees: string }
const toRows = (o: ItemOption[] | null | undefined): ChoiceRow[] => (o ?? []).map((v) => ({ name: v.name, rupees: String(v.price / 100) }));

/** The Product Master form for one item (owner only): name, category, rate, its choices with their prices, star, discontinue. */
function ProductForm({ t, lang, config, item, online, onClose, onSaved }: {
  t: T; lang: Lang; config: Config; item: MenuItem; online: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [cat, setCat] = useState(item.category_id);
  const [rate, setRate] = useState(String(item.price / 100));
  const [choices, setChoices] = useState<ChoiceRow[]>(toRows(item.variations));
  const [fav, setFav] = useState(!!item.favourite);
  const [off, setOff] = useState(!item.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const price = rupeesToPaise(rate);
  const parsed = choices.filter((c) => c.name.trim() || c.rupees.trim()).map((c) => ({ name: c.name.trim(), price: rupeesToPaise(c.rupees) }));
  const ready = name.trim() !== "" && price !== null && parsed.every((c) => c.name && c.price !== null);
  const catName = (c: Config["categories"][number]) => (lang === "hi" && c.name_hi) || (lang === "kn" && c.name_kn) || c.name;
  const setRow = (n: number, f: Partial<ChoiceRow>) => setChoices((rows) => rows.map((r, i) => (i === n ? { ...r, ...f } : r)));
  async function save() {
    if (!ready || busy) return;
    if (!online) return setError(t("add_item_offline"));
    setBusy(true);
    setError(null);
    try {
      await api(`/billing/menu/items/${item.id}`, { method: "PATCH", json: {
        name: name.trim(), category_id: cat, price, favourite: fav, active: !off,
        variations: parsed.length ? parsed : null,
      } });
      onSaved();
    } catch {
      setError(t("save_item_failed"));
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="product-form card" onSubmit={(e) => (e.preventDefault(), void save())}>
      <div className="pf-head"><strong>{t("product_master")} · #{item.id}</strong><button type="button" className="x-btn" onClick={onClose} aria-label={t("close")}>✕</button></div>
      <label><span className="muted small">{t("product_name")}</span><input className="search" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      <label><span className="muted small">{t("m.category")}</span>
        <select className="search" value={cat} onChange={(e) => setCat(Number(e.target.value))}>
          {config.categories.map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}
        </select>
      </label>
      <label><span className="muted small">{t("price_wo_tax")}</span>
        <input className="search num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} />
      </label>
      <div className="pf-choices">
        <span className="muted small">{t("choices_help")}</span>
        {choices.map((c, n) => (
          <div key={n} className="pf-choice">
            <input className="search" placeholder={t("choice_name")} value={c.name} maxLength={40} onChange={(e) => setRow(n, { name: e.target.value })} />
            <input className="search num" inputMode="decimal" placeholder="₹" value={c.rupees} onChange={(e) => setRow(n, { rupees: e.target.value.replace(/[^\d.]/g, "") })} />
            <button type="button" className="icon-btn danger" onClick={() => setChoices((rows) => rows.filter((_, i) => i !== n))} aria-label={t("remove")}>✕</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setChoices((rows) => [...rows, { name: "", rupees: rate }])}>＋ {t("add_choice")}</button>
      </div>
      <label className="pf-check"><input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} /> ★ {t("favourite_item")}</label>
      <label className="pf-check"><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> {t("discontinue")}</label>
      {item.addons?.length ? <p className="muted small">{t("addons_in_admin", { list: item.addons.map((a) => a.name).join(", ") })}</p> : null}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="actions-row">
        <button type="submit" className="btn big primary" disabled={!ready || busy}>✔ {t("save")}</button>
        <button type="button" className="btn big" onClick={onClose}>✕ {t("cancel_short")}</button>
      </div>
    </form>
  );
}

/** The cancel reason kept on an order cancelled before its bill was printed (nobody is asked). */
const NOT_PRINTED = "Not printed";
/** The reason kept on a printed bill cancelled at the counter: nobody is asked (the printed copy is kept instead). */
const NO_REASON = "No reason given";

/**
 * A new menu item, added at the counter so a dish that isn't on the menu yet can be billed. It needs the internet:
 * the server puts it on the menu for every screen and tells the owner and the managers, who can fix the name or rate.
 */
function AddItemDialog({ t, lang, config, online, name, category, onClose, onAdded }: {
  t: T; lang: Lang; config: Config; online: boolean; name: string; category: number | null; onClose: () => void; onAdded: (item: Item) => void;
}) {
  const [itemName, setItemName] = useState(name);
  const [cat, setCat] = useState<number | null>(category ?? config.categories[0]?.id ?? null);
  const [rate, setRate] = useState("");
  const [veg, setVeg] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paise = rupeesToPaise(rate);
  const ready = itemName.trim() !== "" && cat !== null && paise !== null && paise > 0;
  const catName = (c: Config["categories"][number]) => (lang === "hi" && c.name_hi) || (lang === "kn" && c.name_kn) || c.name;
  async function save() {
    if (!ready || busy) return;
    if (!online) return setError(t("add_item_offline"));
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ item: Item }>("/billing/items", { method: "POST", json: { name: itemName.trim(), category_id: cat, price: paise, veg } });
      onAdded(r.item);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "item_exists" ? t("item_exists") : e instanceof ApiError ? t("add_item_failed") : t("add_item_offline"));
      setBusy(false);
    }
  }
  return (
    <Modal t={t} title={t("add_item_title")} onClose={onClose} className="add-item">
      <form className="add-item-form" onSubmit={(e) => (e.preventDefault(), void save())}>
        <label>
          <span className="muted small">{t("item_name")}</span>
          <input className="search" autoFocus value={itemName} maxLength={120} onChange={(e) => setItemName(e.target.value)} />
        </label>
        <label>
          <span className="muted small">{t("m.category")}</span>
          <select className="search" value={cat ?? ""} onChange={(e) => setCat(Number(e.target.value))}>
            {config.categories.map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}
          </select>
        </label>
        <label>
          <span className="muted small">{t("new_item_rate")}</span>
          <input className="search num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
        </label>
        <div className="type-toggle" role="group">
          <button type="button" className={veg ? "on" : ""} onClick={() => setVeg(true)}>🟢 {t("veg")}</button>
          <button type="button" className={!veg ? "on" : ""} onClick={() => setVeg(false)}>🔴 {t("non_veg")}</button>
        </div>
        <p className="muted small">{t("add_item_note")}</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="actions-row">
          <button type="button" className="btn big" onClick={onClose}>{t("close")}</button>
          <button type="submit" className="btn big primary" disabled={!ready || busy}>{t("add_item_save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Report's: the old POS's four reports, from a date to a date ---------------- */

const dmy = (d: string) => d.split("-").reverse().join("-");
/** "20:27": a time of day on the counter, 24-hour like the old POS. */
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
/** How long a table took, "01:05" (hours:minutes), as the old POS's Duration column. */
function duration(from: string, to: string): string {
  const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
const paidBy = (bills: Bill[], m: string) => bills.reduce((s, b) => s + b.payments.filter((p) => p.mode === m).reduce((a, p) => a + p.amount, 0), 0);

function Report({ t, config, kind, printing, online, onOpen, onPrint }: {
  t: T; config: Config; kind: ReportKind; printing: boolean; online: boolean; onOpen: (b: Bill) => void; onPrint: (job: PrintJob) => void;
}) {
  const today = businessDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed" | "too_long" | "bad_dates">("idle");
  const title = t(REPORTS.find((r) => r.kind === kind)!.key);
  const sub = from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`;

  const show = useCallback(async (f: string, tt: string) => {
    if (!f || !tt || tt < f) return setState("bad_dates");
    setState("loading");
    try {
      setBills(await fetchRange(f, tt));
      setState("idle");
    } catch (e) {
      setState(e instanceof ApiError && e.code === "range_too_long" ? "too_long" : "failed");
    }
  }, []);
  // Today's figures show straight away, like opening the report in the old POS.
  useEffect(() => {
    if (online) void show(today, today);
  }, [show, today, online]);

  const paid = (bills ?? []).filter((b) => b.status === "paid");
  const sum = (list: Bill[]) => list.reduce((s, b) => s + b.total, 0);
  let body: React.ReactNode = null;
  let job: PrintJob | null = null;

  if (bills && kind === "sales_summary") {
    // As on the old POS: one row per invoice, with when the table started, how long it took and who billed it.
    const list = [...bills].sort((a, b) => a.closed_at.localeCompare(b.closed_at));
    const tot = { amount: sum(paid) + paid.reduce((n, b) => n + b.discount, 0), waived: paid.reduce((n, b) => n + b.discount, 0), total: sum(paid) };
    const cols = "126px 106px 64px 64px 64px 96px 44px minmax(0, 1fr) 76px 92px 76px 92px minmax(0, 1fr) minmax(0, 1fr)";
    body = (
      <div className="rtable wide-table fit r-summary" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="rrow rhead">
          <span>{t("invoice_no")}</span><span>{t("invoice_date")}</span><span>{t("table_start")}</span><span>{t("duration")}</span><span>{t("table")}</span>
          <span>{t("table_status")}</span><span className="r">{t("pax")}</span><span>{t("invoice_type")}</span><span>{t("order_mode")}</span>
          <span className="r">{t("invoice_amount")}</span><span className="r">{t("waived")}</span><span className="r">{t("total")}</span><span>{t("waiter")}</span><span>{t("user")}</span>
        </div>
        {list.map((b) => (
          <button key={b.client_id} className={`rrow${b.status === "cancelled" ? " cancelled" : ""}`} onClick={() => onOpen(b)}>
            <span className="num">{b.bill_no}</span>
            <span className="num">{dmy(b.business_date)}</span>
            <span className="num">{hhmm(b.opened_at)}</span>
            <span className="num">{duration(b.opened_at, b.closed_at)}</span>
            <span>{b.table_name ?? ""}</span>
            <span>{b.status === "cancelled" ? "CANCELLED" : "BILLED"}</span>
            <span className="num r">{b.guests ?? 0}</span>
            <span className="muted">{b.status === "cancelled" ? b.cancel_reason ?? "" : b.payments.map((p) => t(p.mode as Key)).join(" + ")}</span>
            <span>{b.order_type === "parcel" ? "PARCEL" : "DINEIN"}</span>
            <span className="num r">{money(b.total + b.discount)}</span>
            <span className="num r">{money(b.discount)}</span>
            <strong className="num r">{money(b.total)}</strong>
            <span className="muted">{waiterName(config, b.waiter_staff_id) || ""}</span>
            <span className="muted">{b.user_name ?? ""}</span>
          </button>
        ))}
        <div className="rrow rfoot">
          <span>{t("total")}</span><span>{t("bills_n")}: {paid.length}</span><span /><span /><span /><span /><span /><span /><span />
          <span className="num r">{money(tot.amount)}</span><span className="num r bad">{money(tot.waived)}</span><span className="num r">{money(tot.total)}</span><span /><span />
        </div>
      </div>
    );
    job = { kind: "table", title, sub, cols: "minmax(0,1fr) 3.4em 5em", head: ["Bill", "Mode", "Amount"],
      rows: list.map((b) => [b.bill_no, b.status === "cancelled" ? "CANC" : b.order_type === "parcel" ? "PARCEL" : "DINEIN", money(b.total)]),
      foot: ["Total", String(paid.length), money(tot.total)] };
    const modes: [string, number][] = [["Cash", paidBy(paid, "cash")], ["UPI", paidBy(paid, "upi")], ["Card", paidBy(paid, "card")], ["Other", paidBy(paid, "other")],
      ["Cancelled", sum(bills.filter((b) => b.status === "cancelled"))]];
    job.rows.push(["—"], ...modes.filter(([, v]) => v > 0).map(([k, v]) => [k, "", money(v)]));
  } else if (bills && kind === "sales_details") {
    // Every item on every invoice: what was sold, on which bill, at what rate. Cancelled bills are struck through.
    const list = [...bills].sort((a, b) => a.closed_at.localeCompare(b.closed_at));
    const rows = list.flatMap((b) => b.lines.map((l, i) => ({ b, l, i })));
    const soldQty = paid.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.qty, 0), 0);
    const cols = "126px 120px 76px minmax(0, 2fr) minmax(0, 1fr) 56px 88px 100px minmax(0, 1fr)";
    body = (
      <div className="rtable wide-table fit r-details" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="rrow rhead">
          <span>{t("invoice_no")}</span><span>{t("invoice_date")}</span><span>{t("order_mode")}</span><span>{t("item_name")}</span><span>{t("modifier")}</span>
          <span className="r">{t("qty")}</span><span className="r">{t("rate")}</span><span className="r">{t("amount")}</span><span>{t("waiter")}</span>
        </div>
        {rows.map(({ b, l, i }) => (
          <button key={`${b.client_id}-${i}`} className={`rrow${b.status === "cancelled" ? " cancelled" : ""}${i === 0 ? " first-line" : ""}`} onClick={() => onOpen(b)}>
            <span className="num">{i === 0 ? b.bill_no : ""}</span>
            <span className="num">{i === 0 ? <>{dmy(b.business_date)} <span className="muted small">{hhmm(b.closed_at)}</span></> : ""}</span>
            <span>{i === 0 ? (b.order_type === "parcel" ? "PARCEL" : "DINEIN") : ""}</span>
            <span>{l.name}</span>
            <span className="muted">{lineTag(l) ? `[${lineTag(l)}]` : ""}</span>
            <span className="num r">{l.qty}</span>
            <span className="num r">{money(l.price)}</span>
            <strong className="num r">{money(l.price * l.qty)}</strong>
            <span className="muted">{i === 0 ? waiterName(config, b.waiter_staff_id) || "" : ""}</span>
          </button>
        ))}
        <div className="rrow rfoot"><span>{t("total")}</span><span>{t("bills_n")}: {paid.length}</span><span /><span /><span /><span className="num r">{soldQty}</span><span /><span className="num r">{money(sum(paid))}</span><span /></div>
      </div>
    );
    job = { kind: "table", title, sub, cols: "minmax(0,1fr) 2.2em 4.8em", head: ["Item", "Qty", "Amount"],
      rows: list.flatMap((b) => [[`${b.bill_no}${b.status === "cancelled" ? " (CANC)" : ""}`], ...b.lines.map((l) => [`${l.name}${lineTag(l) ? ` [${lineTag(l)}]` : ""}`, String(l.qty), money(l.price * l.qty)])]),
      foot: ["Total", String(soldQty), money(sum(paid))] };
  } else if (bills && kind === "item_sales") {
    const rows = itemSales(bills);
    const cats = [...new Set(rows.map((r) => r.category))];
    const cols = "minmax(0, 2fr) minmax(0, 1fr) 90px 130px";
    body = (
      <div className="rtable fit r-items" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="rrow rhead"><span>{t("item_name")}</span><span>{t("variation")}</span><span className="r">{t("qty")}</span><span className="r">{t("amount")}</span></div>
        {cats.map((c) => {
          const list = rows.filter((r) => r.category === c);
          return (
            <Fragment key={c}>
              <div className="rgroup">{t("m.category")}: {c}</div>
              {list.map((r) => (
                <div key={`${r.name}|${r.variation ?? ""}`} className="rrow"><span>{r.name}</span><span className="muted">{r.variation ? `[${r.variation}]` : ""}</span><span className="num r">{r.qty}</span><span className="num r">{money(r.amount)}</span></div>
              ))}
              <div className="rrow rsub"><span /><span /><span className="num r">{list.reduce((n, r) => n + r.qty, 0)}</span><span className="num r">{money(list.reduce((n, r) => n + r.amount, 0))}</span></div>
            </Fragment>
          );
        })}
        <div className="rrow rfoot"><span>{t("total")}</span><span /><span className="num r">{rows.reduce((n, r) => n + r.qty, 0)}</span><span className="num r">{money(rows.reduce((n, r) => n + r.amount, 0))}</span></div>
      </div>
    );
    job = { kind: "table", title, sub, cols: "minmax(0,1fr) 2.6em 5em", head: ["Item", "Qty", "Amount"],
      rows: cats.flatMap((c) => [[c], ...rows.filter((r) => r.category === c).map((r) => [`${r.name}${r.variation ? ` [${r.variation}]` : ""}`, String(r.qty), money(r.amount)])]),
      foot: ["Total", String(rows.reduce((n, r) => n + r.qty, 0)), money(rows.reduce((n, r) => n + r.amount, 0))] };
  } else if (bills && kind === "waiter_commission") {
    const m = new Map<number | null, { id: number | null; bills: number; sales: number; commission: number }>();
    for (const b of paid) {
      const id = b.waiter_staff_id ?? null;
      const r = m.get(id) ?? { id, bills: 0, sales: 0, commission: 0 };
      r.bills++;
      r.sales += b.total;
      r.commission += b.commission ?? 0;
      m.set(id, r);
    }
    const rows = [...m.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.sales - a.sales));
    const nameOf = (id: number | null) => (id === null ? t("no_waiter") : waiterName(config, id) || `#${id}`);
    const cols = "minmax(0, 2fr) 90px 140px 140px";
    body = (
      <div className="rtable fit r-waiters" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="rrow rhead"><span>{t("waiter")}</span><span className="r">{t("bills_n")}</span><span className="r">{t("sales")}</span><span className="r">{t("commission")}</span></div>
        {rows.map((r) => (
          <div key={r.id ?? "none"} className="rrow"><span>{nameOf(r.id)}</span><span className="num r">{r.bills}</span><span className="num r">{money(r.sales)}</span><strong className="num r">{money(r.commission)}</strong></div>
        ))}
        <div className="rrow rfoot"><span>{t("total")}</span><span className="num r">{paid.length}</span><span className="num r">{money(sum(paid))}</span><span className="num r">{money(rows.reduce((n, r) => n + r.commission, 0))}</span></div>
      </div>
    );
    job = { kind: "table", title, sub, cols: "minmax(0,1fr) 2em 4.6em 4.2em", head: ["Waiter", "Bills", "Sales", "Comm."],
      rows: rows.map((r) => [nameOf(r.id), String(r.bills), money(r.sales), money(r.commission)]),
      foot: ["Total", String(paid.length), money(sum(paid)), money(rows.reduce((n, r) => n + r.commission, 0))] };
  }

  return (
    <main className="summary">
      <h1 className="screen-title">{title}</h1>
      <div className="report-filters">
        <label className="date-field"><span>{t("from_date")}</span><input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="date-field"><span>{t("to_date")}</span><input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn primary" disabled={state === "loading" || !online} onClick={() => void show(from, to)}>🔍 {t("show")}</button>
        {printing && <button className="btn" disabled={!job || !bills?.length} onClick={() => job && onPrint(job)}>🖨 {t("print")}</button>}
      </div>
      {!online && <p className="banner bad">{t("report_offline")}</p>}
      {state === "loading" && <p className="muted">{t("loading_report")}</p>}
      {state === "failed" && <p className="banner bad">{t("report_failed")}</p>}
      {state === "too_long" && <p className="banner bad">{t("range_too_long")}</p>}
      {state === "bad_dates" && <p className="banner bad">{t("bad_dates")}</p>}
      {bills && state === "idle" && (bills.length ? body : <p className="muted center empty-note">{t("no_bills_range")}</p>)}
    </main>
  );
}

/* ---------------- The bill, for the screen and for the 80 mm receipt printer ---------------- */

const money = (p: number) => formatINR(p, { symbol: false });

/** Laid out like the old POS's bill: token on top, the heading, date and bill number, then Item / Qty / Price / Amount. */
function ReceiptBody({ bill: b, settings, config, copy }: { t?: T; bill: Bill; settings: Config["settings"]; config: Config; copy?: Copy }) {
  const totals = totalsOf({ lines: b.lines.map((l, i) => ({ ...l, key: String(i), sent: 0 })), discount: b.discount } as Order, { ...settings, prices_include_tax: b.prices_include_tax });
  const at = new Date(b.closed_at);
  const date = at.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  const time = at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).toUpperCase();
  const showGst = settings.use_gst !== false && !!settings.gstin;
  const waiter = waiterName(config, b.waiter_staff_id);
  const [title, ...address] = settings.bill_header.split("\n");
  const qty = b.lines.reduce((n, l) => n + l.qty, 0);
  return (
    <>
      {b.token !== null && <div className="p-token">Token No. : <span>{b.token}</span></div>}
      {copy && <div className="p-center p-small">{copy}</div>}
      <div className="p-center p-title">{title}</div>
      {address.map((line, i) => <div key={i} className="p-center p-small">{line}</div>)}
      {showGst && <div className="p-center p-small">GSTIN: {settings.gstin}</div>}
      <hr />
      <div>Name :-</div>
      <hr />
      <div className="p-meta">
        <div>Date : {date}<br /><span className="p-indent">{time}</span></div>
        <div><b>{b.order_type === "parcel" ? "PARCEL" : "DINEIN"}</b>{b.table_name ? ` · Table ${b.table_name}` : ""}<br />Bill No. : {b.bill_no}{b.printed_no ? ` (printed ${b.printed_no})` : ""}</div>
      </div>
      {waiter && <div className="p-small">Waiter : {waiter}</div>}
      <hr />
      <div className="p-items p-head"><span>Item</span><span>Qty</span><span>Price</span><span>Amount</span></div>
      <hr className="thin" />
      {b.lines.map((l, i) => (
        <div key={i} className="p-items">
          <span className="p-name">{l.name}{lineTag(l) && <><br />{lineTag(l)}</>}{l.note && <><br />→ {l.note}</>}</span>
          <span>{l.qty}</span><span>{money(l.price).replace(/\.00$/, "")}</span><span>{money(l.qty * l.price)}</span>
        </div>
      ))}
      <hr />
      <div className="p-items p-total"><span>Total :</span><span>{qty}</span><span /><span>{money(totals.subtotal)}</span></div>
      {totals.discount > 0 && <div className="p-row"><span>Discount</span><span>−{money(totals.discount)}</span></div>}
      {totals.tax > 0 && (
        <>
          <div className="p-row"><span>CGST{b.prices_include_tax ? " (incl.)" : ""}</span><span>{money(totals.cgst)}</span></div>
          <div className="p-row"><span>SGST{b.prices_include_tax ? " (incl.)" : ""}</span><span>{money(totals.sgst)}</span></div>
        </>
      )}
      {totals.round_off !== 0 && <div className="p-row"><span>Round off</span><span>{money(totals.round_off)}</span></div>}
      <div className="p-grand">Grand Total : {money(b.total)}</div>
      {b.payments.length > 0 && <div className="p-small p-right">{b.payments.map((p) => `${p.mode.toUpperCase()} ${money(p.amount)}`).join(" + ")}</div>}
      <hr />
      {settings.bill_footer && <div className="p-center">{settings.bill_footer}</div>}
    </>
  );
}

/* ---------------- Printing (when the receipt printer is switched on) ---------------- */

function PrintArea({ t, job, settings, config, onDone }: { t: T; job: PrintJob | null; settings: Config["settings"]; config: Config; onDone: () => void }) {
  // A new bill prints as separate print jobs one after the other, so the printer cuts after each: dine-in once,
  // parcel twice (the second copy goes to the kitchen), as set in POS options. Reprints and the day summary print once.
  const copies = job?.kind === "bill" && job.copy === "Original" ? billCopies(job.bill.order_type, settings) : 1;
  // onDone is a new function on every render; keep the latest in a ref so a re-render never restarts printing.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!job) return;
    let printed = 0;
    let id = 0;
    const next = () => {
      printed++;
      window.print();
    };
    const after = () => {
      if (printed < copies) id = window.setTimeout(next, 300);
      else done.current();
    };
    window.addEventListener("afterprint", after);
    id = window.setTimeout(next, 50);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("afterprint", after);
    };
  }, [job, copies]);
  if (!job) return null;
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" });
  let body: React.ReactNode = null;

  if (job.kind === "table") {
    const grid = { gridTemplateColumns: job.cols };
    body = (
      <>
        <div className="p-center p-big">{job.title}</div>
        <div className="p-center">{job.sub}</div>
        <div className="p-center p-small">{when}</div>
        <hr />
        <div className="p-items p-head" style={grid}>{job.head.map((h, i) => <span key={i}>{h}</span>)}</div>
        <hr className="thin" />
        {job.rows.map((r, i) => <div key={i} className={`p-items${r.length === 1 ? " p-group" : ""}`} style={r.length === 1 ? undefined : grid}>{r.map((c, j) => <span key={j}>{c}</span>)}</div>)}
        {job.foot && (
          <>
            <hr />
            <div className="p-items p-total" style={grid}>{job.foot.map((c, i) => <span key={i}>{c}</span>)}</div>
          </>
        )}
      </>
    );
  } else if (job.kind === "bill") {
    body = <ReceiptBody bill={job.bill} settings={settings} config={config} copy={job.copy} />;
  } else if (job.kind === "items") {
    const rows = itemSales(job.bills);
    const cats = [...new Set(rows.map((r) => r.category))];
    body = (
      <>
        <div className="p-center p-big">Item Sales Summary</div>
        <div className="p-center">{job.date} · {when}</div>
        <hr />
        <div className="p-items p-head"><span>Item</span><span>Qty</span><span /><span>Amount</span></div>
        {cats.map((c) => {
          const list = rows.filter((r) => r.category === c);
          return (
            <div key={c}>
              <hr className="thin" />
              <div><b>{c}</b></div>
              {list.map((r) => (
                <div key={`${r.name}|${r.variation ?? ""}`} className="p-items">
                  <span className="p-name">{r.name}{r.variation && <><br />[{r.variation}]</>}</span><span>{r.qty}</span><span /><span>{money(r.amount)}</span>
                </div>
              ))}
              <div className="p-items"><span>{c} total</span><span>{list.reduce((n, r) => n + r.qty, 0)}</span><span /><span>{money(list.reduce((n, r) => n + r.amount, 0))}</span></div>
            </div>
          );
        })}
        <hr />
        <div className="p-items p-total"><span>Total :</span><span>{rows.reduce((n, r) => n + r.qty, 0)}</span><span /><span>{money(rows.reduce((n, r) => n + r.amount, 0))}</span></div>
      </>
    );
  } else {
    const paid = job.bills.filter((b) => b.status === "paid");
    const mode = (m: string) => paid.reduce((s, b) => s + b.payments.filter((p) => p.mode === m).reduce((a, p) => a + p.amount, 0), 0);
    body = (
      <>
        <div className="p-center p-big">{t("summary")}</div>
        <div className="p-center">{job.date} · {when}</div>
        <hr />
        <div className="p-row"><span>{t("today_bills")}</span><span>{paid.length}</span></div>
        <div className="p-row p-big"><span>{t("sales")}</span><span>{formatINR(paid.reduce((s, b) => s + b.total, 0))}</span></div>
        {(["cash", "upi", "card", "other"] as const).map((m) => mode(m) > 0 && <div key={m} className="p-row"><span>{t(m as Key)}</span><span>{formatINR(mode(m))}</span></div>)}
        <div className="p-row"><span>{t("cancelled")}</span><span>{formatINR(job.bills.filter((b) => b.status === "cancelled").reduce((s, b) => s + b.total, 0))}</span></div>
      </>
    );
  }
  return createPortal(<div className="receipt">{body}</div>, document.getElementById("print-root")!);
}
