import assert from "node:assert/strict";
import test from "node:test";
import { estimatedProductTotal, productPriceReferenceForCurrency } from "../lib/product-price-reference.ts";

const references = [
  { currency: "CNY", unitPrice: "0.00589000", purchaseOrderNumber: "030201", observedAt: "2026-10-21" },
  { currency: "USD", unitPrice: "1.25000000", purchaseOrderNumber: "030202", observedAt: "2026-10-22" },
];

test("selects product reference price by exact currency without converting", () => {
  assert.equal(productPriceReferenceForCurrency(references, "cny")?.unitPrice, "0.00589000");
  assert.equal(productPriceReferenceForCurrency(references, "USD")?.purchaseOrderNumber, "030202");
  assert.equal(productPriceReferenceForCurrency(references, "EUR"), undefined);
  assert.equal(productPriceReferenceForCurrency(references, ""), undefined);
});

test("calculates an estimate from the reference while preserving zero item prices", () => {
  const reference = productPriceReferenceForCurrency(references, "CNY");
  assert.equal(estimatedProductTotal("65000", reference), "382.85");
  assert.equal(estimatedProductTotal("2", undefined), null);
  assert.equal(estimatedProductTotal("2", { ...references[0], unitPrice: "0" }), null);
});
