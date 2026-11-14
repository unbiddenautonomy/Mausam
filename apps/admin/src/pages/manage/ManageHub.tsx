import { useSession } from "../../lib/session";
import { NavCard, PageHead } from "../../components/ui";

export function ManageHub() {
  const t = useSession().t;
  return (
    <div className="page">
      <PageHead title={t("manage.title")} />
      <div className="grid-2">
        <NavCard to="/manage/menu" icon="receipt" title={t("menu.title")} desc={t("menu.desc")} />
        <NavCard to="/manage/tables" icon="checklist" title={t("tables.title")} desc={t("tables.desc")} />
        <NavCard to="/manage/users" icon="key" title={t("manage.users")} desc={t("manage.users_desc")} />
        <NavCard to="/manage/staff" icon="users" title={t("manage.staff")} desc={t("manage.staff_desc")} />
        <NavCard to="/manage/categories" icon="tag" title={t("manage.categories")} desc={t("manage.categories_desc")} />
        <NavCard to="/manage/import" icon="upload" title={t("manage.import")} desc={t("pos.desc")} />
        <NavCard to="/manage/audit" icon="history" title={t("manage.audit")} desc={t("audit.desc")} />
        <NavCard to="/manage/settings" icon="clock" title={t("manage.settings")} desc={t("manage.settings_desc")} />
      </div>
    </div>
  );
}
