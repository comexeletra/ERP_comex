import assert from "node:assert/strict";
import test from "node:test";
import { calculateFollowup, calculateProcess, checkShipmentDates } from "../dist/followup-calculations.js";
import { processFollowupFieldKeys } from "../dist/followup.js";
import { sharedFields, simulationIps as sourceIps } from "../../../deploy/hostinger/seed-hml-po-030201-demo.mjs";
import { demandType, ipForLine, ipNumberPattern, lineReference, purchaseOrderNumber, purchaseOrderPayload,
  simulationIps, sourceLines } from "../../../deploy/hostinger/seed-hml-po-nmts-demo.mjs";
import { analyzePurchaseOrderE2e } from "../../web/lib/e2e-analysis.ts";

const sourceRows = Array.from({ length: sourceLines.last - sourceLines.first + 1 }, (_, index) => ({
  line: String(sourceLines.first + index).padStart(4, "0"), productCode: `P-${index}`, description: `Produto ${index}`,
  quantity: `${1000 + index * 10}.00000000`, unit: "UN", unitPrice: "1.25000000", currency: "CNY",
  costCenter: index % 2 ? "CC-1" : null }));

test("PO SIM-NMTS-01 repeats lines 0154-0212 of 030201 as one Não MTS PO", () => {
  assert.equal(purchaseOrderNumber, "SIM-NMTS-01");
  assert.equal(demandType, "Não MTS");
  assert.equal(sourceRows.length, 59);
  assert.equal(lineReference("0154"), "0001");
  assert.equal(lineReference("0212"), "0059");

  const payload = purchaseOrderPayload({ importer: "ELETRA", supplierText: "EX000135" }, sourceRows);
  assert.equal(payload.header.demandType, "Não MTS");
  assert.equal(payload.header.number, "SIM-NMTS-01");
  assert.equal(payload.header.purchaseRequestId, null);
  assert.equal(payload.items.length, 59);
  assert.deepEqual(payload.items[0].base, { externalLineReference: "0001", productCode: "P-0", description: "Produto 0",
    orderedQuantity: "1000", unit: "UN", unitPrice: "1.25", currency: "CNY", reason: payload.header.reason });
  // The type is the PO's; the products only carry the shared pre-shipment fields and their own cost center.
  assert.ok(payload.items.every(item => !("demandType" in item.fields)));
  assert.deepEqual(payload.items[0].fields, sharedFields);
  assert.deepEqual(payload.items[1].fields, { ...sharedFields, costCenter: "CC-1" });
});

test("its two IPs take every line once and reuse the dates of 030201 D and E", () => {
  assert.deepEqual(simulationIps.map(ip => [ip.ip, ip.source]), [["A", "D"], ["B", "E"]]);
  for (const ip of simulationIps) {
    assert.match(`${purchaseOrderNumber}-${ip.ip}/2026`, ipNumberPattern);
    const source = sourceIps.find(entry => entry.ip === ip.source);
    assert.deepEqual([ip.fields, ip.expected, ip.factoryShipDate, ip.invoiceDate],
      [source.fields, source.expected, source.factoryShipDate, source.invoiceDate]);
  }
  const lines = sourceRows.map(row => lineReference(row.line));
  assert.deepEqual(Object.fromEntries(simulationIps.map(ip => [ip.ip, lines.filter(line => ipForLine(line) === ip.ip).length])),
    { A: 24, B: 35 });
  assert.equal(ipForLine("0060"), null);

  const allowed = new Set(processFollowupFieldKeys);
  for (const ip of simulationIps) {
    assert.deepEqual(Object.keys(ip.fields).filter(key => !allowed.has(key)), [], ip.ip);
    assert.deepEqual(checkShipmentDates({}, ip.fields).errors, [], ip.ip);
    const calculated = calculateProcess(ip.fields, ip.invoiceDate ? [{ status: "ACTIVE", kind: "INVOICE" }] : []);
    assert.deepEqual([calculated.status, calculated.eta], [ip.expected.status, ip.expected.eta], ip.ip);
  }
});

test("the End to End of SIM-NMTS-01 plans 45 days in the HQ for every line", () => {
  const items = sourceRows.map(row => ({ id: `item-${row.line}`, line: lineReference(row.line), quantity: String(Number(row.quantity)) }));
  const invoice = [{ kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: null, number: "HX" }];
  const ipOf = line => simulationIps.find(ip => ip.ip === ipForLine(line));
  const input = {
    items: items.map(item => ({ id: item.id, orderedQuantity: item.quantity, necessityDate: sharedFields.necessityDate })),
    processes: simulationIps.map(ip => ({ process: { id: ip.ip, ipNumber: ip.ip }, calculated: { status: ip.expected.status } })),
    shipments: items.map(item => {
      const ip = ipOf(item.line);
      const row = { id: item.id, ...sharedFields, demandType, allocationQuantity: item.quantity,
        actualFactoryShipDate: ip.factoryShipDate };
      return { itemId: item.id, allocationQuantity: item.quantity, process: { id: ip.ip },
        calculated: calculateFollowup(row, ip.fields, ip.invoiceDate ? invoice : [], "2026-10-26") };
    }),
  };
  assert.deepEqual([...new Set(input.shipments.map(shipment => shipment.calculated.e2e.stages.T3.targetDays))], [45]);
  const analysis = analyzePurchaseOrderE2e(input, "2026-10-26");
  assert.deepEqual(analysis.ips.map(ip => [ip.ipNumber, ip.demandType, ip.slack]), [["A", "notMts", 30], ["B", "notMts", -36]]);
});
