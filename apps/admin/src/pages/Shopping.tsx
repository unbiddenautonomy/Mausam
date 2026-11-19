import { useState } from "react";
import { Link } from "react-router";
import { formatDay, formatINR, rupeesToPaise, shoppingGap } from "@mausam/shared";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { catName, timeIST } from "../lib/format";
import { Icon } from "../components/Icon";
import { Empty, ErrorNote, Field, Loading, Money, MoneyInput, PageHead, Photo, Pill, Stat, useToast } from "../components/ui";

interface Trip {
  id: number;
  float_out: number;
  float_back: number | null;
  status: "open" | "closed";
  spent: number;
  note: string | null;
  manager_name: string;
}
interface Exp {
  id: number;
  amount: number;
  shop: string | null;
  mode: string;
  photo_key: string | null;
  has_receipt: boolean;
  created_at: string;
  category_name: string;
  category_name_hi: string | null;
  category_name_kn: string | null;
}

export function Shopping() {
  const { t } = useSession();
  const today = useApi<{
    business_date: string;
    shopping: { status: string; trip: { id: number } | null; stale_trip: { id: number; business_date: string; manager_name: string } | null };
  }>("/today");
  if (!today.data) return today.error ? <ErrorNote error={today.error} /> : <Loading />;
  const { trip, stale_trip: stale } = today.data.shopping;
  return (
    <div className="page">
      <PageHead title={t("shopping.title")} back="/entries" />
      {stale && (
        <section className="section">
          <div className="check bad">
            <Icon name="alert" />
            <span className="t">{t("shopping.stale", { date: formatDay(stale.business_date), name: stale.manager_name })}</span>
          </div>
          <TripView id={stale.id} onClosed={today.reload} />
        </section>
      )}
      {stale && <h2>{t("shopping.today_trip")}</h2>}
      {trip ? <TripView id={trip.id} /> : <StartTrip onStarted={today.reload} />}
    </div>
  );
}

function StartTrip({ onStarted }: { onStarted: () => void }) {
  const t = useSession().t;
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const paise = rupeesToPaise(amount);
  async function start() {
    if (!paise) return;
    setBusy(true);
    try {
      await api("/shopping", { method: "POST", json: { float_out: paise } });
      onStarted();
    } catch (e) {
      if (e instanceof ApiError && e.code === "trip_already_open") onStarted();
      else setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card form">
      <Field label={t("shopping.float_out")} help={t("shopping.float_out_help")} htmlFor="float">
        <MoneyInput id="float" value={amount} onChange={setAmount} autoFocus />
      </Field>
      <ErrorNote error={error} />
      <button className="btn primary block" disabled={!paise || busy} onClick={start}>
        <Icon name="cart" /> {t("shopping.start")}
      </button>
    </div>
  );
}

function TripView({ id, onClosed }: { id: number; onClosed?: () => void }) {
  const { t, lang } = useSession();
  const toast = useToast();
  const res = useApi<{ trip: Trip; expenses: Exp[]; tolerance: number }>(`/shopping/${id}`);
  const [back, setBack] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!res.data) return res.error ? <ErrorNote error={res.error} /> : <Loading />;
  const { trip, expenses } = res.data;
  const expected = trip.float_out - trip.spent;
  const backPaise = rupeesToPaise(back);
  const gap = backPaise === null ? null : shoppingGap(trip.float_out, trip.spent, backPaise);
  const needsNote = gap !== null && Math.abs(gap) > (res.data.tolerance ?? 5000);

  async function finish() {
    if (backPaise === null) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/shopping/${id}/close`, { method: "POST", json: { float_back: backPaise, note } });
      toast(t("shopping.closed"));
      if (onClosed) onClosed();
      else res.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="stats">
        <Stat label={t("shopping.float_out")} value={<Money paise={trip.float_out} />} />
        <Stat label={t("shopping.spent_cash")} value={<Money paise={trip.spent} />} />
        {trip.status === "closed" ? (
          <Stat label={t("shopping.float_back")} value={<Money paise={trip.float_back} />} />
        ) : (
          <Stat label={t("shopping.expected_back")} value={<Money paise={expected} />} />
        )}
      </div>

      <section className="section">
        <div className="section-head">
          <h2>{t("shopping.bills")} ({expenses.length})</h2>
          {trip.status === "open" && (
            <Link to={`/entries/expenses/new?trip=${id}`} className="btn small primary">
              <Icon name="plus" /> {t("shopping.add_receipt")}
            </Link>
          )}
        </div>
        <div className="card flush list">
          {expenses.length === 0 && <Empty>{t("shopping.no_bills")}</Empty>}
          {expenses.map((e) => (
            <div className="row" key={e.id}>
              {e.photo_key ? <Photo className="thumb" photoKey={e.photo_key} /> : <span className="thumb" style={{ display: "grid", placeItems: "center" }}><Icon name="receipt" /></span>}
              <span className="grow">
                <strong className="ellipsis">{catName(e, lang)}{e.shop ? ` · ${e.shop}` : ""}</strong>
                <span className="muted small">
                  {timeIST(e.created_at)} {!e.has_receipt && <Pill tone="warn">{t("expense.no_receipt")}</Pill>}
                </span>
              </span>
              <span className="amount">{formatINR(e.amount)}</span>
            </div>
          ))}
        </div>
      </section>

      {trip.status === "open" ? (
        <section className="card form">
          <h2>{t("shopping.finish")}</h2>
          <Field label={t("shopping.float_back")} htmlFor="back">
            <MoneyInput id="back" value={back} onChange={setBack} />
          </Field>
          {gap !== null && (
            <div className={`check ${needsNote ? "bad" : "good"}`}>
              <Icon name={needsNote ? "alert" : "check"} />
              <span className="t">{needsNote ? t("shopping.gap", { amount: formatINR(Math.abs(gap)) }) : t("shopping.balanced")}</span>
            </div>
          )}
          {needsNote && (
            <Field label={t("common.note")} htmlFor="note">
              <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          <ErrorNote error={error} />
          <button className="btn primary block" disabled={backPaise === null || busy || (needsNote && !note.trim())} onClick={finish}>
            <Icon name="check" /> {t("shopping.finish")}
          </button>
        </section>
      ) : (
        <div className="check good">
          <Icon name="check" />
          <span className="t">{t("shopping.closed")} · {trip.manager_name}{trip.note ? ` · ${trip.note}` : ""}</span>
        </div>
      )}
    </>
  );
}
