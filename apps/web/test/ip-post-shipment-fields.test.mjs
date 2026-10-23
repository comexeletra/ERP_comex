import assert from "node:assert/strict";
import test from "node:test";
import { calculatedStatusLabel, ipPostShipmentFields, newProcessDocumentKinds, productLineIpFields,
  projectedDateLabel, withDateWarnings } from "../lib/ip-post-shipment-fields.ts";

test("the IP form lists each post-shipment field once, including Departure and the BL fields", () => {
  const keys = ipPostShipmentFields.map(field => field.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ["etd", "actualPortDepartureDate", "blNumber", "blDate", "etaConfirmed", "arrivalDate",
    "eteConfirmed", "deliveryDate"]) assert.ok(keys.includes(key), key);
  assert.equal(ipPostShipmentFields.find(field => field.key === "blDate").type, "date");
});

test("product lines repeat shipment dates but never the IP costs", () => {
  const keys = productLineIpFields.map(field => field.key);
  for (const key of ["etd", "actualPortDepartureDate", "blNumber", "blDate", "arrivalDate"]) assert.ok(keys.includes(key), key);
  for (const key of ["freightCost", "freightCurrency", "taxesPaidBrl", "fineBrl", "storageBrl", "demurrageBrl",
    "containerQuantity", "demurrageContainerQuantity"]) assert.ok(!keys.includes(key), key);
});

test("new IP documents no longer offer BL", () => {
  assert.deepEqual(newProcessDocumentKinds, ["INVOICE", "NF"]);
});

test("the IP summary tells whether status and dates were calculated or informed", () => {
  assert.equal(calculatedStatusLabel({ status: "AGUARDANDO CHEGADA", statusSource: "calculated" }),
    "AGUARDANDO CHEGADA · calculado pelas datas");
  assert.equal(calculatedStatusLabel({ status: "CANCELADO", statusSource: "informed" }), "CANCELADO · informado no IP");
  assert.equal(projectedDateLabel("2026-10-26", "calculated"), "2026-10-26 · calculada");
  assert.equal(projectedDateLabel("2026-10-26", "confirmed"), "2026-10-26 · confirmada");
  assert.equal(projectedDateLabel(null, null), "—");
});

test("date warnings returned by the API are shown with the success message", () => {
  assert.equal(withDateWarnings("Dados do IP atualizados.", { warnings: ["Chegada efetiva antes do ETD"] }),
    "Dados do IP atualizados. Confira as datas: Chegada efetiva antes do ETD.");
  assert.equal(withDateWarnings("Dados do IP atualizados.", { warnings: [] }), "Dados do IP atualizados.");
  assert.equal(withDateWarnings("Dados do IP atualizados.", { id: "x" }), "Dados do IP atualizados.");
});
