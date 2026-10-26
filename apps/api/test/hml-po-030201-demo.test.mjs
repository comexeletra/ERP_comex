import assert from "node:assert/strict";
import test from "node:test";
import { calculateFollowup, calculateProcess, checkShipmentDates } from "../dist/followup-calculations.js";
import { processFollowupFieldKeys } from "../dist/followup.js";
import { allocationPlan, demandTypeForLine, ipForLine, ipNumberPattern, sharedFields, simulationIps }
  from "../../../deploy/hostinger/seed-hml-po-030201-demo.mjs";
import { analyzePurchaseOrderE2e } from "../../web/lib/e2e-analysis.ts";

const lines = Array.from({ length: 215 }, (_, index) => String(index + 1).padStart(4, "0"));
// Two lines of each of B and C have the same large quantity, so the tie-break by line matters.
const items = lines.map((line, index) => ({ id: `item-${line}`, line, quantity: String(1000 + (index % 50) * 10) }));

test("PO 030201 simulation sends every line to one IP by product family", () => {
  assert.deepEqual(simulationIps.map(ip => ip.ip), ["A", "B", "C", "D", "E", "F", "G"]);
  for (const ip of simulationIps) assert.match(`030201-${ip.ip}/2026`, ipNumberPattern);
  const counts = Object.fromEntries(simulationIps.map(ip => [ip.ip, lines.filter(line => ipForLine(line) === ip.ip).length]));
  assert.deepEqual(counts, { A: 22, B: 58, C: 53, D: 24, E: 35, F: 23, G: 0 });
  assert.equal(ipForLine("0216"), null);
  // MTS (30 days in the HQ) for stock components, Não MTS (45 days) for made-to-order parts.
  assert.equal(demandTypeForLine("0001"), "MTS");
  assert.equal(demandTypeForLine("0160"), "Não MTS");
  assert.equal(demandTypeForLine("0200"), "Não MTS");
  assert.equal(sharedFields.necessityDate, "2026-12-01");
  assert.equal(sharedFields.poSentDate, "2026-08-24");
});

test("IP G takes 30% of the five largest lines of B and C and every quantity is kept", () => {
  const plan = allocationPlan(items);
  const g = plan.filter(entry => entry.ip === "G");
  assert.equal(g.length, 10);
  assert.deepEqual([...new Set(g.map(entry => ipForLine(entry.line)))].sort(), ["B", "C"]);
  for (const item of items) {
    const total = plan.filter(entry => entry.itemId === item.id).reduce((sum, entry) => sum + BigInt(entry.quantity), 0n);
    assert.equal(total, BigInt(item.quantity), item.line);
  }
  const first = g[0];
  const whole = items.find(item => item.id === first.itemId);
  assert.equal(BigInt(first.quantity), BigInt(whole.quantity) * 30n / 100n);
  assert.equal(plan.length, 225);
});

test("each IP passes the API date rules and lands on its planned status and ETA", () => {
  const allowed = new Set(processFollowupFieldKeys);
  for (const ip of simulationIps) {
    assert.deepEqual(Object.keys(ip.fields).filter(key => !allowed.has(key)), [], ip.ip);
    assert.deepEqual(checkShipmentDates({}, ip.fields).errors, [], ip.ip);
    assert.ok(ip.factoryShipDate <= ip.fields.etd, `${ip.ip} ships before production ends`);
    const calculated = calculateProcess(ip.fields, ip.invoiceDate ? [{ status: "ACTIVE", kind: "INVOICE" }] : []);
    assert.equal(calculated.status, ip.expected.status, ip.ip);
    assert.equal(calculated.eta, ip.expected.eta, ip.ip);
  }
});

test("the End to End of the simulation shows the expected slack per IP", () => {
  const plan = allocationPlan(items);
  const invoice = [{ kind: "INVOICE", status: "ACTIVE", purchaseOrderItemId: null, number: "HX" }];
  const ipOf = letter => simulationIps.find(ip => ip.ip === letter);
  const input = {
    items: items.map(item => ({ id: item.id, orderedQuantity: item.quantity, necessityDate: sharedFields.necessityDate })),
    processes: simulationIps.map(ip => ({ process: { id: ip.ip, ipNumber: ip.ip }, calculated: { status: ip.expected.status } })),
    shipments: plan.map(entry => {
      const ip = ipOf(entry.ip);
      const item = { id: entry.itemId, ...sharedFields, demandType: demandTypeForLine(entry.line) ?? "MTS",
        allocationQuantity: entry.quantity, actualFactoryShipDate: ip.factoryShipDate };
      return { itemId: entry.itemId, allocationQuantity: entry.quantity, process: { id: entry.ip },
        calculated: calculateFollowup(item, ip.fields, ip.invoiceDate ? invoice : [], "2026-10-26") };
    }),
  };
  const analysis = analyzePurchaseOrderE2e(input, "2026-10-26");
  assert.deepEqual(Object.fromEntries(analysis.ips.map(ip => [ip.ipNumber, ip.slack])),
    { A: 48, B: -1, C: -11, D: 30, E: -36, F: 5, G: -52 });
  assert.equal(analysis.summary.onTimeLines, 69);
  assert.equal(analysis.summary.lateLines, 156);
  assert.equal(analysis.summary.worstIp, "G");
  // The resistor line of B: T1 +10 (SC approved 21/08), T2 −4 (PO sent 24/08), T3 +7 (left China 30/09).
  const resistor = input.shipments.find(shipment => shipment.process.id === "B").calculated.e2e;
  assert.deepEqual(["T1", "T2", "T3"].map(code => resistor.stages[code].delayDays), [10, -4, 7]);
});
