import type { Cell, Worksheet } from "exceljs";
import type { Messages } from "./i18n/pt-BR";

const maxFileBytes = 10 * 1024 * 1024;

export type InvoicePoAssignment = { poNumber: string; quantity: string; explicitQuantity: boolean };

export type ChinaInvoiceLine = {
  sourceRow: number;
  lineNumber: string;
  ncm: string;
  productCode: string;
  description: string;
  manufacturer: string;
  manufacturerAddress: string;
  manufacturerCountry: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  netWeightKg: string;
  grossWeightKg: string;
  amount: string;
  poCell: string;
  poAssignments: InvoicePoAssignment[];
  issues: string[];
};

export type ChinaInvoiceDraft = {
  fileName: string;
  fileSha256: string;
  ipNumber: string;
  importerText: string;
  importerCnpj: string;
  exporterText: string;
  invoiceNumber: string;
  invoiceDate: string;
  headerPoNumber: string;
  originText: string;
  destinationText: string;
  incoterm: string;
  countryOfOrigin: string;
  countryOfAcquisition: string;
  countryOfPrecedence: string;
  paymentTerms: string;
  lines: ChinaInvoiceLine[];
  totalQuantity: string;
  totalNetWeightKg: string;
  totalGrossWeightKg: string;
  totalAmount: string;
  issues: string[];
  warnings: string[];
};

function valueOf(cell: Cell): unknown {
  const value = cell.value;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null) {
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map(part => part.text).join("");
    }
    return null;
  }
  return value;
}

function textOf(cell: Cell): string {
  const value = valueOf(cell);
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const zeroFormat = /^0+$/u.test(cell.numFmt ?? "") ? cell.numFmt : "";
    const integer = String(value);
    return zeroFormat && Number.isInteger(value) ? integer.padStart(zeroFormat.length, "0") : integer;
  }
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en").replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function decimalValue(value: string): number | null {
  if (!value) return null;
  let normalized = value.trim().replace(/\s/gu, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./gu, "").replace(",", ".")
      : normalized.replace(/,/gu, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(",", ".");
  }
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function decimalCell(cell: Cell): string {
  const value = valueOf(cell);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return decimalValue(textOf(cell)) === null ? "" : String(decimalValue(textOf(cell)));
}

/** Parses both the preferred one-PO-per-row format and legacy multi-PO cells. */
export function parseInvoicePoAssignments(value: string, lineQuantity: string, m: Messages): InvoicePoAssignment[] {
  const t = m.invoiceSheet;
  const quantity = decimalValue(lineQuantity);
  if (quantity === null || quantity <= 0) throw new Error(t.invalidLineQuantity);

  const pattern = /\bPO\s*([0-9]{3,})(?:\s*=\s*([0-9][0-9,.]*)\s*(?:units?|pcs?)\b)?/giu;
  const matches = [...value.matchAll(pattern)];
  const residue = value.replace(pattern, "").replace(/[\s,;]+/gu, "");
  if (!matches.length || residue) throw new Error(t.poUnreadable);
  if (matches.length > 1 && matches.some(match => !match[2])) {
    throw new Error(t.splitNeedsQuantity);
  }

  const allocations = matches.map(match => {
    const allocated = match[2] ? decimalValue(match[2]) : quantity;
    if (allocated === null || allocated <= 0) throw new Error(t.poQuantityPositive);
    return { poNumber: match[1], quantity: String(allocated), explicitQuantity: Boolean(match[2]) };
  });
  const sum = allocations.reduce((total, allocation) => total + Number(allocation.quantity), 0);
  if (Math.abs(sum - quantity) > 0.00000001) {
    throw new Error(t.poSumMismatch);
  }

  return allocations;
}

function headerColumns(sheet: Worksheet): { row: number; columns: Map<string, number> } | null {
  for (let row = 1; row <= Math.min(sheet.rowCount, 30); row += 1) {
    const columns = new Map<string, number>();
    sheet.getRow(row).eachCell({ includeEmpty: false }, (cell, column) => {
      const name = normalizeHeader(textOf(cell));
      if (name && !columns.has(name)) columns.set(name, column);
    });
    if (["no", "ncm", "material code", "product description", "qty unit", "po"]
      .every(name => columns.has(name))) return { row, columns };
  }
  return null;
}

function headerValue(sheet: Worksheet, label: string): string {
  const expected = normalizeHeader(label);
  for (let row = 1; row <= Math.min(sheet.rowCount, 25); row += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const headerText = textOf(sheet.getRow(row).getCell(column));
      if (headerText.toLocaleUpperCase("en-US").startsWith(label.toLocaleUpperCase("en-US"))) {
        const inlineValue = headerText.slice(label.length).replace(/^[\s:.]+/u, "").trim();
        if (inlineValue) return inlineValue;
      }
      if (normalizeHeader(headerText) !== expected) continue;
      const cell = sheet.getRow(row).getCell(column + 1);
      const value = valueOf(cell);
      if (expected === "date" && typeof value === "number" && Number.isFinite(value)) {
        return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
      }
      return textOf(cell);
    }
  }
  return "";
}

function invoiceDate(value: string): string {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  const brazilian = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text);
  const months: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const english = /^([A-Za-z]{3})[.,]?\s+(\d{1,2})\s*(?:st|nd|rd|th|of)?[,]?\s+(\d{4})$/iu.exec(text);
  const year = iso ? Number(iso[1]) : brazilian ? Number(brazilian[3]) : english ? Number(english[3]) : 0;
  const month = iso ? Number(iso[2]) : brazilian ? Number(brazilian[2]) : english ? months[english[1].toUpperCase()] : 0;
  const day = iso ? Number(iso[3]) : brazilian ? Number(brazilian[1]) : english ? Number(english[2]) : 0;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
}

function cnpjDigits(value: string): string {
  const match = value.match(/\b(?:\d{2}[.]?\d{3}[.]?\d{3}\/?\d{4}-?\d{2}|\d{14})\b/u);
  return match ? match[0].replace(/\D/gu, "") : "";
}

function parseLine(sheet: Worksheet, rowNumber: number, columns: Map<string, number>, m: Messages): ChinaInvoiceLine {
  const t = m.invoiceSheet;
  const get = (key: string) => textOf(sheet.getRow(rowNumber).getCell(columns.get(key)!));
  const issues: string[] = [];
  const quantity = decimalCell(sheet.getRow(rowNumber).getCell(columns.get("qty pcs kgs mts")!));
  const amount = decimalCell(sheet.getRow(rowNumber).getCell(columns.get("total cny")!));
  const priceCell = sheet.getRow(rowNumber).getCell(columns.get("price cny")!);
  const priceValue = valueOf(priceCell);
  const amountNumber = decimalValue(amount);
  const quantityNumber = decimalValue(quantity);
  const formulaPrice = typeof priceValue === "object" && priceValue !== null && "result" in priceValue
    ? Number(priceValue.result) : decimalValue(textOf(priceCell));
  const unitPrice = Number.isFinite(formulaPrice) ? String(formulaPrice)
    : amountNumber !== null && quantityNumber !== null && quantityNumber > 0
      ? String(amountNumber / quantityNumber) : "";

  if (!get("material code")) issues.push(t.materialCodeEmpty);
  if (!/^\d{8}$/u.test(get("ncm"))) issues.push(t.ncmDigits);
  if (!get("product description")) issues.push(t.descriptionEmpty);
  if (!quantityNumber || quantityNumber <= 0) issues.push(t.quantityPositive);
  if (!get("qty unit")) issues.push(t.unitEmpty);
  if (amountNumber === null || amountNumber < 0) issues.push(t.lineTotalInvalid);
  if (!unitPrice) issues.push(t.unitPriceMissing);
  if (!get("po")) issues.push(t.poEmpty);

  let poAssignments: InvoicePoAssignment[] = [];
  if (quantity && get("po")) {
    try { poAssignments = parseInvoicePoAssignments(get("po"), quantity, m); }
    catch (error) { issues.push(error instanceof Error ? error.message : t.poInvalid); }
  }

  if (quantityNumber !== null && amountNumber !== null && unitPrice) {
    if (Math.abs(quantityNumber * Number(unitPrice) - amountNumber) > 0.011) {
      issues.push(t.lineTotalMismatch);
    }
  }

  return {
    sourceRow: rowNumber, lineNumber: get("no"), ncm: get("ncm"), productCode: get("material code"),
    description: get("product description"), manufacturer: get("manufacturer"),
    manufacturerAddress: get("manufacturer s address"), manufacturerCountry: get("manufacturer s country"),
    quantity, unit: get("qty unit"), unitPrice, netWeightKg: get("net weight kg"),
    grossWeightKg: get("gross weight kg"), amount, poCell: get("po"), poAssignments, issues,
  };
}

export async function parseChinaInvoiceXlsx(file: File, m: Messages): Promise<ChinaInvoiceDraft> {
  const t = m.invoiceSheet;
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
    throw new Error(t.xlsxRequired);
  }
  if (file.size === 0 || file.size > maxFileBytes) {
    throw new Error(t.fileSize);
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const bytes = await file.arrayBuffer();
  try { await workbook.xlsx.load(bytes); }
  catch { throw new Error(t.unreadable); }
  const sheet = workbook.getWorksheet("INV");
  if (!sheet) throw new Error(t.invMissing);
  const header = headerColumns(sheet);
  if (!header) throw new Error(t.headerMissing);
  const { row: headerRow, columns } = header;
  if (!columns.has("price cny") || !columns.has("total cny")) {
    throw new Error(t.cnyRequired);
  }
  const required = ["no", "ncm", "material code", "product description", "manufacturer",
    "manufacturer s address", "manufacturer s country", "qty pcs kgs mts", "qty unit", "price cny",
    "net weight kg", "gross weight kg", "total cny", "po"];
  const missingHeaders = required.filter(key => !columns.has(key));
  if (missingHeaders.length) throw new Error(t.missingColumns(missingHeaders.join(", ")));

  const lines: ChinaInvoiceLine[] = [];
  let totalRow = 0;
  for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
    let hasTotal = false;
    sheet.getRow(row).eachCell({ includeEmpty: false }, cell => {
      if (normalizeHeader(textOf(cell)) === "total") hasTotal = true;
    });
    if (hasTotal && !totalRow) totalRow = row;
    const lineNo = textOf(sheet.getRow(row).getCell(columns.get("no")!));
    if (!/^\d+$/u.test(lineNo)) continue;
    lines.push(parseLine(sheet, row, columns, m));
  }
  if (!lines.length) throw new Error(t.noProducts);
  const lastLineRow = lines.at(-1)!.sourceRow;
  for (let row = lastLineRow + 1; row <= Math.min(sheet.rowCount, lastLineRow + 10); row += 1) {
    if (["qty pcs kgs mts", "net weight kg", "gross weight kg", "total cny"]
      .every(key => decimalValue(decimalCell(sheet.getRow(row).getCell(columns.get(key)!))) !== null)) {
      totalRow = row;
      break;
    }
  }

  const sum = (select: (line: ChinaInvoiceLine) => string) => {
    const total = lines.reduce((sumValue, line) => {
      const amount = decimalValue(select(line));
      return sumValue + (amount ?? 0);
    }, 0);
    return String(Number(total.toFixed(8)));
  };
  const warnings: string[] = [];
  const issues: string[] = [];
  if (!totalRow) issues.push(t.totalRowMissing);
  else for (const [column, value, label] of [
    ["qty pcs kgs mts", sum(line => line.quantity), t.totalLabels.quantity],
    ["net weight kg", sum(line => line.netWeightKg), t.totalLabels.netWeight],
    ["gross weight kg", sum(line => line.grossWeightKg), t.totalLabels.grossWeight],
    ["total cny", sum(line => line.amount), t.totalLabels.amount],
  ] as const) {
    const declared = decimalValue(decimalCell(sheet.getRow(totalRow).getCell(columns.get(column)!)));
    if (declared === null || Math.abs(declared - Number(value)) > 0.011) {
      issues.push(t.totalMismatch(label));
    }
  }
  for (const line of lines) {
    const net = decimalValue(line.netWeightKg);
    const gross = decimalValue(line.grossWeightKg);
    if (net !== null && gross !== null && net > gross) {
      warnings.push(t.netOverGross(line.sourceRow));
    }
  }
  const ipNumber = headerValue(sheet, "IP REF.");
  if (!ipNumber.trim()) throw new Error(t.ipRefRequired);
  const importerText = headerValue(sheet, "Importer:") || textOf(sheet.getCell("E6"));
  const exporterText = headerValue(sheet, "Exporter:") || textOf(sheet.getCell("A6"));
  if (!importerText) issues.push(t.importerMissing);
  if (!exporterText) issues.push(t.exporterMissing);
  const headerPoNumber = headerValue(sheet, "PO REF.");
  const poNumbers = new Set(lines.flatMap(line => line.poAssignments.map(item => item.poNumber)));
  const normalizedHeaderPo = headerPoNumber.replace(/\D/gu, "");
  if (normalizedHeaderPo && poNumbers.size > 1) {
    warnings.push(t.headerPoReference);
  }

  return {
    fileName: file.name,
    fileSha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map(value => value.toString(16).padStart(2, "0")).join(""),
    ipNumber, importerText, importerCnpj: cnpjDigits(importerText),
    exporterText, invoiceNumber: headerValue(sheet, "INVOICE:"),
    invoiceDate: invoiceDate(headerValue(sheet, "DATE:")), headerPoNumber, originText: headerValue(sheet, "FROM:"),
    destinationText: headerValue(sheet, "TO:"), incoterm: headerValue(sheet, "INCOTERM 2020:"),
    countryOfOrigin: headerValue(sheet, "COUNTRY OF ORIGIN:"),
    countryOfAcquisition: headerValue(sheet, "COUNTRY OF ACQUISITION:"),
    countryOfPrecedence: headerValue(sheet, "COUNTRY OF PRECEDENCE:"),
    paymentTerms: headerValue(sheet, "Payment terms:") || textOf(sheet.getCell("C109")), lines,
    totalQuantity: sum(line => line.quantity), totalNetWeightKg: sum(line => line.netWeightKg),
    totalGrossWeightKg: sum(line => line.grossWeightKg), totalAmount: sum(line => line.amount), issues, warnings,
  };
}
