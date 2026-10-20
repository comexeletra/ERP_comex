import assert from "node:assert/strict";
import test from "node:test";
import { clearInvoiceCommandKey, invoiceCommandKey } from "../lib/invoice-command-key.ts";

test("invoice retries reuse the same key until the payload changes or succeeds", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) };
  let serial = 0;
  const generate = () => `invoice-key-${++serial}`;
  const first = { invoice: { number: "INV-1", amount: "10" } };
  const key = invoiceCommandKey(storage, first, generate);
  assert.equal(invoiceCommandKey(storage, structuredClone(first), generate), key);
  assert.notEqual(invoiceCommandKey(storage, { invoice: { ...first.invoice, amount: "11" } }, generate), key);
  clearInvoiceCommandKey(storage);
  assert.notEqual(invoiceCommandKey(storage, first, generate), key);
});
