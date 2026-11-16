import { useEffect, useMemo, useState } from "react";
import { businessDate, formatDay, formatINR, rupeesToPaise, type AttendanceStatus } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { Empty, ErrorNote, Field, Loading, MoneyInput, NavCard, PageHead, Pill, Stat, useToast } from "../../components/ui";

export function PeopleHub() {
  const { t, user } = useSession();
  return (
    <div className="page">
      <PageHead title={t("people.title")} />
      <div className="grid-2">
        <NavCard to="/people/attendance" icon="checklist" title={t("people.attendance")} desc={t("people.attendance_desc")} />
        <NavCard to="/people/advances" icon="wallet" title={t("people.advances")} desc={t("people.advances_desc")} />
        {user!.role === "owner" && <NavCard to="/people/pay" icon="users" title={t("people.payroll")} desc={t("people.payroll_desc")} />}
      </div>
    </div>
  );
}

/* ---------- Attendance ---------- */

interface AttRow { id: number; name: string; name_local: string | null; role: string; status: AttendanceStatus | null }
const STATUSES: AttendanceStatus[] = ["present", "half", "absent", "leave", "off"];

export function Attendance() {
  const { t } = useSession();
  const toast = useToast();
  const [date, setDate] = useState(businessDate());
  const res = useApi<{ staff: AttRow[] }>(`/people/attendance/${date}`);
  const [marks, setMarks] = useState<Record<number, AttendanceStatus | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (res.data) setMarks(Object.fromEntries(res.data.staff.map((s) => [s.id, s.status])));
  }, [res.data]);

  const staff = res.data?.staff ?? [];
  const dirty = staff.some((s) => (marks[s.id] ?? null) !== s.status);
  const count = (st: AttendanceStatus | null) => staff.filter((s) => (marks[s.id] ?? null) === st).length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const changed = staff.filter((s) => (marks[s.id] ?? null) !== s.status).map((s) => ({ staff_id: s.id, status: marks[s.id] ?? null }));
      await api(`/people/attendance/${date}`, { method: "PUT", json: { marks: changed } });
      toast(t("att.saved"));
      res.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead title={t("people.attendance")} subtitle={formatDay(date)} back="/people" />
      <Field label={t("common.date")} htmlFor="att-date">
        <input id="att-date" type="date" className="input" value={date} max={businessDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </Field>
      {res.error ? <ErrorNote error={res.error} /> : !res.data ? <Loading /> : staff.length === 0 ? (
        <Empty>{t("att.no_staff")}</Empty>
      ) : (
        <>
          <div className="section-head">
            <span className="muted small">
              {t("att.summary", { present: count("present") + count("half"), absent: count("absent") + count("leave"), unmarked: count(null) })}
            </span>
            {count(null) > 0 && (
              <button className="btn small" onClick={() => setMarks((m) => Object.fromEntries(staff.map((s) => [s.id, m[s.id] ?? "present"])))}>
                {t("att.mark_all")}
              </button>
            )}
          </div>
          <div className="card flush list">
            {staff.map((s) => (
              <div className="row att-row" key={s.id}>
                <span className="grow">
                  <strong className="ellipsis">{s.name}</strong>
                  <span className="muted small ellipsis">{[s.name_local, s.role].filter(Boolean).join(" · ")}</span>
                </span>
                <div className="att-pick" role="radiogroup" aria-label={s.name}>
                  {STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="radio"
                      aria-checked={marks[s.id] === st}
                      className={`att-${st}${marks[s.id] === st ? " on" : ""}`}
                      onClick={() => setMarks((m) => ({ ...m, [s.id]: m[s.id] === st ? null : st }))}
                    >
                      {t(`att.${st}` as const)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <ErrorNote error={error} />
          <div className="sticky-actions">
            <button className="btn primary block" disabled={!dirty || busy} onClick={save}>
              <Icon name="check" /> {t("common.save")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Advances ---------- */

interface Advance { id: number; staff_id: number; staff_name: string; business_date: string; amount: number; mode: string; from_counter: number; note: string | null; given_by_name: string }

export function Advances() {
  const { t } = useSession();
  const toast = useToast();
  const [month, setMonth] = useState(businessDate().slice(0, 7));
  const list = useApi<{ advances: Advance[] }>(`/people/advances?month=${month}`);
  const staff = useApi<{ staff: AttRow[] }>(`/people/attendance/${businessDate()}`);
  const [f, setF] = useState({ staff_id: "", amount: "", fromCounter: true, note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const amount = rupeesToPaise(f.amount);

  const byStaff = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of list.data?.advances ?? []) m.set(a.staff_name, (m.get(a.staff_name) ?? 0) + a.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list.data]);
  const total = byStaff.reduce((s, [, v]) => s + v, 0);

  async function give() {
    if (!f.staff_id || !amount) return;
    setBusy(true);
    setError(null);
    try {
      await api("/people/advances", { method: "POST", json: { staff_id: Number(f.staff_id), amount, from_counter: f.fromCounter, note: f.note } });
      toast(t("common.saved"));
      setF({ staff_id: "", amount: "", fromCounter: true, note: "" });
      list.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(a: Advance) {
    if (!window.confirm(`${t("common.delete")}: ${a.staff_name} · ${formatINR(a.amount)}?`)) return;
    try {
      await api(`/people/advances/${a.id}`, { method: "DELETE" });
      list.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="page">
      <PageHead title={t("people.advances")} back="/people" />
      <div className="cols">
        <div className="card form">
          <h2>{t("adv.add")}</h2>
          <Field label={t("adv.staff")} htmlFor="adv-staff">
            <select id="adv-staff" className="select" value={f.staff_id} onChange={(e) => setF({ ...f, staff_id: e.target.value })}>
              <option value="">—</option>
              {(staff.data?.staff ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t("common.amount")} htmlFor="adv-amount">
            <MoneyInput id="adv-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={f.fromCounter} onChange={(e) => setF({ ...f, fromCounter: e.target.checked })} />
            <span>{t("adv.from_counter")}</span>
          </label>
          <Field label={t("common.note_optional")} htmlFor="adv-note">
            <input id="adv-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <ErrorNote error={error} />
          <button className="btn primary block" disabled={!f.staff_id || !amount || busy} onClick={give}>
            <Icon name="check" /> {t("adv.add")}
          </button>
        </div>
        <div className="form">
          <div className="section-head">
            <h2>{t("adv.month_total")}</h2>
            <input type="month" className="input" style={{ width: "auto" }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("pay.month")} />
          </div>
          {list.error ? <ErrorNote error={list.error} /> : !list.data ? <Loading /> : list.data.advances.length === 0 ? (
            <Empty>{t("adv.empty")}</Empty>
          ) : (
            <>
              <div className="card flush list">
                {byStaff.map(([name, v]) => (
                  <div className="row" key={name}>
                    <span className="grow"><strong>{name}</strong></span>
                    <span className="amount">{formatINR(v)}</span>
                  </div>
                ))}
                <div className="row">
                  <span className="grow muted">{t("common.total")}</span>
                  <span className="amount">{formatINR(total)}</span>
                </div>
              </div>
              <div className="card flush list">
                {list.data.advances.map((a) => (
                  <div className="row" key={a.id}>
                    <span className="grow">
                      <strong className="ellipsis">{a.staff_name}</strong>
                      <span className="muted small ellipsis">
                        {formatDay(a.business_date)} · {a.given_by_name}{a.from_counter ? ` · ${t("common.cash")}` : ""}{a.note ? ` · ${a.note}` : ""}
                      </span>
                    </span>
                    <span className="amount">{formatINR(a.amount)}</span>
                    <button className="btn small danger" aria-label={t("common.delete")} onClick={() => remove(a)}><Icon name="trash" /></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Month-end pay (owner) ---------- */

interface PayRow {
  staff_id: number; name: string; role: string; pay_type: string | null; rate: number | null;
  days_worked: number; days_absent: number; days_unmarked: number; gross: number; advances: number; adjustment: number; net: number; commission?: number;
  status: "draft" | "paid"; paid_on: string | null; partial: boolean;
}

export function Payroll() {
  const { t } = useSession();
  const [month, setMonth] = useState(businessDate().slice(0, 7));
  const res = useApi<{ rows: PayRow[]; totals: { gross: number; advances: number; net: number; commission?: number } }>(`/people/payroll/${month}`);
  const [error, setError] = useState<unknown>(null);
  const partial = res.data?.rows.some((r) => r.partial);

  async function update(r: PayRow, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/people/payroll/${month}/${r.staff_id}`, { method: "PUT", json: body });
      res.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="page">
      <PageHead
        title={t("people.payroll")}
        back="/people"
        action={<input type="month" className="input" style={{ width: "auto" }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("pay.month")} />}
      />
      <p className="muted small" style={{ margin: 0 }}>{t("pay.rule")}</p>
      {partial && <div className="check warn"><Icon name="clock" /><span className="t">{t("pay.partial")}</span></div>}
      <ErrorNote error={error} />
      {res.error ? <ErrorNote error={res.error} /> : !res.data ? <Loading /> : res.data.rows.length === 0 ? (
        <Empty>{t("att.no_staff")}</Empty>
      ) : (
        <>
          <div className="stats">
            <Stat hero label={t("pay.total")} value={formatINR(res.data.totals.net)} />
            <Stat label={t("pay.gross")} value={formatINR(res.data.totals.gross)} />
            {(res.data.totals.commission ?? 0) > 0 && <Stat label={t("pay.commission")} value={formatINR(res.data.totals.commission!)} />}
            <Stat label={t("pay.advances")} value={formatINR(res.data.totals.advances)} />
          </div>
          <div className="pay-list">
            {res.data.rows.map((r) => (
              <PayCard key={r.staff_id} r={r} onSave={(body) => update(r, body)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PayCard({ r, onSave }: { r: PayRow; onSave: (body: Record<string, unknown>) => void }) {
  const { t } = useSession();
  const [adj, setAdj] = useState(r.adjustment ? String(r.adjustment / 100) : "");
  useEffect(() => setAdj(r.adjustment ? String(r.adjustment / 100) : ""), [r.adjustment]);
  const paid = r.status === "paid";
  const adjPaise = adj.trim() === "" ? 0 : Math.round(Number(adj.replace(/,/g, "")) * 100);
  const commission = r.commission ?? 0;
  // A waiter with no fixed pay still has their commission to pay out.
  const hasPay = !!r.rate || commission > 0;
  return (
    <div className={`card pay-card${paid ? " paid" : ""}`}>
      <div className="section-head">
        <span>
          <strong>{r.name}</strong> <span className="muted small">{r.role}</span>
        </span>
        {paid ? <Pill tone="good" icon="check">{t("pay.paid")}</Pill> : <Pill>{t("pay.draft")}</Pill>}
      </div>
      {!hasPay ? (
        <p className="muted small" style={{ margin: 0 }}>{t("pay.no_rate")}</p>
      ) : (
        <dl className="pay-grid">
          <dt>{t("pay.days_worked")}</dt><dd>{r.days_worked}</dd>
          <dt>{t("att.absent")}</dt><dd>{r.days_absent}</dd>
          {r.days_unmarked > 0 && (<><dt>{t("att.unmarked")}</dt><dd>{r.days_unmarked}</dd></>)}
          <dt>{t("pay.gross")}</dt><dd>{r.rate ? formatINR(r.gross) : "—"}</dd>
          {commission > 0 && (<><dt>{t("pay.commission")}</dt><dd>+ {formatINR(commission)}</dd></>)}
          <dt>{t("pay.advances")}</dt><dd>− {formatINR(r.advances)}</dd>
          {paid ? (r.adjustment !== 0 && (<><dt>{t("pay.adjust")}</dt><dd>{formatINR(r.adjustment)}</dd></>)) : null}
          <dt><strong>{t("pay.net")}</strong></dt><dd><strong>{formatINR(r.net)}</strong></dd>
        </dl>
      )}
      {!paid && hasPay ? (
        <div className="pay-actions">
          <input
            className="input"
            inputMode="decimal"
            placeholder={t("pay.adjust")}
            aria-label={t("pay.adjust")}
            value={adj}
            onChange={(e) => setAdj(e.target.value.replace(/[^\d.,-]/g, ""))}
            onBlur={() => Number.isFinite(adjPaise) && adjPaise !== r.adjustment && onSave({ adjustment: adjPaise })}
          />
          <button className="btn primary" onClick={() => onSave({ status: "paid", adjustment: Number.isFinite(adjPaise) ? adjPaise : 0 })}>{t("pay.mark_paid")}</button>
        </div>
      ) : paid ? (
        <button className="btn small" onClick={() => onSave({ status: "draft" })}>{t("pay.undo")}{r.paid_on ? ` · ${formatDay(r.paid_on)}` : ""}</button>
      ) : null}
    </div>
  );
}
