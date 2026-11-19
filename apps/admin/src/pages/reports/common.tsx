import { useState, type ReactNode } from "react";
import { addDays, businessDate, formatDay, formatINR } from "@mausam/shared";
import { useSession } from "../../lib/session";
import { PageHead } from "../../components/ui";

export const RANGES = ["7", "30", "90", "month", "last_month", "custom"] as const;
export type Range = (typeof RANGES)[number];

/** The dates a report covers. `q` is the query the server takes: to=YYYY-MM-DD&days=N. */
export interface Period { from: string; to: string; days: number; q: string }

const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** A period from two dates (swapped if the wrong way round, at most 366 days, never past today). */
export function periodOf(from: string, to: string, today = businessDate()): Period {
  if (to > today) to = today;
  if (from > to) [from, to] = [to, from];
  if (dayCount(from, to) > 366) from = addDays(to, -365);
  const days = dayCount(from, to);
  return { from, to, days, q: `to=${to}&days=${days}` };
}

/** The same period with `n` more days before it (for running averages). */
export function widen(p: Period, n: number): Period {
  return periodOf(addDays(p.from, -n), p.to);
}

/** Turns a choice into dates: the last 7/30/90 days, this month so far, last month, or two picked dates. */
export function rangePeriod(r: Range, custom: { from: string; to: string }, today = businessDate()): Period {
  if (r === "month") return periodOf(today.slice(0, 8) + "01", today, today);
  if (r === "last_month") {
    const end = addDays(today.slice(0, 8) + "01", -1);
    return periodOf(end.slice(0, 8) + "01", end, today);
  }
  if (r === "custom") return periodOf(custom.from, custom.to, today);
  return periodOf(addDays(today, -(Number(r) - 1)), today, today);
}

/** Every report page has the same frame: title, one period control, then its content. */
export function ReportFrame({ title, desc, children }: { title: string; desc: string; children: (p: Period) => ReactNode }) {
  const t = useSession().t;
  const today = businessDate();
  const [range, setRange] = useState<Range>("30");
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const p = rangePeriod(range, custom, today);
  const label = (r: Range) => (r === "month" ? t("reports.this_month") : r === "last_month" ? t("reports.last_month") : r === "custom" ? t("reports.custom") : t("reports.days", { n: r }));
  return (
    <div className="page">
      <PageHead title={title} subtitle={desc} back="/reports" />
      <div className="row-wrap" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", maxWidth: 560 }}>
        <select className="input" style={{ width: "auto" }} value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label={t("reports.period")}>
          {RANGES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
        {range === "custom" ? (
          <>
            <input type="date" className="input" style={{ width: "auto" }} value={custom.from} max={today} aria-label={t("reports.date_from")} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
            <input type="date" className="input" style={{ width: "auto" }} value={custom.to} max={today} aria-label={t("reports.to")} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>
        ) : (
          <span className="muted small">{formatDay(p.from, false)} – {formatDay(p.to, false)}</span>
        )}
      </div>
      {children(p)}
    </div>
  );
}

/** Paise as rupees with two decimals, for a spreadsheet ("1234.50"). */
export const csvRupees = (paise: number | null | undefined) => (paise === null || paise === undefined ? "" : (paise / 100).toFixed(2));

/** Turns rows into CSV text. Starts with a byte-order mark so Excel reads ₹ and Indian scripts. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Downloads rows (the first is the header) as a CSV file. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A small "Download CSV" button. */
export function CsvButton({ name, rows }: { name: string; rows: () => (string | number | null | undefined)[][] }) {
  const t = useSession().t;
  return (
    <button type="button" className="btn small" onClick={() => downloadCsv(name, rows())}>
      {t("reports.download_csv")}
    </button>
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

/** Hours from the first to the last with sales, in business-day order (5am to 5am), so late-night hours come after the evening. */
export function hourSpan(hours: number[]): number[] {
  if (!hours.length) return [];
  const pos = (h: number) => (h - 5 + 24) % 24;
  const first = Math.min(...hours.map(pos));
  const last = Math.max(...hours.map(pos));
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i + 5) % 24);
}

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
