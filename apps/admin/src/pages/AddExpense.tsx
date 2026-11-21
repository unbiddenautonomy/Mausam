import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { formatINR, MORNING_ITEMS, MORNING_OTHERS, morningItemOf, morningItemText, rupeesToPaise } from "@mausam/shared";
import { api, sendOrQueue } from "../lib/api";
import { useApi, useDraft } from "../lib/hooks";
import { useSession } from "../lib/session";
import { catName, newClientId } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorNote, Field, Loading, MoneyInput, PageHead, PhotoInput, Segmented, useToast } from "../components/ui";

interface Cat {
  id: number;
  key: string;
  name_en: string;
  name_hi: string | null;
  name_kn: string | null;
}

interface Saved {
  id: number;
  business_date: string;
  trip_id: number | null;
  category_id: number;
  shop: string | null;
  amount: number;
  mode: "cash" | "online";
  has_receipt: boolean;
  photo_key: string | null;
  note: string | null;
  item: string | null;
  qty: number | null;
  unit: string | null;
}

const blank = () => ({
  category_id: 0,
  amount: "",
  shop: "",
  mode: "cash" as "cash" | "online",
  photo_key: null as string | null,
  no_receipt: false,
  note: "",
  item: "",
  // Morning shopping: the item tile picked, and the text typed for Others.
  pick: "",
  other: "",
  qty: "",
  unit: "kg",
  client_id: newClientId(),
});
type Draft = ReturnType<typeof blank>;

export function AddExpense() {
  return <ExpenseForm />;
}

/** The same form, filled with a saved expense. Saving changes it in place. */
export function EditExpense() {
  const { id } = useParams();
  const res = useApi<{ expense: Saved }>(`/expenses/${Number(id)}`);
  if (res.error) return <div className="page"><ErrorNote error={res.error} /></div>;
  if (!res.data) return <Loading />;
  const e = res.data.expense;
  return (
    <ExpenseForm
      editing={e}
      initial={{
        category_id: e.category_id,
        amount: (e.amount / 100).toFixed(2).replace(/\.00$/, ""),
        shop: e.shop ?? "",
        mode: e.mode,
        photo_key: e.photo_key,
        no_receipt: !e.has_receipt && !e.photo_key,
        note: e.note ?? "",
        item: e.item ?? "",
        ...(e.trip_id ? morningItemOf(e.item) : { pick: "", other: "" }),
        qty: e.qty ? String(e.qty) : "",
        unit: e.unit ?? "kg",
        client_id: "",
      }}
    />
  );
}

function ExpenseForm({ editing, initial }: { editing?: Saved; initial?: Draft }) {
  const { t, lang } = useSession();
  const [params] = useSearchParams();
  const tripId = editing ? (editing.trip_id ? String(editing.trip_id) : null) : params.get("trip");
  const date = editing ? editing.business_date : params.get("date");
  const backTo = tripId ? "/entries/shopping" : `/entries/expenses${date ? `?date=${date}` : ""}`;
  const toast = useToast();
  const cats = useApi<{ categories: Cat[] }>("/categories");
  // A new expense keeps its draft on the phone; an edit starts from what was saved.
  const [newDraft, setNewDraft, clearNewDraft] = useDraft(`expense.${tripId ?? "day"}`, blank());
  const [editDraft, setEditDraft] = useState<Draft>(initial ?? blank());
  const draft = editing ? editDraft : newDraft;
  const setDraft = editing ? setEditDraft : setNewDraft;
  const clearDraft = editing ? () => {} : clearNewDraft;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const paise = rupeesToPaise(draft.amount);
  const ready = !!paise && draft.category_id > 0 && (!!draft.photo_key || draft.no_receipt);

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const body = {
      category_id: draft.category_id,
      amount: paise,
      shop: draft.shop,
      mode: draft.mode,
      photo_key: draft.photo_key,
      has_receipt: !draft.no_receipt,
      note: draft.note,
      item: tripId ? morningItemText(draft.pick ?? "", draft.other ?? "") : draft.item || null,
      qty: draft.qty ? Number(draft.qty) : null,
      unit: draft.qty ? draft.unit : null,
    };
    try {
      if (editing) {
        await api(`/expenses/${editing.id}`, { method: "PUT", json: body });
        toast(t("common.saved"), backTo);
        return;
      }
      const r = await sendOrQueue("/expenses", "POST", {
        ...body,
        trip_id: tripId ? Number(tripId) : null,
        business_date: date ?? undefined,
        client_id: draft.client_id,
      });
      clearDraft();
      toast("queued" in (r as object) ? t("offline.queued") : t("common.saved"), backTo);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead title={editing ? t("expense.edit_title") : t("expense.title")} back={backTo} />
      <div className="form">
        <PhotoInput label={t("expense.receipt")} kind="receipt" value={draft.photo_key} onChange={(k) => setDraft((d) => ({ ...d, photo_key: k, no_receipt: k ? false : d.no_receipt }))} />
        {!draft.photo_key && (
          <label className="check warn" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={draft.no_receipt} onChange={(e) => set("no_receipt", e.target.checked)} style={{ width: 22, height: 22 }} />
            <span className="t">{t("expense.no_receipt")}</span>
          </label>
        )}

        {tripId && (
          <div className="field">
            <span className="label">{t("shopping.what")}</span>
            <div className="tiles">
              {[...MORNING_ITEMS, MORNING_OTHERS].map((i) => (
                <button
                  type="button"
                  key={i.name}
                  className={`tile${draft.pick === i.name ? " on" : ""}`}
                  aria-pressed={draft.pick === i.name}
                  onClick={() => setDraft((d) => {
                    const pick = d.pick === i.name ? "" : i.name;
                    // A vegetable bill: file it under Vegetables unless a category is already picked.
                    const veg = cats.data?.categories.find((c) => c.key === "vegetables");
                    return { ...d, pick, category_id: d.category_id || (pick && veg ? veg.id : 0) };
                  })}
                >
                  <span aria-hidden="true" style={{ fontSize: "1.4em", marginRight: 6 }}>{i.emoji}</span>
                  {i.name}
                </button>
              ))}
            </div>
            {draft.pick === MORNING_OTHERS.name && (
              <input id="other" className="input" style={{ marginTop: 8 }} aria-label={t("shopping.others_what")} placeholder={t("shopping.others_what")}
                value={draft.other ?? ""} onChange={(e) => set("other", e.target.value)} />
            )}
          </div>
        )}

        <Field label={t("common.amount")} htmlFor="amount">
          <MoneyInput id="amount" value={draft.amount} onChange={(v) => set("amount", v)} />
        </Field>

        <div className="field">
          <span className="label">{t("expense.category")}</span>
          {!cats.data ? (
            <Loading />
          ) : (
            <div className="tiles">
              {cats.data.categories.map((c) => (
                <button type="button" key={c.id} className={`tile${draft.category_id === c.id ? " on" : ""}`} onClick={() => set("category_id", c.id)}>
                  {catName(c, lang)}
                </button>
              ))}
            </div>
          )}
        </div>

        <Field label={`${t("expense.shop")} (${t("common.optional")})`} htmlFor="shop">
          <input id="shop" className="input" value={draft.shop} onChange={(e) => set("shop", e.target.value)} />
        </Field>

        <details>
          <summary className="muted" style={{ cursor: "pointer", padding: "6px 0" }}>{t("expense.qty_toggle")} · {t("common.optional")}</summary>
          <div className="form" style={{ marginTop: 12 }}>
            {!tripId && (
              <Field label={t("expense.item")} htmlFor="item">
                <input id="item" className="input" value={draft.item} placeholder={t("expense.item_eg")} onChange={(e) => set("item", e.target.value)} />
              </Field>
            )}
            <div className="grid-2">
              <Field label={t("delivery.qty")} htmlFor="qty">
                <input id="qty" className="input" inputMode="decimal" value={draft.qty} onChange={(e) => set("qty", e.target.value.replace(/[^\d.]/g, ""))} />
              </Field>
              <Field label={t("vendor.unit")} htmlFor="unit">
                <select id="unit" className="select" value={draft.unit} onChange={(e) => set("unit", e.target.value)}>
                  {["kg", "g", "litre", "pcs", "dozen", "packet", "crate", "box", "bag"].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
            </div>
            {draft.qty && paise ? <p className="muted small" style={{ margin: 0 }}>{formatINR(Math.round(paise / Number(draft.qty)))} / {draft.unit}</p> : null}
          </div>
        </details>

        <div className="field">
          <span className="label">{t("expense.mode")}</span>
          <Segmented value={draft.mode} onChange={(v) => set("mode", v)} options={[{ value: "cash", label: t("common.cash") }, { value: "online", label: t("common.online") }]} />
        </div>

        <Field label={t("common.note_optional")} htmlFor="note">
          <textarea id="note" className="textarea" value={draft.note} onChange={(e) => set("note", e.target.value)} />
        </Field>

        <ErrorNote error={error} />
        <div className="sticky-actions">
          {!ready && !busy && (
            <span className="sticky-hint">{!paise || draft.category_id <= 0 ? t("expense.need_more") : t("expense.need_bill")}</span>
          )}
          <button className="btn primary block" disabled={!ready || busy} onClick={save}>
            <Icon name="check" /> {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
