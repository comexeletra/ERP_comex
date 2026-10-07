"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type IconName = "orders" | "ship" | "reports" | "sheet" | "requests" | "catalog"
  | "values" | "noIp" | "noPo" | "quality" | "users" | "events" | "collapse";
type SidebarItem = { label: string; href: string; icon: IconName; match?: string[]; exact?: boolean };
type SidebarGroup = { label: string; items: SidebarItem[] };

const groups: SidebarGroup[] = [
  { label: "Operação", items: [
    { label: "Carteira de POs", href: "/", icon: "orders", match: ["/purchase-orders"] },
    { label: "Processos de importação", href: "/processes", icon: "ship" },
  ] },
  { label: "Relatórios", items: [
    { label: "Indicadores", href: "/reports", icon: "reports" },
    { label: "Planilha de origem", href: "/source-audit", icon: "sheet" },
  ] },
  { label: "Gestão", items: [
    { label: "Solicitações", href: "/requests", icon: "requests" },
    { label: "Cadastros", href: "/catalog", icon: "catalog", exact: true },
    { label: "Valores de entidades", href: "/catalog/values", icon: "values" },
  ] },
  { label: "Pendências", items: [
    { label: "Itens sem IP", href: "/pending-import-items", icon: "noIp" },
    { label: "Itens sem PO", href: "/unassigned-po-items", icon: "noPo" },
    { label: "Revisar qualidade", href: "/quality", icon: "quality" },
  ] },
];

const adminGroup: SidebarGroup = { label: "Administração", items: [
  { label: "Gerenciar acessos", href: "/admin/users", icon: "users" },
  { label: "Fila de eventos", href: "/admin/outbox", icon: "events" },
] };

const icons: Record<IconName, ReactNode> = {
  orders: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  ship: <><path d="m3 17 2 2h14l2-2-3-2H6z" /><path d="M12 3v12m0-12 4 4m-4-4L8 7M5 15l2-3h10l2 3" /></>,
  reports: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
  sheet: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
  requests: <><path d="M4 4h16v13H8l-4 3z" /><path d="M8 9h8M8 13h5" /></>,
  catalog: <><path d="m4 5 6-2 10 4v14l-10-4-6 2z" /><path d="M10 3v14m0 0 10-3" /></>,
  values: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
  noIp: <><path d="M8 12a4 4 0 0 1 4-4h3" /><path d="M16 12a4 4 0 0 1-4 4H9" /><path d="m4 4 16 16" /></>,
  noPo: <><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8 13h8M8 17h5" /><path d="m16 12 4 4m0-4-4 4" /></>,
  quality: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1zM16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1h-3" /></>,
  events: <><path d="M4 19V5m0 14h16" /><path d="m7 14 3-4 3 2 5-6" /><circle cx="18" cy="6" r="2" /></>,
  collapse: <><path d="m14 6-6 6 6 6" /></>,
};

function SidebarIcon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function isItemActive(pathname: string, item: SidebarItem) {
  if (item.match?.some(path => pathname === path || pathname.startsWith(`${path}/`))) return true;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
}

export default function AppSidebar({ collapsed, isMaster, onToggle }: {
  collapsed: boolean; isMaster: boolean; onToggle: () => void;
}) {
  const pathname = usePathname();
  const visibleGroups = isMaster ? [...groups, adminGroup] : groups;

  return <aside className={collapsed ? "app-sidebar is-collapsed" : "app-sidebar"}>
    <Link className="sidebar-brand" href="/" aria-label="ERP Comex, carteira de POs">
      <span className="sidebar-brand-mark">EC</span>
      <span className="sidebar-brand-copy">ERP Comex<small>Gestão de importações</small></span>
    </Link>
    <button className="sidebar-toggle" type="button" onClick={onToggle}
      aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
      title={collapsed ? "Expandir menu" : "Recolher menu"}>
      <SidebarIcon name="collapse" />
      <span>{collapsed ? "Expandir" : "Recolher menu"}</span>
    </button>
    <nav className="sidebar-navigation" aria-label="Navegação principal">
      {visibleGroups.map(group => <section className="sidebar-group" key={group.label}>
        <h2>{group.label}</h2>
        <ul>{group.items.map(item => {
          const active = isItemActive(pathname, item);
          return <li key={item.href}><Link href={item.href} className={active ? "sidebar-link active" : "sidebar-link"}
            aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}>
            <SidebarIcon name={item.icon} /><span>{item.label}</span>
          </Link></li>;
        })}</ul>
      </section>)}
    </nav>
  </aside>;
}
