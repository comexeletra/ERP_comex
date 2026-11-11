import type { Cell } from "exceljs";
import type { InvoicePackingList, InvoiceSheetLayout } from "./china-invoice-xlsx";

/*
 * The invoice file corrected with the analyst's decisions on the audit page (user decision, 2026-11-10):
 * quantity and PO cell of each line, the PO price when the analyst corrects it, the PKL weights when the
 * analyst takes them, the recalculated line total and TOTAL row, the DATABASE NCM and description the analyst
 * takes (also in the PKL line with the same No.), the manufacturer from the manufacturer list, the header country
 * of origin, and an AUDITORIA sheet. A line destined with 0 keeps its commercial values; every other cell and
 * sheet is kept.
 */

export type InvoiceLineValues = { quantity: string; poCell: string; unitPrice: string; netWeightKg: string;
  grossWeightKg: string; amount: string; ncm: string; description: string; manufacturer: string;
  manufacturerAddress: string; manufacturerCountry: string };
export type InvoiceCorrectionField = keyof InvoiceLineValues;
export type InvoiceLineCorrection = { sourceRow: number; lineNumber: string; destined: boolean; original: InvoiceLineValues;
  corrected: InvoiceLineValues; changed: InvoiceCorrectionField[] };
type CorrectionLine = InvoiceLineValues & { sourceRow: number; lineNumber: string;
  poAssignments: readonly { poNumber: string; quantity: string }[] };

const fields: readonly InvoiceCorrectionField[] = ["quantity", "poCell", "unitPrice", "netWeightKg", "grossWeightKg", "amount",
  "ncm", "description", "manufacturer", "manufacturerAddress", "manufacturerCountry"];
/** The product and manufacturer fields the reference workbooks correct, also on a line destined with 0. */
type ReferenceField = "ncm" | "description" | "manufacturer" | "manufacturerAddress" | "manufacturerCountry";
const referenceFields: readonly ReferenceField[] = ["ncm", "description", "manufacturer", "manufacturerAddress", "manufacturerCountry"];
const digits = 18;
const scale = 10n ** BigInt(digits);

function units(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/u.exec(value.trim());
  if (!match || (match[3]?.length ?? 0) > digits) return null;
  const result = BigInt(match[2]) * scale + BigInt((match[3] ?? "").padEnd(digits, "0"));
  return match[1] ? -result : result;
}

function text(value: bigint, places = digits): string {
  const factor = 10n ** BigInt(places);
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % factor).toString().padStart(places, "0").replace(/0+$/u, "");
  return `${value < 0n ? "-" : ""}${absolute / factor}${fraction ? `.${fraction}` : ""}`;
}

const same = (left: string, right: string) => {
  const leftUnits = units(left), rightUnits = units(right);
  return leftUnits === null || rightUnits === null ? left.trim() === right.trim() : leftUnits === rightUnits;
};
const poKey = (value: string) => value.replace(/\D/gu, "").replace(/^0+(?=\d)/u, "");
const ncmDigits = (value: string) => value.replace(/\D/gu, "");

/** Quantity × price rounded half up to cents, the scale of the invoice totals. */
function lineAmount(quantity: string, price: string): string | null {
  const quantityUnits = units(quantity), priceUnits = units(price);
  if (quantityUnits === null || priceUnits === null) return null;
  const product = quantityUnits * priceUnits;
  const cent = scale * scale / 100n;
  return text((product + cent / 2n) / cent * cent / scale);
}

/**
 * The corrected values of each line. `parts` are the destined parts (PO and quantity), `prices` the PO price
 * of the lines the analyst corrected, `weights` the PKL weights of the lines where the analyst took the PKL, and
 * `reference` the DATABASE and manufacturer list values (they apply to a line destined with 0 too).
 */
export function invoiceLineCorrections(lines: readonly CorrectionLine[],
  parts: readonly { sourceRow: number; poNumber: string; quantity: string }[],
  prices: Readonly<Record<number, string>>,
  weights: Readonly<Record<number, { netWeightKg: string; grossWeightKg: string }>>,
  reference: Readonly<Record<number, Partial<Record<ReferenceField, string>>>> = {}): InvoiceLineCorrection[] {
  return lines.map(line => {
    const original: InvoiceLineValues = { quantity: line.quantity, poCell: line.poCell, unitPrice: line.unitPrice,
      netWeightKg: line.netWeightKg, grossWeightKg: line.grossWeightKg, amount: line.amount, ncm: line.ncm,
      description: line.description,
      manufacturer: line.manufacturer, manufacturerAddress: line.manufacturerAddress, manufacturerCountry: line.manufacturerCountry };
    const values = reference[line.sourceRow] ?? {};
    const product = Object.fromEntries(referenceFields.map(field => {
      const value = values[field];
      const differs = value !== undefined && (field === "ncm" ? ncmDigits(value) !== ncmDigits(line.ncm) : value.trim() !== line[field].trim());
      return [field, differs ? value!.trim() : line[field]];
    })) as Pick<InvoiceLineValues, ReferenceField>;
    const result = (destined: boolean, corrected: InvoiceLineValues): InvoiceLineCorrection => ({ sourceRow: line.sourceRow,
      lineNumber: line.lineNumber, destined, original, corrected, changed: fields.filter(field => corrected[field] !== original[field]) });
    const byPo = new Map<string, { poNumber: string; quantity: bigint }>();
    for (const part of parts) {
      const quantity = units(part.quantity);
      if (part.sourceRow !== line.sourceRow || quantity === null || quantity <= 0n) continue;
      const key = poKey(part.poNumber);
      const entry = byPo.get(key) ?? { poNumber: part.poNumber.replace(/\D/gu, ""), quantity: 0n };
      byPo.set(key, { ...entry, quantity: entry.quantity + quantity });
    }
    if (!byPo.size) return result(false, { ...original, ...product });
    const destined = [...byPo.values()];
    const sameCell = destined.length === line.poAssignments.length && destined.every((entry, index) =>
      poKey(line.poAssignments[index].poNumber) === poKey(entry.poNumber)
      && units(line.poAssignments[index].quantity) === entry.quantity);
    const quantity = text(destined.reduce((total, entry) => total + entry.quantity, 0n));
    const singleCell = /^(\s*PO\s*)\d+(\s*)$/iu.exec(line.poCell);
    const poCell = sameCell ? line.poCell : destined.length === 1 && singleCell
      ? `${singleCell[1]}${destined[0].poNumber}${singleCell[2]}` : destined.length === 1 ? `PO ${destined[0].poNumber}`
      : destined.map(entry => `PO ${entry.poNumber} = ${text(entry.quantity)} units`).join("\n");
    const unitPrice = prices[line.sourceRow] ?? line.unitPrice;
    const weight = weights[line.sourceRow];
    const priced = !same(quantity, line.quantity) || !same(unitPrice, line.unitPrice);
    return result(true, { quantity: same(quantity, line.quantity) ? line.quantity : quantity, poCell,
      unitPrice: same(unitPrice, line.unitPrice) ? line.unitPrice : unitPrice,
      netWeightKg: weight && !same(weight.netWeightKg, line.netWeightKg) ? weight.netWeightKg : line.netWeightKg,
      grossWeightKg: weight && !same(weight.grossWeightKg, line.grossWeightKg) ? weight.grossWeightKg : line.grossWeightKg,
      amount: priced ? lineAmount(quantity, unitPrice) ?? line.amount : line.amount, ...product });
  });
}

export type InvoiceCorrectedTotals = { quantity: string; netWeightKg: string; grossWeightKg: string; amount: string };

export function invoiceCorrectedTotals(corrections: readonly InvoiceLineCorrection[]): InvoiceCorrectedTotals {
  const sum = (field: InvoiceCorrectionField) =>
    text(corrections.reduce((total, entry) => total + (units(entry.corrected[field]) ?? 0n), 0n));
  return { quantity: sum("quantity"), netWeightKg: sum("netWeightKg"), grossWeightKg: sum("grossWeightKg"), amount: sum("amount") };
}

export type InvoicePackingCorrection = { sourceRow: number; packingRow: number; column: number;
  field: "ncm" | "description"; value: string };

/** The PKL cells that receive the NCM and description corrections: the line with the same No., when it differs. */
export function invoicePackingCorrections(corrections: readonly InvoiceLineCorrection[],
  packing: InvoicePackingList | null): InvoicePackingCorrection[] {
  if (packing?.status !== "READ") return [];
  const number = (value: string) => value.trim().replace(/^0+(?=\d)/u, "");
  const result: InvoicePackingCorrection[] = [];
  for (const correction of corrections) {
    const line = packing.lines.find(entry => number(entry.lineNumber) === number(correction.lineNumber));
    if (!line) continue;
    for (const field of ["ncm", "description"] as const) {
      const column = packing.columns[field];
      const value = correction.corrected[field];
      const already = field === "ncm" ? ncmDigits(line.ncm) === ncmDigits(value) : line.description.trim() === value.trim();
      if (column === null || !correction.changed.includes(field) || already) continue;
      result.push({ sourceRow: correction.sourceRow, packingRow: line.sourceRow, column, field, value });
    }
  }
  return result;
}

function columnLetter(index: number): string {
  let letters = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  return letters;
}

export type InvoiceChangedCell = { field: InvoiceCorrectionField; cell: string };

/** The changed cells of each invoice row by field, in the INV and in the PKL (PKL!B26), for the AUDITORIA sheet. */
export function invoiceChangedCells(corrections: readonly InvoiceLineCorrection[], layout: InvoiceSheetLayout,
  packing: InvoicePackingList | null): Record<number, InvoiceChangedCell[]> {
  const cells: Record<number, InvoiceChangedCell[]> = {};
  for (const correction of corrections) {
    cells[correction.sourceRow] = correction.changed.map(field =>
      ({ field, cell: `${columnLetter(layout.columns[field])}${correction.sourceRow}` }));
  }
  for (const entry of invoicePackingCorrections(corrections, packing)) {
    (cells[entry.sourceRow] ??= []).push({ field: entry.field, cell: `PKL!${columnLetter(entry.column)}${entry.packingRow}` });
  }
  return cells;
}

export type InvoiceAuditSheet = { sheetName: string; summary: readonly (readonly [string, string])[];
  columns: readonly string[]; rows: readonly (readonly string[])[] };

/**
 * An NCM not found in the DATABASE that the analyst flags (user decision, 2026-11-11): the NCM cell goes orange with
 * its value unchanged, and the first column after the INV data (O in the HEXING invoices) says why.
 */
export type InvoiceNcmFlags = { rows: readonly number[]; text: string };

export function invoiceNcmFlagColumn(layout: InvoiceSheetLayout): number {
  return Math.max(14, ...Object.values(layout.columns)) + 1;
}

export function invoiceNcmFlagCells(layout: InvoiceSheetLayout, row: number): string[] {
  return [`${columnLetter(layout.columns.ncm)}${row}`, `${columnLetter(invoiceNcmFlagColumn(layout))}${row}`];
}

const correctedFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } } as const;
const flaggedFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC000" } } as const;
const textFields: readonly InvoiceCorrectionField[] = ["poCell", "ncm", "description", "manufacturer", "manufacturerAddress",
  "manufacturerCountry"];

function shownValue(cell: Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  if (typeof value === "object" && "richText" in value) return value.richText.map(part => part.text).join("");
  return String(value);
}

function mark(cell: Cell, value: string | number, note: (original: string) => string) {
  const original = shownValue(cell);
  cell.value = value;
  cell.fill = { ...correctedFill };
  cell.note = note(original);
}

/** Writes the corrections into the INV and PKL sheets and the audit sheet; Excel recalculates every formula on open. */
export async function writeCorrectedInvoice(bytes: ArrayBuffer | Uint8Array, layout: InvoiceSheetLayout,
  corrections: readonly InvoiceLineCorrection[], totals: InvoiceCorrectedTotals, audit: InvoiceAuditSheet,
  note: (original: string) => string, packing: InvoicePackingList | null = null,
  countryOfOrigin: string | null = null, ncmFlags: InvoiceNcmFlags | null = null): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes instanceof Uint8Array ? bytes.slice().buffer : bytes);
  const sheet = workbook.getWorksheet("INV");
  if (!sheet) throw new Error("INV");
  const columnOf = layout.columns;
  for (const correction of corrections) {
    for (const field of correction.changed) {
      const value = correction.corrected[field];
      mark(sheet.getRow(correction.sourceRow).getCell(columnOf[field]), textFields.includes(field) ? value : Number(value), note);
    }
  }
  const packingSheet = workbook.getWorksheet("PKL");
  if (packingSheet) {
    for (const entry of invoicePackingCorrections(corrections, packing)) {
      const cell = packingSheet.getRow(entry.packingRow).getCell(entry.column);
      // A formula pointing at the INV (=INV!D16) already shows the corrected INV value: it keeps the formula.
      if (cell.formula && /(^|[^A-Z0-9_])'?INV'?!/iu.test(cell.formula)) cell.value = { formula: cell.formula, result: entry.value };
      else mark(cell, entry.value, note);
    }
  }
  for (const row of ncmFlags?.rows ?? []) {
    sheet.getRow(row).getCell(columnOf.ncm).fill = { ...flaggedFill };
    const warning = sheet.getRow(row).getCell(invoiceNcmFlagColumn(layout));
    const previous = shownValue(warning);
    warning.value = ncmFlags!.text;
    warning.fill = { ...flaggedFill };
    if (previous) warning.note = note(previous);
  }
  if (countryOfOrigin !== null && layout.countryOfOrigin) {
    const { row, column, prefix } = layout.countryOfOrigin;
    mark(sheet.getRow(row).getCell(column), prefix ? `${prefix} ${countryOfOrigin}` : countryOfOrigin, note);
  }
  if (layout.totalRow) {
    for (const field of ["quantity", "netWeightKg", "grossWeightKg", "amount"] as const) {
      const cell = sheet.getRow(layout.totalRow).getCell(columnOf[field]);
      if (!same(shownValue(cell), totals[field]) && units(shownValue(cell)) !== null) mark(cell, Number(totals[field]), note);
    }
  }
  workbook.calcProperties.fullCalcOnLoad = true;

  let name = audit.sheetName;
  for (let index = 2; workbook.getWorksheet(name); index += 1) name = `${audit.sheetName} ${index}`;
  const auditSheet = workbook.addWorksheet(name);
  audit.summary.forEach(([label, value], index) => {
    const row = auditSheet.getRow(index + 1);
    row.getCell(1).value = label; row.getCell(1).font = { bold: true };
    row.getCell(2).value = value;
  });
  const headerRow = auditSheet.getRow(audit.summary.length + 2);
  audit.columns.forEach((label, index) => { headerRow.getCell(index + 1).value = label; headerRow.getCell(index + 1).font = { bold: true }; });
  audit.rows.forEach((values, rowIndex) => {
    const row = auditSheet.getRow(audit.summary.length + 3 + rowIndex);
    values.forEach((value, index) => { row.getCell(index + 1).value = value; });
  });
  audit.columns.forEach((_, index) => { auditSheet.getColumn(index + 1).width = index === 0 ? 24 : 32; });
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
