import { useEffect, useState } from "react";

/**
 * The value once it has stayed the same for `delayMs`: a burst of changes (chart clicks, Ctrl+clicks, typing)
 * settles into one. The first value is settled at once.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return undefined;
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs, settled]);
  return settled;
}
