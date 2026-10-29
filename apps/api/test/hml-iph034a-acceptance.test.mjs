import assert from "node:assert/strict";
import test from "node:test";
import { importer, ipNumber, purchaseOrderItems, purchaseOrderNumber, simulationImporter }
  from "../../../deploy/hostinger/seed-hml-iph034a-acceptance.mjs";

const lines = [
  { productCode: "3080500380", description: "BOTAO DE BORRACHA", quantity: "64550", unit: "PCS",
    unitPrice: "0.041999999999999996" },
  { productCode: "2054300540", description: "CAPACITOR", quantity: "1500.5", unit: "PCS", unitPrice: "1.1339997658902026" },
];
const reference = new Map([["3080500380", { description: "BOTAO DE BORRACHA DO SENSOR", unitPrice: "0.04200000" }]]);

test("the IPH034A acceptance PO is a separate PO 030201 in another importer", () => {
  assert.equal(purchaseOrderNumber, "030201");
  assert.equal(ipNumber, "IPH034A/2026");
  assert.notEqual(importer, simulationImporter);
});

test("each invoice line becomes one PO product with its quantity in UN and the simulation price", () => {
  const items = purchaseOrderItems(lines, reference, "Aceite IPH034A");
  assert.deepEqual(items.map(item => item.base), [
    { externalLineReference: "0001", productCode: "3080500380", description: "BOTAO DE BORRACHA DO SENSOR",
      orderedQuantity: "64550", unit: "UN", unitPrice: "0.042", currency: "CNY", reason: "Aceite IPH034A" },
    // A product missing from the simulation PO keeps the invoice description and price (8 decimals at most).
    { externalLineReference: "0002", productCode: "2054300540", description: "CAPACITOR",
      orderedQuantity: "1500.5", unit: "UN", unitPrice: "1.13399977", currency: "CNY", reason: "Aceite IPH034A" },
  ]);
  assert.ok(items.every(item => Object.keys(item.fields).length === 0));
});

test("a repeated product would need its own PO line and is refused", () => {
  assert.throws(() => purchaseOrderItems([lines[0], lines[0]], reference, "Aceite IPH034A"), /3080500380/u);
});
