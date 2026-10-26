import assert from "node:assert/strict";
import test from "node:test";
import { calculateE2e, calculateFollowup, calculateProcess, checkShipmentDates, DEFAULT_E2E_TARGET_SET, e2eTargetSetFor,
  invoiceTotals } from "../dist/followup-calculations.js";

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
  const process = { transportMode: "SEA", etd: "2026-09-01", blDate: "2026-09-02", arrivalDate: "2026-10-01",
    duimpDate: "2026-10-02" };
  const docs = [
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-a", quantity: "40", unitPrice: "12.50", issueDate: "2026-09-01" },
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-b", quantity: "60", unitPrice: "13.00", issueDate: "2026-09-01" },
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

test("each allocation of a split item runs its own China departure stage", () => {
  const item = { id: "split-item", orderedQuantity: "100", unitPrice: "12.50", currencyCode: "USD",
    poSentDate: "2026-08-01", demandType: "MTS" };
  const firstIp = calculateFollowup({ ...item, allocationQuantity: "40", actualFactoryShipDate: "2026-08-10" },
    { actualPortDepartureDate: "2026-08-20" }, [], "2026-08-30");
  const secondIp = calculateFollowup({ ...item, allocationQuantity: "60", actualFactoryShipDate: "2026-08-15" },
    { actualPortDepartureDate: "2026-09-05" }, [], "2026-08-30");
  assert.deepEqual([firstIp.e2e.stages.T3.actualDays, firstIp.e2e.stages.T3.delayDays], [19, -11]);
  assert.deepEqual([secondIp.e2e.stages.T3.actualDays, secondIp.e2e.stages.T3.delayDays], [35, 5]);
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
    { kind: "NF", status: "ACTIVE", purchaseOrderItemId: "item-b", issueDate: "2026-10-03" },
  ], "2026-10-04");
  assert.equal(result.status, "AGUARDANDO EMBARQUE");
  assert.equal(result.billDate, null);
  assert.equal(result.nfIssueDate, null);
});

test("BL number and date come from the IP, so every item in the IP shares them", () => {
  const process = { transportMode: "SEA", etd: "2026-10-01", blNumber: "BL-IP-1", blDate: "2026-10-03" };
  const docs = [
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: null, quantity: null },
    // A legacy BL document is history only; it no longer drives the shipment dates.
    { kind: "BL", status: "ACTIVE", purchaseOrderItemId: null, number: "BL-OLD", issueDate: "2026-09-01" },
  ];
  const first = calculateFollowup({ id: "item-a", allocationQuantity: "60", poSentDate: "2026-08-01" }, process, docs, "2026-10-04");
  const second = calculateFollowup({ id: "item-b", allocationQuantity: "50" }, process, docs, "2026-10-04");
  for (const result of [first, second]) {
    assert.equal(result.billDate, "2026-10-03");
    assert.equal(result.billNumber, "BL-IP-1");
    assert.equal(result.status, "AGUARDANDO CHEGADA");
  }
  assert.equal(first.factoryLeadDays, 63);
  const withoutBl = calculateFollowup({ id: "item-a" }, { transportMode: "SEA", etd: "2026-10-01" }, docs, "2026-10-04");
  assert.equal(withoutBl.billDate, null);
  assert.equal(withoutBl.billNumber, null);
  assert.equal(withoutBl.status, "AGUARDANDO EMBARQUE");
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

test("an informed logistics status no longer freezes the status calculated from the dates", () => {
  const invoice = { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: null, number: "INV-1" };
  const result = calculateFollowup({ id: "item" }, { logisticsStatus: "WAITING SHIPMENT", transportMode: "SEA",
    etd: "2026-09-01", blDate: "2026-09-02", arrivalDate: "2026-10-01" }, [invoice], "2026-10-04");
  assert.equal(result.status, "DESEMBARAÇO");
  assert.equal(result.statusSource, "calculated");
  assert.equal(result.informedStatus, "WAITING SHIPMENT");

  const informedDelivered = calculateFollowup({ id: "item" }, { logisticsStatus: "DELIVERED", transportMode: "SEA",
    etd: "2026-08-01", blDate: "2026-08-02" }, [invoice], "2026-10-04");
  assert.equal(informedDelivered.status, "AGUARDANDO CHEGADA");
  assert.equal(informedDelivered.alert, "Conferir chegada da carga");
});

test("an informed cancellation still prevails over the dates", () => {
  const result = calculateFollowup({ id: "item" }, { logisticsStatus: "CANCELLED", blDate: "2026-09-02" }, [], "2026-10-04");
  assert.equal(result.status, "CANCELADO");
  assert.equal(result.statusSource, "informed");
  assert.equal(result.alert, "—");
});

test("product lines carry the invoice and NF numbers that apply to the item", () => {
  const result = calculateFollowup({ id: "item-a" }, { blDate: "2026-09-02" }, [
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-a", number: "INV-B" },
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: null, number: "INV-A" },
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-a", number: "INV-B" },
    { kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-b", number: "INV-OTHER" },
    { kind: "INVOICE", status: "CANCELLED", purchaseOrderItemId: null, number: "INV-OLD" },
    { kind: "NF", status: "ACTIVE", purchaseOrderItemId: null, number: "NF-2", issueDate: "2026-10-05" },
    { kind: "NF", status: "ACTIVE", purchaseOrderItemId: null, number: "NF-1", issueDate: "2026-10-03" },
  ], "2026-10-04");
  assert.deepEqual(result.invoiceNumbers, ["INV-A", "INV-B"]);
  assert.equal(result.nfNumber, "NF-1");
  assert.equal(result.nfIssueDate, "2026-10-03");
});

test("the IP summary shows its own status and calculated ETA/ETE beside the confirmed dates", () => {
  const docs = [{ kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: "item-a", number: "INV-1" }];
  const projected = calculateProcess({ transportMode: "SEA", etd: "2026-09-01", logisticsStatus: "WAITING SHIPMENT" }, docs);
  assert.deepEqual(projected, { status: "AGUARDANDO EMBARQUE", statusSource: "calculated",
    informedStatus: "WAITING SHIPMENT", eta: "2026-10-26", etaSource: "calculated", ete: "2026-11-05",
    eteSource: "calculated", transitDays: 55, storageDueDate: null });
  const confirmed = calculateProcess({ transportMode: "AIR", etd: "2026-09-01", etaConfirmed: "2026-09-03",
    eteConfirmed: "2026-09-06", blDate: "2026-09-01", arrivalDate: "2026-09-03" }, []);
  assert.equal(confirmed.status, "AGUARDANDO PRODUÇÃO");
  assert.equal(confirmed.etaSource, "confirmed");
  assert.equal(confirmed.eteSource, "confirmed");
  assert.equal(confirmed.storageDueDate, "2026-09-08");
  assert.equal(calculateProcess({}, []).eta, null);
  assert.equal(calculateProcess({}, []).etaSource, null);
});

test("blocks only impossible effective-date sequences touched by the edit", () => {
  const current = { actualPortDepartureDate: "2026-09-10", arrivalDate: null, etd: "2026-09-05" };
  assert.deepEqual(checkShipmentDates(current, { arrivalDate: "2026-09-09" }).errors,
    ["Chegada efetiva antes da saída do porto (Departure)"]);
  assert.deepEqual(checkShipmentDates({ arrivalDate: "2026-10-01" }, { deliveryDate: "2026-09-30" }).errors,
    ["Entrega efetiva antes da chegada efetiva"]);
  assert.deepEqual(checkShipmentDates({ etd: "2026-09-05" }, { etaConfirmed: "2026-09-04" }).errors,
    ["ETA confirmada antes do ETD"]);
  assert.deepEqual(checkShipmentDates(current, { arrivalDate: "2026-10-20" }), { errors: [], warnings: [] });
});

test("keeps historical inconsistencies as warnings so the IP can still be edited", () => {
  // Already stored: arrival before departure. Editing another field must not be blocked.
  const historical = { actualPortDepartureDate: "2026-09-10", arrivalDate: "2026-09-09", etd: "2026-09-12",
    clearanceDate: "2026-09-08", etaConfirmed: "2026-10-01", eteConfirmed: "2026-09-30" };
  const result = checkShipmentDates(historical, { duimpNumber: "26BR1" });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [
    "Chegada efetiva antes da saída do porto (Departure)",
    "Chegada efetiva antes do ETD",
    "Desembaraço antes da chegada efetiva",
    "ETE confirmada antes da ETA confirmada",
  ]);
  // Re-sending the same stored value is not a change.
  assert.deepEqual(checkShipmentDates(historical, { arrivalDate: "2026-09-09" }).errors, []);
  // Clearance before arrival is never blocked: it can happen with early customs registration.
  assert.deepEqual(checkShipmentDates({ arrivalDate: "2026-10-01" }, { clearanceDate: "2026-09-30" }).errors, []);
});

// End to End (planilha original): prazo = fim real da etapa anterior + meta; T0 = necessidade − 4 meses.
const resistor = { id: "line-b", necessityDate: "2026-12-01", commercialPlanReceivedDate: "2026-08-03",
  scApprovalDate: "2026-08-21", poSentDate: "2026-08-24", demandType: "MTS" };
const shippedBySea = { transportMode: "SEA", etd: "2026-09-28", blDate: "2026-09-29", actualPortDepartureDate: "2026-09-30" };
const invoice = [{ kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: null, number: "HX1" }];

test("E2E stages chain each deadline on the previous actual date and use forecasts for open stages", () => {
  const { e2e } = calculateFollowup(resistor, shippedBySea, invoice, "2026-10-26");
  const row = code => { const stage = e2e.stages[code];
    return [stage.deadline, stage.actual, stage.source, stage.targetDays, stage.actualDays, stage.delayDays]; };
  assert.deepEqual(row("T0"), ["2026-08-01", "2026-08-03", "actual", 8, 2, -6]);
  assert.deepEqual(row("T1"), ["2026-08-11", "2026-08-21", "actual", 8, 18, 10]);
  assert.deepEqual(row("T2"), ["2026-08-28", "2026-08-24", "actual", 7, 3, -4]);
  assert.deepEqual(row("T3"), ["2026-09-23", "2026-09-30", "actual", 30, 37, 7]);
  assert.deepEqual(row("T4"), ["2026-11-24", "2026-11-22", "forecast", 55, 53, -2]);
  assert.deepEqual(row("T5"), ["2026-12-02", "2026-12-02", "forecast", 10, 10, 0]);
  assert.deepEqual([e2e.totalTargetDays, e2e.totalActualDays, e2e.totalDelayDays, e2e.bottleneck], [118, 123, 5, "T1"]);
  assert.deepEqual([e2e.demandType, e2e.air, e2e.currentStatus, e2e.arrivalYearMonth, e2e.targetSetValidFrom],
    ["mts", false, "AGUARDANDO CHEGADA", "2026-11", DEFAULT_E2E_TARGET_SET.validFrom]);
});

test("E2E targets follow the demand type and the transport mode", () => {
  const notMtsByAir = calculateFollowup({ ...resistor, demandType: "Não MTS" },
    { transportMode: "COURIER", etd: "2026-10-12" }, [], "2026-10-26").e2e;
  assert.equal(notMtsByAir.stages.T3.targetDays, 45);
  assert.equal(notMtsByAir.stages.T3.deadline, "2026-10-08");
  assert.equal(notMtsByAir.stages.T4.targetDays, 10);
  assert.equal(notMtsByAir.air, true);
  // Without a demand type the item is planned as Não MTS; without a mode there is no transit target.
  const unknown = calculateFollowup({ ...resistor, demandType: null }, { etd: "2026-10-12" }, [], "2026-10-26").e2e;
  assert.equal(unknown.demandType, "unknown");
  assert.equal(unknown.stages.T3.targetDays, 45);
  assert.equal(unknown.stages.T4.targetDays, null);
  assert.equal(unknown.totalTargetDays, null);
});

test("E2E target sets apply from their necessity date", () => {
  const sets = [DEFAULT_E2E_TARGET_SET, { ...DEFAULT_E2E_TARGET_SET, validFrom: "2026-11-15", t3MtsDays: 25, t4SeaDays: 50 }];
  assert.equal(e2eTargetSetFor(sets, "2026-12-01", "2026-10-26").validFrom, "2026-11-15");
  assert.equal(e2eTargetSetFor(sets, "2026-11-14", "2026-10-26").validFrom, DEFAULT_E2E_TARGET_SET.validFrom);
  assert.equal(e2eTargetSetFor(sets, null, "2026-10-26").validFrom, DEFAULT_E2E_TARGET_SET.validFrom);
  assert.equal(e2eTargetSetFor(sets, null, "2026-11-20").validFrom, "2026-11-15");
  const { e2e } = calculateFollowup(resistor, shippedBySea, invoice, "2026-10-26", sets);
  assert.equal(e2e.targetSetValidFrom, "2026-11-15");
  assert.deepEqual([e2e.stages.T3.targetDays, e2e.stages.T3.deadline], [25, "2026-09-18"]);
  assert.equal(e2e.stages.T4.targetDays, 50);
});

test("E2E of a balance without IP plans the HQ shipment from the PO and leaves later stages empty", () => {
  const e2e = calculateE2e(resistor, {}, "A DISTRIBUIR", DEFAULT_E2E_TARGET_SET, null);
  assert.equal(e2e.stages.T3.deadline, "2026-09-23");
  assert.equal(e2e.stages.T3.actual, null);
  assert.equal(e2e.stages.T4.deadline, null);
  assert.equal(e2e.totalActualDays, null);
  assert.equal(e2e.bottleneck, "T1");
  // Without the commercial plan date the chain cannot start.
  const noPlan = calculateE2e({ ...resistor, commercialPlanReceivedDate: null }, {}, "A DISTRIBUIR", DEFAULT_E2E_TARGET_SET, null);
  assert.deepEqual([noPlan.stages.T0.actualDays, noPlan.stages.T1.deadline, noPlan.stages.T1.actualDays], [null, null, null]);
});
