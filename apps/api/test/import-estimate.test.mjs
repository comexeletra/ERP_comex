import assert from "node:assert/strict";
import test from "node:test";
import { estimateImportTaxes } from "../dist/import-estimate.js";

// Reference: VA R$ 10.000,00, II 14%, IPI 9,75%, PIS 2,10%, COFINS 9,65%, Taxa Siscomex R$ 154,23.
// II 1.400,00; IPI (11.400,00 × 9,75%) 1.111,50; PIS 210,00; COFINS 965,00;
// sum 13.840,73; PR 19,5%: base 13.840,73 ÷ 0,805 = 17.193,45; ICMS 3.352,72.
const reference = {
  customsValue: "10000.00", siscomexFee: "154.23", afrmm: "0", otherExpenses: "0",
  ii: { rate: "14", status: "ok" }, ipi: { rate: "9.75", notTaxed: false, status: "ok" },
  pisCofins: { pis: "2.1", cofins: "9.65" },
  icms: { rate: "19.5", fcpRate: "0", includeSiscomexFee: true, includeAfrmm: true, includeOtherExpenses: true },
  benefits: { baseReduction: null, deferral: null },
};

test("federal taxes and ICMS 'por dentro' match the reference computed by hand", () => {
  const result = estimateImportTaxes(reference);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.ii, { base: "10000.00", rate: "14", amount: "1400.00" });
  assert.deepEqual(result.ipi, { base: "11400.00", rate: "9.75", amount: "1111.50", notTaxed: false });
  assert.equal(result.pis.amount, "210.00");
  assert.equal(result.cofins.amount, "965.00");
  assert.deepEqual(result.icms, { sum: "13840.73", fullBase: "17193.45", baseReduction: null, taxableBase: "17193.45",
    rate: "19.5", fcpRate: "0", amount: "3352.72", deferral: null, deferred: "0.00", due: "3352.72" });
  assert.equal(result.federalTotal, "3686.50");
  assert.equal(result.total, "7039.22");
});

test("FCP joins the rate, and expenses the state leaves out stay out of the base", () => {
  const result = estimateImportTaxes({ ...reference, icms: { ...reference.icms, rate: "20", fcpRate: "2" } });
  // 13.840,73 ÷ 0,78 = 17.744,53; × 22% = 3.903,80.
  assert.deepEqual([result.icms.fullBase, result.icms.amount], ["17744.53", "3903.80"]);
  const withoutFee = estimateImportTaxes({ ...reference, icms: { ...reference.icms, includeSiscomexFee: false } });
  assert.equal(withoutFee.icms.sum, "13686.50");
});

test("base reduction and deferral are applied only when registered", () => {
  const result = estimateImportTaxes({ ...reference, benefits: {
    baseReduction: { percent: "50", legalBasis: "Regra de teste" }, deferral: { percent: "30", legalBasis: "Diferimento de teste" } } });
  // 17.193,45 × 50% = 8.596,73; × 19,5% = 1.676,36; diferido 30% = 502,91; a recolher 1.173,45.
  assert.deepEqual([result.icms.taxableBase, result.icms.amount, result.icms.deferred, result.icms.due],
    ["8596.73", "1676.36", "502.91", "1173.45"]);
  assert.equal(result.icms.baseReduction, "50");
  assert.equal(result.icms.deferral, "30");
});

test("IPI NT has no tax, and missing inputs make the estimate incomplete without totals", () => {
  const nt = estimateImportTaxes({ ...reference, ipi: { rate: null, notTaxed: true, status: "ok" } });
  assert.deepEqual(nt.ipi, { base: "11400.00", rate: null, amount: "0.00", notTaxed: true });
  assert.equal(nt.status, "complete");
  const review = estimateImportTaxes({ ...reference, ii: { rate: null, status: "needs_review" }, icms: null });
  assert.equal(review.status, "incomplete");
  assert.deepEqual(review.missing, ["II", "ICMS"]);
  assert.equal(review.ii, null);
  assert.equal(review.icms, null);
  assert.equal(review.total, null);
  assert.equal(review.pis.amount, "210.00");
});

test("money and rates are validated before any arithmetic", () => {
  assert.throws(() => estimateImportTaxes({ ...reference, customsValue: "10,00" }), /valor/u);
  assert.throws(() => estimateImportTaxes({ ...reference, afrmm: "-1" }), /valor/u);
  assert.throws(() => estimateImportTaxes({ ...reference, icms: { ...reference.icms, rate: "60", fcpRate: "40" } }), /ICMS/u);
});
