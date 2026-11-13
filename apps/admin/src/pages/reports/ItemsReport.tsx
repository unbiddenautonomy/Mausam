import { formatINR } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Stat } from "../../components/ui";
import { BarList, ReportFrame, type Range } from "./common";

interface Item { item: string; category: string | null; qty: number; amount: number; days: number }

export function ItemsReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.items")} desc={t("reports.items_desc")}>
      {(days) => <Body days={days} />}
    </ReportFrame>
  );
}

const qtyFmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

function Body({ days }: { days: Range }) {
  const t = useSession().t;
  const res = useApi<{ days_with_data: number; items: Item[]; categories: { category: string; amount: number }[] }>(`/analytics/items?days=${days}`);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const { items, categories, days_with_data } = res.data;
  if (items.length === 0) return <Empty>{t("reports.no_pos")}</Empty>;
  const total = items.reduce((s, i) => s + i.amount, 0);
  const top = items.slice(0, 15);
  const slow = [...items].filter((i) => i.days >= Math.min(3, days_with_data)).sort((a, b) => a.qty - b.qty).slice(0, 8);
  return (
    <>
      <div className="stats">
        <Stat hero label={t("reports.item_sales")} value={formatINR(total)} delta={t("reports.days_data", { n: days_with_data })} />
        <Stat label={t("reports.items_count")} value={items.length} />
        <Stat label={t("reports.top_item")} value={top[0].item} delta={formatINR(top[0].amount)} />
      </div>
      <div className="cols">
        <section className="form">
          <h2>{t("reports.top_by_sales")}</h2>
          <BarList total={total} rows={top.map((i) => ({ key: i.item, label: i.item, amount: i.amount, sub: `${qtyFmt(i.qty)} ${t("reports.sold")}` }))} />
        </section>
        <div className="form">
          {categories.length > 1 && (
            <section className="form">
              <h2>{t("reports.by_category")}</h2>
              <BarList total={total} rows={categories.map((c) => ({ key: c.category, label: c.category, amount: c.amount }))} />
            </section>
          )}
          {slow.length > 0 && items.length > 10 && (
            <section className="form">
              <h2>{t("reports.slow_items")}</h2>
              <div className="card flush list">
                {slow.map((i) => (
                  <div className="row" key={i.item}>
                    <span className="grow">{i.item}</span>
                    <span className="muted small">{qtyFmt(i.qty)} {t("reports.sold")}</span>
                    <span className="amount">{formatINR(i.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      <details className="table-view">
        <summary>{t("reports.all_items")} ({items.length})</summary>
        <table className="data">
          <thead><tr><th>{t("pos.col_item")}</th><th>{t("pos.col_category")}</th><th className="r">{t("reports.qty")}</th><th className="r">{t("pos.col_amount")}</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.item}><td>{i.item}</td><td>{i.category ?? "—"}</td><td className="r">{qtyFmt(i.qty)}</td><td className="r">{formatINR(i.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
