import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Page title block used by every screen. `back` is only for detail or creation pages:
 * screens reachable from the sidebar do not show it. `children` holds the intro
 * paragraphs and `actions` the main buttons or related links.
 */
export default function PageHeader({ eyebrow, title, back, actions, children, className }: {
  eyebrow?: ReactNode; title: ReactNode; back?: { href: string; label: string };
  actions?: ReactNode; children?: ReactNode; className?: string;
}) {
  return <>
    {back && <Link className="back" href={back.href}>{back.label}</Link>}
    <header className={className ? `page-header ${className}` : "page-header"}>
      <div className="page-header-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  </>;
}
