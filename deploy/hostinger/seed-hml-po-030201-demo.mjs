#!/usr/bin/env node
// Seeds (or reverts) a realistic end-to-end simulation of PO 030201 in the homologation
// database. Every write goes through the real API routes of the active HML release, so
// the usual validation, audit and outbox apply. Copy this file and hml-simulation.mjs to
// one directory on the VPS and run:
//
//   MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env seed-hml-po-030201-demo.mjs apply|revert|demand-type
//
// The dates follow the real Follow Up rows of PO 030201 (need 2026-12-01, SC approved
// 2026-08-21, PO sent 2026-08-24, ETD 2026-10-08 / ETA 2026-12-02) and the E2E lead times
// (MTS 30 days in the HQ; 55 days by sea, 10 by air; 10 days to clear and deliver), as seen
// on 2026-10-26. The whole PO is MTS; its Não MTS counterpart is seed-hml-po-nmts-demo.mjs.
// `apply` refuses to run while simulation IPs or active allocations of the PO exist;
// `revert` cancels the simulation allocations and invoices and deletes those IPs;
// `demand-type` only sets the PO demand type of a simulation already seeded.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSimulationIp, openHmlSimulation, revertProcesses, setPurchaseOrderDemandType } from "./hml-simulation.mjs";

export const purchaseOrderNumber = "030201";
export const ipNumberPattern = /^030201-[A-G]\/2026$/u;
const revertPatterns = ["030201-_/2026", "DEMO-030201-IP%"];
const reason = "Simulação end-to-end da PO 030201 (HML)";
/** The demand type belongs to the PO: every product of 030201 is planned as MTS. */
export const demandType = "MTS";

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
  { ip: "A", lines: [[112, 130], [213, 215]], factoryShipDate: "2026-09-21", invoiceDate: "2026-09-22",
    expected: { status: "ENTREGUE", eta: "2026-10-05" },
    fields: { ...air, etd: "2026-09-25", blNumber: "176-48213350", blDate: "2026-09-25",
      actualPortDepartureDate: "2026-09-26", etaConfirmed: "2026-10-05", arrivalDate: "2026-10-05",
      duimpNumber: "26BR0001523456-1", duimpDate: "2026-10-07", customsChannel: "GREEN",
      clearanceDate: "2026-10-09", deliveryDate: "2026-10-14", documentsOk: true } },
  { ip: "B", lines: [[1, 58]], factoryShipDate: "2026-09-23", invoiceDate: "2026-09-24",
    expected: { status: "AGUARDANDO CHEGADA", eta: "2026-11-22" },
    fields: { ...sea, containerType: "40'HC", containerQuantity: 1, etd: "2026-09-28",
      blNumber: "SDBLBS612041", blDate: "2026-09-29", actualPortDepartureDate: "2026-09-30", documentsOk: true } },
  { ip: "C", lines: [[59, 111]], factoryShipDate: "2026-09-30", invoiceDate: "2026-10-01",
    expected: { status: "AGUARDANDO CHEGADA", eta: "2026-12-02" },
    fields: { ...sea, containerType: "40'HC", containerQuantity: 1, etd: "2026-10-08",
      blNumber: "SDBLBS615530", blDate: "2026-10-10", actualPortDepartureDate: "2026-10-11", documentsOk: true } },
  { ip: "D", lines: [[154, 177]], factoryShipDate: "2026-10-08", invoiceDate: "2026-10-09",
    expected: { status: "DESEMBARAÇO", eta: "2026-10-22" },
    fields: { ...air, etd: "2026-10-13", blNumber: "176-48877412", blDate: "2026-10-13",
      actualPortDepartureDate: "2026-10-14", etaConfirmed: "2026-10-22", arrivalDate: "2026-10-22",
      duimpNumber: "26BR0001589934-7", duimpDate: "2026-10-23", customsChannel: "YELLOW" } },
  { ip: "E", lines: [[178, 212]], factoryShipDate: "2026-10-20", invoiceDate: "2026-10-21",
    expected: { status: "AGUARDANDO EMBARQUE", eta: "2026-12-27" },
    fields: { ...sea, containerType: "20' DRY", containerQuantity: 1, etd: "2026-11-02" } },
  { ip: "F", lines: [[131, 153]], factoryShipDate: "2026-11-04", invoiceDate: null,
    expected: { status: "AGUARDANDO PRODUÇÃO", eta: "2026-11-16" },
    fields: { ...air, etd: "2026-11-06" } },
  { ip: "G", lines: [], split: { from: ["B", "C"], largest: 5, share: 0.3 },
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
  if (!["apply", "revert", "demand-type"].includes(mode)) {
    throw new Error("Use: seed-hml-po-030201-demo.mjs apply|revert|demand-type");
  }
  const simulation = await openHmlSimulation("po-030201");
  const { pool, call } = simulation;
  try {
    const po = (await pool.query(`SELECT id, importer, supplier_text FROM procurement.purchase_order
      WHERE external_number = $1 AND lifecycle_status = 'ACTIVE'`, [purchaseOrderNumber])).rows;
    if (po.length !== 1) throw new Error(`Expected one active PO ${purchaseOrderNumber}, found ${po.length}.`);
    const { id: purchaseOrderId, importer, supplier_text: supplierText } = po[0];
    simulation.useImporter(importer);
    const simulationProcesses = async () => (await pool.query(`SELECT id, ip_number FROM imports.import_process
      WHERE ip_number LIKE ANY($1::text[]) AND record_status <> 'DELETED' ORDER BY ip_number`, [revertPatterns])).rows;

    if (mode === "revert") {
      await revertProcesses(simulation, await simulationProcesses(), reason);
      return;
    }
    if (mode === "demand-type") {
      await setPurchaseOrderDemandType(simulation, purchaseOrderId, demandType, reason);
      console.log(`PO ${purchaseOrderNumber} demand type: ${demandType}.`);
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

    // Pre-shipment: dates shared by the PO lines (and SC 020028), then the demand type of the PO.
    const poVersion = (await simulation.version("procurement.purchase_order", purchaseOrderId))["X-Record-Version"];
    const shared = await call("PATCH", `/api/v1/purchase-orders/${purchaseOrderId}/items/followup`,
      { itemIds: items.map(item => item.id), fields: sharedFields, reason }, { "X-Record-Version": poVersion });
    await setPurchaseOrderDemandType(simulation, purchaseOrderId, demandType, reason);
    console.log(`Shared pre-shipment dates set on ${items.length} lines (SC synced: ${shared.purchaseRequestUpdated}); PO ${demandType}.`);

    const allocations = allocationPlan(items);
    for (const ip of simulationIps) {
      const mine = allocations.filter(entry => entry.ip === ip.ip);
      await createSimulationIp(simulation, { importer, supplierText, purchaseOrderId, purchaseOrderNumber,
        ipNumber: `030201-${ip.ip}/2026`, invoiceNumber: `HX26030201${ip.ip}`, ip, allocations: mine, reason,
        notes: `Simulação E2E da PO ${purchaseOrderNumber}: ${mine.length} linhas${ip.split ? " (saldo parcial de B e C)" : ""}.` });
    }

    const balance = (await pool.query(`SELECT count(*)::int AS lines,
        count(*) FILTER (WHERE i.ordered_quantity = coalesce(a.allocated, 0))::int AS fully_allocated,
        (SELECT demand_type FROM procurement.purchase_order WHERE id = $1) AS demand_type
      FROM procurement.purchase_order_item i
      LEFT JOIN (SELECT purchase_order_item_id, sum(quantity) AS allocated FROM procurement.po_item_allocation
        WHERE status = 'ACTIVE' GROUP BY 1) a ON a.purchase_order_item_id = i.id
      WHERE i.purchase_order_id = $1`, [purchaseOrderId])).rows[0];
    if (balance.lines !== 215 || balance.fully_allocated !== 215 || balance.demand_type !== demandType) {
      throw new Error(`Allocation check failed: ${JSON.stringify(balance)}.`);
    }
    console.log(`Seeded run ${simulation.runId}: 7 IPs, ${allocations.length} allocations, 215/215 lines fully allocated, PO ${demandType}.`);
  } finally {
    await simulation.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
