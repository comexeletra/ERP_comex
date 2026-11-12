import assert from "node:assert/strict";
import test from "node:test";
import { invoiceIpWithoutPrefix, invoiceSaveIpNumber } from "../dist/invoice-ip-number.js";
// The screen chooses the IP with the same rule; Node 24 strips the types on import. Runs in the repository, not in a release.
import { invoiceSaveIpNumber as webInvoiceSaveIpNumber } from "../../web/lib/china-invoice-mapping.ts";

// Phase B1 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md (user decision, 2026-11-12): an IPH invoice revises the IP that
// the Follow Up load keeps without the prefix, and the IP keeps its number.
const followUp = { ipNumber: "034C/2026", recordStatus: "ACTIVE" };
const examples = [
  ["IPH034C/2026", [followUp], "034C/2026"],
  ["iph034c/2026 ", [followUp], "034C/2026"],
  ["IPH 034C/2026", [followUp], "034C/2026"],
  ["IPH034C/2026", [{ ...followUp, recordStatus: "DRAFT" }], "034C/2026"],
  ["IPH034C/2026", [followUp, { ipNumber: "IPH034C/2026", recordStatus: "ACTIVE" }], "IPH034C/2026"],
  ["IPH034C/2026", [followUp, { ipNumber: "IPH034C/2026", recordStatus: "DRAFT" }], "IPH034C/2026"],
  // The test of 2026-11-12: 037D/2026 cancelled, IPH037D/2026 created from the invoice.
  ["IPH037D/2026", [{ ipNumber: "037D/2026", recordStatus: "CANCELLED" }, { ipNumber: "IPH037D/2026", recordStatus: "ACTIVE" }],
    "IPH037D/2026"],
  ["IPH037D/2026", [{ ipNumber: "037D/2026", recordStatus: "CANCELLED" }], "IPH037D/2026"],
  ["IPH037D/2026", [{ ipNumber: "037D/2026", recordStatus: "DELETED" }], "IPH037D/2026"],
  ["IPH037D/2026", [{ ipNumber: "IPH037D/2026", recordStatus: "CANCELLED" }, { ipNumber: "037D/2026", recordStatus: "ACTIVE" }],
    "037D/2026"],
  ["IPH037D/2026", [{ ipNumber: "IPH037D/2026", recordStatus: "CANCELLED" }], "IPH037D/2026"],
  ["IPH099A/2026", [followUp], "IPH099A/2026"],
  ["IPH099A/2026", [], "IPH099A/2026"],
  ["034C/2026", [followUp], "034C/2026"],
  ["Z-021B/2026", [{ ipNumber: "021B/2026", recordStatus: "ACTIVE" }], "Z-021B/2026"],
  ["IPH034C/2026", [{ ipNumber: "PH034C/2026", recordStatus: "ACTIVE" }], "IPH034C/2026"],
  ["", [followUp], ""],
];

test("an IPH invoice saves into the IP kept without the prefix only when no revisable IP has the invoice number", () => {
  for (const [invoiceIp, stored, expected] of examples) {
    assert.equal(invoiceSaveIpNumber(invoiceIp, stored), expected, `${invoiceIp} ${JSON.stringify(stored)}`);
  }
  assert.equal(invoiceIpWithoutPrefix("IPH037D/2026"), "037D/2026");
  assert.equal(invoiceIpWithoutPrefix(" iph 037d/2026"), "037D/2026");
  assert.equal(invoiceIpWithoutPrefix("037D/2026"), "");
});

test("the API chooses the IP of the invoice as the screen does", () => {
  for (const [invoiceIp, stored] of examples) {
    assert.equal(invoiceSaveIpNumber(invoiceIp, stored), webInvoiceSaveIpNumber(invoiceIp, stored), invoiceIp);
  }
});
