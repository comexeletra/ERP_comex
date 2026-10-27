/** A category of the End to End overview: its share of the chart and its quantity as shown. */
export type OverviewShare = {
  value: number;
  fraction: number;
  /** Compact quantity ("14,03 mi"), or a dash when the category is empty. */
  compact: string;
  /** Full quantity for tooltips. */
  full: string;
  /** Share of the chart: no decimals from 1%, up to two below it, a dash when empty. */
  percent: string;
};

const empty = "—";
const quantity = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/** Shares of the exact quantities returned by the API, formatted in the interface language. */
export function overviewShares(quantities: readonly string[], locale: string): OverviewShare[] {
  const values = quantities.map(quantity);
  const total = values.reduce((sum, value) => sum + value, 0);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 });
  const full = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const whole = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const small = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });
  return values.map(value => {
    const fraction = total > 0 ? value / total : 0;
    const percent = fraction === 0 ? empty : fraction >= .01 ? whole.format(fraction)
      : fraction < .0001 ? `<${small.format(.0001)}` : small.format(fraction);
    return { value, fraction, compact: value === 0 ? empty : compact.format(value), full: full.format(value), percent };
  });
}

/** Compact total of a chart. */
export function overviewTotal(quantities: readonly string[], locale: string): string {
  const total = quantities.map(quantity).reduce((sum, value) => sum + value, 0);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(total);
}

/**
 * Order of the delay range bars, as in Power BI: from the largest quantity down, ties in the range
 * order. Empty ranges are not drawn, except the selected one (`keep`, -1 for none).
 */
export function rankedIndexes(values: readonly number[], keep: number): number[] {
  return values.map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value > 0 || index === keep)
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .map(({ index }) => index);
}
