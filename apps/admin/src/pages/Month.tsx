import { useEffect, useState } from "react";
import { Link } from "react-router";
import { businessDate, formatDay, formatINR, monthCloseFor, monthDates, rupeesToPaise } from "@mausam/shared";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { catName } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorNote, Field, Loading, MoneyInput, PageHead, PhotoInput, Segmented, Stat, useToast } from "../components/ui";

interface Totals { sales: number; days_with_sales: number; expenses: number; food: number; bills: number; deliveries: number; wages: number; left: number }
interface Bill { id: number; business_date: string; amount: number; mode: string; note: string | null; category_key: string; category_name: string; category_name_hi: string | null; category_name_kn: string | null }
interface BillCat { id: number; key: string; name_en: string; name_hi: string | null; name_kn: string | null }
interface MonthData {
  month: string;
  close: { status: "open" | "closed"; tally_photo_key?: string | null; tally_sales?: number | null; tally_expenses?: number | null; tally_wages?: number | null; note?: string | null; closed_at?: string | null };
  checklist: { days_due: number; days_closed: number; missing: string[]; staff_with_pay: number; payroll_paid: number; vendor_due: number; vendors_owed: { id: number; name: string; due: number }[] };
  bills: Bill[];
  bill_categories: BillCat[];
  totals: Totals;
  frozen: boolean;
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const toRupees = (p: number | null | undefined) => (p === null || p === undefined ? "" : String(p / 100));

export function MonthClose() {
  const { t } = useSession();
  const today = businessDate();
  const [m, setM] = useState(monthCloseFor(today) ?? today.slice(0, 7));
  const res = useApi<MonthData>(`/month/${m}`);
  const [error, setError] = useState<unknown>(null);
  const d = res.data;
  const closed = d?.close.status === "closed";

  async function act(path: "close" | "reopen") {
    if (path === "close" && !window.confirm(t("month.close_confirm"))) return;
    setError(null);
    try {
      await api(`/month/${m}/${path}`, { method: "POST" });
      res.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="page month-page">
      <PageHead
        title={t("month.title")}
        subtitle={new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
        action={
          <div className="btn-row no-print">
            <input type="month" className="input" style={{ width: "auto" }} value={m} onChange={(e) => e.target.value && setM(e.target.value)} aria-label={t("pay.month")} />
            <button className="btn small" onClick={() => window.print()}><Icon name="print" /> {t("month.print")}</button>
          </div>
        }
      />
      {res.error ? <ErrorNote error={res.error} /> : !d ? <Loading /> : (
        <>
          {closed && (
            <div className="check good">
              <Icon name="lock" />
              <span className="t" style={{ flex: 1 }}>{t("month.closed")}</span>
              <button className="btn small no-print" onClick={() => act("reopen")}>{t("month.reopen")}</button>
            </div>
          )}
          <div className="cols">
            <div className="form">
              <Summary totals={d.totals} />
              <Checklist d={d} />
            </div>
            <div className="form">
              <Bills d={d} month={m} closed={closed} onChange={res.reload} />
              <Tally d={d} month={m} closed={closed} onSaved={res.reload} />
            </div>
          </div>
          <ErrorNote error={error} />
          {!closed && (
            <button className="btn primary block no-print" onClick={() => act("close")}>
              <Icon name="lock" /> {t("month.close")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Summary({ totals: s }: { totals: Totals }) {
  const t = useSession().t;
  const rows: [string, number, string?][] = [
    [t("month.expenses"), s.expenses],
    [t("month.deliveries"), s.deliveries],
    [t("month.wages"), s.wages, pct(s.wages, s.sales)],
    [t("month.bills_total"), s.bills],
  ];
  return (
    <section className="card form">
      <h2>{t("month.summary")}</h2>
      <div className="stats">
        <Stat hero label={t("month.sales")} value={formatINR(s.sales)} delta={t("month.days_sales", { n: s.days_with_sales })} />
        <Stat hero label={t("month.left")} value={<span className={s.left < 0 ? "bad-text" : ""}>{formatINR(s.left)}</span>} delta={pct(s.left, s.sales)} />
      </div>
      <div className="list">
        {rows.map(([label, v, extra]) => (
          <div className="row" key={label}>
            <span className="grow">{label}{extra ? <span className="muted small"> · {extra}</span> : null}</span>
            <span className="amount">{formatINR(v)}</span>
          </div>
        ))}
        <div className="row">
          <span className="grow">{t("reports.food_pct")}<span className="muted small"> · {t("reports.food_note")}</span></span>
          <span className="amount">{pct(s.food, s.sales)}</span>
        </div>
      </div>
    </section>
  );
}

function Checklist({ d }: { d: MonthData }) {
  const t = useSession().t;
  const c = d.checklist;
  const daysOk = c.days_closed === c.days_due;
  const payOk = c.staff_with_pay === 0 || c.payroll_paid >= c.staff_with_pay;
  return (
    <section className="card form">
      <h2>{t("month.checklist")}</h2>
      <div className={`check ${daysOk ? "good" : "warn"}`}>
        <Icon name={daysOk ? "check" : "alert"} />
        <span className="t">{t("month.days_closed", { n: c.days_closed, total: c.days_due })}</span>
      </div>
      {c.missing.length > 0 && (
        <div className="chips">
          {c.missing.map((date) => (
            <Link key={date} className="pill" to={`/entries/close/${date}`}>{formatDay(date)}</Link>
          ))}
        </div>
      )}
      <Link to="/people/pay" className={`check ${payOk ? "good" : "warn"}`}>
        <Icon name={payOk ? "check" : "alert"} />
        <span className="t">{t("month.payroll", { n: c.payroll_paid, total: c.staff_with_pay })}</span>
      </Link>
      <Link to="/vendors" className={`check ${c.vendor_due > 0 ? "warn" : "good"}`}>
        <Icon name={c.vendor_due > 0 ? "alert" : "check"} />
        <span className="t">{t("month.vendor_dues", { amount: formatINR(c.vendor_due) })}</span>
      </Link>
    </section>
  );
}

function Bills({ d, month, closed, onChange }: { d: MonthData; month: string; closed: boolean; onChange: () => void }) {
  const { t, lang } = useSession();
  const toast = useToast();
  const lastDay = monthDates(month).at(-1)!;
  const defaultDate = [lastDay, businessDate()].sort()[0];
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ category_id: "", amount: "", date: defaultDate, mode: "online" as "cash" | "online", photo: null as string | null, note: "" });
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setF((x) => ({ ...x, date: defaultDate })), [defaultDate]);
  const amount = rupeesToPaise(f.amount);
  const total = d.bills.reduce((s, b) => s + b.amount, 0);

  async function save() {
    if (!amount || !f.category_id) return;
    setError(null);
    try {
      await api("/expenses", { method: "POST", json: { category_id: Number(f.category_id), amount, business_date: f.date, mode: f.mode, photo_key: f.photo, note: f.note, has_receipt: Boolean(f.photo) } });
      toast(t("common.saved"));
      setAdding(false);
      setF({ ...f, category_id: "", amount: "", photo: null, note: "" });
      onChange();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className="card form">
      <div className="section-head">
        <h2>{t("month.bills")}</h2>
        <span className="amount">{formatINR(total)}</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t("month.bills_desc")}</p>
      {d.bills.length > 0 && (
        <div className="list">
          {d.bills.map((b) => (
            <div className="row" key={b.id}>
              <span className="grow">
                <strong>{catName(b, lang)}</strong>
                <span className="muted small">{formatDay(b.business_date)}{b.note ? ` · ${b.note}` : ""}</span>
              </span>
              <span className="amount">{formatINR(b.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {!closed && !d.frozen && (adding ? (
        <div className="form">
          <Field label={t("expense.category")} htmlFor="b-cat">
            <select id="b-cat" className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">—</option>
              {d.bill_categories.map((c) => <option key={c.id} value={c.id}>{catName(c, lang)}</option>)}
            </select>
          </Field>
          <div className="grid-2">
            <Field label={t("common.amount")} htmlFor="b-amount"><MoneyInput id="b-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
            <Field label={t("common.date")} htmlFor="b-date">
              <input id="b-date" type="date" className="input" value={f.date} min={`${month}-01`} max={lastDay} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </Field>
          </div>
          <Segmented<"cash" | "online"> value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: "online", label: t("common.online") }, { value: "cash", label: t("month.bill_cash") }]} />
          <PhotoInput label={t("common.photo")} kind="bill" value={f.photo} onChange={(k) => setF({ ...f, photo: k })} />
          <ErrorNote error={error} />
          <div className="btn-row">
            <button className="btn" onClick={() => setAdding(false)}>{t("common.cancel")}</button>
            <button className="btn primary" disabled={!amount || !f.category_id} onClick={save}>{t("common.save")}</button>
          </div>
        </div>
      ) : (
        <button className="btn block no-print" onClick={() => setAdding(true)}><Icon name="plus" /> {t("month.add_bill")}</button>
      ))}
    </section>
  );
}

function Tally({ d, month, closed, onSaved }: { d: MonthData; month: string; closed: boolean; onSaved: () => void }) {
  const t = useSession().t;
  const toast = useToast();
  const c = d.close;
  const [f, setF] = useState({ photo: c.tally_photo_key ?? null, sales: toRupees(c.tally_sales), expenses: toRupees(c.tally_expenses), wages: toRupees(c.tally_wages), note: c.note ?? "" });
  useEffect(() => {
    setF({ photo: c.tally_photo_key ?? null, sales: toRupees(c.tally_sales), expenses: toRupees(c.tally_expenses), wages: toRupees(c.tally_wages), note: c.note ?? "" });
  }, [c.tally_photo_key, c.tally_sales, c.tally_expenses, c.tally_wages, c.note]);
  const [error, setError] = useState<unknown>(null);
  const s = d.totals;
  const rows: [string, number | null, number][] = [
    [t("month.tally_sales"), rupeesToPaise(f.sales), s.sales],
    [t("month.tally_expenses"), rupeesToPaise(f.expenses), s.expenses + s.deliveries + s.bills],
    [t("month.tally_wages"), rupeesToPaise(f.wages), s.wages],
  ];
  async function save() {
    setError(null);
    try {
      await api(`/month/${month}`, { method: "PUT", json: { tally_photo_key: f.photo, tally_sales: rupeesToPaise(f.sales), tally_expenses: rupeesToPaise(f.expenses), tally_wages: rupeesToPaise(f.wages), note: f.note } });
      toast(t("common.saved"));
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className="card form">
      <h2>{t("month.tally")}</h2>
      {!closed && <PhotoInput label={t("month.tally_photo")} kind="tally" value={f.photo} onChange={(k) => setF({ ...f, photo: k })} />}
      {!closed && (
        <div className="grid-3">
          <Field label={t("month.tally_sales")} htmlFor="t-s"><MoneyInput id="t-s" value={f.sales} onChange={(v) => setF({ ...f, sales: v })} /></Field>
          <Field label={t("month.tally_expenses")} htmlFor="t-e"><MoneyInput id="t-e" value={f.expenses} onChange={(v) => setF({ ...f, expenses: v })} /></Field>
          <Field label={t("month.tally_wages")} htmlFor="t-w"><MoneyInput id="t-w" value={f.wages} onChange={(v) => setF({ ...f, wages: v })} /></Field>
        </div>
      )}
      <table className="table">
        <thead>
          <tr><th></th><th>{t("month.tally")}</th><th>{t("month.app_total")}</th><th>{t("month.diff")}</th></tr>
        </thead>
        <tbody>
          {rows.map(([label, tally, app]) => {
            const diff = tally === null ? null : tally - app;
            return (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{tally === null ? "—" : formatINR(tally)}</td>
                <td>{formatINR(app)}</td>
                <td className={diff && Math.abs(diff) > 100000 ? "bad-text" : ""}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${formatINR(diff)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!closed && (
        <>
          <Field label={t("common.note_optional")} htmlFor="t-note"><textarea id="t-note" className="textarea" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <ErrorNote error={error} />
          <button className="btn block no-print" onClick={save}>{t("common.save")}</button>
        </>
      )}
      {closed && c.note && <p className="muted">{c.note}</p>}
    </section>
  );
}
