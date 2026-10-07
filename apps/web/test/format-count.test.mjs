import assert from "node:assert/strict";
import test from "node:test";
import { formatCount } from "../lib/format-count.ts";

test("formats finite counts returned by the API", () => {
  assert.equal(formatCount(1234), "1.234");
  assert.equal(formatCount("1234"), "1.234");
});

test("renders missing and malformed API counts without throwing", () => {
  for (const value of [undefined, null, "", "unknown", Number.NaN, Infinity, {}, []]) {
    assert.equal(formatCount(value), "—");
  }
});
