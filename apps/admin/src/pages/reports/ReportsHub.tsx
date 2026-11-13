import { useSession } from "../../lib/session";
import { NavCard, PageHead } from "../../components/ui";

export function ReportsHub() {
  const t = useSession().t;
  return (
    <div className="page">
      <PageHead title={t("reports.title")} />
      <div className="grid-2">
        <NavCard to="/reports/sales" icon="trend" title={t("reports.sales")} desc={t("reports.sales_desc")} />
        <NavCard to="/reports/expenses" icon="pie" title={t("reports.expenses")} desc={t("reports.expenses_desc")} />
        <NavCard to="/reports/payments" icon="wallet" title={t("reports.cash")} desc={t("reports.cash_desc")} />
        <NavCard to="/reports/reporting" icon="calendar" title={t("reports.reporting")} desc={t("reports.reporting_desc")} />
      </div>
    </div>
  );
}
