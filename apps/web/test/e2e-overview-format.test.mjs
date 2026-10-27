import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { overviewShares, overviewTotal, rankedIndexes } from "../lib/e2e-overview-format.ts";

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
