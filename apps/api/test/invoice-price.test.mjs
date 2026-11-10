import assert from "node:assert/strict";
import test from "node:test";
import { invoicePriceDifference, invoicePriceTolerancePercent } from "../dist/invoice-price.js";
// The review screen shows the same difference; Node 24 strips the types on import.
import { invoicePriceDifference as webDifference, invoicePriceTolerancePercent as webTolerance }
  from "../../web/lib/china-invoice-mapping.ts";

const cases = [
  ["0.364192307692308", "0.36420000"], ["30.08", "35.85"], ["0.6", "0.5"], ["1.2001", "1"], ["2", "3"],
  ["0.5", "0"], ["0.3642", "0.36420000"], ["0.36420001", "0.3642"],
];

test("the invoice price difference is exact, in percent, against an inclusive 20% tolerance", () => {
  assert.equal(invoicePriceTolerancePercent, 20);
  assert.deepEqual(invoicePriceDifference("0.364192307692308", "0.36420000"), { percent: "-0.0021", withinTolerance: true });
  assert.deepEqual(invoicePriceDifference("30.08", "35.85"), { percent: "-16.0948", withinTolerance: true });
  assert.deepEqual(invoicePriceDifference("0.6", "0.5"), { percent: "20", withinTolerance: true });
  assert.deepEqual(invoicePriceDifference("1.2001", "1"), { percent: "20.01", withinTolerance: false });
  assert.deepEqual(invoicePriceDifference("0.5", "0"), { percent: null, withinTolerance: false });
  // Up to 0.00000001 it is the same price, as before.
  assert.equal(invoicePriceDifference("0.3642", "0.36420000"), null);
  assert.equal(invoicePriceDifference("0.36420001", "0.3642"), null);
});

test("the API and the review screen read every price difference alike", () => {
  assert.equal(webTolerance, invoicePriceTolerancePercent);
  for (const [invoice, po] of cases) {
    const api = invoicePriceDifference(invoice, po);
    const web = webDifference(invoice, po);
    assert.deepEqual(web && { percent: web.percent === null ? null : String(web.percent), withinTolerance: web.withinTolerance }, api,
      `${invoice} × ${po}`);
  }
});
