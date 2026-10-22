import assert from "node:assert/strict";
import test from "node:test";
import { suggestedPurchaseRequestNumber } from "../lib/po-sc-link.ts";

test("suggests the most frequent SC number from the PO items and ignores blanks", () => {
  assert.equal(suggestedPurchaseRequestNumber([{ scNumber: "020028" }, { scNumber: " 020028 " },
    { scNumber: "020029" }, { scNumber: null }, { scNumber: "" }]), "020028");
  assert.equal(suggestedPurchaseRequestNumber([{ scNumber: "A" }, { scNumber: "B" }]), "A");
  assert.equal(suggestedPurchaseRequestNumber([{ scNumber: null }, { scNumber: "  " }]), "");
  assert.equal(suggestedPurchaseRequestNumber([]), "");
});
