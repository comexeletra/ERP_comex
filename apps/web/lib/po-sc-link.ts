import type { Messages } from "./i18n/pt-BR";

export function suggestedPurchaseRequestNumber(items: ReadonlyArray<{ scNumber: string | null }>): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = item.scNumber?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let suggestion = ""; let highest = 0;
  for (const [value, count] of counts) {
    if (count > highest) { suggestion = value; highest = count; }
  }
  return suggestion;
}

export function lockedSharedFieldKeys(purchaseRequestId: string | null): ReadonlySet<string> {
  return new Set(purchaseRequestId ? ["scNumber"] : []);
}

export function sharedFieldsSavedMessage(base: string, purchaseRequestUpdated: boolean, scNumber: string | null,
  m: Messages): string {
  if (!purchaseRequestUpdated) return base;
  return m.scLink.updatedInPcm(base, scNumber);
}
