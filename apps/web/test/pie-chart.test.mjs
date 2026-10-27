import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pieSlices } from "../lib/pie-chart.ts";

const options = { centerX: 100, centerY: 100, radius: 80, labelRadius: 104 };

test("pie slices keep the received order and run clockwise from twelve o'clock", () => {
  const slices = pieSlices([1, 1], options);
  assert.equal(slices.length, 2);
  assert.equal(slices.reduce((sum, slice) => sum + slice.fraction, 0), 1);
  assert.match(slices[0].d, /^M 100 20 A 80 80 0 0 1 100 180 L 100 100 Z$/u);
  assert.ok(slices[0].label && slices[0].guide);
  assert.ok(slices[0].label.x > 100, "the first label is on the right half");
  assert.ok(slices[1].label.x < 100, "the second label is on the left half");
});

test("a single non-zero value is a full circle made from two arcs", () => {
  const [slice] = pieSlices([0, 7, 0], options);
  assert.equal(slice.index, 1);
  assert.equal(slice.fraction, 1);
  assert.equal((slice.d.match(/ A /gu) ?? []).length, 2);
});

test("zero totals and zero values do not create paths", () => {
  assert.deepEqual(pieSlices([0, 0], options), []);
  assert.deepEqual(pieSlices([2, 0, 3], options).map(slice => slice.index), [0, 2]);
});

test("slices below two percent omit the external label and guide", () => {
  const slices = pieSlices([99, 1], options);
  assert.ok(slices[0].label && slices[0].guide);
  assert.equal(slices[1].label, null);
  assert.equal(slices[1].guide, null);
});

test("pie geometry stays free of UI text and value imports", async () => {
  const source = await readFile(new URL("../lib/pie-chart.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s+(?!type\b)/mu);
  assert.doesNotMatch(source, /title|labelText|formatNumber/u);
});
