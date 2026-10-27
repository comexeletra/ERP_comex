import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { choosableColumns, columnsBody, exportColumnCatalog, exportStageMeasures, initialSelection, readSavedColumns,
  savedSelection, setColumns, writeSavedColumns } from "../lib/export-columns.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const source = path => readFile(new URL(path, import.meta.url), "utf8");
const [portfolioPage, productLinesView, e2eView, dialog, exportHook] = await Promise.all([
  source("../app/page.tsx"), source("../components/ProductLinesView.tsx"), source("../components/E2eLinesView.tsx"),
  source("../components/ExportColumnsDialog.tsx"), source("../components/useProductLineExport.ts"),
]);

const keys = context => exportColumnCatalog[context].filter(column => !column.follows).map(column => column.key);
const labels = (columns, filters = {}) => columns.map(column => column.label(ptBR, filters));
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

// Header cells of a table in the JSX, evaluated with the dictionary the screen uses.
function headerCells(jsx, scope) {
  return [...jsx.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map(([, content]) => {
    const text = content.trim();
    const expression = /^\{([\s\S]+)\}$/u.exec(text);
    // eslint-disable-next-line no-new-func -- evaluates header expressions of our own JSX in the test
    return expression ? new Function(...Object.keys(scope), `return ${expression[1]};`)(...Object.values(scope)) : text;
  });
}
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test("Carteira de POs: the export offers the data columns of the table, in its order (D10)", () => {
  const head = between(portfolioPage, "<thead><tr><th>{t.totvsPo}", "</thead>");
  const cells = headerCells(head, { m: ptBR, t: ptBR.portfolio });
  assert.equal(cells.at(-1), ptBR.poPanel.action, "the last column is the action, which has no data");
  assert.deepEqual(labels(exportColumnCatalog.portfolio), cells.slice(0, -1));
});

test("Carteira por produto: the export offers the data columns of the table, in its order (D10)", () => {
  const head = between(productLinesView, 'className="product-lines-table"><thead>', "</thead>");
  const cells = headerCells(head, { m: ptBR, t: ptBR.productLines });
  assert.deepEqual(labels(choosableColumns("product-lines", {})), cells);
  // The product cell also shows the description, exported as its own column with the product.
  assert.match(productLinesView, /<td><strong>\{line\.item\.productCode\}<\/strong>\s*<small className="product-lines-description"/u);
  assert.deepEqual(exportColumnCatalog["product-lines"].find(column => column.follows), exportColumnCatalog["product-lines"][3]);
});

test("End to End: the export offers the data columns of the table, in its order (D10)", () => {
  const head = between(e2eView, 'className="e2e-lines-table">', "</thead>");
  const filters = { stage: "T3", view: "reached" };
  const scope = { m: ptBR, t: ptBR.e2eLines, flow: ptBR.e2eLines.flow, accumulatedStage: "T3" };
  const [firstRow, secondRow] = head.split("</tr>");
  const leading = headerCells(firstRow.slice(0, firstRow.indexOf("E2E_STAGE_CODES.map")), scope);
  const trailing = headerCells(firstRow.slice(firstRow.indexOf("<th colSpan={3}")), scope);
  const catalog = choosableColumns("end-to-end", filters);
  const stageStart = catalog.findIndex(column => column.stage);
  const totalsStart = catalog.findIndex(column => column.total);
  assert.deepEqual(labels(catalog.slice(0, stageStart), filters), leading);
  // Each stage spans one column per measure, in the order of the measures.
  assert.match(firstRow, new RegExp(`E2E_STAGE_CODES\\.map\\(\\(code, index\\) => <th key=\\{code\\} colSpan=\\{${exportStageMeasures.length}\\}`, "u"));
  const measures = /E2E_STAGE_CODES\.map\(code => \[([^\]]+)\]\.map/u.exec(secondRow)[1].split(",").map(item => item.trim());
  assert.deepEqual(measures, exportStageMeasures.map(measure => `t.${measure}`));
  assert.deepEqual(catalog.slice(stageStart, totalsStart).map(column => `${column.stage}:${column.measure}`),
    ["T0", "T1", "T2", "T3", "T4", "T5"].flatMap(code => exportStageMeasures.map(measure => `${code}:${measure}`)));
  const totals = headerCells(secondRow.slice(secondRow.lastIndexOf("))}") + 3), scope);
  const catalogTotals = catalog.filter(column => column.total);
  assert.deepEqual(catalogTotals.map(column => column.label(ptBR, filters)), totals.map(label => `${ptBR.e2eLines.totals} ${label}`));
  assert.deepEqual(trailing[0], ptBR.e2eLines.totals);
  assert.deepEqual(labels(catalog.slice(totalsStart + catalogTotals.length), filters), trailing.slice(1));
});

test("the dialog opens with every column, keeps the required ones and drops keys no longer in the table", () => {
  assert.deepEqual(initialSelection("product-lines", null), keys("product-lines"));
  assert.deepEqual(initialSelection("portfolio", { all: true }), keys("portfolio"));
  assert.deepEqual(initialSelection("portfolio", { all: false, keys: ["itemCount", "removedColumn", 7] }),
    ["poNumber", "itemCount"]);
  assert.deepEqual(initialSelection("end-to-end", "garbage"), keys("end-to-end"));
  // A choice of every column brings the columns added later to the table.
  assert.deepEqual(savedSelection("portfolio", keys("portfolio")), { all: true });
  assert.deepEqual(savedSelection("portfolio", ["poNumber", "importer"]), { all: false, keys: ["poNumber", "importer"] });
  // The accumulated delay is out of most views, so it does not keep a full choice from counting as "all".
  assert.deepEqual(savedSelection("end-to-end", keys("end-to-end").filter(key => key !== "accumulatedDelay")), { all: true });
});

test("columns are toggled alone, by group or all at once, and the required ones stay", () => {
  const all = keys("end-to-end");
  const cleared = setColumns("end-to-end", all, all, false);
  assert.deepEqual(cleared, ["poNumber", "productCode"]);
  const t3 = exportColumnCatalog["end-to-end"].filter(column => column.stage === "T3").map(column => column.key);
  assert.deepEqual(setColumns("end-to-end", cleared, t3, true), ["poNumber", "productCode", ...t3]);
  const delays = exportColumnCatalog["end-to-end"].filter(column => column.measure === "delay").map(column => column.key);
  assert.deepEqual(setColumns("end-to-end", all, delays, false).filter(key => delays.includes(key)), []);
  assert.deepEqual(setColumns("portfolio", ["poNumber"], ["importer"], true), ["poNumber", "importer"]);
});

test("the export body lists the chosen columns in the table order with headers in the viewer's language", () => {
  const filters = { stage: "T3", view: "reached" };
  assert.deepEqual(columnsBody("product-lines", ["eta", "poNumber", "product"], ptBR, {}), {
    context: "product-lines",
    columns: [{ key: "poNumber", header: "PO" }, { key: "product", header: ptBR.followup.product },
      { key: "productDescription", header: ptBR.e2eLines.description }, { key: "eta", header: "ETA" }],
  });
  assert.deepEqual(columnsBody("end-to-end", ["accumulatedDelay", "t3Delay"], en, filters).columns, [
    { key: "poNumber", header: "PO" }, { key: "productCode", header: en.e2eLines.product },
    { key: "accumulatedDelay", header: en.e2eLines.flow.accumulated("T3") },
    { key: "t3Delay", header: `T3 ${en.e2eLines.delay}` },
  ]);
  // Without the reached view of a stage the accumulated delay is not in the table, nor in the file.
  assert.deepEqual(columnsBody("end-to-end", ["accumulatedDelay"], zhCN, {}).columns.map(column => column.key),
    ["poNumber", "productCode"]);
  assert.deepEqual(columnsBody("portfolio", ["unresolvedIssueCount"], zhCN, {}).columns,
    [{ key: "poNumber", header: zhCN.portfolio.totvsPo }, { key: "unresolvedIssueCount", header: zhCN.portfolio.pending }]);
  for (const m of [ptBR, en, zhCN]) {
    for (const context of ["portfolio", "product-lines", "end-to-end"]) {
      for (const column of exportColumnCatalog[context]) assert.ok(column.label(m, filters).trim(), `${context}.${column.key}`);
    }
  }
});

test("the choice is kept per screen in the browser and survives blocked storage", () => {
  const storage = memoryStorage();
  writeSavedColumns(storage, "end-to-end", ["poNumber", "productCode", "t3Delay"]);
  assert.deepEqual(readSavedColumns(storage, "end-to-end"), { all: false, keys: ["poNumber", "productCode", "t3Delay"] });
  assert.equal(readSavedColumns(storage, "portfolio"), null);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => writeSavedColumns(blocked, "portfolio", ["poNumber"]));
  assert.equal(readSavedColumns(blocked, "portfolio"), null);
  assert.equal(readSavedColumns({ getItem: () => "{not json" }, "portfolio"), null);
});

test("each export button opens the column dialog of its screen and sends the chosen columns", () => {
  assert.match(portfolioPage, /<ExportColumnsDialog context="portfolio"/u);
  assert.match(productLinesView, /<ExportColumnsDialog context="product-lines"/u);
  assert.match(e2eView, /<ExportColumnsDialog context="end-to-end" filters=\{\{ stage: stage\.stage, view \}\}/u);
  // The carteira export follows the lifecycle filter of the screen (D9).
  assert.match(portfolioPage, /lifecycle: applied\.lifecycle \|\| undefined/u);
  assert.match(exportHook, /\.\.\.productLineFilterBody\(filters, stage\), \.\.\.columns/u);
  assert.match(dialog, /<ConfirmDialog open title=\{t\.title\}/u);
  assert.match(dialog, /writeSavedColumns\(browserStorage\(\), context, selection\)/u);
});
