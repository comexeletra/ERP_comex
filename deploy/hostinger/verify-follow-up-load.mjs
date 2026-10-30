// Reconciles the HML database with the report of import-follow-up-workbook.py, in a read-only
// session and through the release's own queries. It writes nothing.
//
//   ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env verify-follow-up-load.mjs <report.json>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertHmlDatabase } from "./check-hml-database.mjs";

export const sheetStatus = { DELIVERED: "ENTREGUE", "WAITING ARRIVAL": "AGUARDANDO CHEGADA", "CUSTOMS CLEARANCE": "DESEMBARAÇO",
  "WAITING SHIPMENT": "AGUARDANDO EMBARQUE", "WAITING PRODUCTION": "AGUARDANDO PRODUÇÃO", CANCELLED: "CANCELADO" };

const selectorColumns = [
  ["procurement.purchase_order_item", "priority", "PRIORITY"], ["procurement.purchase_order_item", "demand", "DEMAND"],
  ["procurement.purchase_order_item", "requester", "REQUESTER"], ["procurement.purchase_order_item", "purpose", "PURPOSE"],
  ["procurement.purchase_order_item", "cost_center", "COST_CENTER"], ["procurement.purchase_order_item", "category", "CATEGORY"],
  ["procurement.purchase_order_item", "item_group", "GROUP"], ["procurement.purchase_order", "analyst", "ANALYST"],
  ["procurement.purchase_order", "demand_type", "DEMAND_TYPE"], ["imports.import_process", "transport_mode", "TRANSPORT_MODE"],
  ["imports.import_process", "incoterm", "INCOTERM"], ["imports.import_process", "broker", "BROKER"],
  ["imports.import_process", "port_loading", "PORT_LOADING"], ["imports.import_process", "port_discharge", "PORT_DISCHARGE"],
  ["imports.import_process", "customs_channel", "CUSTOMS_CHANNEL"], ["imports.import_process", "container_type", "CONTAINER_TYPE"],
  ["imports.import_process", "forwarder", "FORWARDER"], ["imports.import_process", "priority", "PRIORITY"],
];

async function run(reportPath) {
  assertHmlDatabase();
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const releaseDir = resolve(process.env.ERP_API_RELEASE_DIR ?? "");
  const releaseRequire = createRequire(join(releaseDir, "package.json"));
  const { default: pg } = await import(pathToFileURL(releaseRequire.resolve("pg")).href);
  const lines = await import(pathToFileURL(join(releaseDir, "dist", "shipment-lines.js")).href);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, application_name: "hml-follow-up-verify",
    options: "-c default_transaction_read_only=on" });
  const failures = [];
  const check = (name, actual, expected) => {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${same ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}${same ? "" : ` (expected ${JSON.stringify(expected)})`}`);
    if (!same) failures.push(name);
  };
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
  const count = async sql => Number((await one(`SELECT count(*) AS total FROM ${sql}`)).total);
  try {
    const target = await one("SELECT current_database() AS database, current_setting('default_transaction_read_only') AS read_only");
    check("session", [target.database, target.read_only], ["erp_po_totvs_hml", "on"]);
    const batch = await one("SELECT file_sha256, state, source_row_count FROM migration.import_batch WHERE mapping_version = $1",
      [report.mappingVersion]);
    check("batch", [batch?.file_sha256, batch?.state, batch?.source_row_count], [report.sha256, "PROMOTED", report.sourceRows]);

    for (const [table, expected] of [["migration.source_row", report.sourceRows], ["procurement.purchase_request", report.purchaseRequests],
      ["procurement.purchase_order", report.purchaseOrders], ["procurement.purchase_order_item", report.items],
      ["imports.import_process", report.importProcesses], ["procurement.po_item_allocation", report.allocations],
      ["procurement.process_purchase_order", report.links], ["costs.process_cost", report.costs]]) {
      check(`rows of ${table}`, await count(table), expected);
    }
    check("rows without the original file cells", await count("migration.source_row WHERE file_values IS NULL"), 0);

    const lifecycles = Object.fromEntries((await pool.query(
      "SELECT lifecycle_status, count(*)::int AS total FROM procurement.purchase_order GROUP BY 1 ORDER BY 1")).rows
      .map(row => [row.lifecycle_status, row.total]));
    check("PO lifecycles", lifecycles, Object.fromEntries(Object.entries(report.lifecycles).sort()));
    check("PO numbers with other than 6 digits", await count("procurement.purchase_order WHERE external_number !~ '^[0-9]{6}$'"), 0);
    check("PO links to an SC", await count("procurement.purchase_order WHERE purchase_request_id IS NOT NULL"), report.ordersLinkedToSc);
    const noSupplier = (await pool.query(
      "SELECT external_number FROM procurement.purchase_order WHERE supplier_entry_id IS NULL ORDER BY 1")).rows.map(row => row.external_number);
    check("POs without supplier", noSupplier, report.ordersWithoutSupplier);
    check("IPs without supplier", await count("imports.import_process WHERE supplier_entry_id IS NULL"), 0);

    const totals = (await pool.query(`SELECT po.importer || '|' || po.external_number AS key, sum(item.ordered_quantity) AS total
      FROM procurement.purchase_order_item AS item JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
      GROUP BY 1`)).rows;
    const wrongTotals = totals.filter(row => Math.abs(Number(row.total) - Number(report.orderTotals[row.key])) > 1e-6).map(row => row.key);
    check("PO quantity totals against the workbook", [totals.length, wrongTotals], [report.purchaseOrders, []]);

    const statuses = (await pool.query(`SELECT process.normalized_ip_number AS ip,
      ${lines.shipmentStatusSql("process", null)} AS status FROM imports.import_process AS process`)).rows;
    const wrongStatuses = statuses.filter(row => sheetStatus[report.processStatuses[row.ip]] !== row.status)
      .map(row => `${row.ip}: ${row.status} / ${report.processStatuses[row.ip]}`);
    check("IP status calculated by the system against the workbook", [statuses.length, wrongStatuses], [report.importProcesses, []]);

    check("allocations different from the item quantity", await count(`procurement.po_item_allocation AS a
      JOIN procurement.purchase_order_item AS item ON item.id = a.purchase_order_item_id WHERE a.quantity <> item.ordered_quantity`), 0);
    check("cancelled items with an allocation", await count(`procurement.po_item_allocation AS a
      JOIN procurement.purchase_order_item AS item ON item.id = a.purchase_order_item_id
      WHERE upper(coalesce(item.source_status, '')) = 'CANCELLED'`), 0);
    check("items with price and no currency", await count(
      "procurement.purchase_order_item WHERE unit_price IS NOT NULL AND currency_code IS NULL"), report.itemsWithPriceWithoutCurrency);
    check("typed #N/A in operational fields", await count(
      "procurement.purchase_order_item WHERE category LIKE '#%' OR cost_center LIKE '#%' OR requester LIKE '#%'"), 0);
    check("zero left in selector fields", (await one(`SELECT
      (SELECT count(*) FROM procurement.purchase_order_item WHERE category = '0')
      + (SELECT count(*) FROM imports.import_process WHERE '0' IN (broker, incoterm, port_loading, port_discharge)) AS total`)).total, "0");
    for (const [table, column, entity] of selectorColumns) {
      check(`${table}.${column} values outside ${entity}`, await count(`(SELECT DISTINCT field.${column} AS value FROM ${table} AS field
        WHERE field.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalog.operational_value AS option
          WHERE option.entity_key = '${entity}' AND upper(btrim(option.value)) = upper(btrim(field.${column})))) AS outside`), 0);
    }
    check("Pre rows that the readers cannot match to their IP", await count(`migration.source_row AS source
      WHERE source.sheet_name = 'Pré Embarque' AND nullif(btrim(source.raw_values->>'AB'), '') IS NOT NULL
        AND upper(btrim(source.raw_values->>'AB')) NOT IN ('CANCELLED', 'CANCELED')
        AND NOT EXISTS (SELECT 1 FROM imports.import_process AS process WHERE process.normalized_ip_number = upper(btrim(source.raw_values->>'AB'))
          AND process.importer = btrim(source.raw_values->>'F'))`), 0);

    const scopes = (await pool.query("SELECT DISTINCT importer FROM procurement.purchase_order")).rows.map(row => row.importer);
    let started = performance.now();
    const page = await lines.queryShipmentLines(pool, scopes, { situation: "all" }, 50, 0);
    console.log(`INFO product lines: ${page.totalCount} lines, first page in ${Math.round(performance.now() - started)} ms`);
    started = performance.now();
    const every = await lines.queryShipmentLines(pool, scopes, { situation: "all", demandType: "mts" }, 100000, 0);
    console.log(`INFO MTS scenario: ${every.totalCount} lines in ${Math.round(performance.now() - started)} ms`);
    check("MTS lines take the MTS target", every.lines.every(line => line.calculated.e2e.stages.T3.targetDays === 30), true);
    started = performance.now();
    const summary = await lines.queryE2eStageSummary(pool, scopes, { situation: "all" });
    console.log(`INFO End to End summary in ${Math.round(performance.now() - started)} ms: ${JSON.stringify(summary).slice(0, 300)}`);
    const delivered = (await lines.queryShipmentLines(pool, scopes, { situation: "all", status: "ENTREGUE" }, 100000, 0)).lines;
    check("delivered lines end T3 on the BL date", delivered.filter(line => line.process.blDate
      && line.calculated.e2e.stages.T3.actual !== String(line.process.blDate).slice(0, 10)).length, 0);
  } finally {
    await pool.end();
  }
  console.log(failures.length ? `RECONCILIATION FAILED: ${failures.length}` : "RECONCILIATION OK");
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("verify-follow-up-load.mjs")) {
  run(process.argv[2]).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
