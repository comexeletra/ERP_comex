import assert from "node:assert/strict";
import test from "node:test";
import { purchaseRequestOperationalFields } from "../lib/purchase-request-fields.ts";

test("maps the selected SC to its real shared PO operation fields", () => {
  assert.deepEqual(purchaseRequestOperationalFields({
    scNumber: "SC-23456",
    scDate: "2026-10-06",
    requester: "Matheus - Teste",
    approvalDate: "2026-10-08",
    commercialPlanReceivedDate: "2026-10-07",
  }), {
    scNumber: "SC-23456",
    scDate: "2026-10-06",
    requester: "Matheus - Teste",
    scApprovalDate: "2026-10-08",
    commercialPlanReceivedDate: "2026-10-07",
  });
});

test("clears SC-linked operation fields when the SC selection is removed", () => {
  assert.deepEqual(purchaseRequestOperationalFields(), {
    scNumber: "", scDate: "", requester: "", scApprovalDate: "", commercialPlanReceivedDate: "",
  });
});
