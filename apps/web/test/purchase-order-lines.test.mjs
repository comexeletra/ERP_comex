import assert from "node:assert/strict";
import test from "node:test";
import { activeProductLineFilterCount, e2eDeadlineStatuses, e2eDelayRanges, e2eStageCodes, e2eStageFilterBody, e2eSummaryQuery, emptyE2eStageFilter,
  emptyProductLineFilters, itemShipmentSummary, parseE2eStageFilter, parseProductLineFilters, productLineFilterBody,
  productLineQuery } from "../lib/purchase-order-lines.ts";

test("product line filters round-trip through the URL and ignore invalid values", () => {
  const filters = parseProductLineFilters(new URLSearchParams(
    "ipNumber=IP-1&status=AGUARDANDO%20CHEGADA&etaFrom=2026-10-01&etaTo=31/10/2026&situation=all"));
  assert.equal(filters.ipNumber, "IP-1");
  assert.equal(filters.status, "AGUARDANDO CHEGADA");
  assert.equal(filters.etaFrom, "2026-10-01");
  assert.equal(filters.etaTo, "");
  assert.equal(filters.situation, "all");
  assert.equal(parseProductLineFilters(new URLSearchParams("status=WAITING")).status, "");
  assert.equal(parseProductLineFilters(new URLSearchParams("")).situation, "open");
  const query = productLineQuery(filters, 2, 50);
  assert.equal(query.get("status"), "AGUARDANDO CHEGADA");
  assert.equal(query.get("page"), "2");
  assert.equal(query.has("etaTo"), false);
  assert.deepEqual(productLineFilterBody(emptyProductLineFilters), { situation: "open" });
});

test("an item split across IPs shows how much is in each status and what is left to distribute", () => {
  const summary = itemShipmentSummary("100.00000000", false, [
    { quantity: "60.00000000", status: "ENTREGUE", eta: "2026-09-01" },
    { quantity: "25.5", status: "AGUARDANDO CHEGADA", eta: "2026-11-10" },
    { quantity: "4.5", status: "AGUARDANDO EMBARQUE", eta: "2026-10-30" },
  ]);
  assert.equal(summary.toDistribute, "10");
  assert.deepEqual(summary.byStatus, [
    { status: "AGUARDANDO EMBARQUE", quantity: "4.5" }, { status: "AGUARDANDO CHEGADA", quantity: "25.5" },
    { status: "ENTREGUE", quantity: "60" },
  ]);
  assert.equal(summary.nextEta, "2026-10-30");
  assert.equal(itemShipmentSummary("10", true, []).toDistribute, "0");
  assert.equal(itemShipmentSummary("10", false, []).nextEta, null);
});

test("the End to End stage filter round-trips through the URL and joins the line filters", () => {
  const filter = parseE2eStageFilter(new URLSearchParams("stage=T3&view=reached&late=true&ipNumber=IP-1"));
  assert.deepEqual(filter, { stage: "T3", view: "reached", late: true, deadline: "", delayRange: "", demandType: "", modal: "" });
  assert.deepEqual(parseE2eStageFilter(new URLSearchParams("stage=T9&view=all&late=1")), emptyE2eStageFilter);
  assert.deepEqual(emptyE2eStageFilter, { stage: "", view: "current", late: false, deadline: "", delayRange: "", demandType: "", modal: "" });
  assert.deepEqual(e2eStageFilterBody(filter), { stage: "T3", view: "reached", late: "true" });
  // The default view is not sent, so the API default applies.
  assert.deepEqual(e2eStageFilterBody({ stage: "T0", view: "current", late: false, deadline: "", delayRange: "", demandType: "", modal: "" }), { stage: "T0" });
  assert.deepEqual(e2eStageFilterBody(emptyE2eStageFilter), {});
  const query = productLineQuery(emptyProductLineFilters, 1, 50, filter);
  assert.deepEqual([query.get("stage"), query.get("view"), query.get("late"), query.get("situation")], ["T3", "reached", "true", "open"]);
  assert.deepEqual(productLineFilterBody(emptyProductLineFilters, { stage: "T5", view: "current", late: true, deadline: "", delayRange: "", demandType: "", modal: "" }),
    { situation: "open", stage: "T5", late: "true" });
  assert.deepEqual([...e2eStageCodes], ["T0", "T1", "T2", "T3", "T4", "T5"]);
});

test("the End to End deadline filter goes to the lines, the export and the summary", () => {
  assert.deepEqual([...e2eDeadlineStatuses], ["onTime", "onLimit", "late", "noData"]);
  const filter = parseE2eStageFilter(new URLSearchParams("stage=T4&late=true&deadline=late"));
  assert.equal(filter.deadline, "late");
  assert.equal(parseE2eStageFilter(new URLSearchParams("deadline=atrasado")).deadline, "");
  assert.deepEqual(e2eStageFilterBody(filter), { stage: "T4", late: "true", deadline: "late" });
  assert.equal(productLineQuery(emptyProductLineFilters, 1, 50, filter).get("deadline"), "late");
  // The summary takes the same filters as the table, without the page.
  const filters = { ...emptyProductLineFilters, status: "AGUARDANDO CHEGADA", ipNumber: " IP-1 " };
  assert.deepEqual(Object.fromEntries(e2eSummaryQuery(filters, { ...emptyE2eStageFilter, deadline: "noData" })),
    { situation: "open", ipNumber: "IP-1", status: "AGUARDANDO CHEGADA", deadline: "noData" });
  assert.deepEqual(Object.fromEntries(e2eSummaryQuery(emptyProductLineFilters, emptyE2eStageFilter)), { situation: "open" });
  // The product line filters shared with the Linhas de produto screen do not change.
  assert.equal("deadline" in emptyProductLineFilters, false);
});

test("the collapsed filter bar counts the filters that change the table", () => {
  assert.equal(activeProductLineFilterCount(emptyProductLineFilters), 0);
  assert.equal(activeProductLineFilterCount({ ...emptyProductLineFilters, ipNumber: "  " }), 0);
  assert.equal(activeProductLineFilterCount({ ...emptyProductLineFilters, ipNumber: "IP-1", status: "ENTREGUE",
    etaFrom: "2026-10-01", situation: "all" }), 4);
});

test("the End to End delay range filter goes to the lines, the export and the summary", () => {
  assert.deepEqual([...e2eDelayRanges], ["inAdvance", "onTime", "upTo30", "days30To45", "days45To60", "days60To90",
    "days90To120", "days120Plus", "noData"]);
  const filter = parseE2eStageFilter(new URLSearchParams("deadline=late&delayRange=days30To45"));
  assert.equal(filter.delayRange, "days30To45");
  assert.equal(parseE2eStageFilter(new URLSearchParams("delayRange=30-45")).delayRange, "");
  assert.deepEqual(e2eStageFilterBody(filter), { deadline: "late", delayRange: "days30To45" });
  assert.equal(productLineQuery(emptyProductLineFilters, 1, 50, filter).get("delayRange"), "days30To45");
  assert.deepEqual(Object.fromEntries(e2eSummaryQuery(emptyProductLineFilters,
    { ...emptyE2eStageFilter, deadline: "late", delayRange: "upTo30" })),
    { situation: "open", deadline: "late", delayRange: "upTo30" });
  assert.deepEqual(Object.fromEntries(e2eSummaryQuery(emptyProductLineFilters, { ...emptyE2eStageFilter, delayRange: "noData" })),
    { situation: "open", delayRange: "noData" });
});

test("the End to End scenario filters the lines and the summary takes the same filters as the table", () => {
  const filter = parseE2eStageFilter(new URLSearchParams("demandType=mts&modal=air&stage=T4&late=true"));
  assert.deepEqual([filter.demandType, filter.modal], ["mts", "air"]);
  const invalid = parseE2eStageFilter(new URLSearchParams("demandType=MTS&modal=road"));
  assert.deepEqual([invalid.demandType, invalid.modal], ["", ""]);
  assert.deepEqual(e2eStageFilterBody(filter), { stage: "T4", late: "true", demandType: "mts", modal: "air" });
  const summary = e2eSummaryQuery(emptyProductLineFilters, filter);
  assert.deepEqual(Object.fromEntries(summary), { situation: "open", stage: "T4", late: "true", demandType: "mts", modal: "air" });
  assert.equal(summary.has("page"), false);
});
