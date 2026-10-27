export type PiePoint = { x: number; y: number };
export type PieSlice = {
  index: number;
  value: number;
  fraction: number;
  d: string;
  label: PiePoint | null;
  guide: { start: PiePoint; end: PiePoint } | null;
};

export type PieOptions = {
  centerX: number;
  centerY: number;
  radius: number;
  labelRadius: number;
  minimumLabelFraction?: number;
};

const clean = (value: number) => Number(value.toFixed(6));
const point = (angle: number, radius: number, options: PieOptions): PiePoint => ({
  x: clean(options.centerX + Math.cos(angle) * radius),
  y: clean(options.centerY + Math.sin(angle) * radius),
});

/** Pure SVG geometry. Values are drawn clockwise from twelve o'clock in their received order. */
export function pieSlices(values: number[], options: PieOptions): PieSlice[] {
  const safeValues = values.map(value => Number.isFinite(value) && value > 0 ? value : 0);
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  let angle = -Math.PI / 2;
  return safeValues.flatMap((value, index) => {
    if (value === 0) return [];
    const fraction = value / total;
    const endAngle = angle + fraction * Math.PI * 2;
    const start = point(angle, options.radius, options);
    const end = point(endAngle, options.radius, options);
    const d = fraction === 1
      ? `M ${start.x} ${start.y} A ${options.radius} ${options.radius} 0 1 1 ${options.centerX} ${options.centerY + options.radius} A ${options.radius} ${options.radius} 0 1 1 ${start.x} ${start.y} Z`
      : `M ${start.x} ${start.y} A ${options.radius} ${options.radius} 0 ${fraction > .5 ? 1 : 0} 1 ${end.x} ${end.y} L ${options.centerX} ${options.centerY} Z`;
    const middle = angle + fraction * Math.PI;
    const visible = fraction >= (options.minimumLabelFraction ?? .02);
    const slice: PieSlice = { index, value, fraction, d,
      label: visible ? point(middle, options.labelRadius, options) : null,
      guide: visible ? { start: point(middle, options.radius + 4, options),
        end: point(middle, options.labelRadius - 12, options) } : null };
    angle = endAngle;
    return [slice];
  });
}
