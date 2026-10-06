import assert from "node:assert/strict";
import test from "node:test";
import { calculateFollowup, invoiceTotals } from "../dist/followup-calculations.js";

test("calculates price exactly and keeps unknown dates empty", () => {
  const result = calculateFollowup({ id: "item", orderedQuantity: "3.00000000", unitPrice: "0.10000000",
    currencyCode: "USD", allocationQuantity: "1.00000000" }, { transportMode: "SEA" }, [], "2026-10-04");
  assert.equal(result.totalPrice, "0.30000000");
  assert.equal(result.eta, null);
  assert.equal(result.ete, null);
  assert.equal(result.storageDueDate, null);
  assert.equal(result.ruptureRisk, null);
  assert.equal(result.status, "AGUARDANDO PRODUÇÃO");
  assert.equal(result.totalDelayDays, null);
});

test("derives shipment dates, customs alert and invoice comparison per allocated item", () => {
  const item = { id: "item-a", orderedQuantity: "100", unitPrice: "12.50", currencyCode: "USD",
    allocationQuantity: "40", necessityDate: "2026-11-01", scApprovalDate: "2026-08-01",
    poApprovalDate: "2026-08-05", poSentDate: "2026-08-06", targetOrderDays: 3 };
  const process = { transportMode: "SEA", etd: "2026-09-01", arrivalDate: "2026-10-01",
    duimpDate: "2026-10-02" };
  const docs = [
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-a", quantity: "40", unitPrice: "12.50", issueDate: "2026-09-01" },
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-b", quantity: "60", unitPrice: "13.00", issueDate: "2026-09-01" },
    { kind: "BL", status: "ACTIVE", purchaseOrderItemId: null, issueDate: "2026-09-02" },
  ];
  const result = calculateFollowup(item, process, docs, "2026-10-04");
  assert.equal(result.eta, "2026-10-26");
  assert.equal(result.ete, "2026-11-05");
  assert.equal(result.storageDueDate, "2026-10-10");
  assert.equal(result.alert, "Conferir desembaraço");
  assert.equal(result.ruptureRisk, "RUPTURA");
  assert.equal(result.invoiceQuantity, "40.00000000");
  assert.equal(result.quantityMatchesInvoice, true);
  assert.equal(result.priceMatchesInvoice, true);
  assert.equal(result.stages.order.actualDays, 4);
  assert.equal(result.stages.order.delayDays, 1);
});

test("one PO item split across IPs keeps each allocation quantity and delivery dates independent", () => {
  const item = { id: "split-item", orderedQuantity: "100", unitPrice: "12.50", currencyCode: "USD" };
  const firstIp = calculateFollowup({ ...item, allocationQuantity: "40" },
    { transportMode: "SEA", etd: "2026-09-01", arrivalDate: "2026-10-20", deliveryDate: "2026-10-27" },
    [{ kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "split-item", quantity: "40", unitPrice: "12.50" }], "2026-11-01");
  const secondIp = calculateFollowup({ ...item, allocationQuantity: "60" },
    { transportMode: "SEA", etd: "2026-09-15", arrivalDate: "2026-11-10", deliveryDate: "2026-11-18" },
    [{ kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "split-item", quantity: "60", unitPrice: "12.50" }], "2026-11-01");
  assert.equal(firstIp.quantityMatchesInvoice, true);
  assert.equal(secondIp.quantityMatchesInvoice, true);
  assert.equal(firstIp.eta, "2026-10-26");
  assert.equal(secondIp.eta, "2026-11-09");
  assert.equal(firstIp.clearanceDays, 7);
  assert.equal(secondIp.clearanceDays, 8);
});

test("factory departure dates and port targets stay independent for each PO allocation", () => {
  const item = { id: "split-item", orderedQuantity: "100", unitPrice: "12.50", currencyCode: "USD",
    targetPortDays: 7 };
  const firstIp = calculateFollowup({ ...item, allocationQuantity: "40", actualFactoryShipDate: "2026-08-10" },
    { actualPortDepartureDate: "2026-08-20" }, [], "2026-08-30");
  const secondIp = calculateFollowup({ ...item, allocationQuantity: "60", actualFactoryShipDate: "2026-08-15" },
    { actualPortDepartureDate: "2026-08-22" }, [], "2026-08-30");
  assert.equal(firstIp.portTargetDate, "2026-08-17");
  assert.equal(secondIp.portTargetDate, "2026-08-22");
  assert.equal(firstIp.stages.port.actualDays, 10);
  assert.equal(secondIp.stages.port.actualDays, 7);
});

test("confirmed dates take precedence and delivered shipment has no alert", () => {
  const result = calculateFollowup({ id: "item", necessityDate: "2026-12-31" },
    { transportMode: "AIR", etd: "2026-09-01", etaConfirmed: "2026-09-03",
      eteConfirmed: "2026-09-05", arrivalDate: "2026-09-03", deliveryDate: "2026-09-05" },
    [], "2026-10-04");
  assert.equal(result.eta, "2026-09-03");
  assert.equal(result.ete, "2026-09-05");
  assert.equal(result.storageDueDate, "2026-09-08");
  assert.equal(result.status, "ENTREGUE");
  assert.equal(result.alert, "—");
  assert.equal(result.ruptureRisk, null);
});

test("documents assigned to another PO item do not advance this item", () => {
  const result = calculateFollowup({ id: "item-a", allocationQuantity: "10" }, { etd: "2026-10-10" }, [
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-a", quantity: "10" },
    { kind: "BL", status: "ACTIVE", purchaseOrderItemId: "item-b", issueDate: "2026-10-02" },
    { kind: "NF", status: "ACTIVE", purchaseOrderItemId: "item-b", issueDate: "2026-10-03" },
  ], "2026-10-04");
  assert.equal(result.status, "AGUARDANDO EMBARQUE");
  assert.equal(result.billDate, null);
  assert.equal(result.nfIssueDate, null);
});

test("invoice totals remain separated by currency and report incomplete lines", () => {
  const result = invoiceTotals([
    { kind: "INVOICE", status: "ACTIVE", currencyCode: "USD", quantity: "3", unitPrice: "0.10" },
    { kind: "INVOICE", status: "ACTIVE", currencyCode: "USD", amount: "5.20" },
    { kind: "INVOICE", status: "ACTIVE", currencyCode: "EUR", amount: "8.00" },
    { kind: "INVOICE", status: "ACTIVE", currencyCode: "USD" },
    { kind: "INVOICE", status: "CANCELLED", currencyCode: "USD", amount: "100" },
  ]);
  assert.deepEqual(result.amounts, [
    { currency: "EUR", amount: "8.00000000" }, { currency: "USD", amount: "5.50000000" },
  ]);
  assert.equal(result.incompleteLines, 1);
});

test("does not assume a transit or storage rule without a transport mode", () => {
  const result = calculateFollowup({ id: "item" }, { etd: "2026-09-01", arrivalDate: "2026-10-01" }, [], "2026-10-04");
  assert.equal(result.eta, null);
  assert.equal(result.storageDueDate, null);
});
