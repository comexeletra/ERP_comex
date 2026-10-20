import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");
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
  assert.match(component, /Resumo antes × depois/u);
  assert.match(component, /orphanPoDecisions: orphanPos\.map/u);
  assert.match(component, /Manter vínculo sem alocação/u);
  assert.match(component, /Remover vínculo/u);
});
