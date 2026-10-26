import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG, formatDayOffset, railCenter } from "../lib/e2e-flow.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const component = await readFile(new URL("../components/E2eFlowDemo.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/end-to-end/page.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles/features/e2e.css", import.meta.url), "utf8");
const tokens = await readFile(new URL("../app/styles/tokens.css", import.meta.url), "utf8");

test("formats day offsets relative to the need date", () => {
  assert.equal(formatDayOffset(120), "D-120");
  assert.equal(formatDayOffset(0), "D-0");
  assert.equal(formatDayOffset(-5), "D+5");
});

test("MTS by sea (30 days in the HQ) fits the horizon with slack", () => {
  const flow = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts: true, air: false }, ptBR);
  assert.equal(flow.total, 110);
  assert.equal(flow.slack, 10);
  assert.equal(flow.months, 4);
  assert.equal(flow.phases.length, 6);
  assert.deepEqual(flow.phases.map(phase => phase.code), ["T0", "T1", "T2", "T3", "T4", "T5"]);
  assert.deepEqual(flow.phases.map(phase => phase.side), ["br", "br", "br", "cn", "cn", "cn"]);
  assert.deepEqual(flow.milestones.map(milestone => formatDayOffset(milestone.offset)),
    ["D-120", "D-120", "D-112", "D-105", "D-75", "D-20", "D-10"]);
  assert.equal(flow.milestones[5].label, "Chegada no porto");
  assert.equal(flow.phases[4].icon, "ship");
  assert.equal(flow.phases[4].win, "D-75 → D-20");
  assert.deepEqual(flow.segments.map(segment => segment.label), ["T1 · 8d", "T2", "T3 · 30d", "T4 · 55d", "T5 · 10d"]);
  assert.equal(flow.slackLabel, "Folga · 10d");
  assert.equal(flow.overflowLeft, null);
  assert.deepEqual(flow.ticks.map(tick => tick.label), ["D-120", "D-90", "D-60", "D-30", "D-0 · necessidade"]);
});

test("não MTS by sea (45 days in the HQ) exceeds the horizon and marks the delay on the ruler", () => {
  const flow = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts: false, air: false }, ptBR);
  assert.equal(flow.total, 125);
  assert.equal(flow.slack, -5);
  assert.equal(flow.slackPct, 0);
  assert.equal(flow.slackLabel, "");
  assert.equal(flow.overflowLeft, "96.000%");
  assert.equal(flow.phases[3].owner, "HQ · Não MTS");
  assert.deepEqual(flow.ticks.slice(-2), [
    { label: "D-0", left: "96.000%", transform: "translateX(-50%)", tone: "ink" },
    { label: "D+5", left: "100%", transform: "translateX(-100%)", tone: "late" },
  ]);
  assert.equal(formatDayOffset(flow.milestones[6].offset), "D+5");
});

test("air freight switches the transport phase and milestone labels", () => {
  const flow = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts: true, air: true }, ptBR);
  assert.equal(flow.total, 65);
  assert.equal(flow.slack, 55);
  assert.equal(flow.phases[4].icon, "plane");
  assert.equal(flow.phases[4].name, "Transporte aéreo");
  assert.deepEqual(flow.phases[4].docs, ["AWB", "Tracking", "Aviso de chegada"]);
  assert.equal(flow.milestones[5].label, "Chegada no aeroporto");
});

test("config overrides change the computed deadlines", () => {
  const flow = buildE2eFlow({ ...DEFAULT_E2E_FLOW_CONFIG, horizonte: 90, sc: 5 }, { mts: false, air: true }, ptBR);
  assert.equal(flow.total, 5 + 7 + 45 + 10 + 10);
  assert.equal(flow.slack, 13);
  assert.equal(flow.months, 3);
  assert.equal(flow.phases[0].lt, "D-90");
  assert.equal(flow.phases[1].rule, "PCM · 5 dias para aprovar a Solicitação de Compra.");
});

test("rail centers align with the six-column card grid", () => {
  assert.equal(railCenter(0), "calc(8.3333% + -6.667px)");
  assert.equal(railCenter(5), "calc(91.6667% + 6.667px)");
});

test("end-to-end demo page is routed, listed in the sidebar and follows the app identity", () => {
  assert.match(page, /<E2eFlowDemo \/>/u);
  assert.match(sidebar, /\{ label: "endToEnd", href: "\/end-to-end", icon: "flow" \}/u);
  assert.equal(ptBR.sidebar.items.endToEnd, "End-to-end");
  assert.match(component, /<main className="shell e2e-flow"/u);
  assert.match(component, /<PageHeader eyebrow=\{t\.eyebrow\} title=\{t\.title\}>/u);
  assert.match(ptBR.e2e.eyebrow, /Modelo/u);
  assert.doesNotMatch(component, /next\/font|fonts\.googleapis/u);
  assert.match(styles, /\.e2e-flow\s*\{/u);
  // Colors come only from the global tokens, so the dark theme applies without extra rules.
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/iu);
  assert.match(styles, /--e2e-br: var\(--brand-green\)/u);
  assert.match(tokens, /:root\[data-theme="dark"\]\s*\{/u);
});

test("the flow labels follow the chosen language", () => {
  const flow = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts: false, air: true }, en);
  assert.equal(flow.phases[4].name, "Air freight");
  assert.equal(flow.milestones[5].label, "Arrival at the airport");
  assert.equal(flow.ticks.at(-1).label, "D-0 · need date");
  assert.equal(buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts: true, air: false }, zhCN).phases[3].owner, "HQ · MTS");
});
