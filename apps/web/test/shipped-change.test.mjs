import assert from "node:assert/strict";
import test from "node:test";
import { automaticAuditReason, emptyShippedChange, quantityChanged, shippedChangeFields,
  shippedChangeReady } from "../lib/audit.ts";

test("allocations of an IP that has not shipped keep the automatic reason", () => {
  assert.deepEqual(shippedChangeFields(false, emptyShippedChange), { reason: automaticAuditReason });
  assert.equal(shippedChangeReady(false, emptyShippedChange), true);
});

test("a shipped IP needs the confirmation and a typed reason", () => {
  assert.equal(shippedChangeReady(true, emptyShippedChange), false);
  assert.equal(shippedChangeReady(true, { confirmed: true, reason: "  " }), false);
  assert.equal(shippedChangeReady(true, { confirmed: false, reason: "Carga parcial" }), false);
  assert.equal(shippedChangeReady(true, { confirmed: true, reason: automaticAuditReason }), false);
  assert.equal(shippedChangeReady(true, { confirmed: true, reason: " Carga parcial " }), true);
  assert.deepEqual(shippedChangeFields(true, { confirmed: true, reason: " Carga parcial " }),
    { reason: "Carga parcial", confirmShippedChange: true });
});

test("only a different quantity counts as a quantity change", () => {
  assert.equal(quantityChanged("60.00000000", "60"), false);
  assert.equal(quantityChanged("60.50000000", "60,5"), false);
  assert.equal(quantityChanged("60.00000000", "50"), true);
});
