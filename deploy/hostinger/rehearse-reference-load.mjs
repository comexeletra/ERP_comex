// Rehearsal of the reference loads (stage 1f of docs/PLANO_AUDITORIA_INVOICE_AVULSA.md) against erp_po_totvs_hml
// with the code of one release: the preview runs read-only; the load runs every statement on the real database
// (constraints checked immediately, audit, outbox) and, at the COMMIT, reads back in the same transaction the rows
// kept for the invoice audit and compares them with the rows sent; the COMMIT is then replaced by ROLLBACK.
//
//   MIGRATION_ENV=isolated /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env \
//     --max-old-space-size=256 rehearse-reference-load.mjs <release dir> <payload.json> [<payload.json> ...]
//
// The payloads are built on a workstation by productDatabasePayload / manufacturerListPayload (apps/web/lib),
// from the spreadsheets, exactly as the load screen sends them.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [releaseArgument, ...payloadFiles] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}
if (!payloadFiles.length) throw new Error("Give at least one payload file.");
const releaseDir = resolve(releaseArgument);
const releaseRequire = createRequire(join(releaseDir, "package.json"));
const { default: Fastify } = await import(pathToFileURL(releaseRequire.resolve("fastify")).href);
const { default: pg } = await import(pathToFileURL(releaseRequire.resolve("pg")).href);
const { registerReferenceLoadRoutes } = await import(pathToFileURL(join(releaseDir, "dist", "reference-loads.js")).href);

const realPool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "hml-reference-load-rehearsal" });
const target = (await realPool.query("SELECT current_database() AS database, current_user AS role")).rows[0];
if (target.database !== "erp_po_totvs_hml" || target.role !== "import_erp_hml_app") {
  await realPool.end();
  throw new Error("The rehearsal requires erp_po_totvs_hml with role import_erp_hml_app.");
}
const counts = async () => (await realPool.query(`SELECT
  (SELECT count(*) FROM catalog.reference_load)::int AS loads,
  (SELECT count(*) FROM catalog.reference_product_row)::int AS "productRows",
  (SELECT count(*) FROM catalog.reference_manufacturer_row)::int AS "manufacturerRows",
  (SELECT count(*) FROM catalog.entry)::int AS entries,
  (SELECT coalesce(sum(version), 0)::text FROM catalog.entry) AS "entryVersions",
  (SELECT count(*) FROM audit.audit_log)::int AS audits,
  (SELECT count(*) FROM audit.outbox_message)::int AS outbox`)).rows[0];

let current = null;
const pool = {
  query: (...args) => realPool.query(...args),
  async connect() {
    const client = await realPool.connect();
    return new Proxy(client, { get(object, property) {
      if (property === "query") return async (sql, params) => {
        current.statements += 1;
        if (sql === "COMMIT") {
          // Read back, in the same transaction, what the audit would read, and the catalog changes.
          const load = (await object.query(`SELECT id FROM catalog.reference_load WHERE kind = $1
            ORDER BY loaded_at DESC, id DESC LIMIT 1`, [current.kind])).rows[0];
          const rows = current.kind === "PRODUCT_DATABASE"
            ? (await object.query(`SELECT source_row AS "sourceRow", product_code AS "productCode", description, ncm
                FROM catalog.reference_product_row WHERE load_id = $1 ORDER BY source_row`, [load.id])).rows
            : (await object.query(`SELECT source_row AS "sourceRow", name, address, country, code
                FROM catalog.reference_manufacturer_row WHERE load_id = $1 ORDER BY source_row`, [load.id])).rows;
          current.keptRows = rows.length;
          current.keptRowsEqualSent = isDeepStrictEqual(rows, current.sentRows);
          current.catalogAudit = (await object.query(`SELECT operation, coalesce(field_name, '-') AS field, count(*)::int AS events
            FROM audit.audit_log WHERE aggregate_type = 'CATALOG_ENTRY' AND reason LIKE $1
            GROUP BY 1, 2 ORDER BY 1, 2`, [`%(${load.id}).`])).rows;
          current.commitsReplaced += 1;
          return object.query("ROLLBACK");
        }
        let result;
        try { result = await object.query(sql, params); }
        catch (error) {
          current.failed = { code: error.code, message: error.message, detail: error.detail, constraint: error.constraint,
            sql: String(sql).replace(/\s+/gu, " ").slice(0, 400) };
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
const app = Fastify({ bodyLimit: 1_048_576 });
app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);
app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-rehearsal", subject: "reference-load", userId: actor.id,
    displayName: "HML reference load rehearsal", sessionToken: "hml-rehearsal" };
  request.authorizationContext = { roles: ["Master"], permissions: new Set(["reference-loads.manage", "catalog.read"]),
    importerScopes: [] };
});
await registerReferenceLoadRoutes(app, pool);
const results = [];
try {
  for (const file of payloadFiles) {
    const payload = JSON.parse(await readFile(file, "utf8"));
    current = { kind: payload.kind, sentRows: payload.rows, statements: 0, commitsReplaced: 0 };
    const preview = await app.inject({ method: "POST", url: "/api/v1/reference-loads/preview", payload });
    const before = await counts();
    const started = Date.now();
    const load = await app.inject({ method: "POST", url: "/api/v1/reference-loads", payload });
    const after = await counts();
    const { sentRows: _sent, ...stats } = current;
    results.push({ file, kind: payload.kind, rows: payload.rows.length, previewStatus: preview.statusCode,
      preview: preview.statusCode === 200 ? { ...preview.json(), summary: { ...preview.json().summary,
        nameDifferences: preview.json().summary.nameDifferences?.length } } : preview.body.slice(0, 600),
      loadStatus: load.statusCode, loadBody: load.statusCode === 201 ? { alreadyLoaded: load.json().alreadyLoaded }
        : load.body.slice(0, 600), ms: Date.now() - started, ...stats,
      unchanged: JSON.stringify(before) === JSON.stringify(after), before, after });
  }
  console.log(JSON.stringify({ release: releaseDir.split("/").pop(), results }, null, 1));
} finally {
  await app.close();
  await realPool.end();
}
