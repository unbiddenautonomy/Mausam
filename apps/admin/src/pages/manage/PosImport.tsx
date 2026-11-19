import { useEffect, useMemo, useState } from "react";
import {
  findHeaderRow, formatDay, formatINR, guessMapping, parsePosAmount, parsePosDate, parsePosNumber, POS_FIELDS, POS_REQUIRED, type MessageKey, type PosKind,
} from "@mausam/shared";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Field, Loading, PageHead, Segmented, useToast } from "../../components/ui";

type Cell = string | number | boolean | Date | null;
const MONEY = new Set(["total", "cash", "online", "dine_in", "parcel", "discount", "cancelled", "amount"]);

async function readFile(file: File): Promise<Cell[][]> {
  if (/\.(csv|txt)$/i.test(file.name) || file.type === "text/csv") {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    return Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true }).data;
  }
  const { readSheet } = await import("read-excel-file/browser");
  return (await readSheet(file)) as Cell[][];
}

interface Parsed { rows: Record<string, unknown>[]; skipped: number }

function parseRows(data: Cell[][], header: number, cols: Record<string, number | null>, kind: PosKind, singleDate: string): Parsed {
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of data.slice(header + 1)) {
    if (!r || r.every((c) => c === null || c === "")) continue;
    const get = (f: string) => (cols[f] === null || cols[f] === undefined ? null : r[cols[f]!]);
    const date = cols.date !== null && cols.date !== undefined ? parsePosDate(get("date")) : kind === "items" ? singleDate || null : null;
    const out: Record<string, unknown> = { date };
    for (const f of POS_FIELDS[kind]) {
      if (f === "date") continue;
      const v = get(f);
      out[f] = f === "item" || f === "category" ? (v === null ? null : String(v).trim()) : MONEY.has(f) ? parsePosAmount(v) : parsePosNumber(v);
    }
    const ok = kind === "sales" ? date && typeof out.total === "number" : date && out.item && !/^(grand\s*)?total$/i.test(String(out.item)) && typeof out.qty === "number" && typeof out.amount === "number";
    if (ok) rows.push(out);
    else skipped++;
  }
  return { rows, skipped };
}

export function PosImport() {
  const { t } = useSession();
  const toast = useToast();
  const [kind, setKind] = useState<PosKind>("sales");
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<Cell[][] | null>(null);
  const [header, setHeader] = useState(0);
  const [cols, setCols] = useState<Record<string, number | null>>({});
  const [singleDate, setSingleDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const saved = useApi<{ mappings: Record<string, Record<string, string | null>> }>("/pos/mappings");
  const history = useApi<{ imports: { id: number; kind: string; filename: string | null; from_date: string | null; to_date: string | null; rows: number; by_name: string; created_at: string }[] }>("/pos/imports");

  const headers = useMemo(() => (data?.[header] ?? []).map((c) => (c === null ? "" : String(c))), [data, header]);

  // Use the remembered mapping (by header name) where it fits, else guess.
  useEffect(() => {
    if (!data) return;
    const guess = guessMapping(headers, kind);
    const remembered = saved.data?.mappings[kind];
    const next: Record<string, number | null> = {};
    for (const f of POS_FIELDS[kind]) {
      const name = remembered?.[f];
      const idx = name ? headers.indexOf(name) : -1;
      next[f] = idx >= 0 ? idx : remembered && name === null ? null : guess[f];
    }
    setCols(next);
  }, [data, headers, kind, saved.data]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setError(null);
    setFile(f);
    try {
      const rows = await readFile(f);
      setData(rows);
      setHeader(findHeaderRow(rows));
    } catch (e) {
      setData(null);
      setError(e);
    }
  }

  const parsed = data ? parseRows(data, header, cols, kind, singleDate) : null;
  const missing = POS_REQUIRED[kind].filter((f) => cols[f] === null || cols[f] === undefined);
  const needsDate = kind === "items" && (cols.date === null || cols.date === undefined) && !singleDate;

  async function doImport() {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/pos/mappings/${kind}`, { method: "PUT", json: Object.fromEntries(POS_FIELDS[kind].map((f) => [f, cols[f] === null || cols[f] === undefined ? null : headers[cols[f]!]])) });
      let total = 0;
      for (let i = 0; i < parsed.rows.length; i += 2000) {
        const r = await api<{ rows: number }>("/pos/import", { method: "POST", json: { kind, filename: file?.name, rows: parsed.rows.slice(i, i + 2000) } });
        total += r.rows;
      }
      toast(t("pos.done", { n: total }));
      setData(null);
      setFile(null);
      history.reload();
      saved.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const label = (f: string) => t(`pos.col_${f}` as MessageKey);
  const fmt = (f: string, v: unknown) => (v === null || v === undefined ? "—" : f === "date" ? formatDay(String(v)) : MONEY.has(f) ? formatINR(Number(v)) : String(v));

  return (
    <div className="page">
      <PageHead title={t("pos.title")} subtitle={t("pos.desc")} back="/manage" />
      <div className="card form">
        <Field label={t("pos.kind")}>
          <Segmented<PosKind> value={kind} onChange={setKind} options={[{ value: "sales", label: t("pos.kind_sales") }, { value: "items", label: t("pos.kind_items") }]} />
        </Field>
        <label className="photo-input">
          <span className="ph"><Icon name="upload" /></span>
          <span style={{ display: "grid", gap: 2 }}>
            <strong>{file ? file.name : t("pos.choose")}</strong>
            <span className="muted small">.xlsx · .csv</span>
          </span>
          <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <p className="muted small" style={{ margin: 0 }}>{t("pos.xls_note")}</p>
      </div>

      {data && (
        <div className="cols">
          <div className="card form">
            <h2>{t("pos.map")}</h2>
            <p className="muted small" style={{ margin: 0 }}>{t("pos.map_help")}</p>
            <Field label={t("pos.header_row")} htmlFor="pos-h">
              <select id="pos-h" className="select" value={header} onChange={(e) => setHeader(Number(e.target.value))}>
                {data.slice(0, 25).map((r, i) => (
                  <option key={i} value={i}>{i + 1}: {r.filter((c) => c !== null && c !== "").slice(0, 4).map(String).join(" · ")}</option>
                ))}
              </select>
            </Field>
            <div className="grid-2">
              {POS_FIELDS[kind].map((f) => (
                <Field key={f} label={`${label(f)}${POS_REQUIRED[kind].includes(f) ? "" : ` · ${t("common.optional")}`}`} htmlFor={`pos-${f}`}>
                  <select id={`pos-${f}`} className="select" value={cols[f] ?? ""} onChange={(e) => setCols({ ...cols, [f]: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">{t("pos.none")}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `#${i + 1}`}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            {kind === "items" && (cols.date === null || cols.date === undefined) && (
              <Field label={t("pos.single_date")} htmlFor="pos-single-date">
                <input id="pos-single-date" type="date" className="input" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="card form">
            <h2>{t("pos.preview", { n: parsed?.rows.length ?? 0 })}</h2>
            {parsed && parsed.skipped > 0 && <div className="check warn"><Icon name="alert" /><span className="t">{t("pos.bad_rows", { n: parsed.skipped })}</span></div>}
            {parsed && parsed.rows.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>{POS_FIELDS[kind].filter((f) => cols[f] !== null && cols[f] !== undefined || f === "date").map((f) => <th key={f}>{label(f)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        {POS_FIELDS[kind].filter((f) => cols[f] !== null && cols[f] !== undefined || f === "date").map((f) => <td key={f} style={{ textAlign: f === "item" || f === "category" || f === "date" ? "left" : "right" }}>{fmt(f, r[f])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ErrorNote error={error} />
            <button className="btn primary block" disabled={busy || missing.length > 0 || needsDate || !parsed?.rows.length} onClick={doImport}>
              <Icon name="upload" /> {t("pos.import")}
            </button>
          </div>
        </div>
      )}
      {!data && <ErrorNote error={error} />}

      <section className="form">
        <h2>{t("pos.history")}</h2>
        {!history.data ? <Loading /> : history.data.imports.length === 0 ? (
          <p className="muted">{t("common.none_yet")}</p>
        ) : (
          <div className="card flush list">
            {history.data.imports.map((i) => (
              <div className="row" key={i.id}>
                <Icon name="file" />
                <span className="grow">
                  <strong className="ellipsis">{i.filename ?? "—"}</strong>
                  <span className="muted small">
                    {i.kind === "sales" ? t("pos.kind_sales") : t("pos.kind_items")} · {i.from_date ? formatDay(i.from_date) : ""}{i.to_date && i.to_date !== i.from_date ? ` – ${formatDay(i.to_date)}` : ""} · {i.by_name}
                  </span>
                </span>
                <span className="amount">{i.rows}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
