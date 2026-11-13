import { useState, type ReactNode } from "react";
import { formatDay, formatINR } from "@mausam/shared";
import { useSession } from "../../lib/session";
import { PageHead, Segmented } from "../../components/ui";

export const RANGES = ["7", "30", "90"] as const;
export type Range = (typeof RANGES)[number];

/** Every report page has the same frame: title, one period control, then its content. */
export function ReportFrame({ title, desc, children }: { title: string; desc: string; children: (days: Range) => ReactNode }) {
  const t = useSession().t;
  const [days, setDays] = useState<Range>("30");
  return (
    <div className="page">
      <PageHead title={title} subtitle={desc} back="/reports" />
      <div style={{ maxWidth: 420 }}>
        <Segmented<Range> value={days} onChange={setDays} options={RANGES.map((r) => ({ value: r, label: t("reports.days", { n: r }) }))} />
      </div>
      {children(days)}
    </div>
  );
}

/** Tooltip body shared by all charts. `fmt` formats values (rupees by default), `labelFmt` the heading (a date by default). */
export function ChartTooltip({
  active, payload, label, fmt = formatINR, labelFmt = (l: string) => formatDay(l),
}: {
  active?: boolean; payload?: { name: string; value: number; color?: string; payload?: Record<string, unknown> }[]; label?: string;
  fmt?: (v: number) => string; labelFmt?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <strong>{label !== undefined && label !== "" ? labelFmt(String(label)) : ""}</strong>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div className="tt-row" key={p.name}>
            <i style={{ background: p.color }} />
            {p.name}
            <b>{fmt(p.value)}</b>
          </div>
        ))}
    </div>
  );
}

export const axisTick = { fill: "var(--text-3)", fontSize: 12 };
export const shortDay = (d: string) => formatDay(d, false);

/** Horizontal bars for a ranked list (one series, so one colour). */
export function BarList({ rows, total }: { rows: { key: string; label: string; amount: number; sub?: string }[]; total?: number }) {
  const sum = total ?? rows.reduce((s, r) => s + r.amount, 0);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));
  return (
    <div className="card bar-list">
      {rows.map((r) => (
        <div className="bar-item" key={r.key}>
          <div className="top">
            <span>{r.label}{r.sub ? <span className="faint small"> · {r.sub}</span> : null}</span>
            <span className="num">
              <strong>{formatINR(r.amount)}</strong>{sum > 0 && <span className="faint"> {Math.round((r.amount / sum) * 100)}%</span>}
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(Math.max(0, r.amount) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export const pctFmt = (v: number) => `${Math.round(v * 10) / 10}%`;
