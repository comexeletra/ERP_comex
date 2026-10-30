import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { processFollowupFieldKeys } from "../dist/followup.js";
import { createPo, patchPoFields, purchaseOrderProductReferenceSql } from "../dist/operations.js";
import { ipPostShipmentFields } from "../../web/lib/ip-post-shipment-fields.ts";

const migrationsUrl = new URL("../migrations/", import.meta.url);
const source = name => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
const web = name => readFile(new URL(`../../web/${name}`, import.meta.url), "utf8");
const migration = async () => (await readFile(new URL("M075_historical_load_fields.sql", migrationsUrl), "utf8"))
  .replace(/--.*$/gmu, "");
const header = { number: "030201", supplierText: "HEXING", orderDate: null, notes: "", reason: "Teste da carga" };

test("M075 adds the fields of the historical load without touching existing data", async () => {
  const sql = await migration();
  assert.match(sql, /ADD COLUMN documents_ok_date date/u);
  assert.match(sql, /ALTER COLUMN container_quantity TYPE numeric\(10,2\)/u);
  assert.match(sql, /ADD COLUMN analyst varchar\(160\)/u);
  assert.match(sql, /ADD COLUMN si_number varchar\(120\)/u);
  assert.match(sql, /analyst IS NULL OR length\(btrim\(analyst\)\) > 0/u);
  assert.match(sql, /si_number IS NULL OR length\(btrim\(si_number\)\) > 0/u);
  assert.match(sql, /ALTER COLUMN requester DROP NOT NULL/u);
  assert.match(sql, /ADD COLUMN file_values jsonb/u);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|INSERT INTO|DROP COLUMN/u);
});

test("M075 keeps every selector entity and adds only ANALYST", async () => {
  const sql = await migration();
  const previous = await readFile(new URL("M069_purchase_order_item_demand_type.sql", migrationsUrl), "utf8");
  const allowed = text => [...text.matchAll(/'([A-Z_]+)'/gu)].map(match => match[1]);
  const start = sql.indexOf("ADD CONSTRAINT operational_value_entity_key_check");
  const before = allowed(previous.slice(previous.indexOf("ADD CONSTRAINT"), previous.indexOf("));")));
  const after = allowed(sql.slice(start, sql.indexOf("));", start)));
  assert.deepEqual(after.filter(key => !before.includes(key)), ["ANALYST"]);
  assert.deepEqual(before.filter(key => !after.includes(key)), []);
});

test("M075 only lets imported items keep a price without currency", async () => {
  const sql = await migration();
  assert.match(sql, /DROP CONSTRAINT purchase_order_item_check1/u);
  assert.match(sql, /\(unit_price IS NULL\) = \(currency_code IS NULL\)\s+OR \(source_kind = 'IMPORTED_SOURCE_ITEM' AND currency_code IS NULL\)/u);
});

test("the analyst and the SI are optional PO header fields", () => {
  for (const schema of [createPo.omit({ importer: true }), patchPoFields]) {
    assert.equal(schema.safeParse(header).success, true);
    const parsed = schema.parse({ ...header, analyst: "JOAO", siNumber: "902, 904, 918" });
    assert.equal(parsed.analyst, "JOAO");
    assert.equal(parsed.siNumber, "902, 904, 918");
    assert.equal(schema.safeParse({ ...header, analyst: null, siNumber: null }).success, true);
    assert.equal(schema.safeParse({ ...header, analyst: "x".repeat(161) }).success, false);
    assert.equal(schema.safeParse({ ...header, siNumber: "x".repeat(121) }).success, false);
  }
});

test("every PO write and the PO read carry the analyst and the SI", async () => {
  const [operations, followup] = await Promise.all([source("operations.ts"), source("followup.ts")]);
  for (const text of [operations, followup]) {
    assert.match(text, /purchase_request_id,demand_type,analyst,si_number\)/u);
    assert.match(text, /analyst *= *CASE WHEN \$\d+::boolean THEN \$\d+::text ELSE analyst END/u);
    assert.match(text, /si_number *= *CASE WHEN \$\d+::boolean THEN \$\d+::text ELSE si_number END/u);
  }
  assert.match(operations, /po\.analyst, po\.si_number AS "siNumber"/u);
});

test("the analyst is a selector entity and the PO forms send both fields", async () => {
  const [catalog, values, panel, record] = await Promise.all([source("catalog.ts"), web("app/catalog/values/page.tsx"),
    web("components/OperationalPoPanel.tsx"), web("components/NewOperationalRecord.tsx")]);
  assert.match(catalog, /"ANALYST"/u);
  assert.match(catalog, /ANALYST: 160/u);
  assert.match(values, /"analyst"/u);
  for (const form of [panel, record]) {
    assert.match(form, /entity="analyst"/u);
    assert.match(form, /analyst: analyst \|\| null/u);
    assert.match(form, /siNumber: siNumber \|\| null/u);
  }
});

test("Doc ok is a date on the IP form, the API and the product lines", async () => {
  assert.ok(processFollowupFieldKeys.includes("documentsOkDate"));
  assert.ok(!processFollowupFieldKeys.includes("documentsOk"));
  const field = ipPostShipmentFields.find(item => item.key === "documentsOkDate");
  assert.equal(field?.type, "date");
  assert.equal(ipPostShipmentFields.some(item => item.key === "documentsOk"), false);
  assert.match(await source("shipment-lines.ts"), /"documents_ok_date"/u);
  assert.doesNotMatch(await source("followup.ts"), /documents_ok"/u);
});

test("a shared container counts as half on each IP", async () => {
  assert.match(await source("followup.ts"), /containerQuantity: \["container_quantity", "money"\]/u);
  assert.equal(ipPostShipmentFields.find(item => item.key === "containerQuantity")?.type, "money");
});

test("the IP list finds the workbook lines through an index on the expression it uses", async () => {
  const index = (await readFile(new URL("M076_source_row_ip_lookup.sql", migrationsUrl), "utf8")).replace(/--.*$/gmu, "");
  assert.match(index, /upper\(btrim\(raw_values->>'AB'\)\)/u);
  assert.match(index, /WHERE sheet_name = 'Pré Embarque'/u);
  assert.match(await source("processes.ts"), /upper\(btrim\(source\.raw_values->>'AB'\)\) = process\.normalized_ip_number/u);
});

test("the price reference filters by product before reading the reference view", async () => {
  const sql = purchaseOrderProductReferenceSql("item");
  assert.equal([...sql.matchAll(/\breference\.product_id=\(SELECT product\.id FROM catalog\.entry AS product/gu)].length, 2);
  assert.equal([...sql.matchAll(/description_reference\.product_id=\(SELECT product\.id FROM catalog\.entry AS product/gu)].length, 3);
  assert.doesNotMatch(sql, /JOIN catalog\.entry AS product/u);
});

test("the product line export fits the whole history and the screens tell its limit", async () => {
  const worker = await source("worker.ts");
  assert.match(worker, /maxExportLines = 30_000/u);
  assert.match(worker, /queryShipmentLines\(pool, job\.importer_scopes, filters\.data, maxExportLines \+ 1, 0\)/u);
  assert.match(worker, /result\.totalCount > maxExportLines/u);
  assert.match(await web("lib/i18n/pt-BR.ts"), /suporta até 30\.000 linhas/u);
});

test("a linked SC without requester does not stop the PO: the data arrives gradually", async () => {
  const operations = await source("operations.ts");
  assert.match(operations, /"requester" in fields && !fields\.requester && request\.requester/u);
});
