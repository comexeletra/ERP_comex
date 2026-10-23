import type { Messages } from "./pt-BR";

export type FieldLabelKey = keyof Messages["fields"];

/** Label of a PO item or IP field; `labelKey` disambiguates keys shared by both, such as priority. */
export function fieldLabel(m: Messages, field: { key: string; labelKey?: FieldLabelKey }): string {
  return (m.fields as Record<string, string>)[field.labelKey ?? field.key] ?? field.key;
}

/** Translates the calculated statuses for display; the API values and filters stay unchanged. */
export function statusLabel(m: Messages, status: unknown): string {
  const text = status == null ? "" : String(status);
  return (m.statuses as Record<string, string>)[text] ?? text;
}

/** Role names stay as API identifiers for permissions; only their display is translated. */
export function roleLabel(m: Messages, role: string): string {
  return (m.roles as Record<string, string>)[role] ?? role;
}

export function displayValue(m: Messages, value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? m.common.yes : m.common.no;
  return String(value);
}

export function booleanOptions(m: Messages) {
  return [{ value: "", label: m.common.notInformed }, { value: "true", label: m.common.yes }, { value: "false", label: m.common.no }];
}
