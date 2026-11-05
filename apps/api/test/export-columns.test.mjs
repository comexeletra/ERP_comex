import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.deepEqual(keys(exportColumnCatalogs["pre-shipment"]), ["necessity", "mode", "status", "requester", "scNumber",
    "poNumber", "ipNumber", "etd", "eta", "ete", "productCode", "description", "quantity", "supplier", "importer", "purpose",
    "poSentDate"]);
});

test("the pre-shipment export always writes the PO and the product of the dashboard line", () => {
  const resolved = resolveExportColumns("pre-shipment", [{ key: "eta", header: "ETA" }], {});
  assert.deepEqual(resolved.map(column => column.key), ["poNumber", "eta", "productCode"]);
  const line = { purchaseOrder: { id: "x", number: "031287" }, productCode: "3090518270L", eta: "2026-12-09", quantity: "15.00000000",
    process: null };
  assert.deepEqual(resolved.map(column => column.value(line)), ["031287", "2026-12-09", "3090518270L"]);
  const quantity = resolveExportColumns("pre-shipment", [{ key: "quantity", header: "Qty" }], {}).find(column => column.key === "quantity");
  assert.equal(quantity.value(line), 15);
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

test("the End to End stage columns carry their stage, colored in the file as the screen tokens", async () => {
  const { exportStageColors } = await import("../dist/purchase-order-exports.js");
  const staged = exportColumnCatalogs["end-to-end"].filter(column => column.stage);
  assert.deepEqual(staged.map(column => column.key), stageKeys);
  for (const column of staged) assert.equal(column.key.slice(0, 2), column.stage.toLowerCase(), column.key);
  // The light theme of the screen (apps/web/app/styles/tokens.css), the colors of a printed sheet.
  const tokens = await readFile(new URL("../../web/app/styles/tokens.css", import.meta.url), "utf8");
  const light = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf(':root[data-theme="dark"]'));
  const token = name => `FF${new RegExp(`${name}:\\s*#([0-9a-f]{6})`, "u").exec(light)[1].toUpperCase()}`;
  for (const code of ["T0", "T1", "T2", "T3", "T4", "T5"]) {
    const stage = code.toLowerCase();
    assert.deepEqual(exportStageColors[code], { header: token(`--color-stage-${stage}-bg`),
      values: token(`--color-stage-${stage}-tint`), border: token(`--color-stage-${stage}-border`) }, code);
  }
});

test("the web catalog mirrors the API catalogs (keys, order, required and dependent columns)", () => {
  for (const context of ["portfolio", "product-lines", "end-to-end", "pre-shipment"]) {
    const api = exportColumnCatalogs[context].map(column => ({ key: column.key, required: column.required === true,
      follows: column.follows ?? null, conditional: column.available !== undefined }));
    const web = webCatalog[context].map(column => ({ key: column.key, required: column.required === true,
      follows: column.follows ?? null, conditional: column.conditional === true }));
    assert.deepEqual(web, api, context);
  }
});
