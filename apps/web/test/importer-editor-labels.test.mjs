import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ptBR } from "../lib/i18n/pt-BR.ts";

const catalogPage = readFileSync(new URL("../app/catalog/values/page.tsx", import.meta.url), "utf8");

test("shows a title above every importer field while editing.", () => {
  const t = ptBR.entityValues;
  assert.ok(catalogPage.includes('{entity === "importer" ? t.importerCode : t.code}'));
  assert.equal([t.importerCode, t.code].join("|"), "Código do importador|Código");
  assert.ok(catalogPage.includes('<label htmlFor={`operational-short-name-${option.id}`}>{t.shortName}'));
  assert.equal(t.shortName, "Nome reduzido");
  assert.ok(catalogPage.includes('<label htmlFor={`operational-import-cons-${option.id}`}>{t.importCons}'));
  assert.equal(t.importCons, "Import/Cons.");
  assert.ok(catalogPage.includes('<label htmlFor={`operational-cnpj-${option.id}`}>{t.cnpj}'));
  assert.equal(t.cnpj, "CNPJ");
  assert.ok(catalogPage.includes('{entity === "importer" ? t.fullName : t.value}'));
  assert.equal([t.fullName, t.value].join("|"), "Nome completo|Valor");
});
