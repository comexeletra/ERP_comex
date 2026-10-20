import type { Pool } from "pg";

export const TTCE_SOURCE = "https://api-docs.portalunico.siscomex.gov.br/api/ttce/";
const TTCE_VALIDATION_ORIGIN = "https://val.portalunico.siscomex.gov.br";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const FRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;

type RecordValue = Record<string, unknown>;
function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`TTCE: ${label} inválido.`);
  return value as RecordValue;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`TTCE: ${label} inválida.`);
  return value;
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function hash(value: unknown): string {
  const result = text(value).toUpperCase();
  if (!/^[A-F0-9]{64}$/u.test(result)) throw new Error("TTCE: hash inválido.");
  return result;
}
function date(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error("TTCE: data inválida.");
  }
  return result;
}
function ncm(value: unknown): string {
  const result = text(value);
  if (!/^\d{8}$/u.test(result)) throw new Error("TTCE: intervalo NCM inválido.");
  return result;
}
function releaseTime(message: string, now: number): number | null {
  const match = /ap[oó]s\s+(?:(?:as|às)\s+)?(\d{2}):(\d{2}):(\d{2})/iu.exec(message);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23" });
  const parts = (instant: number) => Object.fromEntries(clock.formatToParts(new Date(instant))
    .filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  const current = parts(now);
  const convert = (day: number) => {
    const target = Date.UTC(current.year, current.month - 1, day, hour, minute, second);
    let candidate = target;
    for (let index = 0; index < 3; index++) {
      const local = parts(candidate);
      candidate += target - Date.UTC(local.year, local.month - 1, local.day,
        local.hour, local.minute, local.second);
    }
    return candidate;
  };
  const today = convert(current.day);
  return today > now ? today : convert(current.day + 1);
}
function codeName(value: unknown, label: string): { code: string; name: string; type?: string } {
  const row = object(value, label);
  const code = text(row.codigo), name = text(row.nome);
  if (!code || !name) throw new Error(`TTCE: ${label} incompleto.`);
  return { code, name, ...(text(row.tipo) ? { type: text(row.tipo) } : {}) };
}

export type TtceTreatment = {
  tax: { code: string; name: string };
  regime: { code: string; name: string };
  legalBasis: { code: string; name: string; type?: string };
  attributes: Array<{ code: string; name: string; fillType: string | null; domains: unknown[] }>;
};
export type TtceSelection = { treatments: TtceTreatment[]; matchedIntervals: number };

// The batch API intentionally omits normal/ceiling treatments without additional attributes.
// A returned empty list must never be interpreted as "no tax".
export function selectTtceTreatments(payload: unknown, args: {
  ncm: string; originCountry: string; destinationUf: string; destinationCity: string;
}): TtceSelection {
  const root = object(payload, "arquivo");
  const chapter = args.ncm.slice(0, 2);
  if (text(root.capitulo) !== chapter) throw new Error("TTCE: capítulo diferente da NCM consultada.");
  const definitions = new Map<number, TtceTreatment>();
  for (const raw of array(root.listaChavesTratamentos, "lista de tratamentos")) {
    const row = object(raw, "chave de tratamento");
    const key = Number(row.chave);
    if (!Number.isSafeInteger(key) || definitions.has(key)) throw new Error("TTCE: chave de tratamento inválida.");
    const treatment = object(row.tratamentos, "tratamento");
    const attributes = array(treatment.atributos ?? [], "atributos").map(rawAttribute => {
      const item = object(rawAttribute, "atributo");
      const attributeCode = text(item.codigo), name = text(item.descricaoCodigo);
      if (!attributeCode || !name) throw new Error("TTCE: atributo incompleto.");
      return { code: attributeCode, name, fillType: text(item.formaPreenchimento) || null,
        domains: Array.isArray(item.dominios) ? item.dominios : [] };
    });
    definitions.set(key, { tax: codeName(treatment.tributo, "tributo"),
      regime: codeName(treatment.regime, "regime"),
      legalBasis: codeName(treatment.fundamentoLegal, "fundamento legal"), attributes });
  }
  const selected = new Map<number, TtceTreatment>();
  let matchedIntervals = 0;
  for (const rawInterval of array(root.intervalosNcm, "intervalos NCM")) {
    const interval = object(rawInterval, "intervalo NCM");
    if (args.ncm < ncm(interval.intervaloInicialNcm) || args.ncm > ncm(interval.intervaloFinalNcm)) continue;
    matchedIntervals++;
    for (const rawOrigin of array(interval.origensDestinosTratamentos, "origens")) {
      const origin = object(rawOrigin, "origem");
      const countries = origin.paisesOrigem === undefined ? [] : array(origin.paisesOrigem, "países");
      if (origin.todosPaisesOrigem !== true
        && !countries.some(value => /^\d+$/u.test(text(value)) && Number(value) === Number(args.originCountry))) continue;
      for (const rawDestination of array(origin.destinosTratamentos, "destinos")) {
        const destination = object(rawDestination, "destino");
        const matches = array(destination.destinos, "lista de destinos").some(raw => {
          const item = object(raw, "destino");
          if (item.todasUfsMunicipios === true) return true;
          return array(item.ufsMunicipios, "UFs").some(rawUf => {
            const uf = object(rawUf, "UF");
            return text(uf.ufDestino).toUpperCase() === args.destinationUf.toUpperCase()
              && (uf.todosMunicipios === true
                || array(uf.municipioDestino, "municípios").some(value => text(value) === args.destinationCity));
          });
        });
        if (!matches) continue;
        for (const rawKey of array(destination.chavesTratamentos, "chaves de tratamentos")) {
          const key = Number(rawKey), treatment = definitions.get(key);
          if (!treatment) throw new Error("TTCE: referência a tratamento desconhecido.");
          selected.set(key, treatment);
        }
      }
    }
  }
  return { treatments: [...selected.values()], matchedIntervals };
}

export type TtceCredentials = { clientId: string; clientSecret: string; roleType: string; origin?: string };
export class TtceError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAt: number | null = null) {
    super(message);
  }
}

export function createTtceClient(credentials: TtceCredentials, fetcher: typeof fetch = fetch,
  now: () => number = Date.now) {
  const origin = credentials.origin ?? TTCE_VALIDATION_ORIGIN;
  if (![TTCE_VALIDATION_ORIGIN, "https://portalunico.siscomex.gov.br"].includes(origin)) {
    throw new Error("Origem TTCE fora dos ambientes oficiais autorizados.");
  }
  let session: { jwt: string; csrf: string; expires: number } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let blockedUntil = 0;
  async function read(response: Response): Promise<unknown> {
    const size = Number(response.headers.get("content-length"));
    if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) throw new TtceError("Arquivo TTCE excede 8 MB.", 502);
    if (!response.body) throw new TtceError("Resposta TTCE vazia.", 502);
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new TtceError("Arquivo TTCE excede 8 MB.", 502); }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new TtceError("JSON TTCE inválido.", 502); }
  }
  async function request(path: string): Promise<unknown> {
    if (blockedUntil > now()) throw new TtceError("Consulta TTCE temporariamente suspensa.", 503, blockedUntil);
    if (!session || session.expires < now() + 60_000) {
      const auth = await safeFetch(`${origin}/portal/api/autenticar/chave-acesso`, {
        method: "POST", headers: { "Client-Id": credentials.clientId, "Client-Secret": credentials.clientSecret,
          "Role-Type": credentials.roleType }, signal: AbortSignal.timeout(15_000),
      });
      if (!auth.ok) {
        blockedUntil = now() + RETRY_MS;
        throw new TtceError("Credencial TTCE não autorizada.", 503, blockedUntil);
      }
      const jwt = auth.headers.get("set-token"), csrf = auth.headers.get("x-csrf-token");
      if (!jwt || !csrf) throw new TtceError("Autenticação TTCE sem tokens esperados.", 502);
      session = { jwt, csrf, expires: Number(auth.headers.get("x-csrf-expiration")) || now() + 50 * 60_000 };
    }
    const response = await safeFetch(`${origin}/ttce${path}`, { headers: {
      Authorization: session.jwt, "X-CSRF-Token": session.csrf, Accept: "application/json",
    }, signal: AbortSignal.timeout(20_000) });
    const renewed = response.headers.get("x-csrf-token");
    if (renewed) session.csrf = renewed;
    if (response.status === 401 || response.status === 403) {
      session = null;
      blockedUntil = now() + RETRY_MS;
      throw new TtceError("Acesso TTCE sem permissão ou sessão expirada.", 503, blockedUntil);
    }
    if (!response.ok) {
      if ([422, 429, 503].includes(response.status)) {
        const retryHeader = response.headers.get("retry-after");
        const retrySeconds = retryHeader === null ? NaN : Number(retryHeader);
        const retryDate = retryHeader && Number.isNaN(retrySeconds) ? Date.parse(retryHeader) : NaN;
        let bodyRelease: number | null = null;
        if (response.body) {
          const reader = response.body.getReader();
          const first = await reader.read();
          await reader.cancel();
          if (first.value) {
            const raw = new TextDecoder().decode(first.value.slice(0, 4096));
            let message = raw;
            try { message = text(object(JSON.parse(raw), "erro").message) || raw; } catch { /* Keep raw text. */ }
            bodyRelease = releaseTime(message, now());
          }
        }
        blockedUntil = Math.max(now() + RETRY_MS,
          Number.isFinite(retrySeconds) && retrySeconds > 0 ? now() + retrySeconds * 1000 : 0,
          Number.isFinite(retryDate) ? retryDate : 0, bodyRelease ?? 0);
      }
      throw new TtceError("Fonte TTCE indisponível.", 503, blockedUntil > now() ? blockedUntil : null);
    }
    return read(response);
  }
  async function safeFetch(url: string, options: RequestInit): Promise<Response> {
    try { return await fetcher(url, options); }
    catch {
      blockedUntil = now() + RETRY_MS;
      throw new TtceError("Não foi possível conectar ao TTCE.", 503, blockedUntil);
    }
  }
  // Serialize requests because each response renews the CSRF token.
  function serialized(path: string): Promise<unknown> {
    const result = queue.then(() => request(path));
    queue = result.catch(() => undefined);
    return result;
  }
  return {
    async getHash(referenceDate: string, chapter: string): Promise<string> {
      const answer = object(await serialized(`/api/ext/importacao/ncm-capitulos/${chapter}/hash?data=${referenceDate}`), "hash do capítulo");
      if (date(answer.data) !== referenceDate || text(answer.capitulo) !== chapter) {
        throw new TtceError("Hash TTCE para outra data ou capítulo.", 502);
      }
      return hash(answer.hash);
    },
    async download(referenceDate: string, chapter: string, expected: string): Promise<RecordValue> {
      const payload = object(await serialized(`/api/ext/importacao/ncm-capitulos/${chapter}/tratamentos-tributarios?data=${referenceDate}&hash=${expected}`), "arquivo do capítulo");
      if (date(payload.dataFatoGerador) !== referenceDate || text(payload.capitulo) !== chapter
        || hash(payload.hash) !== expected) throw new TtceError("Arquivo TTCE não corresponde ao hash solicitado.", 502);
      array(payload.intervalosNcm, "intervalos NCM");
      array(payload.listaChavesTratamentos, "tratamentos");
      return payload;
    },
  };
}

export function createTtceRepository(pool: Pool, download?: ReturnType<typeof createTtceClient>,
  now: () => number = Date.now) {
  const running = new Map<string, Promise<{ payload: RecordValue; sourceHash: string; fetchedAt: Date; stale: boolean }>>();
  async function get(referenceDate: string, chapter: string) {
    const key = `${referenceDate}:${chapter}`;
    const existing = running.get(key);
    if (existing) return existing;
    const task = (async () => {
      const result = await pool.query<{ payload: RecordValue; source_hash: string; fetched_at: Date; checked_at: Date }>(
        `SELECT payload,source_hash,fetched_at,checked_at FROM catalog.ttce_chapter_cache
         WHERE reference_date=$1 AND chapter=$2 ORDER BY fetched_at DESC LIMIT 1`, [referenceDate, chapter]);
      const cached = result.rows[0];
      if (cached && now() - cached.checked_at.getTime() < FRESH_MS) {
        return { payload: cached.payload, sourceHash: cached.source_hash, fetchedAt: cached.fetched_at, stale: false };
      }
      if (!download) {
        if (cached) return { payload: cached.payload, sourceHash: cached.source_hash, fetchedAt: cached.fetched_at, stale: true };
        throw new TtceError("Consulta tributária aguardando credenciais do Portal Único.", 503);
      }
      try {
        const sourceHash = await download.getHash(referenceDate, chapter);
        if (cached?.source_hash.toUpperCase() === sourceHash) {
          await pool.query(
            `UPDATE catalog.ttce_chapter_cache SET checked_at=now()
             WHERE reference_date=$1 AND chapter=$2 AND source_hash=$3`,
            [referenceDate, chapter, sourceHash]);
          return { payload: cached.payload, sourceHash: cached.source_hash,
            fetchedAt: cached.fetched_at, stale: false };
        }
        const payload = await download.download(referenceDate, chapter, sourceHash);
        await pool.query(
          `INSERT INTO catalog.ttce_chapter_cache (reference_date,chapter,source_hash,payload)
           VALUES ($1,$2,$3,$4::jsonb)
           ON CONFLICT (reference_date,chapter,source_hash)
           DO UPDATE SET checked_at=now(),fetched_at=now()`,
          [referenceDate, chapter, sourceHash, JSON.stringify(payload)]);
        return { payload, sourceHash, fetchedAt: new Date(now()), stale: false };
      } catch (error) {
        if (cached) return { payload: cached.payload, sourceHash: cached.source_hash, fetchedAt: cached.fetched_at, stale: true };
        throw error;
      }
    })().finally(() => running.delete(key));
    running.set(key, task);
    return task;
  }
  return get;
}
