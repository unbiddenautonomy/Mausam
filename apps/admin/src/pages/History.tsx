import { Link } from "react-router";
import { formatDay, formatINR, type CloseFlag } from "@mausam/shared";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Icon } from "../components/Icon";
import { Empty, ErrorNote, Loading, PageHead, Pill } from "../components/ui";

interface Row {
  business_date: string;
  total_counter: number;
  cash: number;
  online: number;
  expenses: number;
  flags: CloseFlag[];
  late: boolean;
  submitted_by_name: string;
}

export function History() {
  const t = useSession().t;
  const res = useApi<{ closes: Row[] }>("/closes?limit=90");
  return (
    <div className="page">
      <PageHead title={t("entries.history")} back="/entries" />
      {res.error ? <ErrorNote error={res.error} /> : !res.data ? <Loading /> : (
        <div className="card flush list">
          {res.data.closes.length === 0 && <Empty>{t("common.none_yet")}</Empty>}
          {res.data.closes.map((c) => {
            const serious = c.flags.filter((f) => f.code !== "no_memo_photo" && f.code !== "late").length;
            return (
              <Link key={c.business_date} to={`/entries/close/${c.business_date}`} className="row row-link">
                <span className="grow">
                  <strong>{formatDay(c.business_date)}</strong>
                  <span className="muted small num">
                    {t("common.cash")} {formatINR(c.cash)} · {t("common.online")} {formatINR(c.online)} · {t("home.expenses")} {formatINR(c.expenses)}
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {serious > 0 && <Pill tone="bad" icon="alert">{serious}</Pill>}
                    {c.late && <Pill tone="warn">{t("status.late")}</Pill>}
                  </span>
                </span>
                <span className="amount">{formatINR(c.total_counter)}</span>
                <Icon name="chevron" className="chev" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
