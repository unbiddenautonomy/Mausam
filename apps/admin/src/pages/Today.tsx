import { Link } from "react-router";
import { addDays, DAY_START_HOUR, formatDay, weekdayShort, formatINR, formatINRShort, istMoment, type CloseFlag, type Lang } from "@mausam/shared";
import { useApi, useRefreshOnReturn } from "../lib/hooks";
import { useSession } from "../lib/session";
import { catName, clock } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorNote, Loading, Money, PageHead, Pill, Stat } from "../components/ui";
import { FlagList } from "./CloseDay";
import { NotifyCard } from "../components/NotifyCard";

interface TodayData {
  business_date: string;
  locked: boolean;
  settings: { close_due: string; shopping_due: string };
  shopping: { status: "not_started" | "open" | "closed"; trip: { float_out: number; spent: number; count: number } | null };
  expenses: { count: number; total: number };
  close: { status: "pending" | "done"; close: { total_counter: number; flags: CloseFlag[] } | null };
  open_alerts: number;
}

export function Today() {
  const { t, user } = useSession();
  const today = useApi<TodayData>("/today");
  useRefreshOnReturn(today.reload, today.data?.business_date);
  if (today.loading && !today.data) return <Loading />;
  if (!today.data) return <ErrorNote error={today.error ?? true} />;
  const d = today.data;
  return (
    <div className="page">
      <PageHead title={t("today.greeting", { name: user!.name.split(" ")[0] })} subtitle={formatDay(d.business_date)} />
      <NotifyCard compact />
      {user!.role === "owner" ? (
        <div className="cols">
          <OwnerOverview date={addDays(d.business_date, -1)} />
          <TaskList d={d} />
        </div>
      ) : (
        <TaskList d={d} />
      )}
    </div>
  );
}

/** When an "HH:MM" deadline falls for a business day (times before 5 am belong to the next calendar day). */
function dueAt(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return istMoment(h < DAY_START_HOUR ? addDays(date, 1) : date, h, m).getTime();
}

function TaskList({ d }: { d: TodayData }) {
  const { t, user } = useSession();
  const shop = d.shopping;
  const now = Date.now();
  const late = (hhmm: string) => now > dueAt(d.business_date, hhmm);
  const tasks: { to: string; icon: "cart" | "receipt" | "moon"; title: string; state: "done" | "open" | "todo" | "late"; sub: string; cta: string; ctaTo: string }[] = [
    {
      to: "/entries/shopping",
      icon: "cart" as const,
      title: t("entries.shopping"),
      state: shop.status === "closed" ? "done" : late(d.settings.shopping_due) ? "late" : shop.status === "open" ? "open" : "todo",
      cta: shop.status === "open" ? t("task.go_shopping_open") : t("task.go_shopping"),
      ctaTo: "/entries/shopping",
      sub:
        shop.status === "not_started"
          ? t("today.due", { time: clock(d.settings.shopping_due) })
          : t("today.spent_so_far", { amount: formatINR(shop.trip?.spent ?? 0) }),
    },
    {
      to: "/entries/expenses",
      icon: "receipt" as const,
      title: t("entries.expenses"),
      state: d.expenses.count > 0 ? "open" : "todo",
      cta: t("task.go_expense"),
      ctaTo: "/entries/expenses/new",
      sub: t("today.entries_count", { count: d.expenses.count, amount: formatINR(d.expenses.total) }),
    },
    {
      to: "/entries/close",
      icon: "moon" as const,
      title: t("entries.close"),
      state: d.close.status === "done" ? "done" : late(d.settings.close_due) ? "late" : "todo",
      cta: t("task.go_close"),
      ctaTo: "/entries/close",
      sub: d.close.close ? formatINR(d.close.close.total_counter) : t("today.due", { time: clock(d.settings.close_due) }),
    },
  ];
  const label = { done: t("status.done"), open: t("status.open"), todo: t("status.pending"), late: t("status.late") } as const;
  // For managers, put the one thing to do now at the top with a big button. Expenses are ongoing, so they're never "next".
  const next = user?.role === "owner" ? undefined : tasks.find((x) => x.icon !== "receipt" && x.state !== "done");
  const allDone = tasks[0].state === "done" && tasks[2].state === "done";
  return (
    <section className="section">
      {user?.role !== "owner" && (next ? (
        <div className={`card next-up${next.state === "late" ? " late" : ""}`}>
          <span className="eyebrow">{t("today.next_up")}</span>
          <div className="next-row">
            <span className="dot"><Icon name={next.icon} /></span>
            <span className="grow">
              <strong>{next.title}</strong>
              <span className="small">{next.sub}</span>
            </span>
            {next.state === "late" && <Pill tone="bad">{label.late}</Pill>}
          </div>
          <Link to={next.ctaTo} className="btn primary block big">{next.cta} <Icon name="chevron" /></Link>
        </div>
      ) : allDone ? (
        <div className="check good"><Icon name="check" /><span className="t">{t("today.all_done")}</span></div>
      ) : null)}
      <h2>{t("today.tasks")}</h2>
      <div className="card flush list">
        {tasks.map((task) => (
          <Link key={task.to} to={task.to} className={`row row-link task ${task.state}`}>
            <span className="dot">
              <Icon name={task.state === "done" ? "check" : task.icon} />
            </span>
            <span className="grow">
              <strong>{task.title}</strong>
              <span className="muted small">{task.sub}</span>
            </span>
            <Pill tone={task.state === "done" ? "good" : task.state === "late" ? "bad" : task.state === "open" ? "warn" : undefined}>{label[task.state]}</Pill>
          </Link>
        ))}
      </div>
    </section>
  );
}

interface Summary {
  business_date: string;
  close: { total_counter: number; cash: number; online: number; expenses: number; flags: CloseFlag[] } | null;
  compare: { total_counter: number } | null;
  expenses_by_category: { key: string; name: string; name_hi: string | null; name_kn: string | null; amount: number }[];
  no_receipt_total: number;
  /** What the POS billed that day, from its bills; there even when nobody did Day End. */
  pos?: { total: number; cash: number | null; online: number | null; bills: number | null } | null;
  last7: { business_date: string; total_counter: number | null; pos_total?: number | null; status: "on_time" | "late" | "missing" }[];
}

function OwnerOverview({ date }: { date: string }) {
  const { t, lang } = useSession();
  const s = useApi<Summary>(`/summary?date=${date}`);
  if (!s.data) return s.error ? <ErrorNote error={s.error} /> : <Loading />;
  const { close, compare } = s.data;
  const pos = s.data.pos ?? null;
  const weekday = weekdayShort(addDays(date, -7));
  const delta =
    close && compare
      ? t("home.vs_last_week", {
          diff: `${close.total_counter >= compare.total_counter ? "+" : ""}${formatINR(close.total_counter - compare.total_counter)}`,
          weekday,
        })
      : undefined;
  const flags = close?.flags ?? [];
  return (
    <div className="page" style={{ gap: 16 }}>
      <div className="section-head">
        <h2>{t("home.yesterday")} · {formatDay(date)}</h2>
        {close && (
          <Link className="small muted" to={`/entries/close/${date}`}>{t("common.view_all")}</Link>
        )}
      </div>
      {close ? (
        <div className="stats">
          <Stat hero label={t("home.sales")} value={<Money paise={close.total_counter} />} delta={delta} />
          <Stat label={t("home.expenses")} value={<Money paise={close.expenses} />} />
          <Stat label={t("home.cash")} value={<Money paise={close.cash} />} />
          <Stat label={t("home.online")} value={<Money paise={close.online} />} />
        </div>
      ) : (
        <>
          {pos && (
            <div className="stats">
              <Stat hero label={t("home.pos_sales")} value={<Money paise={pos.total} />} delta={pos.bills != null ? t("bills.count", { n: pos.bills }) : undefined} />
              {pos.cash != null && <Stat label={t("common.cash")} value={<Money paise={pos.cash} />} />}
              {pos.online != null && <Stat label={t("common.online")} value={<Money paise={pos.online} />} />}
            </div>
          )}
          <div className="check bad"><Icon name="alert" /><span className="t">{t("home.no_close", { date: formatDay(date) })}</span></div>
        </>
      )}

      {close && (
        <section className="section">
          <h2>{t("home.flags")}</h2>
          {flags.length > 0 ? <FlagList flags={flags} /> : <div className="check good"><Icon name="check" /><span className="t">{t("home.no_flags")}</span></div>}
        </section>
      )}

      <section className="section">
        <h2>{t("home.last7")}</h2>
        <Week7 rows={s.data.last7} />
        {s.data.last7.some((r) => r.total_counter == null && r.pos_total != null) && <p className="small muted">{t("home.week_pos_note")}</p>}
      </section>

      {s.data.expenses_by_category.length > 0 && (
        <section className="section">
          <h2>{t("home.by_category")}</h2>
          <CategoryBars rows={s.data.expenses_by_category} lang={lang} />
          {s.data.no_receipt_total > 0 && <p className="small muted">{t("home.no_receipt", { amount: formatINR(s.data.no_receipt_total) })}</p>}
        </section>
      )}
    </div>
  );
}

function Week7({ rows }: { rows: Summary["last7"] }) {
  const { t, lang } = useSession();
  // A day nobody closed still shows what the POS billed (in a lighter bar), so missing Day End doesn't blank the week.
  const value = (r: Summary["last7"][number]) => r.total_counter ?? r.pos_total ?? null;
  const max = Math.max(1, ...rows.map((r) => value(r) ?? 0));
  return (
    <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, alignItems: "end" }}>
      {rows.map((r) => (
        <Link key={r.business_date} to={`/entries/close/${r.business_date}`} style={{ display: "grid", gap: 6, justifyItems: "center" }} title={`${formatDay(r.business_date)}: ${formatINR(value(r))}`}>
          <span className="small num muted" style={{ fontSize: "0.7rem" }}>{value(r) ? formatINRShort(value(r)!) : "–"}</span>
          <span style={{ width: "100%", maxWidth: 28, height: 80, display: "flex", alignItems: "flex-end" }}>
            <span style={{ width: "100%", height: `${Math.max(4, ((value(r) ?? 0) / max) * 80)}px`, borderRadius: "4px 4px 0 0", background: value(r) != null ? "var(--series-1)" : "var(--bad-soft)", opacity: r.total_counter == null && r.pos_total != null ? 0.45 : 1 }} />
          </span>
          <span className={`pill ${r.status === "on_time" ? "good" : r.status === "late" ? "warn" : "bad"}`} style={{ padding: "1px 6px", fontSize: "0.7rem" }} aria-label={t(r.status === "on_time" ? "reports.on_time" : r.status === "late" ? "reports.late" : "reports.missing")}>
            {lang === "en" ? weekdayShort(r.business_date).slice(0, 2) : weekdayShort(r.business_date)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function CategoryBars({ rows, lang }: { rows: { key: string; name?: string; name_en?: string; name_hi: string | null; name_kn: string | null; amount: number }[]; lang: Lang }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="card bar-list">
      {rows.map((r) => (
        <div className="bar-item" key={r.key}>
          <div className="top">
            <span>{catName(r, lang)}</span>
            <span className="num">
              <strong>{formatINR(r.amount)}</strong> <span className="faint">{Math.round((r.amount / total) * 100)}%</span>
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.amount / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
