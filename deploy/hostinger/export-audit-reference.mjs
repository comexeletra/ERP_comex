// Read-only export of the invoice audit reference from erp_po_totvs_hml with the code of one release: the route
// GET /api/v1/reference-loads/audit-reference answers with the rows of the latest loads, as the audit page reads
// them. The JSON goes to invoices_tests/reference-hml.json (outside Git) for the parity test of the web
// (apps/web/test/reference-loads.test.mjs). A summary of the catalog after the loads goes to stderr.
//
//   MIGRATION_ENV=isolated /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env \
//     --max-old-space-size=256 export-audit-reference.mjs <release dir> > reference-hml.json
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [releaseArgument] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}
const releaseDir = resolve(releaseArgument);
const releaseRequire = createRequire(join(releaseDir, "package.json"));
const { default: Fastify } = await import(pathToFileURL(releaseRequire.resolve("fastify")).href);
const { default: pg } = await import(pathToFileURL(releaseRequire.resolve("pg")).href);
const { registerReferenceLoadRoutes } = await import(pathToFileURL(join(releaseDir, "dist", "reference-loads.js")).href);

const realPool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "hml-audit-reference-export" });
const readOnly = {
  async query(sql, params) {
    if (!/^\s*(SELECT|WITH)\b/iu.test(sql)) throw new Error(`Read-only export refused: ${sql.slice(0, 80)}`);
    return realPool.query(sql, params);
  },
  async connect() { throw new Error("Read-only export does not open transactions."); },
};
const target = (await realPool.query("SELECT current_database() AS database")).rows[0];
if (target.database !== "erp_po_totvs_hml") { await realPool.end(); throw new Error("Only erp_po_totvs_hml."); }
const app = Fastify();
app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);
await registerReferenceLoadRoutes(app, readOnly);
try {
  const response = await app.inject({ url: "/api/v1/reference-loads/audit-reference" });
  if (response.statusCode !== 200) throw new Error(`audit reference answered ${response.statusCode}: ${response.body.slice(0, 300)}`);
  process.stdout.write(response.body);
  const summary = (await realPool.query(`SELECT
    (SELECT count(*) FROM catalog.reference_load)::int AS loads,
    (SELECT count(*) FROM catalog.entry WHERE kind = 'PRODUCT' AND provenance = 'REFERENCE_LOAD')::int AS "productsCreated",
    (SELECT count(*) FROM catalog.entry WHERE kind = 'SUPPLIER' AND provenance = 'REFERENCE_LOAD')::int AS "suppliersCreated",
    (SELECT count(*) FROM catalog.entry WHERE kind = 'SUPPLIER' AND supplier_address IS NOT NULL)::int AS "suppliersWithAddress",
    (SELECT count(DISTINCT r.ncm) FROM catalog.reference_product_row r
      WHERE r.load_id = (SELECT id FROM catalog.reference_load WHERE kind = 'PRODUCT_DATABASE' ORDER BY loaded_at DESC, id DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM catalog.entry n WHERE n.kind = 'NCM' AND n.normalized_code = r.ncm))::int AS "ncmsPending",
    (SELECT count(*) FROM catalog.entry p JOIN catalog.reference_product_row r ON p.kind = 'PRODUCT'
      AND p.normalized_code = upper(btrim(r.product_code))
      WHERE r.load_id = (SELECT id FROM catalog.reference_load WHERE kind = 'PRODUCT_DATABASE' ORDER BY loaded_at DESC, id DESC LIMIT 1)
        AND p.name = r.description AND p.product_ncm_code = r.ncm)::int AS "productsEqualToDatabase"`)).rows[0];
  process.stderr.write(`${JSON.stringify(summary)}\n`);
} finally {
  await app.close();
  await realPool.end();
}
