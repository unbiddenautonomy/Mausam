import { useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Field, Loading, PageHead } from "../../components/ui";

interface C {
  id: number;
  name_en: string;
  name_hi: string | null;
  name_kn: string | null;
  active: boolean;
}

export function Categories() {
  const t = useSession().t;
  const res = useApi<{ categories: C[] }>("/manage/categories");
  const [f, setF] = useState({ name_en: "", name_hi: "", name_kn: "" });
  const [editing, setEditing] = useState<C | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function add() {
    await api("/manage/categories", { method: "POST", json: f });
    setF({ name_en: "", name_hi: "", name_kn: "" });
    res.reload();
  }
  async function toggle(c: C) {
    await api(`/manage/categories/${c.id}`, { method: "PUT", json: { ...c, active: !c.active } });
    res.reload();
  }
  async function rename() {
    if (!editing) return;
    setError(null);
    try {
      await api(`/manage/categories/${editing.id}`, { method: "PUT", json: editing });
      setEditing(null);
      res.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="page">
      <PageHead title={t("manage.categories")} subtitle={t("manage.categories_desc")} back="/manage" />
      <div className="card form">
        <h2>{t("cat.add")}</h2>
        <div className="grid-3">
          <Field label={t("cat.name_en")} htmlFor="c-en"><input id="c-en" className="input" value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
          <Field label={t("cat.name_hi")} htmlFor="c-hi"><input id="c-hi" className="input" value={f.name_hi} onChange={(e) => setF({ ...f, name_hi: e.target.value })} /></Field>
          <Field label={t("cat.name_kn")} htmlFor="c-kn"><input id="c-kn" className="input" value={f.name_kn} onChange={(e) => setF({ ...f, name_kn: e.target.value })} /></Field>
        </div>
        <button className="btn primary" disabled={!f.name_en.trim()} onClick={add}><Icon name="plus" /> {t("common.add")}</button>
      </div>
      {!res.data ? <Loading /> : (
        <div className="card flush list">
          {res.data.categories.map((c) =>
            editing?.id === c.id ? (
              <div className="form" key={c.id} style={{ padding: 16 }}>
                <div className="grid-3">
                  <Field label={t("cat.name_en")} htmlFor="e-en"><input id="e-en" className="input" value={editing.name_en} onChange={(e) => setEditing({ ...editing, name_en: e.target.value })} /></Field>
                  <Field label={t("cat.name_hi")} htmlFor="e-hi"><input id="e-hi" className="input" value={editing.name_hi ?? ""} onChange={(e) => setEditing({ ...editing, name_hi: e.target.value })} /></Field>
                  <Field label={t("cat.name_kn")} htmlFor="e-kn"><input id="e-kn" className="input" value={editing.name_kn ?? ""} onChange={(e) => setEditing({ ...editing, name_kn: e.target.value })} /></Field>
                </div>
                <ErrorNote error={error} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" disabled={!editing.name_en.trim()} onClick={rename}><Icon name="check" /> {t("common.save")}</button>
                  <button className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <div className="row" key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
                <span className="grow">
                  <strong>{c.name_en}</strong>
                  <span className="muted small">{[c.name_hi, c.name_kn].filter(Boolean).join(" · ")}</span>
                </span>
                <button className="btn small" aria-label={t("common.edit")} onClick={() => (setError(null), setEditing(c))}><Icon name="edit" /></button>
                <button className="btn small" onClick={() => toggle(c)}>{c.active ? t("common.delete") : t("common.add")}</button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
