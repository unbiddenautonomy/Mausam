import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { addDays, formatDay, formatINR, rupeesToPaise, type MessageKey } from "@mausam/shared";
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

/** A tappable card. `to` is a route in this app; `href` leaves the app (for example the POS at /pos/). */
export function NavCard({ to, href, icon, title, desc, right }: { to?: string; href?: string; icon: IconName; title: string; desc?: ReactNode; right?: ReactNode }) {
  const inner = (
    <>
      <span className="icon-wrap">
        <Icon name={icon} />
      </span>
      <span className="body">
        <h3>{title}</h3>
        {desc && <span className="muted small">{desc}</span>}
      </span>
      {right}
      <Icon name="chevron" className="chev" />
    </>
  );
  if (href) return <a href={href} className="card card-link">{inner}</a>;
  return <Link to={to!} className="card card-link">{inner}</Link>;
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

/** Previous and next day arrows around the day's name. Tapping the name opens a date picker. */
export function DayStepper({ date, max, onChange, children }: { date: string; max: string; onChange: (d: string) => void; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button className="btn small" aria-label={t("common.prev_day")} onClick={() => onChange(addDays(date, -1))}><Icon name="left" /></button>
      <div style={{ flex: 1, textAlign: "center" }}>
        <label style={{ position: "relative", display: "inline-block", cursor: "pointer" }}>
          <strong>{formatDay(date)}</strong>
          <input
            type="date"
            value={date}
            max={max}
            aria-label={t("common.pick_day")}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                // older browsers open it themselves
              }
            }}
            onChange={(e) => e.target.value && onChange(e.target.value > max ? max : e.target.value)}
            style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer" }}
          />
        </label>
        {children}
      </div>
      <button className="btn small" aria-label={t("common.next_day")} disabled={date >= max} onClick={() => onChange(addDays(date, 1))}><Icon name="chevron" /></button>
    </div>
  );
}

export function Loading() {
  const t = useT();
  return <div className="empty">{t("common.loading")}</div>;
}

const KNOWN_ERRORS: Record<string, MessageKey> = {
  day_locked: "common.locked",
  month_closed: "error.month_closed",
  month_not_over: "error.month_not_over",
  waiter_code_taken: "error.waiter_code_taken",
  wrong_pin: "error.wrong_pin",
  too_many_tries: "error.too_many_tries",
  changed_elsewhere: "error.changed_elsewhere",
  too_many_reads: "error.too_many_reads",
  phone_taken: "error.phone_taken",
  trip_already_open: "error.trip_already_open",
  trip_closed: "error.trip_closed",
  linked_entry: "error.linked_entry",
  future_date: "error.future_date",
  note_required: "error.note_required",
  not_allowed: "error.not_allowed",
  not_found: "error.not_found",
  too_large: "error.too_large",
  memo_unavailable: "error.memo_unavailable",
  memo_failed: "error.memo_failed",
  cannot_demote_self: "error.cannot_demote_self",
  wrong_login: "error.wrong_login",
  invalid: "error.invalid",
  offline: "error.offline",
};

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A POS discount reason in words ("regular" → "Regular customer"). An unknown one is shown as it came. */
export function discountReasonText(t: T, code: string): string {
  const key = `discount_reason.${code}` as MessageKey;
  const text = t(key);
  return text === key ? code : text;
}

/** A bill's flags (a JSON list such as ["price_changed"]) in words, joined with " · ". */
export function billFlagText(t: T, flags: string): string {
  let list: unknown = [];
  try {
    list = JSON.parse(flags);
  } catch {
    // shown as nothing
  }
  return (Array.isArray(list) ? list : []).map((f) => {
    const key = `bill_flag.${f}` as MessageKey;
    const text = t(key);
    return text === key ? String(f) : text;
  }).join(" · ");
}

/** The sentence for an error code the server sent, or the general "something went wrong". */
export function errorKey(code: string | null | undefined): MessageKey {
  return (code && KNOWN_ERRORS[code]) || "common.error";
}

/** The sentence for any error: a server code, or "no internet" when the request never reached the server. */
export function errorText(t: T, error: unknown): string {
  return t(error instanceof ApiError ? errorKey(error.code) : error instanceof TypeError ? "error.offline" : "common.error");
}

export function ErrorNote({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const msg = errorText(t, error);
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
