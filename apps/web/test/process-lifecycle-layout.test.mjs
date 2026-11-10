import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../components/ProcessWorkspace.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles/features/analysis.css", import.meta.url), "utf8");

// User request (2026-11-10): the reason was a small box beside its label, above the buttons.
test("the IP cycle shows the actions first and then a wide reason box with its label above", () => {
  const cycle = workspace.slice(workspace.indexOf("<h2>{t.cycleTitle}</h2>"), workspace.indexOf("<h2>{t.operationalTitle}</h2>"));
  const buttons = cycle.indexOf('<div className="process-action-buttons">');
  const reason = cycle.indexOf('<label className="process-lifecycle-reason"><span>{t.actionReason}</span><textarea');
  const hint = cycle.indexOf("{t.reasonHint}");
  assert.ok(buttons > 0 && reason > buttons, "reason after the buttons");
  assert.ok(hint > reason, "hint right after the reason");
  assert.match(styles, /\.process-lifecycle-reason \{[^}]*display: grid;[^}]*\}/u);
  assert.match(styles, /\.process-lifecycle-reason textarea \{[^}]*min-height: 92px;[^}]*width: 100%;[^}]*\}/u);
});
