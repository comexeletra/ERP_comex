import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { analyzePurchaseOrderE2e, e2eDaysBetween, e2eToday, formatE2eDate } from "../lib/e2e-analysis.ts";

const stage = (deadline, actual, source, targetDays, actualDays, delayDays) =>
  ({ deadline, actual, source, targetDays, actualDays, delayDays });
const shared = { T0: stage("2026-08-01", "2026-08-03", "actual", 8, 2, -6), T1: stage("2026-08-11", "2026-08-21", "actual", 8, 18, 10),
  T2: stage("2026-08-28", "2026-08-24", "actual", 7, 3, -4) };
const e2e = (stages, demandType, air, totals) => ({ targetSetValidFrom: "2000-01-01", demandType, air, stages: { ...shared, ...stages },
  totalTargetDays: totals[0], totalActualDays: totals[1], totalDelayDays: totals[1] - totals[0], bottleneck: "T1",
  currentStatus: "", arrivalYearMonth: stages.T4.actual.slice(0, 7) });
// IP A: MTS by air, delivered. IP C: two lines by sea still in transit (one MTS, one Não MTS).
const airDelivered = e2e({ T3: stage("2026-09-23", "2026-09-26", "actual", 30, 33, 3), T4: stage("2026-10-06", "2026-10-05", "actual", 10, 9, -1),
  T5: stage("2026-10-15", "2026-10-14", "actual", 10, 9, -1) }, "mts", true, [73, 74]);
const seaMts = e2e({ T3: stage("2026-09-23", "2026-10-11", "actual", 30, 48, 18), T4: stage("2026-12-05", "2026-12-02", "forecast", 55, 52, -3),
  T5: stage("2026-12-12", "2026-12-12", "forecast", 10, 10, 0) }, "mts", false, [118, 133]);
const seaNotMts = e2e({ T3: stage("2026-10-08", "2026-10-11", "actual", 45, 48, 3), T4: stage("2026-12-05", "2026-12-02", "forecast", 55, 52, -3),
  T5: stage("2026-12-12", "2026-12-12", "forecast", 10, 10, 0) }, "notMts", false, [133, 133]);
const followup = {
  items: [
    { id: "i1", orderedQuantity: "10", necessityDate: "2026-12-01" }, { id: "i2", orderedQuantity: "100", necessityDate: "2026-12-01" },
    { id: "i3", orderedQuantity: "50", necessityDate: "2026-12-01" }, { id: "i4", orderedQuantity: "20", necessityDate: "2026-12-01" },
  ],
  processes: [
    { process: { id: "pa", ipNumber: "A" }, calculated: { status: "ENTREGUE" } },
    { process: { id: "pc", ipNumber: "C" }, calculated: { status: "AGUARDANDO CHEGADA" } },
    { process: { id: "pe", ipNumber: "EMPTY" }, calculated: { status: "AGUARDANDO PRODUÇÃO" } },
  ],
  shipments: [
    { itemId: "i1", allocationQuantity: "10", process: { id: "pa" }, calculated: { e2e: airDelivered } },
    { itemId: "i2", allocationQuantity: "100", process: { id: "pc" }, calculated: { e2e: seaMts } },
    { itemId: "i3", allocationQuantity: "30", process: { id: "pc" }, calculated: { e2e: seaNotMts } },
  ],
};
const analysis = analyzePurchaseOrderE2e(followup, "2026-10-26");
const ip = number => analysis.ips.find(entry => entry.ipNumber === number);

test("days and dates are read from the API values", () => {
  assert.equal(e2eDaysBetween("2026-08-03", "2026-12-01"), 120);
  assert.equal(e2eDaysBetween("2026-10-17T00:00:00.000Z", "2026-12-01"), 45);
  assert.equal(e2eDaysBetween(null, "2026-12-01"), null);
  assert.equal(formatE2eDate("2026-12-01", "pt-BR"), "01/12/26");
  assert.equal(formatE2eDate(null, "pt-BR"), "—");
  assert.equal(e2eToday(new Date("2026-10-27T02:30:00Z")), "2026-10-26");
});

test("each IP is represented by the line that reaches the factory last and keeps the worst slack", () => {
  assert.deepEqual(analysis.ips.map(entry => entry.ipNumber), ["A", "C"]);
  assert.deepEqual([ip("A").slack, ip("A").late, ip("A").currentStage, ip("A").lines], [48, false, null, 1]);
  const sea = ip("C");
  assert.deepEqual([sea.slack, sea.late, sea.currentStage, sea.lines, sea.demandType, sea.air], [-11, true, "T4", 2, "mts", false]);
  assert.equal(sea.e2e, seaMts, "ties on the arrival date go to the larger total delay");
  assert.deepEqual(sea.stages.map(entry => [entry.code, entry.targetDays, entry.delayDays]), [
    ["T0", 8, -6], ["T1", 8, 10], ["T2", 7, -4], ["T3", 30, 10.5], ["T4", 55, -3], ["T5", 10, 0]]);
});

test("the summary counts lines against their need date and finds the worst IP and stage", () => {
  assert.deepEqual(analysis.summary, {
    lines: 3, onTimeLines: 1, lateLines: 2, unallocatedItems: 2, deliveredIps: 1, ips: 2,
    worstIp: "C", worstSlack: -11, leadTime: 131,
    stageDeviation: { T0: -6, T1: 10, T2: -4, T3: 8, T4: -7 / 3, T5: -1 / 3 }, worstStage: "T1",
  });
});

test("the timeline spans T0 to the last date and draws the actual and planned bars", () => {
  assert.equal(analysis.timeline.start, "2026-08-01");
  assert.equal(analysis.timeline.end, "2026-12-12");
  assert.equal(analysis.timeline.position("2026-12-12"), 100);
  const air = ip("A");
  assert.deepEqual(air.bars.map(bar => [bar.code, bar.source]), [["T1", "actual"], ["T2", "actual"], ["T3", "actual"], ["T4", "actual"], ["T5", "actual"]]);
  assert.ok(Math.abs(air.bars[0].left - 2 / 133 * 100) < 1e-9);
  assert.ok(Math.abs(air.bars[0].width - 18 / 133 * 100) < 1e-9);
  // Planned: T0 deadline plus the total target of the line.
  assert.ok(Math.abs(air.plannedBar.width - 73 / 133 * 100) < 1e-9);
  assert.deepEqual(ip("C").bars.slice(-2).map(bar => [bar.code, bar.source]), [["T4", "forecast"], ["T5", "forecast"]]);
});

test("a PO without lines yields an empty analysis instead of failing", () => {
  const empty = analyzePurchaseOrderE2e({ items: [{ id: "x", orderedQuantity: "1" }], processes: [], shipments: [] }, "2026-10-26");
  assert.equal(empty.necessityDate, null);
  assert.deepEqual(empty.ips, []);
  assert.equal(empty.summary.unallocatedItems, 1);
  assert.equal(empty.summary.worstIp, null);
  assert.equal(empty.timeline.start, null);
});

test("the end-to-end screens are routed under /end-to-end and the PO links to its analysis", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [lines, po, model, targets, view, picker, workspace] = await Promise.all([read("app/end-to-end/page.tsx"),
    read("app/end-to-end/po/page.tsx"), read("app/end-to-end/model/page.tsx"), read("app/end-to-end/targets/page.tsx"),
    read("components/E2ePoAnalysis.tsx"), read("components/E2ePoPicker.tsx"), read("components/PurchaseOrderWorkspace.tsx")]);
  assert.match(lines, /<E2eLinesView initialQuery=\{query\.toString\(\)\} \/>/u);
  assert.match(po, /typeof id === "string" && id \? <E2ePoAnalysis id=\{id\} \/> : <E2ePoPicker \/>/u);
  assert.match(model, /<E2eFlowDemo \/>/u);
  assert.match(targets, /<E2eTargetsView \/>/u);
  assert.match(picker, /href=\{`\/end-to-end\/po\?id=\$\{encodeURIComponent\(order\.id\)\}`\}/u);
  // The analysis reads the same follow-up route as the PO screen (listed in the API web-route contract).
  assert.match(view, /\/api\/v1\/purchase-orders\/\$\{encodeURIComponent\(id\)\}\/followup/u);
  assert.match(view, /analyzePurchaseOrderE2e\(data, e2eToday\(\)\)/u);
  assert.match(workspace, /href=\{`\/end-to-end\/po\?id=\$\{encodeURIComponent\(id\)\}`\}>\{t\.openE2e\}/u);
});
