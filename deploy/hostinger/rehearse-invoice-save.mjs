// Rehearsal of POST /api/v1/processes/import-invoice against erp_po_totvs_hml with the code of one release:
// every SQL statement of the route runs on the real database (triggers, audit, outbox), constraints are
// checked immediately, and the COMMIT is replaced by ROLLBACK, so nothing is saved.
//
//   MIGRATION_ENV=isolated /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env \
//     --max-old-space-size=256 rehearse-invoice-save.mjs <release dir> <payload.json>
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [releaseArgument, payloadFile] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}
const releaseDir = resolve(releaseArgument);
const releaseRequire = createRequire(join(releaseDir, "package.json"));
const { default: Fastify } = await import(pathToFileURL(releaseRequire.resolve("fastify")).href);
const { default: pg } = await import(pathToFileURL(releaseRequire.resolve("pg")).href);
const { registerOperationalRoutes } = await import(pathToFileURL(join(releaseDir, "dist", "operations.js")).href);
const payload = JSON.parse(await readFile(payloadFile, "utf8"));

const realPool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "hml-invoice-save-rehearsal" });
const target = (await realPool.query("SELECT current_database() AS database, current_user AS role")).rows[0];
if (target.database !== "erp_po_totvs_hml" || target.role !== "import_erp_hml_app") {
  await realPool.end();
  throw new Error("The rehearsal requires erp_po_totvs_hml with role import_erp_hml_app.");
}
const counts = async () => (await realPool.query(`SELECT
  (SELECT count(*) FROM imports.import_process WHERE normalized_ip_number = upper($1))::int AS ips,
  (SELECT count(*) FROM procurement.po_item_allocation)::int AS allocations,
  (SELECT count(*) FROM imports.process_document)::int AS documents,
  (SELECT count(*) FROM audit.audit_log)::int AS audits`, [payload.process.ipNumber])).rows[0];

const stats = { statements: 0, commitsReplaced: 0 };
const pool = {
  query: (...args) => realPool.query(...args),
  async connect() {
    const client = await realPool.connect();
    return new Proxy(client, { get(object, property) {
      if (property === "query") return async (sql, params) => {
        stats.statements += 1;
        if (sql === "COMMIT") { stats.commitsReplaced += 1; return object.query("ROLLBACK"); }
        let result;
        // Probe only: REHEARSAL_DOCUMENT_CURRENCY_NULL=1 sends the invoice document without currency to see the steps after it.
        if (process.env.REHEARSAL_DOCUMENT_CURRENCY_NULL === "1" && String(sql).includes("INSERT INTO imports.process_document")) {
          params = params.map((value, index) => index === 5 ? null : value); stats.documentCurrencyProbe = true;
        }
        try { result = await object.query(sql, params); }
        catch (error) {
          stats.failed = { code: error.code, message: error.message, detail: error.detail, constraint: error.constraint,
            where: error.where?.slice(0, 300), sql: String(sql).replace(/\s+/gu, " ").slice(0, 400),
            params: Array.isArray(params) ? params.map(value => String(value).slice(0, 80)) : undefined };
          throw error;
        }
        if (sql === "BEGIN") await object.query("SET CONSTRAINTS ALL IMMEDIATE");
        return result;
      };
      const value = object[property];
      return typeof value === "function" ? value.bind(object) : value;
    } });
  },
};

const actor = (await realPool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1")).rows[0];
const app = Fastify();
app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);
app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-rehearsal", subject: "invoice-save", userId: actor.id,
    displayName: "HML invoice save rehearsal", sessionToken: "hml-rehearsal" };
  request.authorizationContext = { roles: ["Master"], permissions: new Set(["processes.write", "purchase-orders.read"]),
    importerScopes: [payload.process.importer] };
});
await registerOperationalRoutes(app, pool);
try {
  const before = await counts();
  const started = Date.now();
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice", payload,
    headers: { "content-type": "application/json", "idempotency-key": `hml-rehearsal-${Date.now()}` } });
  const after = await counts();
  console.log(JSON.stringify({ release: releaseDir.split("/").pop(), status: response.statusCode,
    body: response.body.slice(0, 600), ms: Date.now() - started, ...stats,
    unchanged: JSON.stringify(before) === JSON.stringify(after), before, after }));
} finally {
  await app.close();
  await realPool.end();
}
