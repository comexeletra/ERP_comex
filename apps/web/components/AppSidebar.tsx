"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { roleLabel } from "../lib/i18n/labels";
import type { Messages } from "../lib/i18n/pt-BR";
import { useI18n } from "./I18nProvider";
import LanguageSwitcher from "./LanguageSwitcher";

type IconName = "orders" | "ship" | "flow" | "reports" | "sheet" | "requests" | "catalog"
  | "sc" | "noIp" | "noPo" | "quality" | "users" | "events" | "collapse" | "password" | "logout" | "sun" | "moon";
type SidebarItem = {
  label: keyof Messages["sidebar"]["items"]; href: string; icon: IconName; match?: string[]; exclude?: string[]; exact?: boolean;
};
type SidebarGroup = { label: keyof Messages["sidebar"]["groups"]; items: SidebarItem[] };

const groups: SidebarGroup[] = [
  { label: "operation", items: [
    { label: "preShipment", href: "/", icon: "orders", match: ["/purchase-orders"],
      exclude: ["/purchase-orders/lines"] },
    { label: "productPortfolio", href: "/purchase-orders/lines", icon: "sheet" },
    { label: "postShipment", href: "/processes", icon: "ship" },
    { label: "endToEnd", href: "/end-to-end", icon: "flow" },
  ] },
  { label: "management", items: [
    { label: "requests", href: "/requests", icon: "requests" },
    { label: "catalog", href: "/catalog", icon: "catalog", exact: true },
  ] },
];

const adminGroup: SidebarGroup = { label: "admin", items: [
  { label: "users", href: "/admin/users", icon: "users" },
  { label: "outbox", href: "/admin/outbox", icon: "events" },
] };

const pcmGroup: SidebarGroup = { label: "pcm", items: [
  { label: "purchaseRequests", href: "/pcm", icon: "sc" },
] };

const icons: Record<IconName, ReactNode> = {
  orders: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  ship: <><path d="m3 17 2 2h14l2-2-3-2H6z" /><path d="M12 3v12m0-12 4 4m-4-4L8 7M5 15l2-3h10l2 3" /></>,
  flow: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></>,
  reports: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
  sheet: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
  requests: <><path d="M4 4h16v13H8l-4 3z" /><path d="M8 9h8M8 13h5" /></>,
  catalog: <><path d="m4 5 6-2 10 4v14l-10-4-6 2z" /><path d="M10 3v14m0 0 10-3" /></>,
  sc: <><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8 12h8M8 16h8" /></>,
  noIp: <><path d="M8 12a4 4 0 0 1 4-4h3" /><path d="M16 12a4 4 0 0 1-4 4H9" /><path d="m4 4 16 16" /></>,
  noPo: <><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8 13h8M8 17h5" /><path d="m16 12 4 4m0-4-4 4" /></>,
  quality: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1zM16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1h-3" /></>,
  events: <><path d="M4 19V5m0 14h16" /><path d="m7 14 3-4 3 2 5-6" /><circle cx="18" cy="6" r="2" /></>,
  collapse: <><path d="m14 6-6 6 6 6" /></>,
  password: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-3 3" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z" />,
};

function SidebarIcon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function isItemActive(pathname: string, item: SidebarItem) {
  if (item.exclude?.some(path => pathname === path || pathname.startsWith(`${path}/`))) return false;
  if (item.match?.some(path => pathname === path || pathname.startsWith(`${path}/`))) return true;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
}

export default function AppSidebar({ collapsed, isMaster, displayName, roles, importerScopes, theme, onToggleTheme, onToggle, onLogout }: {
  collapsed: boolean; isMaster: boolean; displayName: string | null; roles: string[];
  importerScopes: string[]; theme: "light" | "dark"; onToggleTheme: () => void; onToggle: () => void; onLogout: () => void;
}) {
  const pathname = usePathname();
  const { locale, m } = useI18n();
  const t = m.sidebar;
  const visibleGroups = [
    ...groups,
    ...(isMaster ? [adminGroup] : []),
    ...(isMaster || roles.includes("Administrador") || roles.includes("PCM") ? [pcmGroup] : []),
  ];
  const userName = displayName ?? t.authenticatedUser;
  const initials = userName.split(/\s+/u).filter(Boolean).slice(0, 2).map(name => name[0]).join("").toLocaleUpperCase(locale);
  const roleText = roles.length > 0 ? roles.map(role => roleLabel(m, role)).join(", ") : t.noRole;
  const importerText = isMaster ? t.allImporters : importerScopes.length > 0 ? importerScopes.join(", ") : t.noImporters;

  return <aside className={collapsed ? "app-sidebar is-collapsed" : "app-sidebar"}>
    <Link className="sidebar-brand" href="/" aria-label={t.homeLabel}>
      <span className="sidebar-brand-mark">EC</span>
      <span className="sidebar-brand-copy">ERP Comex<small>{t.brandSubtitle}</small></span>
    </Link>
    <button className="sidebar-toggle" type="button" onClick={onToggle}
      aria-label={collapsed ? t.expandAria : t.collapseAria}
      title={collapsed ? t.expandTitle : t.collapseTitle}>
      <SidebarIcon name="collapse" />
      <span>{collapsed ? t.expand : t.collapse}</span>
    </button>
    <nav className="sidebar-navigation" aria-label={t.navigation}>
      {visibleGroups.map(group => <section className="sidebar-group" key={group.label}>
        <h2>{t.groups[group.label]}</h2>
        <ul>{group.items.map(item => {
          const active = isItemActive(pathname, item);
          const label = `${t.groups[group.label]}: ${t.items[item.label]}`;
          return <li key={item.href}><Link href={item.href} className={active ? "sidebar-link active" : "sidebar-link"}
            aria-current={active ? "page" : undefined} aria-label={collapsed ? label : undefined}
            title={collapsed ? label : undefined}>
            <SidebarIcon name={item.icon} /><span>{t.items[item.label]}</span>
          </Link></li>;
      })}</ul>
      </section>)}
    </nav>
    <section className="sidebar-account" aria-label={t.account}>
      <div className="sidebar-user" title={collapsed ? `${userName} · ${t.role(roleText)} · ${t.importers(importerText)}` : undefined}>
        <span className="sidebar-avatar" aria-hidden="true">{initials || "U"}</span>
        <span className="sidebar-user-copy"><strong>{userName}</strong><small>{t.role(roleText)}</small><small>{t.importers(importerText)}</small></span>
      </div>
      <LanguageSwitcher className="sidebar-language" />
      <button className="sidebar-account-action" type="button" onClick={onToggleTheme}
        aria-label={theme === "dark" ? t.lightThemeAria : t.darkThemeAria}
        aria-pressed={theme === "dark"} title={collapsed ? (theme === "dark" ? t.lightThemeAria : t.darkThemeAria) : undefined}>
        <SidebarIcon name={theme === "dark" ? "sun" : "moon"} />
        <span>{theme === "dark" ? t.lightTheme : t.darkTheme}</span>
      </button>
      <Link className="sidebar-account-action" href="/change-password" title={collapsed ? t.changePassword : undefined}>
        <SidebarIcon name="password" /><span>{t.changePassword}</span>
      </Link>
      <button className="sidebar-account-action" type="button" onClick={onLogout}
        title={collapsed ? t.logout : undefined}>
        <SidebarIcon name="logout" /><span>{t.logout}</span>
      </button>
    </section>
  </aside>;
}
