import { useEffect, useState, type FormEvent } from "react";
import { LANGUAGES, type Lang, type User } from "@mausam/shared";
import { api, ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { Logo } from "../components/Icon";
import { Field, Segmented } from "../components/ui";

export function Login() {
  const { t, lang, setLang, signIn } = useSession();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needs_setup: boolean }>("/auth/setup").then((r) => setNeedsSetup(r.needs_setup)).catch(() => setNeedsSetup(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsSetup && pin !== pin2) return setError(t("setup.pin_mismatch"));
    setBusy(true);
    try {
      const r = needsSetup
        ? await api<{ token: string; user: User }>("/auth/setup", { method: "POST", json: { name, phone, pin, language: lang } })
        : await api<{ token: string; user: User }>("/auth/login", { method: "POST", json: { phone, pin } });
      signIn(r.token, r.user);
    } catch (err) {
      setError(err instanceof ApiError && (err.code === "wrong_login" || err.code === "too_many_tries") ? t("login.wrong") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const pinInput = (id: string, v: string, set: (s: string) => void) => (
    <input id={id} className="input num" type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} pattern="\d{4}" required value={v} onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ letterSpacing: "0.5em", fontSize: "1.4rem" }} />
  );

  return (
    <div className="center-screen">
      <form className="auth-card" onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo />
          <div>
            <h1>{needsSetup ? t("setup.title") : t("app.name")}</h1>
            <p className="muted small">{needsSetup ? t("setup.intro") : t("app.tagline")}</p>
          </div>
        </div>
        <Segmented<Lang> value={lang} onChange={setLang} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
        <div className="card form">
          {needsSetup && (
            <Field label={t("setup.name")} htmlFor="name">
              <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          )}
          <Field label={t("login.phone")} htmlFor="phone">
            <input id="phone" className="input num" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98450 12345" />
          </Field>
          <Field label={t("login.pin")} htmlFor="pin">{pinInput("pin", pin, setPin)}</Field>
          {needsSetup && <Field label={t("setup.confirm_pin")} htmlFor="pin2">{pinInput("pin2", pin2, setPin2)}</Field>}
          {error && <div className="check bad"><span className="t">{error}</span></div>}
          <button className="btn primary block" disabled={busy || needsSetup === null}>
            {needsSetup ? t("setup.submit") : t("login.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
