import assert from "node:assert/strict";
import test from "node:test";
import { classifyInvoiceDestination } from "../lib/china-invoice-mapping.ts";

test("invoice destination reports a registered PO that is not active", () => {
  for (const status of ["CANCELLED", "CLOSED", "DELETED"]) {
    assert.deepEqual(classifyInvoiceDestination([], true, "ITEM-1", "2", "", status),
      { kind: "PO_NOT_ACTIVE", status });
  }
});

test("invoice destination keeps the current balance check for an active PO", () => {
  const candidates = [{ id: "item-1", productCode: "ITEM-1", remainingQuantity: "3" }];
  assert.equal(classifyInvoiceDestination(candidates, true, "ITEM-1", "2", "item-1", "ACTIVE"), null);
  assert.deepEqual(classifyInvoiceDestination(candidates, true, "ITEM-1", "4", "item-1", "ACTIVE"),
    { kind: "INSUFFICIENT_BALANCE", requested: "4", available: "3" });
});
