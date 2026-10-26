import type { Pool } from "pg";
import ExcelJS from "exceljs";
import { moneyProduct, type calculateE2e, type E2eStageCode } from "./followup-calculations.js";
import type { ShipmentLine } from "./shipment-lines.js";

export type PurchaseOrderExportFilters = {
  number?: string;
  importer?: string;
  product?: string;
  ipNumber?: string;
};

export type PurchaseOrderExportRow = {
  id: string;
  number: string;
  importer: string;
  itemCount: number;
  linkedProcessCount: number;
  itemsWithIp: number;
  itemsWithoutIp: number;
  unresolvedIssueCount: number;
};

export async function queryPurchaseOrderExport(
  pool: Pool,
  importerScopes: readonly string[],
  filters: PurchaseOrderExportFilters,
): Promise<{ totalCount: number; rows: PurchaseOrderExportRow[] }> {
  const result = await pool.query<{
    total_count: number;
    id: string;
    number: string;
    importer: string;
    item_count: number;
    linked_process_count: number;
    items_with_ip: number;
    items_without_ip: number;
    unresolved_issue_count: number;
  }>(
    `SELECT count(*) OVER ()::int AS total_count,
            po.id, po.external_number AS number, po.importer,
            (SELECT count(*)::int FROM procurement.purchase_order_item AS item
             WHERE item.purchase_order_id = po.id) AS item_count,
            (SELECT count(*)::int FROM procurement.process_purchase_order AS link
             JOIN imports.import_process AS process ON process.id = link.process_id
             WHERE link.purchase_order_id = po.id AND process.importer = ANY($1::text[]))
              AS linked_process_count,
            (SELECT count(*)::int FROM procurement.purchase_order_item AS item
             WHERE item.purchase_order_id = po.id
               AND upper(coalesce(item.source_status, '')) NOT IN ('CANCELLED', 'CANCELED')
               AND EXISTS (SELECT 1 FROM procurement.po_item_allocation AS allocation
                           WHERE allocation.purchase_order_item_id = item.id
                             AND allocation.status = 'ACTIVE')) AS items_with_ip,
            (SELECT count(*)::int FROM procurement.purchase_order_item AS item
             WHERE item.purchase_order_id = po.id
               AND upper(coalesce(item.source_status, '')) NOT IN ('CANCELLED', 'CANCELED')
               AND NOT EXISTS (SELECT 1 FROM procurement.po_item_allocation AS allocation
                               WHERE allocation.purchase_order_item_id = item.id
                                 AND allocation.status = 'ACTIVE')) AS items_without_ip,
            (SELECT count(DISTINCT issue.id)::int
             FROM migration.data_issue AS issue
             JOIN procurement.po_line_observation AS observation
               ON observation.source_row_id = issue.source_row_id
             WHERE observation.purchase_order_id = po.id AND issue.status = 'OPEN')
              AS unresolved_issue_count
     FROM procurement.purchase_order AS po
     WHERE po.importer = ANY($1::text[])
       AND po.lifecycle_status <> 'DELETED'
       AND ($2::text IS NULL OR strpos(po.normalized_number, upper($2)) > 0)
       AND ($3::text IS NULL OR strpos(lower(po.importer), lower($3)) > 0)
       AND ($4::text IS NULL OR EXISTS (
         SELECT 1 FROM procurement.po_line_observation AS observation
         WHERE observation.purchase_order_id = po.id
           AND (strpos(lower(coalesce(observation.product_code_snapshot, '')), lower($4)) > 0
             OR strpos(lower(coalesce(observation.description_snapshot, '')), lower($4)) > 0)
       ) OR EXISTS (
         SELECT 1 FROM procurement.purchase_order_item AS item
         WHERE item.purchase_order_id = po.id
           AND (strpos(lower(item.product_code), lower($4)) > 0
             OR strpos(lower(item.description), lower($4)) > 0)
       ))
       AND ($5::text IS NULL OR EXISTS (
         SELECT 1 FROM procurement.process_purchase_order AS link
         JOIN imports.import_process AS process ON process.id = link.process_id
         WHERE link.purchase_order_id = po.id
           AND process.importer = ANY($1::text[])
           AND strpos(lower(process.ip_number), lower($5)) > 0
       ))
     ORDER BY po.normalized_number, po.id
     LIMIT 5001`,
    [importerScopes, filters.number || null, filters.importer || null,
      filters.product || null, filters.ipNumber || null],
  );

  return {
    totalCount: Number(result.rows[0]?.total_count ?? 0),
    rows: result.rows.map(row => ({
      id: row.id,
      number: row.number,
      importer: row.importer,
      itemCount: Number(row.item_count),
      linkedProcessCount: Number(row.linked_process_count),
      itemsWithIp: Number(row.items_with_ip),
      itemsWithoutIp: Number(row.items_without_ip),
      unresolvedIssueCount: Number(row.unresolved_issue_count),
    })),
  };
}

export async function purchaseOrderExportXlsx(rows: readonly PurchaseOrderExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Comex";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Carteira de POs", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "ID", key: "id", width: 38 },
    { header: "PO TOTVS", key: "number", width: 22 },
    { header: "Importador", key: "importer", width: 34 },
    { header: "Itens", key: "itemCount", width: 12 },
    { header: "IPs vinculados", key: "linkedProcessCount", width: 18 },
    { header: "Itens com IP", key: "itemsWithIp", width: 16 },
    { header: "Itens sem IP", key: "itemsWithoutIp", width: 16 },
    { header: "Pend\u00eancias abertas", key: "unresolvedIssueCount", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: "A1", to: "H1" };
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

type Cell = string | number | null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const decimal = (value: unknown): number | null => {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const e2e = (line: ShipmentLine) => (line.calculated as { e2e?: ReturnType<typeof calculateE2e> }).e2e ?? null;
const e2eStage = (line: ShipmentLine, code: E2eStageCode) => e2e(line)?.stages[code] ?? null;

// Columns B:AZ of the Pré Embarque sheet, in order, so the export can replace it;
// new data the sheet never had comes after them. IP costs are not repeated per line.
const lineColumns: [string, (line: ShipmentLine) => Cell][] = [
  ["Necessity", line => text(line.item.necessityDate)], ["Priority", line => text(line.item.priority)],
  ["Alert", line => text(line.calculated.alert)], ["Status", line => text(line.calculated.status)],
  ["Importer", line => text(line.purchaseOrder.importer)],
  ["Demand", line => text(line.item.demand)], ["Requester", line => text(line.item.requester)],
  ["SC Totvs", line => text(line.item.scNumber)], ["SC Appr. Date", line => text(line.item.scApprovalDate)],
  ["Finalidade", line => text(line.item.purpose)], ["Cost Center", line => text(line.item.costCenter)],
  ["Draft PO", line => text(line.item.draftPo)],
  ["PO Totvs", line => text(line.purchaseOrder.number)],
  ["PO Date", line => text(line.purchaseOrder.orderDate)],
  ["PO Appr. Date", line => text(line.item.poApprovalDate)], ["PO Sent Date", line => text(line.item.poSentDate)],
  ["Supplier", line => text(line.purchaseOrder.supplierText)],
  ["Category", line => text(line.item.category)], ["Product Code", line => text(line.item.productCode)],
  ["Product Description", line => text(line.item.description)], ["NCM", line => text(line.item.ncm)],
  ["Qty", line => decimal(line.quantity)], ["Unit Price", line => decimal(line.item.unitPrice)],
  ["Total Price", line => decimal(moneyProduct(line.quantity, line.item.unitPrice))],
  ["Currency", line => text(line.item.currencyCode)], ["Remarks", line => text(line.item.remarks)],
  ["IP Number", line => text(line.process?.ipNumber)], ["IP Date Totvs", line => text(line.process?.ipTotvsDate)],
  ["Mode", line => text(line.process?.transportMode)], ["Incoterm", line => text(line.process?.incoterm)],
  ["Broker", line => text(line.process?.broker)], ["POL", line => text(line.process?.portLoading)],
  ["POD", line => text(line.process?.portDischarge)], ["ETD", line => text(line.process?.etd)],
  ["ETA", line => text(line.calculated.eta)], ["Transit Time", line => decimal(line.calculated.transitDays)],
  ["Invoice", line => Array.isArray(line.calculated.invoiceNumbers) && line.calculated.invoiceNumbers.length
    ? line.calculated.invoiceNumbers.join(", ") : null],
  ["BL Number", line => text(line.process?.blNumber)], ["BL Date", line => text(line.process?.blDate)],
  ["Arrival", line => text(line.process?.arrivalDate)], ["Duimp", line => text(line.process?.duimpNumber)],
  ["Duimp Date", line => text(line.process?.duimpDate)], ["Channel", line => text(line.process?.customsChannel)],
  ["Clearance", line => text(line.process?.clearanceDate)], ["ETE", line => text(line.calculated.ete)],
  ["NF Request", line => text(line.process?.nfRequestDate)], ["NF", line => text(line.calculated.nfNumber)],
  ["NF Issue Date", line => text(line.calculated.nfIssueDate)], ["Delivery Date", line => text(line.process?.deliveryDate)],
  ["LT Total", line => decimal(line.calculated.leadTimeDays)], ["Rupture Risk", line => text(line.calculated.ruptureRisk)],
  ["Departure", line => text(line.process?.actualPortDepartureDate)],
  ["Factory Ship Date", line => text(line.factoryShipDate)],
  ["Demand Type", line => text(line.item.demandType)],
  // End to End, as in the original spreadsheet; open stages use the forecast dates listed in "E2E Forecast Stages".
  ...(["T0", "T1", "T2", "T3", "T4", "T5"] as const).flatMap(code => [
    [`${code} Deadline`, line => text(e2eStage(line, code)?.deadline)],
    [`${code} Actual`, line => text(e2eStage(line, code)?.actual)],
    [`${code} Target Days`, line => decimal(e2eStage(line, code)?.targetDays)],
    [`${code} Actual Days`, line => decimal(e2eStage(line, code)?.actualDays)],
    [`${code} Delay Days`, line => decimal(e2eStage(line, code)?.delayDays)],
  ] as [string, (line: ShipmentLine) => Cell][]),
  ["Total Target Days", line => decimal(e2e(line)?.totalTargetDays)],
  ["Total Actual Days", line => decimal(e2e(line)?.totalActualDays)],
  ["Total Delay Days", line => decimal(e2e(line)?.totalDelayDays)],
  ["Bottleneck Stage", line => text(e2e(line)?.bottleneck)],
  ["Current Status", line => text(e2e(line)?.currentStatus)],
  ["Arrival YM", line => text(e2e(line)?.arrivalYearMonth)],
  ["E2E Forecast Stages", line => {
    const stages = e2e(line)?.stages;
    return stages ? Object.entries(stages).filter(([, stage]) => stage.source === "forecast").map(([code]) => code).join(", ") || null : null;
  }],
  ["Line Type", line => line.lineKind === "BALANCE" ? "Saldo sem IP" : "Distribuição no IP"],
];

export async function purchaseOrderLinesXlsx(lines: readonly ShipmentLine[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Comex";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Carteira por produto", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = lineColumns.map(([header]) => ({ header, key: header, width: Math.max(12, header.length + 4) }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lineColumns.length } };
  for (const line of lines) sheet.addRow(lineColumns.map(([, value]) => value(line)));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
