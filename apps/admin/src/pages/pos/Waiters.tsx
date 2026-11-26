import { useState } from "react";
import { percentToBp } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { Empty, ErrorNote, Field, Loading, PageHead, Pill, useToast } from "../../components/ui";
import type { PosSettings } from "./Menu";

interface StaffW { id: number; name: string; name_local: string | null; role: string; is_waiter: number; waiter_code: string | null; commission_bp: number | null; active: number }

const pct = (bp: number | null | undefined) => (bp === null || bp === undefined ? "" : String(bp / 100));

/** Owner: waiters, the ID the POS shows for each, and their commission. A waiter is a staff member, so pay and attendance work as usual. */
export function WaitersPage() {
  const { t, user } = useSession();
  const owner = user?.role === "owner";
  const toast = useToast();
  const res = useApi<{ staff: StaffW[]; settings: PosSettings }>("/billing/waiters");
  const [editing, setEditing] = useState<StaffW | "new" | null>(null);
  const [defPct, setDefPct] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!res.data) return res.error ? <ErrorNote error={res.error} /> : <Loading />;
  const waiters = res.data.staff.filter((s) => s.is_waiter && s.active);
  const others = res.data.staff.filter((s) => !s.is_waiter && s.active);
  const defaultBp = res.data.settings.commission_bp;
  const def = defPct ?? pct(defaultBp);

  async function saveDefault() {
    setError(null);
    const bp = percentToBp(def) ?? 0;
    try {
      await api("/billing/settings", { method: "PUT", json: { commission_bp: bp } });
      setDefPct(null);
      toast(t("common.saved"));
      res.reload();
    } catch (e) {
      setError(e);
    }
  }
  async function makeWaiter(id: number) {
    setError(null);
    try {
      await api(`/billing/waiters/${id}`, { method: "PATCH", json: { is_waiter: true } });
      res.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="page">
      <PageHead
        title={t("manage.waiters")}
        subtitle={t("waiters.count", { n: waiters.length })}
        back={user?.role === "owner" ? "/manage" : "/more"}
        action={!editing ? <button className="btn small primary" onClick={() => setEditing("new")}><Icon name="plus" /> {t("waiters.add")}</button> : undefined}
      />
      {editing && <WaiterForm owner={owner} initial={editing === "new" ? null : editing} defaultBp={defaultBp} onDone={() => (setEditing(null), res.reload())} />}
      {waiters.length === 0 ? <Empty>{t("waiters.none")}</Empty> : (
        <div className="card flush list">
          {waiters.map((w) => (
            <button key={w.id} className="row row-link as-button" onClick={() => setEditing(w)}>
              <span className="pill" style={{ minWidth: 44, textAlign: "center", fontWeight: 800 }}>{w.waiter_code ?? "—"}</span>
              <span className="grow">
                <strong>{w.name}{w.name_local ? <span className="muted"> · {w.name_local}</span> : null}</strong>
                <span className="muted small">{w.waiter_code ? "" : `${t("waiters.no_code")} · `}{!owner ? "" : w.commission_bp === null ? t("waiters.uses_default", { pct: pct(defaultBp) || "0" }) : `${pct(w.commission_bp)}%`}</span>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      )}

      <div className="card form">
        {owner && <Field label={t("waiters.default")} help={t("waiters.default_help")} htmlFor="w-def">
          <div style={{ display: "flex", gap: 10 }}>
            <input id="w-def" className="input num" inputMode="decimal" value={def} placeholder="0" onChange={(e) => setDefPct(e.target.value.replace(/[^\d.]/g, ""))} />
            <button className="btn primary" disabled={defPct === null || percentToBp(def) === null && def !== ""} onClick={saveDefault}><Icon name="check" /> {t("common.save")}</button>
          </div>
        </Field>}
        {others.length > 0 && (
          <Field label={t("waiters.make")} htmlFor="w-make">
            <select id="w-make" className="select" value="" onChange={(e) => e.target.value && void makeWaiter(Number(e.target.value))}>
              <option value="">{t("waiters.pick_staff")}</option>
              {others.map((s) => <option key={s.id} value={s.id}>{s.name}{s.role ? ` · ${s.role}` : ""}</option>)}
            </select>
          </Field>
        )}
        <ErrorNote error={error} />
      </div>
    </div>
  );
}

function WaiterForm({ owner, initial, defaultBp, onDone }: { owner: boolean; initial: StaffW | null; defaultBp: number; onDone: () => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ name: initial?.name ?? "", name_local: initial?.name_local ?? "", code: initial?.waiter_code ?? "", pct: pct(initial?.commission_bp) });
  const [error, setError] = useState<unknown>(null);
  const bp = percentToBp(f.pct);
  const pctOk = f.pct === "" || bp !== null;

  async function save(extra: Record<string, unknown> = {}) {
    setError(null);
    const json = { waiter_code: f.code || null, commission_bp: f.pct === "" ? null : bp, ...extra };
    try {
      if (initial) await api(`/billing/waiters/${initial.id}`, { method: "PATCH", json });
      else await api("/billing/waiters", { method: "POST", json: { ...json, name: f.name, name_local: f.name_local || null } });
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="card form">
      <h2>{initial ? initial.name : t("waiters.add")}</h2>
      {!initial && (
        <div className="grid-2">
          <Field label={t("waiters.name")} htmlFor="w-name"><input id="w-name" className="input" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={`${t("staff.name_local")} (${t("common.optional")})`} htmlFor="w-local"><input id="w-local" className="input" value={f.name_local} onChange={(e) => setF({ ...f, name_local: e.target.value })} /></Field>
        </div>
      )}
      <div className="grid-2">
        <Field label={t("waiters.code")} help={t("waiters.code_help")} htmlFor="w-code">
          <input id="w-code" className="input num" value={f.code} maxLength={6} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
        </Field>
        {owner && <Field label={`${t("waiters.commission")} (${t("common.optional")})`} help={t("waiters.commission_help", { pct: pct(defaultBp) || "0" })} htmlFor="w-pct">
          <input id="w-pct" className="input num" inputMode="decimal" value={f.pct} placeholder={pct(defaultBp) || "0"} onChange={(e) => setF({ ...f, pct: e.target.value.replace(/[^\d.]/g, "") })} />
        </Field>}
      </div>
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="btn" onClick={onDone}>{t("common.cancel")}</button>
        {initial && <button className="btn danger" onClick={() => save({ is_waiter: false })}>{t("waiters.remove")}</button>}
        <button className="btn primary" disabled={(!initial && !f.name.trim()) || !pctOk} onClick={() => save()}><Icon name="check" /> {t("common.save")}</button>
      </div>
      {!pctOk && <Pill tone="warn">0–100%</Pill>}
    </div>
  );
}
