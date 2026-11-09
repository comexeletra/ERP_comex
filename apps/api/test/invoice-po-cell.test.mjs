import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoicePoCell } from "../dist/invoice-po-cell.js";
// The web reads the same cell when the file is loaded; Node 24 strips the types on import.
import { parseInvoicePoAssignments } from "../../web/lib/china-invoice-xlsx.ts";
import { ptBR } from "../../web/lib/i18n/pt-BR.ts";

const examples = [
  ["PO030201", "1030"],
  ["PO 030321 = 412 unit\nPO 032025 = 8 unit", "420"],
  ["PO 030321 = 29046 units\nPO 032025 = 154 units", "29200"],
  ["PO030201=1,000 pcs, PO030305=999 pcs", "1999"],
  ["PO030201=1,000,000 pcs", "1000000"],
  ["PO030201=12,500.5 pcs", "12500.5"],
  ["PO030201=1.234,5 pcs", "1234.5"],
  ["PO030201=1,5 pcs", "1.5"],
];

test("reads the PO parts and comma thousands of an invoice PO cell", () => {
  assert.deepEqual(parseInvoicePoCell("PO030201=1,000 pcs, PO030305=999 pcs"),
    [{ poNumber: "030201", quantity: "1000" }, { poNumber: "030305", quantity: "999" }]);
  assert.deepEqual(parseInvoicePoCell("PO 030201"), [{ poNumber: "030201", quantity: null }]);
  assert.deepEqual(parseInvoicePoCell("PO030201=12,500.50 pcs"), [{ poNumber: "030201", quantity: "12500.5" }]);
  assert.deepEqual(parseInvoicePoCell("no PO here"), []);
});

test("the API reads each PO cell as the web does", () => {
  for (const [cell, lineQuantity] of examples) {
    const web = parseInvoicePoAssignments(cell, lineQuantity, ptBR)
      .map(part => ({ poNumber: part.poNumber, quantity: part.explicitQuantity ? part.quantity : null }));
    assert.deepEqual(parseInvoicePoCell(cell), web, cell);
  }
});
