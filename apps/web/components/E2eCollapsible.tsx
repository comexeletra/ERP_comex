"use client";

import { useCallback, useId, useSyncExternalStore, type ReactNode } from "react";
import { readCollapsed, writeCollapsed } from "../lib/collapsed-panels";
import { Icon } from "./E2eFlowParts";
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
 * A block of the End to End screen that the viewer can hide, with its title and, while hidden,
 * how many filters it still applies. Each viewer's choice is remembered in the browser.
 */
export default function E2eCollapsible({ title, storageKey, activeCount, className, children }: {
  title: string; storageKey: string; activeCount: number; className?: string; children: ReactNode;
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

  return <section className={`e2e-collapsible${className ? ` ${className}` : ""}`} aria-labelledby={titleId}>
    <div className="e2e-collapsible-head">
      <h2 className="e2e-label" id={titleId}>{title}</h2>
      {collapsed && activeCount > 0 && <span className="badge badge-info badge-sm">{t.active(activeCount)}</span>}
      <button type="button" className="e2e-collapsible-toggle" aria-expanded={!collapsed} aria-controls={bodyId}
        aria-label={`${collapsed ? t.show : t.hide}: ${title}`} onClick={toggle}>
        <Icon name="next" size={16} /><span>{collapsed ? t.show : t.hide}</span>
      </button>
    </div>
    <div id={bodyId} hidden={collapsed}>{children}</div>
  </section>;
}
