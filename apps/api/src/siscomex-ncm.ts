import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export const SISCOMEX_NCM_URL =
  "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json";
export const SISCOMEX_NCM_ATTRIBUTES_URL =
  "https://portalunico.siscomex.gov.br/cadatributos/api/atributo-ncm/download/json";

const SISCOMEX_TIME_ZONE = "America/Sao_Paulo";
const siscomexClock = new Intl.DateTimeFormat("en-US", {
  timeZone: SISCOMEX_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MIN_OFFICIAL_NCM_COUNT = 9_000;

export type OfficialNcmAttribute = {
  code: string;
  name: string;
  displayName: string;
  fillType: string | null;
  required: true;
  multivalued: boolean;
  startsOn: string | null;
  endsOn: string | null;
  objectives: string[];
  organs: string[];
  conditionalAttributes: Array<{
    required: boolean;
    condition: string | null;
    attribute: Omit<OfficialNcmAttribute, "required">;
  }>;
};

export type OfficialNcm = {
  code: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  mandatoryImportAttributes: OfficialNcmAttribute[];
};

export type OfficialNcmCatalog = {
  sourceUpdatedAt: string | null;
  attributesVersion: string;
  items: OfficialNcm[];
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`A resposta oficial Siscomex não contém ${label} válido.`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`A resposta oficial Siscomex não contém ${label} válido.`);
  return value;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNcmCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^(?:\d{8}|\d{4}\.\d{2}\.\d{2})$/u.test(raw)) return null;
  return raw.replaceAll(".", "");
}

function parseBrazilianDate(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Data inválida na tabela NCM (${label}).`);
  const text = value.trim();
  const isoMatch = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/u.exec(text);
  if (isoMatch) {
    const [year, month, day] = isoMatch[1].split("-");
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.toISOString().slice(0, 10) === isoMatch[1]) return isoMatch[1];
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(text);
  if (!match) throw new Error(`Data inválida na tabela NCM (${label}).`);
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) {
    throw new Error(`Data inválida na tabela NCM (${label}).`);
  }
  return `${year}-${month}-${day}`;
}

function parseHeaderDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(text)) return parseBrazilianDate(text, "ultima atualizacao");
  return parseBrazilianDate(text, "última atualização");
}

function zonedParts(timestamp: number): Record<string, number> {
  return Object.fromEntries(siscomexClock.formatToParts(new Date(timestamp))
    .filter(part => part.type !== "literal")
    .map(part => [part.type, Number(part.value)]));
}

function localSiscomexTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = zonedParts(candidate);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const difference = target - represented;
    candidate += difference;
    if (difference === 0) break;
  }
  return candidate;
}

export function parseSiscomexRetryAt(message: string, now = Date.now()): number | null {
  const match = /ap[oó]s\s+(?:(?:as|às)\s+)?(\d{2}):(\d{2}):(\d{2})/iu.exec(message);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const current = zonedParts(now);
  let retryAt = localSiscomexTimeToUtc(current.year, current.month, current.day,
    hour, minute, second);
  if (retryAt <= now) {
    const nextDay = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
    retryAt = localSiscomexTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(), hour, minute, second);
  }
  return retryAt;
}

class SiscomexResponseError extends Error {
  readonly statusCode: number;
  readonly retryAt: number | null;

  constructor(statusCode: number, retryAt: number | null) {
    super("O Siscomex não respondeu com as tabelas oficiais de NCM e atributos.");
    this.name = "SiscomexResponseError";
    this.statusCode = statusCode;
    this.retryAt = retryAt;
  }
}

export function createOfficialNcmCatalogProvider(
  fetchCatalog: () => Promise<OfficialNcmCatalog>,
  options: { cacheLifetimeMs?: number; initialRetryDelayMs?: number; maxRetryDelayMs?: number; now?: () => number } = {},
): () => Promise<OfficialNcmCatalog> {
  const cacheLifetimeMs = options.cacheLifetimeMs ?? 6 * 60 * 60 * 1000;
  const initialRetryDelayMs = options.initialRetryDelayMs ?? 60 * 60 * 1000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 6 * 60 * 60 * 1000;
  const now = options.now ?? Date.now;
  let cached: { catalog: OfficialNcmCatalog; expiresAt: number } | null = null;
  let loading: Promise<OfficialNcmCatalog> | null = null;
  let blockedUntil = 0;
  let failureCount = 0;

  return async () => {
    const currentTime = now();
    if (cached && cached.expiresAt > currentTime) return cached.catalog;
    if (blockedUntil > currentTime) {
      throw new SiscomexResponseError(429, blockedUntil);
    }
    if (!loading) {
      loading = fetchCatalog().then(catalog => {
        cached = { catalog, expiresAt: now() + cacheLifetimeMs };
        blockedUntil = 0;
        failureCount = 0;
        return catalog;
      }).catch(error => {
        failureCount += 1;
        const exponent = Math.min(failureCount - 1, 10);
        const fallbackDelay = Math.min(maxRetryDelayMs, initialRetryDelayMs * (2 ** exponent));
        const reportedRetryAt = error && typeof error === "object" && "retryAt" in error
          && typeof error.retryAt === "number" && Number.isFinite(error.retryAt) ? error.retryAt : 0;
        blockedUntil = Math.max(reportedRetryAt, now() + fallbackDelay);
        const statusCode = error && typeof error === "object" && "statusCode" in error
          && typeof error.statusCode === "number" ? error.statusCode : 502;
        throw new SiscomexResponseError(statusCode, blockedUntil);
      }).finally(() => { loading = null; });
    }
    return loading;
  };
}

function mapAttributeDefinition(value: unknown, depth = 0): Omit<OfficialNcmAttribute, "required"> {
  if (depth > 8) throw new Error("A hierarquia de atributos Siscomex excede o limite suportado.");
  const detail = asObject(value, "detalhes do atributo");
  const code = asText(detail.codigo);
  const name = asText(detail.nome);
  if (!code || !name) throw new Error("A resposta Siscomex contém atributo sem código ou descrição.");
  const conditionalAttributes = asArray(detail.condicionados ?? [], "atributos condicionados")
    .map(value => asObject(value, "atributo condicionado"))
    .filter(conditioned => conditioned.obrigatorio === true)
    .map(conditioned => ({
      required: true,
      condition: asText(conditioned.descricaoCondicao),
      attribute: mapAttributeDefinition(conditioned.atributo, depth + 1),
    }));

  return {
    code,
    name,
    displayName: asText(detail.nomeApresentacao) ?? name,
    fillType: asText(detail.formaPreenchimento),
    multivalued: detail.multivalorado === true,
    startsOn: asText(detail.dataInicioVigencia),
    endsOn: asText(detail.dataFimVigencia),
    objectives: asArray(detail.objetivos ?? [], "objetivos do atributo")
      .map(objective => asObject(objective, "objetivo do atributo"))
      .map(objective => asText(objective.descricao))
      .filter((objective): objective is string => objective !== null),
    organs: asArray(detail.orgaos ?? [], "órgãos do atributo")
      .map(organ => asText(organ))
      .filter((organ): organ is string => organ !== null),
    conditionalAttributes,
  };
}

function mapRequiredImportAttribute(
  linkValue: unknown,
  details: Map<string, JsonObject>,
): OfficialNcmAttribute | null {
  const link = asObject(linkValue, "vínculo de atributo");
  if (link.modalidade !== "Importação" || link.obrigatorio !== true) return null;
  const code = asText(link.codigo);
  const detail = code ? details.get(code) : undefined;
  if (!code || !detail) throw new Error("Há atributo obrigatório sem detalhes na resposta Siscomex.");
  return {
    ...mapAttributeDefinition(detail),
    required: true,
    multivalued: link.multivalorado === true || detail.multivalorado === true,
    startsOn: asText(link.dataInicioVigencia) ?? asText(detail.dataInicioVigencia),
    endsOn: asText(link.dataFimVigencia) ?? asText(detail.dataFimVigencia),
  };
}

export function parseSiscomexNcmTable(payload: unknown, minimumNcmCount = MIN_OFFICIAL_NCM_COUNT): {
  sourceUpdatedAt: string | null;
  items: Array<Omit<OfficialNcm, "mandatoryImportAttributes">>;
} {
  const root = Array.isArray(payload) ? {} : asObject(payload, "tabela de nomenclaturas");
  const listedNomenclatures = Array.isArray(payload) ? payload
    : root.Nomenclaturas ?? root.nomenclaturas ?? root.listaNomenclaturas ?? root.ncm ?? root.items
      ?? Object.values(root).find(Array.isArray);
  const nomenclaturas = asArray(listedNomenclatures, "lista de nomenclaturas");
  const items = new Map<string, Omit<OfficialNcm, "mandatoryImportAttributes">>();
  for (const value of nomenclaturas) {
    const row = asObject(value, "nomenclatura");
    const code = normalizeNcmCode(row.Codigo ?? row.codigo);
    if (!code) continue;
    const name = asText(row.Descricao ?? row.descricao);
    if (!name || name.length > 2_000) throw new Error(`A descrição oficial do NCM ${code} é inválida.`);
    if (items.has(code)) throw new Error(`A tabela oficial contém NCM duplicado: ${code}.`);
    items.set(code, {
      code,
      name,
      validFrom: parseBrazilianDate(row.Data_Inicio ?? row.dataInicio ?? row.data_inicio, `${code} inicio`),
      validTo: row.Data_Fim === null || row.dataFim === null || row.data_fim === null
        || (row.Data_Fim === undefined && row.dataFim === undefined && row.data_fim === undefined)
        ? null : parseBrazilianDate(row.Data_Fim ?? row.dataFim ?? row.data_fim, `${code} fim`),
    });
  }
  if (items.size < minimumNcmCount) {
    throw new Error("A tabela oficial de NCM parece incompleta; a atualização foi cancelada.");
  }
  return { sourceUpdatedAt: parseHeaderDate(root.Data_Ultima_Atualizacao_NCM ?? root.dataUltimaAlteracao
    ?? root.dataUltimaAtualizacaoNcm ?? root.dataUltimaAtualizacao), items: [...items.values()] };
}

function parseZipJson(zipBytes: Uint8Array): unknown {
  const zip = Buffer.from(zipBytes);
  if (zip.length < 22 || zip.length > MAX_COMPRESSED_BYTES) {
    throw new Error("O arquivo de atributos do Siscomex tem tamanho inválido.");
  }
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = zip.lastIndexOf(endSignature);
  if (endOffset < 0 || endOffset + 22 > zip.length) throw new Error("O arquivo de atributos do Siscomex não é um ZIP válido.");
  const entryCount = zip.readUInt16LE(endOffset + 10);
  const directoryOffset = zip.readUInt32LE(endOffset + 16);
  if (entryCount < 1 || entryCount > 100 || directoryOffset >= zip.length) {
    throw new Error("O arquivo de atributos do Siscomex não contém uma lista JSON válida.");
  }

  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("O arquivo de atributos do Siscomex contém diretório ZIP inválido.");
    }
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = new TextDecoder("utf-8", { fatal: true })
      .decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name.toLowerCase().endsWith(".json")) continue;
    if (name.split(/[\\/]/u).includes("..") || uncompressedSize > MAX_JSON_BYTES) {
      throw new Error("O arquivo JSON de atributos Siscomex excede o limite aceito.");
    }
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("O conteúdo JSON de atributos Siscomex não é válido.");
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const contentStart = localOffset + 30 + localNameLength + localExtraLength;
    const contentEnd = contentStart + compressedSize;
    if (contentEnd > zip.length) throw new Error("O conteúdo JSON de atributos Siscomex está truncado.");
    const compressed = zip.subarray(contentStart, contentEnd);
    const content = method === 0 ? compressed : method === 8
      ? inflateRawSync(compressed, { maxOutputLength: MAX_JSON_BYTES })
      : null;
    if (!content || content.length !== uncompressedSize) {
      throw new Error("O formato de compactação do arquivo de atributos Siscomex não é suportado.");
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)) as unknown;
    } catch {
      throw new Error("O JSON de atributos do Siscomex não pôde ser lido.");
    }
  }
  throw new Error("O arquivo de atributos do Siscomex não contém um JSON.");
}

export function parseSiscomexNcmAttributes(zipBytes: Uint8Array, minimumNcmCount = MIN_OFFICIAL_NCM_COUNT): {
  version: string;
  attributesByNcm: Map<string, OfficialNcmAttribute[]>;
} {
  const root = asObject(parseZipJson(zipBytes), "atributos por NCM");
  const ncmRows = asArray(root.listaNcm, "lista de NCMs com atributos");
  const detailRows = asArray(root.detalhesAtributos, "detalhes dos atributos");
  const details = new Map<string, JsonObject>();
  for (const value of detailRows) {
    const detail = asObject(value, "detalhe de atributo");
    const code = asText(detail.codigo);
    if (code) details.set(code, detail);
  }

  const attributesByNcm = new Map<string, OfficialNcmAttribute[]>();
  for (const value of ncmRows) {
    const row = asObject(value, "NCM com atributos");
    const code = normalizeNcmCode(row.codigoNcm);
    if (!code) continue;
    const attributes = asArray(row.listaAtributos ?? [], "vínculos de atributos")
      .map(link => mapRequiredImportAttribute(link, details))
      .filter((attribute): attribute is OfficialNcmAttribute => attribute !== null);
    attributesByNcm.set(code, [...(attributesByNcm.get(code) ?? []), ...attributes]);
  }
  if (attributesByNcm.size < minimumNcmCount) {
    throw new Error("A tabela de atributos por NCM parece incompleta; a atualização foi cancelada.");
  }
  return { version: String(root.versao ?? "").trim(), attributesByNcm };
}

export function parseSiscomexCatalog(
  ncmPayload: unknown,
  attributesZip: Uint8Array,
  minimumNcmCount = MIN_OFFICIAL_NCM_COUNT,
): OfficialNcmCatalog {
  const nomenclature = parseSiscomexNcmTable(ncmPayload, minimumNcmCount);
  const attributes = parseSiscomexNcmAttributes(attributesZip, minimumNcmCount);
  return {
    sourceUpdatedAt: nomenclature.sourceUpdatedAt,
    attributesVersion: attributes.version,
    items: nomenclature.items.map(item => ({
      ...item,
      mandatoryImportAttributes: attributes.attributesByNcm.get(item.code) ?? [],
    })),
  };
}

export async function fetchOfficialNcmCatalog(fetcher: typeof fetch = fetch): Promise<OfficialNcmCatalog> {
  const [ncmResponse, attributeResponse] = await Promise.all([
    fetcher(SISCOMEX_NCM_URL, { signal: AbortSignal.timeout(60_000) }),
    fetcher(SISCOMEX_NCM_ATTRIBUTES_URL, { signal: AbortSignal.timeout(60_000) }),
  ]);
  if (!ncmResponse.ok || !attributeResponse.ok) {
    const failedResponses = [ncmResponse, attributeResponse].filter(response => !response.ok);
    const retryTimes = await Promise.all(failedResponses.map(async response => {
      try {
        const body = await response.json() as { message?: unknown };
        return typeof body.message === "string" ? parseSiscomexRetryAt(body.message) : null;
      } catch {
        return null;
      }
    }));
    const retryAt = retryTimes.reduce<number | null>((latest, time) => time === null ? latest : Math.max(latest ?? 0, time), null);
    throw new SiscomexResponseError(failedResponses[0]?.status ?? 502, retryAt);
  }
  const [ncmBytes, attributeBytes] = await Promise.all([ncmResponse.arrayBuffer(), attributeResponse.arrayBuffer()]);
  if (ncmBytes.byteLength > MAX_JSON_BYTES || attributeBytes.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error("O Siscomex respondeu com um arquivo maior que o limite aceito.");
  }
  let ncmPayload: unknown;
  try {
    ncmPayload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(ncmBytes)) as unknown;
  } catch {
    throw new Error("A tabela NCM do Siscomex não contém um JSON válido.");
  }
  return parseSiscomexCatalog(ncmPayload, new Uint8Array(attributeBytes));
}

export function officialNcmAttributesHash(attributes: OfficialNcmAttribute[]): string {
  return createHash("sha256").update(JSON.stringify(attributes)).digest("hex");
}
