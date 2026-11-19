import { useState } from "react";
import { businessDate, dateLocale, formatINR, formatTime, type MessageKey } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { billFlagText, DayStepper, discountReasonText, Empty, Loading, PageHead, Pill, Stat } from "../../components/ui";

interface Bill {
  id: number; bill_no: string; order_type: "dine_in" | "parcel"; table_name: string | null; token: number | null; waiter_name: string | null;
  by_name: string | null; total: number; discount: number; tax: number; status: "paid" | "cancelled"; cancel_reason: string | null; closed_at: string;
  discount_reason?: string | null; flags?: string | null; printed_bill_no?: string | null;
  lines: { id: number; name: string; qty: number; amount: number; variation?: string | null; modifier?: string | null }[];
  payments: { mode: string; amount: number }[];
}
interface Counter { code: string; last_seen_at: string | null; last_bill_no: string | null }
/** A bill a POS sent that the server refused, and nobody has sent again since. */
interface Reject { client_id: string; bill_no: string | null; counter: string | null; total: number | null; reason: string; reported_at: string; by_name: string | null }

/** Owner and managers: every POS bill for a day, with totals by payment mode and cancelled bills marked. */
export function BillsPage() {
  const { t } = useSession();
  const [date, setDate] = useState(businessDate());
  const res = useApi<{ bills: Bill[]; counters: Counter[]; rejects?: Reject[] }>(`/billing/bills?date=${date}`);
  const rejects = res.data?.rejects ?? [];
  const reason = (code: string) => {
    const key = `bill_error.${code}` as MessageKey;
    const text = t(key);
    return text === key ? code : text;
  };
  const [open, setOpen] = useState<number | null>(null);
  const bills = res.data?.bills ?? [];
  const paid = bills.filter((b) => b.status === "paid");
  const byMode = (m: string) => paid.reduce((s, b) => s + b.payments.filter((p) => (m === "online" ? p.mode !== "cash" : p.mode === m)).reduce((a, p) => a + p.amount, 0), 0);
  const today = businessDate();

  return (
    <div className="page">
      <PageHead title={t("bills.title")} subtitle={t("bills.desc")} back="/more" />
      <DayStepper date={date} max={today} onChange={setDate} />
      {!res.data ? <Loading /> : (
        <>
          <div className="stats">
            <Stat hero label={t("bills.total")} value={formatINR(paid.reduce((s, b) => s + b.total, 0))} delta={t("bills.count", { n: paid.length })} />
            <Stat label={t("common.cash")} value={formatINR(byMode("cash"))} />
            <Stat label={t("common.online")} value={formatINR(byMode("online"))} />
            <Stat label={t("bills.cancelled")} value={formatINR(bills.filter((b) => b.status === "cancelled").reduce((s, b) => s + b.total, 0))} />
          </div>
          {res.data.counters.map((c) => (
            <p key={c.code} className="small muted">{t("bills.counter_seen", { code: c.code, time: c.last_seen_at ? new Date(c.last_seen_at).toLocaleString(dateLocale(), { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—" })}</p>
          ))}
          {rejects.length > 0 && (
            <section className="form">
              <h2>{t("bills.refused")}</h2>
              <p className="muted small" style={{ margin: 0 }}>{t("bills.refused_help")}</p>
              <div className="card flush list">
                {rejects.map((r) => (
                  <div key={r.client_id} className="row">
                    <span className="grow">
                      <strong>{r.bill_no ?? "—"}</strong>
                      <span className="muted small">{reason(r.reason)}{r.by_name ? ` · ${r.by_name}` : ""}</span>
                    </span>
                    <Pill tone="bad">{t("bills.refused")}</Pill>
                    <span className="amount">{r.total === null ? "—" : formatINR(r.total)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {bills.length === 0 ? <Empty>{t("bills.none")}</Empty> : (
            <div className="card flush list">
              {bills.map((b) => (
                <div key={b.id}>
                  <button className="row row-link as-button" onClick={() => setOpen(open === b.id ? null : b.id)} style={{ opacity: b.status === "cancelled" ? 0.7 : 1 }}>
                    <span className="grow">
                      <strong>{b.bill_no} · {b.order_type === "parcel" ? `${t("bills.parcel")} #${b.token ?? ""}` : b.table_name ?? `#${b.token ?? ""}`}</strong>
                      <span className="muted small">{formatTime(new Date(b.closed_at))} · {b.payments.map((p) => p.mode.toUpperCase()).join(" + ") || "—"}{b.waiter_name ? ` · ${b.waiter_name}` : ""}</span>
                    </span>
                    {b.flags && <Pill tone="warn">{t("reports.flagged")}</Pill>}
                    {b.status === "cancelled" && <Pill tone="bad">{t("bills.cancelled_one")}</Pill>}
                    <span className="amount">{formatINR(b.total)}</span>
                  </button>
                  {open === b.id && (
                    <div className="row" style={{ display: "grid", gap: 4, background: "var(--surface-2)" }}>
                      {b.lines.map((l) => (
                        <div key={l.id} className="small" style={{ display: "flex", justifyContent: "space-between" }}><span>{l.qty} × {l.name}{l.variation || l.modifier ? ` [${[l.variation, l.modifier].filter(Boolean).join(" · ")}]` : ""}</span><span className="num">{formatINR(l.amount)}</span></div>
                      ))}
                      {b.discount > 0 && (
                        <div className="small muted">
                          {t("bills.discount")}: −{formatINR(b.discount)} · {b.discount_reason ? discountReasonText(t, b.discount_reason) : t("reports.no_reason")}
                        </div>
                      )}
                      {b.flags && <div className="small" style={{ color: "var(--warn)" }}>{billFlagText(t, b.flags)}</div>}
                      {b.tax > 0 && <div className="small muted">{t("bills.gst", { amount: formatINR(b.tax) })}</div>}
                      {b.cancel_reason && <div className="small" style={{ color: "var(--bad)" }}>{b.cancel_reason}</div>}
                      {b.printed_bill_no && <div className="small muted">{t("bills.printed_as", { no: b.printed_bill_no })}</div>}
                      {b.by_name && <div className="small muted">{b.by_name}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
