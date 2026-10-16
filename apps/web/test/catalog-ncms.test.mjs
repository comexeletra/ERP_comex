import assert from "node:assert/strict";
import test from "node:test";
import { createNcmCatalogUrl, createNcmPayload, updateNcmPayload } from "../lib/catalog-ncms.ts";

test("NCM values load from the global catalog without importer filters", () => {
  const url = createNcmCatalogUrl(3, "  8528  ");
  assert.equal(url, "/api/v1/ncms?page=3&pageSize=25&search=8528");
  assert.doesNotMatch(url, /importer/u);
});

test("NCM catalog list starts without a search filter", () => {
  assert.equal(createNcmCatalogUrl(1, "  "), "/api/v1/ncms?page=1&pageSize=25");
});

test("NCM create and edit payloads use global catalog fields without importer", () => {
  const draft = { code: "  12345678 ", description: "  Classificação fiscal  ", status: "ACTIVE",
    evidence: " Documento oficial, consulta 01/10/2026 ", validFrom: "2026-10-01", validTo: "" };
  assert.deepEqual(createNcmPayload(draft, "Cadastro manual autorizado."), {
    code: "12345678", name: "Classificação fiscal", evidence: "Documento oficial, consulta 01/10/2026",
    reason: "Cadastro manual autorizado.", validFrom: "2026-10-01",
  });
  assert.deepEqual(updateNcmPayload(draft, "Cadastro manual autorizado."), {
    name: "Classificação fiscal", status: "ACTIVE", evidence: "Documento oficial, consulta 01/10/2026",
    validFrom: "2026-10-01", validTo: null, reason: "Cadastro manual autorizado.",
  });
  assert.equal("importer" in createNcmPayload(draft, "Cadastro manual autorizado."), false);
  assert.equal("importer" in updateNcmPayload(draft, "Cadastro manual autorizado."), false);
});
