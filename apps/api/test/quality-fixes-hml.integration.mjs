import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { qualityRules } from "../dist/quality-rules.js";
import { registerQualityFixRoutes } from "../dist/quality-fixes.js";

// Previews every registration fix over the real findings of erp_po_totvs_hml. A preview runs the whole fix and
// always ends in ROLLBACK, so nothing is kept; the test checks that the count of changes and refusals adds up.
const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
  || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "quality-fixes-hml-validation" });
const target = await pool.query("SELECT current_database() AS database");
if (target.rows[0]?.database !== "erp_po_totvs_hml") { await pool.end(); throw new Error("Not the HML database."); }
const user = await pool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1");
const importers = await pool.query("SELECT array_agg(DISTINCT importer) AS list FROM procurement.purchase_order");
const app = Fastify();
app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);
app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-validation", subject: "quality-fixes", userId: user.rows[0].id, displayName: null,
    sessionToken: "hml" };
  request.authorizationContext = { roles: ["Master"], importerScopes: importers.rows[0].list };
});
await registerQualityFixRoutes(app, pool);
test.after(async () => { await app.close(); await pool.end(); });

const findings = async code => (await pool.query(`SELECT entity_id FROM (${qualityRules.find(rule => rule.code === code).sql}) AS found`))
  .rows.map(row => row.entity_id);
const counts = list => list.reduce((all, entry) => ({ ...all, [entry.code]: (all[entry.code] ?? 0) + 1 }), {});

for (const [action, rule, value] of [
  ["ITEM_CURRENCY", "ITEM_PRICE_WITHOUT_CURRENCY", {}],
  ["ITEM_NCM", "ITEM_WITHOUT_NCM", {}],
  ["PO_SUPPLIER", "PO_WITHOUT_SUPPLIER", { supplierCode: null }],
]) {
  test(`${action} preview over the ${rule} findings adds up and keeps nothing`, async () => {
    const ids = (await findings(rule)).slice(0, 500);
    if (!ids.length) return;
    if (action === "PO_SUPPLIER") {
      value.supplierCode = (await pool.query(`SELECT code FROM catalog.entry WHERE kind = 'SUPPLIER' AND importer IS NULL
        AND status = 'ACTIVE' ORDER BY code LIMIT 1`)).rows[0].code;
    }
    const before = await findings(rule);
    const response = await app.inject({ method: "POST", url: "/api/v1/quality/current/fixes",
      payload: { action, entityIds: ids, value, reason: "Validação da prévia no HML.", preview: true } });
    assert.equal(response.statusCode, 200, response.body);
    const { applied, skipped } = response.json();
    assert.equal(applied.length + skipped.length, ids.length);
    console.log(`${action}: ${ids.length} findings, ${applied.length} would change, skipped ${JSON.stringify(counts(skipped))}`);
    if (applied[0]) console.log(`  example: ${JSON.stringify(applied[0].before)} -> ${JSON.stringify(applied[0].after)}`);
    assert.deepEqual(await findings(rule), before);
  });
}
