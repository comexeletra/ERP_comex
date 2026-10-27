#!/usr/bin/env node
// Seeds (or reverts) the Não MTS counterpart of the PO 030201 simulation in the homologation
// database. PO SIM-NMTS-01 repeats the 59 products of lines 0154-0212 of 030201 (code,
// description, quantity, price and cost center) with the PO demand type Não MTS (45 days in the
// HQ), and ships them in two IPs with the dates of 030201 D (by air, in customs) and E (by sea,
// awaiting shipment). Every write goes through the real API routes of the active HML release.
// Copy this file, seed-hml-po-030201-demo.mjs and hml-simulation.mjs to one directory on the VPS
// and run:
//
//   MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env seed-hml-po-nmts-demo.mjs apply|revert
//
// `apply` refuses to run while a PO SIM-NMTS-01 exists in any lifecycle; `revert` cancels the
// allocations and invoices, deletes the IPs and deletes the PO. A deleted PO number cannot be
// created again: restore that PO from the portfolio instead.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSimulationIp, openHmlSimulation, revertProcesses } from "./hml-simulation.mjs";
import { sharedFields, simulationIps as sourceIps } from "./seed-hml-po-030201-demo.mjs";

export const purchaseOrderNumber = "SIM-NMTS-01";
export const sourcePurchaseOrderNumber = "030201";
export const demandType = "Não MTS";
/** External lines of 030201 whose products this PO repeats, in order: 0154 becomes 0001. */
export const sourceLines = { first: 154, last: 212 };
export const ipNumberPattern = /^SIM-NMTS-01-[AB]\/2026$/u;
const reason = "Simulação end-to-end Não MTS (HML)";

const datesOf = letter => {
  const { factoryShipDate, invoiceDate, expected, fields } = sourceIps.find(ip => ip.ip === letter);
  return { factoryShipDate, invoiceDate, expected, fields };
};
/** Two shipments with the dates of 030201 D and E; `lines` are lines of this PO. */
export const simulationIps = [
  { ip: "A", source: "D", lines: [1, 24], ...datesOf("D") },
  { ip: "B", source: "E", lines: [25, 59], ...datesOf("E") },
];

/** Line of this PO for a 030201 line ("0154" -> "0001"). */
export function lineReference(sourceReference) {
  return String(Number(sourceReference) - sourceLines.first + 1).padStart(4, "0");
}
/** IP letter that receives a whole line of this PO, or null. */
export function ipForLine(reference) {
  const line = Number(reference);
  return simulationIps.find(({ lines: [first, last] }) => line >= first && line <= last)?.ip ?? null;
}
const plain = value => value.includes(".") ? value.replace(/\.?0+$/u, "") : value;

/** `POST /purchase-orders/complete` body built from the 030201 rows of lines 0154-0212. */
export function purchaseOrderPayload({ importer, supplierText }, rows) {
  return {
    header: { importer, number: purchaseOrderNumber, supplierText, purchaseRequestId: null, orderDate: null,
      notes: `Simulação Não MTS com os produtos das linhas 0154 a 0212 da PO ${sourcePurchaseOrderNumber}.`,
      demandType, reason },
    items: rows.map(row => ({
      base: { externalLineReference: lineReference(row.line), productCode: row.productCode,
        description: row.description, orderedQuantity: plain(row.quantity), unit: row.unit,
        unitPrice: row.unitPrice === null ? null : plain(row.unitPrice), currency: row.currency, reason },
      fields: { ...sharedFields, ...(row.costCenter ? { costCenter: row.costCenter } : {}) },
    })),
  };
}

async function main(mode) {
  if (mode !== "apply" && mode !== "revert") throw new Error("Use: seed-hml-po-nmts-demo.mjs apply|revert");
  const simulation = await openHmlSimulation("po-nmts");
  const { pool, call } = simulation;
  try {
    const source = (await pool.query(`SELECT id, importer, supplier_text FROM procurement.purchase_order
      WHERE external_number = $1 AND lifecycle_status = 'ACTIVE'`, [sourcePurchaseOrderNumber])).rows;
    if (source.length !== 1) throw new Error(`Expected one active PO ${sourcePurchaseOrderNumber}, found ${source.length}.`);
    const { id: sourceId, importer, supplier_text: supplierText } = source[0];
    simulation.useImporter(importer);
    const existing = (await pool.query(`SELECT id, lifecycle_status FROM procurement.purchase_order
      WHERE normalized_number = upper($1) AND importer = $2`, [purchaseOrderNumber, importer])).rows;

    if (mode === "revert") {
      const processes = (await pool.query(`SELECT id, ip_number FROM imports.import_process
        WHERE ip_number LIKE $1 AND record_status <> 'DELETED' ORDER BY ip_number`, [`${purchaseOrderNumber}-_/2026`])).rows;
      await revertProcesses(simulation, processes, reason);
      for (const po of existing.filter(row => row.lifecycle_status === "ACTIVE")) {
        await call("DELETE", `/api/v1/purchase-orders/${po.id}`, { reason: `${reason}: reversão` },
          await simulation.version("procurement.purchase_order", po.id));
        console.log(`Deleted PO ${purchaseOrderNumber}.`);
      }
      return;
    }

    if (existing.length) {
      throw new Error(`Refusing to seed: PO ${purchaseOrderNumber} exists (${existing.map(row => row.lifecycle_status).join(", ")}).`);
    }
    const rows = (await pool.query(`SELECT external_line_reference AS line, product_code AS "productCode", description,
        ordered_quantity::text AS quantity, unit, unit_price::text AS "unitPrice", currency_code AS currency,
        cost_center AS "costCenter"
      FROM procurement.purchase_order_item
      WHERE purchase_order_id = $1 AND external_line_reference BETWEEN $2 AND $3
        AND upper(coalesce(source_status, '')) NOT IN ('CANCELLED', 'CANCELED')
      ORDER BY external_line_reference`, [sourceId, "0154", "0212"])).rows;
    if (rows.length !== 59 || rows.some(row => !/^\d+$/u.test(plain(row.quantity)))) {
      throw new Error(`PO ${sourcePurchaseOrderNumber} no longer has the 59 whole-unit lines 0154-0212 this plan copies.`);
    }

    const created = await call("POST", "/api/v1/purchase-orders/complete",
      purchaseOrderPayload({ importer, supplierText }, rows), simulation.key("po"), [201]);
    console.log(`Created PO ${purchaseOrderNumber} (${demandType}) with ${created.itemIds.length} products.`);
    const items = created.itemIds.map((itemId, index) => ({ itemId, line: lineReference(rows[index].line),
      quantity: plain(rows[index].quantity) }));
    for (const ip of simulationIps) {
      const mine = items.filter(item => ipForLine(item.line) === ip.ip);
      await createSimulationIp(simulation, { importer, supplierText, purchaseOrderId: created.id, purchaseOrderNumber,
        ipNumber: `${purchaseOrderNumber}-${ip.ip}/2026`, invoiceNumber: `HXSIMNMTS01${ip.ip}`, ip, allocations: mine,
        reason, notes: `Simulação E2E Não MTS: ${mine.length} linhas, com as datas do IP 030201-${ip.source}/2026.` });
    }

    const balance = (await pool.query(`SELECT count(*)::int AS lines,
        count(*) FILTER (WHERE i.ordered_quantity = coalesce(a.allocated, 0))::int AS fully_allocated,
        (SELECT demand_type FROM procurement.purchase_order WHERE id = $1) AS demand_type
      FROM procurement.purchase_order_item i
      LEFT JOIN (SELECT purchase_order_item_id, sum(quantity) AS allocated FROM procurement.po_item_allocation
        WHERE status = 'ACTIVE' GROUP BY 1) a ON a.purchase_order_item_id = i.id
      WHERE i.purchase_order_id = $1`, [created.id])).rows[0];
    if (balance.lines !== 59 || balance.fully_allocated !== 59 || balance.demand_type !== demandType) {
      throw new Error(`Allocation check failed: ${JSON.stringify(balance)}.`);
    }
    console.log(`Seeded run ${simulation.runId}: 2 IPs, 59/59 lines fully allocated, PO ${demandType}.`);
  } finally {
    await simulation.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
