import assert from "node:assert/strict";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { lockedSharedFieldKeys, sharedFieldsSavedMessage, suggestedPurchaseRequestNumber } from "../lib/po-sc-link.ts";

test("suggests the most frequent SC number from the PO items and ignores blanks", () => {
  assert.equal(suggestedPurchaseRequestNumber([{ scNumber: "020028" }, { scNumber: " 020028 " },
    { scNumber: "020029" }, { scNumber: null }, { scNumber: "" }]), "020028");
  assert.equal(suggestedPurchaseRequestNumber([{ scNumber: "A" }, { scNumber: "B" }]), "A");
  assert.equal(suggestedPurchaseRequestNumber([{ scNumber: null }, { scNumber: "  " }]), "");
  assert.equal(suggestedPurchaseRequestNumber([]), "");
});

test("locks the SC number in the shared fields only when the PO has a linked SC", () => {
  assert.deepEqual([...lockedSharedFieldKeys("sc-1")], ["scNumber"]);
  assert.deepEqual([...lockedSharedFieldKeys(null)], []);
  assert.deepEqual([...lockedSharedFieldKeys("")], []);
});

test("tells when the linked SC was also updated in the PCM", () => {
  assert.equal(sharedFieldsSavedMessage("Dados aplicados.", true, "020028", ptBR), "Dados aplicados. SC 020028 atualizada no PCM.");
  assert.equal(sharedFieldsSavedMessage("Dados aplicados.", false, "020028", ptBR), "Dados aplicados.");
  assert.equal(sharedFieldsSavedMessage("Dados aplicados.", true, null, ptBR), "Dados aplicados. SC atualizada no PCM.");
  assert.equal(sharedFieldsSavedMessage("Data applied.", true, "020028", en), "Data applied. SC 020028 updated in PCM.");
});
