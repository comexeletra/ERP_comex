import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

// The bare label took the grid of .stack-form label: the checkbox stood alone, centred above its text (IPH034B, 2026-11-13).
test("the shipped change confirmation keeps the checkbox beside its text", async () => {
  const read = path => readFile(new URL(path, import.meta.url), "utf8");
  const [component, styles] = await Promise.all([read("../components/ShippedChangeConfirmation.tsx"),
    read("../app/styles/features/operations.css")]);
  assert.match(component, /<label className="invoice-audit-confirm"><input type="checkbox" checked=\{value\.confirmed\}[\s\S]{0,120}?\/>\{t\.confirm\}<\/label>/u);
  assert.match(styles, /\.operational-help > \.invoice-audit-confirm(?:, [^{]+)?\s*\{[^}]*display: flex;[^}]*font-weight: 400/u);
});

test("only a different quantity counts as a quantity change", () => {
  assert.equal(quantityChanged("60.00000000", "60"), false);
  assert.equal(quantityChanged("60.50000000", "60,5"), false);
  assert.equal(quantityChanged("60.00000000", "50"), true);
});
