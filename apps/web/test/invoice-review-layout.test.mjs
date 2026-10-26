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

test("invoice audit points form a checklist with pending and confirmed states", () => {
  assert.match(component, /<section className="invoice-audit" aria-label=\{t\.auditPoints\}>/u);
  assert.match(component, /t\.auditProgress\(progress\.confirmed, progress\.required\)/u);
  assert.match(component, /className=\{`notice \$\{point\.confirmed === null \? "" : point\.confirmed \? "success" : "error"\}`\}/u);
  assert.match(component, /<dl className="invoice-audit-values">/u);
  assert.match(component, /<label className="invoice-audit-confirm"><input type="checkbox"/u);
  assert.equal(ptBR.newRecord.auditProgress(1, 2), "1 de 2 confirmados");
  assert.equal(ptBR.newRecord.auditKind.SUPPLIER, "Fornecedor");
  assert.equal(ptBR.newRecord.auditStatus.pending, "Pendente");
  assert.equal(ptBR.newRecord.auditStatus.confirmed, "Confirmado");
});

test("invoice audit confirmations and registry updates keep the checkbox beside its text", () => {
  // .stack-form label is a bold grid and .operational-fields inputs are full width; both must be undone here.
  assert.match(styles, /\.invoice-match-table \.invoice-audit-confirm\s*\{[^}]*display:\s*flex;[^}]*font-weight:\s*400/u);
  assert.match(styles, /\.invoice-audit-confirm input\s*\{[^}]*flex:\s*0 0 auto;/u);
  assert.match(styles, /\.invoice-match-table td:nth-child\(4\) > \.operational-fields input\[type="checkbox"\]\s*\{[^}]*width:\s*auto/u);
});

test("invoice comparison is a table with highlighted divergent fields", () => {
  assert.match(component, /<table className="invoice-compare-table">/u);
  assert.match(component, /className=\{row\.differs \? "invoice-compare-differs" : undefined\}/u);
  assert.match(styles, /\.invoice-match-table \.invoice-compare-table th, \.invoice-match-table \.invoice-compare-table td\s*\{[^}]*position:\s*static;[^}]*width:\s*auto/u);
  assert.equal(ptBR.newRecord.compareField.ncm, "NCM");
});
