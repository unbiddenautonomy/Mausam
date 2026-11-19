import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateRange, formatDay, formatINR, formatINRShort } from "@mausam/shared";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Stat } from "../../components/ui";
import { axisTick, ChartTooltip, CsvButton, csvRupees, ReportFrame, shortDay, type Period } from "./common";
import { useDaily } from "./SalesReport";

export function PaymentsReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.cash")} desc={t("reports.cash_desc")}>
      {(p) => <Body p={p} />}
    </ReportFrame>
  );
}

function Body({ p }: { p: Period }) {
  const t = useSession().t;
  const res = useDaily(p);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  // Only closed days: a closing splits the counter into cash, online and expenses; POS-only days don't.
  const days = res.data.days.filter((d) => !d.from_pos);
  if (days.length === 0) return <Empty>{t("reports.no_data")}</Empty>;
  const byDate = new Map(days.map((d) => [d.business_date, d]));
  // The three parts add up to the total counter, so they stack.
  const rows = dateRange(res.data.from, res.data.to).map((d) => {
    const r = byDate.get(d);
    return { date: d, cash: r?.cash ?? null, online: r?.online ?? null, expenses: r?.expenses ?? null };
  });
  const sum = (k: "cash" | "online" | "expenses") => days.reduce((s, r) => s + r[k], 0);
  const cash = sum("cash");
  const online = sum("online");
  const expenses = sum("expenses");
  const total = cash + online + expenses;
  const names = { cash: t("close.cash"), online: t("close.online"), expenses: t("close.expenses") };
  const colors = { cash: "var(--series-1)", online: "var(--series-2)", expenses: "var(--series-3)" };

  return (
    <>
      <div className="stats">
        <Stat label={names.cash} value={formatINR(cash)} delta={`${Math.round((cash / total) * 100)}%`} />
        <Stat label={names.online} value={formatINR(online)} delta={`${Math.round((online / total) * 100)}%`} />
        <Stat label={names.expenses} value={formatINR(expenses)} delta={`${Math.round((expenses / total) * 100)}%`} />
      </div>
      <div className="card chart-card">
        <div className="legend">
          {(["cash", "online", "expenses"] as const).map((k) => (
            <span key={k}><i className="box" style={{ background: colors[k] }} />{names[k]}</span>
          ))}
        </div>
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--series-grid)" />
              <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="cash" name={names.cash} stackId="a" fill={colors.cash} stroke="var(--surface)" strokeWidth={2} maxBarSize={28} />
              <Bar dataKey="online" name={names.online} stackId="a" fill={colors.online} stroke="var(--surface)" strokeWidth={2} maxBarSize={28} />
              <Bar dataKey="expenses" name={names.expenses} stackId="a" fill={colors.expenses} stroke="var(--surface)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="table-view">
          <summary>{t("common.table_view")}</summary>
          <CsvButton name={`payments-${p.from}-to-${p.to}`} rows={() => [[t("common.date"), names.cash, names.online, names.expenses], ...days.map((r) => [r.business_date, csvRupees(r.cash), csvRupees(r.online), csvRupees(r.expenses)])]} />
          <table className="data">
            <thead><tr><th>{t("common.date")}</th><th className="r">{names.cash}</th><th className="r">{names.online}</th><th className="r">{names.expenses}</th></tr></thead>
            <tbody>
              {[...days].reverse().map((r) => (
                <tr key={r.business_date}><td>{formatDay(r.business_date)}</td><td className="r">{formatINR(r.cash)}</td><td className="r">{formatINR(r.online)}</td><td className="r">{formatINR(r.expenses)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </>
  );
}
