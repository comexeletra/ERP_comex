import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export const SISCOMEX_NCM_URL =
  "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json";
export const SISCOMEX_NCM_ATTRIBUTES_URL =
  "https://portalunico.siscomex.gov.br/cadatributos/api/atributo-ncm/download/json";

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
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value.trim());
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
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text;
  return parseBrazilianDate(text, "última atualização");
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
  const root = asObject(payload, "tabela de nomenclaturas");
  const nomenclaturas = asArray(root.Nomenclaturas, "lista de nomenclaturas");
  const items = new Map<string, Omit<OfficialNcm, "mandatoryImportAttributes">>();
  for (const value of nomenclaturas) {
    const row = asObject(value, "nomenclatura");
    const code = normalizeNcmCode(row.Codigo);
    if (!code) continue;
    const name = asText(row.Descricao);
    if (!name || name.length > 2_000) throw new Error(`A descrição oficial do NCM ${code} é inválida.`);
    if (items.has(code)) throw new Error(`A tabela oficial contém NCM duplicado: ${code}.`);
    items.set(code, {
      code,
      name,
      validFrom: parseBrazilianDate(row.Data_Inicio, `${code} início`),
      validTo: parseBrazilianDate(row.Data_Fim, `${code} fim`),
    });
  }
  if (items.size < minimumNcmCount) {
    throw new Error("A tabela oficial de NCM parece incompleta; a atualização foi cancelada.");
  }
  return { sourceUpdatedAt: parseHeaderDate(root.Data_Ultima_Atualizacao_NCM), items: [...items.values()] };
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
    throw new Error("O Siscomex não respondeu com as tabelas oficiais de NCM e atributos.");
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
