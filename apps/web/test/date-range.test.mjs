import assert from "node:assert/strict";
import test from "node:test";
import { calendarWeeks, dateRangeLabel, dateRangePresets, dateRangeUnits, dateRangeValue, formatRelativeSpec, parseRelativeSpec,
  pickCalendarDay, presetOf, relativeOffsetLabel, relativeOffsets, resolveDateRange } from "../lib/date-range.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const today = "2026-11-04"; // a Wednesday
const relative = (unit, from, to, excludeOpen = false) => ({ kind: "relative", range: { unit, from, to }, excludeOpen });
const resolved = value => { const { from, to } = resolveDateRange(value, today); return [from, to]; };

test("every shortcut becomes the dates of its period from today", () => {
  const expected = {
    thisYear: ["2026-01-01", "2026-12-31"], lastYear: ["2025-01-01", "2025-12-31"],
    thisQuarter: ["2026-10-01", "2026-12-31"], lastQuarter: ["2026-07-01", "2026-09-30"], last4Quarters: ["2026-01-01", "2026-12-31"],
    thisMonth: ["2026-11-01", "2026-11-30"], lastMonth: ["2026-10-01", "2026-10-31"], last12Months: ["2025-12-01", "2026-11-30"],
    thisWeek: ["2026-11-01", "2026-11-07"], lastWeek: ["2026-10-25", "2026-10-31"], last2Weeks: ["2026-10-25", "2026-11-07"],
    last7Days: ["2026-10-29", "2026-11-04"],
  };
  assert.deepEqual(dateRangePresets.map(preset => preset.key), Object.keys(expected));
  for (const preset of dateRangePresets) {
    assert.deepEqual(resolved({ kind: "relative", range: preset.range, excludeOpen: false }), expected[preset.key], preset.key);
  }
});

test("relative periods cross months, quarters and years, back and ahead", () => {
  assert.deepEqual(resolved(relative("month", -2, 1)), ["2026-09-01", "2026-12-31"]);
  assert.deepEqual(resolved(relative("month", 1, 2)), ["2026-12-01", "2027-01-31"]);
  assert.deepEqual(resolveDateRange(relative("quarter", -1, -1), "2026-01-15"), { from: "2025-10-01", to: "2025-12-31" });
  assert.deepEqual(resolveDateRange(relative("week", 0, 0), "2027-01-01"), { from: "2026-12-27", to: "2027-01-02" });
  assert.deepEqual(resolveDateRange(relative("month", 0, 0), "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(resolved(relative("day", 0, 3)), ["2026-11-04", "2026-11-07"]);
  assert.deepEqual(resolved({ kind: "all" }), ["", ""]);
  assert.deepEqual(resolved({ kind: "static", from: "2026-03-01", to: "2026-03-31" }), ["2026-03-01", "2026-03-31"]);
});

test("excluding the open period moves a range that includes it one unit back", () => {
  assert.deepEqual(resolved(relative("month", -11, 0, true)), ["2025-11-01", "2026-10-31"]);
  assert.deepEqual(resolved(relative("day", -6, 0, true)), ["2026-10-28", "2026-11-03"]);
  // A period that does not include the current one does not change.
  assert.deepEqual(resolved(relative("month", -1, -1, true)), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(resolved(relative("month", 1, 2, true)), ["2026-12-01", "2027-01-31"]);
});

test("a relative period round-trips through the URL and invalid specs are refused", () => {
  assert.equal(formatRelativeSpec({ unit: "month", from: -11, to: 0 }, false), "month:-11:0");
  assert.equal(formatRelativeSpec({ unit: "week", from: -1, to: 0 }, true), "week:-1:0:x");
  assert.deepEqual(parseRelativeSpec("week:-1:0:x"), { range: { unit: "week", from: -1, to: 0 }, excludeOpen: true });
  for (const spec of ["", "month", "month:1:-1", "month:-25:0", "decade:0:0", "month:0:0:y", "month:a:0"]) {
    assert.equal(parseRelativeSpec(spec), null, spec);
  }
  assert.deepEqual(dateRangeValue("month:0:0", "2026-11-01", "2026-11-30"), relative("month", 0, 0));
  assert.deepEqual(dateRangeValue("", "2026-11-01", "2026-11-30"), { kind: "static", from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(dateRangeValue("bad", "", ""), { kind: "all" });
});

test("the relative bounds and the button read as words in every language", () => {
  assert.deepEqual([-2, -1, 0, 1, 2].map(offset => relativeOffsetLabel(ptBR, "month", offset)),
    ["2 meses atrás", "mês passado", "este mês", "próximo mês", "daqui a 2 meses"]);
  assert.deepEqual([-2, -1, 0, 1, 2].map(offset => relativeOffsetLabel(en, "month", offset)),
    ["2 months ago", "last month", "this month", "next month", "2 months ahead"]);
  assert.equal(dateRangeLabel(ptBR, { kind: "all" }, "pt-BR"), "Todas as datas");
  assert.equal(dateRangeLabel(ptBR, relative("month", -11, 0), "pt-BR"), "Últimos 12 meses");
  assert.equal(dateRangeLabel(ptBR, relative("month", -2, 1), "pt-BR"), "2 meses atrás – próximo mês");
  assert.equal(dateRangeLabel(ptBR, relative("day", 0, 0), "pt-BR"), "hoje");
  assert.equal(dateRangeLabel(ptBR, relative("month", -11, 0, true), "pt-BR"), `Últimos 12 meses${ptBR.dateRange.excludedSuffix}`);
  assert.equal(dateRangeLabel(ptBR, { kind: "static", from: "2026-04-01", to: "2026-05-31" }, "pt-BR"), "01/04/2026 – 31/05/2026");
  assert.equal(dateRangeLabel(en, { kind: "static", from: "2026-04-01", to: "2026-05-31" }, "en-US"), "04/01/2026 – 05/31/2026");
  assert.equal(presetOf({ unit: "week", from: -1, to: 0 }), "last2Weeks");
  assert.equal(presetOf({ unit: "week", from: -2, to: 0 }), null);
  for (const messages of [ptBR, en, zhCN]) {
    for (const unit of dateRangeUnits) {
      assert.ok(messages.dateRange.units[unit] && messages.dateRange.groups[unit], unit);
      for (const offset of [-3, -1, 0, 1, 3]) assert.ok(relativeOffsetLabel(messages, unit, offset), `${unit} ${offset}`);
    }
    for (const preset of dateRangePresets) assert.ok(messages.dateRange.presets[preset.key], preset.key);
  }
  assert.equal(relativeOffsets("year").length, 21);
  assert.deepEqual([relativeOffsets("month")[0], relativeOffsets("month").at(-1)], [-24, 24]);
});

test("the calendar shows whole weeks from Sunday and picks a period in two clicks", () => {
  const may = calendarWeeks(2022, 4);
  assert.equal(may.length, 5);
  assert.deepEqual(may[0][0], { date: "2022-05-01", inMonth: true });
  assert.deepEqual(may[4][6], { date: "2022-06-04", inMonth: false });
  const february = calendarWeeks(2026, 1);
  assert.deepEqual(february[0][0], { date: "2026-02-01", inMonth: true });
  assert.ok(february.every(week => week.length === 7));
  const august = calendarWeeks(2026, 7);
  assert.deepEqual(august[0][0], { date: "2026-07-26", inMonth: false });
  assert.equal(august.length, 6);
  let range = pickCalendarDay({ from: "", to: "" }, "2026-05-10");
  assert.deepEqual(range, { from: "2026-05-10", to: "" });
  range = pickCalendarDay(range, "2026-05-03");
  assert.deepEqual(range, { from: "2026-05-03", to: "2026-05-10" });
  assert.deepEqual(pickCalendarDay(range, "2026-05-20"), { from: "2026-05-20", to: "" });
});
