import assert from "node:assert/strict";
import test from "node:test";
import { formatNumber } from "../lib/format-number.ts";

test("formats numeric values with exactly two decimal places", () => {
  assert.equal(formatNumber("500000.00000000"), "500.000,00");
  assert.equal(formatNumber("12345.6789"), "12.345,68");
  assert.equal(formatNumber("12,5"), "12,50");
  assert.equal(formatNumber(42), "42,00");
});

test("keeps nonnumeric values and supports an empty-value fallback", () => {
  assert.equal(formatNumber("PO 030201"), "PO 030201");
  assert.equal(formatNumber(null), "—");
  assert.equal(formatNumber(null, "Não informado"), "Não informado");
});
