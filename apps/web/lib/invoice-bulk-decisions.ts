import type { InvoicePriceChoice, InvoiceQuantityDecision } from "./china-invoice-mapping";

/**
 * Bulk decisions of the invoice audit page (stage 1g, user decisions of 2026-11-11): one action decides every point
 * of a kind that has no decision yet; a point the analyst already decided is never changed, and a point the action
 * cannot decide stays pending and is counted in `left`.
 */
export type BulkOutcome<T> = { next: T; applied: number; left: number };
type SourceChoice<S extends string> = { source: S | null; reason: string };

/** Lines whose price point has no choice yet. */
export function pendingPrices(points: readonly (readonly [number, { correctable: boolean }])[],
  current: Readonly<Record<number, InvoicePriceChoice>>): number[] {
  return points.map(([row]) => row).filter(row => current[row] === undefined);
}

/** Accept or correct every price without a choice; the correction needs a single PO price, or the line stays pending. */
export function bulkPriceChoices(points: readonly (readonly [number, { correctable: boolean }])[],
  current: Readonly<Record<number, InvoicePriceChoice>>, choice: InvoicePriceChoice): BulkOutcome<Record<number, InvoicePriceChoice>> {
  const next = { ...current };
  let applied = 0, left = 0;
  for (const [row, point] of points) {
    if (current[row] !== undefined) continue;
    if (choice === "CORRECT" && !point.correctable) { left += 1; continue; }
    next[row] = choice;
    applied += 1;
  }
  return { next, applied, left };
}

/** Points whose options (INV × PKL weights, manufacturer country) have none chosen yet. */
export function pendingSources<K extends string | number, S extends string>(keys: readonly K[],
  current: Readonly<Partial<Record<K, SourceChoice<S>>>>): K[] {
  return keys.filter(key => !current[key]?.source);
}

/** Choose one option for every point without one; a reason already typed on the line is kept. */
export function bulkSourceChoices<K extends string | number, S extends string>(keys: readonly K[],
  current: Readonly<Partial<Record<K, SourceChoice<S>>>>, source: S, reason: string,
  allowed: (key: K) => boolean = () => true): BulkOutcome<Partial<Record<K, SourceChoice<S>>>> {
  const next: Partial<Record<K, SourceChoice<S>>> = { ...current };
  let applied = 0, left = 0;
  for (const key of pendingSources(keys, current)) {
    if (!allowed(key)) { left += 1; continue; }
    const typed = current[key]?.reason ?? "";
    next[key] = { source, reason: typed.trim() ? typed : reason };
    applied += 1;
  }
  return { next, applied, left };
}

/** Points to confirm with a reason (quantity, product out of the DATABASE, manufacturer out of the list) not confirmed. */
export function pendingConfirmations<K extends string | number>(keys: readonly K[],
  current: Readonly<Partial<Record<K, InvoiceQuantityDecision>>>): K[] {
  return keys.filter(key => !current[key]?.confirmed);
}

/** Confirm every point not confirmed yet; a reason already typed on the line is kept. */
export function bulkConfirmations<K extends string | number>(keys: readonly K[],
  current: Readonly<Partial<Record<K, InvoiceQuantityDecision>>>, reason: string,
  allowed: (key: K) => boolean = () => true): BulkOutcome<Partial<Record<K, InvoiceQuantityDecision>>> {
  const next: Partial<Record<K, InvoiceQuantityDecision>> = { ...current };
  let applied = 0, left = 0;
  for (const key of pendingConfirmations(keys, current)) {
    if (!allowed(key)) { left += 1; continue; }
    const typed = current[key]?.reason ?? "";
    next[key] = { confirmed: true, reason: typed.trim() ? typed : reason };
    applied += 1;
  }
  return { next, applied, left };
}

/** Decisions without a reason (the supplier of the Exporter, the NCM flagged in the file) not given yet. */
export function pendingFlags<K extends string | number>(keys: readonly K[], current: Readonly<Partial<Record<K, boolean>>>): K[] {
  return keys.filter(key => !current[key]);
}

export function bulkFlags<K extends string | number>(keys: readonly K[],
  current: Readonly<Partial<Record<K, boolean>>>): BulkOutcome<Partial<Record<K, boolean>>> {
  const pending = pendingFlags(keys, current);
  return { next: { ...current, ...Object.fromEntries(pending.map(key => [key, true])) } as Partial<Record<K, boolean>>,
    applied: pending.length, left: 0 };
}
