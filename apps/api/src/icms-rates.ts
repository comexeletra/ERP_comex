import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { estimateImportTaxes } from "./import-estimate.js";
import { actorAndScopes, BusinessError, problem, record, transaction, versionFrom } from "./operations.js";
import { brasiliaDate, composeRates } from "./tax-rates.js";

// ICMS of the importer states, kept by Master and Administrador, and the import
// tax estimate that combines it with the NCM rates. Estimates are never stored.
const UFS = ["AM", "CE", "PR"] as const;
type Uf = typeof UFS[number];
type Actor = { issuer: string; subject: string };
type Queryable = Pick<Pool, "query"> | PoolClient;

const rateColumns = `id, uf, trim_scale(rate)::text AS rate, trim_scale(fcp_rate)::text AS "fcpRate",
  legal_basis AS "legalBasis", valid_from::text AS "validFrom", valid_to::text AS "validTo", reviewed, version::text AS version`;
const stateColumns = `uf, include_siscomex_fee AS "includeSiscomexFee", include_afrmm AS "includeAfrmm",
  include_other_expenses AS "includeOtherExpenses", reviewed, version::text AS version`;
const benefitColumns = `id, uf, ncm, kind, trim_scale(percent)::text AS percent, legal_basis AS "legalBasis",
  valid_from::text AS "validFrom", valid_to::text AS "validTo", version::text AS version`;
type RateRow = { id: string; uf: Uf; rate: string; fcpRate: string; legalBasis: string; validFrom: string;
  validTo: string | null; reviewed: boolean; version: string };
type StateRow = { uf: Uf; includeSiscomexFee: boolean; includeAfrmm: boolean; includeOtherExpenses: boolean;
  reviewed: boolean; version: string };
type BenefitRow = { id: string; uf: Uf; ncm: string | null; kind: "BASE_REDUCTION" | "DEFERRAL"; percent: string;
  legalBasis: string; validFrom: string; validTo: string | null; version: string };

const rate = z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/u).refine(value => Number(value) <= 100);
const money = z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/u);
const period = { validFrom: z.iso.date(), validTo: z.iso.date().nullable().default(null) };
const reason = z.string().trim().min(3).max(1000);
const legalBasis = z.string().trim().min(3).max(500);
const validPeriod = (value: { validFrom: string; validTo: string | null }) => value.validTo === null || value.validTo >= value.validFrom;
const rateFields = z.object({ rate, fcpRate: rate.default("0"), legalBasis, ...period, reviewed: z.boolean(), reason }).strict()
  .refine(validPeriod).refine(value => Number(value.rate) + Number(value.fcpRate) < 100);
const createRate = z.object({ uf: z.enum(UFS) }).and(rateFields);
const stateFields = z.object({ includeSiscomexFee: z.boolean(), includeAfrmm: z.boolean(), includeOtherExpenses: z.boolean(),
  reviewed: z.boolean(), reason }).strict();
const benefitFields = z.object({ percent: rate.refine(value => Number(value) > 0), legalBasis, ...period, reason }).strict()
  .refine(validPeriod);
const createBenefit = z.object({ uf: z.enum(UFS), ncm: z.string().regex(/^\d{8}$/u).nullable(),
  kind: z.enum(["BASE_REDUCTION", "DEFERRAL"]) }).and(benefitFields);
const importerFields = z.object({ uf: z.enum(UFS), reason }).strict();
const estimateQuery = z.object({ uf: z.enum(UFS), date: z.iso.date().optional(), customsValue: money,
  siscomexFee: money.default("0"), afrmm: money.default("0"), otherExpenses: money.default("0") }).strict();
const invalid = "Revise UF, alíquotas (0 a 100% com até 4 casas), base legal, vigência e motivo.";

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
  throw error;
}
function author(actor: Actor) { return `${actor.issuer}#${actor.subject}`; }
function importerKey(importer: string): string { return importer.trim().toUpperCase(); }
/** Same value as md5(text)::uuid in PostgreSQL, so rows keyed by text keep one audit history. */
function stableId(text: string): string {
  const hex = createHash("md5").update(text, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function sameVersion(current: { version: string }, version: string) {
  if (`"${current.version}"` !== version) {
    throw new BusinessError(409, "VERSION_CONFLICT", "O registro foi alterado por outra pessoa. Recarregue antes de salvar.");
  }
}
async function refuseRateOverlap(client: PoolClient, uf: Uf, validFrom: string, validTo: string | null, id: string | null) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`catalog:icms-rate:${uf}`]);
  const overlap = await client.query(`SELECT id FROM catalog.icms_import_rate
    WHERE uf = $1 AND ($4::uuid IS NULL OR id <> $4::uuid)
      AND daterange(valid_from, valid_to, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`, [uf, validFrom, validTo, id]);
  if (overlap.rows[0]) throw new BusinessError(409, "ICMS_PERIOD_OVERLAP", "Já existe alíquota de ICMS dessa UF nesse período.");
}
async function refuseBenefitOverlap(client: PoolClient, benefit: { uf: Uf; ncm: string | null; kind: string },
  validFrom: string, validTo: string | null, id: string | null) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`catalog:icms-benefit:${benefit.uf}:${benefit.kind}:${benefit.ncm ?? "*"}`]);
  const overlap = await client.query(`SELECT id FROM catalog.icms_import_benefit
    WHERE uf = $1 AND kind = $2 AND coalesce(ncm, '') = coalesce($3::text, '') AND ($6::uuid IS NULL OR id <> $6::uuid)
      AND daterange(valid_from, valid_to, '[]') && daterange($4::date, $5::date, '[]') LIMIT 1`,
  [benefit.uf, benefit.kind, benefit.ncm, validFrom, validTo, id]);
  if (overlap.rows[0]) throw new BusinessError(409, "ICMS_BENEFIT_OVERLAP", "Já existe esse benefício para a UF e a NCM nesse período.");
}

async function loadState(db: Queryable, uf: Uf, date: string) {
  const [state, rates, benefits] = await Promise.all([
    db.query<StateRow>(`SELECT ${stateColumns} FROM catalog.icms_import_state WHERE uf = $1`, [uf]),
    db.query<RateRow>(`SELECT ${rateColumns} FROM catalog.icms_import_rate
      WHERE uf = $1 AND valid_from <= $2::date AND (valid_to IS NULL OR valid_to >= $2::date)`, [uf, date]),
    db.query<BenefitRow>(`SELECT ${benefitColumns} FROM catalog.icms_import_benefit
      WHERE uf = $1 AND valid_from <= $2::date AND (valid_to IS NULL OR valid_to >= $2::date)`, [uf, date]),
  ]);
  return { state: state.rows[0] ?? null, rate: rates.rows[0] ?? null, benefits: benefits.rows };
}

export async function registerIcmsRateRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/icms-rates", { config: permissionConfig("catalog.read", "global") }, async (_request, reply) => {
    const [states, rates, benefits, importers] = await Promise.all([
      pool.query<StateRow>(`SELECT ${stateColumns} FROM catalog.icms_import_state ORDER BY uf`),
      pool.query<RateRow>(`SELECT ${rateColumns} FROM catalog.icms_import_rate ORDER BY uf, valid_from DESC`),
      pool.query<BenefitRow>(`SELECT ${benefitColumns} FROM catalog.icms_import_benefit ORDER BY uf, kind, valid_from DESC`),
      // Registered importers with their state, matched regardless of case and spacing.
      pool.query<{ importer: string; uf: Uf | null; version: string | null }>(
        `SELECT coalesce(registered.value, link.importer) AS importer, link.uf, link.version::text AS version
         FROM (SELECT DISTINCT ON (upper(btrim(value))) value FROM catalog.operational_value
               WHERE entity_key = 'IMPORTER' ORDER BY upper(btrim(value)), value) AS registered
         FULL JOIN catalog.icms_importer_state AS link ON upper(btrim(link.importer)) = upper(btrim(registered.value))
         ORDER BY 1`),
    ]);
    reply.header("cache-control", "no-store");
    return { states: states.rows.map(state => ({ ...state,
      rates: rates.rows.filter(row => row.uf === state.uf), benefits: benefits.rows.filter(row => row.uf === state.uf) })),
    importers: importers.rows };
  });

  app.get<{ Params: { code: string } }>("/api/v1/ncm-rates/:code/estimate",
    { config: permissionConfig("catalog.read", "global") }, async (request, reply) => {
      const query = estimateQuery.safeParse(request.query);
      if (!/^\d{8}$/u.test(request.params.code) || !query.success) {
        return problem(reply, 400, "INVALID_ESTIMATE", "Informe NCM, UF (CE, AM ou PR), data e valores em reais com até 2 casas.");
      }
      const code = request.params.code;
      const known = await pool.query(`SELECT code, name, valid_from::text AS "validFrom", valid_to::text AS "validTo"
        FROM catalog.ncm_official_item WHERE code = $1`, [code]);
      if (!known.rows[0]) return problem(reply, 404, "NCM_NOT_FOUND", "NCM não encontrada no catálogo oficial.");
      const date = query.data.date ?? brasiliaDate(Date.now());
      const [{ rates }, icms] = await Promise.all([composeRates(pool, [code], date), loadState(pool, query.data.uf, date)]);
      const composed = rates.get(code)!;
      // A benefit for the NCM prevails over a benefit for every NCM of the state.
      const benefit = (kind: BenefitRow["kind"]) => {
        const candidates = icms.benefits.filter(item => item.kind === kind && (item.ncm === code || item.ncm === null));
        return candidates.find(item => item.ncm === code) ?? candidates[0] ?? null;
      };
      const baseReduction = benefit("BASE_REDUCTION"), deferral = benefit("DEFERRAL");
      let result;
      try {
        result = estimateImportTaxes({ customsValue: query.data.customsValue, siscomexFee: query.data.siscomexFee,
          afrmm: query.data.afrmm, otherExpenses: query.data.otherExpenses,
          ii: { rate: composed.ii.applied, status: composed.ii.status }, ipi: composed.ipi,
          pisCofins: composed.pisCofins,
          icms: icms.state && icms.rate ? { rate: icms.rate.rate, fcpRate: icms.rate.fcpRate,
            includeSiscomexFee: icms.state.includeSiscomexFee, includeAfrmm: icms.state.includeAfrmm,
            includeOtherExpenses: icms.state.includeOtherExpenses } : null,
          benefits: { baseReduction, deferral } });
      } catch (error) {
        return problem(reply, 400, "INVALID_ESTIMATE", error instanceof Error ? error.message : "Estimativa inválida.");
      }
      const warnings = [
        ...(icms.rate && (!icms.rate.reviewed || !icms.state?.reviewed) ? ["ICMS_NOT_REVIEWED"] : []),
        ...(!composed.pisCofins.reviewed ? ["PIS_COFINS_GENERAL_RULE"] : []),
        ...(composed.ii.exceptions.some(item => item.condition !== "applied") ? ["II_CONDITIONAL_EXCEPTIONS"] : []),
        ...(composed.ipi.exceptions.length ? ["IPI_EX_NOT_APPLIED"] : []),
        ...(baseReduction ? ["BASE_REDUCTION_RULE_TO_CONFIRM"] : []),
      ];
      reply.header("cache-control", "no-store");
      return { ncm: code, uf: query.data.uf, referenceDate: date, ...result, warnings,
        iiSource: composed.ii.appliedSource, iiAct: composed.ii.appliedAct, pisCofinsLegalBasis: composed.pisCofins.legalBasis,
        icmsLegalBasis: icms.rate?.legalBasis ?? null, baseReductionLegalBasis: baseReduction?.legalBasis ?? null,
        deferralLegalBasis: deferral?.legalBasis ?? null };
    });

  app.post("/api/v1/icms-rates/rates", { config: permissionConfig("icms-rates.manage", "global") }, async (request, reply) => {
    const parsed = createRate.safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, "INVALID_ICMS_RATE", invalid);
    let actor: Actor;
    try { actor = actorAndScopes(request).actor; } catch (error) { return failure(reply, error); }
    const { reason: why, ...fields } = parsed.data;
    return transaction(pool, reply, async client => {
      await refuseRateOverlap(client, fields.uf, fields.validFrom, fields.validTo, null);
      const inserted = await client.query<RateRow>(`INSERT INTO catalog.icms_import_rate
          (id, uf, rate, fcp_rate, legal_basis, valid_from, valid_to, reviewed, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING ${rateColumns}`,
      [randomUUID(), fields.uf, fields.rate, fields.fcpRate, fields.legalBasis, fields.validFrom, fields.validTo,
        fields.reviewed, author(actor)]);
      const row = inserted.rows[0];
      await record(client, "ICMS_IMPORT_RATE", row.id, "ICMS_IMPORT_RATE", row.id, "CREATE", null, fields, actor, why);
      return row;
    }, 201);
  });

  app.patch<{ Params: { id: string } }>("/api/v1/icms-rates/rates/:id",
    { config: permissionConfig("icms-rates.manage", "global") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id), parsed = rateFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_ICMS_RATE", invalid);
      let actor: Actor; let version: string;
      try { actor = actorAndScopes(request).actor; version = versionFrom(request); } catch (error) { return failure(reply, error); }
      const { reason: why, ...fields } = parsed.data;
      return transaction(pool, reply, async client => {
        const current = await client.query<RateRow>(`SELECT ${rateColumns} FROM catalog.icms_import_rate WHERE id = $1 FOR UPDATE`, [id.data]);
        const before = current.rows[0];
        if (!before) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Alíquota de ICMS não encontrada.");
        sameVersion(before, version);
        await refuseRateOverlap(client, before.uf, fields.validFrom, fields.validTo, id.data);
        const updated = await client.query<RateRow>(`UPDATE catalog.icms_import_rate
          SET rate = $2, fcp_rate = $3, legal_basis = $4, valid_from = $5, valid_to = $6, reviewed = $7,
            version = version + 1, updated_at = now(), updated_by = $8
          WHERE id = $1 RETURNING ${rateColumns}`,
        [id.data, fields.rate, fields.fcpRate, fields.legalBasis, fields.validFrom, fields.validTo, fields.reviewed, author(actor)]);
        const { id: _id, version: _version, uf: _uf, ...previous } = before;
        await record(client, "ICMS_IMPORT_RATE", id.data, "ICMS_IMPORT_RATE", id.data, "UPDATE", previous, fields, actor, why);
        return updated.rows[0];
      });
    });

  app.patch<{ Params: { uf: string } }>("/api/v1/icms-rates/states/:uf",
    { config: permissionConfig("icms-rates.manage", "global") }, async (request, reply) => {
      const uf = z.enum(UFS).safeParse(request.params.uf), parsed = stateFields.safeParse(request.body);
      if (!uf.success || !parsed.success) return problem(reply, 400, "INVALID_ICMS_STATE", invalid);
      let actor: Actor; let version: string;
      try { actor = actorAndScopes(request).actor; version = versionFrom(request); } catch (error) { return failure(reply, error); }
      const { reason: why, ...fields } = parsed.data;
      return transaction(pool, reply, async client => {
        const current = await client.query<StateRow>(`SELECT ${stateColumns} FROM catalog.icms_import_state WHERE uf = $1 FOR UPDATE`, [uf.data]);
        const before = current.rows[0];
        if (!before) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "UF não encontrada.");
        sameVersion(before, version);
        const updated = await client.query<StateRow>(`UPDATE catalog.icms_import_state
          SET include_siscomex_fee = $2, include_afrmm = $3, include_other_expenses = $4, reviewed = $5,
            version = version + 1, updated_at = now(), updated_by = $6
          WHERE uf = $1 RETURNING ${stateColumns}`,
        [uf.data, fields.includeSiscomexFee, fields.includeAfrmm, fields.includeOtherExpenses, fields.reviewed, author(actor)]);
        const auditId = stableId(`ICMS_IMPORT_STATE|${uf.data}`);
        const { version: _version, uf: _uf, ...previous } = before;
        await record(client, "ICMS_IMPORT_STATE", auditId, "ICMS_IMPORT_STATE", auditId, "UPDATE",
          { uf: uf.data, ...previous }, { uf: uf.data, ...fields }, actor, why);
        return updated.rows[0];
      });
    });

  app.post("/api/v1/icms-rates/benefits", { config: permissionConfig("icms-rates.manage", "global") }, async (request, reply) => {
    const parsed = createBenefit.safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, "INVALID_ICMS_BENEFIT", invalid);
    let actor: Actor;
    try { actor = actorAndScopes(request).actor; } catch (error) { return failure(reply, error); }
    const { reason: why, ...fields } = parsed.data;
    return transaction(pool, reply, async client => {
      await refuseBenefitOverlap(client, fields, fields.validFrom, fields.validTo, null);
      const inserted = await client.query<BenefitRow>(`INSERT INTO catalog.icms_import_benefit
          (id, uf, ncm, kind, percent, legal_basis, valid_from, valid_to, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING ${benefitColumns}`,
      [randomUUID(), fields.uf, fields.ncm, fields.kind, fields.percent, fields.legalBasis, fields.validFrom, fields.validTo,
        author(actor)]);
      const row = inserted.rows[0];
      await record(client, "ICMS_IMPORT_BENEFIT", row.id, "ICMS_IMPORT_BENEFIT", row.id, "CREATE", null, fields, actor, why);
      return row;
    }, 201);
  });

  app.patch<{ Params: { id: string } }>("/api/v1/icms-rates/benefits/:id",
    { config: permissionConfig("icms-rates.manage", "global") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id), parsed = benefitFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_ICMS_BENEFIT", invalid);
      let actor: Actor; let version: string;
      try { actor = actorAndScopes(request).actor; version = versionFrom(request); } catch (error) { return failure(reply, error); }
      const { reason: why, ...fields } = parsed.data;
      return transaction(pool, reply, async client => {
        const current = await client.query<BenefitRow>(`SELECT ${benefitColumns} FROM catalog.icms_import_benefit WHERE id = $1 FOR UPDATE`, [id.data]);
        const before = current.rows[0];
        if (!before) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Benefício de ICMS não encontrado.");
        sameVersion(before, version);
        await refuseBenefitOverlap(client, before, fields.validFrom, fields.validTo, id.data);
        const updated = await client.query<BenefitRow>(`UPDATE catalog.icms_import_benefit
          SET percent = $2, legal_basis = $3, valid_from = $4, valid_to = $5, version = version + 1, updated_at = now(), updated_by = $6
          WHERE id = $1 RETURNING ${benefitColumns}`,
        [id.data, fields.percent, fields.legalBasis, fields.validFrom, fields.validTo, author(actor)]);
        const { id: _id, version: _version, ...previous } = before;
        await record(client, "ICMS_IMPORT_BENEFIT", id.data, "ICMS_IMPORT_BENEFIT", id.data, "UPDATE", previous, fields, actor, why);
        return updated.rows[0];
      });
    });

  app.patch<{ Params: { importer: string } }>("/api/v1/icms-rates/importers/:importer",
    { config: permissionConfig("icms-rates.manage", "global") }, async (request, reply) => {
      const parsed = importerFields.safeParse(request.body);
      const importer = request.params.importer.trim();
      if (!parsed.success || !importer || importer.length > 240) return problem(reply, 400, "INVALID_ICMS_IMPORTER", invalid);
      let actor: Actor; let version: string;
      try { actor = actorAndScopes(request).actor; version = versionFrom(request); } catch (error) { return failure(reply, error); }
      return transaction(pool, reply, async client => {
        const key = importerKey(importer);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`catalog:icms-importer:${key}`]);
        const current = await client.query<{ importer: string; uf: Uf; version: string }>(
          `SELECT importer, uf, version::text AS version FROM catalog.icms_importer_state
           WHERE upper(btrim(importer)) = $1 FOR UPDATE`, [key]);
        const before = current.rows[0];
        const auditId = stableId(`ICMS_IMPORTER_STATE|${key}`);
        if (!before) {
          // An importer without a state yet: version "0" creates its link, only for a registered importer.
          if (version !== '"0"') {
            throw new BusinessError(409, "VERSION_CONFLICT", "O registro foi alterado por outra pessoa. Recarregue antes de salvar.");
          }
          const registered = await client.query(`SELECT value FROM catalog.operational_value
            WHERE entity_key = 'IMPORTER' AND upper(btrim(value)) = $1 LIMIT 1`, [key]);
          if (!registered.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Importadora não cadastrada.");
          const inserted = await client.query<{ importer: string; uf: Uf; version: string }>(`INSERT INTO catalog.icms_importer_state
              (importer, uf, updated_by) VALUES ($1, $2, $3) RETURNING importer, uf, version::text AS version`,
          [importer, parsed.data.uf, author(actor)]);
          await record(client, "ICMS_IMPORTER_STATE", auditId, "ICMS_IMPORTER_STATE", auditId, "CREATE",
            null, { importer, uf: parsed.data.uf }, actor, parsed.data.reason);
          return inserted.rows[0];
        }
        sameVersion(before, version);
        const updated = await client.query<{ importer: string; uf: Uf; version: string }>(`UPDATE catalog.icms_importer_state
          SET uf = $2, version = version + 1, updated_at = now(), updated_by = $3
          WHERE importer = $1 RETURNING importer, uf, version::text AS version`, [before.importer, parsed.data.uf, author(actor)]);
        await record(client, "ICMS_IMPORTER_STATE", auditId, "ICMS_IMPORTER_STATE", auditId, "UPDATE",
          { importer: before.importer, uf: before.uf }, { importer: before.importer, uf: parsed.data.uf }, actor, parsed.data.reason);
        return updated.rows[0];
      });
    });
}
