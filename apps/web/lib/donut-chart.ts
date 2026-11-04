export type DonutSegment = {
  index: number;
  value: number;
  fraction: number;
  /** `stroke-dasharray` of a circle of the ring: the arc, then a gap as long as the ring. */
  dashArray: string;
  /** `stroke-dashoffset` that moves the arc to where the previous categories end. */
  dashOffset: string;
};

export type DonutOptions = {
  radius: number;
  /** Space left between two arcs, in the units of the radius. */
  gap: number;
};

const clean = (value: number) => String(Number(value.toFixed(2)));

/**
 * Pure SVG geometry of a ring made of stroked circles, one per value, in the received order from the start of
 * the circle (the caller rotates it to twelve o'clock). An empty value keeps a zero-length arc where it would
 * start, so a transition can grow it back; a tiny one keeps a visible arc and a single category closes the ring
 * without a gap. A zero total draws nothing.
 */
export function donutSegments(values: readonly number[], options: DonutOptions): DonutSegment[] {
  const safeValues = values.map(value => Number.isFinite(value) && value > 0 ? value : 0);
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  const circumference = 2 * Math.PI * options.radius;
  const gap = safeValues.filter(value => value > 0).length > 1 ? options.gap : 0;
  let offset = 0;
  return safeValues.map((value, index) => {
    const fraction = value / total;
    const length = fraction * circumference;
    const arc = value === 0 ? 0 : Math.max(length - gap, .5);
    const segment = { index, value, fraction, dashArray: `${clean(arc)} ${clean(circumference)}`, dashOffset: clean(-offset) };
    offset += length;
    return segment;
  });
}
