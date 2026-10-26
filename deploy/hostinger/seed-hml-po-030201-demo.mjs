#!/usr/bin/env node
// Seeds (or reverts) a realistic end-to-end simulation of PO 030201 in the homologation
// database. Every write goes through the real API routes of the active HML release, so
// the usual validation, audit and outbox apply. Run on the VPS from any directory:
//
//   MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env seed-hml-po-030201-demo.mjs apply|revert
//
// The dates follow the real Follow Up rows of PO 030201 (need 2026-12-01, SC approved
// 2026-08-21, PO sent 2026-08-24, Não MTS ETD 2026-10-08 / ETA 2026-12-02) and the E2E
// lead times (MTS 30 days, Não MTS 45 days in the HQ; 55 days by sea, 10 by air;
// 10 days to clear and deliver), as seen on 2026-10-26.
// `apply` refuses to run while simulation IPs or active allocations of the PO exist;
// `revert` cancels the simulation allocations and invoices and deletes those IPs.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const purchaseOrderNumber = "030201";
export const ipNumberPattern = /^030201-[A-G]\/2026$/u;
const revertPatterns = ["030201-_/2026", "DEMO-030201-IP%"];
const reason = "Simulação end-to-end da PO 030201 (HML)";

/** Pre-shipment dates shared by every PO line and synchronized with SC 020028. */
export const sharedFields = {
  necessityDate: "2026-12-01", commercialPlanReceivedDate: "2026-08-03", mrpCompletedDate: "2026-08-07",
  scDate: "2026-08-12", scApprovalDate: "2026-08-21", requester: "PCM - JOSIVAN",
  purpose: "Estoque Insumos (Componente)", poApprovalDate: "2026-08-24", poSentDate: "2026-08-24",
};

const sea = { transportMode: "SEA", incoterm: "FOB", portLoading: "NGB", portDischarge: "PEC",
  forwarder: "SAVINO DEL BENE", broker: "ÁGIL" };
const air = { transportMode: "AIR", incoterm: "FCA", portLoading: "SGH", portDischarge: "FOR",
  forwarder: "DHL", broker: "ÁGIL" };

/**
 * Seven shipments grouped by product family. `lines` are whole PO lines; IP G takes
 * `splitShare` of the largest lines of B and C, a balance the HQ ships later.
 */
export const simulationIps = [
  { ip: "A", demandType: "MTS", lines: [[112, 130], [213, 215]], factoryShipDate: "2026-09-21", invoiceDate: "2026-09-22",
    expected: { status: "ENTREGUE", eta: "2026-10-05" },
    fields: { ...air, etd: "2026-09-25", blNumber: "176-48213350", blDate: "2026-09-25",
      actualPortDepartureDate: "2026-09-26", etaConfirmed: "2026-10-05", arrivalDate: "2026-10-05",
      duimpNumber: "26BR0001523456-1", duimpDate: "2026-10-07", customsChannel: "GREEN",
      clearanceDate: "2026-10-09", deliveryDate: "2026-10-14", documentsOk: true } },
  { ip: "B", demandType: "MTS", lines: [[1, 58]], factoryShipDate: "2026-09-23", invoiceDate: "2026-09-24",
    expected: { status: "AGUARDANDO CHEGADA", eta: "2026-11-22" },
    fields: { ...sea, containerType: "40'HC", containerQuantity: 1, etd: "2026-09-28",
      blNumber: "SDBLBS612041", blDate: "2026-09-29", actualPortDepartureDate: "2026-09-30", documentsOk: true } },
  { ip: "C", demandType: "MTS", lines: [[59, 111]], factoryShipDate: "2026-09-30", invoiceDate: "2026-10-01",
    expected: { status: "AGUARDANDO CHEGADA", eta: "2026-12-02" },
    fields: { ...sea, containerType: "40'HC", containerQuantity: 1, etd: "2026-10-08",
      blNumber: "SDBLBS615530", blDate: "2026-10-10", actualPortDepartureDate: "2026-10-11", documentsOk: true } },
  { ip: "D", demandType: "Não MTS", lines: [[154, 177]], factoryShipDate: "2026-10-08", invoiceDate: "2026-10-09",
    expected: { status: "DESEMBARAÇO", eta: "2026-10-22" },
    fields: { ...air, etd: "2026-10-13", blNumber: "176-48877412", blDate: "2026-10-13",
      actualPortDepartureDate: "2026-10-14", etaConfirmed: "2026-10-22", arrivalDate: "2026-10-22",
      duimpNumber: "26BR0001589934-7", duimpDate: "2026-10-23", customsChannel: "YELLOW" } },
  { ip: "E", demandType: "Não MTS", lines: [[178, 212]], factoryShipDate: "2026-10-20", invoiceDate: "2026-10-21",
    expected: { status: "AGUARDANDO EMBARQUE", eta: "2026-12-27" },
    fields: { ...sea, containerType: "20' DRY", containerQuantity: 1, etd: "2026-11-02" } },
  { ip: "F", demandType: "MTS", lines: [[131, 153]], factoryShipDate: "2026-11-04", invoiceDate: null,
    expected: { status: "AGUARDANDO PRODUÇÃO", eta: "2026-11-16" },
    fields: { ...air, etd: "2026-11-06" } },
  { ip: "G", demandType: null, lines: [], split: { from: ["B", "C"], largest: 5, share: 0.3 },
    factoryShipDate: "2026-11-13", invoiceDate: null,
    expected: { status: "AGUARDANDO PRODUÇÃO", eta: "2027-01-12" },
    fields: { ...sea, containerType: "LCL", etd: "2026-11-18" } },
];

const lineNumber = reference => Number(reference);
/** IP letter that receives a whole PO line ("0001".."0215"), or null. */
export function ipForLine(reference) {
  const line = lineNumber(reference);
  return simulationIps.find(ip => ip.lines.some(([first, last]) => line >= first && line <= last))?.ip ?? null;
}
/** Demand type of a PO line: the type of the IP that holds the whole line. */
export function demandTypeForLine(reference) {
  const ip = ipForLine(reference);
  return simulationIps.find(entry => entry.ip === ip)?.demandType ?? null;
}

/** Quantities per IP: whole lines, then the share of the largest B and C lines moved to G. */
export function allocationPlan(items) {
  const plan = items.map(item => ({ itemId: item.id, line: item.line, ip: ipForLine(item.line), quantity: BigInt(item.quantity) }));
  const split = simulationIps.find(ip => ip.split);
  const moved = [];
  for (const source of split.split.from) {
    const largest = plan.filter(entry => entry.ip === source)
      .sort((left, right) => (right.quantity > left.quantity ? 1 : right.quantity < left.quantity ? -1 : left.line.localeCompare(right.line)))
      .slice(0, split.split.largest);
    for (const entry of largest) {
      const share = entry.quantity * BigInt(Math.round(split.split.share * 100)) / 100n;
      entry.quantity -= share;
      moved.push({ itemId: entry.itemId, line: entry.line, ip: split.ip, quantity: share });
    }
  }
  return [...plan, ...moved].map(entry => ({ ...entry, quantity: entry.quantity.toString() }));
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
    application_name: "hml-po-030201-simulation" });
  const app = Fastify();
  try {
    const target = await pool.query("SELECT current_database() AS database, current_user AS role");
    if (target.rows[0]?.database !== "erp_po_totvs_hml" || target.rows[0]?.role !== "import_erp_hml_app") {
      throw new Error("The simulation requires erp_po_totvs_hml with role import_erp_hml_app.");
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
      request.authContext = { issuer: "hml-simulation", subject: `po-030201-${runId}`, userId: actor.id,
        displayName: "HML simulation PO 030201", sessionToken: "hml-simulation" };
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
    const key = name => ({ "Idempotency-Key": `po-030201-${runId}-${name}` });
    const version = async (table, id) =>
      ({ "X-Record-Version": (await pool.query(`SELECT version::text AS v FROM ${table} WHERE id = $1`, [id])).rows[0].v });
    const simulationProcesses = async () => (await pool.query(`SELECT id, ip_number FROM imports.import_process
      WHERE ip_number LIKE ANY($1::text[]) AND record_status <> 'DELETED' ORDER BY ip_number`, [revertPatterns])).rows;

    if (mode === "revert") {
      for (const process of await simulationProcesses()) {
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

    const existing = await simulationProcesses();
    const activeAllocations = (await pool.query(`SELECT count(*)::int AS n FROM procurement.po_item_allocation a
      JOIN procurement.purchase_order_item i ON i.id = a.purchase_order_item_id
      WHERE i.purchase_order_id = $1 AND a.status = 'ACTIVE'`, [purchaseOrderId])).rows[0].n;
    if (existing.length || activeAllocations) {
      throw new Error(`Refusing to seed: ${existing.length} simulation IPs and ${activeAllocations} active allocations exist.`);
    }
    const items = (await pool.query(`SELECT id, external_line_reference AS line, ordered_quantity::text AS quantity
      FROM procurement.purchase_order_item WHERE purchase_order_id = $1 ORDER BY external_line_reference`,
    [purchaseOrderId])).rows.map(item => ({ ...item,
      quantity: item.quantity.includes(".") ? item.quantity.replace(/\.?0+$/, "") : item.quantity }));
    if (items.length !== 215 || items.some(item => !ipForLine(item.line) || !/^\d+$/u.test(item.quantity))) {
      throw new Error(`PO ${purchaseOrderNumber} no longer has the 215 whole-unit lines 0001-0215 this plan splits.`);
    }

    // Pre-shipment: dates shared by the PO lines (and SC 020028), then the demand type per line.
    let poVersion = (await version("procurement.purchase_order", purchaseOrderId))["X-Record-Version"];
    const shared = await call("PATCH", `/api/v1/purchase-orders/${purchaseOrderId}/items/followup`,
      { itemIds: items.map(item => item.id), fields: sharedFields, reason }, { "X-Record-Version": poVersion });
    poVersion = shared.purchaseOrderVersion;
    for (const item of items) {
      const changed = await call("PATCH", `/api/v1/purchase-orders/${purchaseOrderId}/items/${item.id}/followup`,
        { fields: { demandType: demandTypeForLine(item.line) }, reason }, { "X-Record-Version": poVersion });
      poVersion = changed.purchaseOrderVersion;
    }
    console.log(`Shared pre-shipment dates and demand types set on ${items.length} lines (SC synced: ${shared.purchaseRequestUpdated}).`);

    const allocations = allocationPlan(items);
    for (const ip of simulationIps) {
      const ipNumber = `030201-${ip.ip}/2026`;
      const mine = allocations.filter(entry => entry.ip === ip.ip);
      const created = await call("POST", "/api/v1/processes", { importer, ipNumber, supplierText,
        logisticsStatus: null, priority: null, reason,
        notes: `Simulação E2E da PO ${purchaseOrderNumber}: ${mine.length} linhas${ip.split ? " (saldo parcial de B e C)" : ""}.` },
      key(`ip-${ip.ip}`), [201]);
      for (const entry of mine) {
        await call("POST", `/api/v1/purchase-orders/${purchaseOrderId}/allocations`, { itemId: entry.itemId,
          processId: created.id, quantity: entry.quantity, factoryShipDate: ip.factoryShipDate, notes: "", reason },
        key(`allocation-${ip.ip}-${entry.line}`), [201]);
      }
      if (ip.invoiceDate) {
        await call("POST", `/api/v1/processes/${created.id}/documents`, { kind: "INVOICE",
          number: `HX26030201${ip.ip}`, purchaseOrderItemId: null, issueDate: ip.invoiceDate,
          homologationDate: null, quantity: null, unitPrice: null, amount: null, currencyCode: null,
          notes: "", reason }, key(`invoice-${ip.ip}`), [201]);
      }
      await call("PATCH", `/api/v1/processes/${created.id}/followup`, { fields: ip.fields, reason },
        await version("imports.import_process", created.id));
      const followup = await call("GET", `/api/v1/processes/${created.id}/followup`);
      const { status, eta } = followup.calculated;
      if (status !== ip.expected.status || eta !== ip.expected.eta) {
        throw new Error(`${ipNumber} computed ${status} / ETA ${eta}; expected ${JSON.stringify(ip.expected)}.`);
      }
      console.log(`${ipNumber}: ${mine.length} lines, ${status}, ETA ${eta}.`);
    }

    const balance = (await pool.query(`SELECT count(*)::int AS lines,
        count(*) FILTER (WHERE i.ordered_quantity = coalesce(a.allocated, 0))::int AS fully_allocated,
        count(*) FILTER (WHERE i.demand_type IS NOT NULL)::int AS typed
      FROM procurement.purchase_order_item i
      LEFT JOIN (SELECT purchase_order_item_id, sum(quantity) AS allocated FROM procurement.po_item_allocation
        WHERE status = 'ACTIVE' GROUP BY 1) a ON a.purchase_order_item_id = i.id
      WHERE i.purchase_order_id = $1`, [purchaseOrderId])).rows[0];
    if (balance.lines !== 215 || balance.fully_allocated !== 215 || balance.typed !== 215) {
      throw new Error(`Allocation check failed: ${JSON.stringify(balance)}.`);
    }
    console.log(`Seeded run ${runId}: 7 IPs, ${allocations.length} allocations, 215/215 lines fully allocated and typed.`);
  } finally {
    await app.close();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
