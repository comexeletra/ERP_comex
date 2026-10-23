import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ptBR } from "../lib/i18n/pt-BR.ts";

const portfolioPage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("purchase-order export downloads an Excel workbook", () => {
  assert.match(portfolioPage, /anchor\.download = `carteira-pos-.*\.xlsx`/u);
  assert.match(portfolioPage, /\{exporting \? m\.productLines\.exporting : t\.export\}/u);
  assert.equal(ptBR.portfolio.export, "Exportar carteira filtrada (Excel)");
  assert.match(portfolioPage, /href=\{job\.downloadPath\}>\{t\.downloadExcel\}<\/a>/u);
  assert.equal(ptBR.portfolio.downloadExcel, "Baixar Excel");
});
