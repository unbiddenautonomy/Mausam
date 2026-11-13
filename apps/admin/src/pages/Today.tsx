import { Link } from "react-router";
import { addDays, formatDay, formatINR, formatINRShort, type CloseFlag, type Lang } from "@mausam/shared";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { catName, clock } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorNote, Loading, Money, PageHead, Pill, Stat } from "../components/ui";
import { FlagList } from "./CloseDay";

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
  if (today.loading && !today.data) return <Loading />;
  if (!today.data) return <ErrorNote error={today.error ?? true} />;
  const d = today.data;
  return (
    <div className="page">
      <PageHead title={t("today.greeting", { name: user!.name.split(" ")[0] })} subtitle={formatDay(d.business_date)} />
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

function TaskList({ d }: { d: TodayData }) {
  const t = useSession().t;
  const shop = d.shopping;
  const tasks = [
    {
      to: "/entries/shopping",
      icon: "cart" as const,
      title: t("entries.shopping"),
      state: shop.status === "closed" ? "done" : shop.status === "open" ? "open" : "todo",
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
      sub: t("today.entries_count", { count: d.expenses.count, amount: formatINR(d.expenses.total) }),
    },
    {
      to: "/entries/close",
      icon: "moon" as const,
      title: t("entries.close"),
      state: d.close.status === "done" ? "done" : "todo",
      sub: d.close.close ? formatINR(d.close.close.total_counter) : t("today.due", { time: clock(d.settings.close_due) }),
    },
  ];
  const label = { done: t("status.done"), open: t("status.open"), todo: t("status.pending") } as const;
  return (
    <section className="section">
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
            <Pill tone={task.state === "done" ? "good" : task.state === "open" ? "warn" : undefined}>{label[task.state as keyof typeof label]}</Pill>
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
  last7: { business_date: string; total_counter: number | null; status: "on_time" | "late" | "missing" }[];
}

function OwnerOverview({ date }: { date: string }) {
  const { t, lang } = useSession();
  const s = useApi<Summary>(`/summary?date=${date}`);
  if (!s.data) return s.error ? <ErrorNote error={s.error} /> : <Loading />;
  const { close, compare } = s.data;
  const weekday = formatDay(addDays(date, -7)).split(",")[0];
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
        <div className="check bad"><Icon name="alert" /><span className="t">{t("home.no_close", { date: formatDay(date) })}</span></div>
      )}

      <section className="section">
        <h2>{t("home.flags")}</h2>
        {close && flags.length > 0 ? <FlagList flags={flags} /> : close ? <div className="check good"><Icon name="check" /><span className="t">{t("home.no_flags")}</span></div> : null}
      </section>

      <section className="section">
        <h2>{t("home.last7")}</h2>
        <Week7 rows={s.data.last7} />
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
  const t = useSession().t;
  const max = Math.max(1, ...rows.map((r) => r.total_counter ?? 0));
  return (
    <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, alignItems: "end" }}>
      {rows.map((r) => (
        <Link key={r.business_date} to={`/entries/close/${r.business_date}`} style={{ display: "grid", gap: 6, justifyItems: "center" }} title={`${formatDay(r.business_date)}: ${formatINR(r.total_counter)}`}>
          <span className="small num muted" style={{ fontSize: "0.7rem" }}>{r.total_counter ? formatINRShort(r.total_counter) : "–"}</span>
          <span style={{ width: "100%", maxWidth: 28, height: 80, display: "flex", alignItems: "flex-end" }}>
            <span style={{ width: "100%", height: `${Math.max(4, ((r.total_counter ?? 0) / max) * 80)}px`, borderRadius: "4px 4px 0 0", background: r.status === "missing" ? "var(--bad-soft)" : "var(--series-1)" }} />
          </span>
          <span className={`pill ${r.status === "on_time" ? "good" : r.status === "late" ? "warn" : "bad"}`} style={{ padding: "1px 6px", fontSize: "0.7rem" }} aria-label={t(r.status === "on_time" ? "reports.on_time" : r.status === "late" ? "reports.late" : "reports.missing")}>
            {formatDay(r.business_date).slice(0, 2)}
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
