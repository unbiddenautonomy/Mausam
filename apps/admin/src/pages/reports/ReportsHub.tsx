import { useState } from "react";
import { formatDay } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ErrorNote, NavCard, PageHead, Pill } from "../../components/ui";

interface Share { until: string | null; active: boolean }

/**
 * Managers always see the basic reports (bills, sales, cash and online, expenses). The deeper analytics are the
 * owner's, and the owner can share them with managers until the end of the month.
 */
export function ReportsHub() {
  const { t, user } = useSession();
  const owner = user?.role === "owner";
  const share = useApi<Share>("/analytics/share");
  const deeper = owner || !!share.data?.active;
  return (
    <div className="page">
      <PageHead title={t("reports.title")} />
      <div className="grid-2">
        <NavCard to="/bills" icon="receipt" title={t("bills.title")} desc={t("bills.desc")} />
        <NavCard to="/reports/sales" icon="trend" title={t("reports.sales")} desc={t("reports.sales_desc")} />
        <NavCard to="/reports/payments" icon="wallet" title={t("reports.cash")} desc={t("reports.cash_desc")} />
        <NavCard to="/reports/expenses" icon="pie" title={t("reports.expenses")} desc={t("reports.expenses_desc")} />
        <NavCard to="/reports/item-sales" icon="checklist" title={t("reports.day_items")} desc={t("reports.day_items_desc")} />
        <NavCard to="/reports/cancellations" icon="alert" title={t("reports.leaks")} desc={t("reports.leaks_desc")} />
      </div>
      {owner && <ShareCard share={share.data} onChange={share.reload} />}
      {deeper ? (
        <section className="section">
          <h2>{t("reports.analytics")}</h2>
          {!owner && share.data?.until && <p className="muted small">{t("reports.shared_until", { date: formatDay(share.data.until) })}</p>}
          <div className="grid-2">
            <NavCard to="/reports/costs" icon="pie" title={t("reports.costs")} desc={t("reports.costs_desc")} />
            <NavCard to="/reports/items" icon="receipt" title={t("reports.items")} desc={t("reports.items_desc")} />
            <NavCard to="/reports/waiters" icon="users" title={t("reports.waiters")} desc={t("reports.waiters_desc")} />
            <NavCard to="/reports/prices" icon="tag" title={t("reports.prices")} desc={t("reports.prices_desc")} />
            <NavCard to="/reports/reporting" icon="calendar" title={t("reports.reporting")} desc={t("reports.reporting_desc")} />
          </div>
        </section>
      ) : (
        share.data && <p className="muted small">{t("reports.not_shared")}</p>
      )}
    </div>
  );
}

/** Owner: share the deeper analytics with managers for this month, or stop. */
function ShareCard({ share, onChange }: { share: Share | null; onChange: () => void }) {
  const t = useSession().t;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function set(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api("/analytics/share", { method: "PUT", json: { share: on } });
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const active = !!share?.active;
  return (
    <div className="card form">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ flex: 1 }}>{t("reports.share_title")}</strong>
        {active && share?.until ? <Pill tone="good">{t("reports.shared_until", { date: formatDay(share.until) })}</Pill> : <Pill>{t("reports.not_shared_pill")}</Pill>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t("reports.share_help")}</p>
      <ErrorNote error={error} />
      {active ? (
        <button className="btn" disabled={busy} onClick={() => void set(false)}>{t("reports.stop_sharing")}</button>
      ) : (
        <button className="btn primary" disabled={busy || !share} onClick={() => void set(true)}>{t("reports.share_month")}</button>
      )}
    </div>
  );
}
