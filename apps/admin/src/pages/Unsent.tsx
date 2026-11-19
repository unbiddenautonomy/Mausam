import { useEffect, useState } from "react";
import { formatDay, formatINR } from "@mausam/shared";
import { ApiError, dropFailed, failedEntries, onQueueChange, retryFailed, type Failed } from "../lib/api";
import { useSession } from "../lib/session";
import { Empty, errorKey, PageHead } from "../components/ui";

/** What a refused entry was, in a few words: the kind, the day and the amount. */
function describe(f: Failed, t: ReturnType<typeof useSession>["t"]): { title: string; detail: string } {
  const j = (f.json ?? {}) as Record<string, unknown>;
  const close = f.path.match(/^\/closes\/(\d{4}-\d{2}-\d{2})$/);
  if (close) return { title: t("unsent.close"), detail: `${formatDay(close[1])} · ${formatINR(Number(j.total_counter) || 0)}` };
  const date = typeof j.business_date === "string" ? formatDay(j.business_date) : "";
  const amount = typeof j.amount === "number" ? formatINR(j.amount) : "";
  return { title: f.path.startsWith("/expenses") ? t("unsent.expense") : f.path, detail: [date, amount].filter(Boolean).join(" · ") };
}

/** Entries saved offline that the server refused. They stay here until sent again or deleted. */
export function Unsent() {
  const t = useSession().t;
  const [list, setList] = useState(failedEntries());
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  useEffect(() => {
    const off = onQueueChange(() => setList(failedEntries()));
    return () => void off();
  }, []);

  async function retry(f: Failed) {
    setBusy(f.at);
    try {
      await retryFailed(f);
    } catch (e) {
      setErrors((x) => ({ ...x, [f.at]: e instanceof ApiError ? e.code : "offline" }));
    } finally {
      setBusy(null);
    }
  }
  function remove(f: Failed) {
    if (window.confirm(t("unsent.delete_confirm"))) dropFailed(f);
  }

  return (
    <div className="page">
      <PageHead title={t("unsent.title")} back="/" />
      <p className="muted">{t("unsent.help")}</p>
      <div className="card flush list">
        {list.length === 0 && <Empty>{t("unsent.empty")}</Empty>}
        {list.map((f) => {
          const d = describe(f, t);
          return (
            <div key={`${f.at}-${f.path}`} className="row">
              <span className="grow">
                <strong>{d.title}</strong>
                <span className="muted small num">{d.detail}</span>
                <span className="small">{t(errorKey(errors[f.at] ?? f.error))}</span>
              </span>
              <button className="btn small" disabled={busy === f.at} onClick={() => remove(f)}>{t("common.delete")}</button>
              <button className="btn small primary" disabled={busy === f.at} onClick={() => void retry(f)}>{t("unsent.retry")}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
