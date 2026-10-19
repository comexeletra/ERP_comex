import assert from "node:assert/strict";
import test from "node:test";
import { filterImporterCatalog } from "../lib/catalog-importers.ts";

const importers = [
  { id: "01", code: "01", value: "Eletra Matriz", shortName: "ELETRA ENERGY-MATRIZ", importCons: "Importador", cnpj: "12.115.480/0001-15" },
  { id: "02", code: "02", value: "Eletra Manaus", importCons: "Consignatario", cnpj: "12.115.480/0005-49" },
];

test("filters importers by Protheus code, name, Import/Cons., or CNPJ.", () => {
  assert.deepEqual(filterImporterCatalog(importers, " 01 "), [importers[0]]);
  assert.deepEqual(filterImporterCatalog(importers, "manaus"), [importers[1]]);
  assert.deepEqual(filterImporterCatalog(importers, "consignatario"), [importers[1]]);
  assert.deepEqual(filterImporterCatalog(importers, "0005-49"), [importers[1]]);
  assert.deepEqual(filterImporterCatalog(importers, "energy-matriz"), [importers[0]]);
  assert.deepEqual(filterImporterCatalog(importers, "  "), importers);
});
