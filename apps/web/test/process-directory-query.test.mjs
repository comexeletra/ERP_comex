import assert from "node:assert/strict";
import test from "node:test";
import { emptyProcessDirectoryFilters, parseProcessDirectoryFilters, processDirectoryQuery } from "../lib/ip-lifecycle.ts";

test("process directory URL keeps the lifecycle filter with other filters and pagination", () => {
  const query = processDirectoryQuery({ ...emptyProcessDirectoryFilters,
    ipNumber: "IP/2026", importer: "ELETRA MATRIZ", recordStatus: "deleted" }, 2);
  assert.equal(query.get("recordStatus"), "deleted");
  assert.equal(query.get("ipNumber"), "IP/2026");
  assert.equal(query.get("importer"), "ELETRA MATRIZ");
  assert.equal(query.get("page"), "2");
});

test("process directory restores supported URL states and ignores invalid lifecycle values", () => {
  assert.equal(parseProcessDirectoryFilters(new URLSearchParams("recordStatus=all")).recordStatus, "all");
  assert.equal(parseProcessDirectoryFilters(new URLSearchParams("recordStatus=unknown")).recordStatus, "");
  assert.equal(processDirectoryQuery(emptyProcessDirectoryFilters, 1).has("recordStatus"), false);
});
