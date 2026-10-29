import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");

test("the invoice review never offers to overwrite the PO item with the invoice", () => {
  assert.doesNotMatch(component, /updatePoItem|poItemUpdates/u);
  assert.match(component, /catalogUpdates: \{ products: \[\.\.\.productUpdates\.values\(\)\] \}/u);
});

test("the product update is offered only when the invoice can fill an empty field", () => {
  assert.match(component, /invoiceProductFillFields\(/u);
  assert.doesNotMatch(component, /name: line\.description, ncmCode/u);
});
