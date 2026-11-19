import { dateLocale } from "@mausam/shared";
import { useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Field, Loading, PageHead, Pill, Segmented, useToast } from "../../components/ui";
import type { PosSettings } from "./Menu";

/** Owner: what the POS uses. Tables, GST and the printer can each be switched off; the code for them stays. */
export function PosOptionsPage() {
  const { t } = useSession();
  const toast = useToast();
  const res = useApi<{ settings: PosSettings }>("/billing/settings");
  const [f, setF] = useState<PosSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const s = f ?? res.data?.settings ?? null;
  if (!s) return <Loading />;

  async function save() {
    setError(null);
    try {
      const r = await api<{ settings: PosSettings }>("/billing/settings", { method: "PUT", json: s });
      setF(r.settings);
      toast(t("common.saved"));
    } catch (e) {
      setError(e);
    }
  }
  const toggle = (k: "use_tables" | "use_gst" | "printing" | "waiter_required", label: string, help: string) => (
    <label className="check" style={{ cursor: "pointer", background: "var(--surface-2)", alignItems: "flex-start" }}>
      <input type="checkbox" checked={s[k]} onChange={(e) => setF({ ...s, [k]: e.target.checked })} style={{ width: 24, height: 24, flex: "none" }} />
      <span className="t" style={{ display: "grid", gap: 2 }}>
        <strong>{label}</strong>
        <span className="muted small">{help}</span>
      </span>
    </label>
  );

  return (
    <div className="page">
      <PageHead title={t("manage.pos_settings")} subtitle={t("manage.pos_settings_desc")} back="/manage" />
      <div className="card form">
        {toggle("waiter_required", t("posset.waiter_required"), t("posset.waiter_required_help"))}
        {toggle("use_tables", t("posset.tables"), t("posset.tables_help"))}
        {toggle("printing", t("posset.printing"), t("posset.printing_help"))}
        {s.printing && (
          <div className="field">
            <span className="label">{t("posset.copies")}</span>
            <Segmented<string> value={String(s.bill_copies)} onChange={(v) => setF({ ...s, bill_copies: Number(v) })} options={["1", "2", "3"].map((n) => ({ value: n, label: n }))} />
            <span className="muted small">{t("posset.copies_help")}</span>
          </div>
        )}
        <Field label={t("posset.discount_limit_rs")} help={t("posset.discount_limit_rs_help")} htmlFor="g-disc-rs">
          <input id="g-disc-rs" className="input num" inputMode="numeric" value={String(Math.round((s.discount_limit_paise ?? 0) / 100))}
            onChange={(e) => setF({ ...s, discount_limit_paise: Math.min(100000, Number(e.target.value.replace(/\D/g, "") || 0)) * 100 })} />
        </Field>
        <Field label={t("posset.discount_limit")} help={t("posset.discount_limit_help")} htmlFor="g-disc">
          <input id="g-disc" className="input num" inputMode="numeric" value={String(s.discount_limit_pct ?? 100)}
            onChange={(e) => setF({ ...s, discount_limit_pct: Math.min(100, Number(e.target.value.replace(/\D/g, "") || 0)) })} />
        </Field>
        {toggle("use_gst", t("posset.gst"), t("posset.gst_help"))}
        {s.use_gst && (
          <>
            <div className="grid-2">
              <Field label="GSTIN" help={t("menu.gstin_help")} htmlFor="g-in"><input id="g-in" className="input" value={s.gstin} onChange={(e) => setF({ ...s, gstin: e.target.value.toUpperCase() })} /></Field>
              <Field label={t("menu.gst_default")} htmlFor="g-rate"><input id="g-rate" className="input" inputMode="decimal" value={String(s.gst_rate / 100)} onChange={(e) => setF({ ...s, gst_rate: Math.round(Number(e.target.value.replace(/[^\d.]/g, "") || 0) * 100) })} /></Field>
            </div>
            <div className="field">
              <span className="label">{t("menu.prices_are")}</span>
              <Segmented value={s.prices_include_tax ? "inc" : "exc"} onChange={(v) => setF({ ...s, prices_include_tax: v === "inc" })} options={[{ value: "inc", label: t("menu.include_gst") }, { value: "exc", label: t("menu.plus_gst") }]} />
            </div>
            {!s.gstin && <Pill tone="warn">{t("menu.no_gstin")}</Pill>}
          </>
        )}
        <Field label={t("menu.bill_header")} htmlFor="g-h"><textarea id="g-h" className="textarea" rows={3} value={s.bill_header} onChange={(e) => setF({ ...s, bill_header: e.target.value })} /></Field>
        <Field label={t("menu.bill_footer")} htmlFor="g-f"><input id="g-f" className="input" value={s.bill_footer} onChange={(e) => setF({ ...s, bill_footer: e.target.value })} /></Field>
        <ErrorNote error={error} />
        <button className="btn primary" disabled={!f} onClick={save}><Icon name="check" /> {t("common.save")}</button>
        <p className="muted small" style={{ margin: 0 }}>{t("posset.saved_note")}</p>
      </div>
      <Counters />
    </div>
  );
}

interface CounterRow { code: string; last_seen_at: string | null; last_bill_no: string | null; held: number }

/** The counter letters in use. The owner frees one when its device was reset or replaced. */
function Counters() {
  const { t } = useSession();
  const res = useApi<{ counters: CounterRow[] }>("/billing/counters");
  const [error, setError] = useState<unknown>(null);
  if (!res.data?.counters.length) return null;
  async function free(code: string) {
    if (!confirm(t("posset.counter_free_confirm", { code }))) return;
    setError(null);
    try {
      await api(`/billing/counters/${code}/release`, { method: "POST" });
      res.reload();
    } catch (e) {
      setError(e);
    }
  }
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(), { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
  return (
    <section className="form">
      <h2>{t("posset.counters")}</h2>
      <p className="muted small" style={{ margin: 0 }}>{t("posset.counters_help")}</p>
      <ErrorNote error={error} />
      <div className="card flush list">
        {res.data.counters.map((c) => (
          <div key={c.code} className="row">
            <span className="grow">
              <strong>{c.code}</strong>
              <span className="muted small">{c.last_bill_no ?? "—"} · {when(c.last_seen_at)}</span>
            </span>
            {c.held ? <button className="btn small" onClick={() => void free(c.code)}>{t("posset.counter_free")}</button> : <span className="muted small">{t("posset.counter_unheld")}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
