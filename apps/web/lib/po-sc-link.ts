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
