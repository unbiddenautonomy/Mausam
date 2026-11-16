import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { businessDate, changeDue, formatINR, LANGUAGES, rupeesToPaise, validCounter, type BillPayMode, type Lang } from "@mausam/shared";
import { api, ApiError, fetchConfig, syncBills } from "./api";
import { translate, type Key } from "./i18n";
import {
  addItem, byWaiter, changeQty, needsWaiter, newOrder, orderLabel, pruneBills, storage, takeBillNo, takeToken, toBill, totalsOf, unsent, usesTables,
  type Bill, type Config, type Item, type Order, type Payment, type Table,
} from "./store";

type T = (key: Key, params?: Record<string, string | number>) => string;
type PrintJob =
  | { kind: "kot"; order: Order; lines: Order["lines"] }
  | { kind: "bill"; bill: Bill }
  | { kind: "summary"; date: string; bills: Bill[] };

const SYNC_EVERY_MS = 20_000;
const CONFIG_EVERY_MS = 10 * 60_000;

export function App() {
  const [lang, setLangState] = useState<Lang>(storage.lang());
  const t: T = useCallback((k, p) => translate(lang, k, p), [lang]);
  const setLang = (l: Lang) => {
    storage.setLang(l);
    setLangState(l);
    document.documentElement.lang = l;
  };
  const [loggedIn, setLoggedIn] = useState(!!storage.token());
  const [counter, setCounter] = useState(storage.counter());

  if (!loggedIn) return <Login t={t} lang={lang} setLang={setLang} onDone={() => setLoggedIn(true)} />;
  if (!counter) return <CounterSetup t={t} onDone={() => setCounter(storage.counter())} />;
  return <Counter t={t} lang={lang} setLang={setLang} onLogout={() => (storage.setToken(null), setLoggedIn(false))} />;
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

/* ---------------- First run on a device: which counter is this? ---------------- */

function CounterSetup({ t, onDone }: { t: T; onDone: () => void }) {
  const [code, setCode] = useState("A");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    // Carry on from the last bill this counter sent, in case the device was reset.
    let seq = 0;
    try {
      const r = await api<{ last_bill_no: string | null }>(`/billing/counters/${code}/last`);
      if (r.last_bill_no) seq = Number(r.last_bill_no.split("-").at(-1)) || 0;
    } catch {
      /* offline: start from 0; the server refuses a repeated number, so nothing is lost silently */
    }
    storage.setCounter({ code, seq, tokenDate: businessDate(), token: 0 });
    onDone();
  }
  return (
    <div className="login">
      <div className="login-card">
        <h1>{t("setup.title")}</h1>
        <p className="muted">{t("setup.help")}</p>
        <div className="lang-row">
          {["A", "B", "C", "D"].map((c) => <button key={c} className={`chip big${code === c ? " on" : ""}`} onClick={() => setCode(c)}>{c}</button>)}
        </div>
        <button className="btn primary big block" disabled={busy || !validCounter(code)} onClick={go}>{t("setup.go")}</button>
      </div>
    </div>
  );
}

/* ---------------- The counter ---------------- */

/** What's shown on screen in place of a printout (when no printer is connected), or after payment. */
type View =
  | { kind: "kot"; order: Order; lines: Order["lines"] }
  | { kind: "bill"; bill: Bill }
  | { kind: "paid"; bill: Bill; change: number };

function Counter({ t, lang, setLang, onLogout }: { t: T; lang: Lang; setLang: (l: Lang) => void; onLogout: () => void }) {
  const [config, setConfig] = useState<Config | null>(storage.config());
  const [configError, setConfigError] = useState(false);
  const [orders, setOrdersState] = useState<Order[]>(storage.orders());
  const [bills, setBillsState] = useState<Bill[]>(storage.bills());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [screen, setScreen] = useState<"tables" | "order" | "summary">("tables");
  const [online, setOnline] = useState(navigator.onLine);
  const [print, setPrint] = useState<PrintJob | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [starting, setStarting] = useState<{ table: Table | null } | null>(null);
  const [askLogout, setAskLogout] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const setOrders = (fn: (o: Order[]) => Order[]) =>
    setOrdersState((prev) => {
      const next = fn(prev);
      storage.setOrders(next);
      return next;
    });
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
  }, [onLogout]);

  useEffect(() => {
    void loadConfig();
    void sync();
    const a = window.setInterval(() => void sync(), SYNC_EVERY_MS);
    const b = window.setInterval(() => void loadConfig(), CONFIG_EVERY_MS);
    const c = window.setInterval(() => setNow(Date.now()), 30_000);
    const on = () => (setOnline(true), void sync());
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      [a, b, c].forEach(window.clearInterval);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [loadConfig, sync]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const active = orders.find((o) => o.id === activeId) ?? null;
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

  function open(o: Order) {
    setOrders((os) => [...os, o]);
    setActiveId(o.id);
    setScreen("order");
  }
  function openTable(table: Table) {
    const existing = orders.find((o) => o.table_id === table.id);
    if (existing) return (setActiveId(existing.id), setScreen("order"));
    // Ask who is serving first; with no waiters set up, go straight in.
    if (config!.waiters.length) setStarting({ table });
    else open(newOrder("dine_in", table, null));
  }
  function newTableOrder() {
    setStarting({ table: null });
  }
  function startOrder(table: Table | null, waiter: number | null, tableName: string | null) {
    setStarting(null);
    // Without the table map, every order gets a number for the day so it can be found again.
    open(newOrder("dine_in", table, table ? null : takeToken(), { waiter, tableName }));
  }
  function newParcel() {
    open(newOrder("parcel", null, takeToken()));
  }
  function update(fn: (o: Order) => Order) {
    if (!active) return;
    setOrders((os) => os.map((o) => (o.id === active.id ? fn(o) : o)));
  }
  function leaveOrder() {
    // An order with nothing in it doesn't keep the table busy.
    if (active && active.lines.length === 0 && !active.bill_no) setOrders((os) => os.filter((o) => o.id !== active.id));
    setActiveId(null);
    setScreen("tables");
  }
  function sendKot() {
    if (!active) return;
    const lines = unsent(active);
    if (!lines.length) return;
    update((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l, sent: l.qty })) }));
    if (printing) setPrint({ kind: "kot", order: active, lines });
    else setView({ kind: "kot", order: active, lines });
    setToast(t("kot_sent"));
  }
  /** Gives the order its bill number (once) and returns the bill as it stands, to print or show. */
  function billNow(): Bill | null {
    if (!active || !active.lines.length) return null;
    const withNo = active.bill_no ? active : { ...active, bill_no: takeBillNo() };
    update(() => withNo);
    const bill = toBill(withNo, s, "paid", [], null);
    if (printing) setPrint({ kind: "bill", bill });
    return bill;
  }
  function finish(order: Order, status: Bill["status"], payments: Payment[], reason: string | null) {
    const bill = toBill(order, s, status, payments, reason);
    storage.setBills(pruneBills([...storage.bills(), bill]));
    refreshBills();
    setOrders((os) => os.filter((o) => o.id !== order.id));
    setActiveId(null);
    setScreen("tables");
    void sync();
    return bill;
  }
  const showBill = (b: Bill) => (printing ? setPrint({ kind: "bill", bill: b }) : setView({ kind: "bill", bill: b }));

  const user = storage.user();
  return (
    <div className="app">
      <header className="topbar">
        <button className={`tab${screen !== "summary" ? " on" : ""}`} onClick={() => (active ? leaveOrder() : setScreen("tables"))}>{tablesOn ? t("tables") : t("orders")}</button>
        <button className={`tab${screen === "summary" ? " on" : ""}`} onClick={() => (active && leaveOrder(), setScreen("summary"))}>{t("summary")}</button>
        <span className="grow" />
        <span className={`net ${online ? "on" : "off"}`}>
          <span className="dot" /> {online ? t("online") : t("offline")}
          {waiting > 0 && <> · {t("waiting", { n: waiting })}</>}
        </span>
        <select className="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <span className="who">{storage.counter()?.code} · {user?.name}</span>
      </header>
      {rejected > 0 && <div className="banner bad">{t("rejected", { n: rejected })}</div>}

      {screen === "tables" && (tablesOn ? (
        <TablesScreen t={t} config={config} orders={orders} now={now} onTable={openTable} onParcel={newParcel} onOrder={(o) => (setActiveId(o.id), setScreen("order"))} />
      ) : (
        <OrdersScreen t={t} config={config} orders={orders} now={now} onNew={newTableOrder} onParcel={newParcel} onOrder={(o) => (setActiveId(o.id), setScreen("order"))} />
      ))}
      {screen === "order" && active && (
        <OrderScreen
          t={t} lang={lang} config={config} order={active} update={update} onBack={leaveOrder}
          onKot={sendKot} onBill={billNow}
          onPaid={(payments, change) => {
            const bill = finish(active, "paid", payments, null);
            setToast(t("paid_done", { no: bill.bill_no }));
            if (printing) {
              if (!active.bill_no) setPrint({ kind: "bill", bill });
            } else setView({ kind: "paid", bill, change });
          }}
          onCancel={(reason) => {
            // Nothing reached the kitchen or the guest: just drop it. Otherwise keep a cancelled bill.
            if (!active.bill_no && active.lines.every((l) => l.sent === 0)) {
              setOrders((os) => os.filter((o) => o.id !== active.id));
              setActiveId(null);
              setScreen("tables");
            } else finish(active, "cancelled", [], reason);
          }}
        />
      )}
      {screen === "summary" && (
        <Summary
          t={t} config={config} bills={bills} waiting={waiting} online={online} printing={printing}
          onSync={() => void sync()} onPrint={(date, list) => setPrint({ kind: "summary", date, bills: list })}
          onOpen={showBill}
          onLogout={() => setAskLogout(true)}
        />
      )}
      {starting && (
        <StartDialog t={t} config={config} table={starting.table} onClose={() => setStarting(null)}
          onStart={(waiter, tableName) => startOrder(starting.table, waiter, tableName)} />
      )}
      {view?.kind === "kot" && <KitchenDialog t={t} config={config} order={view.order} lines={view.lines} onClose={() => setView(null)} />}
      {(view?.kind === "bill" || view?.kind === "paid") && (
        <BillDialog t={t} config={config} bill={view.bill} paid={view.kind === "paid"} change={view.kind === "paid" ? view.change : 0}
          onPrint={printing ? () => setPrint({ kind: "bill", bill: view.bill }) : undefined} onClose={() => setView(null)} />
      )}
      {askLogout && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="dialog">
            <h2>{t("logout_confirm")}</h2>
            {(orders.length > 0 || waiting > 0) && <p className="muted">{t("logged_out_note")}</p>}
            <div className="actions-row">
              <button className="btn big" onClick={() => setAskLogout(false)}>{t("close")}</button>
              <button className="btn big danger-solid" onClick={onLogout}>{t("logout")}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      <PrintArea t={t} job={print} settings={s} config={config} onDone={() => setPrint(null)} />
    </div>
  );
}

/* ---------------- Tables (only when the table map is on) ---------------- */

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

const waiterName = (config: Config, id: number | null) => {
  const w = config.waiters.find((x) => x.id === id);
  return w ? `${w.waiter_code ? `${w.waiter_code} · ` : ""}${w.name}` : "";
};

function TablesScreen({ t, config, orders, now, onTable, onParcel, onOrder }: {
  t: T; config: Config; orders: Order[]; now: number; onTable: (t: Table) => void; onParcel: () => void; onOrder: (o: Order) => void;
}) {
  const areas = [...new Set(config.tables.map((x) => x.area))];
  const [area, setArea] = useState(areas[0] ?? "");
  const parcels = orders.filter((o) => o.type === "parcel");
  const s = config.settings;
  return (
    <main className="tables-screen">
      <div className="area-tabs">
        {areas.map((a) => (
          <button key={a} className={`chip big${a === area ? " on" : ""}`} onClick={() => setArea(a)}>
            {a || t("tables")} <span className="count">{orders.filter((o) => config.tables.find((x) => x.id === o.table_id)?.area === a).length || ""}</span>
          </button>
        ))}
        <span className="grow" />
        <span className="legend"><i className="free" /> {t("free")} <i className="ordering" /> {t("ordering")} <i className="billed" /> {t("billed")}</span>
      </div>
      <div className="table-grid">
        {config.tables.filter((x) => x.area === area).map((table) => {
          const o = orders.find((x) => x.table_id === table.id);
          const state = !o ? "free" : o.bill_no ? "billed" : "ordering";
          return (
            <button key={table.id} className={`table-card ${state}`} onClick={() => onTable(table)}>
              <span className="name">{table.name}</span>
              {o ? (
                <>
                  <span className="amt num">{formatINR(totalsOf(o, s).total)}</span>
                  <span className="meta">{t("min", { n: minutesSince(o.opened_at, now) })}{o.waiter_staff_id ? ` · ${waiterName(config, o.waiter_staff_id)}` : ""}</span>
                </>
              ) : (
                <span className="meta">{t("free")}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="parcel-row">
        <button className="btn primary big" onClick={onParcel}>＋ {t("new_parcel")}</button>
        {parcels.map((o) => (
          <button key={o.id} className={`table-card small ${o.bill_no ? "billed" : "ordering"}`} onClick={() => onOrder(o)}>
            <span className="name">{t("token", { n: o.token ?? "" })}</span>
            <span className="amt num">{formatINR(totalsOf(o, s).total)}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

/* ---------------- Open orders (the default: no table map) ---------------- */

function OrdersScreen({ t, config, orders, now, onNew, onParcel, onOrder }: {
  t: T; config: Config; orders: Order[]; now: number; onNew: () => void; onParcel: () => void; onOrder: (o: Order) => void;
}) {
  const s = config.settings;
  // Oldest first, so the table that has waited longest is at the top.
  const list = [...orders].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  return (
    <main className="tables-screen">
      <div className="start-row">
        <button className="btn primary huge" onClick={onNew}>＋ {t("new_table_order")}</button>
        <button className="btn huge parcel-btn" onClick={onParcel}>＋ {t("new_parcel")}</button>
      </div>
      <div className="area-tabs">
        <h2>{t("open_orders")} {list.length > 0 && <span className="pill">{list.length}</span>}</h2>
        <span className="grow" />
        <span className="legend"><i className="ordering" /> {t("ordering")} <i className="billed" /> {t("billed")}</span>
      </div>
      {list.length === 0 ? (
        <p className="muted center empty-note">{t("no_open_orders")}</p>
      ) : (
        <div className="order-grid">
          {list.map((o) => (
            <button key={o.id} className={`table-card order-card ${o.bill_no ? "billed" : "ordering"}`} onClick={() => onOrder(o)}>
              <span className="name">{o.type === "parcel" ? `${t("parcel")} #${o.token ?? ""}` : o.table_name ? `${t("table")} ${o.table_name}` : t("order_no", { n: o.token ?? "" })}</span>
              {o.type === "dine_in" && o.table_name && o.token && <span className="meta">{t("order_no", { n: o.token })}</span>}
              <span className="amt num">{formatINR(totalsOf(o, s).total)}</span>
              <span className="meta">
                {t("min", { n: minutesSince(o.opened_at, now) })}
                {o.waiter_staff_id ? ` · ${waiterName(config, o.waiter_staff_id)}` : o.type === "dine_in" && needsWaiter(o, config) ? ` · ⚠ ${t("waiter_needed")}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

/* ---------------- Order ---------------- */

function OrderScreen({ t, lang, config, order, update, onBack, onKot, onBill, onPaid, onCancel }: {
  t: T; lang: Lang; config: Config; order: Order; update: (fn: (o: Order) => Order) => void; onBack: () => void;
  onKot: () => void; onBill: () => Bill | null; onPaid: (p: Payment[], change: number) => void; onCancel: (reason: string) => void;
}) {
  const s = config.settings;
  const printing = !!s.printing;
  const favourites = config.items.filter((i) => i.favourite);
  const [cat, setCat] = useState<number | "fav">(favourites.length ? "fav" : config.categories[0]?.id ?? 0);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"pay" | "cancel" | "discount" | "waiter" | "waiter_then_pay" | "table" | "bill" | null>(null);
  const [billPreview, setBillPreview] = useState<Bill | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const totals = totalsOf(order, s);
  const pending = unsent(order).reduce((n, l) => n + l.qty, 0);
  const listRef = useRef<HTMLDivElement>(null);
  const catName = (c: Config["categories"][number]) => (lang === "hi" && c.name_hi) || (lang === "kn" && c.name_kn) || c.name;
  // Item names follow the counter's language when the owner has filled them in; bills and the kitchen keep the English name.
  const localName = (i: Item | undefined) => (i && ((lang === "hi" && i.name_hi) || (lang === "kn" && i.name_kn))) || null;
  const itemById = useMemo(() => new Map(config.items.map((i) => [i.id, i])), [config.items]);
  const missingWaiter = needsWaiter(order, config);
  const where = order.type === "parcel"
    ? `${t("parcel")} · ${t("token", { n: order.token ?? "" })}`
    : order.table_name ? `${t("table")} ${order.table_name}` : t("order_no", { n: order.token ?? "" });

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return config.items.filter((i) => [i.name, i.short_name, i.name_hi, i.name_kn].some((n) => (n ?? "").toLowerCase().includes(q)));
    return cat === "fav" ? favourites : config.items.filter((i) => i.category_id === cat);
  }, [query, cat, config.items, favourites]);

  function add(item: Item) {
    update((o) => addItem(o, item, config.categories, s));
    window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 0);
  }
  function bill() {
    const b = onBill();
    if (b && !printing) (setBillPreview(b), setDialog("bill"));
  }
  const pay = () => setDialog(missingWaiter ? "waiter_then_pay" : "pay");

  return (
    <main className="order-screen">
      <nav className="cats" aria-label="Categories">
        {favourites.length > 0 && <button className={`cat${cat === "fav" && !query ? " on" : ""}`} onClick={() => (setCat("fav"), setQuery(""))}>★ {t("favourites")}</button>}
        {config.categories.map((c) => (
          <button key={c.id} className={`cat${cat === c.id && !query ? " on" : ""}`} onClick={() => (setCat(c.id), setQuery(""))}>{catName(c)}</button>
        ))}
      </nav>

      <section className="items">
        <div className="search-row">
          <input className="search" placeholder={`🔍 ${t("search")}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="btn" onClick={() => setQuery("")} aria-label={t("clear")}>✕</button>}
        </div>
        <div className="item-grid">
          {items.map((i) => {
            const inOrder = order.lines.filter((l) => l.item_id === i.id).reduce((n, l) => n + l.qty, 0);
            return (
              <button key={i.id} className={`item${inOrder ? " in" : ""}`} onClick={() => add(i)}>
                <span className={`veg ${i.veg ? "v" : "nv"}`} />
                <span className="iname">{localName(i) || i.short_name || i.name}</span>
                <span className="price num">{formatINR(i.price)}</span>
                {inOrder > 0 && <span className="badge">{inOrder}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="ticket">
        <div className="ticket-head">
          <button className="btn" onClick={onBack}>‹ {usesTables(config) ? t("back") : t("orders")}</button>
          <strong className="where">{where}</strong>
          {order.bill_no && <span className="pill">{order.bill_no}</span>}
        </div>
        <div className="ticket-opts">
          <button className={`opt${missingWaiter ? " need" : ""}`} onClick={() => setDialog("waiter")} disabled={!config.waiters.length}>
            <span className="muted small">{t("waiter_short")}</span>
            <strong>{order.waiter_staff_id ? waiterName(config, order.waiter_staff_id) : config.waiters.length ? (missingWaiter ? `⚠ ${t("waiter_needed")}` : t("no_waiter")) : "—"}</strong>
          </button>
          {order.type === "dine_in" && order.table_id === null && (
            <button className="opt" onClick={() => setDialog("table")}>
              <span className="muted small">{t("set_table")}</span>
              <strong>{order.table_name ?? "—"}</strong>
            </button>
          )}
        </div>
        <div className="lines" ref={listRef}>
          {order.lines.length === 0 && <p className="muted center">{t("order_empty")}</p>}
          {order.lines.map((l) => (
            <div key={l.key} className={`line${l.sent >= l.qty ? " sent" : ""}`}>
              <div className="lname" onClick={() => setNoteFor(noteFor === l.key ? null : l.key)}>
                <span>{(l.item_id !== null && localName(itemById.get(l.item_id))) || l.name}</span>
                {l.note && <span className="note">✎ {l.note}</span>}
                <span className="muted small num">{formatINR(l.price)}{l.sent > 0 ? ` · ${t("kot_sent")} ${l.sent}` : ""}</span>
              </div>
              <div className="stepper">
                <button onClick={() => update((o) => changeQty(o, l.key, -1))} aria-label="−">−</button>
                <span className="num">{l.qty}</span>
                <button onClick={() => update((o) => changeQty(o, l.key, +1))} aria-label="+">+</button>
              </div>
              <span className="lamt num">{formatINR(l.price * l.qty)}</span>
              {noteFor === l.key && (
                <input className="note-input" autoFocus placeholder={t("note")} defaultValue={l.note ?? ""}
                  onBlur={(e) => (update((o) => ({ ...o, lines: o.lines.map((x) => (x.key === l.key ? { ...x, note: e.target.value.trim() || null } : x)) })), setNoteFor(null))}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              )}
            </div>
          ))}
        </div>
        <div className="sums">
          {totals.discount > 0 && <Row label={t("discount")} value={`−${formatINR(totals.discount)}`} />}
          {totals.tax > 0 && <Row label={`${t("gst")}${s.prices_include_tax ? " (incl.)" : ""}`} value={formatINR(totals.tax)} />}
          {totals.round_off !== 0 && <Row label={t("round_off")} value={formatINR(totals.round_off)} />}
          <div className="grand"><span>{t("total")}</span><span className="num">{formatINR(totals.total)}</span></div>
        </div>
        <div className="actions">
          <button className="btn" disabled={!order.lines.length} onClick={() => setDialog("discount")}>{t("discount")}</button>
          <button className="btn danger" onClick={() => setDialog("cancel")}>{t("cancel_order")}</button>
          <button className="btn kot" disabled={!pending} onClick={onKot}>{printing ? t("kot") : t("send_kitchen")}{pending ? ` (${pending})` : ""}</button>
          <button className="btn" disabled={!order.lines.length} onClick={bill}>{printing ? t("print_bill") : t("show_bill")}</button>
          <button className="btn primary big pay" disabled={!order.lines.length || totals.total <= 0} onClick={pay}>{t("pay")} · {formatINR(totals.total)}</button>
        </div>
      </aside>

      {dialog === "pay" && <PayDialog t={t} due={totals.total} onClose={() => setDialog(null)} onDone={(p, change) => (setDialog(null), onPaid(p, change))} />}
      {dialog === "cancel" && <CancelDialog t={t} onClose={() => setDialog(null)} onDone={(r) => (setDialog(null), onCancel(r))} />}
      {dialog === "discount" && (
        <DiscountDialog t={t} subtotal={totals.subtotal} current={order.discount} onClose={() => setDialog(null)}
          onDone={(d) => (setDialog(null), update((o) => ({ ...o, discount: d })))} />
      )}
      {(dialog === "waiter" || dialog === "waiter_then_pay") && (
        <WaiterDialog t={t} config={config} current={order.waiter_staff_id} optional={order.type === "parcel" || s.waiter_required === false}
          onClose={() => setDialog(null)}
          onPick={(id) => (update((o) => ({ ...o, waiter_staff_id: id })), setDialog(dialog === "waiter_then_pay" && (id || order.type === "parcel") ? "pay" : null))} />
      )}
      {dialog === "table" && (
        <TableNoDialog t={t} current={order.table_name} onClose={() => setDialog(null)}
          onDone={(name) => (update((o) => ({ ...o, table_name: name })), setDialog(null))} />
      )}
      {dialog === "bill" && billPreview && (
        <BillDialog t={t} config={config} bill={billPreview} onClose={() => setDialog(null)} onPay={() => setDialog(missingWaiter ? "waiter_then_pay" : "pay")} />
      )}
    </main>
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
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t("pick_waiter")}>
      <div className="dialog wide">
        <div className="dialog-head"><h2>{t("pick_waiter")}</h2><button className="btn" onClick={onClose}>{t("close")}</button></div>
        <WaiterGrid config={config} current={current} onPick={onPick} />
        {optional && current !== null && <button className="btn big" onClick={() => onPick(null)}>{t("no_waiter")}</button>}
      </div>
    </div>
  );
}

/** Starting a table order: who's serving, and (without the table map) an optional table number. */
function StartDialog({ t, config, table, onClose, onStart }: {
  t: T; config: Config; table: Table | null; onClose: () => void; onStart: (waiter: number | null, tableName: string | null) => void;
}) {
  const [waiter, setWaiter] = useState<number | null>(null);
  const [tableNo, setTableNo] = useState("");
  const required = config.settings.waiter_required !== false && config.waiters.length > 0;
  // With the table map, picking the waiter is the only question, so a tap starts the order.
  if (table) {
    return (
      <div className="overlay" role="dialog" aria-modal="true">
        <div className="dialog wide">
          <div className="dialog-head"><h2>{t("table")} {table.name} · {t("pick_waiter")}</h2><button className="btn" onClick={onClose}>{t("close")}</button></div>
          <WaiterGrid config={config} current={null} onPick={(id) => onStart(id, null)} />
          {!required && <button className="btn big" onClick={() => onStart(null, null)}>{t("no_waiter")}</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog wide start-dialog">
        <div className="dialog-head"><h2>{t("new_table_order")}</h2><button className="btn" onClick={onClose}>{t("close")}</button></div>
        <div className="start-cols">
          <div className="start-waiters">
            <h3>{t("pick_waiter")}</h3>
            {config.waiters.length ? <WaiterGrid config={config} current={waiter} onPick={setWaiter} /> : <p className="muted">{t("no_waiters_setup")}</p>}
          </div>
          <div className="start-table">
            <h3>{t("table_optional")}</h3>
            <div className="display num">{tableNo || "—"}</div>
            <Keypad onKey={(k) => setTableNo((v) => (k === "⌫" ? v.slice(0, -1) : (v + k).slice(0, 6)))} keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]} />
          </div>
        </div>
        <button className="btn primary big block" disabled={required && waiter === null} onClick={() => onStart(waiter, tableNo || null)}>
          {required && waiter === null ? t("waiter_needed") : t("start_order")}
        </button>
      </div>
    </div>
  );
}

function TableNoDialog({ t, current, onClose, onDone }: { t: T; current: string | null; onClose: () => void; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(current ?? "");
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <div className="dialog-head"><h2>{t("table_optional")}</h2><button className="btn" onClick={onClose}>{t("close")}</button></div>
        <div className="display num">{v || "—"}</div>
        <Keypad onKey={(k) => setV((x) => (k === "⌫" ? x.slice(0, -1) : (x + k).slice(0, 6)))} keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]} />
        <div className="actions-row">
          <button className="btn big" onClick={() => onDone(null)}>{t("no_table")}</button>
          <button className="btn big primary" onClick={() => onDone(v || null)}>{t("done")}</button>
        </div>
      </div>
    </div>
  );
}

/** With no kitchen printer: the new items in big text, to read out or show. */
function KitchenDialog({ t, config, order, lines, onClose }: { t: T; config: Config; order: Order; lines: Order["lines"]; onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dialog kitchen" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{t("kitchen_title")} · {order.type === "parcel" ? `${t("parcel")} #${order.token ?? ""}` : order.table_name ? `${t("table")} ${order.table_name}` : t("order_no", { n: order.token ?? "" })}</h2>
        </div>
        {order.waiter_staff_id && <p className="muted">{t("waiter_short")}: {waiterName(config, order.waiter_staff_id)}</p>}
        <div className="kitchen-lines">
          {lines.map((l) => (
            <div key={l.key} className="kline">
              <strong className="num">{l.qty} ×</strong> <span>{l.name}</span>
              {l.note && <div className="note">→ {l.note}</div>}
            </div>
          ))}
        </div>
        <p className="muted small">{t("kitchen_help")}</p>
        <button className="btn primary big block" onClick={onClose}>{t("done")}</button>
      </div>
    </div>
  );
}

/** The bill on screen: shown to the guest before payment, and after it as the receipt. */
function BillDialog({ t, config, bill, paid, change = 0, onClose, onPay, onPrint }: {
  t: T; config: Config; bill: Bill; paid?: boolean; change?: number; onClose: () => void; onPay?: () => void; onPrint?: () => void;
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog bill-dialog">
        {paid && (
          <div className="paid-banner">
            <strong>✓ {t("paid_title")} · {formatINR(bill.total)}</strong>
            {change > 0 && <span>{t("change_given")}: <strong className="num">{formatINR(change)}</strong></span>}
          </div>
        )}
        <div className="receipt receipt-screen"><ReceiptBody t={t} bill={bill} settings={config.settings} config={config} /></div>
        {!paid && <p className="muted small center">{t("bill_on_screen")}</p>}
        <div className="actions-row">
          {onPrint && <button className="btn big" onClick={onPrint}>{t("print")}</button>}
          <button className="btn big" onClick={onClose}>{paid ? t("done") : t("close")}</button>
          {onPay && <button className="btn big primary" onClick={onPay}>{t("pay")} · {formatINR(bill.total)}</button>}
        </div>
      </div>
    </div>
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
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t("pay_title")}>
      <div className="dialog pay-dialog">
        <div className="dialog-head"><h2>{t("pay_title")}</h2><button className="btn" onClick={onClose}>{t("close")}</button></div>
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
      </div>
    </div>
  );
}

function CancelDialog({ t, onClose, onDone }: { t: T; onClose: () => void; onDone: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>{t("cancel_reason")}</h2>
        <div className="reason-grid">
          {t("cancel_reasons").split("|").map((r) => <button key={r} className={`chip big${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}
        </div>
        <div className="actions-row">
          <button className="btn big" onClick={onClose}>{t("keep")}</button>
          <button className="btn big danger-solid" disabled={!reason} onClick={() => onDone(reason)}>{t("cancel_confirm")}</button>
        </div>
      </div>
    </div>
  );
}

function DiscountDialog({ t, subtotal, current, onClose, onDone }: { t: T; subtotal: number; current: number; onClose: () => void; onDone: (paise: number) => void }) {
  const [rupees, setRupees] = useState(current ? String(current / 100) : "");
  const paise = Math.min(subtotal, rupeesToPaise(rupees) ?? 0);
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>{t("discount_title")}</h2>
        <div className="reason-grid">
          {[5, 10, 15, 20].map((p) => <button key={p} className="chip big" onClick={() => setRupees(String(Math.round((subtotal * p) / 100) / 100))}>{p}%</button>)}
        </div>
        <div className="display num">{formatINR(paise)}</div>
        <Keypad onKey={(k) => setRupees((g) => (k === "⌫" ? g.slice(0, -1) : (g + k).replace(/^0+/, "").slice(0, 7)))} />
        <div className="actions-row">
          <button className="btn big" onClick={() => onDone(0)}>{t("remove")}</button>
          <button className="btn big" onClick={onClose}>{t("close")}</button>
          <button className="btn big primary" onClick={() => onDone(paise)}>{t("apply")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Day summary ---------------- */

function Summary({ t, config, bills, waiting, online, printing, onSync, onPrint, onOpen, onLogout }: {
  t: T; config: Config; bills: Bill[]; waiting: number; online: boolean; printing: boolean;
  onSync: () => void; onPrint: (date: string, b: Bill[]) => void; onOpen: (b: Bill) => void; onLogout: () => void;
}) {
  const date = businessDate();
  const today = bills.filter((b) => b.business_date === date);
  const paid = today.filter((b) => b.status === "paid");
  const sum = (list: Bill[]) => list.reduce((s, b) => s + b.total, 0);
  const mode = (m: BillPayMode) => paid.reduce((s, b) => s + b.payments.filter((p) => p.mode === m).reduce((a, p) => a + p.amount, 0), 0);
  const waiters = byWaiter(today, config.waiters);
  return (
    <main className="summary">
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
      <h2>{t("recent")}</h2>
      <div className="bill-list">
        {[...today].reverse().map((b) => (
          <button key={b.client_id} className={`bill-row${b.status === "cancelled" ? " cancelled" : ""}`} onClick={() => onOpen(b)} title={printing ? t("reprint") : t("view_bill")}>
            <span className="num">{b.bill_no}</span>
            <span>{orderLabel({ type: b.order_type, table_name: b.table_name, token: b.token }, t)}</span>
            <span className="muted">{new Date(b.closed_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}</span>
            <span className="muted">{b.status === "cancelled" ? `${t("cancelled")}: ${b.cancel_reason}` : b.payments.map((p) => t(p.mode as Key)).join(" + ")}</span>
            <strong className="num">{formatINR(b.total)}</strong>
            <span className={`sync ${b.synced ? "ok" : b.rejected ? "bad" : "wait"}`}>{b.synced ? "✓" : b.rejected ? "!" : "…"}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

/* ---------------- The bill, for the screen and for an 80 mm receipt ---------------- */

function ReceiptBody({ t, bill: b, settings, config }: { t: T; bill: Bill; settings: Config["settings"]; config: Config }) {
  const totals = totalsOf({ lines: b.lines.map((l, i) => ({ ...l, key: String(i), sent: 0 })), discount: b.discount } as Order, { ...settings, prices_include_tax: b.prices_include_tax });
  const when = new Date(b.closed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" });
  const showGst = settings.use_gst !== false && !!settings.gstin;
  const waiter = waiterName(config, b.waiter_staff_id);
  return (
    <>
      {settings.bill_header.split("\n").map((line, i) => <div key={i} className={`p-center${i === 0 ? " p-big" : ""}`}>{line}</div>)}
      {showGst && <div className="p-center">{t("gstin")}: {settings.gstin}</div>}
      <hr />
      <div className="p-row"><span>{t("bill_no")}: {b.bill_no}</span><span>{orderLabel({ type: b.order_type, table_name: b.table_name, token: b.token }, t)}</span></div>
      <div className="p-row"><span>{when}</span>{waiter && <span>{t("waiter_short")}: {waiter}</span>}</div>
      <hr />
      {b.lines.map((l, i) => (
        <div key={i} className="p-row"><span>{l.qty} × {l.name}</span><span>{formatINR(l.qty * l.price, { symbol: false })}</span></div>
      ))}
      <hr />
      <div className="p-row"><span>{t("subtotal")}</span><span>{formatINR(totals.subtotal, { symbol: false })}</span></div>
      {totals.discount > 0 && <div className="p-row"><span>{t("discount")}</span><span>−{formatINR(totals.discount, { symbol: false })}</span></div>}
      {totals.tax > 0 && (
        <>
          <div className="p-row"><span>{t("cgst")}{b.prices_include_tax ? " (incl.)" : ""}</span><span>{formatINR(totals.cgst, { symbol: false })}</span></div>
          <div className="p-row"><span>{t("sgst")}{b.prices_include_tax ? " (incl.)" : ""}</span><span>{formatINR(totals.sgst, { symbol: false })}</span></div>
        </>
      )}
      {totals.round_off !== 0 && <div className="p-row"><span>{t("round_off")}</span><span>{formatINR(totals.round_off, { symbol: false })}</span></div>}
      <div className="p-row p-big"><span>{t("total")}</span><span>{formatINR(b.total)}</span></div>
      {b.payments.length > 0 && <div className="p-row"><span>{b.payments.map((p) => `${t(p.mode as Key)} ${formatINR(p.amount)}`).join(" + ")}</span></div>}
      <hr />
      {settings.bill_footer && <div className="p-center">{settings.bill_footer}</div>}
    </>
  );
}

/* ---------------- Printing (only when a receipt printer is connected) ---------------- */

function PrintArea({ t, job, settings, config, onDone }: { t: T; job: PrintJob | null; settings: Config["settings"]; config: Config; onDone: () => void }) {
  useEffect(() => {
    if (!job) return;
    const after = () => onDone();
    window.addEventListener("afterprint", after, { once: true });
    const id = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("afterprint", after);
    };
  }, [job, onDone]);
  if (!job) return null;
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" });
  let body: React.ReactNode = null;

  if (job.kind === "kot") {
    const o = job.order;
    body = (
      <>
        <div className="p-center p-big">{t("kot").toUpperCase()}</div>
        <div className="p-center p-big">{orderLabel(o, t)}</div>
        <div className="p-row"><span>{when}</span><span>{waiterName(config, o.waiter_staff_id)}</span></div>
        <hr />
        {job.lines.map((l) => (
          <div key={l.key}>
            <div className="p-row p-big"><span>{l.qty} × {l.name}</span></div>
            {l.note && <div>  → {l.note}</div>}
          </div>
        ))}
      </>
    );
  } else if (job.kind === "bill") {
    body = <ReceiptBody t={t} bill={job.bill} settings={settings} config={config} />;
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
