import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { businessDate, checkClose, formatDay, formatINR, rupeesToPaise, type CloseFlag } from "@mausam/shared";
import { sendOrQueue } from "../lib/api";
import { useApi, useDraft } from "../lib/hooks";
import { useSession } from "../lib/session";
import { timeIST } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorNote, Field, Loading, MoneyInput, PageHead, Photo, PhotoInput, PhotoLink, useToast } from "../components/ui";
import { MemoReader, type MemoResult } from "../components/MemoReader";

interface CloseRow {
  total_counter: number;
  cash: number;
  online: number;
  expenses: number;
  pos_sales: number | null;
  note: string | null;
  memo_photo_key: string | null;
  pos_photo_key: string | null;
  flags: CloseFlag[];
  submitted_by_name: string;
  submitted_at: string;
}
interface CloseRes {
  close: CloseRow | null;
  expenses_entered: number;
  locked: boolean;
  tolerance: number;
  pos: { total: number } | null;
}

const toRupees = (p: number | null | undefined) => (p === null || p === undefined ? "" : String(p / 100));

export function FlagList({ flags }: { flags: CloseFlag[] }) {
  const t = useSession().t;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {flags.map((f) => (
        <div key={f.code} className={`check ${f.code === "no_memo_photo" ? "warn" : "bad"}`}>
          <Icon name="alert" />
          <span className="t">{t(`flag.${f.code}` as const, { amount: formatINR(Math.abs(f.diff ?? 0)) })}</span>
        </div>
      ))}
    </div>
  );
}

export function CloseDay() {
  const { t, user } = useSession();
  const params = useParams();
  const date = params.date ?? businessDate();
  const res = useApi<CloseRes>(`/closes/${date}`);
  const [editing, setEditing] = useState(false);
  if (!res.data) return res.error ? <ErrorNote error={res.error} /> : <Loading />;
  const { close, locked } = res.data;
  const canEdit = !locked || user!.role === "owner";
  return (
    <div className="page">
      <PageHead title={t("close.title")} subtitle={t("close.for", { date: formatDay(date) })} back={params.date ? "/entries/history" : "/entries"} />
      {locked && <div className="check warn"><Icon name="lock" /><span className="t">{t("common.locked")}</span></div>}
      {close && !editing ? (
        <Submitted date={date} close={close} onEdit={canEdit ? () => setEditing(true) : undefined} />
      ) : canEdit ? (
        <CloseForm date={date} data={res.data} onDone={() => (setEditing(false), res.reload())} />
      ) : null}
    </div>
  );
}

function Submitted({ date, close, onEdit }: { date: string; close: CloseRow; onEdit?: () => void }) {
  const t = useSession().t;
  const rows: [string, number | null][] = [
    [t("close.total_counter"), close.total_counter],
    [t("close.cash"), close.cash],
    [t("close.online"), close.online],
    [t("close.expenses"), close.expenses],
    [t("close.pos_sales"), close.pos_sales],
  ];
  return (
    <>
      <div className="check good">
        <Icon name="check" />
        <span className="t">{t("close.submitted")} · {t("close.submitted_by", { name: close.submitted_by_name, time: timeIST(close.submitted_at) })}</span>
      </div>
      {close.flags.length > 0 && <FlagList flags={close.flags} />}
      <div className="card flush list">
        {rows.filter(([, v]) => v !== null).map(([label, v]) => (
          <div className="row" key={label}>
            <span className="grow">{label}</span>
            <span className="amount">{formatINR(v)}</span>
          </div>
        ))}
        {close.note && <div className="row"><span className="grow muted">{close.note}</span></div>}
      </div>
      <MemoReader
        date={date}
        photoKey={close.memo_photo_key}
        typed={{ total: close.total_counter, cash: close.cash, online: close.online, expenses: close.expenses }}
      />
      <div className="grid-2">
        {close.memo_photo_key && (
          <PhotoLink photoKey={close.memo_photo_key} className="card" style={{ display: "grid", gap: 8 }}>
            <strong>{t("close.memo_photo")}</strong>
            <Photo photoKey={close.memo_photo_key} alt={t("close.memo_photo")} style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 8 }} />
          </PhotoLink>
        )}
        {close.pos_photo_key && (
          <PhotoLink photoKey={close.pos_photo_key} className="card" style={{ display: "grid", gap: 8 }}>
            <strong>{t("close.pos_photo")}</strong>
            <Photo photoKey={close.pos_photo_key} alt={t("close.pos_photo")} style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 8 }} />
          </PhotoLink>
        )}
      </div>
      {onEdit && (
        <button className="btn block" onClick={onEdit}>
          {t("close.update")}
        </button>
      )}
    </>
  );
}

function CloseForm({ date, data, onDone }: { date: string; data: CloseRes; onDone: () => void }) {
  const t = useSession().t;
  const toast = useToast();
  const c = data.close;
  const [f, setF, clearDraft] = useDraft(`close.${date}`, {
    total: toRupees(c?.total_counter),
    cash: toRupees(c?.cash),
    online: toRupees(c?.online),
    expenses: toRupees(c?.expenses),
    pos: toRupees(c?.pos_sales ?? data.pos?.total),
    memo: c?.memo_photo_key ?? (null as string | null),
    posPhoto: c?.pos_photo_key ?? (null as string | null),
    note: c?.note ?? "",
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // Suggest the app-entered expenses as a starting point when the field is empty.
  useEffect(() => {
    if (!f.expenses && data.expenses_entered > 0) set("expenses", String(data.expenses_entered / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = {
    total_counter: rupeesToPaise(f.total),
    cash: rupeesToPaise(f.cash),
    online: rupeesToPaise(f.online),
    expenses: rupeesToPaise(f.expenses),
    pos_sales: rupeesToPaise(f.pos),
  };
  const complete = v.total_counter !== null && v.cash !== null && v.online !== null && v.expenses !== null;
  const flags = complete
    ? checkClose(
        { total_counter: v.total_counter!, cash: v.cash!, online: v.online!, expenses: v.expenses!, pos_sales: v.pos_sales, memo_photo_key: f.memo },
        { expensesEntered: data.expenses_entered, tolerance: data.tolerance },
      )
    : [];
  const formulaOk = complete && !flags.some((x) => x.code === "formula_mismatch");

  async function submit() {
    if (!complete) return;
    setBusy(true);
    setError(null);
    try {
      const r = await sendOrQueue(`/closes/${date}`, "PUT", {
        ...v,
        memo_photo_key: f.memo,
        pos_photo_key: f.posPhoto,
        note: f.note,
      });
      clearDraft();
      toast("queued" in (r as object) ? t("offline.queued") : t("close.submitted"));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const useMemo = (r: MemoResult) =>
    setF((x) => ({
      ...x,
      total: r.total !== null ? toRupees(r.total) : x.total,
      cash: r.cash !== null ? toRupees(r.cash) : x.cash,
      online: r.online !== null ? toRupees(r.online) : x.online,
      expenses: r.expenses_total !== null ? toRupees(r.expenses_total) : x.expenses,
    }));

  const money = (key: "total" | "cash" | "online" | "expenses" | "pos", label: string, help: string) => (
    <Field label={label} help={help} htmlFor={key}>
      <MoneyInput id={key} value={f[key]} onChange={(x) => set(key, x)} />
    </Field>
  );

  return (
    <div className="cols">
      <div className="form">
        <PhotoInput label={t("close.memo_photo")} kind="memo" value={f.memo} onChange={(k) => set("memo", k)} />
        <MemoReader date={date} photoKey={f.memo} typed={{ total: v.total_counter, cash: v.cash, online: v.online, expenses: v.expenses }} onUse={useMemo} />
        {money("total", t("close.total_counter"), t("close.total_help"))}
        <div className="grid-2">
          {money("cash", t("close.cash"), t("close.cash_help"))}
          {money("online", t("close.online"), t("close.online_help"))}
        </div>
        {money("expenses", t("close.expenses"), t("close.expenses_help"))}
        <details>
          <summary className="muted" style={{ cursor: "pointer", padding: "6px 0" }}>{t("close.pos_sales")} · {t("common.optional")}</summary>
          <div className="form" style={{ marginTop: 12 }}>
            {money("pos", t("close.pos_sales"), t("close.pos_help"))}
            <PhotoInput label={t("close.pos_photo")} kind="pos" value={f.posPhoto} onChange={(k) => set("posPhoto", k)} />
          </div>
        </details>
        <Field label={t("common.note_optional")} htmlFor="note">
          <textarea id="note" className="textarea" value={f.note} onChange={(e) => set("note", e.target.value)} />
        </Field>
      </div>

      <aside className="form" style={{ position: "sticky", top: 16 }}>
        <div className="card form">
          <h2>{t("close.check_title")}</h2>
          <div className="muted small">{t("close.formula")}</div>
          <div className="num" style={{ fontSize: "1.05rem" }}>
            {formatINR(v.cash ?? 0)} + {formatINR(v.online ?? 0)} + {formatINR(v.expenses ?? 0)} = <strong>{formatINR((v.cash ?? 0) + (v.online ?? 0) + (v.expenses ?? 0))}</strong>
          </div>
          {complete && formulaOk && <div className="check good"><Icon name="check" /><span className="t">{t("close.formula_ok")}</span></div>}
          {flags.length > 0 && <FlagList flags={flags} />}
          {data.expenses_entered > 0 && <p className="small muted">{t("close.entered", { amount: formatINR(data.expenses_entered) })}</p>}
          <ErrorNote error={error} />
          <button className="btn primary block" disabled={!complete || busy} onClick={submit}>
            <Icon name="check" /> {data.close ? t("close.update") : t("close.submit")}
          </button>
        </div>
      </aside>
    </div>
  );
}

