import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";

type Kind = "SUPPLIER" | "PRODUCT" | "NCM";
const resources: ReadonlyArray<{ path: string; kind: Kind; sourceColumn: string }> = [
  { path: "suppliers", kind: "SUPPLIER", sourceColumn: "R" },
  { path: "products", kind: "PRODUCT", sourceColumn: "T" },
  { path: "ncms", kind: "NCM", sourceColumn: "V" },
];
const listQuery = z.object({ importer: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict();
const createBody = z.object({ importer: z.string().trim().min(1).max(120),
  code: z.string().min(1).max(120).refine(value => value.trim().length > 0),
  name: z.string().trim().min(1).max(240), evidence: z.string().trim().min(8).max(2000),
  reason: z.string().trim().min(8).max(500),
  validFrom: z.iso.date().nullable().optional(), validTo: z.iso.date().nullable().optional() }).strict();
const patchBody = z.object({ name: z.string().trim().min(1).max(240).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  evidence: z.string().trim().min(8).max(2000).optional(),
  validFrom: z.iso.date().nullable().optional(), validTo: z.iso.date().nullable().optional(),
  reason: z.string().trim().min(8).max(500) }).strict();
type Entry = { id: string; importer: string; kind: Kind; code: string; name: string;
  status: "ACTIVE" | "INACTIVE"; provenance: string; evidence: string;
  valid_from: string | null; valid_to: string | null; version: string; created_at: Date; updated_at: Date };

function problem(reply: FastifyReply, status: number, code: string, detail: string) {
  return reply.code(status).send({ type: "about:blank", title: detail, status, detail,
    instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id, code });
}
function present(row: Entry) {
  return { id: row.id, importer: row.importer, kind: row.kind, code: row.code, name: row.name,
    status: row.status, provenance: row.provenance, evidence: row.evidence,
    validFrom: row.valid_from, validTo: row.valid_to, version: String(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function hasScope(scopes: readonly string[], importer: string): boolean {
  return scopes.includes(importer);
}
function canWriteKind(roles: readonly string[], kind: Kind): boolean {
  return roles.includes("Master") || roles.includes("Administrador")
    || roles.includes(kind === "NCM" ? "Fiscal" : "Compras");
}
function dateValue(value: string | null | undefined): string | null {
  return value ?? null;
}
function validDates(kind: Kind, start: string | null, end: string | null): boolean {
  return !(kind === "NCM" && !start) && (!end || (!!start && end >= start));
}
function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/u.test(value);
}
function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function registerCatalogRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/importers", { config: permissionConfig("catalog.read") }, async (request) => {
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const result = await pool.query<{ importer: string; po_count: number }>(
      `SELECT po.importer, count(*)::int AS po_count FROM procurement.purchase_order AS po
       WHERE po.importer = ANY($1::text[]) GROUP BY po.importer ORDER BY po.importer`, [scopes]);
    return { items: result.rows.map(row => ({ code: row.importer, historicalPoCount: row.po_count,
      status: "HISTORICAL_OBSERVED", officialTotvsMappingKnown: false })) };
  });

  for (const { path, kind, sourceColumn } of resources) {
    const base = `/api/v1/${path}`;
    app.get(base, { config: permissionConfig("catalog.read") }, async (request, reply) => {
      const parsed = listQuery.safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Filtros inválidos.");
      const { importer, search, page, pageSize } = parsed.data;
      const result = await pool.query<{ total_count: number; items: Entry[] }>(
        `WITH visible AS MATERIALIZED (
           SELECT entry.* FROM catalog.entry AS entry
           WHERE entry.kind = $1 AND entry.importer = ANY($2::text[])
             AND ($3::text IS NULL OR entry.importer = $3)
             AND ($4::text IS NULL OR strpos(lower(entry.code), lower($4)) > 0
                  OR strpos(lower(entry.name), lower($4)) > 0)
         ), page AS (SELECT * FROM visible ORDER BY normalized_code, id LIMIT $5 OFFSET $6)
         SELECT (SELECT count(*)::int FROM visible) AS total_count,
                coalesce(jsonb_agg(to_jsonb(page) - 'normalized_code' - 'created_by' - 'updated_by'
                  ORDER BY page.normalized_code, page.id) FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items
         FROM page`,
        [kind, request.authorizationContext?.importerScopes ?? [], importer ?? null, search || null,
          pageSize, (page - 1) * pageSize]);
      return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0),
        items: (result.rows[0]?.items ?? []).map(present) };
    });

    app.get(`${base}/candidates`, { config: permissionConfig("catalog.read") }, async (request, reply) => {
      const parsed = listQuery.safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Filtros inválidos.");
      const { importer, search, page, pageSize } = parsed.data;
      const result = await pool.query<{ total_count: number; items: Array<{ importer: string;
        raw_code: string; observation_count: number; sample_source_row_id: string;
        sample_sheet_name: string; sample_row_number: number }> }>(
        `WITH candidates AS MATERIALIZED (
           SELECT po.importer, obs.raw_values->>$1 AS raw_code,
                  count(*)::int AS observation_count, min(obs.source_row_id::text) AS sample_source_row_id
           FROM procurement.po_line_observation AS obs
           JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
           WHERE po.importer = ANY($2::text[])
             AND ($3::text IS NULL OR po.importer = $3)
             AND nullif(btrim(obs.raw_values->>$1), '') IS NOT NULL
             AND ($4::text IS NULL OR strpos(lower(obs.raw_values->>$1), lower($4)) > 0)
           GROUP BY po.importer, obs.raw_values->>$1
         ), page AS (
           SELECT candidate.*, source.sheet_name AS sample_sheet_name,
                  source.row_number AS sample_row_number
           FROM candidates AS candidate
           JOIN migration.source_row AS source ON source.id = candidate.sample_source_row_id::uuid
           ORDER BY candidate.observation_count DESC, candidate.importer, candidate.raw_code
           LIMIT $5 OFFSET $6
         )
         SELECT (SELECT count(*)::int FROM candidates) AS total_count,
                coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.observation_count DESC, page.importer, page.raw_code)
                  FILTER (WHERE page.importer IS NOT NULL), '[]'::jsonb) AS items FROM page`,
        [sourceColumn, request.authorizationContext?.importerScopes ?? [], importer ?? null,
          search || null, pageSize, (page - 1) * pageSize]);
      return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0),
        items: (result.rows[0]?.items ?? []).map(row => ({ importer: row.importer,
          rawCode: row.raw_code, observationCount: row.observation_count,
          sampleSourceRowId: row.sample_source_row_id, sampleSheetName: row.sample_sheet_name,
          sampleRowNumber: row.sample_row_number, status: "HISTORICAL_CANDIDATE",
          eligibleFormat: kind !== "NCM" || /^[0-9]{8}$/u.test(row.raw_code.trim()) })) };
    });

    app.get<{ Params: { id: string } }>(`${base}/:id`, { config: permissionConfig("catalog.read") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      if (!id.success) return problem(reply, 400, "INVALID_ID", "Identificador inválido.");
      const result = await pool.query<Entry>(
        `SELECT entry.* FROM catalog.entry AS entry WHERE entry.id = $1 AND entry.kind = $2
         AND entry.importer = ANY($3::text[]) LIMIT 1`,
        [id.data, kind, request.authorizationContext?.importerScopes ?? []]);
      if (!result.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Cadastro não encontrado.");
      reply.header("ETag", `"${result.rows[0].version}"`);
      return present(result.rows[0]);
    });

    app.post(base, { config: permissionConfig("catalog.write") }, async (request, reply) => {
      const parsed = createBody.safeParse(request.body);
      const key = request.headers["idempotency-key"];
      if (!parsed.success || !validKey(key)) return problem(reply, 400, "INVALID_CATALOG_ENTRY", "Informe cadastro, evidência, motivo e Idempotency-Key válidos.");
      const auth = request.authorizationContext;
      const actor = request.authContext;
      const body = parsed.data;
      if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
      if (!canWriteKind(auth.roles, kind)) return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para este cadastro.");
      if (!hasScope(auth.importerScopes, body.importer)) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Importador não encontrado no seu escopo.");
      const code = body.code.trim();
      if ((kind === "NCM" && !/^[0-9]{8}$/u.test(code)) || !validDates(kind, dateValue(body.validFrom), dateValue(body.validTo))) {
        return problem(reply, 400, "INVALID_CATALOG_ENTRY", "Código ou vigência inválidos.");
      }
      const hash = createHash("sha256").update(JSON.stringify({ kind, ...body, code })).digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`catalog:${actor.userId}:${key}`]);
        const existing = await client.query<{ payload_sha256: string; entry_id: string }>(
          "SELECT payload_sha256, entry_id FROM catalog.command_receipt WHERE actor_user_id = $1 AND idempotency_key = $2",
          [actor.userId, key]);
        if (existing.rows[0]) {
          const visible = await client.query<Entry>(
            `SELECT * FROM catalog.entry WHERE id = $1 AND kind = $2 AND importer = ANY($3::text[])`,
            [existing.rows[0].entry_id, kind, auth.importerScopes]);
          await client.query("COMMIT");
          if (!visible.rows[0]) return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada em outro cadastro.");
          if (existing.rows[0].payload_sha256.trim() !== hash) return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada com outro conteúdo.");
          reply.header("ETag", `"${visible.rows[0].version}"`);
          return reply.code(200).send(present(visible.rows[0]));
        }
        const importerExists = await client.query("SELECT 1 FROM procurement.purchase_order WHERE importer = $1 LIMIT 1", [body.importer]);
        if (!importerExists.rowCount) {
          await client.query("ROLLBACK");
          return problem(reply, 404, "RESOURCE_NOT_FOUND", "Importador sem origem conhecida.");
        }
        const id = randomUUID();
        const inserted = await client.query<Entry>(
          `INSERT INTO catalog.entry
            (id, importer, kind, code, name, evidence, valid_from, valid_to, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
          [id, body.importer, kind, code, body.name, body.evidence,
            dateValue(body.validFrom), dateValue(body.validTo), actor.userId]);
        await client.query(
          `INSERT INTO catalog.entry_alias (id, entry_id, raw_code, source_kind, created_by)
           VALUES ($1,$2,$3,'MANUAL_ENTRY',$4)`, [randomUUID(), id, body.code, actor.userId]);
        await client.query(
          `INSERT INTO catalog.command_receipt (actor_user_id, idempotency_key, payload_sha256, entry_id)
           VALUES ($1,$2,$3,$4)`, [actor.userId, key, hash, id]);
        const correlationId = randomUUID();
        await client.query(
          `INSERT INTO audit.audit_log
            (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
           VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,'CREATE',NULL,NULL,$3::jsonb,$4,now(),$5,$6)`,
          [randomUUID(), id, JSON.stringify(present(inserted.rows[0])), `${actor.issuer}#${actor.subject}`, body.reason, correlationId]);
        await client.query(
          `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
           VALUES ($1,'catalog.entry.created','CATALOG_ENTRY',$2,$3::jsonb,now())`,
          [randomUUID(), id, JSON.stringify({ id, importer: body.importer, kind, version: 1 })]);
        await client.query("COMMIT");
        reply.header("ETag", '"1"');
        return reply.code(201).send(present(inserted.rows[0]));
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (isUniqueError(error)) return problem(reply, 409, "CATALOG_DUPLICATE", "Código já cadastrado neste importador.");
        throw error;
      } finally { client.release(); }
    });

    app.patch<{ Params: { id: string } }>(`${base}/:id`, { config: permissionConfig("catalog.write") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      const parsed = patchBody.safeParse(request.body);
      const expected = request.headers["if-match"];
      if (!id.success || !parsed.success || typeof expected !== "string" || !/^"[1-9][0-9]*"$/u.test(expected)) {
        return problem(reply, 400, "INVALID_CATALOG_UPDATE", "Informe ID, alterações, motivo e If-Match válido.");
      }
      const fields = Object.keys(parsed.data).filter(field => field !== "reason");
      if (fields.length === 0) return problem(reply, 400, "INVALID_CATALOG_UPDATE", "Informe ao menos uma alteração.");
      const auth = request.authorizationContext;
      const actor = request.authContext;
      if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
      if (!canWriteKind(auth.roles, kind)) return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para este cadastro.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<Entry>(
          `SELECT * FROM catalog.entry WHERE id = $1 AND kind = $2
           AND importer = ANY($3::text[]) FOR UPDATE`, [id.data, kind, auth.importerScopes]);
        const before = found.rows[0];
        if (!before) { await client.query("ROLLBACK"); return problem(reply, 404, "RESOURCE_NOT_FOUND", "Cadastro não encontrado."); }
        if (`"${before.version}"` !== expected) { await client.query("ROLLBACK"); return problem(reply, 409, "VERSION_CONFLICT", "Cadastro alterado. Recarregue antes de salvar."); }
        const body = parsed.data;
        const name = body.name ?? before.name;
        const status = body.status ?? before.status;
        const evidence = body.evidence ?? before.evidence;
        const validFrom = body.validFrom === undefined ? before.valid_from : body.validFrom;
        const validTo = body.validTo === undefined ? before.valid_to : body.validTo;
        if (!validDates(kind, validFrom, validTo)) {
          await client.query("ROLLBACK"); return problem(reply, 400, "INVALID_VALIDITY", "Vigência inválida.");
        }
        const changed = { name, status, evidence, valid_from: validFrom, valid_to: validTo };
        const old = { name: before.name, status: before.status, evidence: before.evidence,
          valid_from: before.valid_from, valid_to: before.valid_to };
        const differences = Object.entries(changed).filter(([field, value]) => value !== old[field as keyof typeof old]);
        if (differences.length === 0) { await client.query("ROLLBACK"); return problem(reply, 400, "NO_CHANGES", "Nenhuma alteração informada."); }
        const updated = await client.query<Entry>(
          `UPDATE catalog.entry SET name=$2,status=$3,evidence=$4,valid_from=$5,valid_to=$6,
             version=version+1,updated_by=$7,updated_at=now() WHERE id=$1 RETURNING *`,
          [id.data, name, status, evidence, validFrom, validTo, actor.userId]);
        const correlationId = randomUUID();
        for (const [field, value] of differences) {
          await client.query(
            `INSERT INTO audit.audit_log
              (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
             VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,'UPDATE',$3,$4::jsonb,$5::jsonb,$6,now(),$7,$8)`,
            [randomUUID(), id.data, field, JSON.stringify(old[field as keyof typeof old]),
              JSON.stringify(value), `${actor.issuer}#${actor.subject}`, body.reason, correlationId]);
        }
        await client.query(
          `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
           VALUES ($1,'catalog.entry.updated','CATALOG_ENTRY',$2,$3::jsonb,now())`,
          [randomUUID(), id.data, JSON.stringify({ id: id.data, importer: before.importer, kind,
            version: String(updated.rows[0].version), changedFields: differences.map(([field]) => field) })]);
        await client.query("COMMIT");
        reply.header("ETag", `"${updated.rows[0].version}"`);
        return present(updated.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    });
  }
}
