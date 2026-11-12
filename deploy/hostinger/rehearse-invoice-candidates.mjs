// Read-only rehearsal of the invoice candidate routes against erp_po_totvs_hml with the code of one release:
// POST /api/v1/purchase-orders/invoice-candidates/batch and /by-product run on the real database, each query inside
// BEGIN READ ONLY ... ROLLBACK, so the database refuses any write. The input is the list of invoices built by the web
// parser ([{ name, ipNumber, poNumbers, products: [{ productCode, quantity }] }]); the output keeps the full answers.
//
//   MIGRATION_ENV=isolated /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env \
//     --max-old-space-size=256 rehearse-invoice-candidates.mjs <release dir> <requests.json> <output.json>
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [releaseArgument, requestsFile, outputFile] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}
if (!outputFile) throw new Error("Usage: rehearse-invoice-candidates.mjs <release dir> <requests.json> <output.json>");
const releaseDir = resolve(releaseArgument);
const releaseRequire = createRequire(join(releaseDir, "package.json"));
const { default: Fastify } = await import(pathToFileURL(releaseRequire.resolve("fastify")).href);
const { default: pg } = await import(pathToFileURL(releaseRequire.resolve("pg")).href);
const { registerOperationalRoutes } = await import(pathToFileURL(join(releaseDir, "dist", "operations.js")).href);
const invoices = JSON.parse(await readFile(requestsFile, "utf8"));

const realPool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "hml-invoice-candidates-rehearsal" });
const stats = { queries: 0, readOnlyChecked: 0 };
// Every statement runs in its own read-only transaction, which is always rolled back.
async function readOnly(sql, params) {
  const client = await realPool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const mode = (await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only;
    if (mode !== "on") throw new Error("The transaction is not read-only.");
    stats.readOnlyChecked += 1;
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

const target = (await readOnly("SELECT current_database() AS database, current_user AS role")).rows[0];
if (target.database !== "erp_po_totvs_hml" || target.role !== "import_erp_hml_app") {
  await realPool.end();
  throw new Error("The rehearsal requires erp_po_totvs_hml with role import_erp_hml_app.");
}
const counts = async () => (await readOnly(`SELECT
  (SELECT count(*) FROM imports.import_process)::int AS ips,
  (SELECT count(*) FROM procurement.po_item_allocation)::int AS allocations,
  (SELECT count(*) FROM imports.process_document)::int AS documents,
  (SELECT count(*) FROM audit.audit_log)::int AS audits,
  (SELECT count(*) FROM procurement.purchase_order)::int AS purchaseOrders,
  (SELECT count(*) FROM procurement.purchase_order_item)::int AS purchaseOrderItems`)).rows[0];
const normalizedPo = "regexp_replace(regexp_replace(upper(%s), '[^A-Z0-9]', '', 'g'), '^PO', '')";

let currentImporter = null;
const actor = (await readOnly("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1")).rows[0];
const app = Fastify({ bodyLimit: 4 * 1024 * 1024 });
app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);
app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-rehearsal", subject: "invoice-candidates", userId: actor.id,
    displayName: "HML invoice candidates rehearsal", sessionToken: "hml-rehearsal" };
  request.authorizationContext = { roles: ["Master"], permissions: new Set(["purchase-orders.read"]),
    importerScopes: [currentImporter] };
});
await registerOperationalRoutes(app, pool);

const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size));
const heapMb = () => Math.round(process.memoryUsage().heapUsed / 1048576 * 10) / 10;
let peakHeapMb = heapMb();
async function call(url, payload) {
  const started = performance.now();
  const response = await app.inject({ method: "POST", url, payload, headers: { "content-type": "application/json" } });
  const ms = Math.round(performance.now() - started);
  const heap = heapMb(); peakHeapMb = Math.max(peakHeapMb, heap);
  return { status: response.statusCode, ms, heapMb: heap, body: JSON.parse(response.body) };
}

const output = [];
const summary = [];
const before = await counts();
try {
  for (const invoice of invoices) {
    const ip = (await readOnly(`SELECT process.ip_number AS "ipNumber", process.importer, process.record_status AS "recordStatus",
        (SELECT count(*) FROM procurement.po_item_allocation allocation
          WHERE allocation.process_id = process.id AND allocation.status = 'ACTIVE')::int AS "activeAllocations"
      FROM imports.import_process process WHERE process.normalized_ip_number = upper(btrim($1))`, [invoice.ipNumber])).rows;
    const importers = (await readOnly(`SELECT DISTINCT po.importer FROM procurement.purchase_order po
      WHERE po.lifecycle_status = 'ACTIVE'
        AND ${normalizedPo.replace("%s", "po.external_number")} IN (
          SELECT ${normalizedPo.replace("%s", "requested")} FROM unnest($1::text[]) AS requested)
      ORDER BY po.importer`, [invoice.poNumbers])).rows.map(row => row.importer);
    if (!importers.length) {
      output.push({ name: invoice.name, importer: null, ipNumber: invoice.ipNumber, ip, batch: null, byProduct: null,
        timings: [], note: "No ACTIVE PO with the cited numbers." });
      summary.push({ name: invoice.name, importer: null, importersFound: 0 });
      continue;
    }
    for (const importer of importers) {
      currentImporter = importer;
      const timings = [];
      const purchaseOrders = [];
      const products = [];
      const statuses = [];
      for (const poNumbers of chunks(invoice.poNumbers, 200)) {
        const result = await call("/api/v1/purchase-orders/invoice-candidates/batch",
          { importer, revisingIpNumber: invoice.ipNumber, poNumbers });
        timings.push({ route: "batch", size: poNumbers.length, status: result.status, ms: result.ms, heapMb: result.heapMb });
        statuses.push(result.status);
        if (result.status === 200) purchaseOrders.push(...result.body.purchaseOrders);
        else purchaseOrders.push({ error: result.body });
      }
      for (const part of chunks(invoice.products, 500)) {
        const result = await call("/api/v1/purchase-orders/invoice-candidates/by-product",
          { importer, revisingIpNumber: invoice.ipNumber, products: part });
        timings.push({ route: "by-product", size: part.length, status: result.status, ms: result.ms, heapMb: result.heapMb });
        statuses.push(result.status);
        if (result.status === 200) products.push(...result.body.products);
        else products.push({ error: result.body });
      }
      output.push({ name: invoice.name, importer, importersFound: importers.length, ipNumber: invoice.ipNumber, ip,
        batch: { purchaseOrders }, byProduct: { products }, timings });
      const valid = purchaseOrders.filter(po => !po.error);
      summary.push({ name: invoice.name, importer, importersFound: importers.length,
        ip: ip.map(row => `${row.recordStatus}:${row.activeAllocations}`).join(",") || "absent",
        statuses: [...new Set(statuses)],
        batch: { poCited: invoice.poNumbers.length, poFound: valid.filter(po => po.poExists).length,
          poMissing: valid.filter(po => !po.poExists).map(po => po.sourcePoNumber),
          poInactive: valid.filter(po => po.poExists && po.poStatus !== "ACTIVE").map(po => po.sourcePoNumber),
          items: valid.reduce((total, po) => total + po.items.length, 0) },
        byProduct: { products: invoice.products.length,
          withItems: products.filter(product => product.items?.length).length,
          withoutItems: products.filter(product => product.items && !product.items.length).length,
          items: products.reduce((total, product) => total + (product.items?.length ?? 0), 0),
          distinctPos: new Set(products.flatMap(product => (product.items ?? []).map(item => item.purchaseOrderId))).size },
        timings: timings.map(timing => `${timing.route}(${timing.size}) ${timing.status} ${timing.ms} ms heap ${timing.heapMb} MB`) });
    }
  }
} finally {
  currentImporter = null;
  const after = await counts();
  await writeFile(outputFile, JSON.stringify(output));
  const allOk = summary.every(row => !row.statuses || row.statuses.every(status => status === 200));
  console.log(JSON.stringify({ release: releaseDir.split("/").pop(), database: target.database, role: target.role,
    summary, ...stats, peakHeapMb, rssMb: Math.round(process.memoryUsage().rss / 1048576),
    allOk, unchanged: JSON.stringify(before) === JSON.stringify(after), before, after }, null, 1));
  await app.close();
  await realPool.end();
}
