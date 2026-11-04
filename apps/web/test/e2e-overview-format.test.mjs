import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { delayRangeGroups, delayRangeInsight, delayRangeRows, formatShare, largestIndex, overviewShares, overviewTip, overviewTotal }
  from "../lib/e2e-overview-format.ts";
import { e2eDelayRanges } from "../lib/purchase-order-lines.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

// Intl may separate the number and the unit with a no-break space.
const plain = value => value.replace(/ | /gu, " ");

test("each category shows its compact quantity and share, and an empty one shows a dash", () => {
  const shares = overviewShares(["14025245", "0", "616931", "0.002"], "pt-BR");
  assert.equal(shares.reduce((sum, share) => sum + share.fraction, 0), 1);
  assert.deepEqual(shares.map(share => plain(share.compact)), ["14,03 mi", "—", "616,93 mil", "0"]);
  assert.deepEqual(shares.map(share => share.percent), ["96%", "—", "4%", "<0,01%"]);
  assert.equal(plain(shares[0].full), "14.025.245");
  assert.equal(shares[1].fraction, 0);
});

test("shares below one percent keep up to two decimals", () => {
  const [, small] = overviewShares(["9998", "2"], "pt-BR");
  assert.equal(small.percent, "0,02%");
  const [large] = overviewShares(["48", "52"], "pt-BR");
  assert.equal(large.percent, "48%");
});

test("quantities and totals follow the interface language", () => {
  assert.deepEqual(overviewShares(["14025245"], "en").map(share => [share.compact, share.full, share.percent]),
    [["14.03M", "14,025,245", "100%"]]);
  assert.equal(overviewShares(["14025245"], "zh-CN")[0].compact, "1402.52万");
  assert.equal(plain(overviewTotal(["14025245", "616931"], "pt-BR")), "14,64 mi");
  assert.equal(overviewTotal(["0", "0"], "pt-BR"), "0");
});

test("all zero quantities show dashes and no share", () => {
  assert.deepEqual(overviewShares(["0", "0"], "pt-BR").map(share => [share.compact, share.percent, share.fraction]),
    [["—", "—", 0], ["—", "—", 0]]);
});

test("the overview format stays free of UI text and value imports", async () => {
  const source = await readFile(new URL("../lib/e2e-overview-format.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s+(?!type\b)/mu);
  assert.doesNotMatch(source, /formatNumber/u);
});

const ranges = values => Object.fromEntries(e2eDelayRanges.map((key, index) => [key, values[index] ?? 0]));

test("the delay range groups keep every range once, in chronological order", () => {
  assert.deepEqual(delayRangeGroups.map(group => group.key), ["noDelay", "late", "noInfo"]);
  assert.deepEqual(delayRangeGroups.flatMap(group => group.ranges), [...e2eDelayRanges]);
});

test("delay range rows go in chronological order, never by quantity, and skip empty ranges and groups", () => {
  // inAdvance, onTime, upTo30, 30-45, 45-60, 60-90, 90-120, 120+, noData
  const rows = delayRangeRows(ranges([0, 189, 807420, 0, 359, 544, 60, 0, 3]), []);
  assert.deepEqual(rows.map(row => [row.key, row.ranges, row.total]), [
    ["noDelay", ["onTime"], 189],
    ["late", ["upTo30", "days45To60", "days60To90", "days90To120"], 808383],
    ["noInfo", ["noData"], 3],
  ]);
  // A selected range stays visible even when the other charts leave it empty.
  assert.deepEqual(delayRangeRows(ranges([0, 0, 5]), ["days120Plus"]).map(row => row.ranges), [["upTo30", "days120Plus"]]);
  assert.deepEqual(delayRangeRows(ranges([]), []), []);
});

test("the delay range insight splits the late quantity at 30 days", () => {
  assert.deepEqual(delayRangeInsight(ranges([4, 6, 30, 10, 5, 3, 1, 1, 40])),
    { total: 100, late: 50, upTo30: 30, over30: 20 });
  assert.deepEqual(delayRangeInsight(ranges([])), { total: 0, late: 0, upTo30: 0, over30: 0 });
});

test("the largest category is the first with the highest quantity, and none when all are empty", () => {
  assert.equal(largestIndex([3, 9, 9, 1]), 1);
  assert.equal(largestIndex([0, 0]), -1);
  assert.equal(largestIndex([]), -1);
});

test("a share of a total uses the chart format and never divides by zero", () => {
  assert.deepEqual(Object.entries(formatShare(1200, 4800, "pt-BR")).map(([key, value]) => [key, plain(value)]),
    [["compact", "1,2 mil"], ["percent", "25%"]]);
  assert.deepEqual(formatShare(0, 0, "pt-BR"), { compact: "—", percent: "—" });
  assert.equal(formatShare(1, 20000, "pt-BR").percent, "<0,01%");
});

test("the chart tooltip card shows the full quantity, the share, the lines and what a click does", () => {
  const [share] = overviewShares(["729050", "205000"], "pt-BR");
  assert.deepEqual(overviewTip(share, 1234, false, "pt-BR", ptBR).rows.map(([label, value]) => [label, plain(value)]),
    [["Quantidade de itens", "729.050"], ["Participação", "78%"], ["Linhas", "1.234"]]);
  assert.equal(overviewTip(share, 1, false, "pt-BR", ptBR).hint, "Clique para filtrar");
  assert.equal(overviewTip(share, 1, true, "pt-BR", ptBR).hint, "Clique para limpar o filtro");
  const [english] = overviewShares(["729050", "205000"], "en");
  assert.deepEqual(overviewTip(english, 1234, true, "en", en),
    { rows: [["Item quantity", "729,050"], ["Share", "78%"], ["Lines", "1,234"]], hint: "Click to clear the filter" });
  const [chinese] = overviewShares(["729050", "205000"], "zh-CN");
  assert.deepEqual(overviewTip(chinese, 1234, false, "zh-CN", zhCN),
    { rows: [["物料数量", "729,050"], ["占比", "78%"], ["行数", "1,234"]], hint: "点击筛选" });
});
