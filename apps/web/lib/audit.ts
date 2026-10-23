export const automaticAuditReason = "Registro realizado pelo usuário no portal.";

/** Confirmation the user gives before changing the quantity of an IP that already shipped. */
export type ShippedChange = { confirmed: boolean; reason: string };
export const emptyShippedChange: ShippedChange = { confirmed: false, reason: "" };

/** Reason fields of an allocation command; a shipped IP needs the confirmation and a reason typed by the user. */
export function shippedChangeFields(shipped: boolean, change: ShippedChange): { reason: string; confirmShippedChange?: true } {
  return shipped ? { reason: change.reason.trim(), confirmShippedChange: true } : { reason: automaticAuditReason };
}

export function shippedChangeReady(shipped: boolean, change: ShippedChange): boolean {
  const reason = change.reason.trim();
  return !shipped || (change.confirmed && reason.length >= 3 && reason !== automaticAuditReason);
}

function decimalKey(value: string): string {
  return value.trim().replace(",", ".").replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

export function quantityChanged(previous: string, next: string): boolean {
  return decimalKey(previous) !== decimalKey(next);
}
