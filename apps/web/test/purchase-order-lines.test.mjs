import assert from "node:assert/strict";
import test from "node:test";
import { e2eStageCodes, e2eStageFilterBody, emptyE2eStageFilter, emptyProductLineFilters, itemShipmentSummary,
  parseE2eStageFilter, parseProductLineFilters, productLineFilterBody,
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
  assert.deepEqual(filter, { stage: "T3", view: "reached", late: true });
  assert.deepEqual(parseE2eStageFilter(new URLSearchParams("stage=T9&view=all&late=1")), emptyE2eStageFilter);
  assert.deepEqual(emptyE2eStageFilter, { stage: "", view: "current", late: false });
  assert.deepEqual(e2eStageFilterBody(filter), { stage: "T3", view: "reached", late: "true" });
  // The default view is not sent, so the API default applies.
  assert.deepEqual(e2eStageFilterBody({ stage: "T0", view: "current", late: false }), { stage: "T0" });
  assert.deepEqual(e2eStageFilterBody(emptyE2eStageFilter), {});
  const query = productLineQuery(emptyProductLineFilters, 1, 50, filter);
  assert.deepEqual([query.get("stage"), query.get("view"), query.get("late"), query.get("situation")], ["T3", "reached", "true", "open"]);
  assert.deepEqual(productLineFilterBody(emptyProductLineFilters, { stage: "T5", view: "current", late: true }),
    { situation: "open", stage: "T5", late: "true" });
  assert.deepEqual([...e2eStageCodes], ["T0", "T1", "T2", "T3", "T4", "T5"]);
});
