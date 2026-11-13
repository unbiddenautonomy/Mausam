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

/** Tooltip body shared by all charts. */
export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color?: string; payload?: Record<string, unknown> }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <strong>{label ? formatDay(String(label)) : ""}</strong>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div className="tt-row" key={p.name}>
            <i style={{ background: p.color }} />
            {p.name}
            <b>{formatINR(p.value)}</b>
          </div>
        ))}
    </div>
  );
}

export const axisTick = { fill: "var(--text-3)", fontSize: 12 };
export const shortDay = (d: string) => formatDay(d, false);
