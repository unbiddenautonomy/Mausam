import { useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { Field, Loading, PageHead } from "../../components/ui";
import type { PosSettings } from "./Menu";

interface DiningTable { id: number; area: string; name: string; seats: number; sort: number; active: number }

/** Owner: the tables the POS shows, grouped by area (Garden, Rooftop…). */
export function TablesPage() {
  const { t } = useSession();
  const res = useApi<{ tables: DiningTable[] }>("/billing/tables");
  const tablesOff = useApi<{ settings: PosSettings }>("/billing/settings").data?.settings.use_tables === false;
  const [f, setF] = useState({ area: "", from: "", count: "1", seats: "4" });
  const tables = res.data?.tables ?? [];
  const areas = [...new Set(tables.map((x) => x.area))];

  /** "C" + from 1, count 15 → C1…C15. A name without a number adds just that one table. */
  async function add() {
    const m = f.from.match(/^(.*?)(\d+)$/);
    const count = Math.max(1, Math.min(50, Number(f.count) || 1));
    const names = m ? Array.from({ length: count }, (_, i) => `${m[1]}${Number(m[2]) + i}`) : [f.from.trim()];
    let sort = tables.reduce((s, x) => Math.max(s, x.sort), 0);
    for (const name of names) await api("/billing/tables", { method: "POST", json: { area: f.area, name, seats: Number(f.seats) || 4, sort: ++sort } });
    setF({ ...f, from: "", count: "1" });
    res.reload();
  }
  async function toggle(x: DiningTable) {
    await api(`/billing/tables/${x.id}`, { method: "PATCH", json: { active: !x.active } });
    res.reload();
  }

  return (
    <div className="page">
      <PageHead title={t("tables.title")} subtitle={t("tables.desc")} back="/manage" />
      {tablesOff && <div className="check warn"><Icon name="alert" /><span className="t">{t("tables.off_note")}</span></div>}
      <div className="card form">
        <h2>{t("tables.add")}</h2>
        <div className="grid-2">
          <Field label={t("tables.area")} htmlFor="t-area">
            <input id="t-area" className="input" list="t-areas" value={f.area} placeholder={t("tables.area_eg")} onChange={(e) => setF({ ...f, area: e.target.value })} />
            <datalist id="t-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label={t("tables.first_name")} help={t("tables.first_help")} htmlFor="t-from"><input id="t-from" className="input" value={f.from} placeholder="C1" onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label={t("tables.how_many")} htmlFor="t-n"><input id="t-n" className="input" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label={t("tables.seats")} htmlFor="t-s"><input id="t-s" className="input" inputMode="numeric" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <button className="btn primary" disabled={!f.from.trim()} onClick={add}><Icon name="plus" /> {t("common.add")}</button>
      </div>
      {!res.data ? <Loading /> : areas.map((area) => (
        <section className="section" key={area}>
          <h2>{area || t("tables.no_area")}</h2>
          <div className="tiles">
            {tables.filter((x) => x.area === area).map((x) => (
              <button key={x.id} className={`tile${x.active ? "" : " off"}`} onClick={() => toggle(x)} title={x.active ? t("tables.tap_hide") : t("tables.tap_show")}>
                <strong>{x.name}</strong> <span className="muted small">· {x.seats}</span>
                {!x.active && <span className="muted small"> · {t("menu.hidden")}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
      {res.data && <p className="muted small">{t("tables.tap_help")}</p>}
    </div>
  );
}
