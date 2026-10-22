import assert from "node:assert/strict";
import test from "node:test";
import { deletedIpInvoiceBlockMessage, processLifecycleActions } from "../lib/ip-lifecycle.ts";

test("offers active open lifecycle actions to writers", () => {
  assert.deepEqual(processLifecycleActions("ACTIVE", "OPEN", true, false), ["close", "cancel", "delete"]);
  assert.deepEqual(processLifecycleActions("ACTIVE", "OPEN", false, true), []);
});

test("offers reopen only for an active closed IP and cancel/delete for an open draft", () => {
  assert.deepEqual(processLifecycleActions("ACTIVE", "CLOSED", true, false), ["reopen"]);
  assert.deepEqual(processLifecycleActions("DRAFT", "OPEN", true, false), ["cancel", "delete"]);
  assert.deepEqual(processLifecycleActions("DRAFT", "CLOSED", true, false), []);
});

test("reactivation and restoration require lifecycle management permission", () => {
  assert.deepEqual(processLifecycleActions("CANCELLED", "OPEN", true, false), ["delete"]);
  assert.deepEqual(processLifecycleActions("CANCELLED", "OPEN", true, true), ["reactivate", "delete"]);
  assert.deepEqual(processLifecycleActions("CANCELLED", "OPEN", false, true), ["reactivate"]);
  assert.deepEqual(processLifecycleActions("DELETED", "OPEN", true, false), []);
  assert.deepEqual(processLifecycleActions("DELETED", "OPEN", true, true), ["restore"]);
});

test("unknown states and non-writers expose no lifecycle actions", () => {
  assert.deepEqual(processLifecycleActions("ACTIVE", "OPEN", false, false), []);
  assert.deepEqual(processLifecycleActions("UNKNOWN", "OPEN", true, true), []);
});

test("deleted invoice references show a restore instruction", () => {
  assert.match(deletedIpInvoiceBlockMessage("DELETED"), /Peça a restauração para um Master ou Administrador/u);
  assert.equal(deletedIpInvoiceBlockMessage("ACTIVE"), null);
});
