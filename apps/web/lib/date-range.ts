import type { Messages } from "./i18n/pt-BR";

/** Units of a relative period, in the order of the tabs. */
export const dateRangeUnits = ["year", "quarter", "month", "week", "day"] as const;
export type DateRangeUnit = typeof dateRangeUnits[number];

/** Period counted in whole units from the current one: 0 is this month, -1 last month, 1 next month. */
export type RelativeRange = { unit: DateRangeUnit; from: number; to: number };

/**
 * A date filter: every date, a fixed period, or a period relative to today, which keeps its meaning on
 * another day (this month stays the current month). `excludeOpen` leaves out the period still running.
 */
export type DateRangeValue = { kind: "all" } | { kind: "static"; from: string; to: string }
  | { kind: "relative"; range: RelativeRange; excludeOpen: boolean };

export type DateRangePresetKey = keyof Messages["dateRange"]["presets"];

/** Shortcuts of the period picker, grouped by unit. */
export const dateRangePresets: readonly { key: DateRangePresetKey; range: RelativeRange }[] = [
  { key: "thisYear", range: { unit: "year", from: 0, to: 0 } },
  { key: "lastYear", range: { unit: "year", from: -1, to: -1 } },
  { key: "thisQuarter", range: { unit: "quarter", from: 0, to: 0 } },
  { key: "lastQuarter", range: { unit: "quarter", from: -1, to: -1 } },
  { key: "last4Quarters", range: { unit: "quarter", from: -3, to: 0 } },
  { key: "thisMonth", range: { unit: "month", from: 0, to: 0 } },
  { key: "lastMonth", range: { unit: "month", from: -1, to: -1 } },
  { key: "last12Months", range: { unit: "month", from: -11, to: 0 } },
  { key: "thisWeek", range: { unit: "week", from: 0, to: 0 } },
  { key: "lastWeek", range: { unit: "week", from: -1, to: -1 } },
  { key: "last2Weeks", range: { unit: "week", from: -1, to: 0 } },
  { key: "last7Days", range: { unit: "day", from: -6, to: 0 } },
];

/** How many units back and ahead a relative period offers. */
export const relativeOffsetLimits: Record<DateRangeUnit, number> = { year: 10, quarter: 12, month: 24, week: 26, day: 60 };

export function relativeOffsets(unit: DateRangeUnit): number[] {
  const limit = relativeOffsetLimits[unit];
  return Array.from({ length: limit * 2 + 1 }, (_, index) => index - limit);
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/u;
export const isIsoDate = (value: string) => isoDate.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const fromParts = (year: number, month: number, day: number) => toIso(new Date(Date.UTC(year, month, day)));

/** First and last day of the period `offset` units from the one of `today` (weeks start on Sunday). */
function unitBounds(unit: DateRangeUnit, offset: number, today: string): { start: string; end: string } {
  const date = toDate(today);
  const year = date.getUTCFullYear(); const month = date.getUTCMonth(); const day = date.getUTCDate();
  if (unit === "year") return { start: fromParts(year + offset, 0, 1), end: fromParts(year + offset, 11, 31) };
  if (unit === "quarter" || unit === "month") {
    const size = unit === "quarter" ? 3 : 1;
    const first = Math.floor(month / size) * size + offset * size;
    return { start: fromParts(year, first, 1), end: fromParts(year, first + size, 0) };
  }
  if (unit === "week") {
    const sunday = day - date.getUTCDay() + offset * 7;
    return { start: fromParts(year, month, sunday), end: fromParts(year, month, sunday + 6) };
  }
  return { start: fromParts(year, month, day + offset), end: fromParts(year, month, day + offset) };
}

/** The relative period actually used: without the open period, a range that includes it moves one unit back. */
export function effectiveRange(range: RelativeRange, excludeOpen: boolean): RelativeRange {
  return excludeOpen && range.from <= 0 && range.to >= 0 ? { ...range, from: range.from - 1, to: range.to - 1 } : range;
}

/** Whether "exclude open period" changes the range: it must include the current period. */
export const includesOpenPeriod = (range: RelativeRange) => range.from <= 0 && range.to >= 0;

/** Dates sent to the API for a filter (YYYY-MM-DD, "" for no bound), from today in Brasília. */
export function resolveDateRange(value: DateRangeValue, today: string): { from: string; to: string } {
  if (value.kind === "all") return { from: "", to: "" };
  if (value.kind === "static") return { from: value.from, to: value.to };
  const range = effectiveRange(value.range, value.excludeOpen);
  return { from: unitBounds(range.unit, range.from, today).start, to: unitBounds(range.unit, range.to, today).end };
}

/** A relative period as kept in the URL: `month:-11:0`, with `:x` when the open period is excluded. */
export function formatRelativeSpec(range: RelativeRange, excludeOpen: boolean): string {
  return `${range.unit}:${range.from}:${range.to}${excludeOpen ? ":x" : ""}`;
}

export function parseRelativeSpec(spec: string): { range: RelativeRange; excludeOpen: boolean } | null {
  const match = /^(year|quarter|month|week|day):(-?\d{1,3}):(-?\d{1,3})(:x)?$/u.exec(spec);
  if (!match) return null;
  const unit = match[1] as DateRangeUnit;
  const from = Number(match[2]); const to = Number(match[3]);
  const limit = relativeOffsetLimits[unit];
  if (from > to || Math.abs(from) > limit || Math.abs(to) > limit) return null;
  return { range: { unit, from, to }, excludeOpen: Boolean(match[4]) };
}

/** The filter value of a relative spec and its dates; a fixed period has no spec. */
export function dateRangeValue(spec: string, from: string, to: string): DateRangeValue {
  const relative = parseRelativeSpec(spec);
  if (relative) return { kind: "relative", ...relative };
  return from || to ? { kind: "static", from, to } : { kind: "all" };
}

export const sameRange = (a: RelativeRange, b: RelativeRange) => a.unit === b.unit && a.from === b.from && a.to === b.to;

export function presetOf(range: RelativeRange): DateRangePresetKey | null {
  return dateRangePresets.find(preset => sameRange(preset.range, range))?.key ?? null;
}

/** Name of one relative offset: "2 months ago", "last month", "this month", "next month", "2 months ahead". */
export function relativeOffsetLabel(m: Messages, unit: DateRangeUnit, offset: number): string {
  const words = m.dateRange.relative[unit];
  if (offset < -1) return words.ago(-offset);
  if (offset === -1) return words.last;
  if (offset === 0) return words.current;
  if (offset === 1) return words.next;
  return words.ahead(offset);
}

export function formatDateRangeDay(value: string, locale: string): string {
  return isIsoDate(value) ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" })
    .format(toDate(value)) : "";
}

/** Text of the picker button: the shortcut, the relative bounds or the dates of the fixed period. */
export function dateRangeLabel(m: Messages, value: DateRangeValue, locale: string): string {
  const t = m.dateRange;
  if (value.kind === "all") return t.allTime;
  if (value.kind === "static") {
    const from = formatDateRangeDay(value.from, locale); const to = formatDateRangeDay(value.to, locale);
    return from && to ? `${from} – ${to}` : from ? t.since(from) : t.until(to);
  }
  const preset = presetOf(value.range);
  const { unit, from, to } = value.range;
  const text = preset ? t.presets[preset] : from === to ? relativeOffsetLabel(m, unit, from)
    : `${relativeOffsetLabel(m, unit, from)} – ${relativeOffsetLabel(m, unit, to)}`;
  return value.excludeOpen && includesOpenPeriod(value.range) ? `${text}${t.excludedSuffix}` : text;
}

/** Days of the month view, Sunday first, in whole weeks; days of the neighbour months are marked. */
export function calendarWeeks(year: number, month: number): { date: string; inMonth: boolean }[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Math.ceil((first.getUTCDay() + days) / 7) * 7;
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let index = 0; index < cells; index += 1) {
    const date = fromParts(year, month, index - first.getUTCDay() + 1);
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ date, inMonth: toDate(date).getUTCMonth() === ((month % 12) + 12) % 12 });
  }
  return weeks;
}

/** Next selection of the calendar: the first click starts a period, the second closes it (in either order). */
export function pickCalendarDay(range: { from: string; to: string }, day: string): { from: string; to: string } {
  if (!range.from || range.to) return { from: day, to: "" };
  return day < range.from ? { from: day, to: range.from } : { from: range.from, to: day };
}
