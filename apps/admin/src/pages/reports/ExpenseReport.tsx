import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateRange, formatINR, formatINRShort } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Empty, ErrorNote, Loading, Stat } from "../../components/ui";
import { CategoryBars } from "../Today";
import { axisTick, ChartTooltip, ReportFrame, shortDay, type Range } from "./common";

interface Row {
  business_date: string;
  key: string;
  name: string;
  name_hi: string | null;
  name_kn: string | null;
  amount: number;
  no_receipt: number;
}

export function ExpenseReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.expenses")} desc={t("reports.expenses_desc")}>
      {(days) => <Body days={days} />}
    </ReportFrame>
  );
}

function Body({ days }: { days: Range }) {
  const { t, lang } = useSession();
  const res = useApi<{ from: string; to: string; rows: Row[] }>(`/reports/expenses?days=${days}`);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const rows = res.data.rows;
  if (rows.length === 0) return <Empty>{t("reports.no_data")}</Empty>;

  const cats = new Map<string, { key: string; name: string; name_hi: string | null; name_kn: string | null; amount: number }>();
  const perDay = new Map<string, number>();
  let noReceipt = 0;
  for (const r of rows) {
    const c = cats.get(r.key) ?? { key: r.key, name: r.name, name_hi: r.name_hi, name_kn: r.name_kn, amount: 0 };
    c.amount += r.amount;
    cats.set(r.key, c);
    perDay.set(r.business_date, (perDay.get(r.business_date) ?? 0) + r.amount);
    noReceipt += r.no_receipt;
  }
  const byCat = [...cats.values()].sort((a, b) => b.amount - a.amount);
  const total = byCat.reduce((s, c) => s + c.amount, 0);
  const daily = dateRange(res.data.from, res.data.to).map((d) => ({ date: d, amount: perDay.get(d) ?? null }));
  const name = t("home.expenses");

  return (
    <>
      <div className="stats">
        <Stat hero label={t("reports.period_total")} value={formatINR(total)} />
        <Stat label={t("reports.daily_avg")} value={formatINR(Math.round(total / Math.max(1, perDay.size) / 100) * 100)} />
        <Stat label={t("expense.no_receipt")} value={formatINR(noReceipt)} delta={`${Math.round((noReceipt / total) * 100)}%`} />
      </div>
      <div className="cols">
        <section className="section">
          <h2>{t("home.by_category")}</h2>
          <CategoryBars rows={byCat} lang={lang} />
        </section>
        <section className="section">
          <h2>{t("reports.daily")}</h2>
          <div className="card chart-card">
            <div className="chart" style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--series-grid)" />
                  <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
                  <Bar dataKey="amount" name={name} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
