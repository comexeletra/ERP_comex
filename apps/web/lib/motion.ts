/** Duration of the chart transitions, in milliseconds; the stylesheet uses the same value as --motion-chart. */
export const chartMotionMs = 600;

/**
 * Easing of the chart transitions (ease-out quint, as cubic-bezier(.22, 1, .36, 1) in the stylesheet): a value
 * moves fast at first and settles slowly into place. Progress outside 0..1 is clamped.
 */
export function easeOrganic(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 5;
}

/** Value of a tween from `from` to `to` after `elapsed` of `duration` milliseconds; it lands exactly on `to`. */
export function tweenAt(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  return from + (to - from) * easeOrganic(elapsed / duration);
}
