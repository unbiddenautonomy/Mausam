import { Link, useSearchParams } from "react-router";
import { businessDate, formatINR } from "@mausam/shared";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { catName, timeIST } from "../lib/format";
import { Icon } from "../components/Icon";
import { DayStepper, Empty, ErrorNote, errorText, Loading, PageHead, Photo, PhotoLink, Pill, useToast } from "../components/ui";

interface Exp {
  id: number;
  amount: number;
  shop: string | null;
  mode: "cash" | "online";
  source?: "manual" | "advance" | "vendor_payment";
  photo_key: string | null;
  has_receipt: boolean;
  note: string | null;
  created_at: string;
  created_by: number;
  created_by_name: string;
  category_name: string;
  category_name_hi: string | null;
  category_name_kn: string | null;
}

export function Expenses() {
  const { t, lang, user } = useSession();
  const [params, setParams] = useSearchParams();
  const today = businessDate();
  const date = params.get("date") ?? today;
  const res = useApi<{ expenses: Exp[] }>(`/expenses?date=${date}`);
  const total = res.data?.expenses.reduce((s, e) => s + e.amount, 0) ?? 0;
  const go = (d: string) => setParams(d === today ? {} : { date: d });
  const toast = useToast();

  async function remove(e: Exp) {
    if (!window.confirm(`${t("common.delete")}: ${formatINR(e.amount)}?`)) return;
    await api(`/expenses/${e.id}`, { method: "DELETE" }).catch((err) => toast(errorText(t, err)));
    res.reload();
  }

  return (
    <div className="page">
      <PageHead
        title={t("expense.list")}
        back="/entries"
        action={
          <Link className="btn primary small" to={`/entries/expenses/new${date !== today ? `?date=${date}` : ""}`}>
            <Icon name="plus" /> {t("common.add")}
          </Link>
        }
      />
      <DayStepper date={date} max={today} onChange={go}>
        <div className="muted small">{t("expense.day_total")}: <span className="num">{formatINR(total)}</span></div>
      </DayStepper>
      {res.error ? <ErrorNote error={res.error} /> : !res.data ? <Loading /> : (
        <div className="card flush list">
          {res.data.expenses.length === 0 && <Empty>{t("expense.empty")}</Empty>}
          {res.data.expenses.map((e) => (
            <div className="row" key={e.id}>
              {e.photo_key ? (
                <PhotoLink photoKey={e.photo_key}><Photo className="thumb" photoKey={e.photo_key} /></PhotoLink>
              ) : (
                <span className="thumb" style={{ display: "grid", placeItems: "center", color: "var(--text-3)" }}><Icon name="receipt" /></span>
              )}
              <span className="grow">
                <strong className="ellipsis">{catName(e, lang)}{e.shop ? ` · ${e.shop}` : ""}</strong>
                <span className="muted small ellipsis">
                  {timeIST(e.created_at)} · {e.created_by_name} · {e.mode === "cash" ? t("common.cash") : t("common.online")}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
                {e.source && e.source !== "manual" ? (
                  <span><Pill>{e.source === "advance" ? t("people.advances") : t("vendor.payment")}</Pill></span>
                ) : !e.has_receipt ? (
                  <span><Pill tone="warn">{t("expense.no_receipt")}</Pill></span>
                ) : null}
              </span>
              <span className="amount">{formatINR(e.amount)}</span>
              {(!e.source || e.source === "manual") && (user!.role === "owner" || e.created_by === user!.id) && (
                <>
                  <Link className="btn small" aria-label={t("common.edit")} to={`/entries/expenses/${e.id}/edit`}><Icon name="edit" /></Link>
                  <button className="btn small danger" aria-label={t("common.delete")} onClick={() => remove(e)}><Icon name="trash" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
