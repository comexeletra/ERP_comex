/** Browser storage used to remember collapsed panels; null when the page has no window. */
export type PanelStorage = Pick<Storage, "getItem" | "setItem">;

// The choice made in this page, kept even when the browser blocks the storage.
const chosen = new Map<string, boolean>();

/** Whether the viewer collapsed the panel; panels open expanded. */
export function readCollapsed(storage: PanelStorage | null, key: string): boolean {
  if (chosen.has(key)) return chosen.get(key)!;
  try {
    return storage?.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Remembers the viewer's choice for the panel in this page and, when allowed, in the browser. */
export function writeCollapsed(storage: PanelStorage | null, key: string, collapsed: boolean): void {
  chosen.set(key, collapsed);
  try {
    storage?.setItem(key, String(collapsed));
  } catch {
    // Private windows and blocked site data keep the choice only in this page.
  }
}
