import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerFollowupRoutes } from "../dist/followup.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const connectionString = process.env.FOLLOWUP_TEST_DATABASE_URL;
test("saving a PO after unlinking its SC also applies the replacement supplier", { skip: !connectionString }, async t => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  await client.query("BEGIN");
  t.after(async () => { await client.query("ROLLBACK"); client.release(); await pool.end(); });

  const actor = await client.query("SELECT id FROM identity.erp_user LIMIT 1");
  assert.ok(actor.rows[0], "isolated database needs an audit actor");
  const importer = "FOLLOWUP UNLINK CI";
  const oldSupplierId = randomUUID();
  const newSupplierId = randomUUID();
  const oldSupplierCode = `UNLINK-CI-${randomUUID().slice(0, 8)}`;
  const newSupplierCode = `UNLINK-INV-${randomUUID().slice(0, 8)}`;
  for (const [id, code, name] of [[oldSupplierId, oldSupplierCode, `Fornecedor SC ${oldSupplierCode}`],
    [newSupplierId, newSupplierCode, `Fornecedor Invoice ${newSupplierCode}`]]) {
    await client.query(`INSERT INTO catalog.entry
      (id,importer,kind,code,name,evidence,created_by,updated_by)
      VALUES ($1,NULL,'SUPPLIER',$2,$3,'PO unlink integration fixture',$4,$4)`,
      [id, code, name, actor.rows[0].id]);
  }

  const scId = randomUUID();
  const poId = randomUUID();
  const itemId = randomUUID();
  const poNumber = `PO-UNLINK-${randomUUID().slice(0, 8)}`;
  const scNumber = `SC-UNLINK-${randomUUID().slice(0, 8)}`;
  await client.query(`INSERT INTO procurement.purchase_request
    (id,importer,sc_number,normalized_sc_number,requester,created_by,supplier_text)
    VALUES ($1,$2,$3::varchar,upper($3::varchar),'Analista CI','ci#purchase-order-unlink',$4)`,
    [scId, importer, scNumber, oldSupplierCode]);
  await client.query(`INSERT INTO procurement.purchase_order
    (id,importer,external_number,normalized_number,source_kind,version,supplier_text,purchase_request_id)
    VALUES ($1,$2,$3::text,upper($3::text),'MANUAL_TOTVS_REFERENCE',1,$4,$5)`,
    [poId, importer, poNumber, oldSupplierCode, scId]);
  await client.query(`INSERT INTO procurement.purchase_order_item
    (id,purchase_order_id,line_number,product_code,description,ordered_quantity,unit,sc_number,requester)
    VALUES ($1,$2,1,'UNLINK-CI-PRODUCT','Produto de teste',1,'PC',$3,'Analista CI')`,
    [itemId, poId, scNumber]);

  const db = {
    query: (...args) => client.query(...args),
    async connect() {
      return { query: (sql, params) => {
        if (sql === "BEGIN") return client.query("SAVEPOINT po_unlink_command");
        if (sql === "COMMIT") return client.query("RELEASE SAVEPOINT po_unlink_command");
        if (sql === "ROLLBACK") return client.query("ROLLBACK TO SAVEPOINT po_unlink_command");
        return client.query(sql, params);
      }, release() {} };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  app.decorateRequest("authorizationContext", null);
  app.addHook("onRequest", async request => {
    request.authContext = { userId: actor.rows[0].id, issuer: "ci", subject: "purchase-order-unlink" };
    request.authorizationContext = { importerScopes: [importer], roles: ["Importação"], permissions: new Set() };
  });
  await registerFollowupRoutes(app, db);
  await registerOperationalRoutes(app, db);

  const payload = { header: { number: poNumber, supplierText: newSupplierCode, orderDate: null,
    notes: "PO sem SC", purchaseRequestId: null, reason: "Desvincular SC para trocar fornecedor" },
    itemIds: [itemId], fields: { scNumber: null, scDate: null, scApprovalDate: null,
      commercialPlanReceivedDate: null, requester: null } };
  const response = await app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}/complete`,
    payload, headers: { "if-match": '"1"' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().version, "2");

  const saved = await client.query(`SELECT po.purchase_request_id,po.supplier_text,
    po.supplier_entry_id,item.sc_number,item.requester FROM procurement.purchase_order po
    JOIN procurement.purchase_order_item item ON item.purchase_order_id=po.id WHERE po.id=$1`, [poId]);
  assert.equal(saved.rows[0].purchase_request_id, null);
  assert.equal(saved.rows[0].supplier_text, newSupplierCode);
  assert.equal(saved.rows[0].supplier_entry_id, newSupplierId);
  assert.equal(saved.rows[0].sc_number, null);
  assert.equal(saved.rows[0].requester, null);

  const normalPatch = await app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}`,
    payload: { number: poNumber, supplierText: oldSupplierCode, orderDate: null,
      notes: "PO com fornecedor revisado", purchaseRequestId: null, reason: "Revisar fornecedor da PO" },
    headers: { "if-match": '"2"' } });
  assert.equal(normalPatch.statusCode, 200, normalPatch.body);
  assert.equal(normalPatch.json().version, "3");
  const savedNormalPatch = await client.query("SELECT supplier_entry_id,supplier_text FROM procurement.purchase_order WHERE id=$1", [poId]);
  assert.equal(savedNormalPatch.rows[0].supplier_text, oldSupplierCode);
  assert.equal(savedNormalPatch.rows[0].supplier_entry_id, oldSupplierId);
});
