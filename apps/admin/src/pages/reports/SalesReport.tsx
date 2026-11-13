import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateRange, formatDay, formatINR, formatINRShort, type Lang } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Stat } from "../../components/ui";
import { axisTick, ChartTooltip, ReportFrame, shortDay, type Range } from "./common";

export interface DailyRow {
  business_date: string;
  total_counter: number;
  cash: number;
  online: number;
  expenses: number;
  late: boolean;
  submitted_at: string;
}

export function useDaily(days: Range) {
  return useApi<{ from: string; to: string; days: DailyRow[] }>(`/reports/daily?days=${days}`);
}

export function SalesReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.sales")} desc={t("reports.sales_desc")}>
      {(days) => (
        <>
          <SalesBody days={days} />
          <Weekdays days={days} />
        </>
      )}
    </ReportFrame>
  );
}

function SalesBody({ days }: { days: Range }) {
  const t = useSession().t;
  // Fetch 6 extra days so the 7-day average is complete from the first day shown.
  const res = useDaily(String(Number(days) + 6) as Range);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const byDate = new Map(res.data.days.map((d) => [d.business_date, d]));
  const all = dateRange(res.data.from, res.data.to).map((d) => ({ date: d, total: byDate.get(d)?.total_counter ?? null }));
  const series = all.map((row, i) => {
    const window = all.slice(Math.max(0, i - 6), i + 1).map((r) => r.total).filter((v): v is number => v !== null);
    return { ...row, avg: window.length >= 4 ? Math.round(window.reduce((a, b) => a + b, 0) / window.length / 100) * 100 : null };
  });
  const shown = series.slice(-Number(days));
  const filled = shown.filter((r) => r.total !== null) as { date: string; total: number }[];
  if (filled.length === 0) return <Empty>{t("reports.no_data")}</Empty>;
  const sum = filled.reduce((s, r) => s + r.total, 0);
  const best = filled.reduce((a, b) => (b.total > a.total ? b : a));
  const dailyName = t("reports.daily");
  const avgName = t("reports.avg7");

  return (
    <>
      <div className="stats">
        <Stat hero label={t("reports.period_total")} value={formatINR(sum)} />
        <Stat label={t("reports.daily_avg")} value={formatINR(Math.round(sum / filled.length / 100) * 100)} />
        <Stat label={t("reports.best_day")} value={formatINR(best.total)} delta={formatDay(best.date)} />
      </div>
      <div className="card chart-card">
        <div className="legend">
          <span><i className="box" style={{ background: "var(--series-1)" }} />{dailyName}</span>
          <span><i className="dash" />{avgName}</span>
        </div>
        <div className="chart">
          <ResponsiveContainer>
            <ComposedChart data={shown} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--series-grid)" />
              <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="total" name={dailyName} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line dataKey="avg" name={avgName} stroke="var(--text-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls type="monotone" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <details className="table-view">
          <summary>Table</summary>
          <table className="data">
            <thead><tr><th>{t("common.date")}</th><th className="r">{dailyName}</th><th className="r">{avgName}</th></tr></thead>
            <tbody>
              {[...shown].reverse().map((r) => (
                <tr key={r.date}><td>{formatDay(r.date)}</td><td className="r">{formatINR(r.total)}</td><td className="r">{formatINR(r.avg)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </>
  );
}


const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

/** Average sales for each weekday, Monday first. */
function Weekdays({ days }: { days: Range }) {
  const { t, lang } = useSession();
  const res = useApi<{ weekdays: { weekday: number; avg: number | null; n: number }[] }>(`/analytics/weekdays?days=${days === "7" ? "28" : days}`);
  if (!res.data) return null;
  const f = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "short", timeZone: "UTC" });
  const name = (d: number) => f.format(new Date(Date.UTC(2026, 10, 1 + d)));
  const rows = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ ...res.data!.weekdays[d], label: name(d) }));
  if (rows.filter((r) => r.avg !== null).length < 3) return null;
  const avgName = t("reports.daily_avg");
  return (
    <section className="form">
      <h2>{t("reports.weekday")}</h2>
      <div className="card chart-card">
        <div className="chart" style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--series-grid)" />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip labelFmt={(l) => l} />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="avg" name={avgName} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="table-view">
          <summary>Table</summary>
          <table className="data">
            <thead><tr><th></th><th className="r">{avgName}</th><th className="r">{t("reports.days_counted")}</th></tr></thead>
            <tbody>
              {rows.map((r) => <tr key={r.weekday}><td>{r.label}</td><td className="r">{formatINR(r.avg)}</td><td className="r">{r.n}</td></tr>)}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
