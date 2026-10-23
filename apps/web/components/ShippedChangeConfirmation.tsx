import { ShippedChange } from "../lib/audit";

/** Asked before a change that alters the quantity already on board of a shipped IP. */
export default function ShippedChangeConfirmation({ value, onChange }: {
  value: ShippedChange; onChange: (value: ShippedChange) => void;
}) {
  return <fieldset className="operational-help">
    <legend>IP já embarcado</legend>
    <p className="notice">Este IP tem BL date ou Departure preenchidos. A alteração muda a quantidade embarcada:
      confirme e explique o motivo.</p>
    <label><input type="checkbox" checked={value.confirmed}
      onChange={event => onChange({ ...value, confirmed: event.target.checked })} /> Confirmo a alteração em IP já embarcado</label>
    <label>Justificativa<textarea required minLength={3} maxLength={1000} value={value.reason}
      onChange={event => onChange({ ...value, reason: event.target.value })} /></label>
  </fieldset>;
}
