import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateRange, formatHour, formatINR, formatINRShort } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Stat } from "../../components/ui";
import { axisTick, BarList, ChartTooltip, hourSpan, ReportFrame, shortDay, type Period } from "./common";

type Kind = "dine_in" | "parcel";
const KINDS: Kind[] = ["dine_in", "parcel"];
const COLORS: Record<Kind, string> = { dine_in: "var(--series-1)", parcel: "var(--series-2)" };
interface Row { order_type: Kind; bills: number; sales: number }
interface Res {
  from: string; to: string;
  days: (Row & { business_date: string })[];
  hours: (Row & { hour: number })[];
  items: { order_type: Kind; name: string; qty: number; amount: number }[];
}

/** Dine-in against parcel: how much of the business is each, when, and what sells. */
export function OrderTypesReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.order_types")} desc={t("reports.order_types_desc")}>
      {(p) => <Body p={p} />}
    </ReportFrame>
  );
}

function Body({ p }: { p: Period }) {
  const t = useSession().t;
  const res = useApi<Res>(`/reports/order-types?${p.q}`);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const d = res.data;
  const names: Record<Kind, string> = { dine_in: t("pos.col_dine_in"), parcel: t("pos.col_parcel") };
  const total = (k: Kind, f: "sales" | "bills") => d.days.filter((r) => r.order_type === k).reduce((s, r) => s + r[f], 0);
  const allSales = total("dine_in", "sales") + total("parcel", "sales");
  if (allSales === 0) return <Empty>{t("reports.order_types_none")}</Empty>;

  const share = (k: Kind) => `${Math.round((total(k, "sales") / allSales) * 100)}% ${t("reports.of_sales")}`;
  const avg = (k: Kind) => (total(k, "bills") ? Math.round(total(k, "sales") / total(k, "bills")) : 0);
  const pivot = <R extends Row, K>(rows: R[], keyOf: (r: R) => K, keys: K[]) => {
    const m = new Map<K, Record<Kind, number>>(keys.map((k) => [k, { dine_in: 0, parcel: 0 }]));
    for (const r of rows) {
      const slot = m.get(keyOf(r));
      if (slot) slot[r.order_type] += r.sales;
    }
    return keys.map((k) => ({ key: k, ...m.get(k)! }));
  };
  const daily = pivot(d.days, (r) => r.business_date, dateRange(d.from, d.to));
  const hourKeys = hourSpan(d.hours.map((h) => h.hour));
  const hourly = pivot(d.hours, (r) => r.hour, hourKeys);
  const hourLabel = (h: number) => formatHour(h);

  const legend = (
    <div className="legend">
      {KINDS.map((k) => <span key={k}><i className="box" style={{ background: COLORS[k] }} />{names[k]}</span>)}
    </div>
  );
  const bars = KINDS.map((k, i) => (
    <Bar key={k} dataKey={k} name={names[k]} stackId="a" fill={COLORS[k]} stroke="var(--surface)" strokeWidth={2}
      radius={i === KINDS.length - 1 ? [4, 4, 0, 0] : undefined} maxBarSize={28} isAnimationActive={false} />
  ));

  return (
    <>
      <div className="stats">
        {KINDS.map((k) => (
          <Stat key={k} label={names[k]} value={formatINR(total(k, "sales"))}
            delta={`${share(k)} · ${t("bills.count", { n: total(k, "bills") })} · ${t("reports.avg_bill", { amount: formatINR(avg(k)) })}`} />
        ))}
      </div>

      <div className="card chart-card">
        {legend}
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--series-grid)" />
              <XAxis dataKey="key" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              {bars}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {hourly.length > 0 && (
        <section className="form">
          <h2>{t("reports.order_types_hours")}</h2>
          <p className="muted small" style={{ margin: 0 }}>{t("reports.order_types_hours_help")}</p>
          <div className="card chart-card">
            {legend}
            <div className="chart" style={{ height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={hourly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="15%">
                  <CartesianGrid vertical={false} stroke="var(--series-grid)" />
                  <XAxis dataKey="key" tickFormatter={hourLabel} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<ChartTooltip labelFmt={(l) => hourLabel(Number(l))} />} cursor={{ fill: "var(--surface-2)" }} />
                  {bars}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      <div className="grid-2">
        {KINDS.map((k) => {
          const rows = d.items.filter((r) => r.order_type === k);
          return (
            <section className="form" key={k}>
              <h2>{t("reports.top_items_for", { kind: names[k] })}</h2>
              {rows.length === 0 ? <Empty>—</Empty> : (
                <BarList total={total(k, "sales")} rows={rows.map((r) => ({ key: r.name, label: r.name, amount: r.amount, sub: `× ${r.qty}` }))} />
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
