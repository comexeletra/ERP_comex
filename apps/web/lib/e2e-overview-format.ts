import type { Messages } from "./i18n/pt-BR";
import type { E2eDelayRange } from "./purchase-order-lines";

/** A category of the End to End overview: its share of the chart and its quantity as shown. */
export type OverviewShare = {
  value: number;
  fraction: number;
  /** Compact quantity ("14,03 mi"), or a dash when the category is empty. */
  compact: string;
  /** Full quantity for the tooltip card. */
  full: string;
  /** Share of the chart: no decimals from 1%, up to two below it, a dash when empty. */
  percent: string;
};

const empty = "—";
const quantity = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const formats = (locale: string) => ({
  compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }),
  whole: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }),
  small: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }),
});
const percentOf = (fraction: number, format: ReturnType<typeof formats>) => fraction === 0 ? empty
  : fraction >= .01 ? format.whole.format(fraction) : fraction < .0001 ? `<${format.small.format(.0001)}` : format.small.format(fraction);

/** Shares of the exact quantities returned by the API, formatted in the interface language. */
export function overviewShares(quantities: readonly string[], locale: string): OverviewShare[] {
  const values = quantities.map(quantity);
  const total = values.reduce((sum, value) => sum + value, 0);
  const format = formats(locale);
  const full = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return values.map(value => {
    const fraction = total > 0 ? value / total : 0;
    return { value, fraction, compact: value === 0 ? empty : format.compact.format(value), full: full.format(value),
      percent: percentOf(fraction, format) };
  });
}

/** A part of a total in the format of the charts (the insight chips and the late callout); dashes when empty. */
export function formatShare(value: number, total: number, locale: string): { compact: string; percent: string } {
  const format = formats(locale);
  return { compact: value > 0 ? format.compact.format(value) : empty, percent: percentOf(total > 0 ? value / total : 0, format) };
}

/** Index of the first category with the largest quantity, or -1 when every one is empty. */
export function largestIndex(values: readonly number[]): number {
  let largest = -1;
  values.forEach((value, index) => { if (value > 0 && (largest === -1 || value > values[largest])) largest = index; });
  return largest;
}

export type DelayRangeGroupKey = "noDelay" | "late" | "noInfo";

/** Groups of the delay range chart; their ranges, in order, are the chronological order of the API. */
export const delayRangeGroups: readonly { key: DelayRangeGroupKey; ranges: readonly E2eDelayRange[] }[] = [
  { key: "noDelay", ranges: ["inAdvance", "onTime"] },
  { key: "late", ranges: ["upTo30", "days30To45", "days45To60", "days60To90", "days90To120", "days120Plus"] },
  { key: "noInfo", ranges: ["noData"] },
];

/**
 * Rows of the delay range chart: the ranges in chronological order, never by quantity. An empty range is not
 * drawn unless it is selected, and a group without ranges is left out.
 */
export function delayRangeRows(values: Readonly<Record<E2eDelayRange, number>>, selected: readonly string[]):
  { key: DelayRangeGroupKey; ranges: E2eDelayRange[]; total: number }[] {
  return delayRangeGroups.map(group => ({
    key: group.key,
    ranges: group.ranges.filter(range => values[range] > 0 || selected.includes(range)),
    total: group.ranges.reduce((sum, range) => sum + values[range], 0),
  })).filter(group => group.ranges.length > 0);
}

/** Late quantity split at 30 days, for the chip of the delay range chart and the callout of the deadline chart. */
export function delayRangeInsight(values: Readonly<Record<E2eDelayRange, number>>):
  { total: number; late: number; upTo30: number; over30: number } {
  const sum = (ranges: readonly E2eDelayRange[]) => ranges.reduce((total, range) => total + values[range], 0);
  const late = delayRangeGroups.find(group => group.key === "late")?.ranges ?? [];
  const upTo30 = values.upTo30;
  return { total: sum(delayRangeGroups.flatMap(group => group.ranges)), late: sum(late), upTo30, over30: sum(late) - upTo30 };
}

/** Compact total of a chart. */
export function overviewTotal(quantities: readonly string[], locale: string): string {
  const total = quantities.map(quantity).reduce((sum, value) => sum + value, 0);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(total);
}

/** Tooltip card of a chart category: full quantity, share and lines, and what a click on it does. */
export function overviewTip(share: OverviewShare, lines: number, selected: boolean, locale: string, m: Messages):
  { rows: [string, string][]; hint: string } {
  const o = m.e2eLines.overview;
  return {
    rows: [[o.tipQuantity, share.full], [o.tipShare, share.percent], [o.tipLines, new Intl.NumberFormat(locale).format(lines)]],
    hint: selected ? o.tipClear : o.tipFilter,
  };
}
