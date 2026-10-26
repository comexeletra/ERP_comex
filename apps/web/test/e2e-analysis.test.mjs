import assert from "node:assert/strict";
import test from "node:test";
import { analyzePurchaseOrderE2e, demandTypeKind, e2eDaysBetween } from "../lib/e2e-analysis.ts";
import { DEFAULT_E2E_FLOW_CONFIG } from "../lib/e2e-flow.ts";

const shared = { necessityDate: "2026-12-01", commercialPlanReceivedDate: "2026-08-03",
  scApprovalDate: "2026-08-21", poSentDate: "2026-08-24" };
const followup = {
  items: [
    { id: "i1", productCode: "CHIP", orderedQuantity: "10.00000000", demandType: "MTS", ...shared },
    { id: "i2", productCode: "CAP", orderedQuantity: "100.00000000", demandType: "Não MTS", ...shared },
    { id: "i3", productCode: "RES", orderedQuantity: "50.00000000", demandType: null, ...shared },
    { id: "i4", productCode: "BOLT", orderedQuantity: "20.00000000", demandType: "Não MTS", ...shared },
  ],
  processes: [
    { process: { id: "pa", ipNumber: "A", transportMode: "AIR", etd: "2026-09-29", blDate: "2026-09-29",
      actualPortDepartureDate: "2026-09-30", arrivalDate: "2026-10-09", deliveryDate: "2026-10-17" },
      calculated: { status: "ENTREGUE", eta: "2026-10-09", ete: "2026-10-19" } },
    { process: { id: "pc", ipNumber: "C", transportMode: "SEA", etd: "2026-10-08", blDate: "2026-10-10",
      actualPortDepartureDate: "2026-10-10", arrivalDate: null, deliveryDate: null },
      calculated: { status: "AGUARDANDO CHEGADA", eta: "2026-12-02", ete: "2026-12-12" } },
  ],
  shipments: [
    { itemId: "i1", allocationQuantity: "10.00000000", factoryShipDate: "2026-09-23", process: { id: "pa" } },
    { itemId: "i2", allocationQuantity: "100.00000000", factoryShipDate: "2026-10-08", process: { id: "pc" } },
    { itemId: "i3", allocationQuantity: "30.00000000", factoryShipDate: "2026-10-08", process: { id: "pc" } },
  ],
};
const analysis = analyzePurchaseOrderE2e(followup, DEFAULT_E2E_FLOW_CONFIG, "2026-10-26");
const ip = number => analysis.ips.find(entry => entry.ipNumber === number);

test("days and demand types are read from the API values", () => {
  assert.equal(e2eDaysBetween("2026-08-03", "2026-12-01"), 120);
  assert.equal(e2eDaysBetween("2026-10-17T00:00:00.000Z", "2026-12-01"), 45);
  assert.equal(e2eDaysBetween(null, "2026-12-01"), null);
  assert.equal(demandTypeKind("MTS"), "mts");
  assert.equal(demandTypeKind(" não mts "), "notMts");
  assert.equal(demandTypeKind("NAO MTS"), "notMts");
  assert.equal(demandTypeKind("Commercial Plan"), "unknown");
  assert.equal(demandTypeKind(null), "unknown");
});

test("the plan runs forward from D-120 with the HQ time of the IP's demand type and mode", () => {
  assert.equal(analysis.necessityDate, "2026-12-01");
  const air = ip("A");
  assert.equal(air.demandType, "mts");
  assert.equal(air.air, true);
  assert.deepEqual(Object.fromEntries(Object.entries(air.milestones).map(([key, point]) => [key, point.planned])), {
    plan: "2026-08-03", sc: "2026-08-11", po: "2026-08-18", shipment: "2026-09-17", arrival: "2026-09-27", delivery: "2026-10-07",
  });
  // Não MTS by sea is already 5 days past the need date in the plan itself.
  const sea = ip("C");
  assert.equal(sea.demandType, "notMts");
  assert.equal(sea.missingDemandType, 1);
  assert.equal(sea.milestones.shipment.planned, "2026-10-02");
  assert.equal(sea.milestones.delivery.planned, "2026-12-06");
  assert.equal(sea.plannedSlack, -5);
});

test("actual dates win over forecasts and every stage shows its deviation", () => {
  const air = ip("A");
  assert.deepEqual(air.milestones.shipment, { planned: "2026-09-17", date: "2026-09-30", source: "actual", deviation: 13 });
  assert.deepEqual(air.milestones.delivery, { planned: "2026-10-07", date: "2026-10-17", source: "actual", deviation: 10 });
  assert.deepEqual(air.stages.map(stage => [stage.code, stage.planned, stage.actual, stage.deviation, stage.source]), [
    ["T1", 8, 18, 10, "actual"], ["T2", 7, 3, -4, "actual"], ["T3", 30, 37, 7, "actual"],
    ["T4", 10, 9, -1, "actual"], ["T5", 10, 8, -2, "actual"],
  ]);
  assert.equal(air.slack, 45);
  assert.equal(air.late, false);
  assert.equal(air.currentStage, null);

  const sea = ip("C");
  assert.deepEqual(sea.milestones.arrival, { planned: "2026-11-26", date: "2026-12-02", source: "forecast", deviation: 6 });
  assert.deepEqual(sea.milestones.delivery, { planned: "2026-12-06", date: "2026-12-12", source: "forecast", deviation: 6 });
  assert.deepEqual(sea.stages.slice(2).map(stage => [stage.code, stage.actual, stage.deviation, stage.source]), [
    ["T3", 47, 2, "actual"], ["T4", 53, -2, "forecast"], ["T5", 10, 0, "forecast"],
  ]);
  assert.equal(sea.slack, -11);
  assert.equal(sea.late, true);
  assert.equal(sea.currentStage, "T4");
  assert.equal(sea.lines, 2);
});

test("the summary counts lines against the need date and finds the worst IP and stage", () => {
  assert.deepEqual(analysis.summary, {
    lines: 3, onTimeLines: 1, lateLines: 2, unallocatedItems: 2, deliveredIps: 1, ips: 2,
    worstIp: "C", worstSlack: -11, leadTime: 131,
    stageDeviation: { T1: 10, T2: -4, T3: 4.5, T4: -1.5, T5: -1 }, worstStage: "T1",
  });
});

test("the timeline spans the plan to the last date and places bars as percentages", () => {
  assert.equal(analysis.timeline.start, "2026-08-03");
  assert.equal(analysis.timeline.end, "2026-12-12");
  assert.equal(analysis.timeline.position("2026-08-03"), 0);
  assert.equal(analysis.timeline.position("2026-12-12"), 100);
  assert.equal(analysis.timeline.today, "2026-10-26");
  const bars = ip("A").bars;
  assert.deepEqual(bars.map(bar => [bar.code, bar.source]), [["T1", "actual"], ["T2", "actual"], ["T3", "actual"], ["T4", "actual"], ["T5", "actual"]]);
  assert.equal(bars[0].left, 0);
  assert.ok(Math.abs(bars[0].width - 18 / 131 * 100) < 1e-9);
});

test("a PO without IPs or dates yields an empty analysis instead of failing", () => {
  const empty = analyzePurchaseOrderE2e({ items: [{ id: "x", productCode: "P", orderedQuantity: "1" }], processes: [], shipments: [] },
    DEFAULT_E2E_FLOW_CONFIG, "2026-10-26");
  assert.equal(empty.necessityDate, null);
  assert.deepEqual(empty.ips, []);
  assert.equal(empty.summary.unallocatedItems, 1);
  assert.equal(empty.summary.worstIp, null);
  assert.equal(empty.timeline.start, null);
});

test("the end-to-end screen opens a PO analysis and the PO links to it", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [page, demo, picker, view, workspace] = await Promise.all([read("app/end-to-end/page.tsx"),
    read("components/E2eFlowDemo.tsx"), read("components/E2ePoPicker.tsx"), read("components/E2ePoAnalysis.tsx"),
    read("components/PurchaseOrderWorkspace.tsx")]);
  assert.match(page, /typeof po === "string" && po \? <E2ePoAnalysis id=\{po\} \/> : <E2eFlowDemo \/>/u);
  assert.match(demo, /<E2ePoPicker \/>/u);
  assert.match(picker, /\/api\/v1\/purchase-orders\?\$\{params\}/u);
  assert.match(picker, /href=\{`\/end-to-end\?po=\$\{encodeURIComponent\(order\.id\)\}`\}/u);
  // The analysis reads the same follow-up route as the PO screen (listed in the API web-route contract).
  assert.match(view, /\/api\/v1\/purchase-orders\/\$\{encodeURIComponent\(id\)\}\/followup/u);
  assert.match(view, /analyzePurchaseOrderE2e\(data, DEFAULT_E2E_FLOW_CONFIG, e2eToday\(\)\)/u);
  assert.match(workspace, /href=\{`\/end-to-end\?po=\$\{encodeURIComponent\(id\)\}`\}>\{t\.openE2e\}/u);
});

test("dates follow the reader's language and today is taken in Brasília", async () => {
  const { formatE2eDate, e2eToday } = await import("../lib/e2e-analysis.ts");
  assert.equal(formatE2eDate("2026-12-01", "pt-BR"), "01/12/26");
  assert.equal(formatE2eDate(null, "pt-BR"), "—");
  assert.equal(e2eToday(new Date("2026-10-27T02:30:00Z")), "2026-10-26");
});
