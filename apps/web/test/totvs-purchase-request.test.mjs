import assert from "node:assert/strict";
import test from "node:test";
import { classifyTotvsPurchaseRequest } from "../lib/totvs-purchase-request.ts";

const choices = [
  { id: "sc-1", importer: "ELETRA MATRIZ", scNumber: " sc-100 ", supplierText: "SUP-1" },
  { id: "sc-2", importer: "ELETRA FILIAL", scNumber: "SC-100", supplierText: "SUP-1" },
];

test("classifies a blank SC number as none", () => {
  assert.deepEqual(classifyTotvsPurchaseRequest({ importer: "ELETRA MATRIZ", scNumber: "  ",
    supplierCode: "SUP-1", purchaseRequests: choices }), { kind: "none" });
});

test("matches the same importer, normalized SC number and supplier", () => {
  assert.deepEqual(classifyTotvsPurchaseRequest({ importer: "ELETRA MATRIZ", scNumber: "SC-100",
    supplierCode: " sup-1 ", purchaseRequests: choices }), { kind: "match", request: choices[0] });
});

test("classifies a same-number SC with another supplier as a conflict", () => {
  assert.deepEqual(classifyTotvsPurchaseRequest({ importer: "ELETRA MATRIZ", scNumber: "SC-100",
    supplierCode: "SUP-2", purchaseRequests: choices }), { kind: "supplier-mismatch", request: choices[0] });
});

test("classifies an unknown SC number as missing without crossing importers", () => {
  assert.deepEqual(classifyTotvsPurchaseRequest({ importer: "ELETRA MATRIZ", scNumber: " SC-200 ",
    supplierCode: "SUP-1", purchaseRequests: choices }), { kind: "missing", scNumber: "SC-200" });
  assert.deepEqual(classifyTotvsPurchaseRequest({ importer: "ELETRA MATRIZ", scNumber: "SC-100",
    supplierCode: "SUP-1", purchaseRequests: choices.slice(1) }), { kind: "missing", scNumber: "SC-100" });
});
