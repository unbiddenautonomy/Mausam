import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateRange, formatDay, formatINR, formatINRShort } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Pill, Stat } from "../../components/ui";
import { axisTick, ChartTooltip, ReportFrame, shortDay, type Range } from "./common";

interface Totals { cancelled: number; cancelled_n: number; discount: number; discount_n: number }
interface LeakBill {
  bill_no: string; business_date: string; closed_at: string; order_type: "dine_in" | "parcel"; table_name: string | null; token: number | null;
  status: "paid" | "cancelled"; total: number; subtotal: number; discount: number; cancel_reason: string | null; by_name: string | null; waiter_name: string | null;
}
interface Res { from: string; to: string; sales: number; paid_bills: number; days: (Totals & { business_date: string })[]; people: (Totals & { name: string })[]; bills: LeakBill[] }

/** Cancelled bills and discounts: where money can go missing at the counter. */
export function CancellationsReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.leaks")} desc={t("reports.leaks_desc")}>
      {(days) => <Body days={days} />}
    </ReportFrame>
  );
}

function Body({ days }: { days: Range }) {
  const t = useSession().t;
  const res = useApi<Res>(`/reports/leaks?days=${days}`);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const d = res.data;
  const sum = (k: keyof Totals) => d.days.reduce((s, r) => s + r[k], 0);
  const cancelled = sum("cancelled");
  const discount = sum("discount");
  const pct = (v: number) => (d.sales > 0 ? `${Math.round((v / d.sales) * 1000) / 10}% ${t("reports.of_sales")}` : "");
  const names = { cancelled: t("reports.cancelled"), discount: t("reports.discounts") };
  const colors = { cancelled: "var(--series-1)", discount: "var(--series-2)" };
  const byDate = new Map(d.days.map((r) => [r.business_date, r]));
  const rows = dateRange(d.from, d.to).map((date) => ({ date, cancelled: byDate.get(date)?.cancelled ?? 0, discount: byDate.get(date)?.discount ?? 0 }));
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

  return (
    <>
      <div className="stats">
        <Stat hero label={names.cancelled} value={formatINR(cancelled)} delta={`${t("bills.count", { n: sum("cancelled_n") })}${pct(cancelled) ? ` · ${pct(cancelled)}` : ""}`} />
        <Stat label={names.discount} value={formatINR(discount)} delta={`${t("bills.count", { n: sum("discount_n") })}${pct(discount) ? ` · ${pct(discount)}` : ""}`} />
      </div>
      {d.bills.length === 0 ? <Empty>{t("reports.leaks_none")}</Empty> : (
        <>
          <div className="card chart-card">
            <div className="legend">
              {(["cancelled", "discount"] as const).map((k) => <span key={k}><i className="box" style={{ background: colors[k] }} />{names[k]}</span>)}
            </div>
            <div className="chart">
              <ResponsiveContainer>
                <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="var(--series-grid)" />
                  <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
                  <Bar dataKey="cancelled" name={names.cancelled} stackId="a" fill={colors.cancelled} stroke="var(--surface)" strokeWidth={2} maxBarSize={28} />
                  <Bar dataKey="discount" name={names.discount} stackId="a" fill={colors.discount} stroke="var(--surface)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <section className="form">
            <h2>{t("reports.by_person")}</h2>
            <p className="muted small" style={{ margin: 0 }}>{t("reports.by_person_help")}</p>
            <div className="card flush">
              <table className="data">
                <thead><tr><th></th><th className="r">{names.cancelled}</th><th className="r">{names.discount}</th></tr></thead>
                <tbody>
                  {d.people.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="r">{formatINR(p.cancelled)} <span className="faint">({p.cancelled_n})</span></td>
                      <td className="r">{formatINR(p.discount)} <span className="faint">({p.discount_n})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="form">
            <h2>{t("reports.leak_bills")}</h2>
            <div className="card flush list">
              {d.bills.map((b) => (
                <div key={b.bill_no} className="row">
                  <span className="grow">
                    <strong>{b.bill_no} · {b.order_type === "parcel" ? `${t("bills.parcel")} #${b.token ?? ""}` : b.table_name ?? `#${b.token ?? ""}`}</strong>
                    <span className="muted small">
                      {formatDay(b.business_date)} {time(b.closed_at)}{b.by_name ? ` · ${b.by_name}` : ""}{b.waiter_name ? ` · ${b.waiter_name}` : ""}
                    </span>
                    {b.status === "cancelled"
                      ? <span className="small">{t("reports.reason")}: {b.cancel_reason || "—"}</span>
                      : <span className="small">{t("reports.discount_of", { amount: formatINR(b.discount), bill: formatINR(b.subtotal) })}</span>}
                  </span>
                  {b.status === "cancelled" ? <Pill tone="bad">{t("bills.cancelled_one")}</Pill> : <Pill tone="warn">{t("reports.discount_one")}</Pill>}
                  <span className="amount">{formatINR(b.status === "cancelled" ? b.total : b.discount)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
