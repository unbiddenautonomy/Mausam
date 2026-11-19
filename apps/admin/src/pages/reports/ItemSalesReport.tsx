import { useState } from "react";
import { businessDate, formatINR } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { BarList } from "./common";
import { DayStepper, Empty, ErrorNote, Loading, PageHead, Stat } from "../../components/ui";

interface Row { category: string; name: string; variation: string | null; qty: number; amount: number }

/** Item sales for one day, like the old POS's Item Sales Summary: each item and variation, grouped by category. */
export function ItemSalesReport() {
  const t = useSession().t;
  const [date, setDate] = useState(businessDate());
  const res = useApi<{ items: Row[] }>(`/reports/item-sales?date=${date}`);
  const today = businessDate();
  const items = res.data?.items ?? [];
  const cats = [...new Set(items.map((i) => i.category))];
  const catTotal = (c: string) => items.filter((i) => i.category === c).reduce((s, i) => s + i.amount, 0);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const qty = items.reduce((s, i) => s + i.qty, 0);
  const label = (i: Row) => (i.variation ? `${i.name} [${i.variation}]` : i.name);

  return (
    <div className="page">
      <PageHead title={t("reports.day_items")} subtitle={t("reports.day_items_desc")} back="/reports" />
      <DayStepper date={date} max={today} onChange={setDate} />
      {res.error ? <ErrorNote error={res.error} /> : !res.data ? <Loading /> : items.length === 0 ? <Empty>{t("bills.none")}</Empty> : (
        <>
          <div className="stats">
            <Stat hero label={t("reports.items_total")} value={formatINR(total)} delta={t("reports.items_qty", { n: qty })} />
          </div>
          <BarList total={total} rows={cats.map((c) => ({ key: c, label: c, amount: catTotal(c) }))} />
          {cats.map((c) => (
            <section key={c} className="form">
              <h2>{c}</h2>
              <div className="card flush">
                <table className="data">
                  <thead><tr><th>{t("reports.item")}</th><th className="r">{t("reports.qty")}</th><th className="r">{t("reports.amount")}</th></tr></thead>
                  <tbody>
                    {items.filter((i) => i.category === c).map((i) => (
                      <tr key={label(i)}><td>{label(i)}</td><td className="r">{i.qty}</td><td className="r">{formatINR(i.amount)}</td></tr>
                    ))}
                    <tr><td><strong>{t("reports.total")}</strong></td><td className="r"><strong>{items.filter((i) => i.category === c).reduce((s, i) => s + i.qty, 0)}</strong></td><td className="r"><strong>{formatINR(catTotal(c))}</strong></td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <p className="muted small">{t("reports.item_sales_note")}</p>
        </>
      )}
    </div>
  );
}
