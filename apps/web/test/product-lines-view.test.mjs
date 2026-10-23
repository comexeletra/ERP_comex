import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const view = await readFile(new URL("../components/ProductLinesView.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");

test("the product lines view reads the API lines and exports the filtered lines to Excel", () => {
  assert.match(view, /\/api\/v1\/purchase-order-lines\?/u);
  assert.match(view, /\/api\/v1\/exports\/purchase-order-lines/u);
  assert.match(view, /anchor\.download = `carteira-por-produto-.*\.xlsx`/u);
  for (const column of ["ETD", "Departure", "BL date", "ETA", "Chegada", "ETE", "Entrega"]) {
    assert.match(view, new RegExp(`<th>${column}</th>`, "u"));
  }
});

test("the sidebar opens the product lines without also highlighting the PO portfolio", () => {
  assert.match(sidebar, /href: "\/purchase-orders\/lines"/u);
  assert.match(sidebar, /exclude: \["\/purchase-orders\/lines"\]/u);
});
