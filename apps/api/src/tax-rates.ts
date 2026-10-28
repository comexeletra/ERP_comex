import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { composeIiRate, composeIpiRate, composePisCofinsRate, downloadGecexWorkbook, downloadTipiWorkbook,
  parseGecexRatesWorkbook, parseTipiWorkbook, type IiException, type TipiRow } from "./ncm-rates.js";
import { actorAndScopes, BusinessError, problem, record, transaction, versionFrom } from "./operations.js";

// Own lock, state, schedule and tables: a rate refresh never touches the NCM
// nomenclature synchronization, and that synchronization never calls this module.
const LOCK_KEY = "catalog:ncm-rates:refresh";
const SOURCES = ["GECEX_272", "TIPI"] as const;
type Source = typeof SOURCES[number];
type Queryable = Pick<Pool, "query"> | PoolClient;
type Actor = { issuer: string; subject: string };
const systemActor: Actor = { issuer: "system", subject: "ncm-rate-scheduler" };
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC−03:00, without daylight saving since 2019.

export function brasiliaDate(instant: number): string {
  return new Date(instant - BRASILIA_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextNcmRateRefresh(now: number, times: string): number {
  const parsed = times.split(",").map(time => /^(\d{2}):(\d{2})$/u.exec(time.trim()));
  if (!parsed.length || parsed.some(match => !match || Number(match[1]) > 23 || Number(match[2]) > 59)) {
    throw new Error("NCM_RATES_REFRESH_TIME deve conter horários no formato HH:mm separados por vírgula.");
  }
  const [year, month, day] = brasiliaDate(now).split("-").map(Number);
  const candidates = [0, 1].flatMap(offset => parsed.map(match =>
    Date.UTC(year, month - 1, day + offset, Number(match![1]), Number(match![2])) + BRASILIA_OFFSET_MS));
  return Math.min(...candidates.filter(candidate => candidate > now));
}

export class NcmRateRefreshBusy extends Error {
  constructor() { super("Uma atualização das alíquotas já está em execução."); }
}
export type NcmRateRefreshOutcome = { source: Source; status: "unchanged" | "updated" | "restored" | "failed";
  versionId?: string; error?: string };

async function storeGecex(client: PoolClient, versionId: string, bytes: Uint8Array) {
  const parsed = await parseGecexRatesWorkbook(bytes);
  const rows = new Map<string, { code: string; tec_rate: string | null; tec_marker: string | null;
    brazil_rate: string | null; brazil_basis: string | null }>();
  for (const item of parsed.tec) rows.set(item.code, { code: item.code, tec_rate: item.rate, tec_marker: item.marker,
    brazil_rate: null, brazil_basis: null });
  for (const item of parsed.brazil) rows.set(item.code, { code: item.code, tec_rate: null, tec_marker: null,
    ...rows.get(item.code), brazil_rate: item.rate, brazil_basis: item.basis });
  await client.query(`INSERT INTO catalog.ncm_ii_rate (version_id, code, tec_rate, tec_marker, brazil_rate, brazil_basis)
    SELECT $1, x.code, x.tec_rate, x.tec_marker, x.brazil_rate, x.brazil_basis
    FROM jsonb_to_recordset($2::jsonb) AS x(code text, tec_rate numeric, tec_marker text, brazil_rate numeric, brazil_basis text)`,
  [versionId, JSON.stringify([...rows.values()])]);
  await client.query(`INSERT INTO catalog.ncm_ii_exception
      (version_id, position, annex, ncm, ex_number, rate, quota, valid_from, valid_to, act, description)
    SELECT $1, x.position, x.annex, x.ncm, x.ex_number, x.rate, x.quota, x.valid_from, x.valid_to, x.act, x.description
    FROM jsonb_to_recordset($2::jsonb) AS x(position integer, annex text, ncm text, ex_number text, rate numeric,
      quota text, valid_from date, valid_to date, act text, description text)`,
  [versionId, JSON.stringify(parsed.exceptions.map((item, position) => ({ position, annex: item.annex, ncm: item.ncm,
    ex_number: item.exNumber, rate: item.rate, quota: item.quota, valid_from: item.validFrom, valid_to: item.validTo,
    act: item.act, description: item.description })))]);
  return { sourceReference: parsed.sourceReference, itemCount: rows.size };
}

async function storeTipi(client: PoolClient, versionId: string, bytes: Uint8Array) {
  const parsed = await parseTipiWorkbook(bytes);
  await client.query(`INSERT INTO catalog.ncm_ipi_rate (version_id, code, ex_number, description, rate, not_taxed)
    SELECT $1, x.code, x.ex_number, x.description, x.rate, x.not_taxed
    FROM jsonb_to_recordset($2::jsonb) AS x(code text, ex_number text, description text, rate numeric, not_taxed boolean)`,
  [versionId, JSON.stringify(parsed.rows.map(row => ({ code: row.code, ex_number: row.exNumber ?? "",
    description: row.description, rate: row.rate, not_taxed: row.notTaxed })))]);
  return { sourceReference: parsed.sourceReference, itemCount: parsed.rows.length };
}

async function refreshSource(client: PoolClient, source: Source, fetcher: typeof fetch, actor: Actor,
  reason: string): Promise<NcmRateRefreshOutcome> {
  await client.query("UPDATE catalog.ncm_rate_source_state SET last_attempt_at = now() WHERE source = $1", [source]);
  try {
    const file = source === "GECEX_272" ? await downloadGecexWorkbook(fetcher) : await downloadTipiWorkbook(fetcher);
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    const known = await client.query<{ id: string; sha256: string; isCurrent: boolean }>(
      `SELECT id, sha256, is_current AS "isCurrent" FROM catalog.ncm_rate_version
       WHERE source = $1 AND (is_current OR sha256 = $2)`, [source, sha256]);
    const same = known.rows.find(row => row.sha256 === sha256);
    const previous = known.rows.find(row => row.isCurrent) ?? null;
    let outcome: NcmRateRefreshOutcome;
    if (same?.isCurrent) {
      await client.query("UPDATE catalog.ncm_rate_version SET checked_at = now() WHERE id = $1", [same.id]);
      outcome = { source, status: "unchanged", versionId: same.id };
    } else {
      // A failure before COMMIT leaves the previous version current and complete.
      await client.query("BEGIN");
      try {
        const versionId = same?.id ?? randomUUID();
        let stored: { sourceReference: string; itemCount: number } | null = null;
        if (!same) {
          // The rows reference the version, so it is inserted first and becomes current only below.
          await client.query(`INSERT INTO catalog.ncm_rate_version
              (id, source, source_url, source_reference, source_updated_at, sha256, item_count, created_by)
            VALUES ($1, $2, $3, 'pendente', $4, $5, 1, $6)`,
          [versionId, source, file.url, file.sourceUpdatedAt, sha256, `${actor.issuer}#${actor.subject}`]);
          stored = source === "GECEX_272" ? await storeGecex(client, versionId, file.bytes)
            : await storeTipi(client, versionId, file.bytes);
          await client.query("UPDATE catalog.ncm_rate_version SET source_reference = $2, item_count = $3 WHERE id = $1",
            [versionId, stored.sourceReference, stored.itemCount]);
        }
        await client.query("UPDATE catalog.ncm_rate_version SET is_current = false WHERE source = $1 AND is_current", [source]);
        await client.query("UPDATE catalog.ncm_rate_version SET is_current = true, checked_at = now() WHERE id = $1", [versionId]);
        await record(client, "NCM_RATE_VERSION", versionId, "NCM_RATE_VERSION", versionId, same ? "RESTORE" : "IMPORT",
          previous ? { versionId: previous.id, sha256: previous.sha256 } : null,
          { source, sha256, sourceUrl: file.url, ...(stored ?? {}) }, actor, reason);
        await client.query("COMMIT");
        outcome = { source, status: same ? "restored" : "updated", versionId };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    await client.query("UPDATE catalog.ncm_rate_source_state SET last_success_at = now(), last_error = NULL WHERE source = $1",
      [source]);
    return outcome;
  } catch (error) {
    const message = (error instanceof Error ? error.message : "falha desconhecida").slice(0, 500);
    await client.query("UPDATE catalog.ncm_rate_source_state SET last_error = $2 WHERE source = $1", [source, message]);
    return { source, status: "failed", error: message };
  }
}

/** Downloads both official files; each source succeeds or fails on its own. */
export async function refreshNcmRates(pool: Pick<Pool, "connect">, fetcher: typeof fetch, actor: Actor,
  reason: string): Promise<NcmRateRefreshOutcome[]> {
  const client = await pool.connect();
  // The client stays idle while the files download; a lost connection must not crash the API.
  const ignore = () => undefined;
  client.on("error", ignore);
  let locked = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [LOCK_KEY]);
    locked = lock.rows[0]?.acquired === true;
    if (!locked) throw new NcmRateRefreshBusy();
    const outcomes: NcmRateRefreshOutcome[] = [];
    for (const source of SOURCES) outcomes.push(await refreshSource(client, source, fetcher, actor, reason));
    return outcomes;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]).catch(() => undefined);
    client.off("error", ignore);
    client.release();
  }
}

type VersionRow = { id: string; source: Source; sourceReference: string; sourceUrl: string; sourceUpdatedAt: string | null;
  fetchedAt: Date; checkedAt: Date; itemCount: number };
async function currentVersions(db: Queryable): Promise<Map<Source, VersionRow>> {
  const result = await db.query<VersionRow>(`SELECT id, source, source_reference AS "sourceReference", source_url AS "sourceUrl",
      source_updated_at::text AS "sourceUpdatedAt", fetched_at AS "fetchedAt", checked_at AS "checkedAt", item_count AS "itemCount"
    FROM catalog.ncm_rate_version WHERE is_current ORDER BY source`);
  return new Map(result.rows.map(row => [row.source, row]));
}
function presentVersion(row: VersionRow | undefined) {
  return row ? { id: row.id, sourceReference: row.sourceReference, sourceUrl: row.sourceUrl,
    sourceUpdatedAt: row.sourceUpdatedAt, fetchedAt: row.fetchedAt.toISOString(), checkedAt: row.checkedAt.toISOString(),
    itemCount: row.itemCount } : null;
}

type PisCofinsRow = { id: string; code: string; pisRate: string; cofinsRate: string; legalBasis: string;
  validFrom: string; validTo: string | null; version: string };
const pisCofinsColumns = `id, code, trim_scale(pis_rate)::text AS "pisRate", trim_scale(cofins_rate)::text AS "cofinsRate",
  legal_basis AS "legalBasis", valid_from::text AS "validFrom", valid_to::text AS "validTo", version::text AS version`;

/** Composes the rates of up to one page of NCMs from the current versions. */
export async function composeRates(db: Queryable, codes: string[], date: string) {
  const versions = await currentVersions(db);
  const gecex = versions.get("GECEX_272")?.id, tipi = versions.get("TIPI")?.id;
  const prefixes = [...new Set(codes.flatMap(code => [code, code.slice(0, 6), code.slice(0, 4)]))];
  const [ii, exceptions, ipi, general, pisCofins] = await Promise.all([
    gecex ? db.query<{ code: string; tecRate: string | null; tecMarker: "BK" | "BIT" | null; brazilRate: string | null;
      brazilBasis: string | null }>(`SELECT code, trim_scale(tec_rate)::text AS "tecRate", tec_marker AS "tecMarker",
        trim_scale(brazil_rate)::text AS "brazilRate", brazil_basis AS "brazilBasis"
      FROM catalog.ncm_ii_rate WHERE version_id = $1 AND code = ANY($2::text[])`, [gecex, codes]) : { rows: [] },
    gecex ? db.query<IiException>(`SELECT annex, ncm, ex_number AS "exNumber", trim_scale(rate)::text AS rate, quota,
        valid_from::text AS "validFrom", valid_to::text AS "validTo", act, description
      FROM catalog.ncm_ii_exception WHERE version_id = $1 AND ncm = ANY($2::text[]) ORDER BY position`,
    [gecex, prefixes]) : { rows: [] },
    tipi ? db.query<TipiRow>(`SELECT code, nullif(ex_number, '') AS "exNumber", description,
        trim_scale(rate)::text AS rate, not_taxed AS "notTaxed"
      FROM catalog.ncm_ipi_rate WHERE version_id = $1 AND code = ANY($2::text[]) ORDER BY code, ex_number`,
    [tipi, codes]) : { rows: [] },
    db.query<{ pisRate: string; cofinsRate: string; legalBasis: string; validFrom: string; validTo: string | null }>(
      `SELECT trim_scale(pis_rate)::text AS "pisRate", trim_scale(cofins_rate)::text AS "cofinsRate",
        legal_basis AS "legalBasis", valid_from::text AS "validFrom", valid_to::text AS "validTo"
      FROM catalog.pis_cofins_general_rate ORDER BY valid_from`),
    db.query<PisCofinsRow>(`SELECT ${pisCofinsColumns} FROM catalog.ncm_pis_cofins_exception
      WHERE code = ANY($1::text[]) ORDER BY code, valid_from`, [codes]),
  ]);
  const rates = new Map(codes.map(code => {
    const iiRow = ii.rows.find(row => row.code === code);
    return [code, {
      ii: composeIiRate({ tec: iiRow?.tecRate ? { rate: iiRow.tecRate, marker: iiRow.tecMarker } : null,
        brazil: iiRow?.brazilRate ? { rate: iiRow.brazilRate, basis: iiRow.brazilBasis } : null,
        exceptions: exceptions.rows.filter(row => code.startsWith(row.ncm)) }, date),
      ipi: composeIpiRate(ipi.rows.filter(row => row.code === code)),
      pisCofins: composePisCofinsRate(general.rows, pisCofins.rows.filter(row => row.code === code), date),
      pisCofinsExceptions: pisCofins.rows.filter(row => row.code === code),
    }];
  }));
  return { rates, versions };
}

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  chapter: z.string().regex(/^\d{2}$/u).optional(),
  date: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
const detailQuery = z.object({ date: z.iso.date().optional() }).strict();
const rate = z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/u).refine(value => Number(value) <= 100);
const exceptionFields = z.object({
  pisRate: rate, cofinsRate: rate, legalBasis: z.string().trim().min(3).max(500),
  validFrom: z.iso.date(), validTo: z.iso.date().nullable().default(null), reason: z.string().trim().min(3).max(1000),
}).strict().refine(value => value.validTo === null || value.validTo >= value.validFrom);
const createException = z.object({ code: z.string().regex(/^\d{8}$/u) }).and(exceptionFields);
const invalidException = "Informe NCM, alíquotas de 0 a 100% com até 4 casas, base legal, vigência válida e motivo.";

function catchBusiness(reply: FastifyReply, error: unknown) {
  if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
  throw error;
}
async function refuseOverlap(client: PoolClient, code: string, validFrom: string, validTo: string | null, id: string | null) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`catalog:pis-cofins:${code}`]);
  const overlap = await client.query(`SELECT id FROM catalog.ncm_pis_cofins_exception
    WHERE code = $1 AND ($4::uuid IS NULL OR id <> $4::uuid)
      AND daterange(valid_from, valid_to, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`,
  [code, validFrom, validTo, id]);
  if (overlap.rows[0]) {
    throw new BusinessError(409, "PIS_COFINS_PERIOD_OVERLAP", "Já existe uma exceção de PIS/COFINS para essa NCM nesse período.");
  }
}

export async function registerTaxRateRoutes(app: FastifyInstance, pool: Pool, options: {
  refreshTime?: string; fetcher?: typeof fetch;
} = {}): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  let manualRefresh: { status: "running" | "succeeded" | "failed"; startedAt: string; completedAt: string | null;
    results: NcmRateRefreshOutcome[]; error: string | null } | null = null;

  app.get("/api/v1/ncm-rates", { config: permissionConfig("catalog.read", "global") }, async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return problem(reply, 400, "INVALID_NCM_RATE_QUERY", "Revise a busca, o capítulo, a data e a paginação.");
    const date = query.data.date ?? brasiliaDate(Date.now());
    const search = query.data.q?.replace(/[.\s]/gu, "") ?? "";
    const byCode = /^\d+$/u.test(search);
    const text = query.data.q ? `%${query.data.q.toLowerCase().replace(/[\\%_]/gu, match => `\\${match}`)}%` : null;
    const result = await pool.query<{ code: string; name: string; validFrom: string; validTo: string | null; total: string }>(
      `SELECT code, name, valid_from::text AS "validFrom", valid_to::text AS "validTo", count(*) OVER () AS total
      FROM catalog.ncm_official_item
      WHERE valid_from <= $1::date AND (valid_to IS NULL OR valid_to >= $1::date)
        AND ($2::text IS NULL OR code LIKE $2::text || '%')
        AND ($3::text IS NULL OR lower(name) LIKE $3::text ESCAPE '\\')
        AND ($4::text IS NULL OR code LIKE $4::text || '%')
      ORDER BY code LIMIT $5 OFFSET $6`,
    [date, byCode ? search : null, byCode ? null : text, query.data.chapter ?? null, query.data.pageSize,
      (query.data.page - 1) * query.data.pageSize]);
    const { rates, versions } = await composeRates(pool, result.rows.map(row => row.code), date);
    reply.header("cache-control", "no-store");
    return { referenceDate: date, page: query.data.page, pageSize: query.data.pageSize,
      total: Number(result.rows[0]?.total ?? 0),
      sources: SOURCES.map(source => ({ source, version: presentVersion(versions.get(source)) })),
      items: result.rows.map(({ total: _total, ...row }) => {
        const composed = rates.get(row.code)!;
        const { exceptions, ...ii } = composed.ii;
        return { ...row, ii: { ...ii, conditionalCount: exceptions.filter(item => item.condition !== "applied").length },
          ipi: { rate: composed.ipi.rate, notTaxed: composed.ipi.notTaxed, status: composed.ipi.status,
            exCount: composed.ipi.exceptions.length }, pisCofins: composed.pisCofins };
      }) };
  });

  app.get("/api/v1/ncm-rates/status", { config: permissionConfig("catalog.read", "global") }, async (_request, reply) => {
    const [versions, state] = await Promise.all([currentVersions(pool), pool.query<{ source: Source;
      lastAttemptAt: Date | null; lastSuccessAt: Date | null; lastError: string | null }>(
      `SELECT source, last_attempt_at AS "lastAttemptAt", last_success_at AS "lastSuccessAt", last_error AS "lastError"
       FROM catalog.ncm_rate_source_state ORDER BY source`)]);
    reply.header("cache-control", "no-store");
    return { sources: SOURCES.map(source => {
      const row = state.rows.find(item => item.source === source);
      return { source, version: presentVersion(versions.get(source)),
        lastAttemptAt: row?.lastAttemptAt?.toISOString() ?? null, lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null };
    }), manualRefresh,
    nextAutomaticAt: options.refreshTime ? new Date(nextNcmRateRefresh(Date.now(), options.refreshTime)).toISOString() : null };
  });

  app.get<{ Params: { code: string } }>("/api/v1/ncm-rates/:code",
    { config: permissionConfig("catalog.read", "global") }, async (request, reply) => {
      const query = detailQuery.safeParse(request.query);
      if (!/^\d{8}$/u.test(request.params.code) || !query.success) {
        return problem(reply, 400, "INVALID_NCM_RATE_QUERY", "Informe uma NCM de 8 dígitos e uma data válida.");
      }
      const item = await pool.query<{ code: string; name: string; validFrom: string; validTo: string | null }>(
        `SELECT code, name, valid_from::text AS "validFrom", valid_to::text AS "validTo"
         FROM catalog.ncm_official_item WHERE code = $1`, [request.params.code]);
      if (!item.rows[0]) return problem(reply, 404, "NCM_NOT_FOUND", "NCM não encontrada no catálogo oficial.");
      const date = query.data.date ?? brasiliaDate(Date.now());
      const { rates, versions } = await composeRates(pool, [request.params.code], date);
      reply.header("cache-control", "no-store");
      return { ...item.rows[0], referenceDate: date, ...rates.get(request.params.code)!,
        sources: SOURCES.map(source => ({ source, version: presentVersion(versions.get(source)) })) };
    });

  app.post("/api/v1/ncm-rates/refresh", { config: permissionConfig("tax-rates.manage", "global") }, async (request, reply) => {
    let actor: Actor;
    try { actor = actorAndScopes(request).actor; } catch (error) { return catchBusiness(reply, error); }
    if (manualRefresh?.status === "running") return reply.code(202).send({ status: "running" });
    const current = { status: "running" as const, startedAt: new Date().toISOString(), completedAt: null,
      results: [], error: null };
    manualRefresh = current;
    void refreshNcmRates(pool, fetcher, actor, "Atualização manual das alíquotas oficiais").then(results => {
      manualRefresh = { ...current, status: results.some(item => item.status === "failed") ? "failed" : "succeeded",
        completedAt: new Date().toISOString(), results };
    }, (error: unknown) => {
      manualRefresh = { ...current, status: "failed", completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message.slice(0, 500) : "falha desconhecida" };
      request.log.error({ code: "NCM_RATE_REFRESH_FAILED" }, "Atualização manual das alíquotas falhou");
    });
    return reply.code(202).send({ status: "started" });
  });

  app.post("/api/v1/ncm-rates/pis-cofins-exceptions", { config: permissionConfig("tax-rates.manage", "global") },
    async (request, reply) => {
      const parsed = createException.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_PIS_COFINS_EXCEPTION", invalidException);
      let actor: Actor;
      try { actor = actorAndScopes(request).actor; } catch (error) { return catchBusiness(reply, error); }
      const { reason, ...fields } = parsed.data;
      return transaction(pool, reply, async client => {
        const known = await client.query(`SELECT code FROM catalog.ncm_official_item WHERE code = $1`, [fields.code]);
        if (!known.rows[0]) throw new BusinessError(404, "NCM_NOT_FOUND", "NCM não encontrada no catálogo oficial.");
        await refuseOverlap(client, fields.code, fields.validFrom, fields.validTo, null);
        const author = `${actor.issuer}#${actor.subject}`;
        const inserted = await client.query<PisCofinsRow>(`INSERT INTO catalog.ncm_pis_cofins_exception
            (id, code, pis_rate, cofins_rate, legal_basis, valid_from, valid_to, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING ${pisCofinsColumns}`,
        [randomUUID(), fields.code, fields.pisRate, fields.cofinsRate, fields.legalBasis, fields.validFrom,
          fields.validTo, author]);
        const row = inserted.rows[0];
        await record(client, "NCM_PIS_COFINS_EXCEPTION", row.id, "NCM_PIS_COFINS_EXCEPTION", row.id, "CREATE",
          null, fields, actor, reason);
        return row;
      }, 201);
    });

  app.patch<{ Params: { id: string } }>("/api/v1/ncm-rates/pis-cofins-exceptions/:id",
    { config: permissionConfig("tax-rates.manage", "global") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      const parsed = exceptionFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_PIS_COFINS_EXCEPTION", invalidException);
      let actor: Actor; let version: string;
      try { actor = actorAndScopes(request).actor; version = versionFrom(request); }
      catch (error) { return catchBusiness(reply, error); }
      const { reason, ...fields } = parsed.data;
      return transaction(pool, reply, async client => {
        const current = await client.query<PisCofinsRow>(
          `SELECT ${pisCofinsColumns} FROM catalog.ncm_pis_cofins_exception WHERE id = $1 FOR UPDATE`, [id.data]);
        const before = current.rows[0];
        if (!before) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Exceção de PIS/COFINS não encontrada.");
        if (`"${before.version}"` !== version) {
          throw new BusinessError(409, "VERSION_CONFLICT", "A exceção foi alterada por outra pessoa. Recarregue antes de salvar.");
        }
        await refuseOverlap(client, before.code, fields.validFrom, fields.validTo, id.data);
        const updated = await client.query<PisCofinsRow>(`UPDATE catalog.ncm_pis_cofins_exception
          SET pis_rate = $2, cofins_rate = $3, legal_basis = $4, valid_from = $5, valid_to = $6,
            version = version + 1, updated_at = now(), updated_by = $7
          WHERE id = $1 RETURNING ${pisCofinsColumns}`,
        [id.data, fields.pisRate, fields.cofinsRate, fields.legalBasis, fields.validFrom, fields.validTo,
          `${actor.issuer}#${actor.subject}`]);
        const { id: _id, version: _version, code: _code, ...previous } = before;
        await record(client, "NCM_PIS_COFINS_EXCEPTION", id.data, "NCM_PIS_COFINS_EXCEPTION", id.data, "UPDATE",
          previous, fields, actor, reason);
        return updated.rows[0];
      });
    });

  if (options.refreshTime) {
    const stop = startNcmRateSchedule(pool, options.refreshTime, app.log, fetcher);
    app.addHook("onClose", async () => stop());
  }
}

export function startNcmRateSchedule(pool: Pool, times: string,
  logger: Pick<FastifyInstance["log"], "info" | "error">, fetcher: typeof fetch = fetch): () => void {
  nextNcmRateRefresh(Date.now(), times);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    const at = nextNcmRateRefresh(Date.now(), times);
    logger.info({ nextAt: new Date(at).toISOString(), times }, "Agendada proxima atualizacao das aliquotas por NCM");
    timer = setTimeout(() => { void run(); }, Math.max(1, at - Date.now()));
  };
  const run = async () => {
    try {
      const results = await refreshNcmRates(pool, fetcher, systemActor, "Atualização automática das alíquotas oficiais");
      logger.info({ results }, "Atualizacao automatica das aliquotas por NCM concluida");
    } catch (error) {
      logger.error({ error }, "Falha na atualizacao automatica das aliquotas por NCM");
    } finally { schedule(); }
  };
  // The first load runs at start-up while a source still has no current version.
  pool.query<{ current: number }>("SELECT count(*)::int AS current FROM catalog.ncm_rate_version WHERE is_current")
    .then(result => { if ((result.rows[0]?.current ?? 0) < SOURCES.length) void run(); else schedule(); },
      () => schedule());
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
