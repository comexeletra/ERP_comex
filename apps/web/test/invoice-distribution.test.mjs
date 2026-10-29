import assert from "node:assert/strict";
import test from "node:test";
import { classifyInvoiceDestination, distributeInvoiceParts, invoiceCodePoint, invoiceKeyItems, invoiceLineDecisions,
  invoicePartAuditPoints, invoicePoCodeSummary, invoiceQuantityDecisionReady, invoiceQuantityPoint,
} from "../lib/china-invoice-mapping.ts";

const item = (id, lineNumber, productCode, remainingQuantity, orderedQuantity = remainingQuantity) =>
  ({ id, lineNumber, productCode, remainingQuantity, orderedQuantity });

test("the destination key is the cited PO and the line code: only items with that code, in PO line order", () => {
  const items = [item("other", 1, "OTHER", "10"), item("late", 8, " product-a ", "10"), item("early", 2, "PRODUCT-A", "10")];
  assert.deepEqual(invoiceKeyItems(items, "Product-A").map(entry => entry.id), ["early", "late"]);
  assert.deepEqual(invoiceKeyItems(items, "MISSING"), []);
  assert.deepEqual(items.map(entry => entry.id), ["other", "late", "early"]);
});

test("a repeated code fills the PO items in line order up to the sum of their balances", () => {
  const items = [item("first", 1, "A", "30"), item("second", 2, "A", "50")];
  const result = distributeInvoiceParts([{ key: "16:0", quantity: "45.5", items }]);
  assert.deepEqual(result.get("16:0"), { allocations: [{ itemId: "first", quantity: "30" }, { itemId: "second", quantity: "15.5" }],
    available: "80", enough: true });
  assert.deepEqual(distributeInvoiceParts([{ key: "16:0", quantity: "80.00000001", items }]).get("16:0"),
    { allocations: [], available: "80", enough: false });
});

test("invoice lines with the same PO and code share the balance in invoice order", () => {
  const items = [item("first", 1, "A", "30"), item("second", 2, "A", "20")];
  const result = distributeInvoiceParts([
    { key: "16:0", quantity: "40", items },
    { key: "17:0", quantity: "20", items },
    { key: "18:0", quantity: "10", items },
  ]);
  assert.deepEqual(result.get("16:0").allocations, [{ itemId: "first", quantity: "30" }, { itemId: "second", quantity: "10" }]);
  assert.deepEqual(result.get("17:0"), { allocations: [], available: "10", enough: false });
  assert.deepEqual(result.get("18:0"), { allocations: [{ itemId: "second", quantity: "10" }], available: "10", enough: true });
});

test("a part destined with 0 takes no balance and an invalid quantity allocates nothing", () => {
  const items = [item("first", 1, "A", "5")];
  const result = distributeInvoiceParts([
    { key: "16:0", quantity: "0", items }, { key: "17:0", quantity: "abc", items }, { key: "18:0", quantity: "5", items },
  ]);
  assert.deepEqual(result.get("16:0"), { allocations: [], available: "5", enough: true });
  assert.deepEqual(result.get("17:0"), { allocations: [], available: "5", enough: false });
  assert.deepEqual(result.get("18:0").allocations, [{ itemId: "first", quantity: "5" }]);
});

test("classifies each part from the cited PO, its key items and the shared balance", () => {
  const items = [item("first", 1, "A", "3")];
  const distribution = distributeInvoiceParts([{ key: "k", quantity: "5", items }]).get("k");
  assert.deepEqual(classifyInvoiceDestination([], false, "5", undefined), { kind: "PO_NOT_REGISTERED" });
  assert.deepEqual(classifyInvoiceDestination([], true, "5", undefined, "CLOSED"), { kind: "PO_NOT_ACTIVE", status: "CLOSED" });
  assert.deepEqual(classifyInvoiceDestination([], true, "5", undefined), { kind: "ITEM_NOT_FOUND" });
  assert.deepEqual(classifyInvoiceDestination(items, true, "5", distribution), { kind: "INSUFFICIENT_BALANCE", requested: "5", available: "3" });
  assert.deepEqual(classifyInvoiceDestination(items, true, "-1", undefined), { kind: "INVALID_QUANTITY" });
  assert.equal(classifyInvoiceDestination(items, true, "3", distributeInvoiceParts([{ key: "k", quantity: "3", items }]).get("k")), null);
  // Destined with 0, the part allocates nothing: the PO and the code no longer block it.
  assert.equal(classifyInvoiceDestination([], false, "0", undefined), null);
  assert.equal(classifyInvoiceDestination([], true, "0", undefined), null);
});

test("a quantity different from the invoice is an audit point confirmed only with a reason", () => {
  const pending = { confirmed: false, reason: "" };
  assert.equal(invoiceQuantityPoint("100", "100.0", "PCS", pending), null);
  assert.deepEqual(invoiceQuantityPoint("100", "80", "PCS", pending),
    { kind: "QUANTITY", invoiceValue: "100 PCS", poValue: "80 PCS", confirmed: false });
  assert.equal(invoiceQuantityPoint("100", "80", "PCS", { confirmed: true, reason: " ok " }).confirmed, false);
  assert.equal(invoiceQuantityPoint("100", "80", "PCS", { confirmed: false, reason: "Saldo restante no próximo embarque" }).confirmed, false);
  assert.equal(invoiceQuantityPoint("100", "80", "PCS", { confirmed: true, reason: "Saldo no próximo embarque" }).confirmed, true);
  assert.equal(invoiceQuantityDecisionReady({ confirmed: true, reason: "abc" }), true);
  assert.equal(invoiceQuantityDecisionReady({ confirmed: true, reason: "  ab  " }), false);
});

test("a code missing from the cited PO stays in the audit until the part is destined with 0 and a reason", () => {
  const ready = { confirmed: true, reason: "Código corrigido na próxima invoice" };
  assert.equal(invoiceCodePoint("A-1", true, "10", ready), null);
  assert.deepEqual(invoiceCodePoint("A-1", false, "10", ready), { kind: "CODE", invoiceValue: "A-1", poValue: "", confirmed: false });
  assert.equal(invoiceCodePoint("A-1", false, "0", { confirmed: false, reason: "" }).confirmed, false);
  assert.equal(invoiceCodePoint("A-1", false, "0", ready).confirmed, true);
});

test("each PO item that receives the part is audited and a divergence is listed once", () => {
  const invoice = { productCode: "A", exporter: "Exporter Ltd", line: { unit: "PCS", unitPrice: "2" } };
  const base = { productCode: "A", unit: "PCS", unitPrice: "2", currency: "CNY", supplierValues: ["Exporter Ltd"] };
  const points = invoicePartAuditPoints(invoice, [base, { ...base, unitPrice: "3" }, { ...base, unitPrice: "4" }],
    { supplier: false, unit: false, price: false });
  assert.deepEqual(points, [{ kind: "PRICE", invoiceValue: "2 CNY", poValue: "3 CNY", confirmed: false }]);
  assert.deepEqual(invoicePartAuditPoints(invoice, [], { supplier: false, unit: false, price: false }), []);
});

test("line decisions carry the invoice and destined quantities and the reason only when they differ", () => {
  const lines = [{ sourceRow: 16, quantity: "150" }, { sourceRow: 17, quantity: "20" }, { sourceRow: 18, quantity: "5" }];
  const parts = [
    { sourceRow: 16, invoiceQuantity: "100", quantity: "80" }, { sourceRow: 16, invoiceQuantity: "50", quantity: "50" },
    { sourceRow: 17, invoiceQuantity: "20", quantity: "20" },
    { sourceRow: 18, invoiceQuantity: "5", quantity: "0" },
  ];
  assert.deepEqual(invoiceLineDecisions(lines, parts, {
    16: { confirmed: true, reason: " Saldo no próximo embarque " }, 17: { confirmed: true, reason: "ignored" },
  }), [
    { sourceRow: 16, invoiceQuantity: "150", destinedQuantity: "130", confirmQuantityMismatch: true,
      quantityMismatchReason: "Saldo no próximo embarque" },
    { sourceRow: 17, invoiceQuantity: "20", destinedQuantity: "20", confirmQuantityMismatch: false, quantityMismatchReason: "" },
    { sourceRow: 18, invoiceQuantity: "5", destinedQuantity: "0", confirmQuantityMismatch: false, quantityMismatchReason: "" },
  ]);
});

test("the summary by PO and code shows ordered, already shipped, this invoice and the balance after", () => {
  const items = [item("first", 1, "A", "30", "40"), item("second", 2, "A", "20", "20")];
  const summary = invoicePoCodeSummary([
    { poNumber: "PO030201", productCode: "a", quantity: "25", items },
    { poNumber: "030201", productCode: "A", quantity: "10.5", items },
    { poNumber: "PO030201", productCode: "MISSING", quantity: "5", items: [] },
    { poNumber: "PO030305", productCode: "B", quantity: "7", items: [item("b", 1, "B", "5")] },
  ]);
  assert.deepEqual(summary, [
    { poNumber: "PO030201", productCode: "a", ordered: "60", shipped: "10", thisInvoice: "35.5", balanceAfter: "14.5", overBalance: false },
    { poNumber: "PO030305", productCode: "B", ordered: "5", shipped: "0", thisInvoice: "7", balanceAfter: "-2", overBalance: true },
  ]);
});
