import assert from "node:assert/strict";
import test from "node:test";
import { parseProductCatalogJson } from "../lib/catalog-products-json.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

const parseProducts = text => parseProductCatalogJson(text, ptBR);

test("parses a JSON list of product codes and descriptions and trims both fields", () => {
  assert.deepEqual(parseProducts(JSON.stringify([
    { code: " PROD-001 ", description: " Produto um " },
  ])), [{ code: "PROD-001", description: "Produto um" }]);
});

test("accepts the products wrapper and enforces record limits and required fields", () => {
  assert.deepEqual(parseProducts(JSON.stringify({ products: [
    { code: "P-1", description: "Produto" },
  ] })), [{ code: "P-1", description: "Produto" }]);
  assert.throws(() => parseProducts("[]"), /1 a 500/u);
  assert.throws(() => parseProducts(JSON.stringify([{ code: "P-1", description: " " }])), /código e descrição/u);
  assert.throws(() => parseProducts(JSON.stringify(Array.from({ length: 501 }, (_, index) => ({
    code: `P-${index}`, description: "Produto",
  })))), /1 a 500/u);
});

test("rejects codes and descriptions that exceed the catalog field limits", () => {
  assert.throws(() => parseProducts(JSON.stringify([{ code: "P".repeat(121), description: "Produto" }])), /120 caracteres/u);
  assert.equal(parseProducts(JSON.stringify([{ code: "P-1", description: "D".repeat(878) }]))[0].description.length, 878);
  assert.throws(() => parseProducts(JSON.stringify([{ code: "P-1", description: "D".repeat(2001) }])), /2000/u);
});

test("product JSON errors follow the chosen language", () => {
  assert.throws(() => parseProductCatalogJson("[]", en), /1 to 500 products/u);
});
