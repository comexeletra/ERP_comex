import assert from "node:assert/strict";
import test from "node:test";
import { purchaseOrderActorLabel } from "../lib/po-lifecycle.ts";

test("shows the user part of an audit actor and keeps unknown formats", () => {
  assert.equal(purchaseOrderActorLabel("urn:import-erp:local#user@example.com"), "user@example.com");
  assert.equal(purchaseOrderActorLabel("system"), "system");
  assert.equal(purchaseOrderActorLabel("issuer#"), "issuer#");
});
