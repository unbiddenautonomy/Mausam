import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { formatINR, rupeesToPaise, type MessageKey } from "@mausam/shared";
import { ApiError, loadPhoto, uploadPhoto } from "../lib/api";
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
  const t = useT();
  const paise = value ? rupeesToPaise(value) : null;
  // Read the amount back in Indian format (₹1,25,000) so an extra zero is easy to spot.
  const echo = paise && paise >= 100_000 ? t("money.you_typed", { amount: formatINR(paise) }) : null;
  return (
    <>
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
    {echo && <span className="money-echo num" aria-live="polite">{echo}</span>}
    </>
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
  const stored = usePhoto(preview ? null : value);
  const src = preview ?? stored;
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

/** The object URL for a stored photo, or null while it loads (or if it can't be loaded). */
export function usePhoto(key: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!key) return;
    let live = true;
    loadPhoto(key).then((u) => live && setSrc(u)).catch(() => {});
    return () => void (live = false);
  }, [key]);
  return src;
}

/** A stored photo (receipt, memo). Shows a soft placeholder until it has loaded. */
export function Photo({ photoKey, alt = "", className, style }: { photoKey: string; alt?: string; className?: string; style?: CSSProperties }) {
  const src = usePhoto(photoKey);
  return src ? <img src={src} alt={alt} className={className} style={style} /> : <span className={`${className ?? ""} photo-loading`} style={style} aria-label={alt} />;
}

/** Opens a stored photo full size in a new tab. */
export function PhotoLink({ photoKey, className, style, children }: { photoKey: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  const src = usePhoto(photoKey);
  return (
    <a href={src ?? undefined} target="_blank" rel="noreferrer" className={className} style={style}>
      {children}
    </a>
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

const KNOWN_ERRORS: Record<string, MessageKey> = { day_locked: "common.locked", month_closed: "error.month_closed", waiter_code_taken: "error.waiter_code_taken" };

/** The sentence for an error code the server sent, or the general "something went wrong". */
export function errorKey(code: string | null | undefined): MessageKey {
  return (code && KNOWN_ERRORS[code]) || "common.error";
}

export function ErrorNote({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const msg = t(errorKey(error instanceof ApiError ? error.code : null));
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
