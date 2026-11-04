import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { effectiveSelection, multiSelectLabel, multiSelectLimit, selectAllState, toggleValue, toggleVisible } from "../lib/multi-select.ts";

const component = await readFile(new URL("../components/MultiSelectFilter.tsx", import.meta.url), "utf8");
const options = [{ value: "A", label: "Amostra" }, { value: "D", label: "Despesa" }, { value: "R", label: "Revenda" }];

test("a value is checked and unchecked, keeping the others", () => {
  assert.deepEqual(toggleValue([], "D"), ["D"]);
  assert.deepEqual(toggleValue(["D"], "A"), ["D", "A"]);
  assert.deepEqual(toggleValue(["D", "A"], "D"), ["A"]);
});

test("select all is checked, mixed or unchecked for the visible values, as in Power BI", () => {
  assert.equal(selectAllState([], ["A", "D", "R"]), "unchecked");
  assert.equal(selectAllState(["D"], ["A", "D", "R"]), "mixed");
  assert.equal(selectAllState(["A", "D", "R"], ["A", "D", "R"]), "checked");
  // With a search, only the visible results count.
  assert.equal(selectAllState(["D"], ["D"]), "checked");
  assert.equal(selectAllState(["D"], []), "unchecked");
});

test("select all checks the visible values, or unchecks them when they are all checked", () => {
  assert.deepEqual(toggleVisible([], ["A", "D", "R"]), ["A", "D", "R"]);
  assert.deepEqual(toggleVisible(["D"], ["A", "D", "R"]), ["D", "A", "R"]);
  assert.deepEqual(toggleVisible(["A", "D", "R"], ["A", "D", "R"]), []);
  // With a search it keeps the values outside the results.
  assert.deepEqual(toggleVisible(["R"], ["A", "D"]), ["R", "A", "D"]);
  assert.deepEqual(toggleVisible(["R", "A", "D"], ["A", "D"]), ["R"]);
});

test("every value checked is the same as none: no filter, and a short URL", () => {
  assert.deepEqual(effectiveSelection(["R", "A", "D"], ["A", "D", "R"]), []);
  assert.deepEqual(effectiveSelection(["D"], ["A", "D", "R"]), ["D"]);
  assert.deepEqual(effectiveSelection([], ["A", "D", "R"]), []);
  // Without the options (not loaded yet) the choice is kept.
  assert.deepEqual(effectiveSelection(["D"], []), ["D"]);
  assert.equal(multiSelectLimit, 500);
});

test("the closed field shows all, the only value chosen or how many were chosen", () => {
  assert.equal(multiSelectLabel([], options, "Todas", ptBR), "Todas");
  assert.equal(multiSelectLabel(["D"], options, "Todas", ptBR), "Despesa");
  // A value from a link that is not in the options shows as it is.
  assert.equal(multiSelectLabel(["X"], options, "Todas", ptBR), "X");
  assert.equal(multiSelectLabel(["A", "D"], options, "Todas", ptBR), "2 selecionados");
  assert.equal(multiSelectLabel(["A", "D"], options, "All", en), "2 selected");
  assert.equal(multiSelectLabel(["A", "D"], options, "全部", zhCN), "已选 2 项");
});

test("the filter has a search, select all, a checkbox per value and its texts in every language", () => {
  assert.match(component, /aria-haspopup="dialog"/u);
  assert.match(component, /className="searchable-select-search"/u);
  assert.match(component, /type="checkbox"/u);
  // The mixed state of select all is the native indeterminate checkbox.
  assert.match(component, /\.indeterminate = allState === "mixed"/u);
  assert.match(component, /toggleVisible\(values, visibleValues\)/u);
  assert.match(component, /createPortal\(/u);
  assert.match(component, /event\.key === "Escape"/u);
  assert.doesNotMatch(component, /\stitle=/u);
  for (const messages of [ptBR, en, zhCN]) {
    assert.equal(typeof messages.select.selectAll, "string");
    assert.equal(typeof messages.select.selectedCount(3), "string");
    assert.match(messages.select.limit(500), /500/u);
  }
  assert.equal(ptBR.select.selectAll, "Selecionar tudo");
});
