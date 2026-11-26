import { useEffect, useState } from "react";
import { parseUserList, type Settings } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ErrorNote, Field, Loading, PageHead, useToast } from "../../components/ui";

export function SettingsPage() {
  const t = useSession().t;
  const toast = useToast();
  const res = useApi<{ settings: Settings }>("/settings");
  const users = useApi<{ users: { id: number; name: string; role: string; active: boolean }[] }>("/users");
  const managers = (users.data?.users ?? []).filter((u) => u.active && u.role !== "staff");
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (res.data) setS(res.data.settings);
  }, [res.data]);
  if (!s) return <Loading />;

  const time = (k: "close_due" | "close_escalate" | "shopping_due" | "shopping_escalate", label: string) => (
    <Field label={label} htmlFor={k}>
      <input id={k} type="time" className="input" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
    </Field>
  );
  const rupees = (k: "cash_tolerance" | "shopping_tolerance", label: string) => (
    <Field label={label} htmlFor={k}>
      <input id={k} className="input num" inputMode="numeric" value={s[k] / 100} onChange={(e) => setS({ ...s, [k]: (Number(e.target.value.replace(/\D/g, "")) || 0) * 100 })} />
    </Field>
  );

  /** Tap a name to add or remove them from a reminder. */
  const who = (k: "remind_shopping_to" | "remind_close_to", label: string) => {
    const picked = parseUserList(s[k]);
    const toggle = (id: number) => setS({ ...s, [k]: (picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]).join(",") });
    return (
      <div className="field">
        <span className="label">{label}</span>
        <div className="chips">
          {managers.map((u) => (
            <button key={u.id} type="button" className={`pill${picked.includes(u.id) ? " good" : ""}`} aria-pressed={picked.includes(u.id)}
              style={{ cursor: "pointer", border: 0, padding: "10px 16px", fontSize: "0.95rem" }} onClick={() => toggle(u.id)}>
              {picked.includes(u.id) ? "✓ " : ""}{u.name}
            </button>
          ))}
        </div>
        <span className="help">{picked.length ? managers.filter((u) => picked.includes(u.id)).map((u) => u.name).join(", ") : t("settings.remind_all")}</span>
      </div>
    );
  };

  async function toggleNotify() {
    if (!s) return;
    const next = s.notifications_paused ? 0 : 1;
    try {
      await api("/settings", { method: "PUT", json: { notifications_paused: next } });
      setS({ ...s, notifications_paused: next });
      toast(t("common.saved"));
    } catch (e) {
      setError(e);
    }
  }

  async function save() {
    try {
      await api("/settings", { method: "PUT", json: s });
      toast(t("common.saved"));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="page">
      <PageHead title={t("manage.settings")} subtitle={t("manage.settings_desc")} back="/manage" />
      <div className="card form">
        <div className="grid-2">
          {time("close_due", t("settings.close_due"))}
          {time("close_escalate", t("settings.close_escalate"))}
          {time("shopping_due", t("settings.shopping_due"))}
          {time("shopping_escalate", t("settings.shopping_escalate"))}
          <Field label={t("settings.lock_hour")} htmlFor="lock">
            <input id="lock" className="input num" type="number" min={0} max={23} value={s.lock_hour} onChange={(e) => setS({ ...s, lock_hour: Number(e.target.value) })} />
          </Field>
          {rupees("cash_tolerance", t("settings.cash_tolerance"))}
          {rupees("shopping_tolerance", t("settings.shopping_tolerance"))}
        </div>
        <ErrorNote error={error} />
        <button className="btn primary" onClick={save}>{t("common.save")}</button>
      </div>
      <div className="card form">
        <h2>{t("settings.notify_title")}</h2>
        <p className="muted small" style={{ margin: 0 }}>{s.notifications_paused ? t("settings.notify_paused") : t("settings.notify_on")}</p>
        <button className={`btn${s.notifications_paused ? " primary" : ""}`} onClick={() => void toggleNotify()}>
          {s.notifications_paused ? t("settings.notify_resume") : t("settings.notify_pause")}
        </button>
      </div>
      <div className="card form">
        <h2>{t("settings.reminders")}</h2>
        <p className="muted small" style={{ margin: 0 }}>{t("settings.reminders_help")}</p>
        {managers.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>{t("settings.no_managers")}</p>
        ) : (
          <>
            {who("remind_shopping_to", `${t("settings.remind_shopping")} (${s.shopping_due})`)}
            {who("remind_close_to", `${t("settings.remind_close")} (${s.close_due})`)}
          </>
        )}
        <button className="btn primary" onClick={save}>{t("common.save")}</button>
      </div>
    </div>
  );
}
