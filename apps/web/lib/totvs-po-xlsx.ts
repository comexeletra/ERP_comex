import type { Cell, Worksheet } from "exceljs";
import type { Messages } from "./i18n/pt-BR";

export type TotvsPoProductRow = {
  sourceRow: number;
  externalLineReference: string;
  productCode: string;
  description: string;
  orderedQuantity: string;
  unit: string;
  unitPrice: string;
  spreadsheetLineTotal: string;
  calculatedLineTotal: string;
  totalWithinTolerance: boolean;
  costCenter: string;
};

export type TotvsPoHeader = {
  number: string;
  importerCnpj: string;
  supplierCode: string;
  supplierName: string;
  scNumber: string;
};

export type TotvsPoParseResult = {
  header: TotvsPoHeader;
  rows: TotvsPoProductRow[];
  spreadsheetTotal: string;
  calculatedTotal: string;
};

const maxFileBytes = 10 * 1024 * 1024;
const maxProductRows = 500;
const decimalScale = 100_000_000n;
const lineTolerance = 1_000_000n;
const rowHeaders = ["item", "produto", "descricao", "um", "quantidade", "valor total"] as const;
const requiredHeaders = [...rowHeaders, "cc", "pc ae", "cnpj cpf", "codigo", "razao social", "nro sc"] as const;
const headerLabels: Record<(typeof requiredHeaders)[number], string> = {
  item: "Item", produto: "Produto", descricao: "Descrição", um: "UM", quantidade: "Quantidade",
  "valor total": "Valor Total", cc: "CC", "pc ae": "PC / AE", "cnpj cpf": "CNPJ/CPF",
  codigo: "Codigo", "razao social": "Razao Social", "nro sc": "Nro.SC",
};

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function cellValue(cell: Cell): unknown {
  const value = cell.value;
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

function textCell(cell: Cell): string {
  const value = cellValue(cell);
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const zeroFormat = /^0+$/u.test(cell.numFmt ?? "") ? cell.numFmt : "";
    const integer = String(value);
    return zeroFormat && Number.isInteger(value) ? integer.padStart(zeroFormat.length, "0") : integer;
  }
  if (typeof value === "string") return value.trim();
  return "";
}

function numericText(value: string | number, fieldName: string, rowNumber: number, positive: boolean,
  m: Messages): string {
  let normalized: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(m.totvsSheet.notNumeric(rowNumber, fieldName));
    normalized = value.toFixed(8);
    while (normalized.endsWith("0")) normalized = normalized.slice(0, -1);
    if (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  } else {
    normalized = value.trim().replace(/\s/gu, "");
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      normalized = lastComma > lastDot
        ? normalized.replace(/\./gu, "").replace(",", ".")
        : normalized.replace(/,/gu, "");
    } else if (lastComma >= 0) {
      normalized = normalized.replace(",", ".");
    }
  }
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/u.test(normalized)) {
    throw new Error(m.totvsSheet.invalidNumber(rowNumber, fieldName));
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) {
    throw new Error(positive ? m.totvsSheet.mustBePositive(rowNumber, fieldName) : m.totvsSheet.mustBeNonNegative(rowNumber, fieldName));
  }
  return normalized;
}

function decimalCell(cell: Cell, fieldName: string, rowNumber: number, positive: boolean, m: Messages): string {
  const raw = cellValue(cell);
  if (typeof raw === "number") return numericText(raw, fieldName, rowNumber, positive, m);
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(m.totvsSheet.emptyOrNotNumeric(rowNumber, fieldName));
  }
  return numericText(raw, fieldName, rowNumber, positive, m);
}

function decimalUnits(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * decimalScale + BigInt(fraction.padEnd(8, "0"));
}

function formatUnits(value: bigint): string {
  const integer = value / decimalScale;
  const fraction = String(value % decimalScale).padStart(8, "0").replace(/0+$/u, "");
  return fraction ? `${integer}.${fraction}` : String(integer);
}

function multiplyUnits(left: bigint, right: bigint): bigint {
  return (left * right + decimalScale / 2n) / decimalScale;
}

function deriveUnitPrice(total: bigint, quantity: bigint): bigint {
  const numerator = total * decimalScale;
  const quotient = numerator / quantity;
  const remainder = numerator % quantity;
  return quotient + (remainder * 2n >= quantity ? 1n : 0n);
}

function findHeaderColumns(worksheet: Worksheet): { rowNumber: number; columns: Map<string, number> } | null {
  const maxHeaderRow = Math.min(worksheet.rowCount, 25);
  for (let rowNumber = 1; rowNumber <= maxHeaderRow; rowNumber += 1) {
    const columns = new Map<string, number>();
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = normalizeHeader(textCell(cell));
      if (header && !columns.has(header)) columns.set(header, columnNumber);
    });
    if (rowHeaders.every(header => columns.has(header))) return { rowNumber, columns };
  }
  return null;
}

function rowIsBlank(worksheet: Worksheet, rowNumber: number, columns: Map<string, number>): boolean {
  return rowHeaders.every(header => !textCell(worksheet.getRow(rowNumber).getCell(columns.get(header)!)));
}

function singleHeaderValue(worksheet: Worksheet, rows: readonly number[], column: number,
  label: string, m: Messages, required = true): string {
  const distinct = new Map<string, string>();
  for (const rowNumber of rows) {
    const value = textCell(worksheet.getRow(rowNumber).getCell(column));
    if (value) distinct.set(value.toLocaleUpperCase("pt-BR"), value);
  }
  if (distinct.size > 1) throw new Error(m.totvsSheet.multipleValues(label));
  const value = [...distinct.values()][0] ?? "";
  if (required && !value) throw new Error(m.totvsSheet.emptyField(label));
  return value;
}

function normalizeCnpj(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return digits.length > 0 && digits.length <= 14 ? digits.padStart(14, "0") : digits;
}

export async function parseTotvsPoXlsx(file: File, m: Messages): Promise<TotvsPoParseResult> {
  const t = m.totvsSheet;
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
    throw new Error(t.xlsxRequired);
  }
  if (file.size === 0 || file.size > maxFileBytes) {
    throw new Error(t.fileSize);
  }

  const excelJs = await import("exceljs") as typeof import("exceljs") & {
    default?: { Workbook?: typeof import("exceljs").Workbook };
  };
  const Workbook = excelJs.Workbook ?? excelJs.default?.Workbook;
  if (!Workbook) throw new Error(t.readerFailed);
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error(t.unreadable);
  }

  const candidates = workbook.worksheets.map(worksheet => ({ worksheet, header: findHeaderColumns(worksheet) }))
    .filter(candidate => candidate.header !== null);
  const found = candidates.find(candidate => requiredHeaders.every(header => candidate.header!.columns.has(header)))
    ?? candidates[0];
  if (!found?.header) {
    throw new Error(t.itemColumnsMissing);
  }

  const { worksheet, header } = found;
  const missing = requiredHeaders.filter(name => !header.columns.has(name));
  if (missing.length) {
    const names = missing.map(name => headerLabels[name]).join(", ");
    throw new Error(t.layoutIncomplete(names));
  }

  const dataRows: number[] = [];
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (!rowIsBlank(worksheet, rowNumber, header.columns)) dataRows.push(rowNumber);
  }
  if (dataRows.length > maxProductRows) {
    throw new Error(t.tooManyRows(maxProductRows));
  }
  if (!dataRows.length) throw new Error(t.noProducts);

  const column = (name: (typeof requiredHeaders)[number]) => header.columns.get(name)!;
  const headerValues = {
    number: singleHeaderValue(worksheet, dataRows, column("pc ae"), "PC / AE", m),
    importerCnpj: normalizeCnpj(singleHeaderValue(worksheet, dataRows, column("cnpj cpf"), "CNPJ/CPF", m)),
    supplierCode: singleHeaderValue(worksheet, dataRows, column("codigo"), "Codigo", m),
    supplierName: singleHeaderValue(worksheet, dataRows, column("razao social"), "Razao Social", m),
    scNumber: singleHeaderValue(worksheet, dataRows, column("nro sc"), "Nro.SC", m, false),
  };
  if (!/^\d{14}$/u.test(headerValues.importerCnpj)) {
    throw new Error(t.cnpjDigits);
  }

  const imported: TotvsPoProductRow[] = [];
  const errors: string[] = [];
  let spreadsheetTotal = 0n;
  let calculatedTotal = 0n;
  for (const rowNumber of dataRows) {
    try {
      const row = worksheet.getRow(rowNumber);
      const productCode = textCell(row.getCell(column("produto")));
      const description = textCell(row.getCell(column("descricao")));
      const unit = textCell(row.getCell(column("um")));
      const externalLineReference = textCell(row.getCell(column("item")));
      const quantity = decimalCell(row.getCell(column("quantidade")), "Quantidade", rowNumber, true, m);
      const lineTotal = decimalCell(row.getCell(column("valor total")), "Valor Total", rowNumber, false, m);
      const costCenter = textCell(row.getCell(column("cc")));

      if (!productCode) throw new Error(t.productEmpty(rowNumber));
      if (productCode.length > 120) throw new Error(t.productTooLong(rowNumber));
      if (!description) throw new Error(t.descriptionEmpty(rowNumber));
      if (description.length > 1000) throw new Error(t.descriptionTooLong(rowNumber));
      if (!unit) throw new Error(t.unitEmpty(rowNumber));
      if (unit.length > 32) throw new Error(t.unitTooLong(rowNumber));
      if (!externalLineReference) throw new Error(t.itemEmpty(rowNumber));
      if (externalLineReference.length > 80) throw new Error(t.itemTooLong(rowNumber));
      if (!costCenter) throw new Error(t.costCenterEmpty(rowNumber));
      if (costCenter.length > 80) throw new Error(t.costCenterTooLong(rowNumber));

      const quantityUnits = decimalUnits(quantity);
      const lineTotalUnits = decimalUnits(lineTotal);
      const unitPriceUnits = deriveUnitPrice(lineTotalUnits, quantityUnits);
      const calculatedLineTotal = multiplyUnits(quantityUnits, unitPriceUnits);
      const totalWithinTolerance = (calculatedLineTotal >= lineTotalUnits
        ? calculatedLineTotal - lineTotalUnits : lineTotalUnits - calculatedLineTotal) <= lineTolerance;
      spreadsheetTotal += lineTotalUnits;
      calculatedTotal += calculatedLineTotal;
      imported.push({ sourceRow: rowNumber, externalLineReference, productCode, description,
        orderedQuantity: quantity, unit, unitPrice: formatUnits(unitPriceUnits),
        spreadsheetLineTotal: lineTotal, calculatedLineTotal: formatUnits(calculatedLineTotal),
        totalWithinTolerance, costCenter });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : t.invalidRow(rowNumber));
    }
  }

  if (errors.length) {
    throw new Error(t.rowsToFix(errors.length, `${errors.slice(0, 8).join(" ")}${errors.length > 8 ? " …" : ""}`));
  }
  return { header: headerValues, rows: imported, spreadsheetTotal: formatUnits(spreadsheetTotal),
    calculatedTotal: formatUnits(calculatedTotal) };
}
