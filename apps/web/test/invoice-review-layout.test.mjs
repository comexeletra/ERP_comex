import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");

test("invoice review uses a fluid, readable table layout", () => {
  assert.match(component, /className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table"/u);
  assert.match(styles, /\.ip-entry-section\s*\{[^}]*max-width:\s*none;[^}]*width:\s*100%/u);
  assert.match(styles, /\.invoice-match-table\s*\{[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;[^}]*width:\s*100%/u);
  assert.match(styles, /\.invoice-match-table-wrap\s*\{\s*max-height:\s*min\(62vh, 720px\);/u);
  assert.match(styles, /\.invoice-match-table td\s*\{[^}]*white-space:\s*normal/u);
});
