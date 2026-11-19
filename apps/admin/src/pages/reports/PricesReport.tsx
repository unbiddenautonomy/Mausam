import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDay, formatINR, formatINRShort } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { Empty, ErrorNote, Loading, Pill } from "../../components/ui";
import { axisTick, ChartTooltip, ReportFrame, shortDay, type Period } from "./common";

interface PriceItem { item: string; unit: string | null; points: { date: string; rate: number; source: string }[]; first: number; last: number; min: number; max: number; change: number }

export function PricesReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.prices")} desc={t("reports.prices_desc")}>
      {(p) => <Body p={p} />}
    </ReportFrame>
  );
}

function Body({ p }: { p: Period }) {
  const t = useSession().t;
  const res = useApi<{ items: PriceItem[] }>(`/analytics/prices?${p.q}`);
  const [open, setOpen] = useState<string | null>(null);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  if (res.data.items.length === 0) return <Empty>{t("reports.no_prices")}</Empty>;
  return (
    <div className="card flush list">
      {res.data.items.map((p) => {
        const key = `${p.item}|${p.unit}`;
        const pctChange = Math.round(p.change * 100);
        const isOpen = open === key;
        return (
          <div key={key}>
            <button className="row as-button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
              <span className="grow">
                <strong className="ellipsis">{p.item}</strong>
                <span className="muted small">
                  {formatINR(p.min)} – {formatINR(p.max)} · {t("reports.times_bought", { n: p.points.length })}
                </span>
              </span>
              {p.points.length > 1 && pctChange !== 0 && (
                <Pill tone={pctChange >= 10 ? "warn" : undefined}>{pctChange > 0 ? "+" : ""}{pctChange}%</Pill>
              )}
              <span className="amount">{formatINR(p.last)}<span className="muted small">/{p.unit ?? "—"}</span></span>
              <Icon name="chevron" className="chev" />
            </button>
            {isOpen && (
              <div style={{ padding: "0 16px 16px" }}>
                {p.points.length > 1 && (
                  <div className="chart" style={{ height: 200 }}>
                    <ResponsiveContainer>
                      <LineChart data={p.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--series-grid)" />
                        <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                        <YAxis tickFormatter={formatINRShort} tick={axisTick} axisLine={false} tickLine={false} width={56} domain={["auto", "auto"]} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line dataKey="rate" name={`${p.item} / ${p.unit ?? ""}`} stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--series-1)" }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <table className="data">
                  <thead><tr><th>{t("common.date")}</th><th>{t("reports.from")}</th><th className="r">{t("reports.rate")}</th></tr></thead>
                  <tbody>
                    {[...p.points].reverse().map((pt, i) => (
                      <tr key={i}><td>{formatDay(pt.date)}</td><td>{pt.source || "—"}</td><td className="r">{formatINR(pt.rate)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
