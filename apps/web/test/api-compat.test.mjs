import assert from "node:assert/strict";
import test from "node:test";
import { hasIpLifecycleSupport, hasPoLifecycleSupport, isMissingApiRoute } from "../lib/api.ts";
import { deletedPurchaseOrderActions, purchaseOrderLifecycleActions, purchaseOrderNumberBlockMessage } from "../lib/po-lifecycle.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

test("recognizes the API's custom not-found response for the legacy PO fallback", () => {
  assert.equal(isMissingApiRoute(404, { error: "Recurso não encontrado." }), true);
});

test("recognizes Fastify's default route-not-found response", () => {
  assert.equal(isMissingApiRoute(404, { message: "Route POST:/api/v1/purchase-orders/complete not found" }), true);
});

test("matches the requested API route when probing an optional route", () => {
  assert.equal(isMissingApiRoute(404,
    { message: "Route POST:/api/v1/purchase-orders/preflight not found" }, "/api/v1/purchase-orders/preflight"), true);
  assert.equal(isMissingApiRoute(404,
    { message: "Route POST:/api/v1/purchase-orders/complete not found" }, "/api/v1/purchase-orders/preflight"), false);
});

test("recognizes a missing new IP lifecycle route without treating a missing IP as an old API", () => {
  assert.equal(isMissingApiRoute(404,
    { message: "Route DELETE:/api/v1/processes/00000000-0000-4000-8000-000000000001 not found" },
    "/api/v1/processes/00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isMissingApiRoute(404,
    { detail: "O IP nÃ£o existe ou estÃ¡ fora do escopo autorizado.", code: "RESOURCE_NOT_FOUND" },
    "/api/v1/processes/00000000-0000-4000-8000-000000000001"), false);
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

test("blocks a new PO when the number is active or deleted in the same importer", () => {
  assert.equal(purchaseOrderNumberBlockMessage({ sameImporterDuplicate: true, sameImporterDeleted: false }, "030201", ptBR),
    "Já existe uma PO 030201 nesta importadora.");
  assert.match(purchaseOrderNumberBlockMessage({ sameImporterDuplicate: false, sameImporterDeleted: true }, "030201", ptBR),
    /PO 030201 desta importadora foi excluída.*Restaure-a/u);
  assert.equal(purchaseOrderNumberBlockMessage({ sameImporterDuplicate: false }, "030201", ptBR), null);
  assert.equal(purchaseOrderNumberBlockMessage({ sameImporterDuplicate: true }, "030201", en),
    "PO 030201 already exists for this importer.");
});

test("offers restore and replace for a deleted PO only to lifecycle managers", () => {
  assert.deepEqual(deletedPurchaseOrderActions(true, true), { restore: true, replace: true, needsManager: false });
  assert.deepEqual(deletedPurchaseOrderActions(true, false), { restore: true, replace: false, needsManager: false });
  assert.deepEqual(deletedPurchaseOrderActions(false, true), { restore: false, replace: false, needsManager: true });
  assert.match(purchaseOrderNumberBlockMessage({ sameImporterDuplicate: false, sameImporterDeleted: true }, "030201", ptBR),
    /Restaure-a como estava ou com os dados da planilha/u);
});
