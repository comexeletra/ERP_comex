import type { Pool } from "pg";
import ExcelJS from "exceljs";
import { moneyProduct, type calculateE2e, type E2eStageCode } from "./followup-calculations.js";
import type { ExportTone, ResolvedExportColumn } from "./export-columns.js";
import type { PostShipmentIp } from "./post-shipment-dashboard.js";
import { summarizePreShipmentLines, type PreShipmentAgingRange, type PreShipmentFilters,
  type PreShipmentLine } from "./pre-shipment-dashboard.js";
import type { ShipmentLine } from "./shipment-lines.js";

export type PurchaseOrderExportFilters = {
  number?: string;
  importer?: string;
  product?: string;
  ipNumber?: string;
  /** Lifecycle filter of the carteira screen; unset leaves out only the deleted POs. */
  lifecycle?: "active" | "cancelled" | "closed" | "deleted" | "all";
};

export type PurchaseOrderExportRow = {
  id: string;
  number: string;
  importer: string;
  lifecycleStatus: string;
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
    lifecycle_status: string;
    item_count: number;
    linked_process_count: number;
    items_with_ip: number;
    items_without_ip: number;
    unresolved_issue_count: number;
  }>(
    `SELECT count(*) OVER ()::int AS total_count,
            po.id, po.external_number AS number, po.importer, po.lifecycle_status,
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
       -- The same lifecycle filter as portfolioWhere() in purchase-orders.ts.
       AND ($6::text IS NULL AND po.lifecycle_status <> 'DELETED'
         OR $6::text = 'all'
         OR lower(po.lifecycle_status) = $6::text)
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
      filters.product || null, filters.ipNumber || null, filters.lifecycle ?? null],
  );

  return {
    totalCount: Number(result.rows[0]?.total_count ?? 0),
    rows: result.rows.map(row => ({
      id: row.id,
      number: row.number,
      importer: row.importer,
      lifecycleStatus: row.lifecycle_status,
      itemCount: Number(row.item_count),
      linkedProcessCount: Number(row.linked_process_count),
      itemsWithIp: Number(row.items_with_ip),
      itemsWithoutIp: Number(row.items_without_ip),
      unresolvedIssueCount: Number(row.unresolved_issue_count),
    })),
  };
}

/** Writes a sheet with the columns chosen on the screen; forecast values in italics, as on the screen. */
async function chosenColumnsXlsx<Row>(sheetName: string, columns: readonly ResolvedExportColumn<Row>[],
  rows: readonly Row[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Comex";
  workbook.created = new Date();
  addChosenColumnsSheet(workbook, sheetName, columns, rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Colors of the End to End stage groups in the file (ARGB): the header and the group line. The values take the
 * header color, stronger than the tint of the screen (user request, 2026-11-06). The light theme of the screen
 * (--color-stage-t*-bg and -border in apps/web/app/styles/tokens.css); test/export-columns.test.mjs fails when they diverge.
 */
export const exportStageColors: Record<E2eStageCode, { header: string; border: string }> = {
  T0: { header: "FFDBEAF6", border: "FF4A8CC7" },
  T1: { header: "FFE2EFD9", border: "FF6AA84F" },
  T2: { header: "FFFFF0C2", border: "FFD9A400" },
  T3: { header: "FFFCE0CF", border: "FFE5762F" },
  T4: { header: "FFF9D3DC", border: "FFD9577A" },
  T5: { header: "FFE3DDF4", border: "FF8A75C9" },
};
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
// One style object per stage, shared by its cells, so a large export does not hold a copy per cell.
const stageStyles = Object.fromEntries(Object.entries(exportStageColors).map(([code, colors]) => [code, {
  fill: solid(colors.header),
  border: { bottom: { style: "medium", color: { argb: colors.border } } } satisfies Partial<ExcelJS.Borders>,
}])) as Record<E2eStageCode, { fill: ExcelJS.Fill; border: Partial<ExcelJS.Borders> }>;

/**
 * Colors of the values with a color rule on the screen (ARGB): the background and text of the success, danger and
 * warning badges, light theme (--color-*-bg and -text in apps/web/app/styles/tokens.css); test/export-jobs.test.mjs
 * fails when they diverge.
 */
export const exportToneColors: Record<ExportTone, { fill: string; font: string }> = {
  good: { fill: "FFF1F7E1", font: "FF485A12" },
  bad: { fill: "FFFFF1F0", font: "FF9E1B1B" },
  warning: { fill: "FFFFF6DC", font: "FF7A5600" },
};
// One style object per tone, shared by its cells, as the stage styles.
const toneStyles = Object.fromEntries(Object.entries(exportToneColors).map(([tone, colors]) => [tone, {
  fill: solid(colors.fill), font: { bold: true, color: { argb: colors.font } } satisfies Partial<ExcelJS.Font>,
}])) as Record<ExportTone, { fill: ExcelJS.Fill; font: Partial<ExcelJS.Font> }>;

function addChosenColumnsSheet<Row>(workbook: ExcelJS.Workbook, sheetName: string,
  columns: readonly ResolvedExportColumn<Row>[], rows: readonly Row[]): void {
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(column => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  columns.forEach((column, index) => {
    if (!column.stage) return;
    const header = sheet.getRow(1).getCell(index + 1);
    header.fill = stageStyles[column.stage].fill;
    header.border = stageStyles[column.stage].border;
  });
  for (const row of rows) {
    const added = sheet.addRow(columns.map(column => column.value(row)));
    columns.forEach((column, index) => {
      if (column.stage) added.getCell(index + 1).fill = stageStyles[column.stage].fill;
      if (column.forecast?.(row)) added.getCell(index + 1).font = { italic: true, color: { argb: "FF6B7280" } };
      const tone = column.tone?.(row);
      if (tone) {
        added.getCell(index + 1).fill = toneStyles[tone].fill;
        added.getCell(index + 1).font = toneStyles[tone].font;
      }
    });
  }
}

// Labels of the Resumo sheet. The API writes the file in Portuguese, as the status values.
const agingLabels: Record<PreShipmentAgingRange, string> = {
  upTo45: "Até 45 dias", days45To60: "45 a 60 dias", days60To90: "60 a 90 dias", days90To120: "90 a 120 dias",
  days120Plus: "Acima de 120 dias",
};
const withoutSentDate = "Sem PO Sent Date";
const listFilters: [keyof PreShipmentFilters, string][] = [["demand", "Demanda"], ["requester", "Solicitante"],
  ["group", "Grupo"], ["supplier", "Fornecedor"], ["purpose", "Finalidade"], ["importers", "Importadora"], ["modes", "Modal"]];
const textFilters: [keyof PreShipmentFilters, string][] = [["purchaseOrder", "PO (contém)"], ["scNumber", "SC (contém)"],
  ["ipNumber", "IP (contém)"], ["productCode", "Código do produto (contém)"],
  ["productDescription", "Descrição do produto (contém)"]];

/** The filters of the export, one row each, in the order of the dashboard form; the chart selections first. */
function filterRows(filters: Partial<PreShipmentFilters>): [string, string][] {
  const rows: [string, string][] = [];
  const list = (values: unknown) => Array.isArray(values) && values.length ? values.join(", ") : "";
  if (filters.status?.length) rows.push(["Status", filters.status.join(", ")]);
  if (filters.aging?.length) rows.push(["Aging", filters.aging.map(range => agingLabels[range]).join(", ")]);
  if (filters.priority) rows.push(["Prioridade", filters.priority === "priority" ? "Prioridade" : "Normal"]);
  if (filters.direct) rows.push(["Direct", filters.direct === "direct" ? "Direct" : "Não direct"]);
  if (filters.ip) rows.push(["Distribuição em IP", filters.ip === "without" ? "Sem IP" : "Com IP"]);
  for (const [key, label] of listFilters) if (list(filters[key])) rows.push([label, list(filters[key])]);
  for (const [key, label] of textFilters) {
    const value = filters[key];
    if (typeof value === "string" && value) rows.push([label, value]);
  }
  if (filters.necessityFrom || filters.necessityTo) {
    rows.push(["Necessidade", `${filters.necessityFrom ?? "…"} a ${filters.necessityTo ?? "…"}`]);
  }
  return rows;
}

/**
 * Resumo sheet of the pre-shipment export, a pivot of the exported lines: the filters, products and item
 * quantity by status, the aging by range and the aging of each waiting status. Shares are fractions with a
 * percent format, so they can be summed and charted in Excel.
 */
function addPreShipmentSummarySheet(workbook: ExcelJS.Workbook, lines: readonly PreShipmentLine[],
  filters: Partial<PreShipmentFilters>, today: string): void {
  const pivot = summarizePreShipmentLines(lines, today);
  const sheet = workbook.addWorksheet("Resumo");
  sheet.columns = [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 16 }, { width: 18 }, { width: 18 },
    { width: 14 }];
  const bold = (row: ExcelJS.Row) => { row.font = { bold: true }; };
  const share = (value: number, total: number) => total > 0 ? value / total : 0;
  const percent = (row: ExcelJS.Row) => { row.getCell(3).numFmt = "0.0%"; row.getCell(5).numFmt = "0.0%"; };

  sheet.addRow(["Resumo do Pré Embarque"]).font = { bold: true, size: 14 };
  sheet.addRow(["Data de referência", today]);
  sheet.addRow(["Produtos exportados", pivot.totalProducts]);
  sheet.addRow([]);
  bold(sheet.addRow(["Filtros"]));
  const applied = filterRows(filters);
  for (const row of applied.length ? applied : [["Nenhum filtro", "Todas as linhas do painel"]]) sheet.addRow(row);

  sheet.addRow([]);
  bold(sheet.addRow(["Produtos por status"]));
  bold(sheet.addRow(["Status", "Produtos", "% produtos", "Quantidade de itens", "% quantidade"]));
  const totalQuantity = Number(pivot.totalQuantity);
  for (const [status, part] of Object.entries(pivot.byStatus)) {
    percent(sheet.addRow([status, part.products, share(part.products, pivot.totalProducts), Number(part.quantity),
      share(Number(part.quantity), totalQuantity)]));
  }
  const statusTotal = sheet.addRow(["Total", pivot.totalProducts, pivot.totalProducts > 0 ? 1 : 0, totalQuantity,
    totalQuantity > 0 ? 1 : 0]);
  bold(statusTotal); percent(statusTotal);

  sheet.addRow([]);
  bold(sheet.addRow(["Aging desde o envio da PO (A distribuir, Ag. produção e Ag. embarque)"]));
  bold(sheet.addRow(["Faixa", "Produtos", "% produtos", "Quantidade de itens", "% quantidade"]));
  const ranges = Object.keys(agingLabels) as PreShipmentAgingRange[];
  const agingProducts = ranges.reduce((sum, range) => sum + pivot.aging[range].products, 0);
  const agingQuantity = ranges.reduce((sum, range) => sum + Number(pivot.aging[range].quantity), 0);
  for (const range of ranges) {
    const part = pivot.aging[range];
    percent(sheet.addRow([agingLabels[range], part.products, share(part.products, agingProducts), Number(part.quantity),
      share(Number(part.quantity), agingQuantity)]));
  }
  const agingTotal = sheet.addRow(["Total", agingProducts, agingProducts > 0 ? 1 : 0, agingQuantity, agingQuantity > 0 ? 1 : 0]);
  bold(agingTotal); percent(agingTotal);
  sheet.addRow([withoutSentDate, pivot.agingWithoutSentDate.products, null, Number(pivot.agingWithoutSentDate.quantity)]);

  sheet.addRow([]);
  bold(sheet.addRow(["Aging por status (produtos)"]));
  bold(sheet.addRow(["Status / Faixa", ...ranges.map(range => agingLabels[range]), withoutSentDate, "Total"]));
  const columnTotals = new Array<number>(ranges.length + 2).fill(0);
  for (const [status, parts] of Object.entries(pivot.agingByStatus)) {
    const values = [...ranges.map(range => parts[range].products), parts.none.products];
    const rowTotal = values.reduce((sum, value) => sum + value, 0);
    [...values, rowTotal].forEach((value, index) => { columnTotals[index] += value; });
    sheet.addRow([status, ...values, rowTotal]);
  }
  bold(sheet.addRow(["Total", ...columnTotals]));
}

/**
 * The Pré Embarque dashboard export: the Resumo sheet (a pivot of the exported lines with the filters) and the
 * table with the chosen columns (every column of the table without a choice).
 */
export async function preShipmentXlsx(lines: readonly PreShipmentLine[],
  columns: readonly ResolvedExportColumn<PreShipmentLine>[],
  { filters = {}, today }: { filters?: Partial<PreShipmentFilters>; today: string }): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Comex";
  workbook.created = new Date();
  addPreShipmentSummarySheet(workbook, lines, filters, today);
  addChosenColumnsSheet(workbook, "Pré Embarque", columns, lines);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * The Pós Embarque dashboard export: the table of the IPs with the chosen columns (every column without a choice),
 * LT Doc, LT Clearance, SLA TXT and priority colored as their badges on the screen.
 */
export async function postShipmentXlsx(lines: readonly PostShipmentIp[],
  columns: readonly ResolvedExportColumn<PostShipmentIp>[]): Promise<Buffer> {
  return chosenColumnsXlsx("Pós Embarque", columns, lines);
}

/** Without chosen columns, the layout from before the column choice (8 columns). */
export async function purchaseOrderExportXlsx(rows: readonly PurchaseOrderExportRow[],
  columns?: readonly ResolvedExportColumn<PurchaseOrderExportRow>[]): Promise<Buffer> {
  if (columns) return chosenColumnsXlsx("Carteira de POs", columns, rows);
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

// Layout from before the column choice, used when a job has no chosen columns.
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

export async function purchaseOrderLinesXlsx(lines: readonly ShipmentLine[],
  columns?: readonly ResolvedExportColumn<ShipmentLine>[]): Promise<Buffer> {
  if (columns) return chosenColumnsXlsx("Carteira por produto", columns, lines);
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
