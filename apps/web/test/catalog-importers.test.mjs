import assert from "node:assert/strict";
import test from "node:test";
import { filterImporterCatalog, sortImporterCatalog } from "../lib/catalog-importers.ts";

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

test("sorts coded importers by numeric code and leaves legacy values at the end.", () => {
  const items = [
    { id: "legacy-z", value: "Z legacy" },
    { id: "10", code: "10", value: "Importer ten" },
    { id: "legacy-a", value: "A legacy" },
    { id: "02", code: "02", value: "Importer two" },
    { id: "01", code: "01", value: "Importer one" },
  ];

  assert.deepEqual(sortImporterCatalog(items).map(item => item.id), ["01", "02", "10", "legacy-a", "legacy-z"]);
});
