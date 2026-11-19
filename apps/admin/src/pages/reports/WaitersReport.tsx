import { useMemo, useState } from "react";
import { businessDate, formatDay, formatINR } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { DayStepper, Empty, ErrorNote, Loading, PageHead, Segmented, Stat } from "../../components/ui";

interface Row { waiter_id: number | null; name: string | null; waiter_code: string | null; business_date: string; bills: number; sales: number; before_tax: number; commission: number }
interface Group { key: string; waiter_id: number | null; name: string; code: string | null; bills: number; sales: number; commission: number; days: Row[] }

function group(rows: Row[], noWaiter: string): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const key = String(r.waiter_id ?? "none");
    const g = m.get(key) ?? { key, waiter_id: r.waiter_id, name: r.waiter_id === null ? noWaiter : r.name ?? "?", code: r.waiter_code, bills: 0, sales: 0, commission: 0, days: [] };
    g.bills += r.bills;
    g.sales += r.sales;
    g.commission += r.commission;
    g.days.push(r);
    m.set(key, g);
  }
  // Waiters by sales, with "no waiter" last.
  return [...m.values()].sort((a, b) => (a.waiter_id === null ? 1 : b.waiter_id === null ? -1 : b.sales - a.sales));
}

/** Owner: what each waiter served and earned, for a month or a single day. */
export function WaitersReport() {
  const { t } = useSession();
  const today = businessDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<"month" | "day">("month");
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const res = useApi<{ rows: Row[] }>(`/billing/waiters/report?month=${month}`);
  const shown = useMemo(() => {
    const rows = res.data?.rows ?? [];
    return group(view === "day" ? rows.filter((r) => r.business_date === day) : rows, t("wrep.no_waiter"));
  }, [res.data, view, day, t]);
  const total = shown.reduce((s, g) => s + g.commission, 0);
  const sales = shown.reduce((s, g) => s + g.sales, 0);
  const unassigned = shown.find((g) => g.waiter_id === null);

  const pickMonth = (m: string) => {
    setMonth(m);
    setDay(m === today.slice(0, 7) ? today : `${m}-01`);
  };
  const pickDay = (d: string) => {
    if (d > today) return;
    if (d.slice(0, 7) !== month) setMonth(d.slice(0, 7));
    setDay(d);
  };

  return (
    <div className="page">
      <PageHead
        title={t("reports.waiters")}
        subtitle={t("reports.waiters_desc")}
        back="/reports"
        action={<input type="month" className="input" style={{ width: "auto" }} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && pickMonth(e.target.value)} aria-label={t("wrep.month")} />}
      />
      <div style={{ maxWidth: 420 }}>
        <Segmented value={view} onChange={setView} options={[{ value: "month", label: t("wrep.month") }, { value: "day", label: t("wrep.day") }]} />
      </div>
      {view === "day" && (
        <DayStepper date={day} max={today} onChange={pickDay} />
      )}
      {res.error ? <ErrorNote error={res.error} /> : !res.data ? <Loading /> : shown.length === 0 ? <Empty>{t("wrep.empty")}</Empty> : (
        <>
          <div className="stats">
            <Stat hero label={view === "day" ? t("wrep.commission") : t("wrep.month_total")} value={formatINR(total)} />
            <Stat label={t("wrep.sales")} value={formatINR(sales)} />
            {unassigned && <Stat label={t("wrep.no_waiter")} value={formatINR(unassigned.sales)} delta={t("wrep.bills", { n: unassigned.bills })} />}
          </div>
          <div className="card flush list">
            {shown.map((g) => (
              <div key={g.key}>
                <button className="row row-link as-button" onClick={() => setOpen(open === g.key ? null : g.key)} style={{ opacity: g.waiter_id === null ? 0.75 : 1 }}>
                  {g.code && <span className="pill" style={{ minWidth: 44, textAlign: "center", fontWeight: 800 }}>{g.code}</span>}
                  <span className="grow">
                    <strong>{g.name}</strong>
                    <span className="muted small">{t("wrep.bills", { n: g.bills })} · {formatINR(g.sales)}</span>
                  </span>
                  <span className="amount">{g.waiter_id === null ? "—" : formatINR(g.commission)}</span>
                  {view === "month" && <Icon name="chevron" />}
                </button>
                {view === "month" && open === g.key && (
                  <div className="row" style={{ display: "grid", gap: 4, background: "var(--surface-2)" }}>
                    <span className="small muted">{t("wrep.by_day")}</span>
                    {g.days.map((d) => (
                      <div key={d.business_date} className="small" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12 }}>
                        <span>{formatDay(d.business_date)} · {t("wrep.bills", { n: d.bills })}</span>
                        <span className="num">{formatINR(d.sales)}</span>
                        <strong className="num">{g.waiter_id === null ? "—" : formatINR(d.commission)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>{unassigned ? `${t("wrep.no_waiter_help")} ` : ""}{t("wrep.in_pay")}</p>
        </>
      )}
    </div>
  );
}
