import assert from "node:assert/strict";
import test from "node:test";
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
  assert.equal(sharedFieldsSavedMessage("Dados aplicados.", true, "020028"), "Dados aplicados. SC 020028 atualizada no PCM.");
  assert.equal(sharedFieldsSavedMessage("Dados aplicados.", false, "020028"), "Dados aplicados.");
  assert.equal(sharedFieldsSavedMessage("Dados aplicados.", true, null), "Dados aplicados. SC atualizada no PCM.");
});
