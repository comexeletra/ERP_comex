import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { overviewShares, overviewTip, overviewTotal, rankedIndexes } from "../lib/e2e-overview-format.ts";
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

test("delay range bars go from the largest quantity down and skip empty ranges", () => {
  // As in Power BI: sorted by value; ties keep the range order; an empty range is not drawn.
  assert.deepEqual(rankedIndexes([807420, 189, 126244, 0, 359, 544, 60, 1, 3], -1), [0, 2, 5, 4, 1, 6, 8, 7]);
  assert.deepEqual(rankedIndexes([5, 0, 5, 0], -1), [0, 2]);
  // The selected range stays visible even when the other charts leave it empty.
  assert.deepEqual(rankedIndexes([5, 0, 2], 1), [0, 2, 1]);
  assert.deepEqual(rankedIndexes([0, 0], -1), []);
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
