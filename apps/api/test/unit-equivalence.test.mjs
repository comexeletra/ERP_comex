import assert from "node:assert/strict";
import test from "node:test";
import { equivalentUnitGroups, normalizeUnit, unitsDiffer } from "../dist/unit-equivalence.js";
// The web mirror is plain TypeScript data; Node 24 strips the types on import.
import { equivalentUnitGroups as webGroups } from "../../web/lib/china-invoice-mapping.ts";

test("units of the same measure are equivalent after normalization", () => {
  assert.equal(normalizeUnit(" Pç. "), "PC");
  assert.equal(normalizeUnit("u.n."), "UN");
  for (const [left, right] of [["PCS", "UN"], ["PC", "UN"], ["PEÇA", "UNIDADE"], ["EA", "PCS"], ["KGS", "KG"],
    ["MTS", "M"], ["MT", "M"], ["box", "BOX"]]) {
    assert.equal(unitsDiffer(left, right), false, `${left} × ${right}`);
  }
  for (const [left, right] of [["PCS", "KG"], ["KG", "M"], ["BOX", "PCS"], ["SET", "UN"]]) {
    assert.equal(unitsDiffer(left, right), true, `${left} × ${right}`);
  }
});

test("each unit belongs to one group and the groups are kept already normalized", () => {
  const all = equivalentUnitGroups.flat();
  assert.equal(new Set(all).size, all.length);
  for (const unit of all) assert.equal(normalizeUnit(unit), unit);
});

test("the web mirror keeps the same unit groups as the API", () => {
  assert.deepEqual(webGroups.map(group => [...group]), equivalentUnitGroups.map(group => [...group]));
});
