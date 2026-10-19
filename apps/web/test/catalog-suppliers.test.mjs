import assert from "node:assert/strict";
import test from "node:test";
import { createSupplierCatalogUrl } from "../lib/catalog-suppliers.ts";

test("builds a paginated supplier search by code or legal name", () => {
  assert.equal(createSupplierCatalogUrl(2, "  HEXING CO.  "),
    "/api/v1/suppliers?page=2&pageSize=25&search=HEXING+CO.");
});

test("omits the search filter when the supplier search is blank", () => {
  assert.equal(createSupplierCatalogUrl(1, "   "), "/api/v1/suppliers?page=1&pageSize=25");
});
