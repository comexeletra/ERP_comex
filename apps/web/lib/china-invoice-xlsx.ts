import type { Cell, Worksheet } from "exceljs";

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
  ipNumber: string;
  importerText: string;
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
export function parseInvoicePoAssignments(value: string, lineQuantity: string): InvoicePoAssignment[] {
  const quantity = decimalValue(lineQuantity);
  if (quantity === null || quantity <= 0) throw new Error("Informe uma quantidade total válida para a linha.");

  const pattern = /\bPO\s*([0-9]{3,})(?:\s*=\s*([0-9][0-9,.]*)\s*(?:units?|pcs?)\b)?/giu;
  const matches = [...value.matchAll(pattern)];
  const residue = value.replace(pattern, "").replace(/[\s,;]+/gu, "");
  if (!matches.length || residue) throw new Error("Não foi possível interpretar a PO nesta linha.");
  if (matches.length > 1 && matches.some(match => !match[2])) {
    throw new Error("Informe a quantidade para cada PO quando uma linha estiver dividida.");
  }

  const allocations = matches.map(match => {
    const allocated = match[2] ? decimalValue(match[2]) : quantity;
    if (allocated === null || allocated <= 0) throw new Error("A quantidade de cada PO precisa ser maior que zero.");
    return { poNumber: match[1], quantity: String(allocated), explicitQuantity: Boolean(match[2]) };
  });
  const sum = allocations.reduce((total, allocation) => total + Number(allocation.quantity), 0);
  if (Math.abs(sum - quantity) > 0.00000001) {
    throw new Error("A soma das quantidades das POs não confere com a quantidade total da linha.");
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
    if (["no", "ncm", "material code", "product description", "qty unit", "total cny", "po"]
      .every(name => columns.has(name))) return { row, columns };
  }
  return null;
}

function headerValue(sheet: Worksheet, label: string): string {
  const expected = normalizeHeader(label);
  const exactLabel = label.trim().toLocaleLowerCase("en");
  for (let row = 1; row <= Math.min(sheet.rowCount, 25); row += 1) {
    if (textOf(sheet.getRow(row).getCell(10)).trim().toLocaleLowerCase("en") === exactLabel) {
      const cell = sheet.getRow(row).getCell(11);
      const value = valueOf(cell);
      if (expected === "date" && typeof value === "number" && Number.isFinite(value)) {
        return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
      }
      return textOf(cell);
    }
  }
  for (let row = 1; row <= Math.min(sheet.rowCount, 25); row += 1) {
    if (normalizeHeader(textOf(sheet.getRow(row).getCell(10))) === expected) {
      return textOf(sheet.getRow(row).getCell(11));
    }
  }
  return "";
}

function parseLine(sheet: Worksheet, rowNumber: number, columns: Map<string, number>): ChinaInvoiceLine {
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

  if (!get("material code")) issues.push("Material Code aus der invoice está vazio.");
  if (!get("product description")) issues.push("A descrição do produto está vazia.");
  if (!quantityNumber || quantityNumber <= 0) issues.push("A quantidade precisa ser maior que zero.");
  if (!get("qty unit")) issues.push("A unidade está vazia.");
  if (amountNumber === null || amountNumber < 0) issues.push("O total da linha está vazio ou inválido.");
  if (!unitPrice) issues.push("O preço unitário não pôde ser calculado.");
  if (!get("po")) issues.push("A PO da linha está vazia.");

  let poAssignments: InvoicePoAssignment[] = [];
  if (quantity && get("po")) {
    try { poAssignments = parseInvoicePoAssignments(get("po"), quantity); }
    catch (error) { issues.push(error instanceof Error ? error.message : "A PO da linha está inválida."); }
  }

  if (quantityNumber !== null && amountNumber !== null && unitPrice) {
    if (Math.abs(quantityNumber * Number(unitPrice) - amountNumber) > 0.011) {
      issues.push("Quantidade × preço unitário não confere com o total da linha.");
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

export async function parseChinaInvoiceXlsx(file: File): Promise<ChinaInvoiceDraft> {
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
    throw new Error("Selecione uma invoice no formato .xlsx.");
  }
  if (file.size === 0 || file.size > maxFileBytes) {
    throw new Error("O arquivo precisa ter conteúdo e ser menor que 10 MB.");
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(await file.arrayBuffer()); }
  catch { throw new Error("Não foi possível ler a planilha. Salve-a como .xlsx e tente novamente."); }
  const sheet = workbook.getWorksheet("INV");
  if (!sheet) throw new Error("Não encontrei a aba obrigatória INV.");
  const header = headerColumns(sheet);
  if (!header) throw new Error("Não encontrei o cabeçalho de produtos esperado na aba INV.");
  const { row: headerRow, columns } = header;
  const required = ["no", "ncm", "material code", "product description", "manufacturer",
    "manufacturer s address", "manufacturer s country", "qty pcs kgs mts", "qty unit", "price cny",
    "net weight kg", "gross weight kg", "total cny", "po"];
  const missingHeaders = required.filter(key => !columns.has(key));
  if (missingHeaders.length) throw new Error(`A aba INV está sem colunas obrigatórias: ${missingHeaders.join(", ")}.`);

  const lines: ChinaInvoiceLine[] = [];
  for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
    const lineNo = textOf(sheet.getRow(row).getCell(columns.get("no")!));
    const material = textOf(sheet.getRow(row).getCell(columns.get("material code")!));
    if (!/^\d+$/u.test(lineNo) || !material) continue;
    lines.push(parseLine(sheet, row, columns));
  }
  if (!lines.length) throw new Error("Não encontrei produtos na aba INV.");

  const sum = (select: (line: ChinaInvoiceLine) => string) => {
    const total = lines.reduce((sumValue, line) => {
      const amount = decimalValue(select(line));
      return sumValue + (amount ?? 0);
    }, 0);
    return String(Number(total.toFixed(8)));
  };
  const warnings: string[] = [];
  const headerPoNumber = headerValue(sheet, "PO REF.");
  const poNumbers = new Set(lines.flatMap(line => line.poAssignments.map(item => item.poNumber)));
  const normalizedHeaderPo = headerPoNumber.replace(/\D/gu, "");
  if (normalizedHeaderPo && poNumbers.size > 1) {
    warnings.push("O PO REF do cabeçalho é apenas uma referência: as linhas da invoice apontam para mais de uma PO.");
  }

  return {
    fileName: file.name,
    ipNumber: headerValue(sheet, "IP REF."), importerText: textOf(sheet.getCell("E6")),
    exporterText: textOf(sheet.getCell("A6")), invoiceNumber: headerValue(sheet, "INVOICE:"),
    invoiceDate: headerValue(sheet, "DATE:"), headerPoNumber, originText: headerValue(sheet, "FROM:"),
    destinationText: headerValue(sheet, "TO:"), incoterm: headerValue(sheet, "INCOTERM 2020:"),
    countryOfOrigin: headerValue(sheet, "COUNTRY OF ORIGIN:"),
    countryOfAcquisition: headerValue(sheet, "COUNTRY OF ACQUISITION:"),
    countryOfPrecedence: headerValue(sheet, "COUNTRY OF PRECEDENCE:"),
    paymentTerms: textOf(sheet.getCell("C109")), lines,
    totalQuantity: sum(line => line.quantity), totalNetWeightKg: sum(line => line.netWeightKg),
    totalGrossWeightKg: sum(line => line.grossWeightKg), totalAmount: sum(line => line.amount), warnings,
  };
}
