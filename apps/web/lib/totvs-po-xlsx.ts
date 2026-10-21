import type { Cell, Worksheet } from "exceljs";

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

function numericText(value: string | number, fieldName: string, rowNumber: number, positive: boolean): string {
  let normalized: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Linha ${rowNumber}: ${fieldName} não é numérico.`);
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
    throw new Error(`Linha ${rowNumber}: ${fieldName} tem um formato numérico inválido.`);
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) {
    throw new Error(`Linha ${rowNumber}: ${fieldName} precisa ser ${positive ? "maior que zero" : "zero ou maior"}.`);
  }
  return normalized;
}

function decimalCell(cell: Cell, fieldName: string, rowNumber: number, positive: boolean): string {
  const raw = cellValue(cell);
  if (typeof raw === "number") return numericText(raw, fieldName, rowNumber, positive);
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`Linha ${rowNumber}: ${fieldName} está vazio ou não é numérico.`);
  }
  return numericText(raw, fieldName, rowNumber, positive);
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
  label: string, required = true): string {
  const distinct = new Map<string, string>();
  for (const rowNumber of rows) {
    const value = textCell(worksheet.getRow(rowNumber).getCell(column));
    if (value) distinct.set(value.toLocaleUpperCase("pt-BR"), value);
  }
  if (distinct.size > 1) throw new Error(`O campo ${label} tem mais de um valor na planilha.`);
  const value = [...distinct.values()][0] ?? "";
  if (required && !value) throw new Error(`O campo ${label} está vazio na planilha.`);
  return value;
}

function normalizeCnpj(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return digits.length > 0 && digits.length <= 14 ? digits.padStart(14, "0") : digits;
}

export async function parseTotvsPoXlsx(file: File): Promise<TotvsPoParseResult> {
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
    throw new Error("Selecione uma planilha do Excel no formato .xlsx.");
  }
  if (file.size === 0 || file.size > maxFileBytes) {
    throw new Error("O arquivo precisa ter conteúdo e ser menor que 10 MB.");
  }

  const excelJs = await import("exceljs") as typeof import("exceljs") & {
    default?: { Workbook?: typeof import("exceljs").Workbook };
  };
  const Workbook = excelJs.Workbook ?? excelJs.default?.Workbook;
  if (!Workbook) throw new Error("Não foi possível inicializar o leitor de planilhas.");
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("Não foi possível ler a planilha. Salve-a como .xlsx e tente novamente.");
  }

  const candidates = workbook.worksheets.map(worksheet => ({ worksheet, header: findHeaderColumns(worksheet) }))
    .filter(candidate => candidate.header !== null);
  const found = candidates.find(candidate => requiredHeaders.every(header => candidate.header!.columns.has(header)))
    ?? candidates[0];
  if (!found?.header) {
    throw new Error("Não encontrei as colunas de itens do layout TOTVS Pedido de Compras: Item, Produto, Descrição, UM, Quantidade e Valor Total.");
  }

  const { worksheet, header } = found;
  const missing = requiredHeaders.filter(name => !header.columns.has(name));
  if (missing.length) {
    const names = missing.map(name => headerLabels[name]).join(", ");
    throw new Error(`Layout TOTVS Pedido de Compras incompleto. Colunas obrigatórias ausentes: ${names}.`);
  }

  const dataRows: number[] = [];
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (!rowIsBlank(worksheet, rowNumber, header.columns)) dataRows.push(rowNumber);
  }
  if (dataRows.length > maxProductRows) {
    throw new Error(`A planilha excede o limite de ${maxProductRows} produtos por importação.`);
  }
  if (!dataRows.length) throw new Error("Não encontrei produtos depois da linha de cabeçalho.");

  const column = (name: (typeof requiredHeaders)[number]) => header.columns.get(name)!;
  const headerValues = {
    number: singleHeaderValue(worksheet, dataRows, column("pc ae"), "PC / AE"),
    importerCnpj: normalizeCnpj(singleHeaderValue(worksheet, dataRows, column("cnpj cpf"), "CNPJ/CPF")),
    supplierCode: singleHeaderValue(worksheet, dataRows, column("codigo"), "Codigo"),
    supplierName: singleHeaderValue(worksheet, dataRows, column("razao social"), "Razao Social"),
    scNumber: singleHeaderValue(worksheet, dataRows, column("nro sc"), "Nro.SC", false),
  };
  if (!/^\d{14}$/u.test(headerValues.importerCnpj)) {
    throw new Error("O CNPJ/CPF da empresa não tem 14 dígitos na planilha.");
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
      const quantity = decimalCell(row.getCell(column("quantidade")), "Quantidade", rowNumber, true);
      const lineTotal = decimalCell(row.getCell(column("valor total")), "Valor Total", rowNumber, false);
      const costCenter = textCell(row.getCell(column("cc")));

      if (!productCode) throw new Error(`Linha ${rowNumber}: Produto está vazio.`);
      if (productCode.length > 120) throw new Error(`Linha ${rowNumber}: Produto excede 120 caracteres.`);
      if (!description) throw new Error(`Linha ${rowNumber}: Descrição está vazia.`);
      if (description.length > 1000) throw new Error(`Linha ${rowNumber}: Descrição excede 1.000 caracteres.`);
      if (!unit) throw new Error(`Linha ${rowNumber}: UM está vazia.`);
      if (unit.length > 32) throw new Error(`Linha ${rowNumber}: UM excede 32 caracteres.`);
      if (!externalLineReference) throw new Error(`Linha ${rowNumber}: Item está vazio.`);
      if (externalLineReference.length > 80) throw new Error(`Linha ${rowNumber}: Item excede 80 caracteres.`);
      if (!costCenter) throw new Error(`Linha ${rowNumber}: CC está vazio.`);
      if (costCenter.length > 80) throw new Error(`Linha ${rowNumber}: CC excede 80 caracteres.`);

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
      errors.push(error instanceof Error ? error.message : `Linha ${rowNumber}: dados inválidos.`);
    }
  }

  if (errors.length) {
    throw new Error(`A planilha tem ${errors.length} linha(s) para corrigir: ${errors.slice(0, 8).join(" ")}${errors.length > 8 ? " …" : ""}`);
  }
  return { header: headerValues, rows: imported, spreadsheetTotal: formatUnits(spreadsheetTotal),
    calculatedTotal: formatUnits(calculatedTotal) };
}
