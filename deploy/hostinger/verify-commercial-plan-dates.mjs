// Reconciles the HML database with the report of import-commercial-plan-dates.py, in a read-only
// session and through the release's own queries. It writes nothing.
//
//   ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env verify-commercial-plan-dates.mjs <report.json>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertHmlDatabase } from "./check-hml-database.mjs";

async function run(reportPath) {
  assertHmlDatabase();
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const releaseDir = resolve(process.env.ERP_API_RELEASE_DIR ?? "");
  const releaseRequire = createRequire(join(releaseDir, "package.json"));
  const { default: pg } = await import(pathToFileURL(releaseRequire.resolve("pg")).href);
  const lines = await import(pathToFileURL(join(releaseDir, "dist", "shipment-lines.js")).href);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, application_name: "hml-commercial-plan-verify",
    options: "-c default_transaction_read_only=on" });
  const failures = [];
  const check = (name, actual, expected) => {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${same ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}${same ? "" : ` (expected ${JSON.stringify(expected)})`}`);
    if (!same) failures.push(name);
  };
  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const scList = "string_to_array(replace(item.sc_number, ' ', ''), ',')";
  try {
    const [target] = await query("SELECT current_database() AS database, current_setting('default_transaction_read_only') AS read_only");
    check("session", [target.database, target.read_only], ["erp_po_totvs_hml", "on"]);

    const dates = new Map();
    for (const entry of report.plan) dates.set(entry.sc, [...(dates.get(entry.sc) ?? []), entry.received]);
    const requests = await query(`SELECT normalized_sc_number AS sc, commercial_plan_received_date::text AS received
      FROM procurement.purchase_request WHERE commercial_plan_received_date IS NOT NULL`);
    check("SCs with date", requests.length, report.requests);
    check("SC dates outside the sheet", requests.filter(row => !dates.get(row.sc)?.includes(row.received)).map(row => row.sc), []);

    const items = await query(`SELECT item.id, po.normalized_number AS po, item.sc_number AS sc, item.commercial_plan_received_date::text AS received,
        ${scList} AS numbers FROM procurement.purchase_order_item AS item
      JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id`);
    const dated = items.filter(row => row.received);
    check("lines with date", dated.length, report.items);
    const planned = row => (row.numbers ?? []).flatMap(number => dates.get(number) ?? []);
    check("lines with a date that none of their SCs has", dated.filter(row => !planned(row).includes(row.received)).map(row => row.id), []);
    check("lines whose SC has a date and stayed empty", items.filter(row => !row.received && planned(row).length).map(row => row.id), []);
    const byPo = new Map(report.plan.map(entry => [`${entry.po}|${entry.sc}`, entry.received]));
    const twoDates = dated.filter(row => new Set(planned(row)).size > 1);
    check("lines with two dates take the date of their PO", twoDates.filter(row => !row.numbers
      .some(number => byPo.get(`${row.po}|${number}`) === row.received)).map(row => row.id), []);

    const [newRequest] = await query(`SELECT request.commercial_plan_received_date::text AS received, request.requester, request.supplier_text AS supplier,
        request.approval_date::text AS approval, po.purchase_request_id = request.id AS linked,
        (SELECT count(*)::int FROM procurement.purchase_order_item AS item WHERE item.purchase_order_id = po.id AND item.sc_number = '020328') AS lines
      FROM procurement.purchase_request AS request, procurement.purchase_order AS po
      WHERE request.normalized_sc_number = '020328' AND po.normalized_number = '031362'`);
    check("SC 020328 on PO 031362", newRequest, { received: "2026-09-22", requester: "PCM - JESSICA", supplier: "HEXING",
      approval: "2026-09-23", linked: true, lines: 51 });

    const lifecycles = await query(`SELECT count(*) FILTER (WHERE lifecycle_status <> 'ACTIVE' AND lifecycle_changed_at IS NULL)::int AS lost,
      count(*) FILTER (WHERE lifecycle_changed_by = '${report.actor}')::int AS touched FROM procurement.purchase_order`);
    check("closed POs kept their lifecycle data", lifecycles, [{ lost: 0, touched: 0 }]);
    const [audit] = await query("SELECT count(*)::int AS total FROM audit.audit_log WHERE actor_id = $1 AND aggregate_type = 'PURCHASE_REQUEST'", [report.actor]);
    check("audit rows of the SCs", audit.total, report.requests);

    const scopes = (await query("SELECT DISTINCT importer FROM procurement.purchase_order")).map(row => row.importer);
    const started = performance.now();
    const every = await lines.queryShipmentLines(pool, scopes, { situation: "all" }, 100000, 0);
    console.log(`INFO End to End: ${every.totalCount} lines in ${Math.round(performance.now() - started)} ms`);
    const received = new Map(items.map(row => [row.id, row.received]));
    const wrong = every.lines.filter(line => (line.calculated.e2e.stages.T0.actual ?? null) !== (received.get(line.item.id) ?? null));
    check("T0 on the End to End equals the recorded date", wrong.length, 0);
    const withT0 = every.lines.filter(line => line.calculated.e2e.stages.T0.actual);
    check("T0 delay follows the rule of the system", withT0.filter(line => {
      const stage = line.calculated.e2e.stages.T0;
      if (!stage.deadline) return false;
      const days = Math.round((Date.parse(stage.actual) - Date.parse(stage.deadline)) / 86400000);
      return stage.actualDays !== days || stage.delayDays !== days - stage.targetDays;
    }).length, 0);
    console.log(`INFO lines with T0: ${withT0.length}; without need date: ${withT0.filter(line => !line.calculated.e2e.stages.T0.deadline).length}`);
    console.log(`INFO lines with T1 before T0: ${withT0.filter(line => (line.calculated.e2e.stages.T1.actualDays ?? 0) < 0).length}`);
    console.log(`INFO lines with T0 and a complete End to End: ${withT0.filter(line => line.calculated.e2e.totalActualDays != null).length}`);
    console.log(`INFO lines with T0 and no SC approval: ${withT0.filter(line => !line.calculated.e2e.stages.T1.actual).length}`);
  } finally {
    await pool.end();
  }
  console.log(failures.length ? `COMMERCIAL PLAN FAILED: ${failures.length}` : "COMMERCIAL PLAN OK");
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("verify-commercial-plan-dates.mjs")) {
  run(process.argv[2]).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
