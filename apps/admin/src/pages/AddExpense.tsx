import { useState } from "react";
import { useSearchParams } from "react-router";
import { formatINR, rupeesToPaise } from "@mausam/shared";
import { sendOrQueue } from "../lib/api";
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

export function AddExpense() {
  const { t, lang } = useSession();
  const [params] = useSearchParams();
  const tripId = params.get("trip");
  const date = params.get("date");
  const backTo = tripId ? "/entries/shopping" : `/entries/expenses${date ? `?date=${date}` : ""}`;
  const toast = useToast();
  const cats = useApi<{ categories: Cat[] }>("/categories");
  const [draft, setDraft, clearDraft] = useDraft(`expense.${tripId ?? "day"}`, {
    category_id: 0,
    amount: "",
    shop: "",
    mode: "cash" as "cash" | "online",
    photo_key: null as string | null,
    no_receipt: false,
    note: "",
    item: "",
    qty: "",
    unit: "kg",
    client_id: newClientId(),
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const paise = rupeesToPaise(draft.amount);
  const ready = !!paise && draft.category_id > 0 && (!!draft.photo_key || draft.no_receipt);

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await sendOrQueue("/expenses", "POST", {
        category_id: draft.category_id,
        amount: paise,
        shop: draft.shop,
        mode: draft.mode,
        photo_key: draft.photo_key,
        has_receipt: !draft.no_receipt,
        note: draft.note,
        item: draft.item || null,
        qty: draft.qty ? Number(draft.qty) : null,
        unit: draft.qty ? draft.unit : null,
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
      <PageHead title={t("expense.title")} back={backTo} />
      <div className="form">
        <PhotoInput label={t("expense.receipt")} kind="receipt" value={draft.photo_key} onChange={(k) => setDraft((d) => ({ ...d, photo_key: k, no_receipt: k ? false : d.no_receipt }))} />
        {!draft.photo_key && (
          <label className="check warn" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={draft.no_receipt} onChange={(e) => set("no_receipt", e.target.checked)} style={{ width: 22, height: 22 }} />
            <span className="t">{t("expense.no_receipt")}</span>
          </label>
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
            <Field label={t("expense.item")} htmlFor="item">
              <input id="item" className="input" value={draft.item} placeholder={t("expense.item_eg")} onChange={(e) => set("item", e.target.value)} />
            </Field>
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
