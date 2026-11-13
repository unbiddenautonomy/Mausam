import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { formatINR, type MessageKey } from "@mausam/shared";
import { ApiError, photoUrl, uploadPhoto } from "../lib/api";
import { useT } from "../lib/session";
import { Icon, type IconName } from "./Icon";

export function PageHead({ title, subtitle, back, action }: { title: string; subtitle?: ReactNode; back?: string; action?: ReactNode }) {
  const t = useT();
  return (
    <header className="page-head">
      <div className="titles">
        {back && (
          <Link to={back} className="back">
            <Icon name="left" /> {t("common.back")}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function NavCard({ to, icon, title, desc, right }: { to: string; icon: IconName; title: string; desc?: ReactNode; right?: ReactNode }) {
  return (
    <Link to={to} className="card card-link">
      <span className="icon-wrap">
        <Icon name={icon} />
      </span>
      <span className="body">
        <h3>{title}</h3>
        {desc && <span className="muted small">{desc}</span>}
      </span>
      {right}
      <Icon name="chevron" className="chev" />
    </Link>
  );
}

export function Stat({ label, value, delta, hero }: { label: string; value: ReactNode; delta?: ReactNode; hero?: boolean }) {
  return (
    <div className={`card stat${hero ? " hero" : ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {delta && <span className="delta">{delta}</span>}
    </div>
  );
}

export function Pill({ tone, children, icon }: { tone?: "good" | "warn" | "bad"; children: ReactNode; icon?: IconName }) {
  return (
    <span className={`pill ${tone ?? ""}`}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

export function Field({ label, help, error, children, htmlFor }: { label: string; help?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}

/** Rupee input. Value is the text the person typed; parse with rupeesToPaise. */
export function MoneyInput({ id, value, onChange, autoFocus }: { id?: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="money">
      <input
        id={id}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
      />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Camera-first photo picker. Uploads immediately and returns the stored key. */
export function PhotoInput({ label, kind, value, onChange }: { label: string; kind: string; value: string | null; onChange: (key: string | null) => void }) {
  const t = useT();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setPreview(URL.createObjectURL(file));
    try {
      onChange(await uploadPhoto(file, kind));
    } catch {
      setError(t("common.error"));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  const src = preview ?? (value ? photoUrl(value) : null);
  return (
    <div className="field">
      <label htmlFor={id} className="photo-input">
        {src ? <img src={src} alt="" /> : <span className="ph"><Icon name="camera" /></span>}
        <span style={{ display: "grid", gap: 2 }}>
          <strong>{label}</strong>
          <span className="muted small">{busy ? t("common.loading") : src ? t("common.change_photo") : t("common.add_photo")}</span>
        </span>
        <input id={id} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export function Money({ paise }: { paise: number | null | undefined }) {
  return <span className="num">{formatINR(paise)}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  const t = useT();
  return <div className="empty">{t("common.loading")}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const known: Record<string, MessageKey> = { day_locked: "common.locked" };
  const msg = error instanceof ApiError && known[error.code] ? t(known[error.code]) : t("common.error");
  return <div className="check bad"><Icon name="alert" /><span className="t">{msg}</span></div>;
}

/* ---------- Toast: one global message line, survives page changes ---------- */

let pushToast: (text: string) => void = () => {};

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    pushToast = (text) => {
      setMsg(text);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(null), 2600);
    };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/** Show a short message, then go to another page if asked. */
export function useToast() {
  const navigate = useNavigate();
  return (text: string, goTo?: string) => {
    pushToast(text);
    if (goTo) navigate(goTo);
  };
}
