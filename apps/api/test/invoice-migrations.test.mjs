import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationsUrl = new URL("../migrations/", import.meta.url);

test("invoice migrations keep record-state and supplier-divergence invariants in PostgreSQL", async () => {
  const [recordState, productAttributes, supplierDivergence, allocationRules] = await Promise.all([
    readFile(new URL("M059_invoice_ip_revision_and_cancellation.sql", migrationsUrl), "utf8"),
    readFile(new URL("M060_product_invoice_attributes.sql", migrationsUrl), "utf8"),
    readFile(new URL("M061_invoice_supplier_divergence.sql", migrationsUrl), "utf8"),
    readFile(new URL("M062_invoice_allocation_supplier_rules.sql", migrationsUrl), "utf8"),
  ]);

  assert.match(recordState, /record_status varchar\(16\) NOT NULL DEFAULT 'ACTIVE'/u);
  assert.match(recordState, /Only active IPs can consume PO quantity/u);
  assert.match(productAttributes, /catalog_product_invoice_attributes/u);
  assert.match(productAttributes, /product_ncm_code ~ '\^\[0-9\]\{8\}\$'/u);
  assert.match(supplierDivergence, /invoice_supplier_divergence boolean NOT NULL DEFAULT false/u);
  assert.match(supplierDivergence, /CREATE OR REPLACE FUNCTION catalog\.sync_supplier_entity_reference/u);
  assert.match(supplierDivergence, /CREATE OR REPLACE FUNCTION procurement\.check_supplier_entity_allocation/u);
  assert.match(supplierDivergence, /Cancel active documents before changing IP record status/u);
  assert.match(supplierDivergence, /Non-active IPs must not retain active allocations or documents/u);
  assert.match(allocationRules, /CREATE OR REPLACE FUNCTION procurement\.check_ip_po_supplier/u);
  assert.match(allocationRules, /ip_source_kind = 'CHINA_INVOICE' AND ip_supplier_divergence/u);
  assert.match(allocationRules, /PO must reference a supplier entity before allocation/u);
});

test("PO lifecycle migration preserves audit history and protects closed or terminal POs", async () => {
  const lifecycle = await readFile(new URL("M063_purchase_order_lifecycle.sql", migrationsUrl), "utf8");
  assert.match(lifecycle, /lifecycle_status varchar\(16\) NOT NULL DEFAULT 'ACTIVE'/u);
  assert.match(lifecycle, /'ACTIVE', 'CANCELLED', 'CLOSED', 'DELETED'/u);
  assert.match(lifecycle, /lifecycle_changed_at timestamptz/u);
  assert.match(lifecycle, /lifecycle_changed_by text/u);
  assert.match(lifecycle, /lifecycle_reason text/u);
  assert.match(lifecycle, /lifecycle_reason IS NOT NULL/u);
  assert.match(lifecycle, /purchase_order_lifecycle_transition/u);
  assert.match(lifecycle, /purchase_order_business_fields_immutable/u);
  assert.match(lifecycle, /to_jsonb\(NEW\)/u);
  assert.match(lifecycle, /Only active POs allow allocation changes/u);
  assert.match(lifecycle, /PO with active allocations cannot be cancelled or deleted/u);
  assert.match(lifecycle, /purchase_order_item_lifecycle_check/u);
});

test("PO lifecycle restoration migration permits only the planned returns to ACTIVE and clears lifecycle metadata", async () => {
  const lifecycleRestore = await readFile(new URL("M064_purchase_order_lifecycle_restore.sql", migrationsUrl), "utf8");
  assert.match(lifecycleRestore, /CREATE OR REPLACE FUNCTION procurement\.check_purchase_order_lifecycle_transition/u);
  assert.match(lifecycleRestore, /OLD\.lifecycle_status = 'CANCELLED' AND NEW\.lifecycle_status IN \('ACTIVE', 'DELETED'\)/u);
  assert.match(lifecycleRestore, /OLD\.lifecycle_status = 'DELETED' AND NEW\.lifecycle_status = 'ACTIVE'/u);
  assert.match(lifecycleRestore, /OLD\.lifecycle_status = 'CLOSED' AND NEW\.lifecycle_status IN \('ACTIVE', 'DELETED'\)/u);
  assert.match(lifecycleRestore, /NEW\.lifecycle_changed_at := NULL/u);
  assert.match(lifecycleRestore, /NEW\.lifecycle_changed_by := NULL/u);
  assert.match(lifecycleRestore, /NEW\.lifecycle_reason := NULL/u);
  assert.match(lifecycleRestore, /PO with active allocations cannot be cancelled or deleted/u);
  assert.doesNotMatch(lifecycleRestore, /ADD COLUMN/u);
});
