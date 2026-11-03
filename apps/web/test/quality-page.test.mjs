import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { canResolveQuality } from "../lib/quality-permissions.ts";
import { qualityEvidenceFields, qualityIssueCodes, qualityIssueText, qualityOutcomeLabel, qualityResolutionPayload,
  qualitySeverityLabel, qualityStatusLabel } from "../lib/quality-issues.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
// The workbook load queue is the second tab of /quality.
const [page, analysisCss, componentsCss, authorization] = await Promise.all([
  read("components/QualityLoadQueue.tsx"), read("app/styles/features/analysis.css"), read("app/styles/components.css"),
  read("../api/src/authorization.ts")]);

test("every load issue code has a complete explanation in the three languages", () => {
  for (const messages of [ptBR, en, zhCN]) {
    for (const code of qualityIssueCodes) {
      const text = qualityIssueText(messages, code);
      assert.equal(text.known, true, code);
      assert.ok(text.title.trim(), `${code}.title`);
      // Chinese titles are short; the explanations must say something.
      for (const part of ["meaning", "impact", "fix"]) assert.ok(text[part].trim().length > 8, `${code}.${part}`);
      assert.notEqual(text.title, code);
    }
  }
  assert.equal(qualityIssueText(ptBR, "PRICE_WITHOUT_CURRENCY").title, "Preço sem moeda");
});

test("an unknown code still gets a readable title that names the code", () => {
  const text = qualityIssueText(ptBR, "NEW_RULE");
  assert.equal(text.known, false);
  assert.equal(text.title, ptBR.quality.unknownType);
  assert.match(text.meaning, /NEW_RULE/u);
});

test("status, severity and review outcome are translated and fall back to the raw value", () => {
  assert.equal(qualityStatusLabel(ptBR, "OPEN"), "Aberta");
  assert.equal(qualityStatusLabel(ptBR, "RESOLVED"), "Resolvida");
  assert.equal(qualityStatusLabel(en, "OPEN"), "Open");
  assert.equal(qualitySeverityLabel(ptBR, "WARNING"), "Atenção");
  assert.equal(qualityOutcomeLabel(ptBR, "Resolved"), "Resolvida");
  assert.equal(qualityStatusLabel(ptBR, "LATER"), "LATER");
  assert.equal(qualitySeverityLabel(ptBR, "FATAL"), "FATAL");
});

test("evidence fields are labelled in a fixed order and keep unknown keys", () => {
  const fields = qualityEvidenceFields(ptBR, { currency: null, unitPrice: "0.013965", productCode: "2010103280",
    purchaseOrder: "031178", extra: 1, suppliers: ["HEXING", "ZLINK"] });
  assert.deepEqual(fields.map(field => field.key), ["purchaseOrder", "productCode", "suppliers", "unitPrice", "currency", "extra"]);
  assert.deepEqual(fields.map(field => field.value), ["031178", "2010103280", "HEXING, ZLINK", "0.013965", "—", "1"]);
  assert.equal(fields[0].label, "PO");
  assert.equal(fields.at(-1).label, "extra");
  assert.deepEqual(qualityEvidenceFields(ptBR, { suppliers: [] }).map(field => field.value), ["—"]);
  // Every key written by the loaders has a label in each language.
  for (const messages of [ptBR, en, zhCN]) {
    for (const key of ["purchaseOrder", "draftPo", "ipNumber", "scNumber", "productCode", "importer", "poSupplier",
      "ipSupplier", "suppliers", "unitPrice", "currency", "amount", "column", "value"]) {
      assert.ok(messages.quality.evidenceLabels[key], key);
    }
  }
});

test("the resolution payload trims the form and leaves empty proposals as null", () => {
  assert.deepEqual(qualityResolutionPayload({ reference: " INV-9 ", reason: " Conferido. ", proposedPurchaseOrder: " " }),
    { evidence: { reference: "INV-9" }, reason: "Conferido.", proposedPurchaseOrder: null, proposedIpNumber: null });
});

test("the review button follows the roles that hold quality.resolve in the API", () => {
  const apiRoles = [...authorization.matchAll(/^\s+([\p{L}]+): new Set\(\[([^\]]*)\]\)/gmu)]
    .filter(match => match[2].includes('"quality.resolve"')).map(match => match[1]);
  assert.ok(apiRoles.includes("Logística"));
  for (const role of apiRoles) assert.equal(canResolveQuality([role]), true, role);
  for (const role of ["Gestor", "Consulta"]) assert.equal(canResolveQuality([role]), false, role);
});

test("the card shows the explained title and translated status instead of raw codes", () => {
  assert.match(page, /qualityIssueText\(m, item\.code\)/u);
  assert.match(page, /qualityStatusLabel\(m, item\.status\)/u);
  assert.match(page, /qualitySeverityLabel\(m, item\.severity\)/u);
  assert.doesNotMatch(page, /<strong>\{item\.code\}<\/strong>/u);
  assert.doesNotMatch(page, />\{item\.status\}</u);
  assert.match(page, /t\.technicalCode\(item\.code\)/u);
  assert.match(page, /<summary>\{t\.technicalDetails\}<\/summary>/u);
  assert.match(page, /qualityEvidenceFields\(m, item\.evidence\)/u);
});

test("the type summary filters by code and clicking the selected type clears it", () => {
  assert.match(page, /data\?\.countsByCode/u);
  assert.match(page, /aria-pressed=\{code === entry\.code\}/u);
  assert.match(page, /changeCode\(code === entry\.code \? "" : entry\.code\)/u);
  assert.match(page, /query\.set\("search", search\.trim\(\)\)/u);
  assert.doesNotMatch(page, /EXCEL_ERROR/u);
});

test("the review form has no JSON field and links the PO and IP when known", () => {
  assert.doesNotMatch(page, /name="evidence"/u);
  assert.doesNotMatch(page, /JSON\.parse/u);
  assert.match(page, /qualityResolutionPayload\(/u);
  assert.match(page, /href=\{`\/purchase-orders\/\$\{item\.links\.purchaseOrderId\}`\}/u);
  assert.match(page, /href=\{`\/processes\/\$\{item\.links\.processId\}`\}/u);
});

test("the new screen classes have their own rule", () => {
  for (const name of ["quality-type-summary", "quality-type-chip", "quality-explain", "quality-links"]) {
    assert.match(page, new RegExp(`className="[^"]*\\b${name}\\b`, "u"), name);
    assert.match(analysisCss, new RegExp(`\\.${name}\\b`, "u"), name);
  }
  assert.match(componentsCss, /\.quality-filter \{ align-items: end; grid-template-columns: 180px minmax\(180px, 1fr\) minmax\(180px, 1fr\) auto; \}/u);
});
