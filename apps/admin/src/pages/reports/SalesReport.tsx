import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateRange, formatDay, formatHour, formatINR, formatINRShort, type Lang } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Stat } from "../../components/ui";
import { axisTick, ChartTooltip, hourSpan, CsvButton, csvRupees, ReportFrame, shortDay, widen, type Period } from "./common";

export interface DailyRow {
  business_date: string;
  total_counter: number;
  cash: number;
  online: number;
  expenses: number;
  late: boolean;
  submitted_at: string | null;
  /** No closing yet: the total comes from POS bills. */
  from_pos?: boolean;
}

export function useDaily(p: Period) {
  return useApi<{ from: string; to: string; days: DailyRow[] }>(`/reports/daily?${p.q}`);
}

export function SalesReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.sales")} desc={t("reports.sales_desc")}>
      {(p) => (
        <>
          <SalesBody p={p} />
          <Weekdays p={p} />
          <BusyHours p={p} />
        </>
      )}
    </ReportFrame>
  );
}

function SalesBody({ p }: { p: Period }) {
  const t = useSession().t;
  // Fetch 6 extra days so the 7-day average is complete from the first day shown.
  const res = useDaily(widen(p, 6));
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const byDate = new Map(res.data.days.map((d) => [d.business_date, d]));
  const all = dateRange(res.data.from, res.data.to).map((d) => ({ date: d, total: byDate.get(d)?.total_counter ?? null, fromPos: !!byDate.get(d)?.from_pos }));
  const series = all.map((row, i) => {
    const window = all.slice(Math.max(0, i - 6), i + 1).map((r) => r.total).filter((v): v is number => v !== null);
    return { ...row, avg: window.length >= 4 ? Math.round(window.reduce((a, b) => a + b, 0) / window.length / 100) * 100 : null };
  });
  const shown = series.slice(-p.days);
  const filled = shown.filter((r) => r.total !== null) as { date: string; total: number; fromPos: boolean }[];
  const posOnly = filled.filter((r) => r.fromPos).length;
  if (filled.length === 0) return <Empty>{t("reports.no_data")}</Empty>;
  const sum = filled.reduce((s, r) => s + r.total, 0);
  const best = filled.reduce((a, b) => (b.total > a.total ? b : a));
  const dailyName = t("reports.daily");
  const avgName = t("reports.avg7");

  return (
    <>
      <div className="stats">
        <Stat hero label={t("reports.period_total")} value={formatINR(sum)} delta={posOnly ? `${posOnly} × ${t("reports.not_closed_short")}` : undefined} />
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
              <Bar dataKey="total" name={dailyName} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28}>
                {shown.map((r) => <Cell key={r.date} fill="var(--series-1)" fillOpacity={r.fromPos ? 0.45 : 1} />)}
              </Bar>
              <Line dataKey="avg" name={avgName} stroke="var(--text-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls type="monotone" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <details className="table-view">
          <summary>{t("common.table_view")}</summary>
          <CsvButton
            name={`sales-${p.from}-to-${p.to}`}
            rows={() => [[t("common.date"), dailyName, avgName, ""], ...shown.map((r) => [r.date, csvRupees(r.total), csvRupees(r.avg), r.fromPos ? t("reports.not_closed") : ""])]}
          />
          <table className="data">
            <thead><tr><th>{t("common.date")}</th><th className="r">{dailyName}</th><th className="r">{avgName}</th></tr></thead>
            <tbody>
              {[...shown].reverse().map((r) => (
                <tr key={r.date}>
                  <td>{formatDay(r.date)}{r.fromPos && <div className="small muted">{t("reports.not_closed")}</div>}</td>
                  <td className="r">{formatINR(r.total)}</td>
                  <td className="r">{formatINR(r.avg)}</td>
                </tr>
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
function Weekdays({ p }: { p: Period }) {
  const { t, lang } = useSession();
  const res = useApi<{ weekdays: { weekday: number; avg: number | null; n: number }[] }>(`/analytics/weekdays?${(p.days < 28 ? widen(p, 28 - p.days) : p).q}`);
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
          <summary>{t("common.table_view")}</summary>
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

/** Busy hours: average sales in each hour the restaurant is open, from POS bills. */
function BusyHours({ p }: { p: Period }) {
  const t = useSession().t;
  const res = useApi<{ days_with_bills: number; hours: { hour: number; avg_sales: number; avg_bills: number }[] }>(`/analytics/hours?${p.q}`);
  if (!res.data || res.data.days_with_bills < 1 || !res.data.hours.length) return null;
  const label = (h: number) => formatHour(h);
  // Every hour from the first to the last with sales (5am to 5am), so quiet hours show as gaps rather than disappearing.
  const byHour = new Map(res.data.hours.map((h) => [h.hour, h]));
  const rows = hourSpan(res.data.hours.map((h) => h.hour)).map((h) => {
    return { label: label(h), avg_sales: byHour.get(h)?.avg_sales ?? 0, avg_bills: byHour.get(h)?.avg_bills ?? 0 };
  });
  const avgName = t("reports.hour_avg");
  return (
    <section className="form">
      <h2>{t("reports.busy_hours")}</h2>
      <p className="muted small" style={{ margin: 0 }}>{t("reports.busy_hours_desc", { n: res.data.days_with_bills })}</p>
      <div className="card chart-card">
        <div className="chart" style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="15%">
              <CartesianGrid vertical={false} stroke="var(--series-grid)" />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip labelFmt={(l) => l} />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="avg_sales" name={avgName} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="table-view">
          <summary>{t("common.table_view")}</summary>
          <table className="data">
            <thead><tr><th></th><th className="r">{avgName}</th><th className="r">{t("reports.hour_bills")}</th></tr></thead>
            <tbody>
              {rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="r">{formatINR(r.avg_sales)}</td><td className="r">{r.avg_bills}</td></tr>)}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
