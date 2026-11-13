import { Link } from "react-router";
import { formatDay, formatINR, type MessageKey } from "@mausam/shared";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Icon } from "../components/Icon";
import { Empty, ErrorNote, Loading, PageHead } from "../components/ui";

interface AlertRow {
  id: number;
  type: string;
  business_date: string;
  severity: "info" | "warn" | "critical";
  params: Record<string, string | number>;
  seen_at: string | null;
}

export function Alerts() {
  const t = useSession().t;
  const res = useApi<{ alerts: AlertRow[] }>("/alerts");

  function text(a: AlertRow): string {
    const base = a.type.split(":")[0] as "close_missing" | "close_flag" | "shopping_open" | "expense_high";
    const p = a.params;
    return t(`alert.${base}` as MessageKey, {
      date: formatDay(a.business_date),
      count: p.count ?? "",
      amount: typeof p.amount === "number" ? formatINR(p.amount) : "",
      usual: typeof p.usual === "number" ? formatINR(p.usual) : "",
      category: String(p.category ?? ""),
    });
  }
  const link = (a: AlertRow) => (a.type === "shopping_open" ? "/entries/shopping" : a.type.startsWith("expense_high") ? `/entries/expenses?date=${a.business_date}` : `/entries/close/${a.business_date}`);

  async function markSeen(ids?: number[]) {
    await api("/alerts/seen", { method: "POST", json: { ids } }).catch(() => {});
    res.reload();
  }
  const unseen = res.data?.alerts.filter((a) => !a.seen_at) ?? [];

  return (
    <div className="page">
      <PageHead
        title={t("alerts.title")}
        action={unseen.length > 0 ? <button className="btn small" onClick={() => markSeen()}>{t("alerts.mark_all")}</button> : undefined}
      />
      {res.error ? <ErrorNote error={res.error} /> : !res.data ? <Loading /> : (
        <div className="card flush list">
          {res.data.alerts.length === 0 && <Empty>{t("alerts.empty")}</Empty>}
          {res.data.alerts.map((a) => (
            <div className="row" key={a.id} style={{ opacity: a.seen_at ? 0.55 : 1 }}>
              <span className={`check ${a.severity === "critical" ? "bad" : a.severity === "warn" ? "warn" : ""}`} style={{ padding: 8 }}>
                <Icon name={a.type === "shopping_open" ? "cart" : a.type.startsWith("expense") ? "receipt" : "alert"} />
              </span>
              <Link to={link(a)} className="grow">
                <strong>{text(a)}</strong>
              </Link>
              {!a.seen_at && (
                <button className="btn small" onClick={() => markSeen([a.id])} aria-label={t("alerts.mark_seen")}>
                  <Icon name="check" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
