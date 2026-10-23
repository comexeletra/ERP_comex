"use client";

import { ShippedChange } from "../lib/audit";
import { useI18n } from "./I18nProvider";

/** Asked before a change that alters the quantity already on board of a shipped IP. */
export default function ShippedChangeConfirmation({ value, onChange }: {
  value: ShippedChange; onChange: (value: ShippedChange) => void;
}) {
  const t = useI18n().m.shippedChange;
  return <fieldset className="operational-help">
    <legend>{t.title}</legend>
    <p className="notice">{t.notice}</p>
    <label><input type="checkbox" checked={value.confirmed}
      onChange={event => onChange({ ...value, confirmed: event.target.checked })} /> {t.confirm}</label>
    <label>{t.reason}<textarea required minLength={3} maxLength={1000} value={value.reason}
      onChange={event => onChange({ ...value, reason: event.target.value })} /></label>
  </fieldset>;
}
