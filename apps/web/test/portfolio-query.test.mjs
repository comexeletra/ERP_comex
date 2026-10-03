import assert from "node:assert/strict";
import test from "node:test";
import { portfolioFilterQuery, purchaseOrderListQuery } from "../lib/portfolio-query.ts";

const filters = { number: " 18751 ", importer: " eletra matriz ", product: " motor ", ipNumber: " NH-017/2025 " };

test("portfolio summary filters match the list filters and omit blank values", () => {
  const summary = portfolioFilterQuery({ ...filters, product: "   " });
  const list = purchaseOrderListQuery({ ...filters, product: "   " }, 3, 50);

  assert.deepEqual([...summary.entries()], [
    ["number", "18751"],
    ["importer", "eletra matriz"],
    ["ipNumber", "NH-017/2025"],
  ]);
  assert.deepEqual([...list.entries()].slice(0, -2), [...summary.entries()]);
  assert.deepEqual([...list.entries()].slice(-2), [["page", "3"], ["pageSize", "50"]]);
});

test("portfolio query encoding preserves slash-containing IP identifiers", () => {
  const query = portfolioFilterQuery({ number: "", importer: "", product: "", ipNumber: filters.ipNumber });
  assert.equal(query.toString(), "ipNumber=NH-017%2F2025");
});
