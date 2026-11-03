import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { qualityEvidenceFields, qualityGroupLabel, qualityRuleCodes, qualityRuleGroups, qualityRuleSummary, qualityRuleText,
  qualityWaiverPayload } from "../lib/quality-issues.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [route, current, loadQueue, pager, analysisCss, apiRules] = await Promise.all([
  read("app/quality/page.tsx"), read("components/QualityCurrentRules.tsx"), read("components/QualityLoadQueue.tsx"),
  read("components/QualityPager.tsx"), read("app/styles/features/analysis.css"), read("../api/src/quality-rules.ts")]);

test("the web rule list mirrors the API catalog, in the same order", () => {
  const codes = [...apiRules.matchAll(/(?:itemRule|processRule)\("([A-Z_]+)"|\{ code: "([A-Z_]+)"/gu)]
    .map(match => match[1] ?? match[2]);
  assert.deepEqual([...qualityRuleCodes], codes);
  assert.equal(codes.length, 12);
});

test("every rule and group has a complete explanation in the three languages", () => {
  for (const messages of [ptBR, en, zhCN]) {
    for (const code of qualityRuleCodes) {
      const text = qualityRuleText(messages, code);
      assert.equal(text.known, true, code);
      assert.ok(text.title.trim(), `${code}.title`);
      for (const part of ["meaning", "impact", "fix"]) assert.ok(text[part].trim().length > 8, `${code}.${part}`);
    }
    for (const group of qualityRuleGroups) assert.notEqual(qualityGroupLabel(messages, group), group);
  }
  assert.equal(qualityRuleText(ptBR, "IP_CLEARED_BEFORE_ARRIVAL").title, "Desembaraço antes da chegada");
  assert.equal(qualityRuleText(ptBR, "NEW_RULE").known, false);
});

test("the rule summary keeps every rule of each group in catalog order, with zero when absent", () => {
  const summary = qualityRuleSummary([{ rule: "IP_WITHOUT_PO", group: "LINKS", open: 2, waived: 1 },
    { rule: "ITEM_WITHOUT_NCM", group: "REGISTRATION", open: 484, waived: 0 }]);
  assert.deepEqual(summary.map(group => group.group), ["REGISTRATION", "DATES", "LINKS"]);
  assert.deepEqual(summary[0].rules[0], { rule: "ITEM_WITHOUT_NCM", open: 484, waived: 0 });
  assert.deepEqual(summary[0].rules[1], { rule: "ITEM_NCM_NOT_REGISTERED", open: 0, waived: 0 });
  assert.deepEqual(summary[2].rules.find(entry => entry.rule === "IP_WITHOUT_PO"), { rule: "IP_WITHOUT_PO", open: 2, waived: 1 });
  assert.equal(summary.flatMap(group => group.rules).length, 12);
});

test("rule values hide internal ids and the waiver payload is trimmed", () => {
  const fields = qualityEvidenceFields(ptBR, { purchaseOrder: "031178", supplierId: "uuid", ipSupplierId: "uuid",
    clearanceDate: "2026-01-05" }, { hideIds: true });
  assert.deepEqual(fields.map(field => field.key), ["purchaseOrder", "clearanceDate"]);
  assert.equal(fields[1].label, "Desembaraço");
  assert.deepEqual(qualityWaiverPayload("IP_CLEARED_BEFORE_ARRIVAL", "id-1", "  Despacho antecipado, DUIMP 26BR0001.  "),
    { rule: "IP_CLEARED_BEFORE_ARRIVAL", entityId: "id-1", reason: "Despacho antecipado, DUIMP 26BR0001." });
  // Every value key the rules return has a label in each language.
  const keys = [...apiRules.slice(0, apiRules.indexOf("const ruleCodes")).matchAll(/jsonb_build_object\(([^)]*)/gu)].flatMap(match => [...match[1].matchAll(/'([a-zA-Z]+)'/gu)])
    .map(match => match[1]).filter(key => !key.endsWith("Id"));
  for (const messages of [ptBR, en, zhCN]) {
    for (const key of new Set(keys)) assert.ok(messages.quality.evidenceLabels[key], key);
  }
});

test("the quality screen has two tabs, current data first", () => {
  assert.match(route, /<nav className="tabs" aria-label=\{t\.tabs\.label\}>/u);
  assert.match(route, /useState<"current" \| "load">\("current"\)/u);
  assert.match(route, /tab === "current" \? <QualityCurrentRules \/> : <QualityLoadQueue \/>/u);
});

test("current data reads the rule route, waives through a dialog and can undo", () => {
  assert.match(current, /apiFetch\("\/api\/v1\/quality\/current\?" \+ query\.toString\(\)\)/u);
  assert.match(current, /query\.set\("includeWaived", "true"\)/u);
  assert.match(current, /apiFetch\("\/api\/v1\/quality\/current\/waivers", \{/u);
  assert.match(current, /"idempotency-key": waiving\.key/u);
  assert.match(current, /JSON\.stringify\(qualityWaiverPayload\(/u);
  assert.match(current, /`\/api\/v1\/quality\/current\/waivers\/\$\{revoking\.waiverId\}\/revoke`/u);
  assert.match(current, /<ConfirmDialog/u);
  assert.doesNotMatch(current, /window\.confirm/u);
  assert.match(current, /qualityRuleSummary\(data\?\.countsByRule \?\? \[\]\)/u);
  assert.match(current, /changeRule\(rule === entry\.rule \? "" : entry\.rule\)/u);
  assert.match(current, /qualityEvidenceFields\(m, \{ \.\.\.item\.labels, \.\.\.item\.values \}, \{ hideIds: true \}\)/u);
  assert.match(current, /canResolveQuality\(roles \?\? \[\]\)/u);
});

test("both lists page through every result", () => {
  for (const source of [loadQueue, current]) {
    assert.match(source, /<QualityPager page=\{data\.page\} pageSize=\{data\.pageSize\} total=\{data\.totalCount\}/u);
    assert.match(source, /query\.set\("page", String\(pageNumber\)\)/u);
  }
  assert.match(pager, /<nav className="quality-pager"/u);
  assert.match(pager, /t\.pageOf\(page, pages\)/u);
  assert.match(pager, /disabled=\{page <= 1\}/u);
  assert.match(pager, /disabled=\{page >= pages\}/u);
  assert.match(analysisCss, /\.quality-pager \{/u);
});
