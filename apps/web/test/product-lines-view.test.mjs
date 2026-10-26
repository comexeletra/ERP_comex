import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ptBR } from "../lib/i18n/pt-BR.ts";

const view = await readFile(new URL("../components/ProductLinesView.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");
const exportHook = await readFile(new URL("../components/useProductLineExport.ts", import.meta.url), "utf8");

test("the product lines view reads the API lines and exports the filtered lines to Excel", () => {
  assert.match(view, /\/api\/v1\/purchase-order-lines\?/u);
  // The export (queue, wait, download) is shared with the End to End screen.
  assert.match(view, /useProductLineExport\("carteira-por-produto"\)/u);
  assert.match(view, /downloadExcel\(applied\)/u);
  assert.match(exportHook, /\/api\/v1\/exports\/purchase-order-lines/u);
  assert.match(exportHook, /anchor\.download = `\$\{filePrefix\}-.*\.xlsx`/u);
  for (const column of ["ETD", "ETA", "ETE"]) assert.match(view, new RegExp(`<th>${column}</th>`, "u"));
  for (const [key, label] of [["m.followup.departure", ptBR.followup.departure], ["m.fields.blDate", ptBR.fields.blDate],
    ["m.followup.arrival", ptBR.followup.arrival], ["m.followup.delivery", ptBR.followup.delivery]]) {
    assert.match(view, new RegExp(`<th>\\{${key.replaceAll(".", "\\.")}\\}</th>`, "u"));
    assert.ok(["Departure", "BL date", "Chegada", "Entrega"].includes(label), key);
  }
});

test("the product lines show the importer in its own column and truncate long names with the full text on hover", async () => {
  const styles = await readFile(new URL("../app/styles/features/operations.css", import.meta.url), "utf8");
  assert.match(view, /<th>PO<\/th><th>\{m\.followup\.importer\}<\/th><th>\{m\.followup\.product\}<\/th>/u);
  assert.equal(ptBR.followup.importer, "Importadora");
  assert.match(view, /className="product-lines-importer" title=\{line\.purchaseOrder\.importer\}/u);
  assert.match(view, /className="product-lines-description" title=\{line\.item\.description\}/u);
  for (const name of ["product-lines-importer", "product-lines-description"]) {
    const rule = styles.match(new RegExp(`\\.${name} \\{([^}]*)\\}`, "u"))?.[1] ?? "";
    for (const declaration of ["display: block", "max-width:", "overflow: hidden", "text-overflow: ellipsis"]) {
      assert.ok(rule.includes(declaration), `${name} needs ${declaration}`);
    }
  }
});

test("the product lines filter keeps its buttons on their own row below the fields", async () => {
  const styles = await readFile(new URL("../app/styles/features/operations.css", import.meta.url), "utf8");
  assert.match(view, /<form className="portfolio-filter product-lines-filter"/u);
  assert.match(view, /<div className="button-row product-lines-filter-actions"><button className="button" type="submit">\{t\.apply\}<\/button>/u);
  assert.match(styles, /\.product-lines-filter-actions \{[^}]*grid-column: 1 \/ -1;/u);
});

test("the sidebar opens the product lines without also highlighting the PO portfolio", () => {
  assert.match(sidebar, /href: "\/purchase-orders\/lines"/u);
  assert.match(sidebar, /exclude: \["\/purchase-orders\/lines"\]/u);
});
