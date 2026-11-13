// Read-only rehearsal of the merge of A DISTRIBUIR into AGUARDANDO PRODUÇÃO (docs/PLANO_SEM_IP_AGUARDANDO_PRODUCAO.md):
// the pre-shipment and End to End summaries of the previous and the new release run against erp_po_totvs_hml, every
// query inside BEGIN READ ONLY ... ROLLBACK, with the same filters. It checks that the new AGUARDANDO PRODUÇÃO is the old
// A DISTRIBUIR plus the old AGUARDANDO PRODUÇÃO, that the Sem IP filter keeps exactly the old A DISTRIBUIR, that Com IP
// plus Sem IP is everything, and that the other statuses do not change.
//
//   MIGRATION_ENV=isolated /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env \
//     --max-old-space-size=256 rehearse-line-status.mjs <previous release dir> <new release dir> <filters.json> <output.json>
//
// filters.json: { "preShipment": { ...pre-shipment filters }, "e2e": { ...End to End filters } }, without `ip`.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [previousArgument, nextArgument, filtersFile, outputFile] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}
if (!outputFile) throw new Error("Usage: rehearse-line-status.mjs <previous release> <new release> <filters.json> <output.json>");
const [previousDir, nextDir] = [resolve(previousArgument), resolve(nextArgument)];
const releaseRequire = createRequire(join(nextDir, "package.json"));
const { default: pg } = await import(pathToFileURL(releaseRequire.resolve("pg")).href);
const load = (dir, file) => import(pathToFileURL(join(dir, "dist", file)).href);
const [previousPre, nextPre, previousLines, nextLines] = await Promise.all([load(previousDir, "pre-shipment-dashboard.js"),
  load(nextDir, "pre-shipment-dashboard.js"), load(previousDir, "shipment-lines.js"), load(nextDir, "shipment-lines.js")]);
const filters = JSON.parse(await readFile(filtersFile, "utf8"));

const realPool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "hml-line-status-rehearsal" });
const stats = { queries: 0 };
async function readOnly(sql, params) {
  const client = await realPool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    if ((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only !== "on") {
      throw new Error("The transaction is not read-only.");
    }
    stats.queries += 1;
    return await client.query(sql, params);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
const pool = {
  query: (sql, params) => readOnly(sql, params),
  async connect() { throw new Error("The read-only rehearsal does not open write transactions."); },
};

try {
  const target = (await readOnly("SELECT current_database() AS database, current_user AS role")).rows[0];
  if (target.database !== "erp_po_totvs_hml" || target.role !== "import_erp_hml_app") {
    throw new Error("The rehearsal requires erp_po_totvs_hml with role import_erp_hml_app.");
  }
  const scopes = (await readOnly(`SELECT coalesce(array_agg(DISTINCT importer), '{}') AS importers
    FROM procurement.purchase_order`)).rows[0].importers;
  const counts = async () => (await readOnly(`SELECT
    (SELECT count(*) FROM procurement.po_item_allocation)::int AS allocations,
    (SELECT count(*) FROM procurement.purchase_order_item)::int AS items,
    (SELECT count(*) FROM audit.audit_log)::int AS audits`)).rows[0];
  const before = await counts();
  const scaled = nextLines.scaledQuantity;
  const decimal = nextLines.decimalQuantity;
  const sum = (...values) => decimal(values.reduce((total, value) => total + scaled(value), 0n));
  const started = Date.now();

  // Pre-shipment: products and quantity by status (the donut of the user's example).
  const today = (await readOnly("SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today")).rows[0].today;
  const pre = filters.preShipment;
  const oldPre = await previousPre.queryPreShipmentSummary(pool, scopes, pre, today);
  const newPre = await nextPre.queryPreShipmentSummary(pool, scopes, pre, today);
  const withoutIp = await nextPre.queryPreShipmentSummary(pool, scopes, { ...pre, ip: "without" }, today);
  const withIp = await nextPre.queryPreShipmentSummary(pool, scopes, { ...pre, ip: "with" }, today);
  const production = "AGUARDANDO PRODUÇÃO";
  const oldBalance = oldPre.byStatus["A DISTRIBUIR"];
  const otherStatuses = Object.keys(newPre.byStatus).filter(status => status !== production);
  const preChecks = {
    productionIsBalancePlusProduction: newPre.byStatus[production].quantity
      === sum(oldBalance.quantity, oldPre.byStatus[production].quantity)
      && newPre.byStatus[production].products === oldBalance.products + oldPre.byStatus[production].products,
    withoutIpIsOldBalance: withoutIp.byStatus[production].quantity === oldBalance.quantity
      && withoutIp.byStatus[production].products === oldBalance.products
      && withoutIp.totalProducts === oldBalance.products + withoutIp.byStatus.CANCELADO.products,
    withPlusWithoutIsAll: withIp.totalProducts + withoutIp.totalProducts === newPre.totalProducts
      && sum(withIp.totalQuantity, withoutIp.totalQuantity) === newPre.totalQuantity,
    otherStatusesUnchanged: otherStatuses.every(status =>
      JSON.stringify(newPre.byStatus[status]) === JSON.stringify(oldPre.byStatus[status])),
    totalUnchanged: newPre.totalProducts === oldPre.totalProducts && newPre.totalQuantity === oldPre.totalQuantity,
    agingUnchanged: JSON.stringify(newPre.aging) === JSON.stringify(oldPre.aging),
    noBalanceStatusLeft: !("A DISTRIBUIR" in newPre.byStatus),
  };
  const preMs = Date.now() - started;

  // End to End: the status chart of the summary, the whole calculation of every line of the filters.
  const e2eStarted = Date.now();
  const e2e = { situation: "all", ...filters.e2e };
  const oldE2e = (await previousLines.queryE2eStageSummary(pool, scopes, e2e)).overview.byStatus;
  const newE2e = (await nextLines.queryE2eStageSummary(pool, scopes, e2e)).overview.byStatus;
  const e2eWithoutIp = (await nextLines.queryE2eStageSummary(pool, scopes, { ...e2e, ip: "without" })).overview.byStatus;
  const e2eChecks = {
    productionIsBalancePlusProduction: newE2e[production].quantity
      === sum(oldE2e["A DISTRIBUIR"].quantity, oldE2e[production].quantity),
    withoutIpIsOldBalance: JSON.stringify(e2eWithoutIp[production]) === JSON.stringify(oldE2e["A DISTRIBUIR"]),
    otherStatusesUnchanged: Object.keys(newE2e).filter(status => status !== production)
      .every(status => JSON.stringify(newE2e[status]) === JSON.stringify(oldE2e[status])),
  };
  const e2eMs = Date.now() - e2eStarted;

  const after = await counts();
  const result = {
    today, scopes: scopes.length, filters,
    preShipment: { old: oldPre.byStatus, new: newPre.byStatus, withoutIp: withoutIp.byStatus, withIp: withIp.byStatus,
      checks: preChecks, ms: preMs },
    e2e: { old: oldE2e, new: newE2e, withoutIp: e2eWithoutIp, checks: e2eChecks, ms: e2eMs },
    unchanged: JSON.stringify(before) === JSON.stringify(after), before, after, queries: stats.queries,
    heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
  };
  await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`);
  const passed = [...Object.values(preChecks), ...Object.values(e2eChecks), result.unchanged].every(Boolean);
  console.log(JSON.stringify({ preShipment: preChecks, e2e: e2eChecks, unchanged: result.unchanged, preMs, e2eMs,
    heapMb: result.heapMb, passed }));
  if (!passed) process.exitCode = 1;
} finally {
  await realPool.end();
}
