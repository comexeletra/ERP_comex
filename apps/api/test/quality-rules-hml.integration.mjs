import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { qualityFindingsSql, qualityRules } from "../dist/quality-rules.js";

// Runs every data quality rule against erp_po_totvs_hml. Counts are compared with independent queries; each
// rule then gets a negative and a positive case by changing one record inside a transaction that always
// ends in ROLLBACK, so nothing is kept.
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
  || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "quality-rules-hml-validation" });
const runId = randomUUID().slice(0, 8).toUpperCase();
const target = await pool.query(`SELECT current_database() AS database,
  EXISTS (SELECT 1 FROM migration.schema_migration WHERE version = 'M077_quality_rule_waiver.sql') AS m077`);
if (target.rows[0]?.database !== "erp_po_totvs_hml" || !target.rows[0]?.m077) {
  await pool.end();
  throw new Error("The HML integration requires erp_po_totvs_hml with M077.");
}
test.after(() => pool.end());

const ruleByCode = Object.fromEntries(qualityRules.map(rule => [rule.code, rule]));
const liveItem = `FROM procurement.purchase_order_item AS item JOIN procurement.purchase_order AS po
  ON po.id = item.purchase_order_id WHERE po.lifecycle_status NOT IN ('CANCELLED', 'DELETED')
  AND coalesce(item.source_status, '') <> 'CANCELLED'`;
const liveIp = "FROM imports.import_process AS ip WHERE ip.deleted_at IS NULL AND ip.record_status = 'ACTIVE'";
const independent = {
  ITEM_WITHOUT_NCM: `SELECT count(*) ${liveItem} AND coalesce(btrim(item.ncm), '') = ''`,
  ITEM_NCM_NOT_REGISTERED: `SELECT count(*) ${liveItem} AND coalesce(btrim(item.ncm), '') <> ''
    AND regexp_replace(item.ncm, '[^0-9]', '', 'g') NOT IN (SELECT normalized_code FROM catalog.entry WHERE kind = 'NCM' AND status = 'ACTIVE')`,
  ITEM_PRODUCT_NOT_REGISTERED: `SELECT count(*) ${liveItem} AND upper(btrim(item.product_code)) NOT IN
    (SELECT normalized_code FROM catalog.entry WHERE kind = 'PRODUCT' AND importer IS NULL AND status = 'ACTIVE')`,
  ITEM_PRICE_WITHOUT_CURRENCY: `SELECT count(*) ${liveItem} AND item.unit_price IS NOT NULL AND coalesce(btrim(item.currency_code), '') = ''`,
  ITEM_WITHOUT_PRICE: `SELECT count(*) ${liveItem} AND item.unit_price IS NULL`,
  PO_WITHOUT_SUPPLIER: `SELECT count(*) FROM procurement.purchase_order AS po WHERE po.lifecycle_status NOT IN ('CANCELLED', 'DELETED')
    AND po.supplier_entry_id IS NULL AND coalesce(btrim(po.supplier_text), '') = ''`,
  ITEM_PO_APPROVED_BEFORE_SC: `SELECT count(*) ${liveItem} AND item.po_approval_date < item.sc_approval_date`,
  IP_CLEARED_BEFORE_ARRIVAL: `SELECT count(*) ${liveIp} AND ip.clearance_date < ip.arrival_date`,
  IP_WITHOUT_PO: `SELECT count(*) ${liveIp} AND ip.id NOT IN (SELECT process_id FROM procurement.process_purchase_order)`,
  ITEM_SHIPPED_WITHOUT_IP: `SELECT count(*) ${liveItem} AND item.source_status IN ('WAITING SHIPMENT', 'WAITING ARRIVAL', 'CUSTOMS CLEARANCE', 'DELIVERED')
    AND item.id NOT IN (SELECT purchase_order_item_id FROM procurement.po_item_allocation WHERE status = 'ACTIVE')`,
  IP_PO_SUPPLIER_MISMATCH: `SELECT count(DISTINCT ip.id) ${liveIp.replace("WHERE", `JOIN procurement.process_purchase_order AS link ON link.process_id = ip.id
    JOIN procurement.purchase_order AS po ON po.id = link.purchase_order_id WHERE`)} AND po.lifecycle_status NOT IN ('CANCELLED', 'DELETED')
    AND ip.supplier_entry_id IS NOT NULL AND po.supplier_entry_id IS NOT NULL AND po.supplier_entry_id <> ip.supplier_entry_id`,
  SC_MULTIPLE_SUPPLIERS: `SELECT count(*) FROM (SELECT po.purchase_request_id FROM procurement.purchase_order AS po
    WHERE po.purchase_request_id IS NOT NULL AND po.lifecycle_status NOT IN ('CANCELLED', 'DELETED') AND po.supplier_entry_id IS NOT NULL
    GROUP BY 1 HAVING count(DISTINCT po.supplier_entry_id) > 1) AS sc`,
};

// For each rule: a record that does not break it, and the change that makes it break the rule.
const cases = {
  ITEM_WITHOUT_NCM: { pick: `SELECT item.id ${liveItem} AND coalesce(btrim(item.ncm), '') <> '' LIMIT 1`,
    change: "UPDATE procurement.purchase_order_item SET ncm = NULL WHERE id = $1" },
  ITEM_NCM_NOT_REGISTERED: { pick: `SELECT item.id ${liveItem} AND regexp_replace(item.ncm, '[^0-9]', '', 'g') IN
      (SELECT normalized_code FROM catalog.entry WHERE kind = 'NCM' AND status = 'ACTIVE') LIMIT 1`,
    change: "UPDATE procurement.purchase_order_item SET ncm = '00000000' WHERE id = $1" },
  ITEM_PRODUCT_NOT_REGISTERED: { pick: `SELECT item.id ${liveItem} AND upper(btrim(item.product_code)) IN
      (SELECT normalized_code FROM catalog.entry WHERE kind = 'PRODUCT' AND importer IS NULL AND status = 'ACTIVE') LIMIT 1`,
    change: `UPDATE procurement.purchase_order_item SET product_code = 'HMLVAL-${runId}' WHERE id = $1` },
  ITEM_PRICE_WITHOUT_CURRENCY: { pick: `SELECT item.id ${liveItem} AND item.unit_price IS NOT NULL AND item.currency_code IS NOT NULL LIMIT 1`,
    change: "UPDATE procurement.purchase_order_item SET currency_code = NULL WHERE id = $1" },
  ITEM_WITHOUT_PRICE: { pick: `SELECT item.id ${liveItem} AND item.unit_price IS NOT NULL LIMIT 1`,
    change: "UPDATE procurement.purchase_order_item SET unit_price = NULL WHERE id = $1" },
  PO_WITHOUT_SUPPLIER: { pick: `SELECT po.id FROM procurement.purchase_order AS po WHERE po.lifecycle_status = 'ACTIVE'
      AND po.supplier_entry_id IS NOT NULL LIMIT 1`,
    change: "UPDATE procurement.purchase_order SET supplier_entry_id = NULL, supplier_text = NULL WHERE id = $1" },
  ITEM_PO_APPROVED_BEFORE_SC: { pick: `SELECT item.id ${liveItem} AND (item.po_approval_date < item.sc_approval_date)
      IS NOT TRUE LIMIT 1`,
    change: "UPDATE procurement.purchase_order_item SET sc_approval_date = DATE '2026-01-02', po_approval_date = DATE '2026-01-01' WHERE id = $1" },
  IP_CLEARED_BEFORE_ARRIVAL: { pick: `SELECT ip.id ${liveIp} AND (ip.clearance_date < ip.arrival_date) IS NOT TRUE LIMIT 1`,
    change: "UPDATE imports.import_process SET arrival_date = DATE '2026-01-10', clearance_date = DATE '2026-01-05' WHERE id = $1" },
  IP_WITHOUT_PO: { existing: true },
  ITEM_SHIPPED_WITHOUT_IP: { pick: `SELECT item.id ${liveItem} AND item.source_status = 'WAITING PRODUCTION'
      AND item.id NOT IN (SELECT purchase_order_item_id FROM procurement.po_item_allocation WHERE status = 'ACTIVE') LIMIT 1`,
    change: "UPDATE procurement.purchase_order_item SET source_status = 'DELIVERED' WHERE id = $1" },
  IP_PO_SUPPLIER_MISMATCH: { pick: `SELECT ip.id ${liveIp} AND ip.supplier_entry_id IS NOT NULL AND EXISTS (SELECT 1
      FROM procurement.process_purchase_order AS link WHERE link.process_id = ip.id) LIMIT 1`,
    change: `UPDATE imports.import_process SET supplier_entry_id = (SELECT id FROM catalog.entry WHERE kind = 'SUPPLIER'
      AND importer IS NULL AND id NOT IN (SELECT po.supplier_entry_id FROM procurement.process_purchase_order AS link
      JOIN procurement.purchase_order AS po ON po.id = link.purchase_order_id WHERE link.process_id = $1
      AND po.supplier_entry_id IS NOT NULL) LIMIT 1) WHERE id = $1` },
  SC_MULTIPLE_SUPPLIERS: { existing: true },
};

const flagged = async (client, code, id) => (await client.query(
  `SELECT 1 FROM (${ruleByCode[code].sql}) AS found WHERE found.entity_id = $1`, [id])).rowCount > 0;

test("every rule counts the same records as an independent query on HML", async () => {
  const counts = await pool.query(`SELECT rule, count(*)::int AS count FROM (${qualityFindingsSql()}) AS findings GROUP BY rule`);
  const byRule = Object.fromEntries(counts.rows.map(row => [row.rule, row.count]));
  for (const rule of qualityRules) {
    const expected = Number((await pool.query(independent[rule.code])).rows[0].count);
    assert.equal(byRule[rule.code] ?? 0, expected, rule.code);
    console.log(`${rule.code}: ${expected}`);
  }
});

test("each rule ignores a correct record and flags it once changed, always rolled back", async () => {
  const client = await pool.connect();
  const skipped = [];
  try {
    await client.query("BEGIN");
    for (const rule of qualityRules) {
      const scenario = cases[rule.code];
      if (scenario.existing) {
        const sample = await client.query(`SELECT entity_id FROM (${rule.sql}) AS found LIMIT 1`);
        if (sample.rows[0]) assert.ok(await flagged(client, rule.code, sample.rows[0].entity_id), rule.code);
        else skipped.push(`${rule.code}: no record breaks it on HML; checked by count only`);
        continue;
      }
      const picked = await client.query(scenario.pick);
      const id = picked.rows[0]?.id;
      assert.ok(id, `${rule.code}: no candidate record`);
      assert.equal(await flagged(client, rule.code, id), false, `${rule.code} negative`);
      await client.query("SAVEPOINT quality_case");
      try {
        await client.query(scenario.change, [id]);
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT quality_case");
        skipped.push(`${rule.code}: the database refused the change (${error.code ?? error.message})`);
        continue;
      }
      assert.equal(await flagged(client, rule.code, id), true, `${rule.code} positive`);
      await client.query("ROLLBACK TO SAVEPOINT quality_case");
      assert.equal(await flagged(client, rule.code, id), false, `${rule.code} after rollback`);
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  for (const line of skipped) console.log(`skipped positive case - ${line}`);
});
