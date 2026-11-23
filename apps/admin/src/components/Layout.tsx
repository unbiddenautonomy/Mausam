import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { formatDay, formatTime, LANGUAGES, type Lang } from "@mausam/shared";
import { failedEntries, onQueueChange, queueSize } from "../lib/api";
import { useApi, useOnline, useShowingSavedCopy } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Icon, Logo, type IconName } from "./Icon";
import { Toaster } from "./ui";

interface NavItem {
  to: string;
  icon: IconName;
  label: string;
  end?: boolean;
}

export function Layout() {
  const { t, user, lang, setLang, signOut } = useSession();
  const online = useOnline();
  const savedCopyAt = useShowingSavedCopy();
  const location = useLocation();
  const [queued, setQueued] = useState(queueSize());
  const [failed, setFailed] = useState(failedEntries().length);
  useEffect(() => {
    const off = onQueueChange((n, f) => (setQueued(n), setFailed(f)));
    return () => void off();
  }, []);
  // Re-check alerts on every page change so the bell stays current.
  const alerts = useApi<{ alerts: { seen_at: string | null }[] }>(`/alerts?p=${encodeURIComponent(location.pathname)}`);
  const unseen = alerts.data?.alerts.filter((a) => !a.seen_at).length ?? 0;

  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unseen > 0) nav.setAppBadge?.(unseen).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unseen]);

  const isOwner = user?.role === "owner";
  const work: NavItem[] = [
    { to: "/", icon: "today", label: t("nav.today"), end: true },
    { to: "/entries", icon: "entries", label: t("nav.entries") },
    { to: "/people", icon: "users", label: t("nav.people") },
    { to: "/vendors", icon: "truck", label: t("nav.vendors") },
  ];
  const insight: NavItem[] = isOwner
    ? [{ to: "/reports", icon: "reports", label: t("nav.reports") }, { to: "/month", icon: "calendar", label: t("nav.month") }]
    : [{ to: "/reports", icon: "reports", label: t("nav.reports") }];
  const admin: NavItem[] = isOwner ? [{ to: "/manage", icon: "manage", label: t("nav.manage") }] : [];

  const tabs: NavItem[] = isOwner
    ? [...work.slice(0, 2), insight[0], { to: "/more", icon: "more", label: t("nav.more") }]
    : [...work.slice(0, 2), insight[0], { to: "/more", icon: "more", label: t("nav.more") }];

  const link = (n: NavItem, extra?: React.ReactNode) => (
    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
      <Icon name={n.icon} />
      {n.label}
      {extra}
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <Link to="/" className="brand" aria-label={t("nav.home")}>
          <Logo /> {t("app.name")}
        </Link>
        {/* The POS is a separate app at /pos/; owners and managers jump there from here. */}
        <a href="/pos/" className="side-pos">
          <Icon name="pos" /> {t("pos_only.open")}
        </a>
        {work.map((n) => link(n))}
        {insight.length > 0 && <div className="side-group">{t("nav.reports")}</div>}
        {insight.map((n) => link(n))}
        {link({ to: "/alerts", icon: "bell", label: t("nav.alerts") }, unseen > 0 ? <span className="count">{unseen}</span> : null)}
        {admin.length > 0 && <div className="side-group">{t("nav.manage")}</div>}
        {admin.map((n) => link(n))}
        <div className="side-group" />
        {link({ to: "/more", icon: "more", label: t("nav.more") })}
        <div className="side-foot">
          <div className="small">
            <strong>{user?.name}</strong>
            <div className="muted">{user ? t(`role.${user.role}` as const) : ""}</div>
          </div>
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("common.language")}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <button className="btn small" onClick={signOut}>
            <Icon name="logout" /> {t("common.logout")}
          </button>
        </div>
      </aside>

      <div>
        <header className="topbar">
          <Link to="/" className="brand" aria-label={t("nav.home")}>
            <Logo /> {t("app.name")}
          </Link>
          {location.pathname !== "/" && (
            <Link to="/" className="top-btn" title={t("nav.home")}>
              <Icon name="today" /> <span className="top-label">{t("nav.home")}</span>
            </Link>
          )}
          <a href="/pos/" className="top-btn pos" title={t("pos_only.open")}>
            <Icon name="pos" /> <span className="top-label">{t("nav.pos")}</span>
          </a>
          <NavLink to="/alerts" className="bell" aria-label={t("nav.alerts")}>
            <Icon name="bell" />
            {unseen > 0 && <span className="count">{unseen}</span>}
          </NavLink>
        </header>
        <main className="main">
          {!online && <div className="banner" style={{ marginBottom: 16 }}>{t("offline.banner")}</div>}
          {savedCopyAt !== null && <div className="banner" style={{ marginBottom: 16 }}>{t("offline.saved_copy", { time: `${formatDay(new Date(savedCopyAt + 330 * 60_000).toISOString().slice(0, 10), false)} ${formatTime(new Date(savedCopyAt))}` })}</div>}
          {online && queued > 0 && <div className="banner" style={{ marginBottom: 16 }}>{t("offline.queued")} ({queued})</div>}
          {failed > 0 && location.pathname !== "/entries/unsent" && (
            <Link to="/entries/unsent" className="banner bad" style={{ display: "block", marginBottom: 16 }}>{t("unsent.banner", { n: failed })}</Link>
          )}
          <Outlet />
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {tabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
            <Icon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <Toaster />
    </div>
  );
}
