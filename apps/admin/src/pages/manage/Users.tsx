import { useState } from "react";
import { DEFAULT_LANG, LANGUAGES, type Lang, type Role } from "@mausam/shared";
import { api, ApiError } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Field, Loading, PageHead, Pill, Segmented, useToast } from "../../components/ui";

interface U {
  id: number;
  name: string;
  phone: string;
  role: Role;
  language: Lang;
  active: boolean;
}

export function Users() {
  const { t, user } = useSession();
  const toast = useToast();
  const res = useApi<{ users: U[] }>("/users");
  const [adding, setAdding] = useState(false);

  const [resetting, setResetting] = useState<number | null>(null);
  async function toggle(u: U) {
    await api(`/users/${u.id}`, { method: "PATCH", json: { active: !u.active } });
    res.reload();
  }

  return (
    <div className="page">
      <PageHead
        title={t("manage.users")}
        subtitle={t("manage.users_desc")}
        back="/manage"
        action={!adding ? <button className="btn small primary" onClick={() => setAdding(true)}><Icon name="plus" /> {t("users.add")}</button> : undefined}
      />
      {adding && <AddUser onDone={() => (setAdding(false), res.reload())} />}
      {!res.data ? <Loading /> : (
        <div className="card flush list">
          {res.data.users.map((u) => (
            <div className="row" key={u.id} style={{ opacity: u.active ? 1 : 0.5, flexWrap: "wrap" }}>
              <span className="grow">
                <strong>{u.name}</strong>
                <span className="muted small num">{u.phone} · {LANGUAGES.find((l) => l.code === u.language)?.label}</span>
              </span>
              <Pill tone={u.role === "owner" ? "good" : undefined}>{t(`role.${u.role}` as const)}</Pill>
              {u.id !== user!.id && (
                <span className="btn-row">
                  <button className="btn small" onClick={() => setResetting(resetting === u.id ? null : u.id)}>{t("users.reset_pin")}</button>
                  <button className="btn small" onClick={() => toggle(u)}>{u.active ? <Icon name="lock" /> : <Icon name="check" />}</button>
                </span>
              )}
              {resetting === u.id && <ResetPin user={u} onDone={() => (setResetting(null), toast(t("common.saved")))} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddUser({ onDone }: { onDone: () => void }) {
  const t = useSession().t;
  const [f, setF] = useState({ name: "", phone: "", pin: "", role: "manager" as Role, language: DEFAULT_LANG as Lang });
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    try {
      await api("/users", { method: "POST", json: f });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "phone_taken" ? new Error("phone") : e);
    }
  }
  return (
    <div className="card form">
      <h2>{t("users.add")}</h2>
      <div className="grid-2">
        <Field label={t("users.name")} htmlFor="u-name"><input id="u-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={t("login.phone")} htmlFor="u-phone"><input id="u-phone" className="input num" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
      </div>
      <Field label={t("users.new_pin")} htmlFor="u-pin">
        <input id="u-pin" className="input num" inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => set("pin", e.target.value.replace(/\D/g, "").slice(0, 4))} />
      </Field>
      <div className="field">
        <span className="label">{t("users.role")}</span>
        <Segmented<Role> value={f.role} onChange={(v) => set("role", v)} options={[{ value: "manager", label: t("role.manager") }, { value: "staff", label: t("role.staff") }, { value: "owner", label: t("role.owner") }]} />
      </div>
      <div className="field">
        <span className="label">{t("common.language")}</span>
        <Segmented<Lang> value={f.language} onChange={(v) => set("language", v)} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
      </div>
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="btn" onClick={onDone}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={!f.name || f.phone.replace(/\D/g, "").length < 10 || f.pin.length !== 4} onClick={save}>{t("common.save")}</button>
      </div>
    </div>
  );
}

/** The owner sets a new 4-digit PIN for someone, typed twice. */
function ResetPin({ user, onDone }: { user: U; onDone: () => void }) {
  const t = useSession().t;
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mismatch = a.length === 4 && b.length === 4 && a !== b;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (a.length !== 4 || a !== b) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: "PATCH", json: { pin: a } });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const pin = (id: string, v: string, set: (v: string) => void) => (
    <input id={id} className="input num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={v} onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 4))} />
  );
  return (
    <form className="form" style={{ flexBasis: "100%", paddingTop: 8 }} onSubmit={submit}>
      <strong>{t("users.reset_for", { name: user.name })}</strong>
      <div className="grid-2">
        <Field label={t("pin.new")} htmlFor={`rp-a-${user.id}`}>{pin(`rp-a-${user.id}`, a, setA)}</Field>
        <Field label={t("pin.again")} htmlFor={`rp-b-${user.id}`} error={mismatch ? t("pin.mismatch") : null}>{pin(`rp-b-${user.id}`, b, setB)}</Field>
      </div>
      <ErrorNote error={error} />
      <button className="btn primary" disabled={busy || a.length !== 4 || a !== b}>{t("pin.save")}</button>
    </form>
  );
}
