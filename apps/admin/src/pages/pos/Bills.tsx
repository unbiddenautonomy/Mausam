import { useState } from "react";
import { addDays, businessDate, formatDay, formatINR } from "@mausam/shared";
import { useApi } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { clock } from "../../lib/format";
import { Icon } from "../../components/Icon";
import { Empty, Loading, PageHead, Pill, Stat } from "../../components/ui";

interface Bill {
  id: number; bill_no: string; order_type: "dine_in" | "parcel"; table_name: string | null; token: number | null; waiter_name: string | null;
  by_name: string | null; total: number; discount: number; tax: number; status: "paid" | "cancelled"; cancel_reason: string | null; closed_at: string;
  lines: { id: number; name: string; qty: number; amount: number; variation?: string | null; modifier?: string | null }[];
  payments: { mode: string; amount: number }[];
}
interface Counter { code: string; last_seen_at: string | null; last_bill_no: string | null }

/** Owner and managers: every POS bill for a day, with totals by payment mode and cancelled bills marked. */
export function BillsPage() {
  const { t } = useSession();
  const [date, setDate] = useState(businessDate());
  const res = useApi<{ bills: Bill[]; counters: Counter[] }>(`/billing/bills?date=${date}`);
  const [open, setOpen] = useState<number | null>(null);
  const bills = res.data?.bills ?? [];
  const paid = bills.filter((b) => b.status === "paid");
  const byMode = (m: string) => paid.reduce((s, b) => s + b.payments.filter((p) => (m === "online" ? p.mode !== "cash" : p.mode === m)).reduce((a, p) => a + p.amount, 0), 0);
  const today = businessDate();

  return (
    <div className="page">
      <PageHead title={t("bills.title")} subtitle={t("bills.desc")} back="/more" />
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn small" onClick={() => setDate(addDays(date, -1))} aria-label={t("common.back")}><Icon name="left" /></button>
        <strong style={{ flex: 1, textAlign: "center" }}>{formatDay(date)}</strong>
        <button className="btn small" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} aria-label="next"><Icon name="chevron" /></button>
      </div>
      {!res.data ? <Loading /> : (
        <>
          <div className="stats">
            <Stat hero label={t("bills.total")} value={formatINR(paid.reduce((s, b) => s + b.total, 0))} delta={t("bills.count", { n: paid.length })} />
            <Stat label={t("common.cash")} value={formatINR(byMode("cash"))} />
            <Stat label={t("common.online")} value={formatINR(byMode("online"))} />
            <Stat label={t("bills.cancelled")} value={formatINR(bills.filter((b) => b.status === "cancelled").reduce((s, b) => s + b.total, 0))} />
          </div>
          {res.data.counters.map((c) => (
            <p key={c.code} className="small muted">{t("bills.counter_seen", { code: c.code, time: c.last_seen_at ? new Date(c.last_seen_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—" })}</p>
          ))}
          {bills.length === 0 ? <Empty>{t("bills.none")}</Empty> : (
            <div className="card flush list">
              {bills.map((b) => (
                <div key={b.id}>
                  <button className="row row-link as-button" onClick={() => setOpen(open === b.id ? null : b.id)} style={{ opacity: b.status === "cancelled" ? 0.7 : 1 }}>
                    <span className="grow">
                      <strong>{b.bill_no} · {b.order_type === "parcel" ? `${t("bills.parcel")} #${b.token ?? ""}` : b.table_name ?? `#${b.token ?? ""}`}</strong>
                      <span className="muted small">{clock(new Date(b.closed_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }))} · {b.payments.map((p) => p.mode.toUpperCase()).join(" + ") || "—"}{b.waiter_name ? ` · ${b.waiter_name}` : ""}</span>
                    </span>
                    {b.status === "cancelled" && <Pill tone="bad">{t("bills.cancelled_one")}</Pill>}
                    <span className="amount">{formatINR(b.total)}</span>
                  </button>
                  {open === b.id && (
                    <div className="row" style={{ display: "grid", gap: 4, background: "var(--surface-2)" }}>
                      {b.lines.map((l) => (
                        <div key={l.id} className="small" style={{ display: "flex", justifyContent: "space-between" }}><span>{l.qty} × {l.name}{l.variation || l.modifier ? ` [${[l.variation, l.modifier].filter(Boolean).join(" · ")}]` : ""}</span><span className="num">{formatINR(l.amount)}</span></div>
                      ))}
                      {b.discount > 0 && <div className="small muted">{t("bills.discount")}: −{formatINR(b.discount)}</div>}
                      {b.tax > 0 && <div className="small muted">GST: {formatINR(b.tax)}</div>}
                      {b.cancel_reason && <div className="small" style={{ color: "var(--bad)" }}>{b.cancel_reason}</div>}
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
