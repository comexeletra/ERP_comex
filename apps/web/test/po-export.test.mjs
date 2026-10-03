import assert from "node:assert/strict";
import test from "node:test";
import { purchaseOrdersCsv } from "../lib/po-export.ts";

test("PO export quotes delimiters and prevents spreadsheet formula execution", () => {
  const csv = purchaseOrdersCsv([{
    id: "po-1", number: "=HYPERLINK(\"https://example.test\")",
    importer: "  @SUM(1,2)", identityStatus: "A, B\nC",
    historicalItemCount: 3, linkedProcessCount: 2, historicalItemsWithIp: 1,
    historicalItemsWithoutIp: 2, unresolvedIssueCount: 0,
  }]);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)"/u);
  assert.match(csv, /"'  @SUM\(1,2\)"/u);
  assert.match(csv, /"A, B\nC"/u);
  assert.equal(csv.split("\r\n").length, 3);
});
