// Shared harness of the HML simulations: it refuses anything but erp_po_totvs_hml and sends every
// write through the real API routes of the active HML release (validation, audit and outbox apply).
//
//   MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env <seed>.mjs <mode>
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Opens the in-process API as a Master scoped to `importer` once `useImporter` is called. */
export async function openHmlSimulation(name) {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
    || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
    throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
  }
  const releaseDir = resolve(process.env.ERP_API_RELEASE_DIR ?? "");
  const releaseRequire = createRequire(join(releaseDir, "package.json"));
  const load = specifier => import(pathToFileURL(releaseRequire.resolve(specifier)).href);
  const dist = file => import(pathToFileURL(join(releaseDir, "dist", file)).href);
  const { default: Fastify } = await load("fastify");
  const { default: pg } = await load("pg");
  const { registerFollowupRoutes } = await dist("followup.js");
  const { registerOperationalRoutes } = await dist("operations.js");
  const { registerProcessReadRoutes } = await dist("processes.js");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
    application_name: `hml-${name}-simulation` });
  const app = Fastify();
  const close = async () => { await app.close(); await pool.end(); };
  try {
    const target = await pool.query("SELECT current_database() AS database, current_user AS role");
    if (target.rows[0]?.database !== "erp_po_totvs_hml" || target.rows[0]?.role !== "import_erp_hml_app") {
      throw new Error("The simulation requires erp_po_totvs_hml with role import_erp_hml_app.");
    }
    const actor = (await pool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1")).rows[0];
    if (!actor) throw new Error("HML lacks a user to act as the audit actor.");
    const runId = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    let importerScopes = [];

    app.decorateRequest("authContext", null);
    app.decorateRequest("authorizationContext", null);
    app.addHook("onRequest", async request => {
      request.authContext = { issuer: "hml-simulation", subject: `${name}-${runId}`, userId: actor.id,
        displayName: `HML simulation ${name}`, sessionToken: "hml-simulation" };
      request.authorizationContext = { roles: ["Master"], permissions: new Set([
        "purchase-orders.read", "purchase-orders.write", "processes.read", "processes.write",
        "processes.lifecycle.manage",
      ]), importerScopes };
    });
    await registerFollowupRoutes(app, pool);
    await registerOperationalRoutes(app, pool);
    await registerProcessReadRoutes(app, pool);

    async function call(method, url, payload, headers = {}, expected = [200]) {
      const response = await app.inject({ method, url, payload,
        headers: { "content-type": "application/json", ...headers } });
      const body = response.statusCode === 204 ? null : response.json();
      if (!expected.includes(response.statusCode)) {
        throw new Error(`${method} ${url} -> ${response.statusCode}: ${JSON.stringify(body)}`);
      }
      return body;
    }
    return {
      pool, runId, call, close,
      useImporter(importer) { importerScopes = [importer]; },
      key: label => ({ "Idempotency-Key": `${name}-${runId}-${label}` }),
      version: async (table, id) =>
        ({ "X-Record-Version": (await pool.query(`SELECT version::text AS v FROM ${table} WHERE id = $1`, [id])).rows[0].v }),
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Cancels the active allocations and invoices of each IP, then deletes the IP. */
export async function revertProcesses(simulation, processes, reason) {
  const { pool, call, version } = simulation;
  for (const process of processes) {
    const allocations = (await pool.query(`SELECT a.id, i.purchase_order_id FROM procurement.po_item_allocation a
      JOIN procurement.purchase_order_item i ON i.id = a.purchase_order_item_id
      WHERE a.process_id = $1 AND a.status = 'ACTIVE'`, [process.id])).rows;
    for (const allocation of allocations) {
      await call("DELETE", `/api/v1/purchase-orders/${allocation.purchase_order_id}/allocations/${allocation.id}`,
        { reason: `${reason}: reversão`, confirmShippedChange: true },
        await version("procurement.po_item_allocation", allocation.id));
    }
    const documents = (await pool.query(`SELECT id FROM imports.process_document
      WHERE process_id = $1 AND status = 'ACTIVE'`, [process.id])).rows;
    for (const document of documents) {
      await call("DELETE", `/api/v1/processes/${process.id}/documents/${document.id}`,
        { reason: `${reason}: reversão` }, await version("imports.process_document", document.id));
    }
    await call("DELETE", `/api/v1/processes/${process.id}`, { reason: `${reason}: reversão` },
      await version("imports.import_process", process.id));
    console.log(`Reverted ${process.ip_number}: ${allocations.length} allocations, ${documents.length} documents.`);
  }
}

/** Creates one simulation IP with its allocations, invoice and follow-up, and checks status and ETA. */
export async function createSimulationIp(simulation, { importer, supplierText, purchaseOrderId, purchaseOrderNumber,
  ipNumber, invoiceNumber, ip, allocations, notes, reason }) {
  const { call, key, version } = simulation;
  const created = await call("POST", "/api/v1/processes", { importer, ipNumber, supplierText,
    logisticsStatus: null, priority: null, reason, notes }, key(`ip-${ipNumber}`), [201]);
  for (const entry of allocations) {
    await call("POST", `/api/v1/purchase-orders/${purchaseOrderId}/allocations`, { itemId: entry.itemId,
      processId: created.id, quantity: entry.quantity, factoryShipDate: ip.factoryShipDate, notes: "", reason },
    key(`allocation-${ipNumber}-${entry.line}`), [201]);
  }
  if (ip.invoiceDate) {
    await call("POST", `/api/v1/processes/${created.id}/documents`, { kind: "INVOICE",
      number: invoiceNumber, purchaseOrderItemId: null, issueDate: ip.invoiceDate,
      homologationDate: null, quantity: null, unitPrice: null, amount: null, currencyCode: null,
      notes: "", reason }, key(`invoice-${ipNumber}`), [201]);
  }
  await call("PATCH", `/api/v1/processes/${created.id}/followup`, { fields: ip.fields, reason },
    await version("imports.import_process", created.id));
  const followup = await call("GET", `/api/v1/processes/${created.id}/followup`);
  const { status, eta } = followup.calculated;
  if (status !== ip.expected.status || eta !== ip.expected.eta) {
    throw new Error(`${ipNumber} computed ${status} / ETA ${eta}; expected ${JSON.stringify(ip.expected)}.`);
  }
  console.log(`${ipNumber} (PO ${purchaseOrderNumber}): ${allocations.length} lines, ${status}, ETA ${eta}.`);
  return created;
}

/** Saves the PO demand type through the header route, keeping every other header value. */
export async function setPurchaseOrderDemandType(simulation, purchaseOrderId, demandType, reason) {
  const { call, version } = simulation;
  const po = await call("GET", `/api/v1/purchase-orders/${purchaseOrderId}/operational`);
  if (po.demandType === demandType) return po.version;
  const saved = await call("PATCH", `/api/v1/purchase-orders/${purchaseOrderId}`, { number: po.number,
    supplierText: po.supplierText, orderDate: po.orderDate, notes: po.notes, demandType, reason },
  await version("procurement.purchase_order", purchaseOrderId));
  return saved.version;
}
