import { useEffect, useState } from "react";
import { formatINR } from "@mausam/shared";
import { api, ApiError } from "../lib/api";
import { readMemoOnPhone, type OcrStage } from "../lib/ocr";
import { useT } from "../lib/session";
import { Icon } from "./Icon";
import { Pill } from "./ui";

export interface MemoResult {
  date: string | null;
  total: number | null;
  cash: number | null;
  online: number | null;
  expenses_total: number | null;
  lines: { label: string; amount: number }[];
  unsure: string[];
  note: string | null;
}
export interface Typed {
  total: number | null;
  cash: number | null;
  online: number | null;
  expenses: number | null;
}

type Engine = "claude" | "phone";
let status: Promise<Engine> | null = null;
/** Claude on the server when it has an Anthropic key; otherwise free OCR on this phone. */
const memoEngine = () =>
  (status ??= api<{ engine?: Engine }>("/memo/status").then(
    (r) => (r.engine === "claude" ? "claude" : "phone"),
    () => "phone" as const,
  ));

/**
 * Reads the memo photo (with Claude, or free OCR on the phone) and compares it with what was typed.
 * In the form, `onUse` fills the fields; on a submitted day it only shows the comparison.
 */
export function MemoReader({ date, photoKey, typed, onUse }: { date: string; photoKey: string | null; typed: Typed; onUse?: (r: MemoResult) => void }) {
  const t = useT();
  const [engine, setEngine] = useState<Engine | null>(null);
  const [result, setResult] = useState<MemoResult | null>(null);
  const [readKey, setReadKey] = useState<string | null>(null);
  const [byPhone, setByPhone] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "reading" | "failed" | "unavailable" | "limit" | "phone_failed" | "empty">("idle");
  const [stage, setStage] = useState<{ stage: OcrStage; pct: number } | null>(null);

  useEffect(() => {
    memoEngine().then(setEngine);
    api<{ read: { photo_key: string; model: string | null; result: MemoResult } | null }>(`/memo/${date}`).then(
      (r) => r.read && (setResult(r.read.result), setReadKey(r.read.photo_key), setByPhone(r.read.model === "phone-ocr")),
      () => {},
    );
  }, [date]);

  async function readOnPhone() {
    if (!photoKey) return;
    setState("reading");
    setStage({ stage: "loading", pct: 0 });
    try {
      const { result: r, text } = await readMemoOnPhone(photoKey, (st, p) => setStage({ stage: st, pct: Math.round(p * 100) }));
      setSeen(text);
      if (r.total === null && r.cash === null && r.online === null && r.expenses_total === null && r.lines.length === 0) {
        setState("empty");
        return;
      }
      setResult(r);
      setReadKey(photoKey);
      setByPhone(true);
      setState("idle");
      // Keep it on the server so the day shows it later. If that fails, the numbers are still on screen.
      api("/memo/save", { method: "POST", json: { business_date: date, photo_key: photoKey, result: r } }).catch(() => {});
    } catch (e) {
      console.error("phone memo read failed", e);
      setState("phone_failed");
    } finally {
      setStage(null);
    }
  }

  async function read() {
    if (!photoKey) return;
    if (engine !== "claude") return readOnPhone();
    setState("reading");
    try {
      const r = await api<{ result: MemoResult }>("/memo/read", { method: "POST", json: { business_date: date, photo_key: photoKey } });
      setResult(r.result);
      setReadKey(photoKey);
      setByPhone(false);
      setState("idle");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setState(code === "memo_unavailable" ? "unavailable" : code === "too_many_reads" ? "limit" : "failed");
    }
  }

  // Only show a read that belongs to the current photo.
  const shown = result && readKey === photoKey ? result : null;
  if (!photoKey || (!shown && (!onUse || engine === null))) return null;

  const fields: [keyof Typed, keyof MemoResult, string][] = [
    ["total", "total", t("close.total_counter")],
    ["cash", "cash", t("close.cash")],
    ["online", "online", t("close.online")],
    ["expenses", "expenses_total", t("close.expenses")],
  ];
  const diffs = shown
    ? fields.filter(([tk, mk]) => typed[tk] !== null && shown[mk] !== null && typed[tk] !== shown[mk])
    : [];
  const anyTyped = fields.some(([tk]) => typed[tk] !== null);
  const linesSum = shown?.lines.reduce((s, l) => s + l.amount, 0) ?? 0;

  return (
    <div className="card memo-read">
      {!shown ? (
        <>
          <button className="btn block" onClick={read} disabled={state === "reading"}>
            <Icon name="sparkle" />{" "}
            {state !== "reading"
              ? t(engine === "claude" ? "memo.read" : "memo.read_phone")
              : stage?.stage === "loading"
                ? t("memo.preparing", { pct: stage.pct })
                : stage
                  ? t("memo.reading_pct", { pct: stage.pct })
                  : t("memo.reading")}
          </button>
          {state === "failed" && <p className="small bad-text">{t("memo.failed")}</p>}
          {state === "unavailable" && <p className="small muted">{t("memo.unavailable")}</p>}
          {state === "limit" && <p className="small muted">{t("memo.limit")}</p>}
          {state === "phone_failed" && <p className="small bad-text">{t("memo.phone_failed")}</p>}
          {state === "empty" && <p className="small bad-text">{t("memo.nothing_found")}</p>}
          {engine === "claude" && (state === "failed" || state === "unavailable" || state === "limit") && (
            <button className="btn block" onClick={readOnPhone}>
              {t("memo.try_phone")}
            </button>
          )}
          {seen && state === "empty" && <SeenText text={seen} label={t("memo.seen_text")} />}
        </>
      ) : (
        <>
          <div className="section-head">
            <h3>{t("memo.result")}</h3>
            <span className="small muted">{t("memo.check")}</span>
          </div>
          <div className="memo-grid">
            {fields.map(([, mk, label]) => (
              <div key={mk} className="memo-cell">
                <span className="small muted">{label}</span>
                <strong className="num">{shown[mk] === null ? "—" : formatINR(shown[mk] as number)}</strong>
                {shown.unsure.includes(mk) && <Pill tone="warn">{t("memo.unsure")}</Pill>}
              </div>
            ))}
          </div>
          {shown.lines.length > 0 && (
            <details>
              <summary className="small muted" style={{ cursor: "pointer" }}>
                {t("memo.lines")} · {shown.lines.length}
              </summary>
              <div className="list" style={{ marginTop: 8 }}>
                {shown.lines.map((l, i) => (
                  <div className="row" key={i}>
                    <span className="grow">{l.label}</span>
                    <span className="amount">{formatINR(l.amount)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          {shown.lines.length > 0 && shown.expenses_total !== null && linesSum !== shown.expenses_total ? (
            <div className="check warn"><Icon name="alert" /><span className="t">{t("memo.lines_off", { amount: formatINR(linesSum), total: formatINR(shown.expenses_total) })}</span></div>
          ) : null}
          {byPhone && <p className="small muted">{t("memo.phone_hint")}</p>}
          {shown.note && <p className="small muted">{shown.note}</p>}
          {seen && byPhone && <SeenText text={seen} label={t("memo.seen_text")} />}
          {anyTyped && diffs.length === 0 && <div className="check good"><Icon name="check" /><span className="t">{t("memo.match")}</span></div>}
          {diffs.map(([tk, mk, label]) => (
            <div className="check bad" key={tk}>
              <Icon name="alert" />
              <span className="t">{t("memo.differs", { field: label, memo: formatINR(shown[mk] as number), typed: formatINR(typed[tk]!) })}</span>
            </div>
          ))}
          {onUse && (
            <button className="btn block" onClick={() => onUse(shown)}>
              {t("memo.use")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** The raw text the phone read, so the manager can see what it got wrong. */
function SeenText({ text, label }: { text: string; label: string }) {
  return (
    <details>
      <summary className="small muted" style={{ cursor: "pointer" }}>
        {label}
      </summary>
      <pre className="small" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{text.trim()}</pre>
    </details>
  );
}
