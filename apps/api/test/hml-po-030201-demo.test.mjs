import assert from "node:assert/strict";
import test from "node:test";
import { calculateProcess, checkShipmentDates } from "../dist/followup-calculations.js";
import { processFollowupFieldKeys } from "../dist/followup.js";
import { demoIps, ipIndexForLine } from "../../../deploy/hostinger/seed-hml-po-030201-demo.mjs";

test("PO 030201 demo plan sends each of the 215 lines to exactly one of 7 IPs", () => {
  assert.equal(demoIps.length, 7);
  assert.equal(new Set(demoIps.map(ip => ip.suffix)).size, 7);
  const counts = demoIps.map(() => 0);
  for (let line = 1; line <= 215; line += 1) {
    const index = ipIndexForLine(String(line).padStart(4, "0"));
    assert.ok(index >= 0, `line ${line} has no IP`);
    counts[index] += 1;
  }
  assert.deepEqual(counts, [31, 31, 31, 31, 31, 31, 29]);
  assert.equal(ipIndexForLine("0000"), -1);
  assert.equal(ipIndexForLine("0216"), -1);
});

test("PO 030201 demo IPs pass the API date rules and land on the planned statuses", () => {
  const allowed = new Set(processFollowupFieldKeys);
  for (const ip of demoIps) {
    assert.deepEqual(Object.keys(ip.fields).filter(key => !allowed.has(key)), [], ip.suffix);
    assert.deepEqual(checkShipmentDates({}, ip.fields).errors, [], ip.suffix);
    assert.ok(ip.factoryShipDate <= ip.fields.etd, `${ip.suffix} ships before production ends`);
    const documents = ip.invoiceDate ? [{ status: "ACTIVE", kind: "INVOICE" }] : [];
    const calculated = calculateProcess(ip.fields, documents);
    assert.equal(calculated.status, ip.expected.status, ip.suffix);
    assert.equal(calculated.eta, ip.expected.eta, ip.suffix);
  }
  assert.deepEqual([...new Set(demoIps.map(ip => ip.expected.status))], [
    "ENTREGUE", "DESEMBARAÇO", "AGUARDANDO CHEGADA", "AGUARDANDO EMBARQUE", "AGUARDANDO PRODUÇÃO",
  ]);
});
