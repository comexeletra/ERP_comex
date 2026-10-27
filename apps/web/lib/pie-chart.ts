export type PiePoint = { x: number; y: number };
export type PieSlice = {
  index: number;
  value: number;
  fraction: number;
  d: string;
};

export type PieOptions = {
  centerX: number;
  centerY: number;
  radius: number;
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
    angle = endAngle;
    return [{ index, value, fraction, d }];
  });
}
