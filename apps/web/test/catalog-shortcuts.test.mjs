import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User decision (2026-11-25): POs and IPs have their own screens in the menu, so the "Novo cadastro" card of
// Cadastros only leads to the master data: Produtos e NCM, Valores das entidades, Alíquotas por NCM and Cargas de
// referência.

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("the Cadastros shortcuts lead only to master data, not to PO or IP registration", async () => {
  const catalog = await source("../app/catalog/page.tsx");
  const card = catalog.match(/<nav className="catalog-links"[\s\S]*?<\/nav>/u)?.[0];
  assert.ok(card, "the shortcut card exists");
  const targets = [...card.matchAll(/href=\{?([^}>\s]+(?:\s*\?\s*"[^"]+"\s*:\s*"[^"]+")?)\}?/gu)].map(match => match[1]);
  assert.deepEqual(targets, [
    'canWrite ? "#catalog-create" : "#catalog-controls"',
    '"/catalog/values"',
    '"/catalog/ncm-rates"',
    '"/catalog/reference-loads"',
  ]);
  assert.doesNotMatch(catalog, /\/purchase-orders\/new|\/processes\/new/u);
});

test("the IP registration screen no longer returns to Cadastros", async () => {
  const page = await source("../app/processes/new/page.tsx");
  assert.match(page, /returnHref="\/processes"/u);
  assert.doesNotMatch(page, /from=|from ===/u);
});
