import assert from "node:assert/strict";
import test from "node:test";
import { classifyTotvsPurchaseRequest, totvsPurchaseRequestPayload } from "../lib/totvs-purchase-request.ts";

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

const blankRequest = { requester: " ", scDate: "", approvalDate: "", commercialPlanReceivedDate: "" };
const filledRequest = { requester: " Solicitante HML ", scDate: "2026-10-01", approvalDate: "",
  commercialPlanReceivedDate: "" };

test("a missing SC is created with the requester, used by new, restored and replaced POs alike", () => {
  assert.deepEqual(totvsPurchaseRequestPayload({ classification: { kind: "missing", scNumber: "020028" },
    selectedPurchaseRequestId: "", newRequest: filledRequest }), {
    choice: { newPurchaseRequest: { scNumber: "020028", requester: "Solicitante HML", scDate: "2026-10-01",
      approvalDate: null, commercialPlanReceivedDate: null } }, blocker: null });
});

test("a missing SC without requester blocks saving and restoring", () => {
  const result = totvsPurchaseRequestPayload({ classification: { kind: "missing", scNumber: "020028" },
    selectedPurchaseRequestId: "", newRequest: blankRequest });
  assert.equal(result.choice, null);
  assert.match(result.blocker, /solicitante/u);
  assert.match(result.blocker, /020028/u);
});

test("a selected SC is linked by id, including the automatic link of a matching SC", () => {
  assert.deepEqual(totvsPurchaseRequestPayload({ classification: { kind: "match", request: choices[0] },
    selectedPurchaseRequestId: "sc-1", newRequest: blankRequest }), { choice: { purchaseRequestId: "sc-1" }, blocker: null });
  assert.deepEqual(totvsPurchaseRequestPayload({ classification: { kind: "missing", scNumber: "SC-200" },
    selectedPurchaseRequestId: "sc-1", newRequest: blankRequest }), { choice: { purchaseRequestId: "sc-1" }, blocker: null });
});

test("an SC with another supplier blocks even with another SC selected", () => {
  const result = totvsPurchaseRequestPayload({ classification: { kind: "supplier-mismatch", request: choices[0] },
    selectedPurchaseRequestId: "sc-2", newRequest: filledRequest });
  assert.equal(result.choice, null);
  assert.match(result.blocker, /sc-100.*SUP-1/u);
});

test("without SC in the spreadsheet only a manually selected SC is sent", () => {
  assert.deepEqual(totvsPurchaseRequestPayload({ classification: { kind: "none" }, selectedPurchaseRequestId: "",
    newRequest: filledRequest }), { choice: null, blocker: null });
  assert.deepEqual(totvsPurchaseRequestPayload({ classification: { kind: "none" }, selectedPurchaseRequestId: "sc-2",
    newRequest: blankRequest }), { choice: { purchaseRequestId: "sc-2" }, blocker: null });
  assert.deepEqual(totvsPurchaseRequestPayload({ classification: { kind: "match", request: choices[0] },
    selectedPurchaseRequestId: "", newRequest: blankRequest }), { choice: null, blocker: null });
});
