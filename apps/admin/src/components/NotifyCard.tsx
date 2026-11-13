import { useEffect, useState } from "react";
import { useT } from "../lib/session";
import { disablePush, enablePush, pushState, testPush, type PushState } from "../lib/push";
import { Icon } from "./Icon";
import { useToast } from "./ui";

/**
 * Reminders on/off for this phone. `compact` is the Today-page prompt: it only shows while
 * reminders are off and can be turned on, and hides itself otherwise.
 */
export function NotifyCard({ compact }: { compact?: boolean }) {
  const t = useT();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState().then(setState, () => setState("off"));
  }, []);

  if (state === null) return null;
  if (compact && state !== "off") return null;

  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    try {
      setState(await fn());
    } catch {
      toast(t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await testPush();
      toast(t("notify.sent", { n: r.delivered }));
    } catch {
      toast(t("notify.off_server"));
    } finally {
      setBusy(false);
    }
  };

  const message: Partial<Record<PushState, string>> = {
    unsupported: t("notify.unsupported"),
    blocked: t("notify.blocked"),
    off_server: t("notify.off_server"),
  };

  return (
    <section className={`card notify ${state === "on" ? "is-on" : ""}`}>
      <div className="notify-head">
        <Icon name="bell" />
        <div>
          <strong>{state === "on" ? t("notify.on") : t("notify.enable")}</strong>
          <p className="muted">{message[state] ?? t("notify.desc")}</p>
        </div>
      </div>
      {state === "off" && (
        <button className="btn primary block" disabled={busy} onClick={() => run(enablePush)}>
          {t("notify.enable")}
        </button>
      )}
      {state === "on" && (
        <div className="btn-row">
          <button className="btn" disabled={busy} onClick={test}>{t("notify.test")}</button>
          <button className="btn" disabled={busy} onClick={() => run(disablePush)}>{t("notify.turn_off")}</button>
        </div>
      )}
    </section>
  );
}
