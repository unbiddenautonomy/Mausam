import { useSession } from "../lib/session";
import { NavCard, PageHead } from "../components/ui";

export function EntriesHub() {
  const t = useSession().t;
  return (
    <div className="page">
      <PageHead title={t("nav.entries")} />
      <div className="grid-2">
        <NavCard to="/entries/shopping" icon="cart" title={t("entries.shopping")} desc={t("entries.shopping_desc")} />
        <NavCard to="/entries/expenses" icon="receipt" title={t("entries.expenses")} desc={t("entries.expenses_desc")} />
        <NavCard to="/entries/close" icon="moon" title={t("entries.close")} desc={t("entries.close_desc")} />
        <NavCard to="/entries/history" icon="history" title={t("entries.history")} desc={t("entries.history_desc")} />
      </div>
      <div className="grid-2">
        <NavCard to="/people/attendance" icon="checklist" title={t("people.attendance")} desc={t("people.attendance_desc")} />
        <NavCard to="/people/advances" icon="wallet" title={t("people.advances")} desc={t("people.advances_desc")} />
        <NavCard to="/vendors" icon="truck" title={t("vendor.title")} desc={t("vendor.desc")} />
      </div>
    </div>
  );
}
