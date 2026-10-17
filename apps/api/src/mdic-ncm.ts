import ExcelJS, { type CellValue } from "exceljs";
import {
  fetchOfficialNcmCatalog as fetchSiscomexNcmCatalog,
  type OfficialNcmCatalog,
} from "./siscomex-ncm.js";

export const MDIC_NCM_PAGE_URL =
  "https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes";
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
const MIN_OFFICIAL_NCM_COUNT = 9_000;

function plainCellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if ("richText" in value) return value.richText.map(part => part.text).join("").trim();
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  return "";
}

function findWorkbookUrl(html: string, pageUrl: string): string {
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu)]
    .map(match => ({ href: match[2].replaceAll("&amp;", "&"), text: match[3].replace(/<[^>]*>/gu, " ") }))
    .filter(link => /\.xlsx(?:$|[?#])/iu.test(link.href));
  for (const link of links) {
    const url = new URL(link.href, pageUrl);
    if (url.protocol === "https:" && url.hostname === "www.gov.br"
      && url.pathname.includes("/arquivos-listas/")
      && /anexos-i-a-x-resolucao-gecex-272-21\.xlsx$/iu.test(url.pathname)) return url.href;
  }
  throw new Error("A página oficial de tarifas do MDIC não apresentou a planilha vigente dos Anexos I a X.");
}

function sourceUpdateDate(html: string): string | null {
  const pageText = html.replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/\s+/gu, " ");
  const match = /Atualizado\s+em\s+(\d{2})\/(\d{2})\/(\d{4})/iu.exec(pageText);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, 10) === `${year}-${month}-${day}` ? `${year}-${month}-${day}` : null;
}

async function parseMdicWorkbook(bytes: Uint8Array, updatedAt: string | null, sourceReference: string): Promise<OfficialNcmCatalog> {
  const workbook = new ExcelJS.Workbook();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const loaded = await workbook.xlsx.load(buffer);
  const sheet = loaded.worksheets.find(candidate => /^Anexo I\s*[-–]/iu.test(candidate.name));
  if (!sheet) throw new Error("A planilha do MDIC não contém o Anexo I da TEC.");

  let codeColumn = 0;
  let nameColumn = 0;
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const header = plainCellText(row.getCell(column).value).normalize("NFD")
        .replace(/[\u0300-\u036f]/gu, "").toUpperCase();
      if (header === "NCM") codeColumn = column;
      if (header === "DESCRICAO") nameColumn = column;
    }
    if (codeColumn && nameColumn) break;
  }
  if (!codeColumn || !nameColumn) throw new Error("Não foi possível localizar as colunas NCM e descrição no Anexo I do MDIC.");

  const items = new Map<string, OfficialNcmCatalog["items"][number]>();
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const rawCode = plainCellText(row.getCell(codeColumn).value);
    const code = rawCode.replaceAll(".", "").replace(/\s/gu, "");
    if (!/^\d{8}$/u.test(code)) continue;
    const name = plainCellText(row.getCell(nameColumn).value).replace(/^[\s\-–—]+/u, "").replace(/\s+/gu, " ").trim();
    if (!name || name.length > 2_000) throw new Error(`Descrição inválida para a NCM ${code} no Anexo I do MDIC.`);
    const existing = items.get(code);
    if (existing && existing.name !== name) throw new Error(`A NCM ${code} aparece com descrições divergentes no Anexo I do MDIC.`);
    items.set(code, { code, name, validFrom: null, validTo: null, mandatoryImportAttributes: [] });
  }
  if (items.size < MIN_OFFICIAL_NCM_COUNT) {
    throw new Error("A planilha oficial do MDIC parece incompleta; a atualização do catálogo foi cancelada.");
  }
  return {
    source: "MDIC_GECEX",
    sourceReference,
    sourceUpdatedAt: updatedAt,
    attributesVersion: "not-provided",
    items: [...items.values()].sort((left, right) => left.code.localeCompare(right.code)),
  };
}

export async function fetchMdicNcmCatalog(fetcher: typeof fetch = fetch): Promise<OfficialNcmCatalog> {
  const pageResponse = await fetcher(MDIC_NCM_PAGE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!pageResponse.ok) throw new Error(`A página oficial de tarifas do MDIC respondeu com HTTP ${pageResponse.status}.`);
  const pageBytes = await pageResponse.arrayBuffer();
  if (pageBytes.byteLength > MAX_PAGE_BYTES) throw new Error("A página oficial do MDIC excede o tamanho permitido.");
  const html = new TextDecoder("utf-8", { fatal: true }).decode(pageBytes);
  const updatedAt = sourceUpdateDate(html);
  const workbookUrl = findWorkbookUrl(html, MDIC_NCM_PAGE_URL);
  const workbookResponse = await fetcher(workbookUrl, { signal: AbortSignal.timeout(60_000) });
  if (!workbookResponse.ok) throw new Error(`A planilha oficial do MDIC respondeu com HTTP ${workbookResponse.status}.`);
  const workbookBytes = await workbookResponse.arrayBuffer();
  if (workbookBytes.byteLength > MAX_WORKBOOK_BYTES) throw new Error("A planilha oficial do MDIC excede o tamanho permitido.");
  const pageDate = updatedAt ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${updatedAt}T00:00:00Z`)) : null;
  const sourceReference = `MDIC — Resolução Gecex nº 272/2021, Anexo I${pageDate ? ` (planilha atualizada em ${pageDate})` : ""}`;
  return parseMdicWorkbook(new Uint8Array(workbookBytes), updatedAt, sourceReference);
}

export async function fetchOfficialNcmCatalogWithFallback(fetcher: typeof fetch = fetch): Promise<OfficialNcmCatalog> {
  let siscomexError: unknown;
  let siscomexRetryAt: number | null = null;
  try {
    return await fetchSiscomexNcmCatalog(fetcher);
  } catch (error) {
    siscomexError = error;
    if (error && typeof error === "object" && "retryAt" in error
      && typeof error.retryAt === "number" && Number.isFinite(error.retryAt)) {
      siscomexRetryAt = error.retryAt;
    }
  }

  try {
    return { ...await fetchMdicNcmCatalog(fetcher), siscomexRetryAt };
  } catch (mdicError) {
    const combined = new AggregateError([siscomexError, mdicError], "As fontes oficiais Siscomex e MDIC estão indisponíveis.");
    if (siscomexError && typeof siscomexError === "object") {
      if ("retryAt" in siscomexError && typeof siscomexError.retryAt === "number") {
        Object.assign(combined, { retryAt: siscomexError.retryAt });
      }
      if ("statusCode" in siscomexError && typeof siscomexError.statusCode === "number") {
        Object.assign(combined, { statusCode: siscomexError.statusCode });
      }
    }
    throw combined;
  }
}
