import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { donutSegments } from "../lib/donut-chart.ts";

const options = { radius: 70, gap: 3 };
const circumference = 2 * Math.PI * 70;
const lengths = segment => segment.dashArray.split(" ").map(Number);

test("segments keep the received order and follow each other around the ring", () => {
  const segments = donutSegments([1, 3], options);
  assert.deepEqual(segments.map(segment => segment.index), [0, 1]);
  assert.equal(segments.reduce((sum, segment) => sum + segment.fraction, 0), 1);
  // Each arc is its share of the ring less the gap, and the next one starts where the previous share ends.
  assert.ok(Math.abs(lengths(segments[0])[0] - (circumference / 4 - 3)) < .01);
  assert.ok(Math.abs(lengths(segments[1])[0] - (circumference * 3 / 4 - 3)) < .01);
  assert.ok(Math.abs(lengths(segments[0])[1] - circumference) < .01);
  assert.equal(segments[0].dashOffset, "0");
  assert.ok(Math.abs(Number(segments[1].dashOffset) + circumference / 4) < .01);
});

test("a single category closes the ring without a gap", () => {
  const [segment] = donutSegments([0, 7, 0], options);
  assert.equal(segment.index, 1);
  assert.equal(segment.fraction, 1);
  assert.ok(Math.abs(lengths(segment)[0] - circumference) < .01);
});

test("a tiny share stays visible and empty values or totals draw nothing", () => {
  const [, tiny] = donutSegments([99999, 1], options);
  assert.ok(lengths(tiny)[0] >= .5);
  assert.deepEqual(donutSegments([0, 0], options), []);
  assert.deepEqual(donutSegments([2, 0, 3], options).map(segment => segment.index), [0, 2]);
  assert.deepEqual(donutSegments([Number.NaN, -1, 4], options).map(segment => segment.index), [2]);
});

test("donut geometry stays free of UI text and value imports", async () => {
  const source = await readFile(new URL("../lib/donut-chart.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s+(?!type\b)/mu);
  assert.doesNotMatch(source, /title|label|formatNumber/u);
});
