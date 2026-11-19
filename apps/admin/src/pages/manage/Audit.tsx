import { useEffect, useState } from "react";
import { formatDay, formatINR, type MessageKey } from "@mausam/shared";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { dateIST, timeIST } from "../../lib/format";
import { ErrorNote, Loading, PageHead, Pill } from "../../components/ui";

interface Entry { id: number; table_name: string; row_id: number; action: "create" | "update" | "delete"; before: string | null; after: string | null; at: string; user_name: string | null }

const TABLES: Record<string, MessageKey> = {
  expenses: "entries.expenses", day_closes: "entries.close", shopping_trips: "entries.shopping", staff: "manage.staff", users: "manage.users",
  advances: "people.advances", payroll: "people.payroll", vendors: "vendor.title", vendor_items: "vendor.items", deliveries: "delivery.add",
  vendor_payments: "payment.add", month_closes: "month.title", pos_imports: "pos.title",
  settings: "manage.settings", expense_categories: "manage.categories", dining_tables: "tables.title", attendance: "people.attendance",
  pos_counters: "posset.counters",
};
const SKIP = new Set(["id", "created_at", "updated_at", "submitted_at", "created_by", "submitted_by", "flags", "category_name_hi", "category_name_kn"]);

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number" && /amount|total|cash|online|expenses|pos_sales|rate|due|float|gross|net|adjustment|advances|tally/.test(key)) return formatINR(v);
  return String(v);
}

function changes(e: Entry): [string, unknown, unknown][] {
  const b = e.before ? JSON.parse(e.before) : {};
  const a = e.after ? JSON.parse(e.after) : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !SKIP.has(k));
  if (e.action === "update") return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]) && k in a).map((k) => [k, b[k], a[k]]);
  const src = e.action === "create" ? a : b;
  return keys.filter((k) => src[k] !== null && src[k] !== undefined && typeof src[k] !== "object").map((k) => [k, e.action === "create" ? undefined : src[k], e.action === "create" ? src[k] : undefined]);
}

export function AuditPage() {
  const { t } = useSession();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(true);
  const [table, setTable] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function load(reset: boolean) {
    try {
      const before = !reset && entries?.length ? entries[entries.length - 1].id : "";
      const r = await api<{ entries: Entry[] }>(`/analytics/audit?before=${before}&table=${table}`);
      setEntries(reset ? r.entries : [...(entries ?? []), ...r.entries]);
      setMore(r.entries.length === 50);
    } catch (e) {
      setError(e);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(true), [table]);

  const tone = { create: "good", update: "warn", delete: "bad" } as const;
  const actionLabel = { create: t("audit.created"), update: t("audit.updated"), delete: t("audit.deleted") };
  return (
    <div className="page">
      <PageHead
        title={t("audit.title")}
        subtitle={t("audit.desc")}
        back="/manage"
        action={
          <select className="select" style={{ width: "auto" }} value={table} onChange={(e) => setTable(e.target.value)} aria-label={t("audit.filter")}>
            <option value="">{t("audit.all")}</option>
            {Object.entries(TABLES).map(([k, key]) => <option key={k} value={k}>{t(key)}</option>)}
          </select>
        }
      />
      <ErrorNote error={error} />
      {!entries ? <Loading /> : (
        <div className="card flush list">
          {entries.length === 0 && <div className="row muted">{t("common.none_yet")}</div>}
          {entries.map((e) => {
            const diff = changes(e);
            return (
              <details key={e.id} className="audit-row">
                <summary className="row">
                  <span className="grow">
                    <strong className="ellipsis">{TABLES[e.table_name] ? t(TABLES[e.table_name]) : e.table_name} #{e.row_id}</strong>
                    <span className="muted small">{formatDay(dateIST(e.at))} {timeIST(e.at)} · {e.user_name ?? "—"}</span>
                  </span>
                  <Pill tone={tone[e.action]}>{actionLabel[e.action]}</Pill>
                </summary>
                {diff.length > 0 && (
                  <table className="data" style={{ margin: "0 0 8px" }}>
                    <tbody>
                      {diff.map(([k, b, a]) => (
                        <tr key={k}>
                          <td className="muted">{k}</td>
                          {e.action === "update" && <td className="r"><s className="muted">{show(k, b)}</s></td>}
                          <td className="r">{show(k, e.action === "delete" ? b : a)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
            );
          })}
        </div>
      )}
      {entries && more && <button className="btn block" onClick={() => load(false)}>{t("audit.more")}</button>}
    </div>
  );
}
