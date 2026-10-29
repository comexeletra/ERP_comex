import assert from "node:assert/strict";
import test from "node:test";
import { classifyInvoiceDestination } from "../lib/china-invoice-mapping.ts";

test("invoice destination reports a registered PO that is not active", () => {
  for (const status of ["CANCELLED", "CLOSED", "DELETED"]) {
    assert.deepEqual(classifyInvoiceDestination([], true, "2", undefined, status),
      { kind: "PO_NOT_ACTIVE", status });
  }
});

test("invoice destination keeps the current balance check for an active PO", () => {
  const candidates = [{ id: "item-1", productCode: "ITEM-1", remainingQuantity: "3" }];
  assert.equal(classifyInvoiceDestination(candidates, true, "2",
    { allocations: [{ itemId: "item-1", quantity: "2" }], available: "3", enough: true }, "ACTIVE"), null);
  assert.deepEqual(classifyInvoiceDestination(candidates, true, "4", { allocations: [], available: "3", enough: false }, "ACTIVE"),
    { kind: "INSUFFICIENT_BALANCE", requested: "4", available: "3" });
});
