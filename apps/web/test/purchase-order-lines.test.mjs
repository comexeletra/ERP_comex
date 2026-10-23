import assert from "node:assert/strict";
import test from "node:test";
import { emptyProductLineFilters, itemShipmentSummary, parseProductLineFilters, productLineFilterBody,
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
