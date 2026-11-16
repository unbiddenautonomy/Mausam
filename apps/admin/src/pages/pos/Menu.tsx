import { useMemo, useState } from "react";
import { formatINR, rupeesToPaise } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Field, Loading, MoneyInput, PageHead, Segmented, useToast } from "../../components/ui";

export interface MenuCategory { id: number; name: string; name_hi: string | null; name_kn: string | null; sort: number; active: number }
export interface MenuItem {
  id: number; category_id: number; name: string; name_hi: string | null; name_kn: string | null; short_name: string | null; price: number; tax_rate: number | null;
  hsn: string | null; veg: number; favourite: number; sort: number; active: number;
  variations: MenuOption[] | null; addons: MenuOption[] | null;
}
/** A variation (its price is the item's price) or an add-on (its price is added). Paise. */
export interface MenuOption { name: string; price: number }
export interface PosSettings {
  gst_rate: number; prices_include_tax: boolean; gstin: string; bill_header: string; bill_footer: string;
  use_tables: boolean; use_gst: boolean; printing: boolean; commission_bp: number; waiter_required: boolean;
}

/** Owner: the POS menu. Categories down the side on desktop, items as a list, one form for add and edit. */
export function MenuPage() {
  const { t } = useSession();
  const res = useApi<{ categories: MenuCategory[]; items: MenuItem[] }>("/billing/menu");
  const useGst = !!useApi<{ settings: PosSettings }>("/billing/settings").data?.settings.use_gst;
  const [cat, setCat] = useState<number | null>(null);
  const [editing, setEditing] = useState<MenuItem | "new" | null>(null);
  const [newCat, setNewCat] = useState("");
  const [query, setQuery] = useState("");

  const cats = res.data?.categories ?? [];
  const current = cat ?? cats.find((c) => c.active)?.id ?? null;
  const items = useMemo(() => {
    const all = res.data?.items ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((i) => [i.name, i.name_hi, i.name_kn].some((n) => (n ?? "").toLowerCase().includes(q))) : all.filter((i) => i.category_id === current);
  }, [res.data, current, query]);

  async function addCategory() {
    const r = await api<{ id: number }>("/billing/menu/categories", { method: "POST", json: { name: newCat, sort: (cats.length + 1) * 10 } });
    setNewCat("");
    setCat(r.id);
    res.reload();
  }
  async function toggleCategory(c: MenuCategory) {
    await api(`/billing/menu/categories/${c.id}`, { method: "PATCH", json: { active: !c.active } });
    res.reload();
  }

  return (
    <div className="page">
      <PageHead
        title={t("menu.title")}
        subtitle={res.data ? t("menu.count", { n: res.data.items.filter((i) => i.active).length }) : undefined}
        back="/manage"
        action={!editing && current ? <button className="btn small primary" onClick={() => setEditing("new")}><Icon name="plus" /> {t("menu.add_item")}</button> : undefined}
      />
      {!res.data ? <Loading /> : (
        <>
          {editing && (
            <ItemForm
              initial={editing === "new" ? null : editing}
              categories={cats.filter((c) => c.active)}
              defaultCategory={current ?? cats[0]?.id}
              onDone={() => (setEditing(null), res.reload())}
            />
          )}
          <input className="input" placeholder={t("menu.search")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("menu.search")} />
          {!query && (
            <div className="chips" role="tablist">
              {cats.map((c) => (
                <button key={c.id} role="tab" aria-selected={c.id === current} className={`pill${c.id === current ? " good" : ""}`} style={{ cursor: "pointer", border: 0, opacity: c.active ? 1 : 0.5, padding: "8px 14px", fontSize: "0.95rem" }} onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="card flush list">
            {items.length === 0 && <div className="row muted">{t("menu.empty")}</div>}
            {items.map((i) => (
              <button key={i.id} className="row row-link as-button" style={{ opacity: i.active ? 1 : 0.5 }} onClick={() => setEditing(i)}>
                <span className={`veg-dot ${i.veg ? "veg" : "nonveg"}`} aria-label={i.veg ? t("menu.veg") : t("menu.nonveg")} />
                <span className="grow">
                  <strong>{i.name}{i.favourite ? " ★" : ""}</strong>
                  <span className="muted small">{[i.name_hi, i.name_kn, i.short_name,
                    i.variations?.length ? i.variations.map((v) => v.name).join(" / ") : null,
                    i.addons?.length ? i.addons.map((v) => v.name).join(" / ") : null, i.tax_rate !== null && useGst ? `GST ${i.tax_rate / 100}%` : null, i.active ? null : t("menu.hidden")].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="amount">{formatINR(i.price)}</span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
          {current && !query && (
            <div className="btn-row">
              {(() => {
                const c = cats.find((x) => x.id === current)!;
                return <button className="btn small" onClick={() => toggleCategory(c)}>{c.active ? t("menu.hide_category") : t("menu.show_category")}</button>;
              })()}
            </div>
          )}
          <div className="card form">
            <h2>{t("menu.new_category")}</h2>
            <div style={{ display: "flex", gap: 10 }}>
              <input className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t("menu.category_eg")} aria-label={t("menu.new_category")} />
              <button className="btn primary" disabled={!newCat.trim()} onClick={addCategory}><Icon name="plus" /> {t("common.add")}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ItemForm({ initial, categories, defaultCategory, onDone }: { initial: MenuItem | null; categories: MenuCategory[]; defaultCategory?: number; onDone: () => void }) {
  const { t } = useSession();
  const useGst = !!useApi<{ settings: PosSettings }>("/billing/settings").data?.settings.use_gst;
  const toast = useToast();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    name_hi: initial?.name_hi ?? "",
    name_kn: initial?.name_kn ?? "",
    short_name: initial?.short_name ?? "",
    category_id: initial?.category_id ?? defaultCategory ?? 0,
    price: initial ? String(initial.price / 100) : "",
    tax: initial?.tax_rate === null || initial?.tax_rate === undefined ? "" : String(initial.tax_rate / 100),
    veg: initial ? !!initial.veg : true,
    favourite: initial ? !!initial.favourite : false,
    active: initial ? !!initial.active : true,
  });
  const toRows = (o: MenuOption[] | null | undefined) => (o ?? []).map((x) => ({ name: x.name, price: String(x.price / 100) }));
  const [variations, setVariations] = useState(toRows(initial?.variations));
  const [addons, setAddons] = useState(toRows(initial?.addons));
  const fromRows = (rows: OptionRow[]) => rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), price: rupeesToPaise(r.price || "0") ?? 0 }));
  const [error, setError] = useState<unknown>(null);
  const price = rupeesToPaise(f.price);
  const ready = f.name.trim() && f.category_id && price !== null;

  async function save() {
    setError(null);
    const json = {
      name: f.name, name_hi: f.name_hi || null, name_kn: f.name_kn || null, short_name: f.short_name || null, category_id: Number(f.category_id), price,
      tax_rate: f.tax === "" ? null : Math.round(Number(f.tax) * 100), veg: f.veg, favourite: f.favourite, active: f.active,
      variations: fromRows(variations), addons: fromRows(addons),
    };
    try {
      if (initial) await api(`/billing/menu/items/${initial.id}`, { method: "PATCH", json });
      else await api("/billing/menu/items", { method: "POST", json });
      toast(t("common.saved"));
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="card form">
      <h2>{initial ? initial.name : t("menu.add_item")}</h2>
      <Field label={t("menu.item_name")} htmlFor="m-name"><input id="m-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus={!initial} /></Field>
      <div className="grid-2">
        <Field label={`${t("cat.name_hi")} (${t("common.optional")})`} htmlFor="m-hi"><input id="m-hi" className="input" lang="hi" value={f.name_hi} onChange={(e) => setF({ ...f, name_hi: e.target.value })} /></Field>
        <Field label={`${t("cat.name_kn")} (${t("common.optional")})`} htmlFor="m-kn"><input id="m-kn" className="input" lang="kn" value={f.name_kn} onChange={(e) => setF({ ...f, name_kn: e.target.value })} /></Field>
      </div>
      <div className="grid-2">
        <Field label={t("menu.price")} htmlFor="m-price"><MoneyInput id="m-price" value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
        <Field label={t("menu.category")} htmlFor="m-cat">
          <select id="m-cat" className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: Number(e.target.value) })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label={`${t("menu.short_name")} (${t("common.optional")})`} help={t("menu.short_name_help")} htmlFor="m-short"><input id="m-short" className="input" value={f.short_name} onChange={(e) => setF({ ...f, short_name: e.target.value })} /></Field>
        {useGst && <Field label={`${t("menu.gst")} (${t("common.optional")})`} help={t("menu.gst_help")} htmlFor="m-tax"><input id="m-tax" className="input" inputMode="decimal" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value.replace(/[^\d.]/g, "") })} /></Field>}
      </div>
      <OptionsEditor label={t("menu.variations")} help={t("menu.variations_help")} rows={variations} onChange={setVariations} />
      <OptionsEditor label={t("menu.addons")} help={t("menu.addons_help")} rows={addons} onChange={setAddons} />
      <Segmented value={f.veg ? "veg" : "non"} onChange={(v) => setF({ ...f, veg: v === "veg" })} options={[{ value: "veg", label: t("menu.veg") }, { value: "non", label: t("menu.nonveg") }]} />
      <label className="check" style={{ cursor: "pointer", background: "var(--surface-2)" }}>
        <input type="checkbox" checked={f.favourite} onChange={(e) => setF({ ...f, favourite: e.target.checked })} style={{ width: 22, height: 22 }} />
        <span className="t">{t("menu.favourite")}</span>
      </label>
      {initial && (
        <label className="check" style={{ cursor: "pointer", background: "var(--surface-2)" }}>
          <input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} style={{ width: 22, height: 22 }} />
          <span className="t">{t("menu.hide_item")}</span>
        </label>
      )}
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="btn" onClick={onDone}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={!ready} onClick={save}><Icon name="check" /> {t("common.save")}</button>
      </div>
    </div>
  );
}

interface OptionRow { name: string; price: string }

/** Rows of name + price, for an item's variations or add-ons. */
function OptionsEditor({ label, help, rows, onChange }: { label: string; help: string; rows: OptionRow[]; onChange: (rows: OptionRow[]) => void }) {
  const { t } = useSession();
  const set = (i: number, patch: Partial<OptionRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="field" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
      <legend style={{ fontWeight: 700, padding: "0 6px" }}>{label}</legend>
      <span className="muted small">{help}</span>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, alignItems: "center" }}>
          <input className="input" aria-label={t("menu.option_name")} placeholder={t("menu.option_name")} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <MoneyInput value={r.price} onChange={(v) => set(i, { price: v })} />
          <button className="btn small" aria-label={t("common.delete")} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="x" /></button>
        </div>
      ))}
      <button className="btn small" style={{ justifySelf: "start" }} onClick={() => onChange([...rows, { name: "", price: "0" }])}><Icon name="plus" /> {t("menu.add_option")}</button>
    </fieldset>
  );
}
