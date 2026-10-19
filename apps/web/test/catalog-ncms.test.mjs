import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNcmCatalogUrl, createNcmPayload, updateNcmPayload } from "../lib/catalog-ncms.ts";
import { describeNcmAttributeCondition } from "../lib/catalog-ncm-attributes.ts";

const catalogPage = readFileSync(new URL("../app/catalog/values/page.tsx", import.meta.url), "utf8");

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

test("NCM catalog labels render Portuguese accents correctly", () => {
  assert.match(catalogPage, /Próxima sincronização programada/iu);
  assert.match(catalogPage, /último catálogo Siscomex sincronizado/iu);
  assert.match(catalogPage, /Atualizar NCMs já cadastrados/iu);
  assert.match(catalogPage, /Pesquise pela descrição ou pelo código/iu);
  assert.match(catalogPage, /\/api\/v1\/ncms\/sync-status/u);
  assert.doesNotMatch(catalogPage, /[ÃÂ�]/u);
});

test("NCM attribute conditions use the controlling field name and clarify option codes", () => {
  assert.equal(describeNcmAttributeCondition(
    "'ATT_14545' igual '83' OU 'ATT_14545' igual '84' OU 'ATT_14545' igual '90'",
    { code: "ATT_14545", displayName: "Categoria do produto" },
  ), "Obrigatório quando “Categoria do produto” for uma das opções 83, 84 ou 90.");
  assert.equal(describeNcmAttributeCondition(
    "ATT_14547 igual true",
    { code: "ATT_14547", displayName: "É produto estéril?" },
  ), "Obrigatório quando “É produto estéril?” for Sim.");
  assert.match(describeNcmAttributeCondition("ATT_1 diferente de SIM"), /regra oficial do Siscomex/u);
});
