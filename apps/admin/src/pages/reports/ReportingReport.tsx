import { businessDate, dateRange, dayOfWeek, formatDay } from "@mausam/shared";
import { useSession } from "../../lib/session";
import { timeIST } from "../../lib/format";
import { ErrorNote, Loading, Stat } from "../../components/ui";
import { ReportFrame, type Range } from "./common";
import { useDaily } from "./SalesReport";

export function ReportingReport() {
  const t = useSession().t;
  return (
    <ReportFrame title={t("reports.reporting")} desc={t("reports.reporting_desc")}>
      {(days) => <Body days={days} />}
    </ReportFrame>
  );
}

function Body({ days }: { days: Range }) {
  const t = useSession().t;
  const res = useDaily(days);
  if (res.error) return <ErrorNote error={res.error} />;
  if (!res.data) return <Loading />;
  const today = businessDate();
  const byDate = new Map(res.data.days.map((d) => [d.business_date, d]));
  // Today isn't due yet, so it's not counted as missing.
  const dates = dateRange(res.data.from, res.data.to);
  const status = (d: string) => {
    const r = byDate.get(d);
    if (r) return r.late ? "late" : "on_time";
    return d >= today ? "future" : "missing";
  };
  const counted = dates.filter((d) => status(d) !== "future");
  const n = (s: string) => counted.filter((d) => status(d) === s).length;
  const lead = (dayOfWeek(dates[0]) + 6) % 7; // weeks start Monday
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const label = { on_time: t("reports.on_time"), late: t("reports.late"), missing: t("reports.missing"), future: "" } as const;

  return (
    <>
      <div className="stats">
        <Stat label={t("reports.on_time")} value={`${n("on_time")} / ${counted.length}`} />
        <Stat label={t("reports.late")} value={n("late")} />
        <Stat label={t("reports.missing")} value={n("missing")} />
      </div>
      <div className="card" style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        <div className="legend">
          <span><i className="box" style={{ background: "var(--good-soft)", outline: "1px solid var(--good)" }} />{label.on_time}</span>
          <span><i className="box" style={{ background: "var(--warn-soft)", outline: "1px solid var(--warn)" }} />{label.late}</span>
          <span><i className="box" style={{ background: "var(--bad-soft)", outline: "1px solid var(--bad)" }} />{label.missing}</span>
        </div>
        <div className="cal">
          {weekdays.map((w) => <span key={w} className="wd">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} />)}
          {dates.map((d) => {
            const s = status(d);
            const r = byDate.get(d);
            return (
              <span key={d} className={`day ${s}`} title={`${formatDay(d)}: ${label[s]}${r ? ` · ${timeIST(r.submitted_at)}` : ""}`}>
                {Number(d.slice(8))}
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}
