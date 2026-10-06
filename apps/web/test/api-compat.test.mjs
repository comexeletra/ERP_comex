import assert from "node:assert/strict";
import test from "node:test";
import { hasIpLifecycleSupport, isMissingApiRoute } from "../lib/api.ts";

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
