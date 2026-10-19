import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNcmCatalogUrl, createNcmPayload, readNcmRefreshStart,
  updateNcmPayload } from "../lib/catalog-ncms.ts";
import { describeNcmAttributeCondition, describeNcmCreationAct, describeNcmDomainOption,
  describeNcmFillType } from "../lib/catalog-ncm-attributes.ts";

const catalogPage = readFileSync(new URL("../app/catalog/values/page.tsx", import.meta.url), "utf8");

test("manual NCM refresh accepts the asynchronous API contract and explains a non-JSON gateway error", async () => {
  assert.equal(await readNcmRefreshStart(Response.json({ status: "started" }, { status: 202 })), "started");
  assert.equal(await readNcmRefreshStart(Response.json({ status: "running" }, { status: 202 })), "running");
  await assert.rejects(readNcmRefreshStart(new Response("Bad Gateway", { status: 502 })),
    /atualização não pôde ser iniciada \(HTTP 502\)/u);
  await assert.rejects(readNcmRefreshStart(Response.json({ detail: "Siscomex indisponível" }, { status: 503 })),
    /Siscomex indisponível/u);
});

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
  const controlling = { code: "ATT_14545", displayName: "Categoria do produto",
    domain: [{ code: "83", description: "Produto para diagnóstico" },
      { code: "84", description: "Material hospitalar" }, { code: "90", description: "Outro dispositivo" },
      { code: "99", description: "Outros" }, { code: "97", description: "Não informado" }] };
  assert.equal(describeNcmAttributeCondition(
    "'ATT_14545' igual '83' OU 'ATT_14545' igual '84' OU 'ATT_14545' igual '90'",
    controlling,
  ), "Obrigatório quando “Categoria do produto” for Produto para diagnóstico (83), Material hospitalar (84) ou Outro dispositivo (90).");
  assert.equal(describeNcmAttributeCondition(
    "'ATT_14545' Diferente '99' E 'ATT_14545' Diferente '97'", controlling,
  ), "Obrigatório quando “Categoria do produto” não for Outros (99) nem Não informado (97).");
  assert.equal(describeNcmAttributeCondition(
    "ATT_14547 igual true",
    { code: "ATT_14547", displayName: "É produto estéril?" },
  ), "Obrigatório quando “É produto estéril?” for Sim.");
  assert.match(describeNcmAttributeCondition("regra (complexa)"), /regra específica do Siscomex/u);
  assert.equal(describeNcmDomainOption({ code: "82", description: "Dispositivo médico" }), "Dispositivo médico (82)");
  assert.equal(describeNcmFillType("LISTA_ESTATICA"), "Escolha uma opção da lista oficial");
  assert.equal(describeNcmCreationAct({ tipoOrgaoAtoIni: "Resolução", numeroAtoIni: "42", anoAtoIni: "2022" }),
    "Ato legal de criação: Resolução · nº 42/2022");
  assert.match(catalogPage, /NcmAttributeOptions options=\{attribute\.domain\}/u);
  assert.match(catalogPage, /attribute\.subattributes/u);
  assert.match(catalogPage, /NcmCreationAct act=\{ncm\.creationAct\}/u);
});
