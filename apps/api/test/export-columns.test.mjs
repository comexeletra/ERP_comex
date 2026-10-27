import assert from "node:assert/strict";
import test from "node:test";
import { exportColumnCatalogs, resolveExportColumns } from "../dist/export-columns.js";
// The web mirror is plain TypeScript data; Node 24 strips the types on import.
import { exportColumnCatalog as webCatalog } from "../../web/lib/export-columns.ts";

const keys = columns => columns.map(column => column.key);
const stageKeys = ["T0", "T1", "T2", "T3", "T4", "T5"].flatMap(code => ["Deadline", "Actual", "Target", "Days", "Delay"]
  .map(measure => `${code.toLowerCase()}${measure}`));

test("each context lists the columns of its screen table, in the table order", () => {
  assert.deepEqual(keys(exportColumnCatalogs.portfolio), ["poNumber", "importer", "lifecycleStatus", "itemCount",
    "linkedProcessCount", "itemsWithoutIp", "unresolvedIssueCount"]);
  assert.deepEqual(keys(exportColumnCatalogs["product-lines"]), ["poNumber", "importer", "product", "productDescription",
    "quantity", "ipNumber", "status", "etd", "departure", "blDate", "eta", "arrival", "ete", "delivery", "factoryShip",
    "invoice"]);
  assert.deepEqual(keys(exportColumnCatalogs["end-to-end"]), ["necessity", "poNumber", "scNumber", "ipNumber", "status",
    "purpose", "productCode", "description", "modal", "group", "quantity", "accumulatedDelay", ...stageKeys,
    "totalTarget", "totalActual", "totalDelay", "bottleneck", "currentStatus", "arrivalMonth"]);
});

test("resolution dedupes, adds the required columns and keeps the catalog order", () => {
  const resolved = resolveExportColumns("product-lines", [
    { key: "eta", header: "ETA" }, { key: "importer", header: "Importer" }, { key: "eta", header: "ETA 2" },
  ], {});
  assert.deepEqual(resolved.map(column => [column.key, column.header]), [
    ["poNumber", "PO"], ["importer", "Importer"], ["product", "Produto"], ["productDescription", "Descrição"],
    ["eta", "ETA"],
  ]);
  const translated = resolveExportColumns("product-lines", [{ key: "product", header: "Product" },
    { key: "productDescription", header: "Description" }], {});
  assert.deepEqual(translated.map(column => column.header), ["PO", "Product", "Description"]);
});

test("resolution rejects unknown keys and keys of another context", () => {
  assert.equal(resolveExportColumns("portfolio", [{ key: "eta", header: "ETA" }], {}), null);
  assert.equal(resolveExportColumns("end-to-end", [{ key: "nope", header: "X" }], {}), null);
  assert.equal(resolveExportColumns("product-lines", [{ key: "t0Deadline", header: "X" }], {}), null);
  assert.equal(resolveExportColumns("portfolio", [], {}), null);
  const tooMany = Array.from({ length: exportColumnCatalogs.portfolio.length + 1 }, () => ({ key: "importer", header: "I" }));
  assert.equal(resolveExportColumns("portfolio", tooMany, {}), null);
});

test("the accumulated delay exists only in the reached view of a stage, as in the table", () => {
  const requested = [{ key: "accumulatedDelay", header: "Acumulado" }, { key: "totalDelay", header: "Atraso" }];
  assert.deepEqual(keys(resolveExportColumns("end-to-end", requested, {})), ["poNumber", "productCode", "totalDelay"]);
  assert.deepEqual(keys(resolveExportColumns("end-to-end", requested, { stage: "T3", view: "current" })),
    ["poNumber", "productCode", "totalDelay"]);
  assert.deepEqual(keys(resolveExportColumns("end-to-end", requested, { stage: "T3", view: "reached" })),
    ["poNumber", "productCode", "accumulatedDelay", "totalDelay"]);
});

test("the web catalog mirrors the API catalogs (keys, order, required and dependent columns)", () => {
  for (const context of ["portfolio", "product-lines", "end-to-end"]) {
    const api = exportColumnCatalogs[context].map(column => ({ key: column.key, required: column.required === true,
      follows: column.follows ?? null, conditional: column.available !== undefined }));
    const web = webCatalog[context].map(column => ({ key: column.key, required: column.required === true,
      follows: column.follows ?? null, conditional: column.conditional === true }));
    assert.deepEqual(web, api, context);
  }
});
