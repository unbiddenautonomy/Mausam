import { useSession } from "../../lib/session";
import { NavCard, PageHead } from "../../components/ui";

export function ReportsHub() {
  const t = useSession().t;
  return (
    <div className="page">
      <PageHead title={t("reports.title")} />
      <div className="grid-2">
        <NavCard to="/bills" icon="receipt" title={t("bills.title")} desc={t("bills.desc")} />
        <NavCard to="/reports/waiters" icon="users" title={t("reports.waiters")} desc={t("reports.waiters_desc")} />
        <NavCard to="/reports/sales" icon="trend" title={t("reports.sales")} desc={t("reports.sales_desc")} />
        <NavCard to="/reports/expenses" icon="pie" title={t("reports.expenses")} desc={t("reports.expenses_desc")} />
        <NavCard to="/reports/payments" icon="wallet" title={t("reports.cash")} desc={t("reports.cash_desc")} />
        <NavCard to="/reports/costs" icon="pie" title={t("reports.costs")} desc={t("reports.costs_desc")} />
        <NavCard to="/reports/items" icon="receipt" title={t("reports.items")} desc={t("reports.items_desc")} />
        <NavCard to="/reports/prices" icon="tag" title={t("reports.prices")} desc={t("reports.prices_desc")} />
        <NavCard to="/reports/reporting" icon="calendar" title={t("reports.reporting")} desc={t("reports.reporting_desc")} />
      </div>
    </div>
  );
}
