import assert from "node:assert/strict";
import test from "node:test";
import { purchaseOrderActorLabel, replacePreviewHasChanges } from "../lib/po-lifecycle.ts";

test("shows the user part of an audit actor and keeps unknown formats", () => {
  assert.equal(purchaseOrderActorLabel("urn:import-erp:local#user@example.com"), "user@example.com");
  assert.equal(purchaseOrderActorLabel("system"), "system");
  assert.equal(purchaseOrderActorLabel("issuer#"), "issuer#");
});

test("a replace preview without any line change is reported as equal to a plain restore", () => {
  const empty = { updated: [], added: [], removed: [], reactivated: [], productChanged: [] };
  assert.equal(replacePreviewHasChanges(empty), false);
  assert.equal(replacePreviewHasChanges({ ...empty, removed: [{ externalLineReference: "0002" }] }), true);
  assert.equal(replacePreviewHasChanges({ ...empty, productChanged: [{ externalLineReference: "0004" }] }), true);
});
