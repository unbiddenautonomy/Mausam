import { useEffect, useState } from "react";
import type { Settings } from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ErrorNote, Field, Loading, PageHead, useToast } from "../../components/ui";

export function SettingsPage() {
  const t = useSession().t;
  const toast = useToast();
  const res = useApi<{ settings: Settings }>("/settings");
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
    </div>
  );
}
