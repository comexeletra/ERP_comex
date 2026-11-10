import type { Messages } from "./i18n/pt-BR";

/*
 * Reads the PO lines of the Follow Up workbook for the invoice audit page (decision of 2026-11-10: the
 * POs come from the Follow Up in use, read in the browser, with no table and no load). Only the
 * "Pré Embarque" sheet and the shared strings are unzipped: loading the whole 8 MB workbook with
 * ExcelJS took 12 s and about 830 MB of memory, because of the large End-to-End and NCM sheets.
 */

const maxFileBytes = 60 * 1024 * 1024;
const preSheetName = "Pré Embarque"; // i18n-ignore: sheet name of the Follow Up workbook
/** Headers read by name: the columns moved since the historical load (Product Code went from T to W). */
const followUpHeaders = ["Status", "Importer", "PO Totvs", "Supplier", "Product Code", "Qty", "Unit Price", "Currency",
  "IP Number"] as const; // i18n-ignore: headers of the Follow Up workbook
type FollowUpHeader = typeof followUpHeaders[number];

export type FollowUpPoLine = { sourceRow: number; importer: string; poNumber: string; supplier: string; productCode: string;
  quantity: string; unitPrice: string | null; currency: string | null; ipNumber: string; status: string };
export type FollowUpWorkbook = { fileName: string; fileSha256: string; lines: FollowUpPoLine[]; cancelled: number; ignored: number };

type ZipEntry = { method: number; compressedSize: number; localOffset: number };

function zipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("zip");
  const entries = new Map<string, ZipEntry>();
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("zip");
    const nameLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method: view.getUint16(offset + 10, true), compressedSize: view.getUint32(offset + 20, true),
      localOffset: view.getUint32(offset + 42, true) });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

async function zipText(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const data = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("zip");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function xmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }[lower] ?? "";
  });
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(String.raw`\s${name}="([^"]*)"`, "u").exec(tag);
  return match ? xmlText(match[1]) : "";
}

/** The text runs of a shared or inline string, without the phonetic runs. */
function runsText(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/gu, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/gu)]
    .map(match => xmlText(match[1] ?? "")).join("");
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const letter of reference.replace(/\d+$/u, "")) index = index * 26 + letter.charCodeAt(0) - 64;
  return index;
}

/** As Excel shows it: 15 significant digits, without exponent (same rule as the invoice parser). */
function numberText(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value.trim();
  const text = String(Number(number.toPrecision(15)));
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/u.exec(text);
  if (!match) return text;
  const [, sign, lead, rest = "", exponentText] = match;
  const digits = lead + rest, exponent = Number(exponentText);
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const whole = digits.padEnd(exponent + 1, "0");
  return `${sign}${whole.slice(0, exponent + 1)}${digits.length > exponent + 1 ? `.${digits.slice(exponent + 1)}` : ""}`;
}

/** Each row of the sheet as column index → displayed text. */
function* sheetRows(xml: string, shared: readonly string[]): Generator<{ row: number; cells: Map<number, string> }> {
  let rowNumber = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu)) {
    rowNumber = Number(attribute(rowMatch[1], "r")) || rowNumber + 1;
    const cells = new Map<number, string>();
    let column = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const reference = attribute(cellMatch[1], "r");
      column = reference ? columnIndex(reference) : column + 1;
      const type = attribute(cellMatch[1], "t");
      const body = cellMatch[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1];
      const value = type === "s" ? shared[Number(raw)] ?? ""
        : type === "inlineStr" ? runsText(body)
          : raw === undefined ? "" : type === "str" || type === "e" ? xmlText(raw) : type === "b" ? raw : numberText(xmlText(raw));
      if (value.trim()) cells.set(column, value.trim());
    }
    yield { row: rowNumber, cells };
  }
}

async function preSheetXml(bytes: Uint8Array, m: Messages): Promise<{ sheet: string; shared: string[] }> {
  const t = m.followUpSheet;
  let entries: Map<string, ZipEntry>;
  try { entries = zipDirectory(bytes); } catch { throw new Error(t.unreadable); }
  const workbook = await zipText(bytes, entries, "xl/workbook.xml");
  const rels = await zipText(bytes, entries, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error(t.unreadable);
  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*>/gu)].map(match => match[0])
    .find(tag => attribute(tag, "name").trim() === preSheetName);
  if (!sheetTag) throw new Error(t.preSheetMissing);
  const relationId = attribute(sheetTag, "r:id");
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/gu)].map(match => match[0])
    .find(tag => attribute(tag, "Id") === relationId);
  const path = target ? attribute(target, "Target") : "";
  const sheet = await zipText(bytes, entries, path.startsWith("/") ? path.slice(1) : `xl/${path}`);
  if (!sheet) throw new Error(t.unreadable);
  const sharedXml = await zipText(bytes, entries, "xl/sharedStrings.xml") ?? "";
  return { sheet, shared: [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map(match => runsText(match[1])) };
}

const cancelledText = (value: string) => ["CANCELLED", "CANCELED"].includes(value.trim().toLocaleUpperCase("en-US"));

/** Same rule as the historical load: a blank, cancelled or #error IP leaves the line without IP. */
function validIp(value: string): string {
  const text = value.trim();
  return !text || cancelledText(text) || text.startsWith("#") ? "" : text;
}

export async function parseFollowUpXlsx(file: File, m: Messages): Promise<FollowUpWorkbook> {
  const t = m.followUpSheet;
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".xlsx")) throw new Error(t.xlsxRequired);
  if (file.size === 0 || file.size > maxFileBytes) throw new Error(t.fileSize);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { sheet, shared } = await preSheetXml(bytes, m);
  let columns: Map<FollowUpHeader, number> | null = null;
  const lines: FollowUpPoLine[] = [];
  let cancelled = 0, ignored = 0;
  for (const { row, cells } of sheetRows(sheet, shared)) {
    if (!columns) {
      if (row > 15) break;
      const found = new Map<FollowUpHeader, number>();
      for (const [column, value] of cells) {
        const header = followUpHeaders.find(name => name === value.replace(/\s+/gu, " ").trim());
        if (header && !found.has(header)) found.set(header, column);
      }
      if (found.size === followUpHeaders.length) columns = found;
      else if (found.size >= 3) throw new Error(t.missingColumns(followUpHeaders.filter(name => !found.has(name)).join(", ")));
      continue;
    }
    const get = (header: FollowUpHeader) => cells.get(columns!.get(header)!) ?? "";
    const poDigits = get("PO Totvs").replace(/\D/gu, "");
    const productCode = get("Product Code");
    if (!poDigits || !productCode) continue;
    if (cancelledText(get("Status")) || cancelledText(get("IP Number"))) { cancelled += 1; continue; }
    const quantity = get("Qty");
    if (!/^\d+(?:\.\d+)?$/u.test(quantity) || Number(quantity) <= 0) { ignored += 1; continue; }
    const price = get("Unit Price");
    lines.push({ sourceRow: row, importer: get("Importer"), poNumber: poDigits.padStart(6, "0"),
      supplier: get("Supplier").toLocaleUpperCase("en-US"), productCode, quantity,
      unitPrice: /^\d+(?:\.\d+)?$/u.test(price) ? price : null,
      currency: get("Currency").toLocaleUpperCase("en-US") || null, ipNumber: validIp(get("IP Number")), status: get("Status") });
  }
  if (!columns) throw new Error(t.headerMissing);
  return { fileName: file.name, lines, cancelled, ignored,
    fileSha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map(value => value.toString(16).padStart(2, "0")).join("") };
}

const normalizedPo = (value: string) => value.replace(/\D/gu, "").replace(/^0+(?=\d)/u, "");
const normalizedIp = (value: string) => value.toLocaleUpperCase("en-US").replace(/\s+/gu, "");

/**
 * The Follow Up writes the HEXING IPs without the IPH prefix (IPH034A/2026 is 034A/2026 there, in the
 * same 196 lines the system has), and the other suppliers with their own prefix (Z-021B/2026).
 */
export function followUpIpMatches(followUpIp: string, invoiceIp: string): boolean {
  const followUp = normalizedIp(followUpIp), invoice = normalizedIp(invoiceIp);
  return Boolean(followUp && invoice) && (followUp === invoice || (invoice.startsWith("IPH") && followUp === invoice.slice(3)));
}

/** Importers of the Follow Up lines of the POs the invoice cites. */
export function followUpImporters(lines: readonly FollowUpPoLine[], poNumbers: readonly string[]): string[] {
  const wanted = new Set(poNumbers.map(normalizedPo));
  return [...new Set(lines.filter(line => wanted.has(normalizedPo(line.poNumber))).map(line => line.importer))].sort();
}

/** The Follow Up IPs taken as the invoice IP, shown to the analyst. */
export function followUpSameIps(lines: readonly FollowUpPoLine[], invoiceIp: string): string[] {
  return [...new Set(lines.filter(line => followUpIpMatches(line.ipNumber, invoiceIp)).map(line => line.ipNumber))].sort();
}

export type FollowUpCandidate = { id: string; lineNumber: number; poNumber: string; productCode: string; remainingQuantity: string;
  orderedQuantity: string; unit: null; unitPrice: string | null; currency: string | null; supplier: string; ipNumber: string };

/**
 * The lines of one PO in the importer that can receive the invoice: without IP, or already on the invoice IP
 * (as the revision of an IP). Each Follow Up line is one PO item, in the order of the sheet.
 */
export function followUpCandidates(lines: readonly FollowUpPoLine[], importer: string, poNumber: string, invoiceIp: string):
  { poExists: boolean; items: FollowUpCandidate[] } {
  const po = normalizedPo(poNumber);
  const ofPo = lines.filter(line => line.importer === importer && normalizedPo(line.poNumber) === po);
  return { poExists: ofPo.length > 0, items: ofPo.filter(line => !line.ipNumber || followUpIpMatches(line.ipNumber, invoiceIp))
    .map(line => ({ id: `fu:${line.sourceRow}`, lineNumber: line.sourceRow, poNumber: line.poNumber, productCode: line.productCode,
      remainingQuantity: line.quantity, orderedQuantity: line.quantity, unit: null, unitPrice: line.unitPrice,
      currency: line.currency, supplier: line.supplier, ipNumber: line.ipNumber })) };
}
