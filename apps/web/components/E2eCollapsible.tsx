"use client";

import { useCallback, useId, useSyncExternalStore, type ReactNode } from "react";
import { readCollapsed, writeCollapsed } from "../lib/collapsed-panels";
import { Icon, type E2eFlowIconName } from "./E2eFlowParts";
import { useI18n } from "./I18nProvider";

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * A block of the End to End screen that the viewer can hide, identified by its icon and title. While
 * hidden it keeps a card-like strip with a summary of what it holds and how many filters it still
 * applies. Each viewer's choice is remembered in the browser.
 */
export default function E2eCollapsible({ title, icon, storageKey, activeCount, collapsedSummary, className, children }: {
  title: string; icon?: E2eFlowIconName; storageKey: string; activeCount: number; collapsedSummary?: ReactNode;
  className?: string; children: ReactNode;
}) {
  const { m } = useI18n();
  const t = m.e2eLines.panels;
  const titleId = useId();
  const bodyId = useId();
  const collapsed = useSyncExternalStore(subscribe, () => readCollapsed(browserStorage(), storageKey), () => false);
  const toggle = useCallback(() => {
    writeCollapsed(browserStorage(), storageKey, !readCollapsed(browserStorage(), storageKey));
    listeners.forEach(listener => listener());
  }, [storageKey]);

  return <section className={`e2e-collapsible${className ? ` ${className}` : ""}${collapsed ? " is-collapsed" : ""}`}
    aria-labelledby={titleId}>
    <div className="e2e-collapsible-head">
      {icon && <span className="e2e-collapsible-icon"><Icon name={icon} size={16} /></span>}
      <h2 className="e2e-label" id={titleId}>{title}</h2>
      {collapsed && collapsedSummary}
      {collapsed && activeCount > 0 && <span className="badge badge-info badge-sm">{t.active(activeCount)}</span>}
      <button type="button" className="e2e-collapsible-toggle" aria-expanded={!collapsed} aria-controls={bodyId}
        aria-label={`${collapsed ? t.show : t.hide}: ${title}`} onClick={toggle}>
        <Icon name="next" size={16} /><span>{collapsed ? t.show : t.hide}</span>
      </button>
    </div>
    <div id={bodyId} hidden={collapsed}>{children}</div>
  </section>;
}
