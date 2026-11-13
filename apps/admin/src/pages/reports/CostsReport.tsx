import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDay, formatINR } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Stat } from "../../components/ui";
import { axisTick, BarList, ChartTooltip, pctFmt, ReportFrame, shortDay, type Range } from "./common";

interface Totals { sales: number; expenses: number; food: number; bills: number; deliveries: number; wages: number; left: number }
interface Week { from: string; to: string; sales: number; food: number; wages: number; left: number }

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export function CostsReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.costs")} desc={t("reports.costs_desc")}>
      {(days) => <Body days={days} />}
    </ReportFrame>
  );
}

function Body({ days }: { days: Range }) {
  const t = useSession().t;
  const res = useApi<{ totals: Totals; weeks: Week[] }>(`/analytics/costs?days=${days}`);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const s = res.data.totals;
  if (s.sales === 0) return <Empty>{t("reports.no_data")}</Empty>;
  const other = s.expenses + s.deliveries - s.food;
  const food = pct(s.food, s.sales)!;
  const series = res.data.weeks
    .filter((w) => w.sales > 0)
    .map((w) => ({ date: w.to, food: pct(w.food, w.sales), wages: pct(w.wages, w.sales) }));
  const foodName = t("reports.food_pct");
  const wagesName = t("reports.wages_pct");
  const weekLabel = (d: string) => t("reports.week_to", { date: formatDay(d) });

  return (
    <>
      <div className="stats">
        <Stat hero label={t("reports.left")} value={formatINR(s.left)} delta={pctFmt(pct(s.left, s.sales)!)} />
        <Stat label={t("month.sales")} value={formatINR(s.sales)} />
        <Stat label={foodName} value={pctFmt(food)} delta={t("reports.food_note")} />
        <Stat label={wagesName} value={pctFmt(pct(s.wages, s.sales)!)} />
      </div>
      <section className="form">
        <h2>{t("reports.where_money_went")}</h2>
        <BarList
          total={s.sales}
          rows={[
            { key: "food", label: t("reports.food_cost"), amount: s.food },
            { key: "wages", label: t("reports.wages"), amount: s.wages },
            { key: "other", label: t("reports.other"), amount: other },
            { key: "bills", label: t("month.bills_total"), amount: s.bills },
            { key: "left", label: t("reports.left"), amount: s.left },
          ]}
        />
        <p className="muted small" style={{ margin: 0 }}>{t("reports.costs_note")}</p>
      </section>
      {series.length >= 2 && (
        <section className="form">
          <h2>{t("reports.weekly")}</h2>
          <div className="card chart-card">
            <div className="legend">
              <span><i className="box" style={{ background: "var(--series-1)" }} />{foodName}</span>
              <span><i className="box" style={{ background: "var(--series-2)" }} />{wagesName}</span>
            </div>
            <div className="chart">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--series-grid)" />
                  <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={axisTick} axisLine={false} tickLine={false} width={44} domain={[0, "auto"]} />
                  <Tooltip content={<ChartTooltip fmt={pctFmt} labelFmt={weekLabel} />} />
                  <Line dataKey="food" name={foodName} stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--series-1)" }} isAnimationActive={false} />
                  <Line dataKey="wages" name={wagesName} stroke="var(--series-2)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--series-2)" }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <details className="table-view">
              <summary>Table</summary>
              <table className="data">
                <thead><tr><th>{t("reports.week")}</th><th className="r">{foodName}</th><th className="r">{wagesName}</th></tr></thead>
                <tbody>
                  {[...series].reverse().map((r) => (
                    <tr key={r.date}><td>{weekLabel(r.date)}</td><td className="r">{r.food === null ? "—" : pctFmt(r.food)}</td><td className="r">{r.wages === null ? "—" : pctFmt(r.wages)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        </section>
      )}
    </>
  );
}
