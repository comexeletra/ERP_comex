import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { qualityFixAction, qualityFixPayload, qualityNcmCodes, qualityProductsPayload, qualitySkipLabel } from "../lib/quality-issues.ts";
import { canFixQuality, canRegisterNcms, canRegisterProducts } from "../lib/quality-permissions.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [panel, current, authorization, catalog, apiFixes, analysisCss] = await Promise.all([
  read("components/QualityFixPanel.tsx"), read("components/QualityCurrentRules.tsx"), read("../api/src/authorization.ts"),
  read("../api/src/catalog.ts"), read("../api/src/quality-fixes.ts"), read("app/styles/features/analysis.css")]);
const item = (entityId, labels, values = {}) => ({ entityId, labels, values });

test("each registration rule has its card fix and the others are fixed on their own screen", () => {
  assert.equal(qualityFixAction("ITEM_PRICE_WITHOUT_CURRENCY"), "ITEM_CURRENCY");
  assert.equal(qualityFixAction("ITEM_WITHOUT_PRICE"), "ITEM_PRICE");
  assert.equal(qualityFixAction("ITEM_WITHOUT_NCM"), "ITEM_NCM");
  assert.equal(qualityFixAction("PO_WITHOUT_SUPPLIER"), "PO_SUPPLIER");
  assert.equal(qualityFixAction("ITEM_PRODUCT_NOT_REGISTERED"), "PRODUCT");
  assert.equal(qualityFixAction("ITEM_NCM_NOT_REGISTERED"), "NCM_OFFICIAL");
  for (const rule of ["ITEM_PO_APPROVED_BEFORE_SC", "IP_CLEARED_BEFORE_ARRIVAL", "IP_WITHOUT_PO", "ITEM_SHIPPED_WITHOUT_IP",
    "IP_PO_SUPPLIER_MISMATCH", "SC_MULTIPLE_SUPPLIERS"]) assert.equal(qualityFixAction(rule), null, rule);
});

test("the fix payload sends only the fields of its action and leaves empty ones to the API suggestion", () => {
  assert.deepEqual(qualityFixPayload("ITEM_CURRENCY", ["a"], { currency: "", ncm: "123" }, "  Conferido no pedido. ", true),
    { action: "ITEM_CURRENCY", entityIds: ["a"], reason: "Conferido no pedido.", preview: true, value: {} });
  assert.deepEqual(qualityFixPayload("ITEM_PRICE", ["a"], { unitPrice: " 1,25 ", currency: "USD" }, "Conferido no pedido.", false).value,
    { unitPrice: "1.25", currency: "USD" });
  assert.deepEqual(qualityFixPayload("ITEM_NCM", ["a", "b"], { ncm: "8533.21.20", alsoProduct: true }, "Conferido pela Fiscal.", true).value,
    { ncm: "85332120", alsoProduct: true });
  assert.deepEqual(qualityFixPayload("ITEM_NCM", ["a"], { ncm: "", alsoProduct: false }, "Conferido pela Fiscal.", true).value, {});
  assert.deepEqual(qualityFixPayload("PO_SUPPLIER", ["p"], { supplierCode: "EX000135" }, "Conferido no pedido.", true).value,
    { supplierCode: "EX000135" });
});

test("the fix payload keys are the ones the API schema accepts", () => {
  const schema = /value: z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/u.exec(apiFixes)[1];
  const apiKeys = [...schema.matchAll(/^\s+([a-zA-Z]+):/gmu)].map(match => match[1]).sort();
  assert.deepEqual(apiKeys, ["alsoProduct", "currency", "ncm", "supplierCode", "unitPrice"]);
});

test("products are registered once per code with the item description, and NCMs only with 8 digits", () => {
  assert.deepEqual(qualityProductsPayload([item("1", { productCode: "2010", description: "Medidor" }),
    item("2", { productCode: " 2010 ", description: "Outra" }), item("3", { productCode: "3051" }), item("4", {})]),
  { items: [{ code: "2010", description: "Medidor" }, { code: "3051", description: "3051" }] });
  assert.deepEqual(qualityNcmCodes([item("1", {}, { ncm: "8533.21.20" }), item("2", {}, { ncm: "85332120" }),
    item("3", {}, { ncm: "853" }), item("4", {}, {})]), ["85332120"]);
});

test("refusal reasons are translated in the three languages", () => {
  for (const messages of [ptBR, en, zhCN]) {
    for (const code of ["NOT_VIOLATED", "PO_NOT_ACTIVE", "NO_SUGGESTION", "PO_HAS_SC", "DATABASE_REFUSED"]) {
      assert.notEqual(qualitySkipLabel(messages, code), code);
    }
  }
  assert.equal(qualitySkipLabel(ptBR, "OTHER"), "OTHER");
});

test("fix permissions follow the API roles", () => {
  const holders = permission => [...authorization.matchAll(/^\s+([\p{L}]+): new Set\(\[([^\]]*)\]\)/gmu)]
    .filter(match => match[2].includes(`"${permission}"`)).map(match => match[1]);
  for (const role of holders("purchase-orders.write")) assert.equal(canFixQuality([role]), true, role);
  for (const role of ["Fiscal", "Logística", "Gestor", "Consulta"]) assert.equal(canFixQuality([role]), false, role);
  assert.match(catalog, /roles\.includes\(kind === "NCM" \? "Fiscal" : "Compras"\)/u);
  assert.deepEqual(["Master", "Administrador", "Compras", "Fiscal"].map(role => canRegisterProducts([role])), [true, true, true, false]);
  assert.deepEqual(["Master", "Administrador", "Compras", "Fiscal"].map(role => canRegisterNcms([role])), [true, true, false, true]);
});

test("the fix panel previews first, then applies with an idempotency key and shows the result", () => {
  assert.match(panel, /apiFetch\("\/api\/v1\/quality\/current\/fixes", \{/u);
  assert.match(panel, /qualityFixPayload\(action, ids, form, reason, true\)/u);
  assert.match(panel, /qualityFixPayload\(action, ids, form, reason, false\)/u);
  assert.match(panel, /"idempotency-key": preview\.key/u);
  assert.match(panel, /apiFetch\("\/api\/v1\/products\/bulk", \{/u);
  assert.match(panel, /JSON\.stringify\(qualityProductsPayload\(items\)\)/u);
  assert.match(panel, /apiFetch\("\/api\/v1\/ncms\/import-official", \{/u);
  assert.match(panel, /<ConfirmDialog/u);
  assert.match(panel, /qualitySkipLabel\(m, entry\.code\)/u);
  assert.match(panel, /loadOperationalOptions\(\)/u);
  assert.match(panel, /loadCatalogChoices\("suppliers", importer\)/u);
});

test("cards offer the fix inline and a bulk bar when a fixable rule is filtered", () => {
  assert.match(current, /<QualityFixPanel rule=\{item\.rule\} items=\{\[item\]\}/u);
  assert.match(current, /<QualityFixPanel rule=\{rule\} items=\{selectedItems\}/u);
  assert.match(current, /const bulkAction = rule \? qualityFixAction\(rule\) : null;/u);
  assert.match(current, /setSelected\(new Set\(\)\)/u);
  for (const name of ["quality-fix", "quality-bulk-bar", "quality-select"]) {
    assert.match(panel + current, new RegExp(`className="[^"]*\\b${name}\\b`, "u"), name);
    assert.match(analysisCss, new RegExp(`\\.${name}\\b`, "u"), name);
  }
});
