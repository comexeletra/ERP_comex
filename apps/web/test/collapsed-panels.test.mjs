import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readCollapsed, writeCollapsed } from "../lib/collapsed-panels.ts";

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

test("a panel opens expanded and remembers when it is collapsed", () => {
  const storage = memoryStorage();
  assert.equal(readCollapsed(storage, "panel-a"), false);
  writeCollapsed(storage, "panel-a", true);
  assert.equal(storage.getItem("panel-a"), "true");
  assert.equal(readCollapsed(storage, "panel-a"), true);
  writeCollapsed(storage, "panel-a", false);
  assert.equal(readCollapsed(storage, "panel-a"), false);
});

test("a blocked browser storage still lets the panel toggle in this page", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readCollapsed(blocked, "panel-b"), false);
  writeCollapsed(blocked, "panel-b", true);
  assert.equal(readCollapsed(blocked, "panel-b"), true);
  assert.equal(readCollapsed(null, "panel-c"), false);
});

test("the collapsible panel reads the choice without a hydration mismatch", async () => {
  const source = await readFile(new URL("../components/E2eCollapsible.tsx", import.meta.url), "utf8");
  // The server and the first client render are expanded; the stored choice comes from an external store.
  assert.match(source, /useSyncExternalStore\(subscribe, \(\) => readCollapsed\(browserStorage\(\), storageKey\), \(\) => false\)/u);
  assert.match(source, /aria-expanded=\{!collapsed\}/u);
  assert.match(source, /aria-controls=\{bodyId\}/u);
  assert.match(source, /hidden=\{collapsed\}/u);
  assert.doesNotMatch(source, /useEffect/u);
});
