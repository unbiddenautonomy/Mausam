import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { LANGUAGES, type Lang } from "@mausam/shared";
import { onQueueChange, queueSize } from "../lib/api";
import { useApi, useOnline } from "../lib/hooks";
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
  const location = useLocation();
  const [queued, setQueued] = useState(queueSize());
  useEffect(() => { const off = onQueueChange(setQueued); return () => void off(); }, []);
  // Re-check alerts on every page change so the bell stays current.
  // Employees (the "staff" role) only make entries and bill, so they have no alerts.
  const isStaff = user?.role === "staff";
  const alerts = useApi<{ alerts: { seen_at: string | null }[] }>(isStaff ? null : `/alerts?p=${encodeURIComponent(location.pathname)}`);
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
    ...(isStaff ? [] : [
      { to: "/people", icon: "users", label: t("nav.people") } as NavItem,
      { to: "/vendors", icon: "truck", label: t("nav.vendors") } as NavItem,
    ]),
  ];
  const insight: NavItem[] = isOwner ? [{ to: "/reports", icon: "reports", label: t("nav.reports") }, { to: "/month", icon: "calendar", label: t("nav.month") }] : [];
  const admin: NavItem[] = isOwner ? [{ to: "/manage", icon: "manage", label: t("nav.manage") }] : [];

  const tabs: NavItem[] = isOwner
    ? [...work.slice(0, 2), insight[0], { to: "/more", icon: "more", label: t("nav.more") }]
    : isStaff
      ? [...work.slice(0, 2), { to: "/more", icon: "more", label: t("nav.more") }]
      : [...work.slice(0, 2), { to: "/alerts", icon: "bell", label: t("nav.alerts") }, { to: "/more", icon: "more", label: t("nav.more") }];

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
        <div className="brand">
          <Logo /> {t("app.name")}
        </div>
        {work.map((n) => link(n))}
        {insight.length > 0 && <div className="side-group">{t("nav.reports")}</div>}
        {insight.map((n) => link(n))}
        {!isStaff && link({ to: "/alerts", icon: "bell", label: t("nav.alerts") }, unseen > 0 ? <span className="count">{unseen}</span> : null)}
        {admin.length > 0 && <div className="side-group">{t("nav.manage")}</div>}
        {admin.map((n) => link(n))}
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
          <span className="brand">
            <Logo /> {t("app.name")}
          </span>
          {!isStaff && (
            <NavLink to="/alerts" className="bell" aria-label={t("nav.alerts")}>
              <Icon name="bell" />
              {unseen > 0 && <span className="count">{unseen}</span>}
            </NavLink>
          )}
        </header>
        <main className="main">
          {!online && <div className="banner" style={{ marginBottom: 16 }}>{t("offline.banner")}</div>}
          {online && queued > 0 && <div className="banner" style={{ marginBottom: 16 }}>{t("offline.queued")} ({queued})</div>}
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
