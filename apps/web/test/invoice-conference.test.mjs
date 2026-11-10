import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { invoiceConferenceTotals, invoiceLineChecks, invoicePackingDecisionsReady, invoicePackingDivergences,
  invoicePackingListDecisions, invoiceValueByPo } from "../lib/china-invoice-mapping.ts";

// User decision (2026-11-10): the conference is shown to the analyst during the audit; nothing new is saved in the IP,
// and a divergence between INV and PKL waits for the analyst's confirmation and reason.

const line = (sourceRow, lineNumber, quantity, unitPrice, amount, netWeightKg, grossWeightKg) =>
  ({ sourceRow, lineNumber, quantity, unitPrice, amount, netWeightKg, grossWeightKg });
const lines = [line(16, "1", "1030", "0.2232524272", "229.95", "9.3", "13.54"), line(17, "2", "420", "1.5855", "665.91", "0.4", "0.5")];

test("the totals of the lines are set against the declared TOTAL row and the PKL totals", () => {
  const rows = invoiceConferenceTotals(lines, { quantity: "1450", netWeightKg: "9.7", grossWeightKg: "14.05", amount: "895.86" },
    { quantity: "1450", netWeightKg: "9.69", grossWeightKg: "14.04" });
  assert.deepEqual(rows, [
    { measure: "quantity", lines: "1450", declared: "1450", declaredDifference: "0", declaredMatches: true,
      packing: "1450", packingDifference: "0", packingMatches: true },
    { measure: "netWeight", lines: "9.7", declared: "9.7", declaredDifference: "0", declaredMatches: true,
      packing: "9.69", packingDifference: "-0.01", packingMatches: true },
    { measure: "grossWeight", lines: "14.04", declared: "14.05", declaredDifference: "0.01", declaredMatches: true,
      packing: "14.04", packingDifference: "0", packingMatches: true },
    { measure: "amount", lines: "895.86", declared: "895.86", declaredDifference: "0", declaredMatches: true,
      packing: null, packingDifference: null, packingMatches: null },
  ]);
});

test("a total beyond the tolerance of the parser (0.011) or missing does not match", () => {
  const rows = invoiceConferenceTotals(lines, { quantity: "1451", netWeightKg: "", grossWeightKg: "14.04", amount: "895.872" }, null);
  assert.deepEqual(rows.map(row => [row.declared, row.declaredDifference, row.declaredMatches, row.packing, row.packingMatches]), [
    ["1451", "1", false, null, null], [null, null, false, null, null], ["14.04", "0", true, null, null], ["895.872", "0.012", false, null, null],
  ]);
  assert.deepEqual(invoiceConferenceTotals(lines, null, null).map(row => row.declaredMatches), [false, false, false, false]);
});

test("each line is checked for quantity × price = total and net weight ≤ gross weight", () => {
  const checks = invoiceLineChecks([...lines, line(18, "3", "10", "2", "20.02", "5", "4"), line(19, "4", "10", "2", "20.011", "", "1"),
    line(20, "5", "3", "0.333333333333333", "1", "1", "1")]);
  assert.deepEqual(checks, { lines: 5, totalFailures: [18], weightFailures: [18, 19] });
});

test("INV and PKL are paired by line number and every field difference is a divergence", () => {
  const packing = [
    { sourceRow: 13, lineNumber: "01", quantity: "1030", netWeightKg: "9.3", grossWeightKg: "13.54" },
    { sourceRow: 14, lineNumber: "2", quantity: "419", netWeightKg: "0.4", grossWeightKg: "0.50000001" },
    { sourceRow: 15, lineNumber: "9", quantity: "1", netWeightKg: "1", grossWeightKg: "1" },
  ];
  assert.deepEqual(invoicePackingDivergences([...lines, line(18, "3", "5", "1", "5", "1", "2")], packing), [
    { key: "inv:17", lineNumber: "2", invoiceRow: 17, packingRow: 14, fields: ["quantity", "grossWeightKg"],
      invoice: { quantity: "420", netWeightKg: "0.4", grossWeightKg: "0.5" },
      packing: { quantity: "419", netWeightKg: "0.4", grossWeightKg: "0.50000001" } },
    { key: "inv:18", lineNumber: "3", invoiceRow: 18, packingRow: null, fields: ["quantity", "netWeightKg", "grossWeightKg"],
      invoice: { quantity: "5", netWeightKg: "1", grossWeightKg: "2" }, packing: null },
    { key: "pkl:15", lineNumber: "9", invoiceRow: null, packingRow: 15, fields: ["quantity", "netWeightKg", "grossWeightKg"],
      invoice: null, packing: { quantity: "1", netWeightKg: "1", grossWeightKg: "1" } },
  ]);
  assert.deepEqual(invoicePackingDivergences(lines, [
    { sourceRow: 13, lineNumber: "1", quantity: "1030.0", netWeightKg: "9.30", grossWeightKg: "13.54" },
    { sourceRow: 14, lineNumber: "2", quantity: "420", netWeightKg: "0.4", grossWeightKg: "0.5" },
  ]), []);
});

test("a repeated line number in the PKL is a divergence of its own", () => {
  const packing = [
    { sourceRow: 13, lineNumber: "1", quantity: "1030", netWeightKg: "9.3", grossWeightKg: "13.54" },
    { sourceRow: 14, lineNumber: "1", quantity: "1030", netWeightKg: "9.3", grossWeightKg: "13.54" },
  ];
  assert.deepEqual(invoicePackingDivergences(lines.slice(0, 1), packing).map(entry => entry.key), ["pkl:14"]);
});

test("every INV × PKL divergence needs the confirmation and a reason, saved with the invoice metadata", () => {
  const divergences = invoicePackingDivergences(lines, [
    { sourceRow: 13, lineNumber: "1", quantity: "1030", netWeightKg: "9.3", grossWeightKg: "13.6" },
  ]);
  assert.equal(divergences.length, 2);
  assert.equal(invoicePackingDecisionsReady([], {}), true);
  const decisions = { "inv:16": { confirmed: true, reason: " Peso corrigido no BL " }, "inv:17": { confirmed: true, reason: "ab" } };
  assert.equal(invoicePackingDecisionsReady(divergences, decisions), false);
  decisions["inv:17"] = { confirmed: true, reason: "Linha fora da PKL enviada" };
  assert.equal(invoicePackingDecisionsReady(divergences, decisions), true);
  assert.deepEqual(invoicePackingListDecisions(divergences, decisions), [
    { invoiceRow: 16, packingRow: 13, lineNumber: "1", fields: ["grossWeightKg"],
      invoice: { quantity: "1030", netWeightKg: "9.3", grossWeightKg: "13.54" },
      packing: { quantity: "1030", netWeightKg: "9.3", grossWeightKg: "13.6" }, reason: "Peso corrigido no BL" },
    { invoiceRow: 17, packingRow: null, lineNumber: "2", fields: ["quantity", "netWeightKg", "grossWeightKg"],
      invoice: { quantity: "420", netWeightKg: "0.4", grossWeightKg: "0.5" }, packing: null, reason: "Linha fora da PKL enviada" },
  ]);
});

test("INV × PKL values are shown with every decimal they have", async () => {
  const { formatDecimal } = await import("../lib/format-number.ts");
  assert.equal(formatDecimal("0.50000001"), "0,50000001");
  assert.equal(formatDecimal("39576.0416263636"), "39.576,0416263636");
  assert.equal(formatDecimal("1030"), "1.030");
  assert.equal(formatDecimal(""), "—");
});

test("the destined value at the invoice price is set against the PO price, only for PO items in CNY with a price", () => {
  const value = invoiceValueByPo([
    { quantity: "100", invoicePrice: "0.5", poPrice: "0.4", poCurrency: "CNY" },
    { quantity: "3", invoicePrice: "0.333333333333333", poPrice: "0.333333333333333", poCurrency: "CNY" },
    { quantity: "10", invoicePrice: "2", poPrice: "1.5", poCurrency: "USD" },
    { quantity: "10", invoicePrice: "2", poPrice: null, poCurrency: "CNY" },
    { quantity: "0", invoicePrice: "2", poPrice: "1", poCurrency: "CNY" },
  ]);
  assert.deepEqual(value, { invoiceValue: "50.999999999999999", poValue: "40.999999999999999", difference: "10",
    percent: 24.3902, counted: 2, excluded: 2 });
  assert.deepEqual(invoiceValueByPo([]), { invoiceValue: "0", poValue: "0", difference: "0", percent: null, counted: 0, excluded: 0 });
  assert.equal(invoiceValueByPo([{ quantity: "1", invoicePrice: "1", poPrice: "0", poCurrency: "CNY" }]).percent, null);
});

test("the conference panel is shown in the audit, blocks the save on pending INV × PKL divergences and sends the decisions", async () => {
  const record = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../components/InvoiceConference.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/styles/features/operations.css", import.meta.url), "utf8");
  assert.match(record, /<InvoiceConference draft=\{invoiceDraft\} divergences=\{packingDivergences\} decisions=\{packingDecisions\}/u);
  assert.match(record, /if \(!packingDecisionsReady\) throw new Error\(t\.conference\.decisionsPending\);/u);
  assert.match(record, /\|\| !invoiceLinesReady \|\| !packingDecisionsReady/u);
  assert.match(record, /packingListDecisions: invoicePackingListDecisions\(packingDivergences, packingDecisions\)/u);
  assert.equal((record.match(/setPackingDecisions\(\{\}\)/gu) ?? []).length, 2);
  assert.match(panel, /<label className="invoice-audit-confirm"><input type="checkbox" checked=\{decision\.confirmed\}/u);
  assert.match(panel, /<label className="invoice-audit-reason">\{t\.reason\}<input required minLength=\{3\}/u);
  for (const name of ["invoice-conference", "invoice-conference-table", "invoice-conference-checks"]) {
    assert.match(styles, new RegExp(String.raw`\.${name}[\s,{]`, "u"), name);
  }
});

test("the conference texts exist in the three languages", async () => {
  const { ptBR } = await import("../lib/i18n/pt-BR.ts");
  const { en } = await import("../lib/i18n/en.ts");
  const { zhCN } = await import("../lib/i18n/zh-CN.ts");
  assert.equal(ptBR.newRecord.conference.lineTotals(62, 62), "QTY × Price = Total: 62 de 62 linhas.");
  assert.equal(en.newRecord.conference.packing("158", "157,73"), "Packing list: 158 packages, 157,73 CBM.");
  assert.match(zhCN.newRecord.conference.divergencesTitle(2), /INV × PKL/u);
  assert.deepEqual(Object.keys(en.newRecord.conference).sort(), Object.keys(ptBR.newRecord.conference).sort());
  assert.deepEqual(Object.keys(zhCN.newRecord.conference).sort(), Object.keys(ptBR.newRecord.conference).sort());
});
