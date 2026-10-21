import assert from "node:assert/strict";
import test from "node:test";
import { hasIpLifecycleSupport, hasPoLifecycleSupport, isMissingApiRoute } from "../lib/api.ts";
import { purchaseOrderLifecycleActions } from "../lib/po-lifecycle.ts";

test("recognizes the API's custom not-found response for the legacy PO fallback", () => {
  assert.equal(isMissingApiRoute(404, { error: "Recurso não encontrado." }), true);
});

test("recognizes Fastify's default route-not-found response", () => {
  assert.equal(isMissingApiRoute(404, { message: "Route POST:/api/v1/purchase-orders/complete not found" }), true);
});

test("does not treat missing PO resources or unrelated errors as a missing route", () => {
  assert.equal(isMissingApiRoute(404, { detail: "PO não encontrada", code: "RESOURCE_NOT_FOUND" }), false);
  assert.equal(isMissingApiRoute(404, { error: "Recurso não encontrado.", detail: "fora do formato esperado" }), false);
  assert.equal(isMissingApiRoute(409, { error: "Recurso não encontrado." }), false);
});

test("uses the legacy IP summary unless the API confirms lifecycle support", () => {
  assert.equal(hasIpLifecycleSupport({ id: "ip-1" }), false);
  assert.equal(hasIpLifecycleSupport({ lifecycleStatus: "OPEN" }), true);
  assert.equal(hasIpLifecycleSupport({ lifecycleStatus: "CLOSED" }), true);
  assert.equal(hasIpLifecycleSupport({ lifecycleStatus: "UNKNOWN" }), false);
});

test("recognizes PO lifecycle support only when the API returns a supported status", () => {
  for (const lifecycleStatus of ["ACTIVE", "CLOSED", "CANCELLED", "DELETED"]) {
    assert.equal(hasPoLifecycleSupport({ lifecycleStatus }), true);
  }
  for (const value of [undefined, null, [], {}, { lifecycleStatus: "UNKNOWN" }]) {
    assert.equal(hasPoLifecycleSupport(value), false);
  }
});

test("shows lifecycle actions only for supported PO states and writers", () => {
  assert.deepEqual(purchaseOrderLifecycleActions("ACTIVE", true), ["close", "cancel", "delete"]);
  assert.deepEqual(purchaseOrderLifecycleActions("CLOSED", true), ["reopen", "delete"]);
  assert.deepEqual(purchaseOrderLifecycleActions("CANCELLED", true), ["delete"]);
  assert.deepEqual(purchaseOrderLifecycleActions("CANCELLED", true, true), ["reactivate", "delete"]);
  assert.deepEqual(purchaseOrderLifecycleActions("DELETED", true), []);
  assert.deepEqual(purchaseOrderLifecycleActions("DELETED", true, true), ["restore"]);
  assert.deepEqual(purchaseOrderLifecycleActions(undefined, true), []);
  assert.deepEqual(purchaseOrderLifecycleActions("ACTIVE", false), []);
  assert.deepEqual(purchaseOrderLifecycleActions("CANCELLED", false, true), []);
});
