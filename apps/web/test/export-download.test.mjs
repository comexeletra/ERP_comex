import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portfolioPage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("purchase-order export downloads an Excel workbook", () => {
  assert.match(portfolioPage, /anchor\.download = `carteira-pos-.*\.xlsx`/u);
  assert.match(portfolioPage, /Exportar carteira filtrada \(Excel\)/u);
  assert.match(portfolioPage, /Baixar Excel/u);
});
