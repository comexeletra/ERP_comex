#!/usr/bin/env node
// Seeds (or reverts) demonstration IPs for PO 030201 in the homologation database.
// Every write goes through the real API routes of the active HML release, so the
// usual validation, audit and outbox apply. Run on the VPS from any directory:
//
//   set -a; . /etc/import-erp/homologation-db.env; set +a
//   MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node seed-hml-po-030201-demo.mjs apply|revert
//
// `apply` refuses to run while demo IPs or active allocations of the PO exist;
// `revert` cancels the demo allocations and invoices and deletes the demo IPs.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const purchaseOrderNumber = "030201";
export const ipPrefix = "DEMO-030201-IP";
const reason = "Dados de demonstração do processo da PO 030201 (HML)";

const sea = { transportMode: "SEA", incoterm: "FOB", portLoading: "SHEKOU (CHINA)", portDischarge: "Paranaguá",
  forwarder: "SAVINO", broker: "AGIL", containerType: "40'HC" };
const air = { transportMode: "AIR", incoterm: "FCA", portLoading: "HKG", portDischarge: "VCP",
  forwarder: "DHL", broker: "AGIL" };

/** Seven IPs, each one at a different step, splitting the 215 PO lines in order. */
export const demoIps = [
  { suffix: "01", lines: [1, 31], factoryShipDate: "2026-08-20", invoiceDate: "2026-08-20",
    expected: { status: "ENTREGUE", eta: "2026-10-14" },
    fields: { ...sea, containerQuantity: 1, etd: "2026-08-28", blNumber: "DEMO-030201-BL01", blDate: "2026-08-29",
      actualPortDepartureDate: "2026-08-30", etaConfirmed: "2026-10-14", arrivalDate: "2026-10-15",
      duimpNumber: "26BR00012345601", duimpDate: "2026-10-16", customsChannel: "GREEN",
      clearanceDate: "2026-10-18", deliveryDate: "2026-10-21", documentsOk: true } },
  { suffix: "02", lines: [32, 62], factoryShipDate: "2026-10-08", invoiceDate: "2026-10-08",
    expected: { status: "DESEMBARAÇO", eta: "2026-10-22" },
    fields: { ...air, etd: "2026-10-12", blNumber: "DEMO-030201-AWB02", blDate: "2026-10-12",
      actualPortDepartureDate: "2026-10-13", etaConfirmed: "2026-10-22", arrivalDate: "2026-10-22",
      duimpNumber: "26BR00012345602", duimpDate: "2026-10-23", customsChannel: "YELLOW", documentsOk: true } },
  { suffix: "03", lines: [63, 93], factoryShipDate: "2026-09-15", invoiceDate: "2026-09-15",
    expected: { status: "AGUARDANDO CHEGADA", eta: "2026-11-16" },
    fields: { ...sea, containerQuantity: 2, etd: "2026-09-22", blNumber: "DEMO-030201-BL03", blDate: "2026-09-24",
      actualPortDepartureDate: "2026-09-25" } },
  { suffix: "04", lines: [94, 124], factoryShipDate: "2026-10-20", invoiceDate: "2026-10-20",
    expected: { status: "AGUARDANDO EMBARQUE", eta: "2026-12-24" },
    fields: { ...sea, containerQuantity: 1, etd: "2026-10-30" } },
  { suffix: "05", lines: [125, 155], factoryShipDate: "2026-11-10", invoiceDate: null,
    expected: { status: "AGUARDANDO PRODUÇÃO", eta: "2026-11-24" },
    fields: { ...air, etd: "2026-11-14" } },
  { suffix: "06", lines: [156, 186], factoryShipDate: "2026-12-05", invoiceDate: null,
    expected: { status: "AGUARDANDO PRODUÇÃO", eta: "2027-02-08" },
    fields: { ...sea, containerQuantity: 1, etd: "2026-12-15" } },
  { suffix: "07", lines: [187, 215], factoryShipDate: "2027-01-15", invoiceDate: null,
    expected: { status: "AGUARDANDO PRODUÇÃO", eta: "2027-03-21" },
    fields: { ...sea, containerQuantity: 1, etd: "2027-01-25" } },
];

/** Index of the demo IP that receives a PO line ("0001".."0215"), or -1. */
export function ipIndexForLine(lineReference) {
  const line = Number(lineReference);
  return demoIps.findIndex(ip => line >= ip.lines[0] && line <= ip.lines[1]);
}

async function main(mode) {
  if (mode !== "apply" && mode !== "revert") throw new Error("Use: seed-hml-po-030201-demo.mjs apply|revert");
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
    || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
    throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
  }
  const releaseDir = resolve(process.env.ERP_API_RELEASE_DIR ?? "");
  const releaseRequire = createRequire(join(releaseDir, "package.json"));
  const load = specifier => import(pathToFileURL(releaseRequire.resolve(specifier)).href);
  const dist = name => import(pathToFileURL(join(releaseDir, "dist", name)).href);
  const { default: Fastify } = await load("fastify");
  const { default: pg } = await load("pg");
  const { registerFollowupRoutes } = await dist("followup.js");
  const { registerOperationalRoutes } = await dist("operations.js");
  const { registerProcessReadRoutes } = await dist("processes.js");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
    application_name: "hml-po-030201-demo" });
  const app = Fastify();
  try {
    const target = await pool.query("SELECT current_database() AS database, current_user AS role");
    if (target.rows[0]?.database !== "erp_po_totvs_hml" || target.rows[0]?.role !== "import_erp_hml_app") {
      throw new Error("The demo seed requires erp_po_totvs_hml with role import_erp_hml_app.");
    }
    const po = (await pool.query(`SELECT id, importer, supplier_text FROM procurement.purchase_order
      WHERE external_number = $1 AND lifecycle_status = 'ACTIVE'`, [purchaseOrderNumber])).rows;
    if (po.length !== 1) throw new Error(`Expected one active PO ${purchaseOrderNumber}, found ${po.length}.`);
    const actor = (await pool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1")).rows[0];
    if (!actor) throw new Error("HML lacks a user to act as the audit actor.");
    const { id: purchaseOrderId, importer, supplier_text: supplierText } = po[0];
    const runId = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

    app.decorateRequest("authContext", null);
    app.decorateRequest("authorizationContext", null);
    app.addHook("onRequest", async request => {
      request.authContext = { issuer: "hml-demo", subject: `po-030201-demo-${runId}`, userId: actor.id,
        displayName: "HML demo PO 030201", sessionToken: "hml-demo" };
      request.authorizationContext = { roles: ["Master"], permissions: new Set([
        "purchase-orders.read", "purchase-orders.write", "processes.read", "processes.write",
        "processes.lifecycle.manage",
      ]), importerScopes: [importer] };
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
    const key = name => ({ "Idempotency-Key": `po-030201-demo-${runId}-${name}` });
    const version = async (table, id) =>
      ({ "X-Record-Version": (await pool.query(`SELECT version::text AS v FROM ${table} WHERE id = $1`, [id])).rows[0].v });
    const demoProcesses = async () => (await pool.query(`SELECT id, ip_number FROM imports.import_process
      WHERE ip_number LIKE $1 AND record_status <> 'DELETED' ORDER BY ip_number`, [`${ipPrefix}%`])).rows;

    if (mode === "revert") {
      for (const process of await demoProcesses()) {
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
      return;
    }

    const existing = await demoProcesses();
    const activeAllocations = (await pool.query(`SELECT count(*)::int AS n FROM procurement.po_item_allocation a
      JOIN procurement.purchase_order_item i ON i.id = a.purchase_order_item_id
      WHERE i.purchase_order_id = $1 AND a.status = 'ACTIVE'`, [purchaseOrderId])).rows[0].n;
    if (existing.length || activeAllocations) {
      throw new Error(`Refusing to seed: ${existing.length} demo IPs and ${activeAllocations} active allocations exist.`);
    }
    const items = (await pool.query(`SELECT id, external_line_reference AS line, ordered_quantity::text AS quantity
      FROM procurement.purchase_order_item WHERE purchase_order_id = $1 ORDER BY external_line_reference`,
    [purchaseOrderId])).rows.map(item => ({ ...item,
      quantity: item.quantity.includes(".") ? item.quantity.replace(/\.?0+$/, "") : item.quantity }));
    if (items.length !== 215 || items.some(item => ipIndexForLine(item.line) < 0)) {
      throw new Error(`PO ${purchaseOrderNumber} no longer has the 215 lines 0001-0215 this plan splits.`);
    }

    for (const ip of demoIps) {
      const ipNumber = `${ipPrefix}${ip.suffix}`;
      const created = await call("POST", "/api/v1/processes", { importer, ipNumber, supplierText,
        logisticsStatus: null, priority: null, notes: `Demonstração: itens ${ip.lines.join("–")} da PO ${purchaseOrderNumber}.`,
        reason }, key(`ip-${ip.suffix}`), [201]);
      const mine = items.filter(item => demoIps[ipIndexForLine(item.line)] === ip);
      for (const item of mine) {
        await call("POST", `/api/v1/purchase-orders/${purchaseOrderId}/allocations`, { itemId: item.id,
          processId: created.id, quantity: item.quantity, factoryShipDate: ip.factoryShipDate, notes: "", reason },
        key(`allocation-${item.line}`), [201]);
      }
      if (ip.invoiceDate) {
        await call("POST", `/api/v1/processes/${created.id}/documents`, { kind: "INVOICE",
          number: `DEMO-030201-INV${ip.suffix}`, purchaseOrderItemId: null, issueDate: ip.invoiceDate,
          homologationDate: null, quantity: null, unitPrice: null, amount: null, currencyCode: null,
          notes: "", reason }, key(`invoice-${ip.suffix}`), [201]);
      }
      await call("PATCH", `/api/v1/processes/${created.id}/followup`, { fields: ip.fields, reason },
        await version("imports.import_process", created.id));
      const followup = await call("GET", `/api/v1/processes/${created.id}/followup`);
      const { status, eta } = followup.calculated;
      if (status !== ip.expected.status || eta !== ip.expected.eta) {
        throw new Error(`${ipNumber} computed ${status} / ETA ${eta}; expected ${JSON.stringify(ip.expected)}.`);
      }
      console.log(`${ipNumber}: ${mine.length} items, ${status}, ETA ${eta}.`);
    }

    const balance = (await pool.query(`SELECT count(*)::int AS lines,
        count(*) FILTER (WHERE i.ordered_quantity = coalesce(a.allocated, 0))::int AS fully_allocated
      FROM procurement.purchase_order_item i
      LEFT JOIN (SELECT purchase_order_item_id, sum(quantity) AS allocated FROM procurement.po_item_allocation
        WHERE status = 'ACTIVE' GROUP BY 1) a ON a.purchase_order_item_id = i.id
      WHERE i.purchase_order_id = $1`, [purchaseOrderId])).rows[0];
    if (balance.lines !== 215 || balance.fully_allocated !== 215) {
      throw new Error(`Allocation check failed: ${JSON.stringify(balance)}.`);
    }
    console.log(`Seeded run ${runId}: 7 IPs, 215/215 lines of PO ${purchaseOrderNumber} fully allocated.`);
  } finally {
    await app.close();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
