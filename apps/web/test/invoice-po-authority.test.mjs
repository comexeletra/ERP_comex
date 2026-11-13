import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [component, mapping] = await Promise.all([read("../components/NewOperationalRecord.tsx"), read("../lib/china-invoice-mapping.ts")]);
const save = mapping.slice(mapping.indexOf("export function invoiceAuditProductFills"));

test("the invoice review never offers to overwrite the PO item with the invoice", () => {
  for (const source of [component, mapping]) assert.doesNotMatch(source, /updatePoItem|poItemUpdates/u);
  assert.match(component, /catalogUpdates: saved\.catalogUpdates,/u);
  assert.match(save, /catalogUpdates: \{ products: input\.fills\.map\(fill => \(\{ productCode: fill\.productCode, \.\.\.fill\.values \}\)\) \}/u);
});

// Phase B2 (R7): only the empty fields, with the audited values, never the description nor a flagged NCM.
test("the product update is offered only when the audited invoice can fill an empty field", () => {
  assert.match(save, /const fields = invoiceProductFillFields\(\{ \.\.\.line, ncm: flagged \? "" : line\.ncm \}/u);
  assert.match(save, /if \(!fields\.length\) continue;/u);
  for (const source of [component, save]) assert.doesNotMatch(source, /name: line\.description|description: line\.description/u);
  assert.match(component, /fills: productFillOptions\.filter\(fill => productFills\[fill\.productCode\]\)/u);
});
