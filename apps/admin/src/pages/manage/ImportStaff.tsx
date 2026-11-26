import { useState } from "react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { buildRows, type ImportRow } from "../../lib/staffImport";
import { ErrorNote, Field } from "../../components/ui";

interface Person {
  id: number;
  name: string;
  name_local: string | null;
  role: string;
  phone: string | null;
  pay_type: string | null;
  pay_rate: number | null;
  joined_on: string | null;
  active: boolean;
  left_on?: string | null;
  is_waiter?: number;
}

/**
 * Owner: paste a staff list with salaries (and optionally the waiter list), check how each name was read and who it
 * matches on Staff, then save. The names and salaries go only to this restaurant's database.
 */
export function ImportStaff({ staff, onDone }: { staff: Person[]; onDone: () => void }) {
  const t = useSession().t;
  const [salaryText, setSalaryText] = useState("");
  const [waiterText, setWaiterText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [unwaiter, setUnwaiter] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const active = staff.filter((s) => s.active);
  const setRow = (i: number, patch: Partial<ImportRow>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const waiterListGiven = waiterText.trim().length > 0;
  const keptWaiters = new Set((rows ?? []).filter((r) => r.waiter && r.match !== null).map((r) => r.match));
  const dropWaiters = waiterListGiven ? active.filter((s) => s.is_waiter && !keptWaiters.has(s.id)) : [];

  async function save() {
    if (!rows) return;
    setError(null);
    setProgress(0);
    try {
      for (const [i, r] of rows.entries()) {
        const salary = r.salary ? { pay_type: "monthly", pay_rate: r.salary * 100 } : {};
        let id = r.match;
        const before = id === null ? null : staff.find((s) => s.id === id)!;
        if (before) {
          await api(`/staff/${before.id}`, { method: "PUT", json: { ...before, role: before.role || r.role, ...salary } });
        } else {
          id = (await api<{ id: number }>("/staff", { method: "POST", json: { name: r.name.trim(), role: r.role, ...salary } })).id;
        }
        if (r.waiter && !before?.is_waiter) await api(`/billing/waiters/${id}`, { method: "PATCH", json: { is_waiter: 1 } });
        setProgress(i + 1);
      }
      if (unwaiter) for (const s of dropWaiters) await api(`/billing/waiters/${s.id}`, { method: "PATCH", json: { is_waiter: 0 } });
      onDone();
    } catch (e) {
      setError(e);
      setProgress(null);
    }
  }

  if (!rows) {
    const preview = () => setRows(buildRows(salaryText, waiterText, active));
    return (
      <div className="card form">
        <h2>{t("staff.import_title")}</h2>
        <Field label={t("staff.import_salaries")} help={t("staff.import_salaries_help")} htmlFor="imp-sal">
          <textarea id="imp-sal" className="input" rows={6} value={salaryText} onChange={(e) => setSalaryText(e.target.value)} />
        </Field>
        <Field label={t("staff.import_waiters")} help={t("staff.import_waiters_help")} htmlFor="imp-w">
          <textarea id="imp-w" className="input" rows={5} value={waiterText} onChange={(e) => setWaiterText(e.target.value)} />
        </Field>
        <div className="btn-row">
          <button className="btn" onClick={onDone}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={!salaryText.trim() && !waiterListGiven} onClick={preview}>{t("staff.import_check")}</button>
        </div>
      </div>
    );
  }

  const busy = progress !== null;
  return (
    <div className="card form">
      <h2>{t("staff.import_title")}</h2>
      {rows.length === 0 && <p className="muted">{t("staff.import_none")}</p>}
      <div className="list import-rows">
        {rows.map((r, i) => (
          <div key={i} className="import-row">
            <input className="input" aria-label={t("staff.name")} value={r.name} disabled={busy || r.match !== null} onChange={(e) => setRow(i, { name: e.target.value })} />
            <input className="input num" aria-label={t("staff.pay_rate")} inputMode="numeric" value={r.salary ?? ""} disabled={busy}
              onChange={(e) => setRow(i, { salary: Number(e.target.value.replace(/\D/g, "")) || null })} />
            <select className="input" aria-label={t("manage.staff")} value={r.match ?? ""} disabled={busy}
              onChange={(e) => setRow(i, { match: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t("staff.import_new")}</option>
              {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={r.waiter} disabled={busy} onChange={(e) => setRow(i, { waiter: e.target.checked })} />
              {t("manage.waiters")}
            </label>
            {r.role && r.role !== "Waiter" && <span className="small muted">{r.role}</span>}
          </div>
        ))}
      </div>
      {dropWaiters.length > 0 && (
        <label className="check" style={{ cursor: "pointer", background: "var(--surface-2)" }}>
          <input type="checkbox" checked={unwaiter} disabled={busy} onChange={(e) => setUnwaiter(e.target.checked)} style={{ width: 22, height: 22 }} />
          <span className="t">{t("staff.import_unwaiter", { names: dropWaiters.map((s) => s.name).join(", ") })}</span>
        </label>
      )}
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => setRows(null)}>{t("common.back")}</button>
        <button className="btn primary" disabled={busy || rows.length === 0 || rows.some((r) => !r.name.trim())} onClick={save}>
          {busy ? t("staff.import_saving", { done: progress, n: rows.length }) : t("staff.import_save", { n: rows.length })}
        </button>
      </div>
    </div>
  );
}
