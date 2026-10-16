import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import {
  createOfficialNcmCatalogProvider,
  fetchOfficialNcmCatalog,
  officialNcmAttributesHash,
  type OfficialNcm,
  type OfficialNcmCatalog,
  type OfficialNcmCatalogProvider,
} from "./siscomex-ncm.js";
import { refreshRegisteredNcms, refreshScheduledNcms, startDailyNcmRefresh } from "./ncm-sync.js";

type Kind = "SUPPLIER" | "PRODUCT" | "NCM";
const resources: ReadonlyArray<{ path: string; kind: Kind; sourceColumn: string }> = [
  { path: "suppliers", kind: "SUPPLIER", sourceColumn: "R" },
  { path: "products", kind: "PRODUCT", sourceColumn: "T" },
  { path: "ncms", kind: "NCM", sourceColumn: "V" },
];
const operationalValueKeys = new Set([
  "IMPORTER", "INCOTERM", "TRANSPORT_MODE", "PORT_LOADING", "PORT_DISCHARGE", "CURRENCY",
  "CATEGORY", "PRODUCT_GROUP", "GROUP", "PURPOSE", "DEMAND", "LOGISTICS_STATUS",
  "CUSTOMS_CHANNEL", "CONTAINER_TYPE", "PRIORITY", "UNIT_OF_MEASURE", "REQUESTER",
  "COST_CENTER", "BROKER", "FORWARDER", "NCM",
]);
const operationalValueMax: Record<string, number> = {
  IMPORTER: 120, INCOTERM: 20, TRANSPORT_MODE: 40, PORT_LOADING: 160, PORT_DISCHARGE: 160,
  CURRENCY: 3, CATEGORY: 120, PRODUCT_GROUP: 120, GROUP: 120, PURPOSE: 160, DEMAND: 160,
  LOGISTICS_STATUS: 40, CUSTOMS_CHANNEL: 80, CONTAINER_TYPE: 80,
  PRIORITY: 20, UNIT_OF_MEASURE: 32, REQUESTER: 160, COST_CENTER: 80, BROKER: 160, FORWARDER: 160,
  NCM: 8,
};
function operationalValueHasValidFormat(entity: string, value: string): boolean {
  return (entity !== "CURRENCY" || /^[A-Z]{3}$/u.test(value))
    && (entity !== "NCM" || /^\d{8}$/u.test(value));
}
const operationalValueId = z.uuid();
const operationalValueUpdateBody = z.object({
  expectedCode: z.string().trim().min(1).max(120).nullable().optional(),
  expectedValue: z.string().trim().min(1).max(240),
  code: z.string().trim().min(1).max(120).optional(),
  value: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(8).max(500),
}).strict();
const operationalValueDeleteBody = z.object({
  expectedCode: z.string().trim().min(1).max(120).nullable().optional(),
  expectedValue: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(8).max(500),
}).strict();
const listQuery = z.object({ importer: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict();
const globalListQuery = z.object({ search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict();
const historyQuery = z.object({ page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict();
const createBody = z.object({ importer: z.string().trim().min(1).max(120).optional(),
  code: z.string().min(1).max(120).refine(value => value.trim().length > 0),
  name: z.string().trim().min(1).max(240), evidence: z.string().trim().min(8).max(2000),
  reason: z.string().trim().min(8).max(500),
  validFrom: z.iso.date().nullable().optional(), validTo: z.iso.date().nullable().optional() }).strict();
const ncmCreateBody = createBody.omit({ importer: true })
  .extend({ name: z.string().trim().min(1).max(2000) });
const productCreateBody = z.object({
  code: z.string().min(1).max(120).refine(value => value.trim().length > 0),
  name: z.string().trim().min(1).max(2000),
  // Accept legacy callers during the rollout, but product ownership is global.
  importer: z.string().trim().min(1).max(120).optional(),
  evidence: z.string().trim().min(8).max(2000).optional(),
  reason: z.string().trim().min(8).max(500).optional(),
  validFrom: z.iso.date().nullable().optional(),
  validTo: z.iso.date().nullable().optional(),
}).strict();
const productBulkBody = z.object({
  items: z.array(z.object({
    code: z.string().min(1).max(120).refine(value => value.trim().length > 0),
    description: z.string().trim().min(1).max(2000),
  }).strict()).min(1).max(500),
}).strict();
const patchBody = z.object({ name: z.string().trim().min(1).max(240).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  evidence: z.string().trim().min(8).max(2000).optional(),
  validFrom: z.iso.date().nullable().optional(), validTo: z.iso.date().nullable().optional(),
  reason: z.string().trim().min(8).max(500) }).strict();
const productPatchBody = patchBody.extend({ name: z.string().trim().min(1).max(2000).optional() });
const ncmPatchBody = patchBody.extend({ name: z.string().trim().min(1).max(2000).optional() });
type Entry = { id: string; importer: string | null; kind: Kind; code: string; name: string;
  status: "ACTIVE" | "INACTIVE"; provenance: string; evidence: string;
  valid_from: string | null; valid_to: string | null; version: string; created_at: Date; updated_at: Date;
  mandatory_import_attributes?: OfficialNcm["mandatoryImportAttributes"];
  source_updated_at?: string | null; attributes_source_version?: string | null; synced_at?: Date | null };

const cachedOfficialNcmCatalog = createOfficialNcmCatalogProvider(fetchOfficialNcmCatalog);

function problem(reply: FastifyReply, status: number, code: string, detail: string) {
  return reply.code(status).send({ type: "about:blank", title: detail, status, detail,
    instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id, code });
}
function siscomexUnavailable(reply: FastifyReply, error: unknown) {
  const retryAt = error && typeof error === "object" && "retryAt" in error
    && typeof error.retryAt === "number" && Number.isFinite(error.retryAt) ? error.retryAt : null;
  if (retryAt !== null && retryAt > Date.now()) {
    reply.header("retry-after", String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))));
    const retryTime = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(retryAt);
    return problem(reply, 503, "SISCOMEX_UNAVAILABLE",
      `O catálogo oficial está temporariamente indisponível. Tente novamente após ${retryTime} (horário de Brasília).`);
  }
  return problem(reply, 502, "SISCOMEX_UNAVAILABLE", "Não foi possível consultar o catálogo oficial do Siscomex.");
}
function present(row: Entry) {
  return { id: row.id, ...(row.kind === "NCM" ? {} : { importer: row.importer }),
    kind: row.kind, code: row.code, name: row.name,
    status: row.status, provenance: row.provenance, evidence: row.evidence,
    validFrom: row.valid_from, validTo: row.valid_to, version: String(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.mandatory_import_attributes !== undefined ? { mandatoryImportAttributes: row.mandatory_import_attributes,
      sourceUpdatedAt: row.source_updated_at ?? null, attributesSourceVersion: row.attributes_source_version ?? null,
      officialDataSyncedAt: row.synced_at ?? null } : {}) };
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
function validDates(kind: Kind, start: string | null, end: string | null,
  status: "ACTIVE" | "INACTIVE" = "ACTIVE"): boolean {
  return !(kind === "NCM" && !start && status !== "INACTIVE") && (!end || (!!start && end >= start));
}
function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/u.test(value);
}
function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function registerCatalogRoutes(app: FastifyInstance, pool: Pool,
  options: { officialNcmProvider?: OfficialNcmCatalogProvider;
    ncmAutoRefreshTime?: string; logger?: Pick<FastifyInstance["log"], "info" | "error"> } = {}): Promise<void> {
  const getOfficialNcms = options.officialNcmProvider ?? cachedOfficialNcmCatalog;
  if (options.ncmAutoRefreshTime) {
    const stopSchedule = startDailyNcmRefresh(options.ncmAutoRefreshTime,
      () => refreshScheduledNcms(getOfficialNcms, pool), options.logger ?? app.log);
    app.addHook("onClose", async () => stopSchedule());
  }
  app.get("/api/v1/operational-values", { config: permissionConfig("catalog.read") }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const result = await pool.query<{ id: string; entity_key: string; code: string | null; value: string; created_by: string | null }>(
      `SELECT id, entity_key, code, value, created_by FROM catalog.operational_value
       ORDER BY entity_key, normalized_value`);
    const groupColumn = await pool.query<{ enabled: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'procurement' AND table_name = 'purchase_order_item'
         AND column_name = 'item_group') AS enabled`);
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const canViewAllImporters = request.authorizationContext?.roles.some(role => ["Master", "Administrador"].includes(role)) ?? false;
    const userId = request.authContext?.userId;
    return { items: result.rows.filter(row => row.entity_key !== "IMPORTER" || canViewAllImporters
      || scopes.includes(row.value) || row.created_by === userId)
      .map(row => ({ id: row.id, entity: row.entity_key.toLowerCase(), code: row.code, value: row.value })),
      capabilities: { purchaseOrderGroup: groupColumn.rows[0]?.enabled ?? false } };
  });

  app.post("/api/v1/operational-values", { config: permissionConfig("catalog.write") }, async (request, reply) => {
    const body = z.object({ entity: z.string().trim().toUpperCase(), code: z.string().trim().min(1).max(120).optional(), value: z.string().trim().min(1).max(240),
      reason: z.string().trim().min(8).max(500) }).strict().safeParse(request.body);
    const actor = request.authContext;
    if (!body.success || !operationalValueKeys.has(body.data.entity)) {
      return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "Selecione uma entidade e informe um valor válido.");
    }
    if (body.data.value.length > operationalValueMax[body.data.entity]
      || !operationalValueHasValidFormat(body.data.entity, body.data.value)) {
      return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "O valor não respeita o formato do campo escolhido.");
    }
    if ((body.data.entity === "GROUP") !== (body.data.code !== undefined)) {
      return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "Informe código e valor para Group; as demais entidades recebem somente valor.");
    }
    if (!actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
    if (!request.authorizationContext?.roles.some(role => ["Master", "Administrador", "Compras"].includes(role))) {
      return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para administrar valores das entidades.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const inserted = await client.query<{ id: string; entity_key: string; code: string | null; value: string }>(
        `INSERT INTO catalog.operational_value (id, entity_key, code, value, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, entity_key, code, value`,
        [id, body.data.entity, body.data.code ?? null, body.data.value, actor.userId]);
      const correlationId = randomUUID();
      await client.query(
        `INSERT INTO audit.audit_log
          (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
         VALUES ($1,'OPERATIONAL_VALUE',$2,'OPERATIONAL_VALUE',$2,'CREATE','value',NULL,$3::jsonb,$4,now(),$5,$6)`,
        [randomUUID(), id, JSON.stringify({ entity: body.data.entity.toLowerCase(), code: body.data.code ?? null, value: body.data.value }),
          `${actor.issuer}#${actor.subject}`, body.data.reason, correlationId]);
      await client.query(
        `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
         VALUES ($1,'catalog.operational_value.created','OPERATIONAL_VALUE',$2,$3::jsonb,now())`,
        [correlationId, id, JSON.stringify({ id, entity: body.data.entity.toLowerCase() })]);
      await client.query("COMMIT");
      return reply.code(201).send({ id: inserted.rows[0].id,
        entity: inserted.rows[0].entity_key.toLowerCase(), code: inserted.rows[0].code, value: inserted.rows[0].value });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueError(error)) return problem(reply, 409, "DUPLICATE_OPERATIONAL_VALUE", "Esse valor já existe para a entidade.");
      throw error;
    } finally { client.release(); }
  });

  app.post("/api/v1/operational-values/bulk", { config: permissionConfig("catalog.write") }, async (request, reply) => {
    const body = z.object({ entity: z.string().trim().toUpperCase(),
      values: z.array(z.string().trim().min(1).max(240)).min(1).max(500),
      reason: z.string().trim().min(8).max(500) }).strict().safeParse(request.body);
    const actor = request.authContext;
    if (!body.success || !operationalValueKeys.has(body.data.entity)) {
      return problem(reply, 400, "INVALID_OPERATIONAL_VALUES", "Informe uma entidade e uma lista JSON válida com até 500 valores.");
    }
    if (body.data.entity === "GROUP") {
      return problem(reply, 400, "INVALID_OPERATIONAL_VALUES", "Informe o código e o valor de cada registro Group.");
    }
    const invalidValue = body.data.values.find(value => value.length > operationalValueMax[body.data.entity]
      || !operationalValueHasValidFormat(body.data.entity, value));
    if (invalidValue) {
      return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "Um ou mais valores não respeitam o formato do campo escolhido.");
    }
    if (!actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
    if (!request.authorizationContext?.roles.some(role => ["Master", "Administrador", "Compras"].includes(role))) {
      return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para administrar valores das entidades.");
    }

    const client = await pool.connect();
    let createdCount = 0;
    let skippedCount = 0;
    try {
      await client.query("BEGIN");
      for (const value of body.data.values) {
        const id = randomUUID();
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO catalog.operational_value (id, entity_key, value, created_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT (entity_key, normalized_value) DO NOTHING RETURNING id`,
          [id, body.data.entity, value, actor.userId]);
        if (!inserted.rowCount) {
          skippedCount += 1;
          continue;
        }

        createdCount += 1;
        const correlationId = randomUUID();
        await client.query(
          `INSERT INTO audit.audit_log
            (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
           VALUES ($1,'OPERATIONAL_VALUE',$2,'OPERATIONAL_VALUE',$2,'CREATE','value',NULL,$3::jsonb,$4,now(),$5,$6)`,
          [randomUUID(), id, JSON.stringify({ entity: body.data.entity.toLowerCase(), value }),
            `${actor.issuer}#${actor.subject}`, body.data.reason, correlationId]);
        await client.query(
          `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
           VALUES ($1,'catalog.operational_value.created','OPERATIONAL_VALUE',$2,$3::jsonb,now())`,
          [correlationId, id, JSON.stringify({ id, entity: body.data.entity.toLowerCase() })]);
      }
      await client.query("COMMIT");
      return reply.code(201).send({ createdCount, skippedCount });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });

  app.patch<{ Params: { id: string } }>("/api/v1/operational-values/:id",
    { config: permissionConfig("catalog.write") }, async (request, reply) => {
      const id = operationalValueId.safeParse(request.params.id);
      const body = operationalValueUpdateBody.safeParse(request.body);
      const actor = request.authContext;
      if (!id.success || !body.success) {
        return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "Informe um valor válido para edição.");
      }
      if (!actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
      if (!request.authorizationContext?.roles.some(role => ["Master", "Administrador", "Compras"].includes(role))) {
        return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para administrar valores das entidades.");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query<{ entity_key: string; code: string | null; value: string }>(
          `SELECT entity_key, code, value FROM catalog.operational_value WHERE id = $1 FOR UPDATE`, [id.data]);
        const previous = current.rows[0];
        if (!previous) {
          await client.query("ROLLBACK");
          return problem(reply, 404, "OPERATIONAL_VALUE_NOT_FOUND", "Valor não encontrado.");
        }
        if (previous.value !== body.data.expectedValue) {
          await client.query("ROLLBACK");
          return problem(reply, 409, "STALE_OPERATIONAL_VALUE", "Este valor foi alterado por outra pessoa. Atualize a lista e tente novamente.");
        }
        if ((previous.entity_key === "GROUP" && (body.data.expectedCode ?? null) !== previous.code)
          || (previous.entity_key !== "GROUP" && (body.data.code !== undefined || body.data.expectedCode !== undefined))) {
          await client.query("ROLLBACK");
          return problem(reply, 409, "STALE_OPERATIONAL_VALUE", "O código foi alterado ou não corresponde ao cadastro atual.");
        }
        const code = body.data.code ?? previous.code;
        if (previous.entity_key === "GROUP" && !code) {
          await client.query("ROLLBACK");
          return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "Group exige código e valor.");
        }
        if (body.data.value.length > operationalValueMax[previous.entity_key]
          || !operationalValueHasValidFormat(previous.entity_key, body.data.value)) {
          await client.query("ROLLBACK");
          return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "O valor não respeita o formato do campo escolhido.");
        }
        if (previous.value === body.data.value && previous.code === code) {
          await client.query("COMMIT");
          return { id: id.data, entity: previous.entity_key.toLowerCase(), value: previous.value, unchanged: true };
        }

        const updated = await client.query<{ entity_key: string; code: string | null; value: string }>(
          `UPDATE catalog.operational_value SET code = $2, value = $3 WHERE id = $1
           RETURNING entity_key, code, value`, [id.data, code, body.data.value]);
        const correlationId = randomUUID();
        await client.query(
          `INSERT INTO audit.audit_log
            (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
           VALUES ($1,'OPERATIONAL_VALUE',$2,'OPERATIONAL_VALUE',$2,'UPDATE','value',$3::jsonb,$4::jsonb,$5,now(),$6,$7)`,
          [randomUUID(), id.data,
            JSON.stringify({ entity: previous.entity_key.toLowerCase(), code: previous.code, value: previous.value }),
            JSON.stringify({ entity: updated.rows[0].entity_key.toLowerCase(), code: updated.rows[0].code, value: updated.rows[0].value }),
            `${actor.issuer}#${actor.subject}`, body.data.reason, correlationId]);
        await client.query(
          `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
           VALUES ($1,'catalog.operational_value.updated','OPERATIONAL_VALUE',$2,$3::jsonb,now())`,
          [correlationId, id.data, JSON.stringify({ id: id.data, entity: updated.rows[0].entity_key.toLowerCase() })]);
        await client.query("COMMIT");
        return { id: id.data, entity: updated.rows[0].entity_key.toLowerCase(), code: updated.rows[0].code, value: updated.rows[0].value };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (isUniqueError(error)) {
          return problem(reply, 409, "DUPLICATE_OPERATIONAL_VALUE", "Esse valor já existe para esta entidade.");
        }
        throw error;
      } finally { client.release(); }
    });

  app.delete<{ Params: { id: string } }>("/api/v1/operational-values/:id",
    { config: permissionConfig("catalog.write") }, async (request, reply) => {
      const id = operationalValueId.safeParse(request.params.id);
      const body = operationalValueDeleteBody.safeParse(request.body);
      const actor = request.authContext;
      if (!id.success || !body.success) {
        return problem(reply, 400, "INVALID_OPERATIONAL_VALUE", "Informe o valor que deseja excluir.");
      }
      if (!actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
      if (!request.authorizationContext?.roles.some(role => ["Master", "Administrador", "Compras"].includes(role))) {
        return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para administrar valores das entidades.");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query<{ entity_key: string; code: string | null; value: string }>(
          `SELECT entity_key, code, value FROM catalog.operational_value WHERE id = $1 FOR UPDATE`, [id.data]);
        const previous = current.rows[0];
        if (!previous) {
          await client.query("ROLLBACK");
          return problem(reply, 404, "OPERATIONAL_VALUE_NOT_FOUND", "Valor não encontrado.");
        }
        if (previous.value !== body.data.expectedValue
          || (previous.entity_key === "GROUP" && (body.data.expectedCode ?? null) !== previous.code)
          || (previous.entity_key !== "GROUP" && body.data.expectedCode !== undefined)) {
          await client.query("ROLLBACK");
          return problem(reply, 409, "STALE_OPERATIONAL_VALUE", "Este valor foi alterado por outra pessoa. Atualize a lista e tente novamente.");
        }
        if (previous.entity_key === "IMPORTER") {
          const usage = await client.query<{ in_use: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM procurement.purchase_order WHERE upper(btrim(importer)) = upper(btrim($1))
               UNION ALL SELECT 1 FROM imports.import_process WHERE upper(btrim(importer)) = upper(btrim($1))
               UNION ALL SELECT 1 FROM procurement.purchase_request WHERE upper(btrim(importer)) = upper(btrim($1))
               UNION ALL SELECT 1 FROM procurement.import_request WHERE upper(btrim(importer)) = upper(btrim($1))
               UNION ALL SELECT 1 FROM identity.erp_user_importer_scope WHERE upper(btrim(importer_code)) = upper(btrim($1))
               UNION ALL SELECT 1 FROM catalog.entry WHERE upper(btrim(importer)) = upper(btrim($1))
               UNION ALL SELECT 1 FROM jobs.export_job WHERE upper(btrim($1)) = ANY (
                 SELECT upper(btrim(scope_value)) FROM unnest(importer_scopes) AS scopes(scope_value))
             ) AS in_use`, [previous.value]);
          if (usage.rows[0]?.in_use) {
            await client.query("ROLLBACK");
            return problem(reply, 409, "OPERATIONAL_VALUE_IN_USE", "Esta importadora está vinculada a cadastros ou registros existentes e não pode ser excluída.");
          }
        }

        await client.query("DELETE FROM catalog.operational_value WHERE id = $1", [id.data]);
        const correlationId = randomUUID();
        await client.query(
          `INSERT INTO audit.audit_log
            (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
           VALUES ($1,'OPERATIONAL_VALUE',$2,'OPERATIONAL_VALUE',$2,'DELETE','value',$3::jsonb,NULL,$4,now(),$5,$6)`,
          [randomUUID(), id.data,
            JSON.stringify({ entity: previous.entity_key.toLowerCase(), code: previous.code, value: previous.value }),
            `${actor.issuer}#${actor.subject}`, body.data.reason, correlationId]);
        await client.query(
          `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
           VALUES ($1,'catalog.operational_value.deleted','OPERATIONAL_VALUE',$2,$3::jsonb,now())`,
          [correlationId, id.data, JSON.stringify({ id: id.data, entity: previous.entity_key.toLowerCase() })]);
        await client.query("COMMIT");
        return { id: id.data, entity: previous.entity_key.toLowerCase(), deleted: true };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    });

  for (const { path, kind, sourceColumn } of resources.filter(resource => resource.kind !== "NCM")) {
    app.get<{ Querystring: { importer?: string } }>(`/api/v1/${path}/options`,
      { config: permissionConfig("catalog.read") }, async (request, reply) => {
        const parsed = z.object({ importer: z.string().trim().min(1).max(120) }).safeParse(request.query);
        if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Selecione a importadora.");
        const scopes = request.authorizationContext?.importerScopes ?? [];
        if (!hasScope(scopes, parsed.data.importer)) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Importadora fora do seu escopo.");
        const descriptionColumn = kind === "PRODUCT" ? "U" : sourceColumn;
        const result = await pool.query<{ code: string; name: string; status: string }>(
          `WITH historical AS (
             SELECT btrim(CASE WHEN $4 = 'SUPPLIER' AND source.sheet_name = 'Pós Embarque'
                       THEN obs.raw_values ->> 'G' ELSE obs.raw_values ->> $1 END) AS code,
                    btrim(CASE WHEN $4 = 'SUPPLIER' THEN
                       CASE WHEN source.sheet_name = 'Pós Embarque' THEN obs.raw_values ->> 'G'
                            ELSE obs.raw_values ->> $1 END
                       ELSE obs.raw_values ->> $2 END) AS name, count(*)::int AS uses
             FROM procurement.po_line_observation obs
             JOIN procurement.purchase_order po ON po.id = obs.purchase_order_id
             JOIN migration.source_row source ON source.id = obs.source_row_id
             WHERE po.importer = $3
               AND (($4 = 'SUPPLIER' AND source.sheet_name IN ('Pré Embarque','Pós Embarque'))
                 OR ($4 = 'PRODUCT' AND source.sheet_name = 'Pré Embarque'))
               AND nullif(btrim(CASE WHEN $4 = 'SUPPLIER' AND source.sheet_name = 'Pós Embarque'
                         THEN obs.raw_values ->> 'G' ELSE obs.raw_values ->> $1 END), '') IS NOT NULL
               AND nullif(btrim(CASE WHEN $4 = 'SUPPLIER' THEN
                         CASE WHEN source.sheet_name = 'Pós Embarque' THEN obs.raw_values ->> 'G'
                              ELSE obs.raw_values ->> $1 END
                         ELSE obs.raw_values ->> $2 END), '') IS NOT NULL
               AND upper(btrim(CASE WHEN $4 = 'SUPPLIER' AND source.sheet_name = 'Pós Embarque'
                         THEN obs.raw_values ->> 'G' ELSE obs.raw_values ->> $1 END)) NOT IN ('#N/A','#REF!','#VALUE!')
             GROUP BY 1,2
           ), ranked AS (
             SELECT code,name,row_number() OVER (PARTITION BY upper(code) ORDER BY uses DESC,name) AS rank
             FROM historical
           ), curated AS (
             SELECT code,name,status FROM catalog.entry
             WHERE kind = $4 AND status = 'ACTIVE'
               AND (($4 IN ('SUPPLIER','PRODUCT') AND importer IS NULL)
                 OR ($4 = 'NCM' AND importer = $3))
           ), candidates AS (
             SELECT ranked.code,ranked.name,'HISTORICAL_CANDIDATE'::text AS status FROM ranked
             WHERE ranked.rank=1 AND NOT EXISTS (
               SELECT 1 FROM curated WHERE upper(btrim(curated.code))=upper(ranked.code))
           )
           SELECT * FROM curated UNION ALL SELECT * FROM candidates ORDER BY name,code`,
          [sourceColumn, descriptionColumn, parsed.data.importer, kind]);
        return { items: result.rows };
      });
  }

  app.get("/api/v1/importers", { config: permissionConfig("catalog.read") }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const result = await pool.query<{ importer: string; po_count: number }>(
      `SELECT available.importer,
              count(po.id) FILTER (WHERE po.source_kind = 'HISTORICAL_EXCEL')::int AS po_count
       FROM (SELECT importer FROM procurement.purchase_order
             UNION SELECT importer FROM imports.import_process
             UNION SELECT value AS importer FROM catalog.operational_value
                    WHERE entity_key = 'IMPORTER' AND value = ANY($1::text[])) AS available
       LEFT JOIN procurement.purchase_order AS po ON po.importer = available.importer
       WHERE available.importer = ANY($1::text[])
       GROUP BY available.importer ORDER BY available.importer`, [scopes]);
    return { items: result.rows.map(row => ({ code: row.importer, historicalPoCount: row.po_count,
      status: "HISTORICAL_OBSERVED", officialTotvsMappingKnown: false })) };
  });

  for (const { path, kind, sourceColumn } of resources) {
    const base = `/api/v1/${path}`;
    const scopeMode = kind === "NCM" ? "global" : "importer";
    const officialNcmJoin = kind === "NCM"
      ? `LEFT JOIN catalog.ncm_siscomex_data AS official ON official.ncm_entry_id = entry.id`
      : "";
    const officialNcmFields = kind === "NCM"
      ? `, official.mandatory_import_attributes, official.source_updated_at::text AS source_updated_at,
           official.attributes_source_version, official.synced_at`
      : "";
    app.get(base, { config: permissionConfig("catalog.read", scopeMode) }, async (request, reply) => {
      const parsed = (kind === "NCM" ? globalListQuery : listQuery).safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Filtros inválidos.");
      const { search, page, pageSize } = parsed.data;
      const result = await pool.query<{ total_count: number; items: Entry[] }>(
        `WITH visible AS MATERIALIZED (
           SELECT entry.*${officialNcmFields} FROM catalog.entry AS entry
           ${officialNcmJoin}
           WHERE entry.kind = $1 AND entry.importer IS NULL
             AND ($2::text IS NULL OR strpos(lower(entry.code), lower($2)) > 0
                  OR strpos(lower(entry.name), lower($2)) > 0)
         ), page AS (SELECT * FROM visible ORDER BY normalized_code, id LIMIT $3 OFFSET $4)
         SELECT (SELECT count(*)::int FROM visible) AS total_count,
                coalesce(jsonb_agg(to_jsonb(page) - 'normalized_code' - 'created_by' - 'updated_by'
                  ORDER BY page.normalized_code, page.id) FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items
         FROM page`,
        [kind, search || null, pageSize, (page - 1) * pageSize]);
      return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0),
        items: (result.rows[0]?.items ?? []).map(present) };
    });

    app.get(`${base}/candidates`, { config: permissionConfig("catalog.read", scopeMode) }, async (request, reply) => {
      const parsed = (kind === "NCM" ? globalListQuery : listQuery).safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Filtros inválidos.");
      const { search, page, pageSize } = parsed.data;
      const importer = kind === "NCM" ? undefined : (parsed.data as z.infer<typeof listQuery>).importer;
      const result = await pool.query<{ total_count: number; items: Array<{ importer: string | null;
        raw_code: string; observation_count: number; sample_source_row_id: string;
        sample_sheet_name: string; sample_row_number: number }> }>(
        `WITH candidates AS MATERIALIZED (
           SELECT CASE WHEN $5 = 'NCM' THEN NULL::text ELSE po.importer END AS importer,
                  CASE WHEN $5 = 'NCM'
                         AND regexp_replace(btrim(obs.raw_values->>$1), '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
                       THEN regexp_replace(btrim(obs.raw_values->>$1), '[^0-9]', '', 'g')
                       ELSE btrim(obs.raw_values->>$1) END AS raw_code,
                  count(*)::int AS observation_count, min(obs.source_row_id::text) AS sample_source_row_id
           FROM procurement.po_line_observation AS obs
           JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
           WHERE ($5 = 'NCM' OR po.importer = ANY($2::text[]))
             AND ($5 = 'NCM' OR $3::text IS NULL OR po.importer = $3)
             AND nullif(btrim(obs.raw_values->>$1), '') IS NOT NULL
             AND ($4::text IS NULL OR strpos(lower(obs.raw_values->>$1), lower($4)) > 0
                  OR ($5 = 'NCM' AND strpos(lower(regexp_replace(btrim(obs.raw_values->>$1), '[^0-9]', '', 'g')), lower($4)) > 0))
           GROUP BY 1, 2
         ), page AS (
           SELECT candidate.*, source.sheet_name AS sample_sheet_name,
                  source.row_number AS sample_row_number
           FROM candidates AS candidate
           JOIN migration.source_row AS source ON source.id = candidate.sample_source_row_id::uuid
           ORDER BY candidate.observation_count DESC, candidate.importer, candidate.raw_code
           LIMIT $6 OFFSET $7
         )
         SELECT (SELECT count(*)::int FROM candidates) AS total_count,
                coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.observation_count DESC, page.importer, page.raw_code)
                  FILTER (WHERE page.sample_source_row_id IS NOT NULL), '[]'::jsonb) AS items FROM page`,
         [sourceColumn, kind === "NCM" ? [] : request.authorizationContext?.importerScopes ?? [], importer ?? null,
          search || null, kind, pageSize, (page - 1) * pageSize]);
      return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0),
        items: (result.rows[0]?.items ?? []).map(row => ({ ...(row.importer ? { importer: row.importer } : {}),
          rawCode: row.raw_code, observationCount: row.observation_count,
          sampleSourceRowId: row.sample_source_row_id, sampleSheetName: row.sample_sheet_name,
          sampleRowNumber: row.sample_row_number, status: "HISTORICAL_CANDIDATE",
          eligibleFormat: kind !== "NCM" || /^[0-9]{8}$/u.test(row.raw_code.replace(/\D/gu, "")) })) };
    });

    if (kind === "NCM") {
      app.get(`${base}/official-search`, { config: permissionConfig("catalog.read", "global") }, async (request, reply) => {
        const parsed = z.object({ search: z.string().trim().min(2).max(120),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(25) }).strict().safeParse(request.query);
        if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Informe pelo menos dois caracteres para pesquisar NCMs oficiais.");
        let official: OfficialNcmCatalog;
        try { official = await getOfficialNcms(); }
        catch (error) { return siscomexUnavailable(reply, error); }
        const search = parsed.data.search.toLocaleLowerCase("pt-BR");
        const codeSearch = parsed.data.search.replace(/\D/gu, "");
        const matches = official.items.filter(item => item.name.toLocaleLowerCase("pt-BR").includes(search)
          || (codeSearch.length > 0 && item.code.includes(codeSearch)));
        matches.sort((left, right) => {
          const leftExact = left.code === codeSearch ? 0 : 1;
          const rightExact = right.code === codeSearch ? 0 : 1;
          return leftExact - rightExact || left.code.localeCompare(right.code);
        });
        const { page, pageSize } = parsed.data;
        const pageItems = matches.slice((page - 1) * pageSize, page * pageSize);
        const registered = pageItems.length
          ? await pool.query<{ normalized_code: string }>(
            `SELECT normalized_code FROM catalog.entry
             WHERE kind = 'NCM' AND importer IS NULL AND normalized_code = ANY($1::text[])`,
            [pageItems.map(item => item.code)])
          : { rows: [] };
        const registeredCodes = new Set(registered.rows.map(row => row.normalized_code));
        reply.header("cache-control", "no-store");
        return { page, pageSize, totalCount: matches.length, sourceUpdatedAt: official.sourceUpdatedAt,
          attributesSourceVersion: official.attributesVersion,
          items: pageItems.map(item => ({ ...item, alreadyRegistered: registeredCodes.has(item.code) })) };
      });

      app.post(`${base}/refresh-official`, { config: permissionConfig("catalog.write", "global") }, async (request, reply) => {
        const body = z.object({}).strict().safeParse(request.body ?? {});
        const auth = request.authorizationContext;
        const actor = request.authContext;
        if (!body.success) return problem(reply, 400, "INVALID_REQUEST", "A atualiza\\u00e7\\u00e3o oficial n\\u00e3o recebe par\\u00e2metros.");
        if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sess\\u00e3o ausente.");
        if (!canWriteKind(auth.roles, "NCM")) return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permiss\\u00e3o para atualizar o cat\\u00e1logo NCM.");
        let official: OfficialNcmCatalog;
        try { official = await getOfficialNcms(); }
        catch (error) { return siscomexUnavailable(reply, error); }
        try {
          return await refreshRegisteredNcms(pool, official,
            { issuer: actor.issuer, subject: actor.subject, userId: actor.userId },
            "Atualiza\u00e7\u00e3o manual dos NCMs cadastrados pela fonte oficial do Siscomex.");
        } catch (error) {
          request.log.error({ error }, "Falha ao atualizar NCMs oficiais");
          return problem(reply, 500, "NCM_REFRESH_FAILED", "N\u00e3o foi poss\u00edvel concluir a atualiza\u00e7\u00e3o dos NCMs.");
        }
      });

      app.post(`${base}/import-official`, { config: permissionConfig("catalog.write", "global") }, async (request, reply) => {
        const parsed = z.object({ code: z.string().regex(/^[0-9]{8}$/u) }).strict().safeParse(request.body);
        const key = request.headers["idempotency-key"];
        const auth = request.authorizationContext;
        const actor = request.authContext;
        if (!parsed.success || !validKey(key)) {
          return problem(reply, 400, "INVALID_OFFICIAL_NCM", "Selecione um NCM oficial e informe uma chave de idempotência válida.");
        }
        if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
        if (!canWriteKind(auth.roles, "NCM")) return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para cadastrar NCMs.");

        let official: OfficialNcmCatalog;
        try { official = await getOfficialNcms(); }
        catch (error) { return siscomexUnavailable(reply, error); }
        const source = official.items.find(item => item.code === parsed.data.code);
        if (!source) return problem(reply, 404, "OFFICIAL_NCM_NOT_FOUND", "Esse NCM não está na tabela vigente do Siscomex.");

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`catalog:${actor.userId}:${key}`]);
          const payloadHash = createHash("sha256").update(JSON.stringify({ kind: "NCM", code: source.code })).digest("hex");
          const receipt = await client.query<{ payload_sha256: string; entry_id: string }>(
            "SELECT payload_sha256, entry_id FROM catalog.command_receipt WHERE actor_user_id=$1 AND idempotency_key=$2",
            [actor.userId, key]);
          if (receipt.rows[0]) {
            const existing = await client.query<Entry>(
              `SELECT entry.*, official.mandatory_import_attributes,
                      official.source_updated_at::text AS source_updated_at,
                      official.attributes_source_version, official.synced_at
               FROM catalog.entry AS entry LEFT JOIN catalog.ncm_siscomex_data AS official ON official.ncm_entry_id=entry.id
               WHERE entry.id=$1 AND entry.kind='NCM' AND entry.importer IS NULL`, [receipt.rows[0].entry_id]);
            await client.query("COMMIT");
            if (receipt.rows[0].payload_sha256.trim() !== payloadHash) {
              return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada com outro NCM.");
            }
            if (!existing.rows[0]) return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada em outro cadastro.");
            return reply.code(200).send(present(existing.rows[0]));
          }
          const duplicate = await client.query<{ id: string }>(
            `SELECT id FROM catalog.entry WHERE kind='NCM' AND importer IS NULL AND normalized_code=$1`, [source.code]);
          if (duplicate.rows[0]) {
            await client.query("ROLLBACK");
            return problem(reply, 409, "NCM_ALREADY_REGISTERED", "Esse NCM já está cadastrado na entidade.");
          }
          const id = randomUUID();
          const evidence = "Tabela oficial NCM da Receita Federal / Portal Único Siscomex (Classif).";
          const inserted = await client.query<Entry>(
            `INSERT INTO catalog.entry
              (id,importer,kind,code,name,status,provenance,evidence,valid_from,valid_to,created_by,updated_by)
             VALUES ($1,NULL,'NCM',$2,$3,'ACTIVE','OFFICIAL_SISCOMEX',$4,$5,$6,$7,$7)
             ON CONFLICT (normalized_code) WHERE kind='NCM' AND importer IS NULL DO NOTHING RETURNING *`,
            [id, source.code, source.name, evidence, source.validFrom, source.validTo, actor.userId]);
          if (!inserted.rowCount) {
            await client.query("ROLLBACK");
            return problem(reply, 409, "NCM_ALREADY_REGISTERED", "Esse NCM já está cadastrado na entidade.");
          }
          const attributesHash = officialNcmAttributesHash(source.mandatoryImportAttributes);
          await client.query(
            `INSERT INTO catalog.ncm_siscomex_data
              (ncm_entry_id,source_updated_at,attributes_source_version,mandatory_import_attributes,attributes_sha256,synced_at)
             VALUES ($1,$2,$3,$4::jsonb,$5,now())`,
            [id, official.sourceUpdatedAt, official.attributesVersion,
              JSON.stringify(source.mandatoryImportAttributes), attributesHash]);
          await client.query(
            `INSERT INTO catalog.command_receipt (actor_user_id,idempotency_key,payload_sha256,entry_id)
             VALUES ($1,$2,$3,$4)`, [actor.userId, key, payloadHash, id]);
          const correlationId = randomUUID();
          const reason = "Inclusão no catálogo a partir do catálogo oficial Siscomex.";
          await client.query(
            `INSERT INTO audit.audit_log
              (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
             VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,'CREATE',NULL,NULL,$3::jsonb,$4,now(),$5,$6)`,
            [randomUUID(), id, JSON.stringify(present(inserted.rows[0])), `${actor.issuer}#${actor.subject}`, reason, correlationId]);
          await client.query(
            `INSERT INTO audit.audit_log
              (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
             VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,'CREATE','mandatoryImportAttributes',NULL,$3::jsonb,$4,now(),$5,$6)`,
            [randomUUID(), id, JSON.stringify(source.mandatoryImportAttributes), `${actor.issuer}#${actor.subject}`, reason, correlationId]);
          await client.query(
            `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
             VALUES ($1,'catalog.entry.created','CATALOG_ENTRY',$2,$3::jsonb,now())`,
            [randomUUID(), id, JSON.stringify({ id, importer: null, kind: "NCM", version: 1 })]);
          await client.query("COMMIT");
          reply.header("ETag", '"1"');
          return reply.code(201).send({ ...present(inserted.rows[0]),
            mandatoryImportAttributes: source.mandatoryImportAttributes,
            sourceUpdatedAt: official.sourceUpdatedAt, attributesSourceVersion: official.attributesVersion });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          if (isUniqueError(error)) return problem(reply, 409, "NCM_ALREADY_REGISTERED", "Esse NCM já está cadastrado na entidade.");
          throw error;
        } finally { client.release(); }
      });
    }

    app.get<{ Params: { id: string } }>(`${base}/:id`, { config: permissionConfig("catalog.read", scopeMode) }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      if (!id.success) return problem(reply, 400, "INVALID_ID", "Identificador inválido.");
      const result = await pool.query<Entry>(
        kind === "NCM"
          ? `SELECT entry.*, official.mandatory_import_attributes,
                    official.source_updated_at::text AS source_updated_at,
                    official.attributes_source_version, official.synced_at
             FROM catalog.entry AS entry
             LEFT JOIN catalog.ncm_siscomex_data AS official ON official.ncm_entry_id = entry.id
             WHERE entry.id = $1 AND entry.kind = $2 AND entry.importer IS NULL LIMIT 1`
          : `SELECT entry.* FROM catalog.entry AS entry
             WHERE entry.id = $1 AND entry.kind = $2 AND entry.importer IS NULL LIMIT 1`,
        [id.data, kind]);
      if (!result.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Cadastro não encontrado.");
      reply.header("ETag", `"${result.rows[0].version}"`);
      return present(result.rows[0]);
    });

    app.get<{ Params: { id: string } }>(`${base}/:id/history`, { config: permissionConfig("catalog.read", scopeMode) }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      const parsed = historyQuery.safeParse(request.query);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_QUERY", "Identificador ou paginação inválidos.");
      const visible = await pool.query<{ id: string }>(
         `SELECT id FROM catalog.entry
          WHERE id = $1 AND kind = $2 AND importer IS NULL LIMIT 1`,
        [id.data, kind]);
      if (!visible.rowCount) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Cadastro não encontrado.");
      const { page, pageSize } = parsed.data;
      const history = await pool.query<{ total_count: number | string; items: Array<Record<string, unknown>> }>(
        `WITH page AS (
           SELECT id, operation, field_name, old_value, new_value, actor_id, occurred_at, reason
           FROM audit.catalog_entry_history WHERE aggregate_id = $1
           ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3
         )
         SELECT (SELECT count(*)::int FROM audit.catalog_entry_history WHERE aggregate_id = $1) AS total_count,
           coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.occurred_at DESC, page.id DESC)
             FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items FROM page`,
        [id.data, pageSize, (page - 1) * pageSize]);
      return { page, pageSize, totalCount: Number(history.rows[0]?.total_count ?? 0),
        items: (history.rows[0]?.items ?? []).map(event => ({
          id: event.id, operation: event.operation, fieldName: event.field_name,
          oldValue: event.old_value, newValue: event.new_value,
          actor: event.actor_id, occurredAt: event.occurred_at, reason: event.reason,
        })) };
    });

    if (kind === "PRODUCT") {
      app.post(`${base}/bulk`, { config: permissionConfig("catalog.write") }, async (request, reply) => {
        const parsed = productBulkBody.safeParse(request.body);
        const auth = request.authorizationContext;
        const actor = request.authContext;
        if (!parsed.success) return problem(reply, 400, "INVALID_PRODUCTS", "Informe de 1 a 500 produtos com codigo e descricao validos.");
        if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessao ausente.");
        if (!canWriteKind(auth.roles, "PRODUCT")) return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissao para cadastrar produtos.");

        const client = await pool.connect();
        let createdCount = 0;
        let skippedCount = 0;
        try {
          await client.query("BEGIN");
          for (const item of parsed.data.items) {
            const code = item.code.trim();
            const description = item.description.trim();
            const id = randomUUID();
            const inserted = await client.query<Entry>(
              `INSERT INTO catalog.entry
                (id, importer, kind, code, name, evidence, created_by, updated_by)
               VALUES ($1,NULL,'PRODUCT',$2,$3,$4,$5,$5)
               ON CONFLICT (normalized_code) WHERE kind = 'PRODUCT' AND importer IS NULL DO NOTHING
               RETURNING *`,
              [id, code, description, "Cadastro global de produto importado por JSON.", actor.userId]);
            if (!inserted.rowCount) { skippedCount += 1; continue; }
            createdCount += 1;
            await client.query(
              `INSERT INTO catalog.entry_alias (id, entry_id, raw_code, source_kind, created_by)
               VALUES ($1,$2,$3,'MANUAL_ENTRY',$4)`, [randomUUID(), id, item.code, actor.userId]);
            const correlationId = randomUUID();
            await client.query(
              `INSERT INTO audit.audit_log
                (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
               VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,'CREATE',NULL,NULL,$3::jsonb,$4,now(),$5,$6)`,
              [randomUUID(), id, JSON.stringify(present(inserted.rows[0])), `${actor.issuer}#${actor.subject}`,
                "Importacao em massa de produtos por arquivo JSON.", correlationId]);
            await client.query(
              `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
               VALUES ($1,'catalog.entry.created','CATALOG_ENTRY',$2,$3::jsonb,now())`,
              [randomUUID(), id, JSON.stringify({ id, importer: null, kind: "PRODUCT", version: 1 })]);
          }
          await client.query("COMMIT");
          return reply.code(201).send({ createdCount, skippedCount });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally { client.release(); }
      });
    }

    app.post(base, { config: permissionConfig("catalog.write", scopeMode) }, async (request, reply) => {
      const schema = kind === "PRODUCT" ? productCreateBody : kind === "NCM" ? ncmCreateBody : createBody;
      const parsed = schema.safeParse(request.body);
      const key = request.headers["idempotency-key"];
      if (!parsed.success || !validKey(key)) return problem(reply, 400, "INVALID_CATALOG_ENTRY", "Informe cadastro, evidência, motivo e Idempotency-Key válidos.");
      const auth = request.authorizationContext;
      const actor = request.authContext;
      const body: z.infer<typeof createBody> = kind === "PRODUCT"
        ? (() => {
          const product = parsed.data as z.infer<typeof productCreateBody>;
          return { importer: undefined, code: product.code, name: product.name,
            evidence: product.evidence ?? "Cadastro global de produto pela aplica\u00e7\u00e3o.",
            reason: product.reason ?? "Cadastro global de produto.", validFrom: null, validTo: null };
        })()
        : kind === "NCM"
          ? { ...(parsed.data as z.infer<typeof ncmCreateBody>), importer: undefined }
          : parsed.data as z.infer<typeof createBody>;
      if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
      if (!canWriteKind(auth.roles, kind)) return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para este cadastro.");
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
            `SELECT * FROM catalog.entry WHERE id = $1 AND kind = $2 AND importer IS NULL`,
            [existing.rows[0].entry_id, kind]);
          await client.query("COMMIT");
          if (!visible.rows[0]) return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada em outro cadastro.");
          if (existing.rows[0].payload_sha256.trim() !== hash) return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada com outro conteúdo.");
          reply.header("ETag", `"${visible.rows[0].version}"`);
          return reply.code(200).send(present(visible.rows[0]));
        }
        const id = randomUUID();
        const inserted = await client.query<Entry>(
          `INSERT INTO catalog.entry
            (id, importer, kind, code, name, evidence, valid_from, valid_to, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
          [id, null, kind, code, body.name, body.evidence,
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
          [randomUUID(), id, JSON.stringify({ id, ...(kind === "NCM" ? {} : { importer: null }), kind, version: 1 })]);
        await client.query("COMMIT");
        reply.header("ETag", '"1"');
        return reply.code(201).send(present(inserted.rows[0]));
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (isUniqueError(error)) return problem(reply, 409, "CATALOG_DUPLICATE", "Código já cadastrado no catálogo.");
        throw error;
      } finally { client.release(); }
    });

    app.patch<{ Params: { id: string } }>(`${base}/:id`, { config: permissionConfig("catalog.write", scopeMode) }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      const patchSchema = kind === "PRODUCT" ? productPatchBody : kind === "NCM" ? ncmPatchBody : patchBody;
      const parsed = patchSchema.safeParse(request.body);
      const rawExpected = request.headers["x-record-version"] ?? request.headers["if-match"];
      const expected = typeof rawExpected === "string" && /^[1-9][0-9]*$/u.test(rawExpected)
        ? `"${rawExpected}"` : rawExpected;
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
          `SELECT * FROM catalog.entry WHERE id = $1 AND kind = $2 AND importer IS NULL FOR UPDATE`,
          [id.data, kind]);
        const before = found.rows[0];
        if (!before) { await client.query("ROLLBACK"); return problem(reply, 404, "RESOURCE_NOT_FOUND", "Cadastro não encontrado."); }
        if (`"${before.version}"` !== expected) { await client.query("ROLLBACK"); return problem(reply, 409, "VERSION_CONFLICT", "Cadastro alterado. Recarregue antes de salvar."); }
        const body = parsed.data;
        const name = body.name ?? before.name;
        const status = body.status ?? before.status;
        const evidence = body.evidence ?? before.evidence;
        const validFrom = body.validFrom === undefined ? before.valid_from : body.validFrom;
        const validTo = body.validTo === undefined ? before.valid_to : body.validTo;
        if (!validDates(kind, validFrom, validTo, status)) {
          await client.query("ROLLBACK"); return problem(reply, 400, "INVALID_VALIDITY", "Vigência inválida.");
        }
        const changed = { name, status, evidence, valid_from: validFrom, valid_to: validTo,
          provenance: kind === "NCM" ? "MANUAL_REVIEW" : before.provenance };
        const old = { name: before.name, status: before.status, evidence: before.evidence,
          valid_from: before.valid_from, valid_to: before.valid_to, provenance: before.provenance };
        const differences = Object.entries(changed).filter(([field, value]) => value !== old[field as keyof typeof old]);
        if (differences.length === 0) { await client.query("ROLLBACK"); return problem(reply, 400, "NO_CHANGES", "Nenhuma alteração informada."); }
        const updated = await client.query<Entry>(
          `UPDATE catalog.entry SET name=$2,status=$3,evidence=$4,valid_from=$5,valid_to=$6,provenance=$7,
             version=version+1,updated_by=$8,updated_at=now() WHERE id=$1 RETURNING *`,
          [id.data, name, status, evidence, validFrom, validTo, changed.provenance, actor.userId]);
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
