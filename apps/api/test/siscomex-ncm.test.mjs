import assert from "node:assert/strict";
import test from "node:test";
import {
  createOfficialNcmCatalogProvider,
  fetchOfficialNcmCatalog,
  parseSiscomexCatalog,
  parseSiscomexNcmTable,
  parseSiscomexRetryAt,
} from "../src/siscomex-ncm.ts";
import { summarizeSiscomexFailure } from "../dist/mdic-ncm.js";

function zipJson(value) {
  const name = Buffer.from("attributes.json", "utf8");
  const content = Buffer.from(JSON.stringify(value), "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const localFile = Buffer.concat([local, name, content]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralDirectory = Buffer.concat([central, name]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localFile.length, 16);
  return Buffer.concat([localFile, centralDirectory, end]);
}

const detail = (code, name, extras = {}) => ({
  codigo: code, nome: name, nomeApresentacao: name, formaPreenchimento: "TEXTO",
  dataInicioVigencia: "2025-01-01", dataFimVigencia: "", dominio: [], objetivos: [{ codigo: 7, descricao: "DUIMP" }],
  orgaos: [], atributoCondicionante: false, condicionados: [], listaSubatributos: [], multivalorado: false,
  ...extras,
});

test("NCM import uses official descriptions and only mandatory import attributes", () => {
  const payload = {
    Data_Ultima_Atualizacao_NCM: "15/10/2026",
    Nomenclaturas: [
      { Codigo: "01", Descricao: "Capítulo", Data_Inicio: "01/04/2022", Data_Fim: "31/12/9999" },
      { Codigo: "0101.21.00", Descricao: "Reprodutores de raça pura", Data_Inicio: "01/04/2022", Data_Fim: "31/12/9999" },
    ],
  };
  const attributes = {
    versao: 359,
    listaNcm: [{ codigoNcm: "0101.21.00", listaAtributos: [
      { codigo: "ATT_1", modalidade: "Importação", obrigatorio: true, multivalorado: false, dataInicioVigencia: "2025-05-01" },
      { codigo: "ATT_2", modalidade: "Importação", obrigatorio: false, multivalorado: false },
      { codigo: "ATT_3", modalidade: "Exportação", obrigatorio: true, multivalorado: false },
    ] }],
    detalhesAtributos: [
      detail("ATT_1", "Identificação do animal", { condicionados: [{
        obrigatorio: true, descricaoCondicao: "ATT_4 igual a SIM", atributo: detail("ATT_4", "Registro do animal"),
      }] }),
      detail("ATT_2", "Atributo opcional"),
      detail("ATT_3", "Atributo de exportação"),
    ],
  };

  const catalog = parseSiscomexCatalog(payload, zipJson(attributes), 1);
  assert.equal(catalog.sourceUpdatedAt, "2026-10-15");
  assert.equal(catalog.attributesVersion, "359");
  assert.equal(catalog.items.length, 1);
  assert.deepEqual(catalog.items[0], {
    code: "01012100", name: "Reprodutores de raça pura", validFrom: "2022-04-01", validTo: "9999-12-31",
    creationAct: null,
    mandatoryImportAttributes: [{
      code: "ATT_1", name: "Identificação do animal", displayName: "Identificação do animal", fillType: "TEXTO",
      required: true, multivalued: false, startsOn: "2025-05-01", endsOn: null, objectives: ["DUIMP"], organs: [],
      domain: [], subattributes: [],
      conditionalAttributes: [{ required: true, condition: "ATT_4 igual a SIM", conditionRule: null,
        startsOn: null, endsOn: null, attribute: {
        code: "ATT_4", name: "Registro do animal", displayName: "Registro do animal", fillType: "TEXTO",
        multivalued: false, startsOn: "2025-01-01", endsOn: null, objectives: ["DUIMP"], organs: [],
        domain: [], subattributes: [], conditionalAttributes: [],
      } }],
    }],
  });
});

test("NCM table rejects a partial source and duplicate eight-digit codes", () => {
  assert.throws(() => parseSiscomexNcmTable({ Nomenclaturas: [] }), /incompleta/u);
  assert.throws(() => parseSiscomexNcmTable({ Nomenclaturas: [
    { Codigo: "0101.21.00", Descricao: "Primeiro", Data_Inicio: "01/04/2022", Data_Fim: "31/12/9999" },
    { Codigo: "01012100", Descricao: "Duplicado", Data_Inicio: "01/04/2022", Data_Fim: "31/12/9999" },
  ] }, 1), /duplicado/u);
});

test("Siscomex nomenclature without per-code validity cannot replace the last good catalog", () => {
  assert.throws(() => parseSiscomexNcmTable({ nomenclaturas: [
    { codigo: "0101.21.00", descricao: "Teste" },
  ] }, 1), /Data inválida|início de vigência/u);
});

test("NCM table accepts the documented Siscomex JSON fields and validity dates", () => {
  const parsed = parseSiscomexNcmTable({
    dataUltimaAlteracao: "2026-10-15T00:00:00-03:00",
    nomenclaturas: [{
      codigo: "0101.21.00",
      descricao: "Reprodutores de raça pura",
      dataInicio: "2022-04-01",
      dataFim: "9999-12-31",
    }],
  }, 1);

  assert.equal(parsed.sourceUpdatedAt, "2026-10-15");
  assert.deepEqual(parsed.items, [{
    code: "01012100",
    name: "Reprodutores de raça pura",
    validFrom: "2022-04-01",
    validTo: "9999-12-31",
    creationAct: null,
  }]);
});

test("official NCM keeps creation act and details of required import fields without expanding optional fields", () => {
  const catalog = parseSiscomexCatalog({ nomenclaturas: [{
    codigo: "90189099", descricao: "Instrumentos médicos", dataInicio: "2022-04-01", dataFim: "9999-12-31",
    tipoOrgaoAtoIni: "Resolução", numeroAtoIni: 42, anoAtoIni: 2022,
  }] }, zipJson({ versao: 360, listaNcm: [{ codigoNcm: "90189099", listaAtributos: [
    { codigo: "ATT_14545", modalidade: "Importação", obrigatorio: true },
    { codigo: "ATT_OPTIONAL", modalidade: "Importação", obrigatorio: false },
  ] }], detalhesAtributos: [
    detail("ATT_14545", "Categoria de produto", { formaPreenchimento: "LISTA_ESTATICA",
      dominio: [{ codigo: "82", descricao: "Dispositivo médico" }, { codigo: "99", descricao: "Outros" }],
      listaSubatributos: [detail("ATT_PART", "Detalhamento")],
      condicionados: [{ obrigatorio: true, descricaoCondicao: "'ATT_14545' igual '82'",
        condicao: { atributo: "ATT_14545", operador: "IGUAL", valor: "82" },
        dataInicioVigencia: "2026-01-01", dataFimVigencia: "2026-12-31",
        atributo: detail("ATT_14546", "Prazo de validade") }],
    }),
    detail("ATT_OPTIONAL", "Campo opcional"),
  ] }), 1);
  const ncm = catalog.items[0];
  assert.deepEqual(ncm.creationAct, { tipoOrgaoAtoIni: "Resolução", numeroAtoIni: "42", anoAtoIni: "2022" });
  assert.equal(ncm.mandatoryImportAttributes.length, 1);
  const attribute = ncm.mandatoryImportAttributes[0];
  assert.deepEqual(attribute.domain, [{ code: "82", description: "Dispositivo médico" },
    { code: "99", description: "Outros" }]);
  assert.equal(attribute.subattributes[0].displayName, "Detalhamento");
  assert.deepEqual(attribute.conditionalAttributes[0].conditionRule,
    { atributo: "ATT_14545", operador: "IGUAL", valor: "82" });
  assert.equal(attribute.conditionalAttributes[0].startsOn, "2026-01-01");
  assert.equal(attribute.conditionalAttributes[0].endsOn, "2026-12-31");
});

test("NCM table accepts date-time headers and ignores an unrecognized informational date", () => {
  const nomenclaturas = [{
    codigo: "0101.21.00", descricao: "Reprodutores de raça pura",
    dataInicio: "2022-04-01", dataFim: "9999-12-31",
  }];
  for (const [header, expected] of [
    ["17/10/2026 18:00:00", "2026-10-17"],
    ["2026-10-17 18:00:00", "2026-10-17"],
    ["17/10/2026", "2026-10-17"],
    ["Vigente em 17/10/2026", "2026-10-17"],
    ["formato desconhecido", null],
  ]) {
    const parsed = parseSiscomexNcmTable({ dataUltimaAlteracao: header, nomenclaturas }, 1);
    assert.equal(parsed.sourceUpdatedAt, expected);
    assert.equal(parsed.items.length, 1);
  }
  assert.throws(() => parseSiscomexNcmTable({
    dataUltimaAlteracao: "formato desconhecido",
    nomenclaturas: [{ ...nomenclaturas[0], dataInicio: "formato desconhecido" }],
  }, 1), /Data inválida/u);
});

test("Siscomex retry time is interpreted in Brasília time", () => {
  const now = Date.parse("2026-10-16T20:02:00.000Z");
  assert.equal(
    parseSiscomexRetryAt("Disponível novamente após as 17:59:59 (horário de Brasília).", now),
    Date.parse("2026-10-16T20:59:59.000Z"),
  );
});

test("source failures retain endpoint and parser details for the fallback status", async () => {
  const fetcher = async url => {
    if (url.includes("nomenclatura")) throw new Error("connection timed out");
    return new Response(null, { status: 200 });
  };
  await assert.rejects(fetchOfficialNcmCatalog(fetcher), /nomenclaturas NCM.*connection timed out/u);
  assert.match(summarizeSiscomexFailure(new Error("JSON de NCM inválido")), /JSON de NCM inválido/u);
  assert.equal(summarizeSiscomexFailure({ statusCode: 422 }), "HTTP 422");
});

test("official NCM provider coalesces requests and suppresses retries during Siscomex cooldown", async () => {
  let now = Date.parse("2026-10-16T20:02:00.000Z");
  let fetchCount = 0;
  const retryAt = parseSiscomexRetryAt("Disponível novamente após as 17:59:59.", now);
  const fetchCatalog = async () => {
    fetchCount += 1;
    await Promise.resolve();
    const error = new Error("Siscomex indisponível");
    error.retryAt = retryAt;
    throw error;
  };
  const getCatalog = createOfficialNcmCatalogProvider(fetchCatalog, {
    now: () => now,
    initialRetryDelayMs: 5 * 60 * 1000,
  });

  const first = getCatalog();
  const concurrent = getCatalog();
  await assert.rejects(first, /Siscomex/u);
  await assert.rejects(concurrent, /Siscomex/u);
  assert.equal(fetchCount, 1);

  await assert.rejects(getCatalog(), /Siscomex/u);
  assert.equal(fetchCount, 1);

  now = retryAt + 1;
  await assert.rejects(getCatalog(), /Siscomex/u);
  assert.equal(fetchCount, 2);
});

test("official NCM provider applies fallback cooldown and caches successful catalogs", async () => {
  let now = 1_000;
  let fetchCount = 0;
  const catalog = { items: [], sourceUpdatedAt: null, attributesVersion: null };
  const getCatalog = createOfficialNcmCatalogProvider(async () => {
    fetchCount += 1;
    if (fetchCount === 1) throw new Error("network error");
    return catalog;
  }, { now: () => now, initialRetryDelayMs: 100, maxRetryDelayMs: 500, cacheLifetimeMs: 1_000 });

  await assert.rejects(getCatalog(), /Siscomex/u);
  await assert.rejects(getCatalog(), /Siscomex/u);
  assert.equal(fetchCount, 1);

  now = 1_101;
  assert.equal(await getCatalog(), catalog);
  assert.equal(await getCatalog(), catalog);
  assert.equal(fetchCount, 2);
  assert.equal(await getCatalog({ forceRefresh: true }), catalog);
  assert.equal(fetchCount, 3);
});
