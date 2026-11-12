import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { bulkConfirmations, bulkFlags, bulkPriceChoices, bulkSourceChoices, pendingConfirmations, pendingFlags, pendingPrices,
  pendingSources } from "../lib/invoice-bulk-decisions.ts";

// Stage 1g (user decisions, 2026-11-11): the audit page decides at once every point of a kind; a bulk action fills
// only the points without a decision, and what it cannot decide stays pending and is counted.

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("the bulk price choice fills only the lines without a choice and leaves the uncorrectable ones pending", () => {
  const points = [[16, { correctable: true }], [17, { correctable: false }], [18, { correctable: true }], [19, { correctable: true }]];
  const current = { 18: "ACCEPT" };
  assert.deepEqual(pendingPrices(points, current), [16, 17, 19]);
  const corrected = bulkPriceChoices(points, current, "CORRECT");
  assert.deepEqual(corrected.next, { 16: "CORRECT", 18: "ACCEPT", 19: "CORRECT" });
  assert.deepEqual([corrected.applied, corrected.left], [2, 1]);
  const accepted = bulkPriceChoices(points, current, "ACCEPT");
  assert.deepEqual(accepted.next, { 16: "ACCEPT", 17: "ACCEPT", 18: "ACCEPT", 19: "ACCEPT" });
  assert.deepEqual([accepted.applied, accepted.left], [3, 0]);
  assert.deepEqual(current, { 18: "ACCEPT" });
});

test("the bulk option with a reason keeps the chosen options and leaves the lines it cannot take pending", () => {
  const keys = ["inv:16", "inv:17", "inv:18"];
  const current = { "inv:17": { source: "INVOICE", reason: "" }, "inv:18": { source: null, reason: "olhar" } };
  assert.deepEqual(pendingSources(keys, current), ["inv:16", "inv:18"]);
  const packing = bulkSourceChoices(keys, current, "PACKING", "Pesos da PKL conferidos", key => key !== "inv:18");
  assert.deepEqual(packing.next, { "inv:16": { source: "PACKING", reason: "Pesos da PKL conferidos" },
    "inv:17": { source: "INVOICE", reason: "" }, "inv:18": { source: null, reason: "olhar" } });
  assert.deepEqual([packing.applied, packing.left], [1, 1]);
  // A reason the analyst already typed on the line is kept.
  const kept = bulkSourceChoices(keys, current, "INVOICE", "Mantida a INV");
  assert.deepEqual(kept.next["inv:18"], { source: "INVOICE", reason: "olhar" });
  assert.deepEqual([kept.applied, kept.left], [2, 0]);
});

test("the bulk confirmation fills only what is not confirmed and keeps the reason already typed", () => {
  const keys = [20, 21, 22, 23];
  const current = { 21: { confirmed: true, reason: "" }, 22: { confirmed: false, reason: "Saldo da PO" } };
  assert.deepEqual(pendingConfirmations(keys, current), [20, 22, 23]);
  const result = bulkConfirmations(keys, current, "Conferido em massa", key => key !== 23);
  assert.deepEqual(result.next, { 20: { confirmed: true, reason: "Conferido em massa" }, 21: { confirmed: true, reason: "" },
    22: { confirmed: true, reason: "Saldo da PO" } });
  assert.deepEqual([result.applied, result.left], [2, 1]);
});

test("the bulk confirmation without a reason marks every supplier not yet confirmed", () => {
  const current = { HEXING: true, OTHER: false };
  assert.deepEqual(pendingFlags(["HEXING", "OTHER", "THIRD"], current), ["OTHER", "THIRD"]);
  const result = bulkFlags(["HEXING", "OTHER", "THIRD"], current);
  assert.deepEqual(result.next, { HEXING: true, OTHER: true, THIRD: true });
  assert.deepEqual([result.applied, result.left], [2, 0]);
  // The NCM flag of a product out of the DATABASE uses the same function with the INV rows (2026-11-11).
  const rows = bulkFlags([28, 34], { 28: true });
  assert.deepEqual([rows.next, rows.applied], [{ 28: true, 34: true }, 1]);
});

test("the panel is at the top of the page, uses the lib functions and asks a reason where it is needed", async () => {
  // Stage 1 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md (2026-11-12): the panel is in the review shared with the
  // IP screen, and the groups are built by invoiceAuditBulkGroups in lib/.
  const component = await source("../components/InvoiceAuditReview.tsx");
  const groups = await source("../lib/invoice-bulk-decisions.ts");
  const panel = await source("../components/InvoiceBulkDecisions.tsx");
  const top = component.indexOf("<InvoiceBulkDecisions");
  assert.ok(top > 0 && top < component.indexOf("<InvoiceConference"), "the panel comes before the points");
  assert.match(component, /invoiceAuditBulkGroups\(model\.bulk, supplierMismatches, decisions\)/u);
  for (const name of ["bulkPriceChoices", "bulkSourceChoices", "bulkConfirmations", "bulkFlags"]) {
    assert.match(groups.slice(groups.indexOf("export function invoiceAuditBulkGroups")), new RegExp(String.raw`${name}\(`, "u"), name);
  }
  assert.match(panel, /disabled=\{group\.pending === 0 \|\| \(action\.needsReason && !reasonReady\)\}/u);
  assert.match(panel, /const reasonReady = reason\.trim\(\)\.length >= 3;/u);
  const styles = await source("../app/styles/features/operations.css");
  for (const name of ["invoice-bulk", "invoice-bulk-groups"]) {
    assert.match(styles, new RegExp(String.raw`\.${name}[\s,{.]`, "u"), name);
  }
});

test("the panel texts exist in the three languages", () => {
  const keys = value => Object.keys(value).sort();
  for (const other of [en, zhCN]) {
    assert.deepEqual(keys(other.invoiceAudit.bulk), keys(ptBR.invoiceAudit.bulk));
    assert.deepEqual(keys(other.invoiceAudit.bulk.groups), keys(ptBR.invoiceAudit.bulk.groups));
    assert.deepEqual(keys(other.invoiceAudit.bulk.actions), keys(ptBR.invoiceAudit.bulk.actions));
  }
  assert.equal(ptBR.invoiceAudit.bulk.actions.acceptPrice, "Aceitar o preço da invoice (todos)");
  assert.equal(ptBR.invoiceAudit.bulk.actions.correctPrice, "Corrigir para o preço da PO (todos)");
  assert.equal(ptBR.invoiceAudit.bulk.actions.flagCatalog, "Sinalizar a NCM não encontrada (todos)");
  assert.equal(ptBR.invoiceAudit.bulk.actions.confirmCatalog, "Manter a NCM da invoice (todos)");
});
