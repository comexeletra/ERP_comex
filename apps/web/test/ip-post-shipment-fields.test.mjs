import assert from "node:assert/strict";
import test from "node:test";
import { calculatedStatusLabel, ipPostShipmentFields, newProcessDocumentKinds, productLineIpFields,
  projectedDateLabel, withDateWarnings } from "../lib/ip-post-shipment-fields.ts";
import { en } from "../lib/i18n/en.ts";
import { fieldLabel } from "../lib/i18n/labels.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

test("the IP form lists each post-shipment field once, including Departure and the BL fields", () => {
  const keys = ipPostShipmentFields.map(field => field.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ["etd", "actualPortDepartureDate", "blNumber", "blDate", "etaConfirmed", "arrivalDate",
    "eteConfirmed", "deliveryDate"]) assert.ok(keys.includes(key), key);
  assert.equal(ipPostShipmentFields.find(field => field.key === "blDate").type, "date");
});

test("every IP field has a label in each language", () => {
  for (const m of [ptBR, en, zhCN]) {
    for (const field of ipPostShipmentFields) assert.notEqual(fieldLabel(m, field), field.key, field.key);
  }
  const priority = ipPostShipmentFields.find(field => field.key === "priority");
  assert.equal(fieldLabel(ptBR, priority), "Prioridade do IP");
  assert.equal(fieldLabel(en, priority), "IP priority");
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
  assert.equal(calculatedStatusLabel({ status: "AGUARDANDO CHEGADA", statusSource: "calculated" }, ptBR),
    "AGUARDANDO CHEGADA · calculado pelas datas");
  assert.equal(calculatedStatusLabel({ status: "CANCELADO", statusSource: "informed" }, ptBR), "CANCELADO · informado no IP");
  assert.equal(projectedDateLabel("2026-10-26", "calculated", ptBR), "2026-10-26 · calculada");
  assert.equal(projectedDateLabel("2026-10-26", "confirmed", ptBR), "2026-10-26 · confirmada");
  assert.equal(projectedDateLabel(null, null, ptBR), "—");
  assert.equal(calculatedStatusLabel({ status: "AGUARDANDO CHEGADA", statusSource: "calculated" }, en),
    "AWAITING ARRIVAL · calculated from the dates");
  assert.equal(calculatedStatusLabel({ status: "STATUS NOVO", statusSource: "informed" }, zhCN), "STATUS NOVO · 在 IP 中填报");
});

test("date warnings returned by the API are shown with the success message", () => {
  assert.equal(withDateWarnings("Dados do IP atualizados.", { warnings: ["Chegada efetiva antes do ETD"] }, ptBR),
    "Dados do IP atualizados. Confira as datas: Chegada efetiva antes do ETD.");
  assert.equal(withDateWarnings("Dados do IP atualizados.", { warnings: [] }, ptBR), "Dados do IP atualizados.");
  assert.equal(withDateWarnings("Dados do IP atualizados.", { id: "x" }, ptBR), "Dados do IP atualizados.");
  assert.equal(withDateWarnings("IP data updated.", { warnings: ["W"] }, en), "IP data updated. Check the dates: W.");
});
