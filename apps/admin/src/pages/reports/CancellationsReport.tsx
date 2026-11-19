import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateRange, formatDay, formatINR, formatINRShort, formatTime } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { billFlagText, discountReasonText, Empty, ErrorNote, Loading, Pill, Stat } from "../../components/ui";
import { axisTick, ChartTooltip, ReportFrame, shortDay, type Period } from "./common";

interface Totals { cancelled: number; cancelled_n: number; discount: number; discount_n: number }
interface LeakBill {
  bill_no: string; business_date: string; closed_at: string; order_type: "dine_in" | "parcel"; table_name: string | null; token: number | null;
  status: "paid" | "cancelled"; total: number; subtotal: number; discount: number; cancel_reason: string | null; by_name: string | null; waiter_name: string | null;
  discount_reason?: string | null; approved_by_name?: string | null; flags?: string | null;
}
/** An item taken off after the kitchen got it or the bill was printed. `all_*` are totals for the whole period. */
interface Removed {
  bill_no: string; business_date: string; bill_status: "paid" | "cancelled"; name: string; variation: string | null; qty: number; price: number; amount: number;
  stage: "kitchen" | "billed"; removed_at: string; by_name: string | null; all_amount: number; all_n: number;
}
interface Res {
  from: string; to: string; sales: number; paid_bills: number; days: (Totals & { business_date: string })[]; people: (Totals & { name: string })[]; bills: LeakBill[];
  voids?: Removed[];
  void_people?: { name: string; removed: number; removed_n: number }[];
}

/** Cancelled bills, discounts and items taken off after printing: where money can go missing at the counter. */
export function CancellationsReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.leaks")} desc={t("reports.leaks_desc")}>
      {(p) => <Body p={p} />}
    </ReportFrame>
  );
}

function Body({ p }: { p: Period }) {
  const t = useSession().t;
  const res = useApi<Res>(`/reports/leaks?${p.q}`);
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
  const voids = d.voids ?? [];
  const removed = voids[0]?.all_amount ?? 0;
  // People who cancelled or discounted, and people who took items off: one row each, by name.
  const blank = { cancelled: 0, cancelled_n: 0, discount: 0, discount_n: 0, removed: 0, removed_n: 0 };
  const people = new Map(d.people.map((p) => [p.name, { ...blank, ...p }]));
  for (const v of d.void_people ?? []) people.set(v.name, { ...blank, ...people.get(v.name), ...v });
  const time = (iso: string) => formatTime(new Date(iso));

  return (
    <>
      <div className="stats">
        <Stat hero label={names.cancelled} value={formatINR(cancelled)} delta={`${t("bills.count", { n: sum("cancelled_n") })}${pct(cancelled) ? ` · ${pct(cancelled)}` : ""}`} />
        <Stat label={names.discount} value={formatINR(discount)} delta={`${t("bills.count", { n: sum("discount_n") })}${pct(discount) ? ` · ${pct(discount)}` : ""}`} />
        {voids.length > 0 && <Stat label={t("reports.removed")} value={formatINR(removed)} delta={pct(removed)} />}
      </div>
      {d.bills.length === 0 && voids.length === 0 ? <Empty>{t("reports.leaks_none")}</Empty> : (
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
                <thead>
                  <tr>
                    <th></th><th className="r">{names.cancelled}</th><th className="r">{names.discount}</th>
                    {voids.length > 0 && <th className="r">{t("reports.removed")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {[...people.values()].map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="r">{formatINR(p.cancelled)} <span className="faint">({p.cancelled_n})</span></td>
                      <td className="r">{formatINR(p.discount)} <span className="faint">({p.discount_n})</span></td>
                      {voids.length > 0 && <td className="r">{formatINR(p.removed)} <span className="faint">({p.removed_n})</span></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {d.bills.length > 0 && <section className="form">
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
                      : b.discount > 0 && (
                        <span className="small">
                          {t("reports.discount_of", { amount: formatINR(b.discount), bill: formatINR(b.subtotal) })}
                          {" · "}{b.discount_reason ? discountReasonText(t, b.discount_reason) : <span className="faint">{t("reports.no_reason")}</span>}
                          {b.approved_by_name ? ` · ${t("reports.approved_by", { name: b.approved_by_name })}` : ""}
                        </span>
                      )}
                    {b.flags && <span className="small" style={{ color: "var(--warn)" }}>{billFlagText(t, b.flags)}</span>}
                  </span>
                  {b.status === "cancelled" ? <Pill tone="bad">{t("bills.cancelled_one")}</Pill>
                    : b.discount > 0 ? <Pill tone="warn">{t("reports.discount_one")}</Pill> : <Pill tone="warn">{t("reports.flagged")}</Pill>}
                  <span className="amount">{formatINR(b.status === "cancelled" ? b.total : b.discount > 0 ? b.discount : b.total)}</span>
                </div>
              ))}
            </div>
          </section>}
          {voids.length > 0 && (
            <section className="form">
              <h2>{t("reports.removed")}</h2>
              <p className="muted small" style={{ margin: 0 }}>{t("reports.removed_help")}</p>
              <div className="card flush list">
                {voids.map((v, i) => (
                  <div key={`${v.bill_no}-${i}`} className="row">
                    <span className="grow">
                      <strong>{v.qty} × {v.name}{v.variation ? ` [${v.variation}]` : ""}</strong>
                      <span className="muted small">
                        {v.bill_no} · {formatDay(v.business_date)} {time(v.removed_at)}{v.by_name ? ` · ${v.by_name}` : ""}
                      </span>
                    </span>
                    <Pill tone={v.stage === "billed" ? "bad" : "warn"}>{t(v.stage === "billed" ? "reports.stage_billed" : "reports.stage_kitchen")}</Pill>
                    <span className="amount">{formatINR(v.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
