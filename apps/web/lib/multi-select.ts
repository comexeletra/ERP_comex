import type { Messages } from "./i18n/pt-BR";

/** Most values the API takes in one list filter; "select all" is sent as no filter, so it never counts. */
export const multiSelectLimit = 500;

export type SelectAllState = "checked" | "mixed" | "unchecked";

/** The selection with the value checked, or unchecked when it already was. */
export function toggleValue(selected: readonly string[], value: string): string[] {
  return selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
}

/** State of "select all" for the visible values (all of them, or the results of the search). */
export function selectAllState(selected: readonly string[], visible: readonly string[]): SelectAllState {
  const checked = visible.filter(value => selected.includes(value)).length;
  return checked === 0 ? "unchecked" : checked === visible.length ? "checked" : "mixed";
}

/** "Select all": checks the visible values, or unchecks them when they are all checked; the others stay. */
export function toggleVisible(selected: readonly string[], visible: readonly string[]): string[] {
  if (selectAllState(selected, visible) === "checked") return selected.filter(value => !visible.includes(value));
  return [...selected, ...visible.filter(value => !selected.includes(value))];
}

/** The values to filter by: every option checked is the same as none (no filter), which keeps the URL short. */
export function effectiveSelection(selected: readonly string[], options: readonly string[]): string[] {
  return options.length > 0 && options.every(option => selected.includes(option)) ? [] : [...selected];
}

/** Text of the closed field: all, the label of the only value chosen, or how many were chosen. */
export function multiSelectLabel(selected: readonly string[], options: readonly { value: string; label: string }[],
  allLabel: string, m: Messages): string {
  if (selected.length === 0) return allLabel;
  if (selected.length === 1) return options.find(option => option.value === selected[0])?.label ?? selected[0];
  return m.select.selectedCount(selected.length);
}
