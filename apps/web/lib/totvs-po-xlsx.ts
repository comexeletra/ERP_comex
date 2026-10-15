import type { Cell, Worksheet } from "exceljs";

export type TotvsPoProductRow = {
  sourceRow: number;
  externalLineReference: string;
  productCode: string;
  description: string;
  orderedQuantity: string;
  unit: string;
  unitPrice: string;
  costCenter: string;
};

const maxFileBytes = 10 * 1024 * 1024;
const maxProductRows = 500;
const requiredHeaders = ["item", "produto", "descricao", "um", "quantidade", "valor unitario"] as const;

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

function decimalCell(cell: Cell, fieldName: string, rowNumber: number, positive: boolean): string {
  const raw = cellValue(cell);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if ((positive && raw <= 0) || (!positive && raw < 0)) {
      throw new Error(`Linha ${rowNumber}: ${fieldName} precisa ser ${positive ? "maior que zero" : "zero ou maior"}.`);
    }
    return String(raw);
  }

  if (typeof raw !== "string" || !raw.trim()) {
    if (!positive && (raw === null || raw === undefined || raw === "")) return "";
    throw new Error(`Linha ${rowNumber}: ${fieldName} está vazio ou não é numérico.`);
  }

  let normalized = raw.trim().replace(/\s/gu, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? normalized.replace(/\./gu, "").replace(",", ".")
      : normalized.replace(/,/gu, "");
  } else if (lastComma >= 0) {
    normalized = normalized.replace(",", ".");
  }
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/u.test(normalized)) {
    throw new Error(`Linha ${rowNumber}: ${fieldName} tem um formato numérico inválido.`);
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || (positive && number <= 0) || (!positive && number < 0)) {
    throw new Error(`Linha ${rowNumber}: ${fieldName} precisa ser ${positive ? "maior que zero" : "zero ou maior"}.`);
  }
  return normalized;
}

function findHeaderRow(worksheet: Worksheet): { rowNumber: number; columns: Map<string, number> } | null {
  const maxHeaderRow = Math.min(worksheet.rowCount, 25);
  for (let rowNumber = 1; rowNumber <= maxHeaderRow; rowNumber += 1) {
    const columns = new Map<string, number>();
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = normalizeHeader(textCell(cell));
      if (header && !columns.has(header)) columns.set(header, columnNumber);
    });
    if (requiredHeaders.every(header => columns.has(header))) return { rowNumber, columns };
  }
  return null;
}

function rowIsBlank(worksheet: Worksheet, rowNumber: number, columns: Map<string, number>): boolean {
  return requiredHeaders.every(header => !textCell(worksheet.getRow(rowNumber).getCell(columns.get(header)!)));
}

export async function parseTotvsPoXlsx(file: File): Promise<TotvsPoProductRow[]> {
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
    throw new Error("Selecione uma planilha do Excel no formato .xlsx.");
  }
  if (file.size === 0 || file.size > maxFileBytes) {
    throw new Error("O arquivo precisa ter conteúdo e ser menor que 10 MB.");
  }

  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("Não foi possível ler a planilha. Salve-a como .xlsx e tente novamente.");
  }

  const found = workbook.worksheets
    .map(worksheet => ({ worksheet, header: findHeaderRow(worksheet) }))
    .find(candidate => candidate.header !== null);
  if (!found?.header) {
    throw new Error("Não encontrei os cabeçalhos Item, Produto, Descrição, UM, Quantidade e Valor Unitário.");
  }

  const { worksheet, header } = found;
  const { rowNumber: headerRow, columns } = header;
  const costCenterColumn = columns.get("cc");
  const imported: TotvsPoProductRow[] = [];
  const errors: string[] = [];

  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (rowIsBlank(worksheet, rowNumber, columns)) continue;
    if (imported.length >= maxProductRows) {
      throw new Error(`A planilha excede o limite de ${maxProductRows} produtos por importação.`);
    }

    const row = worksheet.getRow(rowNumber);
    try {
      const productCode = textCell(row.getCell(columns.get("produto")!));
      const description = textCell(row.getCell(columns.get("descricao")!));
      const unit = textCell(row.getCell(columns.get("um")!));
      const externalLineReference = textCell(row.getCell(columns.get("item")!));
      const quantity = decimalCell(row.getCell(columns.get("quantidade")!), "Quantidade", rowNumber, true);
      const unitPrice = decimalCell(row.getCell(columns.get("valor unitario")!), "Valor Unitário", rowNumber, false);
      const costCenter = costCenterColumn ? textCell(row.getCell(costCenterColumn)) : "";

      if (!productCode) throw new Error(`Linha ${rowNumber}: Produto está vazio.`);
      if (productCode.length > 120) throw new Error(`Linha ${rowNumber}: Produto excede 120 caracteres.`);
      if (!description) throw new Error(`Linha ${rowNumber}: Descrição está vazia.`);
      if (description.length > 1000) throw new Error(`Linha ${rowNumber}: Descrição excede 1.000 caracteres.`);
      if (!unit) throw new Error(`Linha ${rowNumber}: UM está vazia.`);
      if (unit.length > 32) throw new Error(`Linha ${rowNumber}: UM excede 32 caracteres.`);
      if (externalLineReference.length > 80) throw new Error(`Linha ${rowNumber}: Item excede 80 caracteres.`);
      if (costCenter.length > 80) throw new Error(`Linha ${rowNumber}: CC excede 80 caracteres.`);

      imported.push({ sourceRow: rowNumber, externalLineReference, productCode, description,
        orderedQuantity: quantity, unit, unitPrice, costCenter });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Linha ${rowNumber}: dados inválidos.`);
    }
  }

  if (errors.length) {
    throw new Error(`A planilha tem ${errors.length} linha(s) para corrigir: ${errors.slice(0, 8).join(" ")}${errors.length > 8 ? " …" : ""}`);
  }
  if (!imported.length) throw new Error("Não encontrei produtos depois da linha de cabeçalho.");
  return imported;
}
