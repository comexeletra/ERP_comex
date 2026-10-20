import assert from "node:assert/strict";
import test from "node:test";
import { filterSearchableOptions, normalizeSearchText } from "../lib/searchable-options.ts";

test("normalizes accents and surrounding whitespace for option search", () => {
  assert.equal(normalizeSearchText("  Importação  "), "importacao");
});

test("finds a supplier by code or legal name without requiring accents", () => {
  const suppliers = [
    { value: "00042", label: "00042 · Comércio São João Ltda" },
    { value: "00077", label: "00077 · Northwind Trading" },
  ];

  assert.deepEqual(filterSearchableOptions(suppliers, "sao joao"), [suppliers[0]]);
  assert.deepEqual(filterSearchableOptions(suppliers, " 00077 "), [suppliers[1]]);
});

test("search includes secondary terms and keeps disabled matches visible", () => {
  const options = [
    { value: "item-1", label: "PO 500 · ITEM-A", searchText: "válvula de pressão", disabled: true },
    { value: "item-2", label: "PO 600 · ITEM-B", searchText: "bomba hidráulica" },
  ];

  assert.deepEqual(filterSearchableOptions(options, "valvula"), [options[0]]);
  assert.deepEqual(filterSearchableOptions(options, ""), options);
});
