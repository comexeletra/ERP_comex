const usDatePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u;
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/u;

function isValidCalendarDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === iso;
}

export function parseUsDate(value: string): string | null {
  const match = usDatePattern.exec(value.trim());
  if (!match) return null;
  const [, month, day, year] = match;
  const iso = `${year}-${month}-${day}`;
  return isValidCalendarDate(iso) ? iso : null;
}

export function formatUsDate(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  const iso = isoDatePattern.exec(trimmed);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidCalendarDate(date) ? `${iso[2]}/${iso[3]}/${iso[1]}` : value;
  }
  const us = usDatePattern.exec(trimmed);
  if (!us) return value;
  const date = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return isValidCalendarDate(date) ? `${us[1].padStart(2, "0")}/${us[2].padStart(2, "0")}/${us[3]}` : value;
}

export function formatUsDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("month")}/${part("day")}/${part("year")} ${part("hour")}:${part("minute")}`;
}
