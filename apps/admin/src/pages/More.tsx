import { LANGUAGES, type Lang } from "@mausam/shared";
import { useSession } from "../lib/session";
import { Icon } from "../components/Icon";
import { NavCard, PageHead, Segmented } from "../components/ui";
import { NotifyCard } from "../components/NotifyCard";

export function More() {
  const { t, user, lang, setLang, signOut } = useSession();
  const owner = user!.role === "owner";
  return (
    <div className="page">
      <PageHead title={t("nav.more")} subtitle={`${user!.name} · ${t(`role.${user!.role}` as const)}`} />
      <div className="grid-2">
        <NavCard to="/alerts" icon="bell" title={t("nav.alerts")} />
        <NavCard to="/people" icon="users" title={t("people.title")} desc={t("people.payroll_desc")} />
        <NavCard to="/vendors" icon="truck" title={t("vendor.title")} desc={t("vendor.desc")} />
        <NavCard to="/bills" icon="receipt" title={t("bills.title")} desc={t("bills.desc")} />
        <NavCard to="/entries/history" icon="history" title={t("entries.history")} desc={t("entries.history_desc")} />
        {owner && <NavCard to="/month" icon="calendar" title={t("month.title")} desc={t("month.desc")} />}
        {owner && <NavCard to="/manage" icon="manage" title={t("nav.manage")} desc={t("manage.users_desc")} />}
      </div>
      <NotifyCard />
      <section className="section">
        <h2><Icon name="globe" className="chev" /> {t("common.language")}</h2>
        <Segmented<Lang> value={lang} onChange={setLang} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
      </section>
      <button className="btn block danger" onClick={signOut}>
        <Icon name="logout" /> {t("common.logout")}
      </button>
    </div>
  );
}
