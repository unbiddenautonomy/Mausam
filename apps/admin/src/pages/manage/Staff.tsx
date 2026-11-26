import { useState } from "react";
import { businessDate, formatINR, rupeesToPaise } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Field, Loading, MoneyInput, PageHead, Pill, Segmented } from "../../components/ui";
import { ImportStaff } from "./ImportStaff";

type PayType = "monthly" | "daily" | "shift" | "";
interface S {
  id: number;
  name: string;
  name_local: string | null;
  role: string;
  phone: string | null;
  pay_type: PayType | null;
  pay_rate: number | null;
  joined_on: string | null;
  active: boolean;
  left_on?: string | null;
  is_waiter?: number;
  waiter_code?: string | null;
}

export function StaffPage() {
  const t = useSession().t;
  const res = useApi<{ staff: S[] }>("/staff");
  const [editing, setEditing] = useState<S | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const active = res.data?.staff.filter((s) => s.active).length ?? 0;
  return (
    <div className="page">
      <PageHead
        title={t("manage.staff")}
        subtitle={res.data ? t("staff.count", { n: active }) : undefined}
        back="/manage"
        action={!editing && !importing ? (
          <span className="btn-row" style={{ margin: 0 }}>
            <button className="btn small" disabled={!res.data} onClick={() => setImporting(true)}>{t("staff.import")}</button>
            <button className="btn small primary" onClick={() => setEditing("new")}><Icon name="plus" /> {t("staff.add")}</button>
          </span>
        ) : undefined}
      />
      {importing && res.data && <ImportStaff staff={res.data.staff} onDone={() => (setImporting(false), res.reload())} />}
      {editing && <StaffForm initial={editing === "new" ? null : editing} onDone={() => (setEditing(null), res.reload())} />}
      {!res.data ? <Loading /> : (
        <div className="card flush list">
          {res.data.staff.map((s) => (
            <button key={s.id} className="row row-link" style={{ border: 0, background: "none", textAlign: "left", width: "100%", cursor: "pointer", opacity: s.active ? 1 : 0.5, borderTop: "1px solid var(--border)" }} onClick={() => setEditing(s)}>
              <span className="grow">
                <strong>{s.name}{s.name_local ? <span className="muted"> · {s.name_local}</span> : null}</strong>
                <span className="muted small">{s.role || "—"}{s.is_waiter ? ` · ${t("manage.waiters")}${s.waiter_code ? ` #${s.waiter_code}` : ""}` : ""}</span>
              </span>
              {s.pay_rate ? (
                <span className="amount small">{formatINR(s.pay_rate)} <span className="faint">/ {t(`pay.${s.pay_type || "monthly"}` as "pay.monthly")}</span></span>
              ) : (
                <Pill>{t("staff.pay_unknown")}</Pill>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StaffForm({ initial, onDone }: { initial: S | null; onDone: () => void }) {
  const t = useSession().t;
  const [f, setF] = useState({
    name: initial?.name ?? "",
    name_local: initial?.name_local ?? "",
    role: initial?.role ?? "",
    phone: initial?.phone ?? "",
    pay_type: (initial?.pay_type ?? "monthly") as PayType,
    pay_rate: initial?.pay_rate ? String(initial.pay_rate / 100) : "",
    joined_on: initial?.joined_on ?? "",
    active: initial?.active ?? true,
    left_on: initial?.left_on ?? "",
  });
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    const body = { ...f, pay_rate: rupeesToPaise(f.pay_rate), pay_type: f.pay_rate ? f.pay_type : null, left_on: f.active ? null : f.left_on || null };
    try {
      if (initial) await api(`/staff/${initial.id}`, { method: "PUT", json: body });
      else await api("/staff", { method: "POST", json: body });
      onDone();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="card form">
      <h2>{initial ? initial.name : t("staff.add")}</h2>
      <div className="grid-2">
        <Field label={t("staff.name")} htmlFor="s-name"><input id="s-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={`${t("staff.name_local")} (${t("common.optional")})`} htmlFor="s-local"><input id="s-local" className="input" value={f.name_local} onChange={(e) => set("name_local", e.target.value)} placeholder="रोहित / ರೋಹಿತ್" /></Field>
        <Field label={t("staff.role")} htmlFor="s-role"><input id="s-role" className="input" value={f.role} onChange={(e) => set("role", e.target.value)} placeholder="Waiter, Cook, Helper…" /></Field>
        <Field label={`${t("staff.phone")} (${t("common.optional")})`} htmlFor="s-phone"><input id="s-phone" className="input num" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
      </div>
      <div className="field">
        <span className="label">{t("staff.pay_type")}</span>
        <Segmented<PayType> value={f.pay_type} onChange={(v) => set("pay_type", v)} options={[{ value: "monthly", label: t("pay.monthly") }, { value: "daily", label: t("pay.daily") }, { value: "shift", label: t("pay.shift") }]} />
      </div>
      <div className="grid-2">
        <Field label={`${t("staff.pay_rate")} (${t("common.optional")})`} help={t("staff.pay_unknown")} htmlFor="s-rate"><MoneyInput id="s-rate" value={f.pay_rate} onChange={(v) => set("pay_rate", v)} /></Field>
        <Field label={`${t("staff.joined")} (${t("common.optional")})`} htmlFor="s-joined"><input id="s-joined" type="date" className="input" value={f.joined_on} onChange={(e) => set("joined_on", e.target.value)} /></Field>
      </div>
      {initial && (
        <label className="check" style={{ cursor: "pointer", background: "var(--surface-2)" }}>
          <input type="checkbox" checked={f.active}
            onChange={(e) => setF((x) => ({ ...x, active: e.target.checked, left_on: e.target.checked ? "" : x.left_on || businessDate() }))}
            style={{ width: 22, height: 22 }} />
          <span className="t">{t("staff.active")}</span>
        </label>
      )}
      {initial && !f.active && (
        <Field label={t("staff.left_on")} help={t("staff.left_on_help")} htmlFor="s-left">
          <input id="s-left" type="date" className="input" value={f.left_on} onChange={(e) => set("left_on", e.target.value)} />
        </Field>
      )}
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="btn" onClick={onDone}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={!f.name.trim()} onClick={save}>{t("common.save")}</button>
      </div>
    </div>
  );
}
