import ExcelJS, { type CellValue, type Worksheet } from "exceljs";

// Tax rates per NCM come from their own official files. This module must stay
// independent from the NCM nomenclature flow (siscomex-ncm, mdic-ncm, ncm-sync,
// ncm-snapshot): it neither imports those modules nor writes their tables.
export const GECEX_RATES_PAGE_URL =
  "https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes";
export const TIPI_URL =
  "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.xlsx";
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
const MIN_NCM_COUNT = 9_000;

export type ExceptionAnnex = "III" | "IV" | "V" | "VI" | "VIII" | "IX" | "X";
export type IiException = {
  annex: ExceptionAnnex;
  /** Eight digits, or a 4/6-digit heading for the aeronautical list. */
  ncm: string;
  exNumber: string | null;
  rate: string | null;
  quota: string | null;
  validFrom: string | null;
  validTo: string | null;
  act: string | null;
  description: string | null;
};
export type GecexRates = {
  sourceReference: string;
  tec: Array<{ code: string; name: string; rate: string; marker: "BK" | "BIT" | null }>;
  brazil: Array<{ code: string; rate: string; basis: string | null }>;
  exceptions: IiException[];
};
export type TipiRow = { code: string; exNumber: string | null; description: string; rate: string | null; notTaxed: boolean };
export type TipiRates = { sourceReference: string; rows: TipiRow[] };

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if ("richText" in value) return value.richText.map(part => part.text).join("").trim();
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  if ("result" in value && value.result !== undefined && value.result !== null) {
    return cellText(value.result as CellValue);
  }
  return "";
}
function cellValue(value: CellValue): CellValue {
  return value && typeof value === "object" && !(value instanceof Date) && "result" in value
    ? value.result as CellValue : value;
}
function header(value: CellValue): string {
  return cellText(value).normalize("NFD").replace(/[̀-ͯ]/gu, "").toUpperCase().replace(/\s+/gu, " ");
}
function spaced(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function empty(value: string): boolean { return value === "" || value === "-"; }

export function normalizePercent(value: unknown): string {
  const raw = typeof value === "number" ? value
    : typeof value === "string" && /^\d+(?:[.,]\d+)?$/u.test(value.trim()) ? Number(value.trim().replace(",", "."))
      : Number.NaN;
  if (!Number.isFinite(raw) || raw < 0 || raw > 1_000) throw new Error(`alíquota inválida: ${String(value)}`);
  return String(Number(raw.toFixed(4)));
}

function ncmCode(text: string): string | null {
  return /^\d{4}\.\d{2}\.\d{2}$/u.test(text) ? text.replaceAll(".", "") : null;
}
function exNumber(value: CellValue, width: number): string | null {
  const text = cellText(cellValue(value));
  if (empty(text)) return null;
  const digits = /^(?:EX\s*)?(\d{1,3})$/iu.exec(text);
  if (!digits) throw new Error(`Número de Ex inválido: ${text}`);
  return digits[1].padStart(width, "0");
}
function isoDate(value: CellValue): string | null {
  const raw = cellValue(value);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const text = cellText(raw);
  if (empty(text)) return null;
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(text);
  const result = local ? `${local[3]}-${local[2]}-${local[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) {
    throw new Error(`Data de vigência inválida: ${text}`);
  }
  return result;
}

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new ExcelJS.Workbook().xlsx.load(buffer);
}
function sheet(workbook: ExcelJS.Workbook, annex: string): Worksheet {
  const found = workbook.worksheets.find(candidate => new RegExp(`^Anexo ${annex}\\s*[-–]`, "iu").test(candidate.name));
  if (!found) throw new Error(`A planilha da Resolução Gecex nº 272/2021 não contém o Anexo ${annex}.`);
  return found;
}
function headerRow(target: Worksheet, label: string): { row: number; columns: string[] } {
  for (let row = 1; row <= Math.min(target.rowCount, 30); row++) {
    const columns: string[] = [];
    for (let column = 1; column <= target.columnCount; column++) columns.push(header(target.getRow(row).getCell(column).value));
    if (columns[0] === "NCM") return { row, columns };
  }
  throw new Error(`Cabeçalho NCM não encontrado em ${label}.`);
}
function column(columns: string[], label: string, test: (name: string) => boolean): number {
  const index = columns.findIndex(test);
  if (index < 0) throw new Error(`Coluna esperada não encontrada em ${label}.`);
  return index + 1;
}
function updatedText(target: Worksheet, pattern: RegExp): string | null {
  for (let row = 1; row <= Math.min(target.rowCount, 10); row++) {
    const text = spaced(cellText(target.getRow(row).getCell(1).value));
    if (pattern.test(text)) return text.slice(0, 4_000);
  }
  return null;
}

function parseExceptions(target: Worksheet, annex: Exclude<ExceptionAnnex, "III">): IiException[] {
  const label = `Anexo ${annex}`;
  const { row: first, columns } = headerRow(target, label);
  const ex = column(columns, label, name => /^N\S*\s*EX$/u.test(name));
  const rate = column(columns, label, name => name.startsWith("ALIQUOTA"));
  const quota = column(columns, label, name => name === "QUOTA");
  const unit = column(columns, label, name => name.startsWith("UNIDADE"));
  const start = column(columns, label, name => name.startsWith("INICIO"));
  const endIndex = columns.findIndex(name => name.startsWith("TERMINO"));
  const act = column(columns, label, name => name.startsWith("ATO DE INCLUSAO"));
  const description = column(columns, label, name => name.startsWith("DESCRICAO"));
  const result: IiException[] = [];
  for (let index = first + 1; index <= target.rowCount; index++) {
    const row = target.getRow(index);
    const ncm = ncmCode(cellText(row.getCell(1).value));
    if (!ncm) continue;
    const quotaText = cellText(cellValue(row.getCell(quota).value));
    const unitText = cellText(row.getCell(unit).value);
    result.push({ annex, ncm, exNumber: exNumber(row.getCell(ex).value, 3),
      rate: normalizePercent(cellValue(row.getCell(rate).value)),
      quota: empty(quotaText) ? null : spaced(`${quotaText} ${empty(unitText) ? "" : unitText}`),
      validFrom: isoDate(row.getCell(start).value),
      validTo: endIndex < 0 ? null : isoDate(row.getCell(endIndex + 1).value),
      act: spaced(cellText(row.getCell(act).value)) || null,
      description: spaced(cellText(row.getCell(description).value)).slice(0, 2_000) || null });
  }
  return result;
}

export async function parseGecexRatesWorkbook(bytes: Uint8Array): Promise<GecexRates> {
  const workbook = await loadWorkbook(bytes);
  const annexes = { I: sheet(workbook, "I"), II: sheet(workbook, "II"), III: sheet(workbook, "III"),
    IV: sheet(workbook, "IV"), V: sheet(workbook, "V"), VI: sheet(workbook, "VI"), VIII: sheet(workbook, "VIII"),
    IX: sheet(workbook, "IX"), X: sheet(workbook, "X") };

  const tecHeader = headerRow(annexes.I, "Anexo I");
  const name = column(tecHeader.columns, "Anexo I", value => value === "DESCRICAO");
  const tecRate = column(tecHeader.columns, "Anexo I", value => value.startsWith("TEC"));
  const tec = new Map<string, GecexRates["tec"][number]>();
  for (let index = tecHeader.row + 1; index <= annexes.I.rowCount; index++) {
    const row = annexes.I.getRow(index);
    const code = ncmCode(cellText(row.getCell(1).value));
    if (!code) continue;
    const raw = cellValue(row.getCell(tecRate).value);
    const marked = typeof raw === "string" ? /^(\d+(?:[.,]\d+)?)\s*(BK|BIT)?$/iu.exec(raw.trim()) : null;
    const item = { code, name: spaced(cellText(row.getCell(name).value)).replace(/^[-–—\s]+/u, "").slice(0, 2_000),
      rate: normalizePercent(marked ? marked[1] : raw),
      marker: (marked?.[2]?.toUpperCase() ?? null) as "BK" | "BIT" | null };
    const existing = tec.get(code);
    if (existing && existing.rate !== item.rate) throw new Error(`A NCM ${code} aparece com TEC divergente no Anexo I.`);
    tec.set(code, item);
  }
  if (tec.size < MIN_NCM_COUNT) throw new Error("A planilha da TEC parece incompleta; a atualização foi cancelada.");

  const brazilHeader = headerRow(annexes.II, "Anexo II");
  const applied = column(brazilHeader.columns, "Anexo II", value => value.startsWith("ALIQUOTA APLICADA"));
  const basis = column(brazilHeader.columns, "Anexo II", value => value.startsWith("FUNDAMENTACAO"));
  const brazil = new Map<string, GecexRates["brazil"][number]>();
  for (let index = brazilHeader.row + 1; index <= annexes.II.rowCount; index++) {
    const row = annexes.II.getRow(index);
    const code = ncmCode(cellText(row.getCell(1).value));
    if (!code) continue;
    const item = { code, rate: normalizePercent(cellValue(row.getCell(applied).value)),
      basis: spaced(cellText(row.getCell(basis).value)) || null };
    if (brazil.get(code) && brazil.get(code)!.rate !== item.rate) {
      throw new Error(`A NCM ${code} aparece com alíquotas divergentes no Anexo II.`);
    }
    brazil.set(code, item);
  }

  // The aeronautical annex is a grid of headings: it only signals a sector rule.
  const aeronautical = new Set<string>();
  const aeroHeader = headerRow(annexes.III, "Anexo III");
  for (let index = aeroHeader.row + 1; index <= annexes.III.rowCount; index++) {
    for (let cell = 1; cell <= annexes.III.columnCount; cell++) {
      const text = cellText(annexes.III.getRow(index).getCell(cell).value);
      if (/^(?:\d{2}\.\d{2}|\d{4}\.\d{2}|\d{4}\.\d{2}\.\d{2})$/u.test(text)) aeronautical.add(text.replaceAll(".", ""));
    }
  }
  const exceptions: IiException[] = [...aeronautical].sort().map(ncm => ({ annex: "III", ncm, exNumber: null,
    rate: null, quota: null, validFrom: null, validTo: null, act: null, description: null }));
  for (const annex of ["IV", "V", "VI", "VIII", "IX", "X"] as const) exceptions.push(...parseExceptions(annexes[annex], annex));

  const updated = updatedText(annexes.I, /Atualizad[oa] at[eé]/iu);
  return { sourceReference: `Resolução Gecex nº 272/2021${updated ? ` — ${updated}` : ""}`,
    tec: [...tec.values()], brazil: [...brazil.values()], exceptions };
}

export async function parseTipiWorkbook(bytes: Uint8Array): Promise<TipiRates> {
  const workbook = await loadWorkbook(bytes);
  const target = workbook.worksheets.find(candidate => /tabela completa/iu.test(candidate.name)) ?? workbook.worksheets[0];
  if (!target) throw new Error("A planilha da TIPI está vazia.");
  const { row: first, columns } = headerRow(target, "TIPI");
  const ex = column(columns, "TIPI", name => name === "EX");
  const description = column(columns, "TIPI", name => name.startsWith("DESCRICAO"));
  const rate = column(columns, "TIPI", name => name.startsWith("ALIQUOTA"));
  const rows = new Map<string, TipiRow>();
  for (let index = first + 1; index <= target.rowCount; index++) {
    const row = target.getRow(index);
    const code = ncmCode(cellText(row.getCell(1).value));
    if (!code) continue;
    const raw = cellValue(row.getCell(rate).value);
    // A code written with eight digits but without a rate is a heading of its subitems.
    if (cellText(raw) === "") continue;
    const notTaxed = typeof raw === "string" && raw.trim().toUpperCase() === "NT";
    const item: TipiRow = { code, exNumber: exNumber(row.getCell(ex).value, 2),
      description: spaced(cellText(row.getCell(description).value)).slice(0, 2_000),
      rate: notTaxed ? null : normalizePercent(raw), notTaxed };
    const key = `${code}:${item.exNumber ?? ""}`;
    const existing = rows.get(key);
    if (existing && (existing.rate !== item.rate || existing.notTaxed !== item.notTaxed)) {
      throw new Error(`A NCM ${code} aparece com alíquotas divergentes na TIPI.`);
    }
    rows.set(key, item);
  }
  if (new Set([...rows.values()].map(row => row.code)).size < MIN_NCM_COUNT) {
    throw new Error("A planilha da TIPI parece incompleta; a atualização foi cancelada.");
  }
  const updated = updatedText(target, /^Atualiza[cç][oõ]es/iu);
  return { sourceReference: `TIPI — Decreto nº 11.158/2022${updated ? ` — ${updated}` : ""}`, rows: [...rows.values()] };
}

function inForce(item: { validFrom: string | null; validTo: string | null }, date: string): boolean {
  return (!item.validFrom || item.validFrom <= date) && (!item.validTo || item.validTo >= date);
}

export type IiCondition = "applied" | "conflict" | "ex" | "quota" | "sector" | "future";
export type IiComposition = {
  tec: string | null; tecMarker: "BK" | "BIT" | null; brazil: string | null; brazilBasis: string | null;
  applied: string | null; appliedSource: "TEC" | "ANEXO_II" | `ANEXO_${ExceptionAnnex}` | null; appliedAct: string | null;
  status: "ok" | "needs_review" | "missing";
  exceptions: Array<IiException & { condition: IiCondition }>;
};

// Only a whole-NCM exception without quota in force on the date replaces the
// Brazilian rate. Ex, quota and sector rules depend on the product or the
// operation, so they are listed for analysis and never applied here.
export function composeIiRate(input: {
  tec: { rate: string; marker: "BK" | "BIT" | null } | null;
  brazil: { rate: string; basis: string | null } | null;
  exceptions: IiException[];
}, date: string): IiComposition {
  const listed: IiComposition["exceptions"] = [];
  for (const item of input.exceptions) {
    if (item.validTo && item.validTo < date) continue;
    const condition: IiCondition = item.annex === "III" ? "sector"
      : item.validFrom && item.validFrom > date ? "future"
        : item.exNumber ? "ex" : item.quota ? "quota" : "applied";
    listed.push({ ...item, condition });
  }
  const candidates = listed.filter(item => item.condition === "applied" && inForce(item, date));
  const rates = new Set(candidates.map(item => item.rate));
  const tec = input.tec?.rate ?? null;
  const brazil = input.brazil?.rate ?? tec;
  const base = { tec, tecMarker: input.tec?.marker ?? null, brazil, brazilBasis: input.brazil?.basis ?? null };
  if (rates.size > 1) {
    for (const item of candidates) item.condition = "conflict";
    return { ...base, applied: null, appliedSource: null, appliedAct: null, status: "needs_review", exceptions: listed };
  }
  if (candidates[0]) {
    return { ...base, applied: candidates[0].rate, appliedSource: `ANEXO_${candidates[0].annex}`,
      appliedAct: candidates[0].act, status: "ok", exceptions: listed };
  }
  if (brazil === null) {
    return { ...base, applied: null, appliedSource: null, appliedAct: null, status: "missing", exceptions: listed };
  }
  return { ...base, applied: brazil, appliedSource: input.brazil ? "ANEXO_II" : "TEC", appliedAct: null,
    status: "ok", exceptions: listed };
}

export function composeIpiRate(rows: TipiRow[]) {
  const base = rows.find(row => row.exNumber === null);
  const exceptions = rows.filter(row => row.exNumber !== null);
  return base ? { rate: base.rate, notTaxed: base.notTaxed, status: "ok" as const, exceptions }
    : { rate: null, notTaxed: false, status: "missing" as const, exceptions };
}

type PisCofinsRule = { pisRate: string; cofinsRate: string; legalBasis: string; validFrom: string; validTo: string | null };
export function composePisCofinsRate(general: PisCofinsRule[], exceptions: Array<PisCofinsRule & { id: string }>,
  date: string) {
  const exception = exceptions.find(item => inForce(item, date));
  if (exception) {
    return { pis: exception.pisRate, cofins: exception.cofinsRate, legalBasis: exception.legalBasis,
      source: "EXCEPTION" as const, reviewed: true, exceptionId: exception.id };
  }
  const rule = general.find(item => inForce(item, date));
  return rule ? { pis: rule.pisRate, cofins: rule.cofinsRate, legalBasis: rule.legalBasis,
    source: "GENERAL" as const, reviewed: false, exceptionId: null }
    : { pis: null, cofins: null, legalBasis: null, source: "MISSING" as const, reviewed: false, exceptionId: null };
}

async function boundedBytes(response: Response, limit: number, label: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`${label} excede o tamanho permitido.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(`${label} excede o tamanho permitido.`);
  return bytes;
}

export type DownloadedWorkbook = { url: string; bytes: Uint8Array; sourceUpdatedAt: string | null };

export async function downloadGecexWorkbook(fetcher: typeof fetch = fetch): Promise<DownloadedWorkbook> {
  const page = await fetcher(GECEX_RATES_PAGE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!page.ok) throw new Error(`A página de tarifas do MDIC respondeu com HTTP ${page.status}.`);
  const html = new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(page, MAX_PAGE_BYTES, "A página do MDIC"));
  let url: string | null = null;
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1/giu)) {
    const candidate = new URL(match[2].replaceAll("&amp;", "&"), GECEX_RATES_PAGE_URL);
    if (candidate.protocol === "https:" && candidate.hostname === "www.gov.br"
      && candidate.pathname.includes("/arquivos-listas/")
      && /anexos-i-a-x-resolucao-gecex-272-21\.xlsx$/iu.test(candidate.pathname)) { url = candidate.href; break; }
  }
  if (!url) throw new Error("A página de tarifas do MDIC não apresentou a planilha dos Anexos I a X.");
  const text = html.replace(/<[^>]*>/gu, " ").replace(/&nbsp;|&#160;/giu, " ").replace(/\s+/gu, " ");
  const updated = /Atualizado\s+em\s+(\d{2})\/(\d{2})\/(\d{4})/iu.exec(text);
  const workbook = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  if (!workbook.ok) throw new Error(`A planilha do MDIC respondeu com HTTP ${workbook.status}.`);
  return { url, bytes: await boundedBytes(workbook, MAX_WORKBOOK_BYTES, "A planilha do MDIC"),
    sourceUpdatedAt: updated ? `${updated[3]}-${updated[2]}-${updated[1]}` : null };
}

export async function downloadTipiWorkbook(fetcher: typeof fetch = fetch): Promise<DownloadedWorkbook> {
  const response = await fetcher(TIPI_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`A planilha da TIPI respondeu com HTTP ${response.status}.`);
  const modified = Date.parse(response.headers.get("last-modified") ?? "");
  return { url: TIPI_URL, bytes: await boundedBytes(response, MAX_WORKBOOK_BYTES, "A planilha da TIPI"),
    sourceUpdatedAt: Number.isFinite(modified) ? new Date(modified).toISOString().slice(0, 10) : null };
}
