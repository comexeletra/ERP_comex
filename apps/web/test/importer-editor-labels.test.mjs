import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const catalogPage = readFileSync(new URL("../app/catalog/values/page.tsx", import.meta.url), "utf8");

test("shows a title above every importer field while editing.", () => {
  assert.ok(catalogPage.includes('{entity === "importer" ? "Código do importador" : "Código"}'));
  assert.ok(catalogPage.includes('<label htmlFor={`operational-short-name-${option.id}`}>Nome reduzido'));
  assert.ok(catalogPage.includes('<label htmlFor={`operational-import-cons-${option.id}`}>Import/Cons.'));
  assert.ok(catalogPage.includes('<label htmlFor={`operational-cnpj-${option.id}`}>CNPJ'));
  assert.ok(catalogPage.includes('{entity === "importer" ? "Nome completo" : "Valor"}'));
});
