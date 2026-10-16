import assert from "node:assert/strict";
import test from "node:test";
import { parseProductCatalogJson } from "../lib/catalog-products-json.ts";

test("parses a JSON list of product codes and descriptions and trims both fields", () => {
  assert.deepEqual(parseProductCatalogJson(JSON.stringify([
    { code: " PROD-001 ", description: " Produto um " },
  ])), [{ code: "PROD-001", description: "Produto um" }]);
});

test("accepts the products wrapper and enforces record limits and required fields", () => {
  assert.deepEqual(parseProductCatalogJson(JSON.stringify({ products: [
    { code: "P-1", description: "Produto" },
  ] })), [{ code: "P-1", description: "Produto" }]);
  assert.throws(() => parseProductCatalogJson("[]"), /1 a 500/u);
  assert.throws(() => parseProductCatalogJson(JSON.stringify([{ code: "P-1", description: " " }])), /código e descrição/u);
  assert.throws(() => parseProductCatalogJson(JSON.stringify(Array.from({ length: 501 }, (_, index) => ({
    code: `P-${index}`, description: "Produto",
  })))), /1 a 500/u);
});

test("rejects codes and descriptions that exceed the catalog field limits", () => {
  assert.throws(() => parseProductCatalogJson(JSON.stringify([{ code: "P".repeat(121), description: "Produto" }])), /120 caracteres/u);
  assert.throws(() => parseProductCatalogJson(JSON.stringify([{ code: "P-1", description: "D".repeat(241) }])), /240/u);
});
