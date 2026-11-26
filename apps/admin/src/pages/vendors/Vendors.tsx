import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { businessDate, formatDay, formatINR, rupeesToPaise, type Lang } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { newClientId } from "../../lib/format";
import { Icon } from "../../components/Icon";
import { Empty, ErrorNote, Field, Loading, MoneyInput, NavCard, PageHead, PhotoInput, Pill, Segmented, useToast } from "../../components/ui";

type Terms = "daily" | "every_2_days" | "per_delivery" | "weekly" | "times_month" | "monthly";
const TERMS: Terms[] = ["daily", "every_2_days", "per_delivery", "weekly", "times_month", "monthly"];
type T = ReturnType<typeof useSession>["t"];
/** "Daily", "3 times a month", "Lump sum or on delivery"… */
function termsLabel(t: T, v: { payment_terms: Terms; bills_per_month: number | null }) {
  if (v.payment_terms === "times_month") return t("terms.times_month_n", { count: v.bills_per_month ?? 1 });
  return t(`terms.${v.payment_terms}` as const);
}
interface VendorRow { id: number; name: string; phone: string | null; payment_terms: Terms; bills_per_month: number | null; opening_due: number; note: string | null; active: number; due: number; last_delivery: string | null; items: number }
interface Item { id: number; item: string; unit: string; agreed_rate: number; usual_qty: number | null; delivery_days: string | null; active: number }
interface Expected { id: number; item: string; unit: string; usual_qty: number | null; vendor_id: number; vendor_name: string; logged: boolean }
interface HistoryRow { kind: "delivery" | "payment"; id: number; business_date: string; label: string; qty: number | null; unit: string | null; rate: number | null; agreed_rate: number | null; amount: number; photo_key: string | null; note: string | null; by_name: string | null; balance: number }
interface Totals { opening: number; bought: number; paid: number; due: number }

const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
function weekdays(lang: Lang) {
  const f = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "short", timeZone: "UTC" });
  // 2026-11-01 is a Sunday (0).
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 10, 1 + i))));
}

export function VendorList() {
  const { t, user } = useSession();
  const owner = user!.role === "owner";
  const list = useApi<{ vendors: VendorRow[] }>("/vendors");
  const expected = useApi<{ items: Expected[] }>("/vendors/expected");
  const [adding, setAdding] = useState(false);
  const active = list.data?.vendors.filter((v) => v.active) ?? [];
  const totalDue = active.reduce((s, v) => s + Math.max(0, v.due), 0);
  return (
    <div className="page">
      <PageHead
        title={t("vendor.title")}
        subtitle={owner && active.length > 0 ? `${t("vendor.due")}: ${formatINR(totalDue)}` : undefined}
        action={owner && !adding ? <button className="btn small" onClick={() => setAdding(true)}><Icon name="plus" /> {t("vendor.add")}</button> : undefined}
      />
      {adding && <VendorForm onDone={(id) => (setAdding(false), id ? list.reload() : null)} />}
      {expected.data && expected.data.items.length > 0 && (
        <section className="form">
          <h2>{t("delivery.expected")}</h2>
          <div className="card flush list">
            {expected.data.items.map((e) => (
              <Link className="row" key={e.id} to={`/entries/purchase?vendor=${e.vendor_id}&item=${e.id}`}>
                <Icon name={e.logged ? "check" : "truck"} />
                <span className="grow">
                  <strong className="ellipsis">{e.item}</strong>
                  <span className="muted small">{e.vendor_name}{e.usual_qty ? ` · ${e.usual_qty} ${e.unit}` : ""}</span>
                </span>
                {e.logged ? <Pill tone="good">{t("delivery.logged")}</Pill> : <Icon name="chevron" className="chev" />}
              </Link>
            ))}
          </div>
        </section>
      )}
      {list.error ? <ErrorNote error={list.error} /> : !list.data ? <Loading /> : list.data.vendors.length === 0 ? (
        <Empty>{t("vendor.none")}</Empty>
      ) : (
        <div className="grid-2">
          {list.data.vendors.map((v) => (
            <NavCard
              key={v.id}
              to={`/vendors/${v.id}`}
              icon="truck"
              title={v.name}
              desc={[termsLabel(t, v), v.last_delivery ? formatDay(v.last_delivery) : null, v.active ? null : "—"].filter(Boolean).join(" · ")}
              right={owner && v.due !== 0 ? <span className="amount">{formatINR(v.due)}</span> : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VendorForm({ vendor, onDone }: { vendor?: VendorRow; onDone: (id: number | null) => void }) {
  const t = useSession().t;
  const [f, setF] = useState({
    name: vendor?.name ?? "",
    phone: vendor?.phone ?? "",
    payment_terms: (vendor?.payment_terms ?? "monthly") as Terms,
    bills_per_month: vendor?.bills_per_month ? String(vendor.bills_per_month) : "2",
    opening_due: vendor?.opening_due ? String(vendor.opening_due / 100) : "",
    note: vendor?.note ?? "",
    active: vendor ? Boolean(vendor.active) : true,
  });
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setError(null);
    try {
      const body = { ...f, bills_per_month: f.payment_terms === "times_month" ? Number(f.bills_per_month) : null, opening_due: rupeesToPaise(f.opening_due) ?? 0 };
      if (vendor) {
        await api(`/vendors/${vendor.id}`, { method: "PATCH", json: body });
        onDone(vendor.id);
      } else {
        const r = await api<{ id: number }>("/vendors", { method: "POST", json: body });
        onDone(r.id);
      }
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="card form">
      <div className="grid-2">
        <Field label={t("vendor.name")} htmlFor="v-name"><input id="v-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t("vendor.phone")} htmlFor="v-phone"><input id="v-phone" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <div className="grid-2">
        <Field label={t("vendor.terms")} htmlFor="v-terms">
          <select id="v-terms" className="select" value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value as Terms })}>
            {TERMS.map((v) => <option key={v} value={v}>{t(`terms.${v}` as const)}</option>)}
          </select>
        </Field>
        {f.payment_terms === "times_month" && (
          <Field label={t("vendor.bills_per_month")} htmlFor="v-per-month">
            <input id="v-per-month" className="input" inputMode="numeric" value={f.bills_per_month} onChange={(e) => setF({ ...f, bills_per_month: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
          </Field>
        )}
      </div>
      <Field label={t("vendor.opening_due")} htmlFor="v-due"><MoneyInput id="v-due" value={f.opening_due} onChange={(v) => setF({ ...f, opening_due: v })} /></Field>
      <Field label={t("common.note_optional")} htmlFor="v-note"><input id="v-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {vendor && (
        <label className="checkbox"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span>{t("vendor.active")}</span></label>
      )}
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="btn" onClick={() => onDone(null)}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={!f.name.trim() || (f.payment_terms === "times_month" && !(Number(f.bills_per_month) >= 1 && Number(f.bills_per_month) <= 31))} onClick={save}>{t("common.save")}</button>
      </div>
    </div>
  );
}

/* ---------- Add purchase: pick the vendor here, no need to open the vendor first ---------- */

export function AddPurchase() {
  const t = useSession().t;
  const navigate = useNavigate();
  const q = new URLSearchParams(window.location.search);
  const list = useApi<{ vendors: VendorRow[] }>("/vendors");
  const [vendorId, setVendorId] = useState<number | null>(q.get("vendor") ? Number(q.get("vendor")) : null);
  const detail = useApi<{ vendor: VendorRow; items: Item[] }>(vendorId ? `/vendors/${vendorId}` : null);
  const vendors = (list.data?.vendors ?? []).filter((v) => v.active);
  const preItem = q.get("item") ? Number(q.get("item")) : null;
  return (
    <div className="page">
      <PageHead title={t("purchase.add")} back="/entries" />
      {list.error ? <ErrorNote error={list.error} /> : !list.data ? <Loading /> : vendors.length === 0 ? <Empty>{t("purchase.no_vendors")}</Empty> : (
        <div className="card form">
          <Field label={t("purchase.vendor")} htmlFor="pu-vendor">
            <select id="pu-vendor" className="select" value={vendorId ?? ""} onChange={(e) => setVendorId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t("purchase.pick_vendor")}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      {vendorId && (detail.error ? <ErrorNote error={detail.error} /> : !detail.data || detail.data.vendor.id !== vendorId ? <Loading /> : (
        <DeliveryForm key={vendorId} vendorId={vendorId} paysDaily={detail.data.vendor.payment_terms === "daily"} items={detail.data.items.filter((i) => i.active)}
          preItem={preItem} onDone={() => navigate("/entries")} />
      ))}
    </div>
  );
}

/* ---------- One vendor ---------- */

type Tab = "delivery" | "payment" | "items" | "history";

export function VendorDetail() {
  const { t, user, lang } = useSession();
  const owner = user!.role === "owner";
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const preItem = new URLSearchParams(window.location.search).get("item");
  const res = useApi<{ vendor: VendorRow; items: Item[]; history: HistoryRow[]; totals: Totals }>(`/vendors/${id}`);
  const [tab, setTab] = useState<Tab>("delivery");
  const [editing, setEditing] = useState(false);
  if (!res.data) return res.error ? <ErrorNote error={res.error} /> : <Loading />;
  const { vendor, items, history, totals } = res.data;
  const tabs: { value: Tab; label: string }[] = [
    { value: "delivery", label: t("delivery.add") },
    { value: "payment", label: t("payment.add") },
    ...(owner ? [{ value: "items" as Tab, label: t("vendor.items") }] : []),
    { value: "history", label: t("vendor.history") },
  ];
  return (
    <div className="page">
      <PageHead
        title={vendor.name}
        subtitle={[termsLabel(t, vendor), vendor.phone].filter(Boolean).join(" · ")}
        back="/vendors"
        action={owner && !editing ? <button className="btn small" onClick={() => setEditing(true)}>{t("common.edit")}</button> : undefined}
      />
      {editing && <VendorForm vendor={vendor} onDone={() => (setEditing(false), res.reload())} />}
      {owner && (
        <div className="stats">
          <div className="card stat hero"><span className="label">{t("vendor.due")}</span><span className="value">{formatINR(totals.due)}</span></div>
          <div className="card stat"><span className="label">{t("vendor.bought")}</span><span className="value">{formatINR(totals.bought)}</span>{totals.opening ? <span className="muted small">{t("vendor.plus_opening", { amount: formatINR(totals.opening) })}</span> : null}</div>
          <div className="card stat"><span className="label">{t("vendor.paid")}</span><span className="value">{formatINR(totals.paid)}</span></div>
        </div>
      )}
      <Segmented<Tab> value={tab} onChange={setTab} options={tabs} />
      {tab === "delivery" && <DeliveryForm vendorId={id} paysDaily={vendor.payment_terms === "daily"} items={items.filter((i) => i.active)} preItem={preItem ? Number(preItem) : null} onDone={() => (res.reload(), navigate(`/vendors/${id}`, { replace: true }))} />}
      {tab === "payment" && <PaymentForm vendorId={id} due={owner ? vendor.due : null} onDone={() => (res.reload(), setTab("history"))} />}
      {tab === "items" && owner && <Items vendorId={id} items={items} lang={lang} onChange={res.reload} />}
      {tab === "history" && <History rows={history} showBalance={owner} onChange={res.reload} />}
    </div>
  );
}

function DeliveryForm({ vendorId, paysDaily, items, preItem, onDone }: { vendorId: number; paysDaily: boolean; items: Item[]; preItem: number | null; onDone: () => void }) {
  const t = useSession().t;
  const toast = useToast();
  const first = items.find((i) => i.id === preItem) ?? items[0];
  const [itemId, setItemId] = useState<string>(first ? String(first.id) : "other");
  const item = items.find((i) => String(i.id) === itemId);
  const [f, setF] = useState({
    other: "",
    unit: "",
    qty: first?.usual_qty ? String(first.usual_qty) : "",
    rate: first ? String(first.agreed_rate / 100) : "",
    photo: null as string | null,
    note: "",
  });
  // Vendors billed and paid daily: record the payment with the delivery, in one go.
  const [paidNow, setPaidNow] = useState(paysDaily);
  const [fromCounter, setFromCounter] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // One id per delivery (and its payment) being entered, so a double tap or a retry saves it once.
  const [clientId, setClientId] = useState(newClientId);
  const [payClientId, setPayClientId] = useState(newClientId);
  const qty = Number(f.qty);
  const rate = rupeesToPaise(f.rate);
  const amount = qty > 0 && rate ? Math.round(qty * rate) : null;
  const differs = item && rate !== null && rate !== item.agreed_rate;

  function pick(v: string) {
    setItemId(v);
    const it = items.find((i) => String(i.id) === v);
    setF((x) => ({ ...x, qty: it?.usual_qty ? String(it.usual_qty) : x.qty, rate: it ? String(it.agreed_rate / 100) : x.rate }));
  }
  async function save() {
    if (!amount) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ mismatch: boolean }>(`/vendors/${vendorId}/deliveries`, {
        method: "POST",
        json: { item_id: item?.id ?? null, item: item ? undefined : f.other, unit: item ? undefined : f.unit, qty, rate, photo_key: f.photo, note: f.note, business_date: businessDate(), client_id: clientId },
      });
      if (paidNow) {
        await api(`/vendors/${vendorId}/payments`, {
          method: "POST", json: { amount, mode: "cash", from_counter: fromCounter, note: f.note, business_date: businessDate(), client_id: payClientId },
        });
      }
      toast(t("delivery.logged"));
      setF({ other: "", unit: "", qty: "", rate: "", photo: null, note: "" });
      setClientId(newClientId());
      setPayClientId(newClientId());
      if (r.mismatch) toast(t("delivery.rate_differs", { rate: formatINR(rate!), agreed: formatINR(item!.agreed_rate) }));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card form">
      <Field label={t("vendor.item")} htmlFor="d-item">
        <select id="d-item" className="select" value={itemId} onChange={(e) => pick(e.target.value)}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.item} · {formatINR(i.agreed_rate)}/{i.unit}</option>
          ))}
          <option value="other">{t("delivery.other")}</option>
        </select>
      </Field>
      {!item && (
        <div className="grid-2">
          <Field label={t("vendor.item")} htmlFor="d-other"><input id="d-other" className="input" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} /></Field>
          <Field label={t("vendor.unit")} htmlFor="d-unit"><input id="d-unit" className="input" value={f.unit} placeholder="kg, pcs, crate" onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        </div>
      )}
      <div className="grid-2">
        <Field label={`${t("delivery.qty")}${item ? ` (${item.unit})` : ""}`} htmlFor="d-qty">
          <input id="d-qty" className="input" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/[^\d.]/g, "") })} />
        </Field>
        <Field label={t("delivery.rate")} htmlFor="d-rate"><MoneyInput id="d-rate" value={f.rate} onChange={(v) => setF({ ...f, rate: v })} /></Field>
      </div>
      {differs && (
        <div className="check warn"><Icon name="alert" /><span className="t">{t("delivery.rate_differs", { rate: formatINR(rate!), agreed: formatINR(item!.agreed_rate) })}</span></div>
      )}
      {amount !== null && <div className="section-head"><span className="muted">{t("common.total")}</span><strong className="num">{formatINR(amount)}</strong></div>}
      <label className="checkbox"><input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /><span>{t("delivery.paid_now")}</span></label>
      {paidNow && (
        <label className="checkbox"><input type="checkbox" checked={fromCounter} onChange={(e) => setFromCounter(e.target.checked)} /><span>{t("payment.from_counter")}</span></label>
      )}
      <PhotoInput label={t("delivery.photo")} kind="delivery" value={f.photo} onChange={(k) => setF({ ...f, photo: k })} />
      <Field label={t("common.note_optional")} htmlFor="d-note"><input id="d-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <ErrorNote error={error} />
      <button className="btn primary block" disabled={!amount || (!item && !f.other.trim()) || busy} onClick={save}>
        <Icon name="check" /> {t("delivery.add")}
      </button>
    </div>
  );
}

function PaymentForm({ vendorId, due, onDone }: { vendorId: number; due: number | null; onDone: () => void }) {
  const t = useSession().t;
  const toast = useToast();
  const [f, setF] = useState({ amount: due && due > 0 ? String(due / 100) : "", mode: "cash" as "cash" | "online", fromCounter: false, note: "" });
  const [error, setError] = useState<unknown>(null);
  // One id per payment being entered, so a double tap or a retry saves it once.
  const [clientId] = useState(newClientId);
  const amount = rupeesToPaise(f.amount);
  async function save() {
    if (!amount) return;
    setError(null);
    try {
      await api(`/vendors/${vendorId}/payments`, {
        method: "POST", json: { amount, mode: f.mode, from_counter: f.mode === "cash" && f.fromCounter, note: f.note, client_id: clientId },
      });
      toast(t("common.saved"));
      onDone();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="card form">
      <Field label={t("common.amount")} htmlFor="p-amount"><MoneyInput id="p-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
      <Segmented<"cash" | "online"> value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: "cash", label: t("common.cash") }, { value: "online", label: t("common.online") }]} />
      {f.mode === "cash" && (
        <label className="checkbox"><input type="checkbox" checked={f.fromCounter} onChange={(e) => setF({ ...f, fromCounter: e.target.checked })} /><span>{t("payment.from_counter")}</span></label>
      )}
      <Field label={t("common.note_optional")} htmlFor="p-note"><input id="p-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <ErrorNote error={error} />
      <button className="btn primary block" disabled={!amount} onClick={save}><Icon name="check" /> {t("payment.add")}</button>
    </div>
  );
}

function Items({ vendorId, items, lang, onChange }: { vendorId: number; items: Item[]; lang: Lang; onChange: () => void }) {
  const t = useSession().t;
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const days = weekdays(lang);
  return (
    <div className="form">
      {items.length > 0 && (
        <div className="card flush list">
          {items.map((i) => (
            <button className="row as-button" key={i.id} onClick={() => setEditing(i)}>
              <span className="grow">
                <strong className="ellipsis">{i.item}{i.active ? "" : " · —"}</strong>
                <span className="muted small">
                  {formatINR(i.agreed_rate)}/{i.unit}
                  {i.usual_qty ? ` · ${i.usual_qty} ${i.unit}` : ""}
                  {i.delivery_days ? ` · ${i.delivery_days.split(",").map((d) => days[Number(d)]).join(" ")}` : ""}
                </span>
              </span>
              <Icon name="chevron" className="chev" />
            </button>
          ))}
        </div>
      )}
      {editing ? (
        <ItemForm vendorId={vendorId} item={editing === "new" ? undefined : editing} days={days} onDone={() => (setEditing(null), onChange())} />
      ) : (
        <button className="btn block" onClick={() => setEditing("new")}><Icon name="plus" /> {t("vendor.add_item")}</button>
      )}
    </div>
  );
}

function ItemForm({ vendorId, item, days, onDone }: { vendorId: number; item?: Item; days: string[]; onDone: () => void }) {
  const t = useSession().t;
  const [f, setF] = useState({
    item: item?.item ?? "",
    unit: item?.unit ?? "pcs",
    rate: item ? String(item.agreed_rate / 100) : "",
    usual: item?.usual_qty ? String(item.usual_qty) : "",
    days: new Set((item?.delivery_days ?? "").split(",").filter(Boolean)),
    active: item ? Boolean(item.active) : true,
  });
  const [error, setError] = useState<unknown>(null);
  const rate = rupeesToPaise(f.rate);
  async function save() {
    setError(null);
    try {
      const body = { item: f.item, unit: f.unit, agreed_rate: rate, usual_qty: f.usual || null, delivery_days: [...f.days].sort().join(","), active: f.active };
      if (item) await api(`/vendors/items/${item.id}`, { method: "PATCH", json: body });
      else await api(`/vendors/${vendorId}/items`, { method: "POST", json: body });
      onDone();
    } catch (e) {
      setError(e);
    }
  }
  const toggle = (d: string) => setF((x) => { const s = new Set(x.days); s.has(d) ? s.delete(d) : s.add(d); return { ...x, days: s }; });
  return (
    <div className="card form">
      <div className="grid-2">
        <Field label={t("vendor.item")} htmlFor="i-item"><input id="i-item" className="input" value={f.item} placeholder="Coke 300 ml" onChange={(e) => setF({ ...f, item: e.target.value })} /></Field>
        <Field label={t("vendor.unit")} htmlFor="i-unit"><input id="i-unit" className="input" value={f.unit} placeholder="pcs, kg, crate" onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
      </div>
      <div className="grid-2">
        <Field label={t("vendor.rate")} htmlFor="i-rate"><MoneyInput id="i-rate" value={f.rate} onChange={(v) => setF({ ...f, rate: v })} /></Field>
        <Field label={t("vendor.usual_qty")} htmlFor="i-usual"><input id="i-usual" className="input" inputMode="decimal" value={f.usual} onChange={(e) => setF({ ...f, usual: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
      </div>
      <Field label={t("vendor.days")}>
        <div className="att-pick">
          {days.map((label, i) => (
            <button key={i} type="button" className={f.days.has(String(i)) ? "att-present on" : ""} aria-pressed={f.days.has(String(i))} onClick={() => toggle(String(i))}>{label}</button>
          ))}
        </div>
      </Field>
      {item && <label className="checkbox"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span>{t("vendor.active")}</span></label>}
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="btn" onClick={onDone}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={!f.item.trim() || !rate} onClick={save}>{t("common.save")}</button>
      </div>
    </div>
  );
}

function History({ rows, showBalance, onChange }: { rows: HistoryRow[]; showBalance: boolean; onChange: () => void }) {
  const { t, user } = useSession();
  const [error, setError] = useState<unknown>(null);
  async function remove(r: HistoryRow) {
    if (!window.confirm(`${t("common.delete")}: ${formatINR(r.amount)}?`)) return;
    try {
      await api(`/vendors/${r.kind === "delivery" ? "deliveries" : "payments"}/${r.id}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      setError(e);
    }
  }
  if (rows.length === 0) return <Empty>{t("common.none_yet")}</Empty>;
  return (
    <>
      <ErrorNote error={error} />
      <div className="card flush list">
        {rows.map((r) => (
          <div className="row" key={`${r.kind}-${r.id}`}>
            <Icon name={r.kind === "delivery" ? "truck" : "wallet"} />
            <span className="grow">
              <strong className="ellipsis">
                {r.kind === "delivery" ? `${r.label} · ${r.qty} ${r.unit ?? ""}` : `${t("payment.paid")} · ${r.label === "online" ? t("common.online") : t("common.cash")}`}
              </strong>
              <span className="muted small ellipsis">
                {formatDay(r.business_date)}{r.by_name ? ` · ${r.by_name}` : ""}
                {r.kind === "delivery" && r.rate !== null ? ` · ${formatINR(r.rate)}/${r.unit ?? ""}` : ""}
                {r.note ? ` · ${r.note}` : ""}
              </span>
              {r.kind === "delivery" && r.agreed_rate !== null && r.rate !== r.agreed_rate && (
                <span><Pill tone="warn">{t("delivery.rate_differs", { rate: formatINR(r.rate!), agreed: formatINR(r.agreed_rate) })}</Pill></span>
              )}
            </span>
            <span style={{ display: "grid", justifyItems: "end" }}>
              <span className="amount">{r.kind === "payment" ? "− " : ""}{formatINR(r.amount)}</span>
              {showBalance && <span className="muted small num">{t("vendor.balance_after", { amount: formatINR(r.balance) })}</span>}
            </span>
            {user!.role === "owner" && <button className="btn small danger" aria-label={t("common.delete")} onClick={() => remove(r)}><Icon name="trash" /></button>}
          </div>
        ))}
      </div>
    </>
  );
}
