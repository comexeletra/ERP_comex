import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const view = await readFile(new URL("../components/E2eLinesView.tsx", import.meta.url), "utf8");
const demo = await readFile(new URL("../components/E2eFlowDemo.tsx", import.meta.url), "utf8");
const parts = await readFile(new URL("../components/E2eFlowParts.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/end-to-end/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles/features/e2e.css", import.meta.url), "utf8");

test("the first End to End screen shows the animated stages above the product lines", () => {
  assert.match(page, /<E2eLinesView initialQuery=\{query\.toString\(\)\} \/>/u);
  assert.match(view, /<E2eFlowRail phases=\{stagePhases\} current=\{current\} \/>/u);
  assert.match(view, /useE2eStepper\(E2E_STAGE_CODES\.length, DEFAULT_E2E_FLOW_CONFIG\.intervaloMs, false,/u);
  // The model keeps its own animation and shares the icons, the rail and the stepper.
  assert.match(demo, /import \{ Arrow, E2eFlowRail, Icon, useE2eStepper \} from "\.\/E2eFlowParts";/u);
  assert.doesNotMatch(demo, /const icons/u);
  assert.match(parts, /export function useE2eStepper/u);
});

test("the lines follow the selected stage, view and late filter on the API routes", () => {
  // Contract with GET /api/v1/purchase-order-lines (stage, view, late) and its stage summary.
  assert.match(view, /apiFetch\(`\/api\/v1\/purchase-order-lines\?\$\{query\}`/u);
  assert.match(view, /productLineQuery\(applied, page, pageSize, stage\)/u);
  assert.match(view, /apiFetch\(`\/api\/v1\/purchase-order-lines\/e2e-stages\?\$\{summaryQuery\}`/u);
  assert.match(view, /new URLSearchParams\(productLineFilterBody\(applied\)\)/u);
  assert.match(view, /const stage: E2eStageFilter = \{ stage: current === null \? "" : E2E_STAGE_CODES\[current\], view, late \};/u);
  // The export downloads what the table shows.
  assert.match(view, /downloadExcel\(applied, stage\)/u);
  // Loaded stages are kept, so the animation does not reload them on every pass.
  assert.match(view, /if \(cached\) return undefined;/u);
  // The accumulated view shows the delay accumulated up to the selected stage.
  assert.match(view, /e2e\?\.stages\[accumulatedStage\]\.accumulatedDelayDays/u);
});

test("the stage cards, the selected columns and the texts exist in every language", () => {
  for (const rule of [".e2e-phase.e2e-stage-card", ".e2e-lines-table .is-selected", ".e2e-lines-table .e2e-stage-head.is-selected"]) {
    assert.ok(styles.includes(`${rule} {`), rule);
  }
  assert.equal(ptBR.e2eLines.flow.viewCurrent, "Na etapa");
  assert.equal(ptBR.e2eLines.flow.viewReached, "Acumulada");
  assert.equal(ptBR.e2eLines.flow.lateOnly, "Só atrasados");
  for (const messages of [ptBR, en, zhCN]) {
    assert.match(messages.e2eLines.flow.inStage(3), /3/u);
    assert.match(messages.e2eLines.flow.accumulated("T3"), /T3/u);
  }
  assert.equal(ptBR.e2eLines.flow.inStage(1), "1 produto na etapa");
  assert.equal(ptBR.e2eLines.flow.late(2), "2 atrasados");
});
