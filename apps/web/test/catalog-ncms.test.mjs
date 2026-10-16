import assert from "node:assert/strict";
import test from "node:test";
import { createNcmCatalogUrl } from "../lib/catalog-ncms.ts";

test("NCM values load from the global catalog without importer filters", () => {
  const url = createNcmCatalogUrl(3, "  8528  ");
  assert.equal(url, "/api/v1/ncms?page=3&pageSize=25&search=8528");
  assert.doesNotMatch(url, /importer/u);
});

test("NCM catalog list starts without a search filter", () => {
  assert.equal(createNcmCatalogUrl(1, "  "), "/api/v1/ncms?page=1&pageSize=25");
});
