import assert from "node:assert/strict";
import test from "node:test";
import { ipPostShipmentFields, newProcessDocumentKinds, productLineIpFields } from "../lib/ip-post-shipment-fields.ts";

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
