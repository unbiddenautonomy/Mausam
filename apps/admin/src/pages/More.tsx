import { useState, type FormEvent } from "react";
import { LANGUAGES, type Lang } from "@mausam/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Icon } from "../components/Icon";
import { ErrorNote, Field, NavCard, PageHead, Segmented, useToast } from "../components/ui";
import { NotifyCard } from "../components/NotifyCard";

export function More() {
  const { t, user, lang, setLang, signOut } = useSession();
  const owner = user!.role === "owner";
  return (
    <div className="page">
      <PageHead title={t("nav.more")} subtitle={`${user!.name} · ${t(`role.${user!.role}` as const)}`} />
      <div className="grid-2">
        <NavCard href="/pos/" icon="pos" title={t("pos_only.open")} desc={t("more.pos_desc")} />
        <NavCard to="/alerts" icon="bell" title={t("nav.alerts")} />
        <NavCard to="/people" icon="users" title={t("people.title")} desc={t("people.payroll_desc")} />
        <NavCard to="/vendors" icon="truck" title={t("vendor.title")} desc={t("vendor.desc")} />
        <NavCard to="/bills" icon="receipt" title={t("bills.title")} desc={t("bills.desc")} />
        <NavCard to="/entries/history" icon="history" title={t("entries.history")} desc={t("entries.history_desc")} />
        {owner && <NavCard to="/month" icon="calendar" title={t("month.title")} desc={t("month.desc")} />}
        {owner && <NavCard to="/manage" icon="manage" title={t("nav.manage")} desc={t("manage.users_desc")} />}
        {!owner && <NavCard to="/manage/menu" icon="receipt" title={t("menu.title")} desc={t("menu.desc")} />}
        {!owner && <NavCard to="/manage/waiters" icon="person" title={t("manage.waiters")} desc={t("manage.waiters_desc")} />}
      </div>
      <NotifyCard />
      <section className="section">
        <h2><Icon name="globe" className="chev" /> {t("common.language")}</h2>
        <Segmented<Lang> value={lang} onChange={setLang} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
      </section>
      <ChangePin />
      <button className="btn block danger" onClick={signOut}>
        <Icon name="logout" /> {t("common.logout")}
      </button>
    </div>
  );
}

/** Change your own PIN, after typing the current one. Other phones logged in as you are logged out. */
function ChangePin() {
  const { t } = useSession();
  const toast = useToast();
  const [oldPin, setOld] = useState("");
  const [newPin, setNew] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pin = (id: string, v: string, set: (v: string) => void) => (
    <input id={id} className="input num" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required value={v}
      onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ letterSpacing: "0.5em" }} />
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/pin", { method: "POST", json: { old_pin: oldPin, new_pin: newPin } });
      setOld("");
      setNew("");
      toast(t("pin.done"));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="section form" onSubmit={submit}>
      <h2>{t("pin.title")}</h2>
      <Field label={t("pin.old")} htmlFor="old-pin">{pin("old-pin", oldPin, setOld)}</Field>
      <Field label={t("pin.new")} htmlFor="new-pin">{pin("new-pin", newPin, setNew)}</Field>
      <ErrorNote error={error} />
      <button className="btn" disabled={busy || oldPin.length < 4 || newPin.length < 4}>{t("pin.save")}</button>
    </form>
  );
}
