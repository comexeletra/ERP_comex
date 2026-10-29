#!/usr/bin/env node
// Acceptance data for the invoice IPH034A (Exporter aliases and equivalent units, M074) in the
// homologation database. PO 030201 of the simulation is fully allocated to IPs 030201-A…G, so a
// separate PO 030201 is created in another importer with the 196 products of the invoice, supplier
// EX000135 and the descriptions and prices of the simulation PO. Every write goes through the real
// API routes of the active HML release. Copy this file, hml-simulation.mjs and the invoice draft
// (the JSON the review screen builds from the workbook) to one directory on the VPS and run:
//
//   MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env \
//     seed-hml-iph034a-acceptance.mjs apply|candidates|revert <draft.json>
//
// `apply` refuses to run while the importer has a PO 030201 that is not deleted; `candidates` prints,
// read only, the invoice candidates the review screen loads; `revert` cancels the allocations and
// invoice of IP IPH034A/2026 in this importer, deletes that IP and then deletes the PO.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openHmlSimulation, revertProcesses } from "./hml-simulation.mjs";

export const importer = "ELETRA INDUSTRIA E COMERCIO( GALPAO-FORTALEZA )";
export const simulationImporter = "ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L";
export const purchaseOrderNumber = "030201";
export const ipNumber = "IPH034A/2026";
const supplierCode = "EX000135";
const reason = "Aceite da invoice IPH034A: apelidos de Exporter e unidades equivalentes (HML)";

function price(value) {
  return String(Number(Number(value).toFixed(8)));
}

/** One PO product per invoice line, in UN, with the description and price of the simulation PO when it has them. */
export function purchaseOrderItems(lines, reference, itemReason) {
  const seen = new Set();
  return lines.map((line, index) => {
    if (seen.has(line.productCode)) throw new Error(`Product ${line.productCode} appears twice in the invoice.`);
    seen.add(line.productCode);
    const known = reference.get(line.productCode);
    return { base: { externalLineReference: String(index + 1).padStart(4, "0"), productCode: line.productCode,
      description: known?.description ?? line.description, orderedQuantity: line.quantity, unit: "UN",
      unitPrice: price(known?.unitPrice ?? line.unitPrice), currency: "CNY", reason: itemReason }, fields: {} };
  });
}

async function activePurchaseOrder(pool) {
  return (await pool.query(`SELECT id, lifecycle_status FROM procurement.purchase_order
    WHERE importer = $1 AND normalized_number = $2 AND lifecycle_status <> 'DELETED'`,
  [importer, purchaseOrderNumber])).rows[0] ?? null;
}

async function apply(simulation, draft) {
  const { pool, call, key } = simulation;
  if (await activePurchaseOrder(pool)) throw new Error(`${importer} already has PO ${purchaseOrderNumber}.`);
  const reference = new Map((await pool.query(`SELECT item.product_code, item.description, item.unit_price::text
    FROM procurement.purchase_order_item item JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
    WHERE po.importer = $1 AND po.normalized_number = $2 AND po.lifecycle_status = 'ACTIVE'`,
  [simulationImporter, purchaseOrderNumber])).rows.map(row => [row.product_code,
    { description: row.description, unitPrice: row.unit_price }]));
  const items = purchaseOrderItems(draft.lines, reference, reason);
  const created = await call("POST", "/api/v1/purchase-orders/complete", { header: { importer,
    number: purchaseOrderNumber, supplierText: supplierCode, orderDate: null,
    notes: "PO de teste para o aceite da invoice IPH034A; a PO 030201 da simulação está toda distribuída.",
    confirmDuplicateNumber: true, duplicateNumberJustification: "Cópia de teste da PO 030201 para a invoice IPH034A (HML).",
    reason }, items }, key("po"), [201]);
  console.log(`PO ${purchaseOrderNumber} (${importer}): ${created.itemIds.length} products, id ${created.id}.`);
}

async function candidates(simulation) {
  const result = await simulation.call("POST", "/api/v1/purchase-orders/invoice-candidates/batch",
    { importer, revisingIpNumber: ipNumber, poNumbers: [purchaseOrderNumber] });
  console.log(JSON.stringify(result));
}

async function revert(simulation) {
  const { pool, call, version } = simulation;
  const processes = (await pool.query(`SELECT id, ip_number FROM imports.import_process
    WHERE importer = $1 AND normalized_ip_number = upper($2) AND record_status <> 'DELETED'`, [importer, ipNumber])).rows;
  await revertProcesses(simulation, processes, reason);
  const po = await activePurchaseOrder(pool);
  if (po) {
    await call("DELETE", `/api/v1/purchase-orders/${po.id}`, { reason: `${reason}: reversão` },
      await version("procurement.purchase_order", po.id));
    console.log(`Deleted PO ${purchaseOrderNumber} of ${importer}.`);
  }
}

async function main() {
  const [mode, draftFile] = process.argv.slice(2);
  if (!["apply", "candidates", "revert"].includes(mode) || (mode === "apply" && !draftFile)) {
    throw new Error("Usage: seed-hml-iph034a-acceptance.mjs apply <draft.json> | candidates | revert");
  }
  const simulation = await openHmlSimulation("iph034a");
  try {
    simulation.useImporter(importer);
    if (mode === "apply") await apply(simulation, JSON.parse(await readFile(draftFile, "utf8")));
    else if (mode === "candidates") await candidates(simulation);
    else await revert(simulation);
  } finally { await simulation.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
