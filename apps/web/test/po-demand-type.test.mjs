import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [itemFields, panel, newRecord, followup] = await Promise.all([
  read("components/PurchaseOrderItemFields.tsx"), read("components/OperationalPoPanel.tsx"),
  read("components/NewOperationalRecord.tsx"), read("components/FollowupPanel.tsx")]);

test("the demand type is not a product field", () => {
  assert.doesNotMatch(itemFields, /demandType/u);
  assert.doesNotMatch(panel, /demandType: string \| null; requester/u);
});

test("the PO data form edits the demand type and saves it with the header", () => {
  assert.match(panel, /const \[demandType, setDemandType\] = useState\(""\)/u);
  assert.match(panel, /setDemandType\(po\.demandType \?\? ""\)/u);
  assert.match(panel, /<OperationalOptionSelect entity="demand_type" value=\{demandType\} values=\{options\}/u);
  assert.match(panel, /const header = \{ number, supplierText: supplier \|\| null, orderDate: orderDate \|\| null, notes,\s+demandType: demandType \|\| null,/u);
});

test("a new PO sends its demand type in the header, on both creation paths, and keeps it in the draft", () => {
  assert.match(newRecord, /<OperationalOptionSelect entity="demand_type" value=\{demandType\} values=\{options\}/u);
  assert.equal(newRecord.match(/demandType: demandType \|\| null/gu)?.length, 2);
  assert.match(newRecord, /savedHeader\.demandType !== \(demandType \|\| null\)/u);
  assert.match(newRecord, /const draft: PoDraft = \{ importer, number, supplier, notes, demandType,/u);
});

test("the follow-up shows the PO demand type once, in the PO header", () => {
  assert.match(followup, /fieldLabel\(m, \{ key: "demandType" \}\)/u);
});

test("the texts say the type belongs to the PO in the three languages", () => {
  for (const messages of [ptBR, en, zhCN]) {
    assert.ok(messages.poPanel.demandTypeHint.length > 10);
    assert.ok(messages.e2eAnalysis.missingDemandType(2).length > 10);
  }
  assert.match(ptBR.poPanel.demandTypeHint, /todos os produtos da PO/u);
  assert.match(ptBR.e2eAnalysis.missingDemandType(2), /dados da PO/u);
});
