import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ptBR } from "../lib/i18n/pt-BR.ts";

const component = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles/features/operations.css", import.meta.url), "utf8");
const processWorkspace = await readFile(new URL("../components/ProcessWorkspace.tsx", import.meta.url), "utf8");
const newProcessPage = await readFile(new URL("../app/processes/new/page.tsx", import.meta.url), "utf8");

test("invoice review uses a fluid, readable table layout", () => {
  assert.match(component, /className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table"/u);
  assert.match(styles, /\.ip-entry-section\s*\{[^}]*max-width:\s*none;[^}]*width:\s*100%/u);
  assert.match(styles, /\.invoice-match-table\s*\{[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;[^}]*width:\s*100%/u);
  assert.match(styles, /\.invoice-match-table-wrap\s*\{\s*max-height:\s*min\(62vh, 720px\);/u);
  assert.match(styles, /\.invoice-match-table td\s*\{[^}]*white-space:\s*normal/u);
});

test("IP review entry fixes the IP and shows allocation changes and orphan PO choices", () => {
  assert.match(processWorkspace, /href=\{`\/processes\/new\?reviewInvoice=\$\{encodeURIComponent\(id\)\}`\}/u);
  assert.match(newProcessPage, /reviewInvoiceId=/u);
  assert.match(component, /draft\.ipNumber\.trim\(\)\.toLocaleUpperCase/u);
  assert.match(component, /<h3>\{t\.beforeAfter\}<\/h3>/u);
  assert.equal(ptBR.newRecord.beforeAfter, "Resumo antes × depois");
  assert.match(component, /orphanPoDecisions: orphanPos\.map/u);
  assert.match(component, /\{t\.keepLink\}<\/label>/u);
  assert.equal(ptBR.newRecord.keepLink, "Manter vínculo sem alocação");
  assert.match(component, /\{t\.removeLink\}<\/label>/u);
  assert.equal(ptBR.newRecord.removeLink, "Remover vínculo");
});

test("invoice review shows per-row PO action and duplicate confirmation", () => {
  assert.match(component, /classifyInvoiceDestination\(match\.candidates, match\.poExists/u);
  assert.match(component, /t\.insufficient\(formatNumber\(destinationIssue\.requested\)/u);
  assert.match(ptBR.newRecord.insufficient("10", "5"), /^Saldo insuficiente: quantidade pedida 10, disponível 5\.$/u);
  assert.match(component, /href=\{`\/purchase-orders\/\$\{match\.poId\}`\} target="_blank"/u);
  assert.match(component, /href="\/purchase-orders\/new" target="_blank"/u);
  assert.match(component, /\{t\.revalidate\}<\/button>/u);
  assert.equal(ptBR.newRecord.revalidate, "Revalidar POs e saldos");
  assert.match(component, /\{t\.confirmDuplicateInvoice\}<\/label>/u);
  assert.equal(ptBR.newRecord.confirmDuplicateInvoice, "Confirmo a duplicidade desta invoice.");
});
